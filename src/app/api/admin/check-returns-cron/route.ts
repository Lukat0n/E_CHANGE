import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findStore } from "@/lib/store";
import { formatOrderInfo } from "@/lib/tiendanube";

// Vercel cron (configurado en vercel.json) chequea diariamente los pedidos
// "en tránsito" para detectar retornos/pérdidas. Protegido con CRON_SECRET
// para que solo Vercel lo dispare.
//
// Lógica:
//   1. Fetchea órdenes de Tiendanube con shipping_status="shipped" en los últimos 60 días.
//   2. Filtra candidatos: despachadas hace entre max_days y (max_days + 15 días).
//   3. Excluye las que ya tienen alerta acknowledged=false en nuestro DB.
//   4. Manda la lista al worker para scraping en batch.
//   5. Por cada "returned"/"lost" detectado: crea/actualiza TrackingAlert.

export const maxDuration = 300; // 5 min máximo (Vercel Pro)

const MAX_CANDIDATES_PER_RUN = 20;

export async function GET(req: NextRequest) {
  try {
    return await handleCron(req);
  } catch (err) {
    console.error("[check-returns-cron] uncaught error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5).join("\n") : null,
      },
      { status: 500 }
    );
  }
}

async function handleCron(req: NextRequest) {
  // Auth: Vercel cron pasa Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const store = await findStore("default");
  if (!store) return NextResponse.json({ error: "Store no encontrada" }, { status: 404 });

  // 1. Fetch órdenes shipped. Simplifico la URL al máximo: solo el filtro de
  //    shipping_status. La ventana temporal la aplicamos en código local.
  const ordersUrl = `https://api.tiendanube.com/v1/${store.storeId}/orders?shipping_status=shipped&per_page=50`;
  console.log("[check-returns-cron] fetching:", ordersUrl);
  const ordersRes = await fetch(ordersUrl, {
    headers: {
      Authentication: `bearer ${store.accessToken}`,
      "User-Agent": "E-Change App (echange@app.com)",
    },
  });
  if (!ordersRes.ok) {
    const body = await ordersRes.text().catch(() => "");
    console.error(`[check-returns-cron] orders fetch falló: HTTP ${ordersRes.status} body=${body.slice(0, 300)}`);
    return NextResponse.json(
      { ok: false, error: `Fetch órdenes falló: HTTP ${ordersRes.status}`, body: body.slice(0, 300), url: ordersUrl },
      { status: 502 }
    );
  }
  const orders = (await ordersRes.json()) as Array<Record<string, unknown>>;

  // 2. Filtrar candidatos: shipped_at en la ventana de retorno (max_days .. max_days+15).
  const now = Date.now();
  const candidates: Array<{
    orderId: number;
    orderNumber: string;
    customerName: string | null;
    trackingCode: string | null;
    trackingUrl: string | null;
  }> = [];

  for (const o of orders) {
    const shippedAt = o.shipped_at as string | null;
    const maxDays = (o.shipping_max_days as number | null) ?? 5;
    const status = String(o.shipping_status || "").toLowerCase();
    const trackingUrl = (o.shipping_tracking_url as string | null) || null;
    const trackingCode = (o.shipping_tracking_number as string | null) || null;
    const orderId = o.id as number;
    const orderNumber = String(o.number ?? "");

    // Tiene que estar shipped, no delivered/returned
    if (status !== "shipped") continue;
    // Tiene que tener tracking URL (sino no podemos scrapear)
    if (!trackingUrl) continue;
    // Tiene que tener shipped_at
    if (!shippedAt) continue;

    const shippedTime = new Date(shippedAt).getTime();
    const daysSinceShipped = (now - shippedTime) / (24 * 60 * 60 * 1000);

    // Ventana de retorno: desde max_days hasta max_days + 15
    if (daysSinceShipped < maxDays || daysSinceShipped > maxDays + 15) continue;

    const formatted = formatOrderInfo(o);
    candidates.push({
      orderId,
      orderNumber,
      customerName: formatted.customer.name || null,
      trackingCode,
      trackingUrl,
    });
  }

  // 3. Excluir las que ya tienen TrackingAlert activo (sin acknowledge).
  const existingAlerts = await prisma.trackingAlert.findMany({
    where: { storeId: store.storeId, acknowledged: false },
    select: { orderId: true },
  });
  const alreadyAlerted = new Set(existingAlerts.map((a) => a.orderId));
  const filtered = candidates.filter((c) => !alreadyAlerted.has(c.orderId)).slice(0, MAX_CANDIDATES_PER_RUN);

  console.log(
    `[check-returns-cron] orders fetched=${orders.length}, candidatos=${candidates.length}, ya alertados=${alreadyAlerted.size}, a chequear=${filtered.length}`
  );

  if (filtered.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, alerts: 0, candidates: candidates.length });
  }

  // 4. Llamar al worker para batch scraping.
  const workerUrl = process.env.WORKER_URL;
  const workerKey = process.env.WORKER_API_KEY;
  if (!workerUrl || !workerKey) {
    return NextResponse.json({ ok: false, error: "WORKER_URL/WORKER_API_KEY no configuradas" }, { status: 500 });
  }

  let scrapeResults: Array<{ orderId: number; status: string; matched?: string | null }> = [];
  try {
    const r = await fetch(`${workerUrl.replace(/\/$/, "")}/api/scrape-trackings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": workerKey },
      body: JSON.stringify({
        items: filtered.map((c) => ({ orderId: c.orderId, url: c.trackingUrl })),
      }),
      signal: AbortSignal.timeout(280000), // 280s — apenas debajo del 300 max
    });
    const data = (await r.json()) as { results?: Array<{ orderId: number; status: string; matched?: string | null }> };
    scrapeResults = data.results || [];
  } catch (err) {
    console.error("[check-returns-cron] worker scrape error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error en el worker" },
      { status: 502 }
    );
  }

  // 5. Crear TrackingAlert para los que matchearon (returned o lost).
  let alertsCreated = 0;
  for (const result of scrapeResults) {
    if (result.status !== "returned" && result.status !== "lost") continue;
    const candidate = filtered.find((c) => c.orderId === result.orderId);
    if (!candidate) continue;

    try {
      await prisma.trackingAlert.upsert({
        where: { storeId_orderId: { storeId: store.storeId, orderId: candidate.orderId } },
        create: {
          storeId: store.storeId,
          orderId: candidate.orderId,
          orderNumber: candidate.orderNumber,
          customerName: candidate.customerName,
          trackingCode: candidate.trackingCode,
          trackingUrl: candidate.trackingUrl,
          status: result.status,
          notes: result.matched || null,
        },
        update: {
          // Si ya existía (probablemente con acknowledged=true), re-activamos
          status: result.status,
          notes: result.matched || null,
          detectedAt: new Date(),
          acknowledged: false,
          acknowledgedAt: null,
        },
      });
      alertsCreated++;
    } catch (err) {
      console.error(`[check-returns-cron] error guardando alert para order ${candidate.orderId}:`, err);
    }
  }

  console.log(`[check-returns-cron] checked=${scrapeResults.length}, alerts creadas=${alertsCreated}`);

  return NextResponse.json({
    ok: true,
    checked: scrapeResults.length,
    alerts: alertsCreated,
    candidates: candidates.length,
  });
}
