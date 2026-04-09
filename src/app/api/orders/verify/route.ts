import { NextRequest, NextResponse } from "next/server";
import { findStore } from "@/lib/store";
import { getOrderByNumber, formatOrderInfo } from "@/lib/tiendanube";

function normalizeStr(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export async function POST(req: NextRequest) {
  const { storeId, orderNumber, customerName } = await req.json();

  if (!orderNumber || !customerName) {
    return NextResponse.json(
      { error: "Ingresá el número de orden y tu nombre" },
      { status: 400 }
    );
  }

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

  // Validate customer name matches
  const orderCustomerName = (order.customer?.name as string) || "";
  const inputName = normalizeStr(customerName);
  const orderName = normalizeStr(orderCustomerName);

  if (!orderName || !inputName) {
    return NextResponse.json(
      { error: "No se pudo verificar el nombre del comprador" },
      { status: 400 }
    );
  }

  // Check if the input name is contained in the order name or vice versa
  const matches =
    orderName.includes(inputName) || inputName.includes(orderName);

  if (!matches) {
    return NextResponse.json(
      { error: "El nombre no coincide con el de la orden" },
      { status: 403 }
    );
  }

  const info = formatOrderInfo(order);
  return NextResponse.json({ order: info });
}
