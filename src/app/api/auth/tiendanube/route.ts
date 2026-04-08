import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// OAuth callback from Tiendanube
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  // Exchange code for access token
  const tokenRes = await fetch("https://www.tiendanube.com/apps/authorize/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.TIENDANUBE_APP_ID,
      client_secret: process.env.TIENDANUBE_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Token exchange failed" }, { status: 500 });
  }

  const data = await tokenRes.json();
  const { access_token, user_id } = data;

  // Save or update store
  await prisma.store.upsert({
    where: { storeId: String(user_id) },
    update: { accessToken: access_token },
    create: {
      storeId: String(user_id),
      accessToken: access_token,
      storeName: `Tienda ${user_id}`,
    },
  });

  // Redirect to admin panel
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.redirect(`${appUrl}/admin?store=${user_id}`);
}
