import { NextRequest, NextResponse } from "next/server";
import { findStore } from "@/lib/store";
import { getStoreInfo } from "@/lib/tiendanube";

interface ParsedOption {
  code: string;
  name: string;
  price: number;
  type: "delivery" | "pickup";
  branches?: string[];
}

// Parse the HTML returned by the storefront /envio/ endpoint.
// Each shipping option is an <input class="js-shipping-method" data-price=".." data-code=".." data-name=".."> inside a <label data-shipping-type="delivery"|"pickup">.
// For pickup options, extract branch list from <li class="text-capitalize ..."> entries.
function parseShippingHtml(html: string): ParsedOption[] {
  const options: ParsedOption[] = [];

  // Match each <li class="js-shipping-list-item ..."> ... </li> block (pickup and delivery share this structure)
  const itemRegex = /<li[^>]*class="[^"]*js-shipping-list-item[^"]*"[^>]*>([\s\S]*?)<\/li>(?=\s*(?:<li|<\/ul|\s*<div[^>]*js-toggle|\s*<\/div>))/g;

  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(html)) !== null) {
    const block = m[1];

    const priceMatch = block.match(/data-price="([0-9.]+)"/);
    const codeMatch = block.match(/data-code="([^"]+)"/);
    const nameMatch = block.match(/data-name="([^"]+)"/);
    const typeMatch = block.match(/data-shipping-type="(delivery|pickup)"/);

    if (!priceMatch || !codeMatch || !nameMatch || !typeMatch) continue;

    const opt: ParsedOption = {
      code: codeMatch[1],
      name: decodeHtmlEntities(nameMatch[1]),
      price: parseFloat(priceMatch[1]),
      type: typeMatch[1] as "delivery" | "pickup",
    };

    // For pickup options, extract branch list
    if (opt.type === "pickup") {
      const branches: string[] = [];
      const branchRegex = /<li class="text-capitalize[^"]*"[^>]*>([^<]+)<\/li>/g;
      let b: RegExpExecArray | null;
      while ((b = branchRegex.exec(block)) !== null) {
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

    // Filter out free-shipping promotions: cambios never go free, only first shipment does.
    // Para reenvío (includeFree=true) queremos ver TODOS los carriers (incluso los que
    // aparecen a $0 por promo de envío gratis), porque cobramos via MP basándonos en
    // shipping_cost_owner de la orden, no en el precio storefront.
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
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error calculando el envío";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
