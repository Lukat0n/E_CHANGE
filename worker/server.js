import express from "express";
import { testLogin, createShipment, inspectUrl, quoteCarriers, checkTrackingStatus, editOrderAddress } from "./robot.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Healthcheck para que Railway sepa que el servicio está vivo
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Middleware de auth: todas las rutas /api/* requieren la API key compartida
function requireApiKey(req, res, next) {
  const provided = req.headers["x-api-key"];
  const expected = process.env.WORKER_API_KEY;
  if (!expected) {
    return res.status(500).json({ ok: false, error: "WORKER_API_KEY no configurada" });
  }
  if (provided !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

// FASE 1: Probar que el robot puede loguear al admin de Tiendanube
app.post("/api/test-login", requireApiKey, async (_req, res) => {
  try {
    const result = await testLogin();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/test-login] failed:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Navegar a una URL del admin y devolver HTML + screenshot.
// Útil para inspeccionar páginas que aún no automatizamos.
app.post("/api/inspect-url", requireApiKey, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: "Falta 'url' en el body" });
    const result = await inspectUrl(url);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/inspect-url] failed:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Editar dirección de envío de una orden directamente en el admin de TN
// (porque su API marca shipping_address como read-only post-creación).
// Body: { orderId, address: { calle, numero, ciudad, provincia, codigoPostal, departamento?, barrio?, telefono? } }
app.post("/api/edit-order-address", requireApiKey, async (req, res) => {
  try {
    const result = await editOrderAddress(req.body || {});
    res.json(result);
  } catch (err) {
    console.error("[/api/edit-order-address] failed:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Batch scraping de múltiples tracking URLs. Lo usa el cron diario para
// detectar retornos. Procesa secuencialmente (para no saturar los sitios)
// y devuelve los resultados al callback.
// Body: { items: [{ orderId: number, url: string }, ...] }
app.post("/api/scrape-trackings", requireApiKey, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const results = [];
    for (const item of items) {
      if (!item?.url) {
        results.push({ orderId: item?.orderId, status: "unknown", error: "no url" });
        continue;
      }
      try {
        const r = await checkTrackingStatus({ url: item.url });
        results.push({
          orderId: item.orderId,
          status: r.status,
          matched: r.matchedKeyword || null,
        });
        console.log(`[scrape-trackings] order ${item.orderId} → ${r.status} (matched: ${r.matchedKeyword || "-"})`);
      } catch (err) {
        results.push({ orderId: item.orderId, status: "unknown", error: err?.message || String(err) });
      }
    }
    res.json({ ok: true, results });
  } catch (err) {
    console.error("[/api/scrape-trackings] failed:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Scrape la página de tracking del carrier (Correo/e-pick/etc.) y devuelve
// un status parseado: returned | delivered | in_transit | lost | unknown.
// Body: { url: "https://www.correoargentino.com.ar/...." }
app.post("/api/tracking-status", requireApiKey, async (req, res) => {
  try {
    const result = await checkTrackingStatus(req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/tracking-status] failed:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Cotizar carriers para un CP: hace login + paso 1 del manual + lee los radios.
// Body: { destZip, alto?, ancho?, profundidad?, peso? }
app.post("/api/quote", requireApiKey, async (req, res) => {
  try {
    const result = await quoteCarriers(req.body || {});
    res.json(result);
  } catch (err) {
    console.error("[/api/quote] failed:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// FASE 3+: Crear un envío (DRY RUN — no submitea aún)
app.post("/api/shipment", requireApiKey, async (req, res) => {
  try {
    const result = await createShipment(req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/shipment] failed:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Worker escuchando en puerto ${port}`);
});
