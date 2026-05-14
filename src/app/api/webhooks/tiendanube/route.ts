import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { findStore } from "@/lib/store";

// Webhook de Tiendanube. Eventos de interés para reenvíos:
//   - order/packed   → la orden se empacó (Envío Nube generó la etiqueta).
//   - order/fulfilled → la orden se despachó.
//   - order/updated  → cualquier update (capturar tracking que aparece después).
//
// Body: { store_id, event, id }. Header HMAC: x-linkedstore-hmac-sha256.
//
// Comportamiento: cuando llega un evento, buscamos el claim con reorderOrderId,
// fetcheamos la orden y guardamos el tracking en el claim si lo encontramos.
// NO mandamos WhatsApp con tracking — Tiendanube ya manda mail nativo al
// cliente cuando se cambia el estado del envío. El WhatsApp #1 al aprobar
// el reenvío ya le avisa al cliente que el mail va a llegar.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Verificación de HMAC: usamos el client secret de la app.
  const expected = process.env.TIENDANUBE_CLIENT_SECRET;
  const provided = req.headers.get("x-linkedstore-hmac-sha256") || req.headers.get("X-Linkedstore-Hmac-Sha256");
  if (expected) {
    if (!provided) {
      console.warn("[tiendanube webhook] missing HMAC header");
      return NextResponse.json({ ok: false, error: "missing signature" }, { status: 401 });
    }
    const digest = crypto.createHmac("sha256", expected).update(raw, "utf8").digest("base64");
    if (
      digest.length !== provided.length ||
      !crypto.timingSafeEqual(Buffer.from(digest, "utf8"), Buffer.from(provided, "utf8"))
    ) {
      console.warn("[tiendanube webhook] HMAC mismatch");
      return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
    }
  }

  let body: { store_id?: number; event?: string; id?: number } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ ok: true });
  }

  console.log("[tiendanube webhook]", JSON.stringify(body));

  const event = body.event || "";
  const orderId = body.id;
  if (!orderId) return NextResponse.json({ ok: true });

  // Solo nos importan eventos de despacho/empaque + updates (para retry de tracking)
  if (event !== "order/packed" && event !== "order/fulfilled" && event !== "order/updated") {
    return NextResponse.json({ ok: true });
  }

  try {
    // Buscar el claim que tenga este orderId guardado como reorder
    const claim = await prisma.claim.findFirst({ where: { reorderOrderId: orderId } });
    if (!claim) {
      // No es una orden de reenvío nuestra — ignorar.
      return NextResponse.json({ ok: true, skipped: "no matching claim" });
    }

    // Si ya mandamos WhatsApp con tracking, no duplicar
    if (claim.shipmentTrackingCode) {
      return NextResponse.json({ ok: true, skipped: "already sent" });
    }

    // Fetchear la orden via API para sacar el tracking actual
    const store = await findStore(claim.storeId);
    if (!store) return NextResponse.json({ ok: true, skipped: "no store" });

    const res = await fetch(`https://api.tiendanube.com/v1/${store.storeId}/orders/${orderId}`, {
      headers: {
        Authentication: `bearer ${store.accessToken}`,
        "User-Agent": "E-Change App (echange@app.com)",
      },
    });
    if (!res.ok) {
      console.warn("[tiendanube webhook] couldn't fetch order", orderId, res.status);
      return NextResponse.json({ ok: true, skipped: "fetch failed" });
    }
    const order = (await res.json()) as {
      shipping_tracking_number?: string | null;
      shipping_tracking_url?: string | null;
    };

    const trackingCode = order.shipping_tracking_number || null;
    const trackingUrl = order.shipping_tracking_url || null;
    if (!trackingCode && !trackingUrl) {
      // Empacado pero todavía sin tracking — ignoramos, esperamos al próximo evento
      return NextResponse.json({ ok: true, skipped: "no tracking yet" });
    }

    // Guardamos el tracking en el claim para tener registro. NO mandamos
    // WhatsApp: el cliente ya recibió WhatsApp #1 anunciándole que le va
    // a llegar el mail nativo de Tiendanube cuando se despache.
    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        shipmentTrackingCode: trackingCode,
        shipmentTrackingUrl: trackingUrl,
      },
    });

    console.log(`[tiendanube webhook] tracking guardado en claim ${claim.id}: ${trackingCode} ${trackingUrl || ""}`);
    return NextResponse.json({ ok: true, trackingSaved: true });
  } catch (err) {
    console.error("[tiendanube webhook] error:", err);
    return NextResponse.json({ ok: true, error: err instanceof Error ? err.message : String(err) });
  }
}

// GET: handshake / health check (Tiendanube no lo pide pero por las dudas)
export async function GET() {
  return NextResponse.json({ ok: true, info: "Tiendanube webhook endpoint" });
}
