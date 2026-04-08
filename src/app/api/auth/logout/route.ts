import { NextResponse } from "next/server";
import { clearAuthentication } from "@/lib/auth";

export async function POST() {
  await clearAuthentication();
  return NextResponse.json({ success: true });
}
