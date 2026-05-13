import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";

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
    submit,
  };

  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, "")}/api/shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": workerKey },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(180000), // 3 min: el flujo completo tarda ~90s
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error llamando al worker" },
      { status: 502 }
    );
  }
}
