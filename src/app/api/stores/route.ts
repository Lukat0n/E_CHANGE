import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const stores = await prisma.store.findMany({
    select: { id: true, storeName: true, storeId: true },
  });
  return NextResponse.json(stores);
}
