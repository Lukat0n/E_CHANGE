import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";
import { sendTemplate, normalizePhoneAR, claimTypeForMessage } from "@/lib/whatsapp";

// POST /api/worker/create-shipment-for-claim
// Body: { claimId: string, submit?: boolean }
//
// Toma un claim del DB, mapea sus campos al formato que espera el worker,
// y dispara la creación del envío. Si submit=false (default) hace dry run.
export async function POST(req: NextRequest) {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { claimId, submit = false } = await req.json();
  if (!claimId) {
    return NextResponse.json({ error: "Falta claimId" }, { status: 400 });
  }

  const workerUrl = process.env.WORKER_URL;
  const workerKey = process.env.WORKER_API_KEY;
  if (!workerUrl || !workerKey) {
    return NextResponse.json({ error: "WORKER_URL/WORKER_API_KEY no configuradas" }, { status: 500 });
  }

  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) {
    return NextResponse.json({ error: "Claim no encontrado" }, { status: 404 });
  }

  // Mapear claim → input del worker
  if (claim.shippingMode === "presencial") {
    return NextResponse.json(
      { error: "Los cambios presenciales no generan envío automático (se retira en depósito)." },
      { status: 400 }
    );
  }

  const mode = claim.shippingMode === "sucursal" ? "sucursal" : "domicilio";

  // Para sucursal, claim.shippingAddress guarda el NOMBRE de la sucursal elegida
  // (ej. "Sucursal Av. Corrientes 1234"). El bot lo usa para matchear el radio en
  // el step de quotation. Para domicilio es la calle real.
  const branchName = mode === "sucursal" ? (claim.shippingAddress || "") : "";

  const input = {
    mode,
    destZip: claim.shippingZipcode || "",
    alto: 10,
    ancho: 15,
    profundidad: 10,
    peso: 500, // TODO: tomar peso real del producto cuando lo tengamos
    ship: {
      provincia: claim.shippingProvince || "",
      ciudad: claim.shippingCity || "",
      calle: claim.shippingAddress || "",
      numero: claim.shippingNumber || "",
      departamento: claim.shippingFloor || undefined,
      barrio: claim.shippingNeighborhood || undefined,
    },
    recipient: {
      nombre: claim.shippingRecipientName || claim.customerName || "",
      apellido: claim.shippingRecipientLastName || "",
      email: claim.customerEmail || "",
      telefono: claim.shippingPhone || claim.customerPhone || "",
    },
    shippingMethodPreference: claim.shippingMethodName || undefined,
    branchName,
    submit,
  };

  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, "")}/api/shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": workerKey },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(240000), // 4 min: incluye crear envío + generar etiqueta
    });
    const data = await res.json();

    // Si el robot creó el envío y obtuvo tracking, lo guardamos en el claim
    // y disparamos WhatsApp automáticamente al cliente con el código.
    let whatsappSent = false;
    let whatsappError: string | null = null;
    if (data?.submitted && (data?.trackingCode || data?.postSubmitUrl)) {
      try {
        await prisma.claim.update({
          where: { id: claimId },
          data: {
            shipmentTrackingCode: data.trackingCode || null,
            shipmentTrackingUrl: data.trackingUrl || null,
            shipmentRobotUrl: data.postSubmitUrl || null,
          },
        });
      } catch (e) {
        console.error("[create-shipment-for-claim] no se pudo guardar tracking:", e);
      }

      // Mandar WhatsApp automáticamente con el tracking
      if (data?.trackingCode || data?.trackingUrl) {
        try {
          const phone = normalizePhoneAR(claim.shippingPhone || claim.customerPhone);
          if (phone) {
            const trackingUrl = data.trackingUrl || null;
            const trackingMsg = trackingUrl
              ? `Tu envío salió. Código de seguimiento: ${data.trackingCode}. Seguilo acá: ${trackingUrl}`
              : data.trackingCode
                ? `Tu envío salió. Código de seguimiento: ${data.trackingCode}. Podés rastrearlo desde la web del transportista.`
                : `Tu envío salió.`;

            const result = await sendTemplate({
              to: phone,
              params: [
                claim.customerName || "cliente",
                claimTypeForMessage(claim.type),
                String(claim.orderNumber),
                "enviada",
                trackingMsg,
              ],
            });

            whatsappSent = result.ok;
            whatsappError = result.ok ? null : (result.error || "Error desconocido");

            await prisma.claim.update({
              where: { id: claimId },
              data: {
                whatsappStatus: result.ok ? "sent" : "failed",
                whatsappError,
                whatsappSentAt: result.ok ? new Date() : null,
              },
            });

            console.log(`[create-shipment-for-claim] WhatsApp con tracking: ${result.ok ? "OK" : "FAILED"} ${whatsappError || ""}`);
          } else {
            whatsappError = "Sin teléfono válido para mandar WhatsApp";
          }
        } catch (e) {
          whatsappError = e instanceof Error ? e.message : "Error mandando WhatsApp";
          console.error("[create-shipment-for-claim] error mandando WhatsApp:", e);
        }
      }
    }

    return NextResponse.json(
      { ...data, whatsappSent, whatsappError },
      { status: res.status }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error llamando al worker" },
      { status: 502 }
    );
  }
}
