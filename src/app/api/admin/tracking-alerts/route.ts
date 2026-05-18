import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";
import { findStore } from "@/lib/store";

// GET: listar las TrackingAlert activas (no acknowledged) del store actual.
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const store = await findStore("default");
  if (!store) return NextResponse.json([]);

  const alerts = await prisma.trackingAlert.findMany({
    where: { storeId: store.storeId, acknowledged: false },
    orderBy: { detectedAt: "desc" },
  });

  return NextResponse.json(alerts);
}
