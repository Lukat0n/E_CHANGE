// API PAQ.AR de Correo Argentino (v1).
//
// Doc oficial: Abril 2023 - https://www.correoargentino.com.ar (PDF cliente).
//
// Auth: dos headers simples (sin OAuth/JWT):
//   - "authorization": "Apikey <API_KEY>"
//   - "agreement": "<AGREEMENT_ID>" (ej. "18017")
//
// URLs:
//   - Producción: https://api.correoargentino.com.ar/paqar/v1
//   - Test:       https://apitest.correoargentino.com.ar/paqar/v1
//
// Endpoint que nos importa para reenvíos:
//   GET /v1/tracking  → consultar historial de envíos.
//
// Env vars en Vercel:
//   CORREO_API_KEY        (la API-Key que te entrega Correo)
//   CORREO_AGREEMENT      (id de acuerdo comercial, ej "18017")
//   CORREO_API_BASE_URL   (opcional; default = producción)

const PROD_URL = "https://api.correoargentino.com.ar/paqar/v1";

function baseUrl(): string {
  return (process.env.CORREO_API_BASE_URL || PROD_URL).replace(/\/$/, "");
}

function buildHeaders(): Record<string, string> | null {
  const apiKey = process.env.CORREO_API_KEY;
  const agreement = process.env.CORREO_AGREEMENT;
  if (!apiKey || !agreement) return null;
  return {
    authorization: `Apikey ${apiKey}`,
    agreement,
    "Content-Type": "application/json",
  };
}

export function isCorreoApiConfigured(): boolean {
  return !!(process.env.CORREO_API_KEY && process.env.CORREO_AGREEMENT);
}

// statusId codes de Correo (Paq.AR). De la doc vimos:
//   PRE = preimposicion (no salió aún)
//   CAN = en proceso de cancelación
//   CAU = caduco (expirado → suele preceder devolución)
// El resto los inferimos por las palabras del campo `status`. Cuando veamos
// respuestas reales podemos sumar codes específicos (DEV, ENT, EXT, etc.).
interface CorreoEvent {
  facilityCode?: string;
  facility?: string;
  statusId?: string;
  status?: string;
  date?: string;
  sign?: string;
}

interface CorreoTrackingResponse {
  id?: string | null;
  quantity?: number;
  countryId?: string | null;
  serviceType?: string | null;
  trackingNumber?: string;
  event?: CorreoEvent[];
}

function classifyStatus(events: CorreoEvent[]): {
  status: "delivered" | "returned" | "in_transit" | "lost" | "unknown";
  matched: string | null;
} {
  // Buscamos en TODOS los eventos para que un "RETORNANDO" intermedio gane
  // sobre un "ENTREGADO" final (que muchas veces significa entregado al CDD
  // del merchant, no al destinatario).
  const joined = events
    .map((e) => `${e.statusId || ""} ${e.status || ""} ${e.facility || ""}`)
    .join(" ")
    .toLowerCase();

  if (/retornand|en\s+devoluci|devuelt[oa]\s+(al?\s*)?(remitente|origen)|direcci[oó]n\s+insuficiente|pieza\s+en\s+rezago|domicilio\s+cerrado|rechazad[oa]\s+por\s+el\s+destinatario|cad[uú]c/i.test(joined)) {
    const m = joined.match(/retornand|devoluci|devuelt|insuficiente|rezago|cerrado|rechazad|cad[uú]c/i);
    return { status: "returned", matched: m?.[0] || "returned-pattern" };
  }
  if (/extraviad|perdid|extrav[ií]o|lost/i.test(joined)) {
    const m = joined.match(/extrav|perdid|lost/i);
    return { status: "lost", matched: m?.[0] || "lost-pattern" };
  }
  if (/entregad[oa]\s+al\s+destinatario|delivered/i.test(joined)) {
    return { status: "delivered", matched: "entregado al destinatario" };
  }
  if (/en\s+tr[áa]nsito|admitid|distribuci|despachad|en\s+poder|in\s+transit/i.test(joined)) {
    return { status: "in_transit", matched: "in-transit-pattern" };
  }
  return { status: "unknown", matched: null };
}

/**
 * Consulta el historial de tracking de uno o varios envíos.
 *
 * GET /v1/tracking con body JSON (sí, GET con body — así lo define la API).
 */
export async function getCorreoTrackingStatus(trackingCode: string): Promise<{
  ok: boolean;
  status: "delivered" | "returned" | "in_transit" | "lost" | "unknown";
  events?: CorreoEvent[];
  matched?: string | null;
  rawCarrierStatus?: string;
  error?: string;
}> {
  const headers = buildHeaders();
  if (!headers) return { ok: false, status: "unknown", error: "Sin CORREO_API_KEY/AGREEMENT" };

  try {
    const res = await fetch(`${baseUrl()}/tracking`, {
      method: "GET",
      headers,
      body: JSON.stringify([{ trackingNumber: trackingCode }]),
    });

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      return { ok: false, status: "unknown", error: `Correo API ${res.status}: ${errText}` };
    }

    const data = (await res.json()) as CorreoTrackingResponse[] | CorreoTrackingResponse;
    const entries = Array.isArray(data) ? data : [data];
    const entry = entries.find((e) => e.trackingNumber === trackingCode) || entries[0];
    if (!entry || !entry.event || entry.event.length === 0) {
      return { ok: true, status: "unknown", events: entry?.event || [], rawCarrierStatus: "Sin eventos" };
    }

    const { status, matched } = classifyStatus(entry.event);
    return {
      ok: true,
      status,
      events: entry.event,
      matched,
      rawCarrierStatus: entry.event[0]?.status || "",
    };
  } catch (err) {
    return { ok: false, status: "unknown", error: err instanceof Error ? err.message : String(err) };
  }
}
