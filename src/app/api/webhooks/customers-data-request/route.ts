import { NextResponse } from "next/server";

// Tiendanube webhook: customer data request
// Called when a customer requests to see their stored data
export async function POST() {
  // TODO: return customer data when implemented
  return NextResponse.json({ customer: {} });
}
