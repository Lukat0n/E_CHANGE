import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";
import { sendTemplate, normalizePhoneAR, claimTypeForMessage } from "@/lib/whatsapp";

// POST /api/claims/[id]/send-tracking
// Manda un WhatsApp al cliente con el código de seguimiento + link de Correo Argentino.
// Usa el mismo template estado_solicitud, pasando el link en la variable {{5}}.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) {
    return NextResponse.json({ error: "Claim no encontrado" }, { status: 404 });
  }

  if (!claim.shipmentTrackingCode && !claim.shipmentTrackingUrl) {
    return NextResponse.json(
      { error: "Este claim todavía no tiene código de seguimiento. Creá el envío con el robot primero." },
      { status: 400 }
    );
  }

  const phone = normalizePhoneAR(claim.shippingPhone || claim.customerPhone);
  if (!phone) {
    return NextResponse.json({ error: "El claim no tiene teléfono válido" }, { status: 400 });
  }

  const trackingUrl = claim.shipmentTrackingUrl
    || (claim.shipmentTrackingCode
      ? `https://www.correoargentino.com.ar/formularios/e-commerce?id=${claim.shipmentTrackingCode}`
      : null);

  const trackingMsg = claim.shipmentTrackingCode
    ? `Tu envío salió. Código de seguimiento: ${claim.shipmentTrackingCode}. Seguilo acá: ${trackingUrl}`
    : `Tu envío salió. Seguilo acá: ${trackingUrl}`;

  const templateParams = [
    claim.customerName || "cliente",
    claimTypeForMessage(claim.type),
    String(claim.orderNumber),
    "enviada",
    trackingMsg,
  ];

  const result = await sendTemplate({ to: phone, params: templateParams });

  await prisma.claim.update({
    where: { id },
    data: {
      whatsappStatus: result.ok ? "sent" : "failed",
      whatsappError: result.ok ? null : (result.error || "Error desconocido"),
      whatsappSentAt: result.ok ? new Date() : null,
    },
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, trackingUrl });
}
