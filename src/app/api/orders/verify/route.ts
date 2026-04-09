import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrderByNumber, formatOrderInfo } from "@/lib/tiendanube";

export async function POST(req: NextRequest) {
  const { storeId, orderNumber } = await req.json();

  if (!storeId || !orderNumber) {
    return NextResponse.json(
      { error: "Faltan storeId y orderNumber" },
      { status: 400 }
    );
  }

  // Find store
  let store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) {
    store = await prisma.store.findUnique({ where: { storeId } });
  }
  if (!store) {
    return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });
  }

  // Query Tiendanube API
  const order = await getOrderByNumber(
    store.accessToken,
    store.storeId,
    orderNumber
  );

  if (!order) {
    return NextResponse.json(
      { error: "No se encontró una orden con ese número" },
      { status: 404 }
    );
  }

  const info = formatOrderInfo(order);

  return NextResponse.json({ order: info });
}
