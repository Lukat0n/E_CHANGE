import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { findStore } from "@/lib/store";
import { createOrder, buildOrderAdminUrl, getStoreInfo } from "@/lib/tiendanube";

// POST /api/admin/create-test-order
// Crea una orden de prueba en Tiendanube vía API con datos hardcodeados
// (Lucas Ramos, Entre Ríos). Útil para probar el flujo de reclamos sin
// tener que hacer una compra real.
//
// Variant hardcodeado: 132236502 (Rodillera Frío-Calor M de Gélica).
export async function POST() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const store = await findStore("default");
  if (!store) return NextResponse.json({ error: "Store no encontrada" }, { status: 404 });

  const shippingAddress = {
    first_name: "Lucas",
    last_name: "Ramos",
    address: "9 de julio",
    number: "80",
    floor: null,
    locality: null,
    city: "Libertador San Martín",
    province: "Entre Ríos",
    zipcode: "3103",
    country: "AR",
    phone: "+541126368640",
  };

  const result = await createOrder(store.accessToken, store.storeId, {
    payment_status: "paid",
    products: [{ variant_id: 132236502, quantity: 1 }],
    customer: {
      email: "lkatoramos@gmail.com",
      name: "Lucas Ramos",
      phone: "+541126368640",
    },
    shipping_address: shippingAddress,
    billing_address: shippingAddress,
    shipping_cost_customer: 0,
    note: "[TEST] Orden creada desde el admin para pruebas de flujo de reclamos.",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status || 502 });
  }

  // Resolver admin URL
  let storeDomain: string | null = null;
  try {
    const info = await getStoreInfo(store.accessToken, store.storeId);
    if (info?.url_with_protocol) storeDomain = info.url_with_protocol as string;
    else if (info?.original_domain) storeDomain = info.original_domain as string;
  } catch {}

  const orderId = result.order.id as number;
  const orderNumber = String(result.order.number ?? "");
  const adminUrl = buildOrderAdminUrl(orderId, storeDomain);

  return NextResponse.json({
    ok: true,
    orderId,
    orderNumber,
    adminUrl,
    customer: {
      email: "lkatoramos@gmail.com",
      phone: "1126368640",
    },
  });
}
