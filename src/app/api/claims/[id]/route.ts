import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";
import { sendTemplate, normalizePhoneAR, claimTypeForMessage } from "@/lib/whatsapp";

// PATCH: Update claim status (admin only).
// When status flips to "aprobado" or "rechazado", we also fire a WhatsApp notification
// to the customer via the Cloud API (uses a pre-approved template).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const {
    status, adminNotes, skipWhatsapp,
    customerPhone, customerName, customerEmail,
    shippingPhone, shippingAddress, shippingNumber, shippingFloor,
    shippingNeighborhood, shippingCity, shippingProvince, shippingZipcode,
    shippingRecipientName, shippingRecipientLastName,
  } = body;

  const validStatuses = ["pendiente", "aprobado", "rechazado"];
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json(
      { error: "Estado inválido. Usar: pendiente, aprobado, rechazado" },
      { status: 400 }
    );
  }

  // Read previous state to know if this is a status transition
  const previous = await prisma.claim.findUnique({ where: { id } });
  if (!previous) {
    return NextResponse.json({ error: "Reclamo no encontrado" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (status) data.status = status;
  if (adminNotes !== undefined) data.adminNotes = adminNotes;
  if (customerPhone !== undefined) data.customerPhone = customerPhone || null;
  if (customerName !== undefined) data.customerName = customerName || null;
  if (customerEmail !== undefined) data.customerEmail = customerEmail || null;
  if (shippingPhone !== undefined) data.shippingPhone = shippingPhone || null;
  if (shippingAddress !== undefined) data.shippingAddress = shippingAddress || null;
  if (shippingNumber !== undefined) data.shippingNumber = shippingNumber || null;
  if (shippingFloor !== undefined) data.shippingFloor = shippingFloor || null;
  if (shippingNeighborhood !== undefined) data.shippingNeighborhood = shippingNeighborhood || null;
  if (shippingCity !== undefined) data.shippingCity = shippingCity || null;
  if (shippingProvince !== undefined) data.shippingProvince = shippingProvince || null;
  if (shippingZipcode !== undefined) data.shippingZipcode = shippingZipcode || null;
  if (shippingRecipientName !== undefined) data.shippingRecipientName = shippingRecipientName || null;
  if (shippingRecipientLastName !== undefined) data.shippingRecipientLastName = shippingRecipientLastName || null;

  let claim = await prisma.claim.update({ where: { id }, data });

  // Trigger WhatsApp if status changed to aprobado/rechazado
  const statusChanged = status && status !== previous.status;
  const shouldNotify = statusChanged && (status === "aprobado" || status === "rechazado") && !skipWhatsapp;

  if (shouldNotify) {
    const phone = normalizePhoneAR(claim.shippingPhone || claim.customerPhone);
    if (!phone) {
      claim = await prisma.claim.update({
        where: { id },
        data: { whatsappStatus: "failed", whatsappError: "Sin teléfono válido" },
      });
    } else {
      const params = [
        claim.customerName || "cliente",                                  // {{1}} nombre
        claimTypeForMessage(claim.type),                                  // {{2}} tipo
        String(claim.orderNumber),                                        // {{3}} orden
        status === "aprobado" ? "aprobada" : "rechazada",                 // {{4}} estado
        adminNotes || "Cualquier consulta respondé este mensaje.",        // {{5}} mensaje extra
      ];
      const result = await sendTemplate({ to: phone, params });
      claim = await prisma.claim.update({
        where: { id },
        data: {
          whatsappStatus: result.ok ? "sent" : "failed",
          whatsappError: result.ok ? null : (result.error || "Error desconocido"),
          whatsappSentAt: result.ok ? new Date() : null,
        },
      });
    }
  }

  return NextResponse.json(claim);
}

// DELETE: Delete claim (admin only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.claim.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
