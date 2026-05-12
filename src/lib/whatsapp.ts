// WhatsApp Cloud API (Meta) helper.
// Requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID env vars.
// Uses a single approved template (default name: "estado_solicitud") with 5 body vars.

const GRAPH_API = "https://graph.facebook.com/v20.0";

// Normalize Argentine numbers to E.164-without-plus (Meta expects digits only).
// Mobile numbers in AR need "549" + area code + number.
// Examples:
//   "1155667788"     → "5491155667788"
//   "011 15-5566-7788" → "5491155667788"
//   "+5491155667788"  → "5491155667788"
//   "54 11 5566 7788" → "5491155667788"
export function normalizePhoneAR(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/\D/g, "");
  if (!digits) return null;

  // Already starts with 549 → good
  if (digits.startsWith("549")) return digits;
  // Starts with 54 but missing the mobile "9" → insert it
  if (digits.startsWith("54")) return "549" + digits.slice(2);

  // Strip leading 0 (e.g. "011..." → "11...")
  digits = digits.replace(/^0/, "");
  // Strip "15" prefix that some people insert after the area code
  if (digits.length === 12 && digits.startsWith("15")) digits = digits.slice(2);

  return "549" + digits;
}

interface SendTemplateInput {
  to: string;
  templateName?: string;
  language?: string;
  params: string[];
}

interface MetaApiError {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_data?: { details?: string };
  };
}

export async function sendTemplate({
  to,
  templateName = process.env.WHATSAPP_TEMPLATE_NAME || "estado_solicitud",
  language = "es",
  params,
}: SendTemplateInput): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return { ok: false, error: "WhatsApp Cloud API no configurada (faltan env vars)" };
  }

  const url = `${GRAPH_API}/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      components: [
        {
          type: "body",
          parameters: params.map((text) => ({ type: "text", text })),
        },
      ],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as MetaApiError;
      if (json.error?.message) detail = json.error.message;
      if (json.error?.error_data?.details) detail += ` - ${json.error.error_data.details}`;
    } catch {}
    return { ok: false, error: detail };
  }

  return { ok: true };
}

// Human-friendly labels for claim types in the WhatsApp message
export function claimTypeForMessage(type: string): string {
  switch (type) {
    case "reclamo": return "reclamo";
    case "cambio": return "cambio";
    case "no_recibido": return "reclamo por no recibido";
    case "reenvio": return "reenvío";
    default: return "solicitud";
  }
}
