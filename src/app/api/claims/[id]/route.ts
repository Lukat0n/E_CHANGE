import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";

// PATCH: Update claim status (admin only)
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
  const { status, adminNotes } = body;

  const validStatuses = ["pendiente", "aprobado", "rechazado"];
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json(
      { error: "Estado inválido. Usar: pendiente, aprobado, rechazado" },
      { status: 400 }
    );
  }

  const data: Record<string, string> = {};
  if (status) data.status = status;
  if (adminNotes !== undefined) data.adminNotes = adminNotes;

  const claim = await prisma.claim.update({
    where: { id },
    data,
  });

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
