import { MercadoPagoConfig, Preference, Payment } from "mercadopago";

// Surcharge to absorb MP's commission. Customer-facing total = base * (1 + rate).
// 6% covers credit card (the most common payment method on MP for AR).
export const MP_SURCHARGE_RATE = 0.06;

export function withSurcharge(amount: number): number {
  return Math.round(amount * (1 + MP_SURCHARGE_RATE) * 100) / 100;
}

function getClient(): MercadoPagoConfig | null {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return null;
  return new MercadoPagoConfig({ accessToken: token, options: { timeout: 10000 } });
}

interface CreatePreferenceInput {
  claimId: string;
  title: string;
  amount: number;
  payerEmail: string | null;
  payerName: string | null;
  baseUrl: string;
}

interface PreferenceResult {
  id: string;
  init_point: string;
}

export async function createPreference(input: CreatePreferenceInput): Promise<PreferenceResult | null> {
  const client = getClient();
  if (!client) return null;

  const preference = new Preference(client);

  const body = {
    items: [
      {
        id: input.claimId,
        title: input.title,
        quantity: 1,
        unit_price: input.amount,
        currency_id: "ARS",
      },
    ],
    payer: input.payerEmail
      ? {
          email: input.payerEmail,
          name: input.payerName || undefined,
        }
      : undefined,
    external_reference: input.claimId,
    back_urls: {
      success: `${input.baseUrl}/?pago=ok&claim=${input.claimId}`,
      failure: `${input.baseUrl}/?pago=error&claim=${input.claimId}`,
      pending: `${input.baseUrl}/?pago=pendiente&claim=${input.claimId}`,
    },
    auto_return: "approved" as const,
    notification_url: `${input.baseUrl}/api/webhooks/mercadopago`,
    statement_descriptor: "GELICA",
  };

  const result = await preference.create({ body });
  if (!result.id || !result.init_point) return null;
  return { id: result.id, init_point: result.init_point };
}

interface PaymentInfo {
  id: string;
  status: string;
  external_reference: string | null;
  transaction_amount: number | null;
}

export async function getPaymentInfo(paymentId: string): Promise<PaymentInfo | null> {
  const client = getClient();
  if (!client) return null;

  const payment = new Payment(client);
  const result = await payment.get({ id: paymentId });
  if (!result.id) return null;

  return {
    id: String(result.id),
    status: result.status || "unknown",
    external_reference: result.external_reference || null,
    transaction_amount: result.transaction_amount ?? null,
  };
}
