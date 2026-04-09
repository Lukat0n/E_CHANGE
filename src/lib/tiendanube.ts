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
  // Search by order number
  const res = await fetch(
    `${TIENDANUBE_API}/${storeId}/orders?q=${encodeURIComponent(orderNumber)}`,
    { headers: headers(accessToken) }
  );

  if (!res.ok) return null;
  const orders = await res.json();

  // Find exact match by number
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

// Extract useful order info for the customer
export function formatOrderInfo(order: Record<string, unknown>) {
  const shipping = order.shipping_address as Record<string, unknown> | null;
  const shippingStatus = order.shipping_status as string;
  const shippingTracking = order.shipping_tracking_number as string | null;
  const shippingTrackingUrl = order.shipping_tracking_url as string | null;
  const shippingCarrier = order.shipping_carrier_name as string | null;
  const shippingOption = order.shipping as string | null;
  const paymentStatus = order.payment_status as string;
  const status = order.status as string;
  const createdAt = order.created_at as string;
  const products = order.products as Array<Record<string, unknown>> | null;

  // Customer data is at the order level in Tiendanube, not nested
  const contactEmail = order.contact_email as string | null;
  const contactName = order.contact_name as string | null;
  const contactPhone = order.contact_phone as string | null;

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
