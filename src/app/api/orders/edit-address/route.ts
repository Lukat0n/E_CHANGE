import { NextRequest, NextResponse } from "next/server";
import { findStore } from "@/lib/store";
import { getOrderByNumber, formatOrderInfo } from "@/lib/tiendanube";

// El worker tiene un timeout largo porque el bot tarda ~15-25s entre login + abrir
// la orden + editar + guardar.
export const maxDuration = 90;

// POST /api/orders/edit-address
// Permite al cliente actualizar la dirección de envío de su pedido SI todavía
// no fue despachado. Verifica ownership comparando con el email/teléfono de
// contacto de la orden original (mismo criterio que /api/orders/verify).
//
// Body: {
//   storeId, orderNumber, customerEmail,
//   shipping: { provincia, ciudad, calle, numero, departamento?, barrio?, codigoPostal, nombreCompleto?, telefono? }
// }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, orderNumber, customerEmail, shipping } = body;

  if (!orderNumber || !customerEmail) {
    return NextResponse.json(
      { error: "Faltan orderNumber o customerEmail" },
      { status: 400 }
    );
  }
  if (!shipping || typeof shipping !== "object") {
    return NextResponse.json({ error: "Falta el objeto shipping" }, { status: 400 });
  }

  const store = await findStore(storeId || "default");
  if (!store) {
    return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });
  }

  // 1. Fetch original order
  const orderRaw = await getOrderByNumber(store.accessToken, store.storeId, orderNumber);
  if (!orderRaw) {
    return NextResponse.json({ error: "No se encontró una orden con ese número" }, { status: 404 });
  }

  // 2. Verify ownership by email (same as /verify)
  const orderEmail = ((orderRaw.contact_email as string) || "").toLowerCase().trim();
  const inputEmail = String(customerEmail).toLowerCase().trim();
  if (!orderEmail || orderEmail !== inputEmail) {
    return NextResponse.json(
      { error: "El email no coincide con el de la orden" },
      { status: 403 }
    );
  }

  // 3. Check shipping_status — bloquear si ya se despachó
  const info = formatOrderInfo(orderRaw as Record<string, unknown>);
  const status = (info.shippingStatus || "").toLowerCase();
  if (status === "shipped" || status === "fulfilled" || status === "delivered") {
    return NextResponse.json(
      {
        error: "Tu pedido ya fue enviado. La dirección no se puede editar a esta altura. Si hay un problema con la entrega contactanos por WhatsApp.",
        shippingStatus: info.shippingStatus,
      },
      { status: 400 }
    );
  }

  // 4. Llamar al worker (Playwright bot) para que edite la dirección directamente
  //    en el admin de Tiendanube. Tiendanube no expone shipping_address como
  //    editable via API REST, así que la única forma de automatizar es vía la
  //    UI del admin con el bot.
  const orderId = orderRaw.id as number;
  const workerUrl = process.env.WORKER_URL;
  const workerKey = process.env.WORKER_API_KEY;
  if (!workerUrl || !workerKey) {
    return NextResponse.json(
      { ok: false, error: "WORKER_URL/WORKER_API_KEY no configuradas" },
      { status: 500 }
    );
  }

  try {
    const botRes = await fetch(`${workerUrl.replace(/\/$/, "")}/api/edit-order-address`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": workerKey },
      body: JSON.stringify({
        orderId,
        address: {
          calle: shipping.calle || "",
          numero: shipping.numero || "",
          departamento: shipping.departamento || "",
          barrio: shipping.barrio || "",
          ciudad: shipping.ciudad || "",
          provincia: shipping.provincia || "",
          codigoPostal: shipping.codigoPostal || "",
          telefono: shipping.telefono || (orderRaw.contact_phone as string) || "",
        },
      }),
      signal: AbortSignal.timeout(80000),
    });
    const botData = await botRes.json();
    console.log(
      `[edit-address] Orden #${orderNumber} (${orderId}) bot result: ok=${botData?.ok} filled=${JSON.stringify(botData?.filled || {})} saved=${JSON.stringify(botData?.saved || {})}`
    );

    if (!botData?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: botData?.error
            ? `El bot no pudo editar la dirección: ${botData.error}`
            : "El bot no pudo editar la dirección. Revisá los logs del worker.",
          botResult: botData,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Dirección actualizada correctamente.",
      newAddress: shipping,
    });
  } catch (err) {
    console.error("[edit-address] error llamando al bot:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error llamando al bot" },
      { status: 502 }
    );
  }
}
