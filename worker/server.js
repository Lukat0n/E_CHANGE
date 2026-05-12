import express from "express";
import { testLogin, createShipment } from "./robot.js";

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

// FASE 3+: Crear un envío
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
