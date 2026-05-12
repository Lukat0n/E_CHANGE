import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPaymentInfo } from "@/lib/mercadopago";

// MP sends notifications in different formats. The most common shape:
//   { type: "payment", action: "payment.created" | "payment.updated", data: { id: "..." } }
// We only care about payment events; for everything else, return 200 to acknowledge.
export async function POST(req: NextRequest) {
  let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
  try {
    body = await req.json();
  } catch {
    // Some MP webhooks ship as querystring; tolerate empty body
  }

  const topic = body.type || req.nextUrl.searchParams.get("type") || req.nextUrl.searchParams.get("topic");
  const paymentId =
    body.data?.id != null
      ? String(body.data.id)
      : req.nextUrl.searchParams.get("data.id") || req.nextUrl.searchParams.get("id");

  if (topic !== "payment" || !paymentId) {
    // Not a payment notification (could be merchant_order, etc.) — ack and ignore.
    return NextResponse.json({ ok: true });
  }

  try {
    const info = await getPaymentInfo(paymentId);
    if (!info || !info.external_reference) {
      return NextResponse.json({ ok: true });
    }

    // external_reference holds our claim id
    await prisma.claim.updateMany({
      where: { id: info.external_reference },
      data: {
        paymentStatus: info.status,
        paymentId: info.id,
        paymentAmount: info.transaction_amount ?? undefined,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[mercadopago webhook] failed to process payment", paymentId, err);
    // Still return 200 so MP doesn't keep retrying. The error is in our logs.
    return NextResponse.json({ ok: true });
  }
}

// MP also probes the URL with GET sometimes when configuring webhooks.
export async function GET() {
  return NextResponse.json({ ok: true });
}
