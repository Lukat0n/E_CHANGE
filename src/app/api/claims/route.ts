import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findStore } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";
import { createPreference } from "@/lib/mercadopago";
import { getOrderByNumber, formatOrderInfo } from "@/lib/tiendanube";
import { getCorreoTrackingStatus, isCorreoApiConfigured } from "@/lib/correo-api";

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

  // Para reenvíos: filtramos casos donde claramente no corresponde reenvío.
  // Reglas (definidas por el merchant):
  //   - shipping_status in {unpacked, packed}        → NO (todavía no salió)
  //   - shipping_status == delivered                 → NO (ya lo recibió)
  //   - shipping_status == shipped:
  //     • Correo Argentino: esperar shipping_max_days + 4 días (puede estar en sucursal)
  //     • Cabify / e-pick / otros: esperar shipping_max_days exacto
  //     • Si todavía no pasó el plazo → bloquear con mensaje contextual
  //     • Si pasó → permitir (admin aprueba)
  //   - shipping_status in {returned, in_return, lost} → permitir (admin aprueba)
  //   - Otros → permitir (admin aprueba por las dudas)
  //
  // Además, si la PAQ.AR API de Correo está configurada y es un envío Correo,
  // usamos su status real (más confiable que Tiendanube): si dice delivered →
  // bloquear; si dice returned/lost → permitir.
  if (type === "reenvio") {
    try {
      const originalRaw = await getOrderByNumber(store.accessToken, store.storeId, orderNumber);
      if (originalRaw) {
        const original = formatOrderInfo(originalRaw as Record<string, unknown>);
        const tdStatus = (original.shippingStatus || "").toLowerCase();
        const trackingUrl = original.shippingTrackingUrl;
        const trackingCode = original.shippingTracking;
        const shippedAtRaw = (originalRaw as Record<string, unknown>).shipped_at as string | null | undefined;
        const shippingMaxDays = (originalRaw as Record<string, unknown>).shipping_max_days as number | null | undefined;
        const optName = (original.shippingOptionName || "").toLowerCase();
        const urlLower = (trackingUrl || "").toLowerCase();

        // Detección de carrier (por nombre o URL de tracking)
        let carrierType: "correo" | "epick" | "cabify" | "andreani" | "other" = "other";
        if (optName.includes("correo argentino") || urlLower.includes("correoargentino")) carrierType = "correo";
        else if (optName.includes("e-pick") || optName.includes("entrega rápida") || urlLower.includes("e-pick")) carrierType = "epick";
        else if (optName.includes("cabify") || urlLower.includes("cabify")) carrierType = "cabify";
        else if (optName.includes("andreani") || urlLower.includes("andreani")) carrierType = "andreani";

        // ───── Bloqueos por estado de Tiendanube ─────
        if (tdStatus === "unpacked" || tdStatus === "packed") {
          return NextResponse.json(
            {
              error: "Tu pedido todavía no fue despachado. Esperá a que salga del depósito antes de pedir reenvío.",
              shippingStatus: original.shippingStatus,
              trackingCode,
              trackingUrl,
            },
            { status: 400 }
          );
        }
        if (tdStatus === "delivered") {
          return NextResponse.json(
            {
              error: "Tu pedido figura como ENTREGADO. Si no lo recibiste, contactanos por WhatsApp antes de pedir un reenvío.",
              shippingStatus: original.shippingStatus,
              trackingCode,
              trackingUrl,
            },
            { status: 400 }
          );
        }

        // ───── PAQ.AR API de Correo: chequeo prioritario si está configurada ─────
        let skipTimeGate = false;
        if (carrierType === "correo" && isCorreoApiConfigured() && trackingCode) {
          try {
            const result = await getCorreoTrackingStatus(trackingCode);
            if (result.ok) {
              console.log(
                `[claims POST reenvio] PAQ.AR API: status=${result.status} matched="${result.matched || ""}" raw="${result.rawCarrierStatus || ""}"`
              );
              if (result.status === "delivered") {
                return NextResponse.json(
                  {
                    error: "Tu pedido figura como ENTREGADO en el seguimiento del correo. Si no lo recibiste, contactanos antes de pedir reenvío.",
                    shippingStatus: original.shippingStatus,
                    carrierStatus: result.status,
                    trackingCode,
                    trackingUrl,
                  },
                  { status: 400 }
                );
              }
              if (result.status === "returned" || result.status === "lost") {
                // El carrier confirma devolución/pérdida → permitir directo (sin time gate)
                console.log("[claims POST reenvio] Correo API confirma returned/lost, saltando time gate");
                skipTimeGate = true;
              }
              // Si es in_transit/unknown, seguimos al time gate de abajo
            }
          } catch (err) {
            console.error("[claims POST] PAQ.AR API error:", err);
          }
        }

        // ───── Time gate: aplicamos para CUALQUIER status que no sea bloqueo inmediato ─────
        // Sin PAQ.AR API, no confiamos en statuses tipo "returned" de Tiendanube. El
        // único criterio para permitir es: ¿pasó el plazo desde que se despachó?
        //
        // Para Correo Argentino tenemos DOS plazos:
        //   normal   = shipped_at + max_days   (durante este tiempo: "todavía dentro del plazo")
        //   extendido = normal + 4 días        (durante esta ventana: "probablemente esté en sucursal")
        // Recién pasado el extendido permitimos pedir reenvío (lo que después aprueba el admin).
        //
        // Para Cabify / e-pick / otros no hay buffer: solo el plazo normal.
        if (!skipTimeGate) {
          if (shippedAtRaw && shippingMaxDays != null && shippingMaxDays > 0) {
            const shippedAt = new Date(shippedAtRaw);
            const normalLimit = new Date(shippedAt);
            normalLimit.setDate(normalLimit.getDate() + shippingMaxDays);
            const buffer = carrierType === "correo" ? 4 : 0;
            const extendedLimit = new Date(shippedAt);
            extendedLimit.setDate(extendedLimit.getDate() + shippingMaxDays + buffer);
            const now = new Date();
            const fmt = (d: Date) =>
              d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

            if (now < extendedLimit) {
              let userMsg: string;
              if (now < normalLimit) {
                // Dentro del plazo normal de entrega
                userMsg = `Tu pedido todavía está dentro del plazo de entrega (hasta el ${fmt(normalLimit)}). Esperá a esa fecha antes de pedir un reenvío.`;
              } else {
                // Pasó el plazo normal pero estamos en los +4 días extra de Correo
                userMsg = `Tu plazo de entrega ya terminó, pero probablemente el paquete esté esperando en la sucursal de correo más cercana. Volvé a pedir reenvío después del ${fmt(extendedLimit)}.`;
              }
              return NextResponse.json(
                {
                  error: userMsg,
                  shippingStatus: original.shippingStatus,
                  carrier: carrierType,
                  normalLimit: normalLimit.toISOString(),
                  extendedLimit: extendedLimit.toISOString(),
                  trackingCode,
                  trackingUrl,
                },
                { status: 400 }
              );
            }
            // Pasó el plazo extendido → permitir (admin aprueba)
            console.log(
              `[claims POST reenvio] plazo vencido (${carrierType}, normal ${shippingMaxDays}d + buffer ${buffer}d desde ${shippedAtRaw}), permitiendo`
            );
          } else {
            // Sin shipped_at/max_days no podemos computar. Dejamos pasar al admin.
            console.log("[claims POST reenvio] sin shipped_at/max_days, permitiendo (admin aprueba)");
          }
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
