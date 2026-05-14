import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";
import { findStore } from "@/lib/store";
import {
  getOrderByNumber,
  getStoreInfo,
  formatOrderInfo,
  createOrder,
  buildOrderAdminUrl,
} from "@/lib/tiendanube";

// POST /api/worker/create-shipment-for-claim
// Body: { claimId: string }
//
// Para reenvíos: crea una NUEVA orden en Tiendanube vía API copiando los
// productos del pedido original, marcada como paid (porque el cliente ya pagó
// el envío via MP) y con una nota "REENVÍO de orden #X". El merchant después
// entra al admin de Tiendanube y genera el envío desde Envío Nube como
// normalmente lo haría.
//
// Antes esto llamaba al worker (bot Playwright) para crear el envío manual,
// pero el flujo nuevo deja todo trackeado en el admin con productos visibles
// y permite manage normal.
export async function POST(req: NextRequest) {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { claimId } = await req.json();
  if (!claimId) {
    return NextResponse.json({ error: "Falta claimId" }, { status: 400 });
  }

  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) {
    return NextResponse.json({ error: "Claim no encontrado" }, { status: 404 });
  }

  if (claim.type !== "reenvio") {
    return NextResponse.json(
      { error: `Tipo ${claim.type} no soportado por API order. Solo reenvíos por ahora.` },
      { status: 400 }
    );
  }
  if (claim.shippingMode === "presencial") {
    return NextResponse.json(
      { error: "Los retiros presenciales no generan orden de reenvío." },
      { status: 400 }
    );
  }

  const store = await findStore(claim.storeId);
  if (!store) {
    return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });
  }

  // Buscar la orden original para copiar productos y addresses
  const originalRaw = await getOrderByNumber(store.accessToken, store.storeId, claim.orderNumber);
  if (!originalRaw) {
    return NextResponse.json(
      { error: `No se encontró la orden original #${claim.orderNumber}` },
      { status: 404 }
    );
  }
  const original = formatOrderInfo(originalRaw as Record<string, unknown>);

  // Productos: usamos los variant_id + quantity del original. No seteamos price,
  // así Tiendanube usa el precio default del variant (la orden refleja valores
  // reales pero NO suma a estadísticas porque es API-created).
  const products = original.products
    .filter((p) => p.variantId != null)
    .map((p) => ({
      variant_id: p.variantId as number,
      quantity: p.quantity || 1,
    }));

  if (products.length === 0) {
    return NextResponse.json(
      { error: "La orden original no tiene productos con variant_id válido" },
      { status: 400 }
    );
  }

  // Dirección de envío: si el cliente eligió custom, usamos los campos del claim.
  // Para sucursal, address va con el nombre de la sucursal (mismo formato que
  // venía guardando shippingAddress).
  const useCustomAddress =
    !!claim.shippingAddress ||
    !!claim.shippingZipcode; // si tenemos data en el claim, asumimos custom
  const shippingAddress = useCustomAddress
    ? {
        first_name: claim.shippingRecipientName || claim.customerName || "",
        last_name: claim.shippingRecipientLastName || "",
        address: claim.shippingAddress || "",
        number: claim.shippingNumber || "",
        floor: claim.shippingFloor || null,
        locality: claim.shippingNeighborhood || null,
        city: claim.shippingCity || "",
        province: claim.shippingProvince || "",
        zipcode: claim.shippingZipcode || "",
        country: "AR",
        phone: claim.shippingPhone || claim.customerPhone || "",
      }
    : undefined; // si no se setea, Tiendanube usará la de la orden... pero como
                 // estamos creando una orden nueva, mejor mandar siempre.

  const note = `REENVÍO de orden #${claim.orderNumber}${
    claim.description ? ` — ${claim.description.slice(0, 200)}` : ""
  }`;

  const customer = {
    email: claim.customerEmail || original.customer.email || "",
    name:
      (claim.shippingRecipientName ? `${claim.shippingRecipientName} ${claim.shippingRecipientLastName || ""}`.trim() : "") ||
      claim.customerName ||
      original.customer.name ||
      "",
    phone: claim.shippingPhone || claim.customerPhone || original.customer.phone || "",
  };

  // shipping_cost_owner: lo que paga el merchant al transportista. Lo guardamos
  // como referencia (el merchant podría comparar después). shipping_cost_customer:
  // 0 porque el cliente pagó via MP, no via la orden de Tiendanube.
  const shippingCostOwner = claim.shippingCost ?? null;

  // Método de envío elegido por el cliente: pasamos los campos en el formato exacto
  // que Tiendanube usa en órdenes orgánicas. Sin esto el pedido queda con "Envío:
  // No informado" y Envío Nube no auto-confirma.
  //
  // El storefront devuelve el name con sufijo " - Llega entre el lunes... y el martes..."
  // (decoración para el cliente) y a veces sin tilde en "Envio". Las órdenes orgánicas
  // guardan solo "Envío Nube - <Carrier> a <domicilio|sucursal>". Lo limpiamos para
  // que matchee con los carriers configurados de Envío Nube.
  const isPickup = claim.shippingMode === "sucursal";
  const rawName = claim.shippingMethodName || "";
  // 1. Sacar sufijo "- Llega entre..."
  // 2. Normalizar "Envio" → "Envío" (con tilde)
  const cleanOption = rawName
    .split(/\s*-\s*llega/i)[0]
    .trim()
    .replace(/^envio\s+nube/i, "Envío Nube");
  // Carrier name: lo que va después de "Envío Nube - "
  const carrierName = cleanOption.replace(/^env[ií]o\s*nube\s*-\s*/i, "").trim();

  const shippingFields: {
    shipping?: string;
    shipping_option?: string;
    shipping_option_code?: string;
    shipping_carrier_name?: string;
    shipping_pickup_type?: "ship" | "pickup";
    shipping_pickup_details?: Record<string, unknown>;
  } = {};
  if (claim.shippingMethodCode || cleanOption) {
    shippingFields.shipping = "envio_nube";
    if (claim.shippingMethodCode) shippingFields.shipping_option_code = claim.shippingMethodCode;
    if (cleanOption) shippingFields.shipping_option = cleanOption;
    if (carrierName) shippingFields.shipping_carrier_name = carrierName;
    shippingFields.shipping_pickup_type = isPickup ? "pickup" : "ship";
    // Para sucursal, claim.shippingAddress guarda el nombre de la sucursal elegida.
    if (isPickup && claim.shippingAddress) {
      shippingFields.shipping_pickup_details = { name: claim.shippingAddress };
    }
  }
  console.log("[create-reorder] shipping fields enviados:", JSON.stringify(shippingFields));

  const payload = {
    payment_status: "paid",
    products,
    customer,
    shipping_address: shippingAddress,
    billing_address: shippingAddress, // misma dirección para billing
    shipping_cost_customer: 0,
    ...(shippingCostOwner != null ? { shipping_cost_owner: shippingCostOwner } : {}),
    ...shippingFields,
    note,
  };

  // Resolver dominio para el link al admin (gelica.com.ar → gelica.mitiendanube.com)
  let storeDomain: string | null = null;
  try {
    const info = await getStoreInfo(store.accessToken, store.storeId);
    if (info?.url_with_protocol) storeDomain = info.url_with_protocol as string;
    else if (info?.original_domain) storeDomain = info.original_domain as string;
  } catch {}

  try {
    const result = await createOrder(store.accessToken, store.storeId, payload);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status || 502 }
      );
    }

    const newOrder = result.order;
    const newOrderId = newOrder.id as number;
    const newOrderNumber = String(newOrder.number ?? "");
    const adminUrl = buildOrderAdminUrl(newOrderId, storeDomain);

    await prisma.claim.update({
      where: { id: claimId },
      data: {
        reorderOrderId: newOrderId,
        reorderOrderNumber: newOrderNumber,
        reorderAdminUrl: adminUrl,
        reorderCreatedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      orderId: newOrderId,
      orderNumber: newOrderNumber,
      adminUrl,
      note: "Orden de reenvío creada. Entrá al admin de Tiendanube para generar el envío desde Envío Nube.",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error creando la orden via API" },
      { status: 502 }
    );
  }
}
