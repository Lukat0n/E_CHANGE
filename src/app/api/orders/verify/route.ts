import { NextRequest, NextResponse } from "next/server";
import { findStore } from "@/lib/store";
import { getOrderByNumber, formatOrderInfo } from "@/lib/tiendanube";

export async function POST(req: NextRequest) {
  const { storeId, orderNumber } = await req.json();

  if (!orderNumber) {
    return NextResponse.json(
      { error: "Falta el número de orden" },
      { status: 400 }
    );
  }

  // Use provided storeId or "default" to get from env vars
  const store = await findStore(storeId || "default");
  if (!store) {
    return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });
  }

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
