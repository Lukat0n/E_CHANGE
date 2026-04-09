import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";
import { findStore } from "@/lib/store";
import { getOrderByNumber, createDraftOrder, confirmDraftOrder } from "@/lib/tiendanube";

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

  // If approving a cambio with createShipping, create a Draft Order in Tiendanube
  let draftOrderNumber: string | null = null;
  if (status === "aprobado" && claim.type === "cambio" && createShipping) {
    try {
      const store = await findStore(claim.storeId);
      if (!store) throw new Error("Tienda no encontrada");

      // Get original order to extract product variant_ids
      const order = await getOrderByNumber(
        store.accessToken,
        store.storeId,
        claim.orderNumber
      );
      if (!order) throw new Error("Orden original no encontrada en Tiendanube");

      const products = (order.products as Array<Record<string, unknown>>) || [];
      const draftProducts = products.map((p) => ({
        variant_id: p.variant_id as number,
        quantity: p.quantity as number,
      }));

      if (draftProducts.length === 0) {
        throw new Error("La orden no tiene productos");
      }

      // Create draft order with the cambio shipping address
      const draft = await createDraftOrder(
        store.accessToken,
        store.storeId,
        {
          products: draftProducts,
          contactName: claim.shippingRecipientName || claim.customerName || "",
          contactLastName: claim.shippingRecipientLastName || "",
          contactEmail: claim.customerEmail || "",
          contactPhone: claim.shippingPhone || claim.customerPhone || "",
          shippingAddress: claim.shippingAddress || "",
          shippingNumber: claim.shippingNumber || "",
          shippingFloor: claim.shippingFloor || "",
          shippingCity: claim.shippingCity || "",
          shippingProvince: claim.shippingProvince || "",
          shippingZipcode: claim.shippingZipcode || "",
          shippingNeighborhood: claim.shippingNeighborhood || "",
          shippingCost: 0,
        }
      );

      // Confirm the draft → creates a real order
      const confirmedOrder = await confirmDraftOrder(
        store.accessToken,
        store.storeId,
        draft.id
      );

      draftOrderNumber = String(confirmedOrder.number || draft.id);
    } catch (err) {
      return NextResponse.json({
        ...claim,
        shippingError: err instanceof Error ? err.message : "Error creando orden de cambio",
      });
    }
  }

  return NextResponse.json({ ...claim, draftOrderNumber });
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
