import { NextRequest, NextResponse } from "next/server";
import { findStore } from "@/lib/store";
import { getOrderByNumber, formatOrderInfo, updateOrderAddress } from "@/lib/tiendanube";

// POST /api/orders/edit-address
// Permite al cliente actualizar la dirección de envío de su pedido SI todavía
// no fue despachado. Verifica ownership comparando con el email/teléfono de
// contacto de la orden original (mismo criterio que /api/orders/verify).
//
// Body: {
//   storeId, orderNumber, customerEmail,
//   shipping: { provincia, ciudad, calle, numero, departamento?, barrio?, codigoPostal, nombreCompleto?, telefono? }
// }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, orderNumber, customerEmail, shipping } = body;

  if (!orderNumber || !customerEmail) {
    return NextResponse.json(
      { error: "Faltan orderNumber o customerEmail" },
      { status: 400 }
    );
  }
  if (!shipping || typeof shipping !== "object") {
    return NextResponse.json({ error: "Falta el objeto shipping" }, { status: 400 });
  }

  const store = await findStore(storeId || "default");
  if (!store) {
    return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });
  }

  // 1. Fetch original order
  const orderRaw = await getOrderByNumber(store.accessToken, store.storeId, orderNumber);
  if (!orderRaw) {
    return NextResponse.json({ error: "No se encontró una orden con ese número" }, { status: 404 });
  }

  // 2. Verify ownership by email (same as /verify)
  const orderEmail = ((orderRaw.contact_email as string) || "").toLowerCase().trim();
  const inputEmail = String(customerEmail).toLowerCase().trim();
  if (!orderEmail || orderEmail !== inputEmail) {
    return NextResponse.json(
      { error: "El email no coincide con el de la orden" },
      { status: 403 }
    );
  }

  // 3. Check shipping_status — bloquear si ya se despachó
  const info = formatOrderInfo(orderRaw as Record<string, unknown>);
  const status = (info.shippingStatus || "").toLowerCase();
  if (status === "shipped" || status === "fulfilled" || status === "delivered") {
    return NextResponse.json(
      {
        error: "Tu pedido ya fue enviado. La dirección no se puede editar a esta altura. Si hay un problema con la entrega contactanos por WhatsApp.",
        shippingStatus: info.shippingStatus,
      },
      { status: 400 }
    );
  }

  // 4. Construir el address payload para Tiendanube (cubre los campos que su API espera)
  const orderId = orderRaw.id as number;
  const customerName = (orderRaw.contact_name as string) || info.customer.name || "";
  const [firstName = "", ...rest] = customerName.split(" ").filter(Boolean);
  const lastName = rest.join(" ").trim();

  const newAddress = {
    first_name: shipping.nombreCompleto?.split(" ")[0] || firstName || "",
    last_name: shipping.nombreCompleto?.split(" ").slice(1).join(" ") || lastName || "",
    address: String(shipping.calle || ""),
    number: String(shipping.numero || ""),
    floor: shipping.departamento ? String(shipping.departamento) : null,
    locality: shipping.barrio ? String(shipping.barrio) : null,
    city: String(shipping.ciudad || ""),
    province: String(shipping.provincia || ""),
    zipcode: String(shipping.codigoPostal || ""),
    country: "AR",
    phone: shipping.telefono ? String(shipping.telefono) : ((orderRaw.contact_phone as string) || ""),
  };

  // 5. Hacer el update en Tiendanube
  console.log(`[edit-address] PUT /orders/${orderId} con:`, JSON.stringify(newAddress));
  const result = await updateOrderAddress(store.accessToken, store.storeId, orderId, newAddress);
  if (!result.ok) {
    console.error(`[edit-address] updateOrderAddress falló:`, result.error);
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status || 502 }
    );
  }

  // 6. Re-fetch para verificar que Tiendanube efectivamente aplicó el cambio.
  // Algunas APIs devuelven 200 pero ignoran ciertos campos silently.
  const verifyRaw = await getOrderByNumber(store.accessToken, store.storeId, orderNumber);
  const verifyAddr = (verifyRaw?.shipping_address as Record<string, unknown> | undefined) || {};
  const persisted = {
    address: verifyAddr.address || null,
    number: verifyAddr.number || null,
    city: verifyAddr.city || null,
    province: verifyAddr.province || null,
    zipcode: verifyAddr.zipcode || null,
  };
  const matches =
    String(persisted.address || "").trim() === newAddress.address.trim() &&
    String(persisted.number || "").trim() === newAddress.number.trim() &&
    String(persisted.zipcode || "").trim() === newAddress.zipcode.trim();

  console.log(
    `[edit-address] Orden #${orderNumber} (${orderId}) put OK. ` +
    `Address en TN tras verify: ${JSON.stringify(persisted)} | match=${matches}`
  );

  if (!matches) {
    return NextResponse.json(
      {
        ok: false,
        error: "Tiendanube aceptó el pedido pero la dirección no se aplicó. Puede ser por permisos del token o porque el pedido ya está en un estado que no permite cambios.",
        attempted: newAddress,
        persisted,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Dirección actualizada correctamente.",
    newAddress,
  });
}
