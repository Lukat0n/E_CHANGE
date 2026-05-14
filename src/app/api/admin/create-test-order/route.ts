import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { findStore } from "@/lib/store";
import { createOrder, buildOrderAdminUrl, getStoreInfo } from "@/lib/tiendanube";

// POST /api/admin/create-test-order
// Crea una orden de prueba en Tiendanube vía API copiando la última orden
// real (productos + dirección) pero cambiando email y teléfono a:
//   lkatoramos@gmail.com / +541126368640
// Así evitamos problemas de variant_id inexistente o address con formato raro.
export async function POST() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const store = await findStore("default");
  if (!store) return NextResponse.json({ error: "Store no encontrada" }, { status: 404 });

  // 1. Fetchear la última orden REAL como template
  const lastRes = await fetch(
    `https://api.tiendanube.com/v1/${store.storeId}/orders?per_page=1&page=1`,
    {
      headers: {
        Authentication: `bearer ${store.accessToken}`,
        "User-Agent": "E-Change App (echange@app.com)",
      },
    }
  );
  if (!lastRes.ok) {
    return NextResponse.json(
      { ok: false, error: `No se pudo fetchear la última orden: HTTP ${lastRes.status}` },
      { status: 502 }
    );
  }
  const orders = (await lastRes.json()) as Array<Record<string, unknown>>;
  const template = orders[0];
  if (!template) {
    return NextResponse.json({ ok: false, error: "No hay órdenes para usar como template" }, { status: 404 });
  }

  // 2. Productos: copiamos variant_id + quantity del template, con price 0
  //    para que la orden tenga total $0 (es una orden de prueba).
  const templateProducts = (template.products as Array<{ variant_id?: number; quantity?: number }> | undefined) || [];
  const products = templateProducts
    .filter((p) => p.variant_id != null)
    .map((p) => ({ variant_id: p.variant_id as number, quantity: p.quantity || 1, price: "0.00" }));
  if (products.length === 0) {
    return NextResponse.json({ ok: false, error: "La orden template no tiene productos válidos" }, { status: 502 });
  }

  const templateShipping = template.shipping_address as Record<string, unknown> | null;

  // 3. Dirección de envío: si la orden template tiene una, la usamos. Si no,
  //    fallback al destino de prueba (Entre Ríos, Libertador San Martín).
  const shippingAddress = {
    first_name: "Lucas",
    last_name: "Ramos",
    address: (templateShipping?.address as string) || "9 de julio",
    number: (templateShipping?.number as string) || "80",
    floor: (templateShipping?.floor as string) || null,
    locality: (templateShipping?.locality as string) || null,
    city: (templateShipping?.city as string) || "Libertador San Martín",
    province: (templateShipping?.province as string) || "Entre Ríos",
    zipcode: (templateShipping?.zipcode as string) || "3103",
    country: "AR",
    phone: "+541126368640",
  };

  // 4. Crear la orden con envío Correo Argentino Clásico hardcodeado.
  //    Total queda en $0 (productos a price 0, shipping_cost_customer 0).
  //    shipping_cost_owner se setea para que el flujo de cambio compute
  //    un precio realista (4500 + owner cost) cuando se haga el test.
  const result = await createOrder(store.accessToken, store.storeId, {
    payment_status: "paid",
    products,
    customer: {
      email: "lkatoramos@gmail.com",
      name: "Lucas Ramos",
      phone: "+541126368640",
    },
    shipping_address: shippingAddress,
    billing_address: shippingAddress,
    shipping: "api_3603194",
    shipping_option: "Envío Nube - Correo Argentino Clásico a domicilio",
    shipping_option_code: "ne-correo-arg-clasico-domicilio",
    shipping_carrier_name: "Envío Nube",
    shipping_pickup_type: "ship",
    shipping_cost_customer: 0,
    shipping_cost_owner: 7434,
    note: "[TEST] Orden creada desde el admin para pruebas de flujo de reclamos.",
  });

  if (!result.ok) {
    console.error("[create-test-order] createOrder failed:", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status || 502 });
  }

  // Resolver admin URL para abrir la orden en otra pestaña
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
    templateOrderNumber: template.number,
    customer: {
      email: "lkatoramos@gmail.com",
      phone: "1126368640",
    },
  });
}
