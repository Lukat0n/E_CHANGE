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

  // Para reenvíos: el paquete original tiene que estar DEVUELTO al depósito antes
  // de aceptar el reclamo. Verificamos en dos niveles:
  //   1. Status de Tiendanube (rápido, pero puede no estar actualizado).
  //   2. Scraping de la página de tracking del carrier vía el worker (fuente real).
  // El cliente impaciente que no esperó la entrega queda bloqueado acá.
  if (type === "reenvio") {
    try {
      const originalRaw = await getOrderByNumber(store.accessToken, store.storeId, orderNumber);
      if (originalRaw) {
        const original = formatOrderInfo(originalRaw as Record<string, unknown>);
        const tdNubeStatus = (original.shippingStatus || "").toLowerCase();
        const trackingUrl = original.shippingTrackingUrl;

        // Si Tiendanube dice "delivered" → bloquear de una vez (caso claro)
        if (tdNubeStatus === "delivered") {
          return NextResponse.json(
            {
              error: "Tu pedido figura como ENTREGADO. Si no lo recibiste, contactanos por WhatsApp antes de pedir un reenvío.",
              shippingStatus: original.shippingStatus,
              trackingCode: original.shippingTracking,
              trackingUrl,
            },
            { status: 400 }
          );
        }

        // Si tenemos URL de tracking, consultamos al worker para ver el status real
        // del carrier (Correo Argentino, e-pick, Cabify, etc).
        let carrierStatus: string | null = null;
        let carrierText: string | null = null;
        const workerUrl = process.env.WORKER_URL;
        const workerKey = process.env.WORKER_API_KEY;
        if (trackingUrl && workerUrl && workerKey) {
          try {
            const r = await fetch(`${workerUrl.replace(/\/$/, "")}/api/tracking-status`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": workerKey },
              body: JSON.stringify({ url: trackingUrl }),
              signal: AbortSignal.timeout(45000),
            });
            const data = (await r.json()) as { status?: string; text?: string };
            carrierStatus = data?.status || null;
            carrierText = data?.text || null;
          } catch (err) {
            console.error("[claims POST] tracking-status worker error:", err);
          }
        }

        // Decidir: solo permitir reenvío si el carrier dice 'returned' o 'lost',
        // O si Tiendanube tiene 'returned'/'in_return'/'lost' (segundo nivel).
        const allowedTdNube = ["returned", "in_return", "lost"];
        const carrierAllows = carrierStatus === "returned" || carrierStatus === "lost";
        const tdNubeAllows = allowedTdNube.includes(tdNubeStatus);

        if (!carrierAllows && !tdNubeAllows) {
          // Construir mensaje contextual según lo que vimos
          let userMsg = "";
          if (carrierStatus === "delivered") {
            userMsg = "Tu pedido figura como ENTREGADO en el seguimiento del correo. Si no lo recibiste, contactanos antes de pedir reenvío.";
          } else if (carrierStatus === "in_transit" || tdNubeStatus === "shipped") {
            userMsg = "Tu paquete todavía está EN TRÁNSITO. Esperá a que el correo intente entregarlo o devolverlo al depósito antes de pedir reenvío.";
          } else if (tdNubeStatus === "unpacked" || tdNubeStatus === "packed") {
            userMsg = "Tu pedido todavía no fue despachado del depósito.";
          } else {
            userMsg = "Solo podemos procesar el reenvío cuando el paquete fue devuelto al depósito o declarado perdido. Si pensás que ese es tu caso pero no figura, contactanos.";
          }
          return NextResponse.json(
            {
              error: userMsg,
              shippingStatus: original.shippingStatus,
              carrierStatus,
              carrierText: carrierText?.slice(0, 300) || null,
              trackingCode: original.shippingTracking,
              trackingUrl,
            },
            { status: 400 }
          );
        }
      }
    } catch (err) {
      console.error("[claims POST] no se pudo verificar status original:", err);
      // Falla silenciosa: dejamos pasar (admin chequea antes de crear la orden)
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
