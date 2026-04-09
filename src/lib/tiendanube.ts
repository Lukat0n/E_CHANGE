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

// Create a Draft Order in Tiendanube for a cambio (exchange)
export async function createDraftOrder(
  accessToken: string,
  storeId: string,
  params: {
    products: Array<{ variant_id: number; quantity: number }>;
    contactName: string;
    contactLastName: string;
    contactEmail: string;
    contactPhone: string;
    shippingAddress: string;
    shippingNumber: string;
    shippingFloor: string;
    shippingCity: string;
    shippingProvince: string;
    shippingZipcode: string;
    shippingNeighborhood: string;
    shippingCost: number;
  }
) {
  const body = {
    contact_name: params.contactName,
    contact_lastname: params.contactLastName,
    contact_email: params.contactEmail,
    contact_phone: params.contactPhone,
    payment_status: "paid",
    products: params.products.map((p) => ({
      variant_id: p.variant_id,
      quantity: p.quantity,
    })),
    shipping: {
      cost: params.shippingCost || 0,
      shipping_address: {
        address: params.shippingAddress,
        number: params.shippingNumber,
        floor: params.shippingFloor || "",
        locality: params.shippingNeighborhood || "",
        city: params.shippingCity,
        province: params.shippingProvince,
        zipcode: params.shippingZipcode,
      },
    },
    note: "Cambio generado desde E-Change",
  };

  const res = await fetch(`${TIENDANUBE_API}/${storeId}/draft_orders`, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error creando draft order: ${res.status} - ${errText}`);
  }

  return res.json();
}

// Confirm a Draft Order → converts it to a real order
export async function confirmDraftOrder(
  accessToken: string,
  storeId: string,
  draftOrderId: number | string
) {
  const res = await fetch(
    `${TIENDANUBE_API}/${storeId}/draft_orders/${draftOrderId}/confirm`,
    {
      method: "POST",
      headers: headers(accessToken),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error confirmando draft order: ${res.status} - ${errText}`);
  }

  return res.json();
}

export function formatOrderInfo(order: Record<string, unknown>, storeDomain?: string) {
  const shipping = order.shipping_address as Record<string, unknown> | null;
  const shippingStatus = order.shipping_status as string;
  const shippingTracking = order.shipping_tracking_number as string | null;
  const shippingTrackingUrl = order.shipping_tracking_url as string | null;
  const shippingCarrier = order.shipping_carrier_name as string | null;
  const shippingOption = order.shipping as string | null;
  const paymentStatus = order.payment_status as string;
  const status = order.status as string;
  const createdAt = order.created_at as string;
  const shippedAt = order.shipped_at as string | null;
  const shippingMaxDays = order.shipping_max_days as number | null;
  const products = order.products as Array<Record<string, unknown>> | null;

  const contactEmail = order.contact_email as string | null;
  const contactName = order.contact_name as string | null;
  const contactPhone = order.contact_phone as string | null;

  // Calculate max delivery date
  let maxDeliveryDate: string | null = null;
  if (shippingMaxDays != null) {
    const baseDate = shippedAt ? new Date(shippedAt) : new Date(createdAt);
    const maxDate = new Date(baseDate);
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
    shippingTracking,
    shippingTrackingUrl,
    trackingPageUrl,
    maxDeliveryDate,
    shippingAddress: shipping
      ? {
          address: shipping.address,
          city: shipping.city,
          province: shipping.province,
          zipcode: shipping.zipcode,
        }
      : null,
    // Customer
    customer: {
      name: contactName || (shipping?.name as string) || "",
      email: contactEmail || "",
      phone: contactPhone || "",
    },
    // Products (include variant_id and weight for draft order creation)
    products: products
      ? products.map((p) => ({
          name: (p.name as Record<string, string>)?.es || (p.name as Record<string, string>)?.pt || String(p.name),
          quantity: p.quantity as number,
          price: p.price as string,
          sku: p.sku as string,
          variant_id: p.variant_id as number,
          weight: p.weight as string | null,
        }))
      : [],
  };
}
