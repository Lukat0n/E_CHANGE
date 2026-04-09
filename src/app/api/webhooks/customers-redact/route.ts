import { NextResponse } from "next/server";

// Tiendanube webhook: customer data redaction request
// Called when a customer requests their data to be deleted
export async function POST() {
  // TODO: delete customer data from claims when implemented
  return NextResponse.json({ success: true });
}
