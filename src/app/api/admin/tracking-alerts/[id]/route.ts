import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";

// PATCH: marcar una TrackingAlert como acknowledged (vista/manejada por el admin).
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const alert = await prisma.trackingAlert.update({
    where: { id },
    data: { acknowledged: true, acknowledgedAt: new Date() },
  });
  return NextResponse.json(alert);
}
