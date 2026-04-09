import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";
import { findStore } from "@/lib/store";
import { getOrderByNumber, fulfillOrder } from "@/lib/tiendanube";

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
  const { status, adminNotes, createShipping } = body;

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

  // If approving a cambio claim with createShipping flag, fulfill the order in Tiendanube
  let shippingResult = null;
  if (status === "aprobado" && claim.type === "cambio" && createShipping) {
    try {
      const store = await findStore(claim.storeId);
      if (store) {
        const order = await getOrderByNumber(
          store.accessToken,
          store.storeId,
          claim.orderNumber
        );
        if (order?.id) {
          shippingResult = await fulfillOrder(
            store.accessToken,
            store.storeId,
            order.id
          );
        }
      }
    } catch (err) {
      return NextResponse.json({
        ...claim,
        shippingError: err instanceof Error ? err.message : "Error creando envío",
      });
    }
  }

  return NextResponse.json({ ...claim, shippingResult });
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
