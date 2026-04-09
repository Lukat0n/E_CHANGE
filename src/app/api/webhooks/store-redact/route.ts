import { NextResponse } from "next/server";

// Tiendanube webhook: store data redaction request
// Called when a store uninstalls the app and requests data deletion
export async function POST() {
  // TODO: delete store data from database when implemented
  return NextResponse.json({ success: true });
}
