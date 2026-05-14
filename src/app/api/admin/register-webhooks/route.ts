import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { findStore } from "@/lib/store";

// One-shot: registra los webhooks de Tiendanube que necesitamos para reenvíos.
// Llamalo UNA vez después de deployar. Si ya existen, Tiendanube los re-emite
// con el mismo url y los upserta.
//
// Eventos suscritos:
//   - order/packed     → cuando la orden se empacó (Envío Nube generó etiqueta)
//   - order/fulfilled  → cuando la orden se despachó
export async function POST(req: NextRequest) {
  const authenticated = await isAuthenticated();
  if (!authenticated) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const store = await findStore("default");
  if (!store) return NextResponse.json({ error: "Store no encontrada" }, { status: 404 });

  const baseUrl = req.nextUrl.origin;
  const webhookUrl = `${baseUrl}/api/webhooks/tiendanube`;
  const events = ["order/packed", "order/fulfilled"];

  const results: Array<{ event: string; ok: boolean; status?: number; body?: unknown }> = [];

  for (const event of events) {
    const res = await fetch(`https://api.tiendanube.com/v1/${store.storeId}/webhooks`, {
      method: "POST",
      headers: {
        Authentication: `bearer ${store.accessToken}`,
        "User-Agent": "E-Change App (echange@app.com)",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: webhookUrl, event }),
    });

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {}

    results.push({ event, ok: res.ok, status: res.status, body });
  }

  return NextResponse.json({ ok: true, webhookUrl, results });
}

// GET: listar los webhooks actualmente registrados (para debug)
export async function GET() {
  const authenticated = await isAuthenticated();
  if (!authenticated) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const store = await findStore("default");
  if (!store) return NextResponse.json({ error: "Store no encontrada" }, { status: 404 });

  const res = await fetch(`https://api.tiendanube.com/v1/${store.storeId}/webhooks`, {
    headers: {
      Authentication: `bearer ${store.accessToken}`,
      "User-Agent": "E-Change App (echange@app.com)",
    },
  });
  const body = await res.json();
  return NextResponse.json({ ok: res.ok, status: res.status, body });
}
