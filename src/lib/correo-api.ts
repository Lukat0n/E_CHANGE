// MiCorreo API helper (Correo Argentino).
//
// Requiere credenciales de cliente Correo Argentino + acceso habilitado al API.
// Se solicitan vía contacto comercial. Una vez obtenidas:
//   CORREO_API_BASE_URL  = ej. "https://api.correoargentino.com.ar/v1" (lo confirma Correo)
//   CORREO_API_USER      = usuario / client_id
//   CORREO_API_PASS      = password / client_secret
//
// Flow:
//   1. POST a /token (o /users/validate) con Basic Auth → recibe JWT.
//   2. Cache del token en memoria (TTL típico ~1h).
//   3. GET /shippingtracking/{code} con Authorization: Bearer <jwt>.
//
// Esta es una implementación tentativa basada en los nombres de endpoints
// que vimos en la doc pública. Cuando lleguen las credenciales + docs reales
// puede que haya que ajustar URL exactas y formato de payload/response.

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cachedToken: CachedToken | null = null;

function baseUrl(): string {
  return (process.env.CORREO_API_BASE_URL || "https://api.correoargentino.com.ar/v1").replace(/\/$/, "");
}

async function getToken(): Promise<string | null> {
  const user = process.env.CORREO_API_USER;
  const pass = process.env.CORREO_API_PASS;
  if (!user || !pass) {
    console.warn("[correo-api] CORREO_API_USER/PASS no configurados");
    return null;
  }

  // Reutilizamos token cacheado si todavía es válido (con margen de 60s)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const basic = Buffer.from(`${user}:${pass}`).toString("base64");
  // Endpoint exacto a confirmar con la doc oficial. Probable: /token o /users/validate.
  const res = await fetch(`${baseUrl()}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    console.error("[correo-api] token fetch failed", res.status, (await res.text()).slice(0, 300));
    return null;
  }

  const data = (await res.json()) as { token?: string; access_token?: string; expires_in?: number };
  const token = data.token || data.access_token;
  if (!token) return null;

  // expires_in en segundos. Default 1h si no viene.
  const ttlSec = data.expires_in || 3600;
  cachedToken = { token, expiresAt: Date.now() + ttlSec * 1000 };
  return token;
}

/**
 * Consulta el estado de seguimiento de un envío en MiCorreo.
 *
 * Devuelve:
 *   - status: "delivered" | "returned" | "in_transit" | "lost" | "unknown"
 *   - events: lista de eventos crudos (para debug y para mostrar en admin)
 *   - rawCarrierStatus: el último estado tal como lo reporta Correo
 */
export async function getCorreoTrackingStatus(trackingCode: string): Promise<{
  ok: boolean;
  status: "delivered" | "returned" | "in_transit" | "lost" | "unknown";
  events?: Array<{ date?: string; description?: string; location?: string; status?: string }>;
  rawCarrierStatus?: string;
  error?: string;
}> {
  try {
    const token = await getToken();
    if (!token) return { ok: false, status: "unknown", error: "Sin credenciales/token MiCorreo" };

    // Endpoint exacto a confirmar. La doc menciona "shippingtracking-get".
    // Asumimos: GET /shippingtracking/{code}
    const res = await fetch(`${baseUrl()}/shippingtracking/${encodeURIComponent(trackingCode)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      return { ok: false, status: "unknown", error: `MiCorreo ${res.status}: ${errText}` };
    }

    const data = (await res.json()) as {
      status?: string;
      events?: Array<{ date?: string; description?: string; location?: string; status?: string }>;
      history?: Array<{ date?: string; description?: string; location?: string; status?: string }>;
    };

    // Los nombres reales pueden variar. Cubrimos events|history.
    const events = data.events || data.history || [];
    const rawCarrierStatus = data.status || events[0]?.status || "";

    // Mapeo de strings de Correo → nuestros enums.
    // Cuando tengamos respuestas reales, ajustamos las palabras clave.
    const s = `${rawCarrierStatus} ${events.map((e) => e.description || e.status || "").join(" ")}`.toLowerCase();

    let status: "delivered" | "returned" | "in_transit" | "lost" | "unknown" = "unknown";
    if (/devuelt|en\s+devoluci|retornand|retornad|direcci[oó]n\s+insuficiente|pieza\s+en\s+rezago|domicilio\s+cerrado/i.test(s)) {
      status = "returned";
    } else if (/extraviad|perdid|lost/i.test(s)) {
      status = "lost";
    } else if (/entregad[oa]\s+al\s+destinatario|delivered/i.test(s)) {
      status = "delivered";
    } else if (/en\s+tr[áa]nsito|admitid|distribuci|despachad|en\s+poder/i.test(s)) {
      status = "in_transit";
    }

    return { ok: true, status, events, rawCarrierStatus };
  } catch (err) {
    return { ok: false, status: "unknown", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Helper para chequear si MiCorreo API está configurada en las env vars.
 * Útil para condicionar lógica si todavía no integraron credenciales.
 */
export function isCorreoApiConfigured(): boolean {
  return !!(process.env.CORREO_API_USER && process.env.CORREO_API_PASS);
}
