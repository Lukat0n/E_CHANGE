import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findStore } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";
import { createPreference } from "@/lib/mercadopago";
import { getOrderByNumber, formatOrderInfo } from "@/lib/tiendanube";

// GET: List claims (admin)
export async function GET(req: NextRequest) {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const storeId = req.nextUrl.searchParams.get("storeId");
  const status = req.nextUrl.searchParams.get("status");
  const type = req.nextUrl.searchParams.get("type");

  const where: Record<string, unknown> = {};
  if (storeId) where.storeId = storeId;
  if (status) where.status = status;
  if (type) where.type = type;

  try {
    const claims = await prisma.claim.findMany({
      where,
      include: { store: { select: { storeName: true, storeId: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(claims);
  } catch (err) {
    console.error("[claims GET] DB read failed:", err);
    return NextResponse.json([]);
  }
}

// POST: Create a new claim (public - from customer form)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    storeId, orderNumber, type, description, photoUrl,
    customerName, customerEmail, customerPhone,
    shippingAddress, shippingNumber, shippingFloor, shippingNeighborhood,
    shippingCity, shippingProvince, shippingZipcode, shippingPhone,
    shippingRecipientName, shippingRecipientLastName,
    shippingMode, shippingMethodCode, shippingMethodName, shippingCost,
  } = body;

  if (!orderNumber || !type) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: orderNumber, type" },
      { status: 400 }
    );
  }

  const validTypes = ["reclamo", "cambio", "no_recibido", "reenvio"];
  if (!validTypes.includes(type)) {
    return NextResponse.json(
      { error: "Tipo inválido. Usar: reclamo, cambio, no_recibido, reenvio" },
      { status: 400 }
    );
  }

  // Find store
  const store = await findStore(storeId || "default");
  if (!store) {
    return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });
  }

  // Para reenvíos: el paquete original tiene que figurar como DEVUELTO o PERDIDO
  // antes de aceptar el pedido. Esto evita que un cliente impaciente pida reenvío
  // cuando su paquete todavía está en tránsito (terminaría recibiendo 2 envíos).
  // El admin igual puede crear órdenes manuales desde el dashboard si hay un caso
  // especial verificado.
  if (type === "reenvio") {
    try {
      const originalRaw = await getOrderByNumber(store.accessToken, store.storeId, orderNumber);
      if (originalRaw) {
        const original = formatOrderInfo(originalRaw as Record<string, unknown>);
        const status = (original.shippingStatus || "").toLowerCase();
        const allowedForReenvio = ["returned", "in_return", "lost"];
        if (!allowedForReenvio.includes(status)) {
          let userMsg = "";
          if (status === "delivered") {
            userMsg = "Tu pedido figura como ENTREGADO. Si no lo recibiste, contactá directamente a la tienda.";
          } else if (status === "shipped" || status === "in_transit") {
            userMsg = "Tu pedido todavía está en tránsito. Tenés que esperar a que el correo intente entregarlo. Solo podés pedir reenvío si el paquete vuelve al depósito.";
          } else if (status === "unpacked" || status === "packed") {
            userMsg = "Tu pedido todavía no fue despachado. Esperá a que salga del depósito.";
          } else {
            userMsg = `Solo podés pedir reenvío si el paquete fue devuelto al depósito o declarado perdido. Estado actual: ${original.shippingStatus || "desconocido"}.`;
          }
          return NextResponse.json(
            {
              error: userMsg,
              shippingStatus: original.shippingStatus,
              trackingCode: original.shippingTracking,
              trackingUrl: original.shippingTrackingUrl,
            },
            { status: 400 }
          );
        }
      }
    } catch (err) {
      // Si falla la consulta a Tiendanube, NO bloqueamos al cliente — log y seguimos.
      // El admin igual chequea de nuevo antes de crear la orden de reenvío.
      console.error("[claims POST] no se pudo verificar status original:", err);
    }
  }

  try {
    // Try saving to DB
    const claim = await prisma.claim.create({
      data: {
        storeId: store.id,
        orderNumber,
        type,
        description: description || "",
        photoUrl: photoUrl || null,
        customerName: customerName || null,
        customerEmail: customerEmail || null,
        customerPhone: customerPhone || null,
        shippingAddress: shippingAddress || null,
        shippingNumber: shippingNumber || null,
        shippingFloor: shippingFloor || null,
        shippingNeighborhood: shippingNeighborhood || null,
        shippingCity: shippingCity || null,
        shippingProvince: shippingProvince || null,
        shippingZipcode: shippingZipcode || null,
        shippingPhone: shippingPhone || null,
        shippingRecipientName: shippingRecipientName || null,
        shippingRecipientLastName: shippingRecipientLastName || null,
        shippingMode: shippingMode || null,
        shippingMethodCode: shippingMethodCode || null,
        shippingMethodName: shippingMethodName || null,
        shippingCost: typeof shippingCost === "number" ? shippingCost : null,
      },
    });

    // Create MP payment preference for cambio (non-presencial) and reenvio
    const needsPayment =
      (type === "cambio" && shippingMode !== "presencial" && typeof shippingCost === "number" && shippingCost > 0) ||
      (type === "reenvio" && typeof shippingCost === "number" && shippingCost > 0);

    if (needsPayment) {
      try {
        const baseUrl = req.nextUrl.origin;
        const title =
          type === "cambio" ? `Cambio - Orden #${orderNumber}` : `Reenvío - Orden #${orderNumber}`;
        const pref = await createPreference({
          claimId: claim.id,
          title,
          amount: shippingCost as number,
          payerEmail: customerEmail || null,
          payerName: customerName || null,
          baseUrl,
        });
        if (pref) {
          const updated = await prisma.claim.update({
            where: { id: claim.id },
            data: {
              paymentStatus: "pending",
              paymentAmount: shippingCost as number,
              mpPreferenceId: pref.id,
              mpInitPoint: pref.init_point,
            },
          });
          return NextResponse.json(updated, { status: 201 });
        }
      } catch (err) {
        console.error("[claims POST] MP preference creation failed:", err);
        // Continue with claim already created (admin can handle payment manually)
      }
    }

    return NextResponse.json(claim, { status: 201 });
  } catch (err) {
    // Log the real error so it shows up in Vercel logs.
    // Don't silently fake a success — that hides bugs and the customer thinks the claim went through.
    console.error("[claims POST] DB write failed:", err);
    const message = err instanceof Error ? err.message : "Error guardando el reclamo";
    return NextResponse.json(
      { error: `No se pudo guardar el reclamo: ${message}` },
      { status: 500 }
    );
  }
}
