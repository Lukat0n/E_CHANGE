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

export async function fulfillOrder(
  accessToken: string,
  storeId: string,
  orderId: string | number
) {
  // Mark the order as fulfilled/shipped in Tiendanube
  const res = await fetch(
    `${TIENDANUBE_API}/${storeId}/orders/${orderId}/fulfill`,
    {
      method: "POST",
      headers: headers(accessToken),
      body: JSON.stringify({
        shipping_tracking_number: null,
        shipping_tracking_url: null,
        notify_customer: true,
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error creando envío: ${res.status} - ${errText}`);
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
    // Products
    products: products
      ? products.map((p) => ({
          name: (p.name as Record<string, string>)?.es || (p.name as Record<string, string>)?.pt || String(p.name),
          quantity: p.quantity,
          price: p.price,
          sku: p.sku,
        }))
      : [],
  };
}
