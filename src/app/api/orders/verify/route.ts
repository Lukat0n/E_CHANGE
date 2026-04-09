import { NextRequest, NextResponse } from "next/server";
import { findStore } from "@/lib/store";
import { getOrderByNumber, getStoreInfo, formatOrderInfo } from "@/lib/tiendanube";

export async function POST(req: NextRequest) {
  const { storeId, orderNumber, customerEmail } = await req.json();

  if (!orderNumber || !customerEmail) {
    return NextResponse.json(
      { error: "Ingresá el número de orden y tu email" },
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

  // Validate customer email matches
  const orderEmail = ((order.contact_email as string) || "").toLowerCase().trim();
  const inputEmail = customerEmail.toLowerCase().trim();

  if (!orderEmail || orderEmail !== inputEmail) {
    return NextResponse.json(
      { error: "El email no coincide con el de la orden" },
      { status: 403 }
    );
  }

  // Get store domain for tracking URL
  let storeDomain: string | undefined;
  const storeInfo = await getStoreInfo(store.accessToken, store.storeId);
  if (storeInfo?.url_with_protocol) {
    storeDomain = storeInfo.url_with_protocol;
  }

  const info = formatOrderInfo(order, storeDomain);
  return NextResponse.json({ order: info });
}
