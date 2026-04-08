import { NextRequest, NextResponse } from "next/server";
import { setAuthenticated } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (
    email === process.env.ADMIN_EMAIL &&
    password === process.env.ADMIN_PASSWORD
  ) {
    await setAuthenticated();
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
}
