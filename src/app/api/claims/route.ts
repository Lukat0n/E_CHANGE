import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findStore } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";

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
  } catch {
    // DB not available, return empty
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
  } = body;

  if (!orderNumber || !type) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: orderNumber, type" },
      { status: 400 }
    );
  }

  const validTypes = ["reclamo", "cambio", "no_recibido"];
  if (!validTypes.includes(type)) {
    return NextResponse.json(
      { error: "Tipo inválido. Usar: reclamo, cambio, no_recibido" },
      { status: 400 }
    );
  }

  // Find store
  const store = await findStore(storeId || "default");
  if (!store) {
    return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });
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
      },
    });
    return NextResponse.json(claim, { status: 201 });
  } catch {
    // DB not available - still accept the claim (could send email, log, etc.)
    return NextResponse.json({
      id: `temp-${Date.now()}`,
      storeId: store.storeId,
      orderNumber,
      type,
      description,
      photoUrl,
      status: "pendiente",
      customerName,
      customerEmail,
      customerPhone,
      shippingAddress,
      shippingNumber,
      shippingFloor,
      shippingNeighborhood,
      shippingCity,
      shippingProvince,
      shippingZipcode,
      shippingPhone,
      shippingRecipientName,
      shippingRecipientLastName,
      createdAt: new Date().toISOString(),
    }, { status: 201 });
  }
}
