import { NextRequest, NextResponse } from "next/server";

// Webhook de WhatsApp Cloud API (Meta).
//
// GET: handshake de verificación. Meta manda hub.mode=subscribe + hub.verify_token
// + hub.challenge. Si el token coincide con WHATSAPP_WEBHOOK_VERIFY_TOKEN,
// respondemos con el challenge en texto plano.
//
// POST: eventos en vivo (mensaje recibido, status update, etc.). No los procesamos
// por ahora, solo respondemos 200 para que Meta no haga retry.

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("[whatsapp webhook]", JSON.stringify(body).slice(0, 500));
  } catch {}
  return NextResponse.json({ ok: true });
}
