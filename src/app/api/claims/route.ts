import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";

// GET: List claims (admin) or by store
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

  const claims = await prisma.claim.findMany({
    where,
    include: { store: { select: { storeName: true, storeId: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(claims);
}

// POST: Create a new claim (public - from customer form)
export async function POST(req: NextRequest) {
  const body = await req.json();

  const { storeId, orderNumber, type, description, photoUrl, customerName, customerEmail, customerPhone } = body;

  if (!storeId || !orderNumber || !type) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: storeId, orderNumber, type" },
      { status: 400 }
    );
  }

  // Validate type
  const validTypes = ["reclamo", "cambio", "no_recibido"];
  if (!validTypes.includes(type)) {
    return NextResponse.json(
      { error: "Tipo inválido. Usar: reclamo, cambio, no_recibido" },
      { status: 400 }
    );
  }

  // Find the store
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) {
    return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });
  }

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
    },
  });

  return NextResponse.json(claim, { status: 201 });
}
