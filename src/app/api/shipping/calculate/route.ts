import { NextRequest, NextResponse } from "next/server";
import { findStore } from "@/lib/store";
import { getStoreInfo } from "@/lib/tiendanube";
import { prisma } from "@/lib/prisma";

// El fallback al bot tarda ~15-25s (login + paso 1 + leer radios). Cuando el
// cache está caliente devuelve en <100ms. Subimos el timeout para cubrir el
// primer hit del día por CP.
export const maxDuration = 90;

interface ParsedOption {
  code: string;
  name: string;
  price: number;
  type: "delivery" | "pickup";
  branches?: string[];
}

// Parse the HTML returned by the storefront /envio/ endpoint.
// Cada opción es un <label data-shipping-type="delivery|pickup"> con un
// <input class="js-shipping-method" data-price/data-code/data-name> adentro.
// Algunos carriers (p.ej. Correo Argentino Clásico) vienen anidados dentro de
// <div class="js-other-shipping-options" style="display:none">, así que NO
// podemos confiar en los `<li>` exteriores. Iteramos directamente sobre los
// <label data-shipping-type=...> y, para pickup, buscamos las sucursales en
// el tramo que va hasta el próximo label de shipping.
function parseShippingHtml(html: string): ParsedOption[] {
  const options: ParsedOption[] = [];

  const labelRegex = /<label\b[^>]*data-shipping-type="(delivery|pickup)"[^>]*>([\s\S]*?)<\/label>/g;

  let m: RegExpExecArray | null;
  while ((m = labelRegex.exec(html)) !== null) {
    const type = m[1] as "delivery" | "pickup";
    const labelBody = m[2];

    const priceMatch = labelBody.match(/data-price="([0-9.]+)"/);
    const codeMatch = labelBody.match(/data-code="([^"]+)"/);
    const nameMatch = labelBody.match(/data-name="([^"]+)"/);

    if (!priceMatch || !codeMatch || !nameMatch) continue;

    const opt: ParsedOption = {
      code: codeMatch[1],
      name: decodeHtmlEntities(nameMatch[1]),
      price: parseFloat(priceMatch[1]),
      type,
    };

    if (type === "pickup") {
      // Las sucursales aparecen después de </label> y antes del próximo
      // <label data-shipping-type=...> (o del fin del HTML).
      const tailStart = labelRegex.lastIndex;
      const rest = html.slice(tailStart);
      const nextLabelIdx = rest.search(/<label\b[^>]*data-shipping-type=/);
      const tail = nextLabelIdx === -1 ? rest : rest.slice(0, nextLabelIdx);

      const branches: string[] = [];
      const branchRegex = /<li class="text-capitalize[^"]*"[^>]*>([^<]+)<\/li>/g;
      let b: RegExpExecArray | null;
      while ((b = branchRegex.exec(tail)) !== null) {
        branches.push(decodeHtmlEntities(b[1].trim()));
      }
      if (branches.length > 0) opt.branches = branches;
    }

    options.push(opt);
  }

  return options;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// TTL del cache de cotizaciones del bot (Envío Nube admin). Los precios cambian
// rara vez (semanas/meses), pero 24h es un buen balance entre frescura y costo.
const QUOTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Normaliza un nombre de carrier (storefront o admin) para hacer match cruzado.
// Saca el prefijo "Envío Nube - " y el sufijo " - Llega entre el...".
function carrierKey(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/^env[ií]o\s*nube\s*-\s*/i, "")
    .split(/\s*-\s*llega/i)[0]
    .trim();
}

interface AdminQuote {
  carrierKey: string;
  price: number;
}

// Lee precios cacheados (TTL 24h) o llama al worker para cotizar via el bot.
// El bot abre el admin de Envío Nube, llena CP + medidas y lee los precios del
// Paso 2 sin crear el envío. Cachea por (storeId, zipcode).
async function getAdminQuotes(storeId: string, zipcode: string): Promise<AdminQuote[]> {
  const cutoff = new Date(Date.now() - QUOTE_CACHE_TTL_MS);
  const cached = await prisma.carrierQuote.findMany({
    where: { storeId, zipcode, fetchedAt: { gt: cutoff } },
  });
  if (cached.length > 0) {
    return cached.map((c) => ({ carrierKey: c.carrierKey, price: c.price }));
  }

  const workerUrl = process.env.WORKER_URL;
  const workerKey = process.env.WORKER_API_KEY;
  if (!workerUrl || !workerKey) {
    console.warn("[calculate] WORKER_URL/WORKER_API_KEY no configuradas, skip admin quote");
    return [];
  }

  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, "")}/api/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": workerKey },
      body: JSON.stringify({ destZip: zipcode, alto: 10, ancho: 15, profundidad: 10, peso: 500 }),
      signal: AbortSignal.timeout(60000), // bot toma ~15-25s para llegar al paso 2
    });
    const data = (await res.json()) as { ok?: boolean; carriers?: Array<{ name?: string; price?: number | null }> };
    if (!data?.ok || !Array.isArray(data.carriers)) {
      console.warn("[calculate] worker /api/quote no devolvió carriers:", JSON.stringify(data).slice(0, 300));
      return [];
    }

    const quotes: AdminQuote[] = [];
    for (const c of data.carriers) {
      if (!c?.name || typeof c.price !== "number" || c.price <= 0) continue;
      quotes.push({ carrierKey: carrierKey(c.name), price: c.price });
    }

    // Persistimos en cache (upsert por unique [storeId, zipcode, carrierKey])
    await Promise.all(
      quotes.map((q) =>
        prisma.carrierQuote.upsert({
          where: { storeId_zipcode_carrierKey: { storeId, zipcode, carrierKey: q.carrierKey } },
          create: { storeId, zipcode, carrierKey: q.carrierKey, price: q.price },
          update: { price: q.price, fetchedAt: new Date() },
        })
      )
    );

    return quotes;
  } catch (err) {
    console.error("[calculate] error llamando al worker para cotizar:", err);
    return [];
  }
}

async function fetchShippingOptions(storeUrl: string, zipcode: string, variantId: number, quantity: number) {
  // Step 1: GET the homepage to establish Cloudflare session cookies
  const homeRes = await fetch(storeUrl, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  // Collect cookies from Set-Cookie headers
  const setCookieHeaders: string[] = [];
  // fetch() in Node 20+ exposes getSetCookie()
  const headers = homeRes.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    setCookieHeaders.push(...headers.getSetCookie());
  } else {
    const single = homeRes.headers.get("set-cookie");
    if (single) setCookieHeaders.push(single);
  }

  const cookieHeader = setCookieHeaders
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");

  // Step 2: POST to /envio/ with the session cookies
  const form = new URLSearchParams();
  form.set("zipcode", zipcode);
  form.set("variant_id", String(variantId));
  form.set("quantity", String(quantity));

  const envioUrl = new URL("/envio/", storeUrl).toString();
  const res = await fetch(envioUrl, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: storeUrl,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: form.toString(),
  });

  if (!res.ok) {
    throw new Error(`Shipping endpoint returned ${res.status}`);
  }

  const data = (await res.json()) as { success?: boolean; html?: string; message?: string };
  if (!data.success || !data.html) {
    throw new Error(data.message || "No shipping options returned");
  }

  return parseShippingHtml(data.html);
}

export async function POST(req: NextRequest) {
  const { storeId, zipcode, variantId, quantity, includeFree } = await req.json();

  if (!zipcode || !variantId) {
    return NextResponse.json({ error: "zipcode y variantId son requeridos" }, { status: 400 });
  }

  const store = await findStore(storeId || "default");
  if (!store) {
    return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });
  }

  // Resolve the public storefront URL (required for Cloudflare-fronted /envio/ endpoint)
  let storeUrl: string | null = null;
  const info = await getStoreInfo(store.accessToken, store.storeId);
  if (info?.url_with_protocol) storeUrl = info.url_with_protocol as string;
  else if (info?.original_domain) storeUrl = `https://${info.original_domain}`;

  if (!storeUrl) {
    return NextResponse.json({ error: "No se pudo resolver el dominio de la tienda" }, { status: 500 });
  }

  try {
    const options = await fetchShippingOptions(storeUrl, String(zipcode), Number(variantId), Number(quantity) || 1);

    // Para reenvío (includeFree=true): si algún carrier viene a $0 por promo,
    // cotizamos via el bot (Envío Nube admin) y completamos esos precios.
    // El cache de Prisma evita re-cotizar cuando ya tenemos un precio fresco (<24h).
    let enriched = false;
    let adminQuotes: AdminQuote[] = [];
    if (includeFree) {
      const zeroDeliveryCarriers = options.filter((o) => o.type === "delivery" && o.price <= 0);
      if (zeroDeliveryCarriers.length > 0) {
        adminQuotes = await getAdminQuotes(store.storeId, String(zipcode));
        for (const o of options) {
          if (o.price > 0) continue;
          const match = adminQuotes.find((q) => q.carrierKey === carrierKey(o.name));
          if (match) {
            o.price = match.price;
            enriched = true;
          }
        }
      }
    }

    // Filter out free-shipping promotions: cambios never go free, only first shipment does.
    // Para reenvío (includeFree=true) queremos ver TODOS los carriers (incluso los que
    // aparecen a $0 por promo de envío gratis). Después de enriquecer con admin quotes,
    // los que quedan a $0 son los que el bot tampoco pudo matchear → los dejamos pasar
    // y la UI los filtra si no tienen precio.
    const filtered = includeFree ? options : options.filter((o) => o.price > 0);

    const domicilio = filtered.filter((o) => o.type === "delivery");
    const sucursal = filtered.filter((o) => o.type === "pickup");

    // Debug: incluimos también la lista cruda (sin filtrar) y conteos para diagnosticar
    // por qué a veces falta algún carrier que esperaríamos ver.
    return NextResponse.json({
      domicilio,
      sucursal,
      _debug: {
        rawCount: options.length,
        rawOptions: options.map((o) => ({ name: o.name, type: o.type, price: o.price, code: o.code })),
        filteredCount: filtered.length,
        includeFree: !!includeFree,
        enriched,
        adminQuotes,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error calculando el envío";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
