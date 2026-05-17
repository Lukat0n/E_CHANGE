const TIENDANUBE_API = "https://api.tiendanube.com/v1";

function headers(accessToken: string) {
  return {
    Authentication: `bearer ${accessToken}`,
    "User-Agent": "E-Change App (echange@app.com)",
    "Content-Type": "application/json",
  };
}

export async function getOrderByNumber(
  accessToken: string,
  storeId: string,
  orderNumber: string
) {
  const res = await fetch(
    `${TIENDANUBE_API}/${storeId}/orders?q=${encodeURIComponent(orderNumber)}`,
    { headers: headers(accessToken) }
  );

  if (!res.ok) return null;
  const orders = await res.json();

  const order = orders.find(
    (o: { number: string | number }) => String(o.number) === String(orderNumber)
  );

  return order || null;
}

export async function getStoreInfo(accessToken: string, storeId: string) {
  const res = await fetch(`${TIENDANUBE_API}/${storeId}/store`, {
    headers: headers(accessToken),
  });
  if (!res.ok) return null;
  return res.json();
}

// Tiendanube acepta solo un subset de country codes; Argentina = "AR".
// Provincias se envían como nombre completo (ej. "Buenos Aires").
interface CreateOrderProduct {
  variant_id: number;
  quantity: number;
  price?: string | number;
}

interface CreateOrderAddress {
  first_name?: string;
  last_name?: string;
  address?: string;
  number?: string;
  floor?: string | null;
  locality?: string | null;
  city?: string;
  province?: string;
  zipcode?: string;
  country?: string;
  phone?: string;
}

interface CreateOrderPayload {
  currency?: string;
  language?: string;
  status?: string;
  gateway?: string;
  payment_status?: string;
  products: CreateOrderProduct[];
  inventory_behaviour?: "decrement" | "bypass";
  customer: { email?: string; name?: string; phone?: string; document?: string };
  billing_address?: CreateOrderAddress;
  shipping_address?: CreateOrderAddress;
  shipping_cost_customer?: number;
  shipping_cost_owner?: number;
  // Shipping method choice (qué carrier eligió el cliente). Formato según
  // inspección de una orden orgánica (#17704):
  //   shipping              = "api_3603194"      (carrier app id de Envío Nube en esta store)
  //   shipping_option_code  = "ne-correo-arg-clasico-domicilio"
  //   shipping_carrier_name = "Envío Nube"       (siempre, no el carrier puntual)
  //   shipping_option       = nombre visible
  shipping?: string;
  shipping_option?: string;
  shipping_option_code?: string;
  shipping_option_reference?: string;
  shipping_carrier_name?: string;
  shipping_pickup_type?: "ship" | "pickup";
  shipping_pickup_details?: Record<string, unknown>;
  shipping_store_branch_name?: string;
  shipping_store_branch_extra?: Record<string, unknown>;
  send_confirmation_email?: boolean;
  send_fulfillment_email?: boolean;
  note?: string;
}

/**
 * Crea una orden nueva via API. Soporte oficial de Tiendanube confirmó que es
 * el endpoint correcto para reenvíos. Los pedidos por API NO suman al dashboard
 * de Estadísticas pero sí quedan listados en Ventas con productos visibles, lo
 * que nos permite que el merchant genere el envío desde Envío Nube admin.
 *
 * Importante:
 *  - inventory_behaviour: "bypass" → no descontar stock (el original ya descontó).
 *  - send_confirmation_email / send_fulfillment_email: false → no spamear al cliente.
 *  - status: "open" + payment_status: "paid" → la orden queda lista para empacar.
 */
export async function createOrder(
  accessToken: string,
  storeId: string,
  payload: CreateOrderPayload
): Promise<{ ok: true; order: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const body = {
    currency: "ARS",
    language: "es",
    status: "open",
    gateway: "mercadopago",
    inventory_behaviour: "bypass" as const,
    send_confirmation_email: false,
    send_fulfillment_email: false,
    ...payload,
  };

  const res = await fetch(`${TIENDANUBE_API}/${storeId}/orders`, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errText = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { message?: unknown; description?: unknown };
      const msg = typeof j.message === "string" ? j.message : typeof j.description === "string" ? j.description : null;
      errText = msg ? `${errText}: ${msg}` : `${errText}: ${JSON.stringify(j).slice(0, 300)}`;
    } catch {
      try {
        errText += `: ${(await res.text()).slice(0, 300)}`;
      } catch {}
    }
    return { ok: false, status: res.status, error: errText };
  }

  const order = (await res.json()) as Record<string, unknown>;
  return { ok: true, order };
}

/**
 * Actualiza la dirección de envío de una orden existente. La doc oficial de
 * Tiendanube indica que las actualizaciones de address van por PATCH /orders/{id}
 * con los campos planos de address directamente en el body (no anidados en
 * shipping_address). Si la orden ya fue despachada, Tiendanube responde con error.
 */
export async function updateOrderAddress(
  accessToken: string,
  storeId: string,
  orderId: number | string,
  address: CreateOrderAddress,
  alsoBilling: boolean = true
): Promise<{ ok: true; order: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  // Body con shipping_address + billing_address anidados (formato que acepta PATCH)
  const body: Record<string, unknown> = {
    shipping_address: address,
  };
  if (alsoBilling) body.billing_address = address;

  const res = await fetch(`${TIENDANUBE_API}/${storeId}/orders/${orderId}`, {
    method: "PATCH",
    headers: headers(accessToken),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errText = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { message?: unknown; description?: unknown };
      const msg = typeof j.message === "string" ? j.message : typeof j.description === "string" ? j.description : null;
      errText = msg ? `${errText}: ${msg}` : `${errText}: ${JSON.stringify(j).slice(0, 300)}`;
    } catch {
      try {
        errText += `: ${(await res.text()).slice(0, 300)}`;
      } catch {}
    }
    return { ok: false, status: res.status, error: errText };
  }

  const order = (await res.json()) as Record<string, unknown>;
  return { ok: true, order };
}

/**
 * Construye el URL del admin de Tiendanube para una orden. Útil para linkear al
 * merchant después de crear la orden de reenvío vía API.
 */
export function buildOrderAdminUrl(orderId: number | string, storeDomain?: string | null): string {
  if (storeDomain) {
    // gelica.com.ar → gelica.mitiendanube.com/admin/orders/{id}
    const subdomain = storeDomain.replace(/^https?:\/\//, "").split(".")[0];
    return `https://${subdomain}.mitiendanube.com/admin/orders/${orderId}`;
  }
  return `https://www.tiendanube.com/admin/v2/orders/${orderId}`;
}

export function formatOrderInfo(order: Record<string, unknown>, storeDomain?: string) {
  const shipping = order.shipping_address as Record<string, unknown> | null;
  const shippingStatus = order.shipping_status as string;
  const shippingTracking = order.shipping_tracking_number as string | null;
  const shippingTrackingUrl = order.shipping_tracking_url as string | null;
  const shippingCarrier = order.shipping_carrier_name as string | null;
  const shippingOption = order.shipping as string | null;
  // Cost the merchant actually paid for shipping — used to price re-shipments
  const shippingCostOwnerRaw = order.shipping_cost_owner as string | number | null;
  const shippingCostOwner = shippingCostOwnerRaw != null ? Number(shippingCostOwnerRaw) : null;
  const shippingOptionName = order.shipping_option as string | null;
  const paymentStatus = order.payment_status as string;
  const status = order.status as string;
  const createdAt = order.created_at as string;
  const shippedAt = order.shipped_at as string | null;
  const shippingMaxDays = order.shipping_max_days as number | null;
  const products = order.products as Array<Record<string, unknown>> | null;

  const contactEmail = order.contact_email as string | null;
  const contactName = order.contact_name as string | null;
  const contactPhone = order.contact_phone as string | null;

  // Calculate max delivery date — only if the order has actually been shipped.
  // Tiendanube only populates shipped_at when shipping_status flips to "shipped".
  // If the order isn't shipped yet, there's no countdown and the customer can't reclaim "no recibido".
  let maxDeliveryDate: string | null = null;
  if (shippedAt && shippingMaxDays != null) {
    const maxDate = new Date(shippedAt);
    maxDate.setDate(maxDate.getDate() + shippingMaxDays);
    maxDeliveryDate = maxDate.toISOString();
  }

  // Tracking page URL - built from store domain + order id + token
  const orderId = order.id as number;
  const token = order.token as string | null;
  const trackingPageUrl = (storeDomain && token)
    ? `${storeDomain}/checkout/v3/success/${orderId}/${token}`
    : shippingTrackingUrl;

  return {
    number: order.number,
    status,
    paymentStatus,
    createdAt,
    // Shipping
    shippingStatus,
    shippingCarrier,
    shippingOption,
    shippingOptionName,
    shippingCostOwner,
    shippingTracking,
    shippingTrackingUrl,
    trackingPageUrl,
    maxDeliveryDate,
    shippingAddress: shipping
      ? {
          address: shipping.address,
          number: shipping.number,
          floor: shipping.floor,
          locality: shipping.locality,
          city: shipping.city,
          province: shipping.province,
          zipcode: shipping.zipcode,
          phone: shipping.phone,
          name: shipping.name, // recipient name (puede tener "Nombre Apellido" junto)
        }
      : null,
    // Customer
    customer: {
      name: contactName || (shipping?.name as string) || "",
      email: contactEmail || "",
      phone: contactPhone || "",
    },
    // Products
    products: products
      ? products.map((p) => ({
          name: (p.name as Record<string, string>)?.es || (p.name as Record<string, string>)?.pt || String(p.name),
          quantity: p.quantity as number,
          price: p.price as string,
          sku: p.sku as string,
          variantId: (p.variant_id as number) ?? null,
          productId: (p.product_id as number) ?? null,
        }))
      : [],
    // Storefront URL (needed for shipping calculator)
    storeUrl: storeDomain || null,
  };
}
