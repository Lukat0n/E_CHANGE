import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getLatestTiendanubeOtp } from "./gmail.js";

// Disfraz contra detección de browser automatizado (oculta navigator.webdriver,
// fingerprints de canvas, etc.). Tiendanube nos servía un HTML vacío sin esto.
chromiumExtra.use(StealthPlugin());
const chromium = chromiumExtra;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Lanza Chromium con la config "stealth" que necesitamos para Tiendanube.
 * Devuelve { browser, context, page } — el caller hace browser.close() al final.
 */
async function launchBrowser() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 768 },
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    extraHTTPHeaders: { "Accept-Language": "es-AR,es;q=0.9,en;q=0.8" },
  });
  const page = await context.newPage();
  return { browser, context, page };
}

/**
 * Loguea al admin de Tiendanube. Lanza error si falla. Devuelve la URL final.
 *
 * @param page - Playwright page
 * @param targetUrl - URL del admin del store a la que querés llegar. Es importante
 *   pasar esto para que la cadena de redirects post-login termine seteando las
 *   cookies en el subdominio del store (gelica.mitiendanube.com). Si no se pasa,
 *   queda autenticado solo en www.tiendanube.com.
 */
async function loginToTiendanube(page, targetUrl = "https://gelica.mitiendanube.com/admin") {
  const user = process.env.TIENDANUBE_USER;
  const pass = process.env.TIENDANUBE_PASS;
  if (!user || !pass) throw new Error("Faltan TIENDANUBE_USER / TIENDANUBE_PASS");

  // Navegamos al destino. Tiendanube nos va a redirigir a la pantalla de login
  // con el parámetro login_to seteado, lo que asegura que después de loguear
  // la cadena de redirects nos lleve de vuelta y setee cookies cross-subdomain.
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);

  // Si ya estamos logueados (sesión reusada) y la URL no contiene /login, listo.
  if (!page.url().includes("/login") && !page.url().includes("/auth/")) {
    return page.url();
  }

  // Cookie banner
  for (const sel of ['button:has-text("Aceptar")', 'button:has-text("Acepto")', '[id*="cookie"] button']) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(500);
      break;
    }
  }

  // Picker: "Ingresar con e-mail"
  const emailButton = page
    .locator('button:has-text("Ingresar con e-mail"), a:has-text("Ingresar con e-mail"), [data-component*="email"]')
    .first();
  await emailButton.waitFor({ state: "visible", timeout: 10000 });
  await emailButton.click();
  await page.waitForTimeout(3000); // animación + render del form

  // Scope todo dentro de #login-form para no agarrar elementos de la otra
  // form (la del picker-remove-form, que también tiene un button[type=submit] hidden)
  const loginForm = page.locator("#login-form");

  const emailInput = loginForm
    .locator('input[name="user-mail"], input[type="email"]')
    .filter({ visible: true })
    .first();
  await emailInput.waitFor({ state: "visible", timeout: 15000 });
  await emailInput.fill(user);

  const passInput = loginForm
    .locator('input[name="pass"], input[type="password"]')
    .filter({ visible: true })
    .first();
  await passInput.waitFor({ state: "visible", timeout: 10000 });
  await passInput.fill(pass);

  // Submit: el botón puede estar fuera del #login-form. Buscamos a nivel page,
  // filtrando por texto típico de submit en español. El primero visible es el bueno.
  const submit = page
    .locator(
      'button:has-text("Iniciar sesión"), button:has-text("Ingresar"), button[type="submit"]:not([style*="display:none"])'
    )
    .filter({ visible: true })
    .first();
  await submit.waitFor({ state: "visible", timeout: 15000 });
  const nav = page.waitForURL(/.+/, { timeout: 30000 }).catch(() => null);
  await submit.click();
  await nav;
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // OTP por email (Tiendanube manda código cuando IP es nueva)
  if (page.url().includes("/auth/otp")) {
    console.log("[login] /auth/otp detectado, buscando código en Gmail...");
    let otp = null;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(3000);
      try {
        otp = await getLatestTiendanubeOtp();
        if (otp) break;
      } catch (e) {
        console.log(`[login] intento ${i + 1} Gmail falló:`, e?.message);
      }
    }
    if (!otp) throw new Error("No pude obtener el OTP de Gmail");

    const otpInputs = await page
      .locator('input[type="text"], input[inputmode="numeric"], input[type="number"], input[type="tel"]')
      .filter({ visible: true })
      .all();

    if (otpInputs.length === 6) {
      for (let i = 0; i < 6; i++) await otpInputs[i].fill(otp[i]);
    } else if (otpInputs.length >= 1) {
      await otpInputs[0].fill(otp);
    } else {
      throw new Error("No encontré inputs para tipear el OTP");
    }

    const otpSubmit = page
      .locator('button[type="submit"], button:has-text("Verificar"), button:has-text("Continuar"), button:has-text("Confirmar")')
      .filter({ visible: true })
      .first();
    const otpNav = page.waitForURL(/.+/, { timeout: 30000 }).catch(() => null);
    await otpSubmit.click().catch(() => {});
    await otpNav;
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }

  // Tiendanube hace una cadena de redirects después del login que termina poniendo
  // cookies en el subdominio del store y nos lleva al targetUrl. Esperamos a que
  // la URL deje los paths de auth.
  let waits = 0;
  while (
    (page.url().includes("/auth/token") || page.url().includes("/auth/new-admin") || page.url().includes("/login")) &&
    waits < 20
  ) {
    await page.waitForTimeout(1500);
    waits++;
  }

  if (page.url().includes("/login") || page.url().includes("/auth/otp")) {
    throw new Error(`Login no avanzó. URL final: ${page.url()}`);
  }

  return page.url();
}

/**
 * Test que solo loguea y reporta. Lo usa el admin para verificar credenciales.
 */
export async function testLogin() {
  const { browser, page } = await launchBrowser();
  try {
    const finalUrl = await loginToTiendanube(page);
    return {
      loggedIn: true,
      url: finalUrl,
      title: await page.title().catch(() => ""),
    };
  } catch (err) {
    return await debugDump(page, err?.message || String(err));
  } finally {
    await browser.close();
  }
}

/**
 * Navega a cualquier URL después de loguear y devuelve HTML snippet + screenshot.
 * Útil para inspeccionar páginas del admin que aún no automatizamos.
 */
export async function inspectUrl(url) {
  if (!url) throw new Error("Falta el parámetro 'url'");
  const { browser, page } = await launchBrowser();
  try {
    // Pasamos url como targetUrl para que el login redirija ahí automáticamente
    await loginToTiendanube(page, url);
    // Por si la cadena de redirects nos dejó en /admin y no en url exacta:
    if (!page.url().startsWith(url.split("#")[0])) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    }
    await page.waitForTimeout(5000); // dar tiempo al SPA a renderizar
    return await debugDump(page, "Inspección exitosa");
  } finally {
    await browser.close();
  }
}

/**
 * FASE 3 (en progreso): llena los campos del paso 1 del form de "Envío manual"
 * de Envío Nube. Por ahora corre en DRY RUN: llena todo pero NO aprieta Continuar.
 * Devuelve un screenshot para que el admin verifique.
 *
 * Input esperado:
 *   {
 *     mode: "domicilio" | "sucursal",
 *     destZip: "1425",
 *     alto: 10, ancho: 15, profundidad: 10, peso: 500,  // gramos
 *     valor: 15888.34,  // valor declarado / monto abonado
 *     recipient: { nombre, apellido, email, telefono }  // solo para sucursal
 *   }
 */
export async function createShipment(input) {
  const { mode, destZip, alto = 10, ancho = 15, profundidad = 10, peso, valor, recipient } = input || {};

  if (!mode || (mode !== "domicilio" && mode !== "sucursal")) {
    throw new Error("input.mode debe ser 'domicilio' o 'sucursal'");
  }
  if (mode === "domicilio" && !destZip) throw new Error("Falta destZip para envío a domicilio");
  if (mode === "sucursal" && (!recipient?.nombre || !recipient?.apellido)) {
    throw new Error("Para sucursal hace falta recipient.nombre y recipient.apellido");
  }

  const url =
    mode === "domicilio"
      ? "https://gelica.mitiendanube.com/admin/apps/envionube/ar#/create-single-shipment"
      : "https://gelica.mitiendanube.com/admin/apps/envionube/ar#/agency-shipment";

  const { browser, page } = await launchBrowser();
  try {
    await loginToTiendanube(page, url);
    if (!page.url().startsWith(url.split("#")[0])) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    }
    await page.waitForTimeout(6000); // SPA tarda en renderizar el form

    if (mode === "domicilio") {
      // Paso 1: zip + paquete
      const zipInput = page
        .locator('input[placeholder*="código postal" i], input[placeholder*="codigo postal" i]')
        .filter({ visible: true })
        .first();
      await zipInput.waitFor({ state: "visible", timeout: 15000 });
      await zipInput.fill(String(destZip));

      // Dimensiones por label "Alto", "Ancho", "Profundidad", "Peso"
      await fillByLabel(page, "Alto", String(alto));
      await fillByLabel(page, "Ancho", String(ancho));
      await fillByLabel(page, "Profundidad", String(profundidad));
      if (peso) await fillByLabel(page, "Peso", String(peso));
      if (valor) await fillByLabel(page, "Monto total abonado", String(valor));
    } else {
      // Sucursal: destinatario + paquete + valor
      if (recipient.nombre) await fillByLabel(page, "Nombre", recipient.nombre);
      if (recipient.apellido) await fillByLabel(page, "Apellido", recipient.apellido);
      if (recipient.email) await fillByLabel(page, "Email", recipient.email);
      if (recipient.telefono) await fillByLabel(page, "Teléfono", recipient.telefono);
      await fillByLabel(page, "Alto", String(alto));
      await fillByLabel(page, "Ancho", String(ancho));
      await fillByLabel(page, "Profundidad", String(profundidad));
      if (peso) await fillByLabel(page, "Peso", String(peso));
      if (valor) await fillByLabel(page, "Valor declarado", String(valor));
    }

    // DRY RUN: no apretamos Continuar. Tomamos screenshot.
    await page.waitForTimeout(1500);
    const dump = await debugDump(page, `Paso 1 llenado (DRY RUN). Modo: ${mode}.`);
    return {
      ...dump,
      dryRun: true,
      inputUsed: { mode, destZip, alto, ancho, profundidad, peso, valor, recipient },
    };
  } finally {
    await browser.close();
  }
}

/**
 * Llena un input ubicándolo por el texto de su label. Recorre los <label> y va
 * al input asociado (sea por for/id o por proximidad DOM).
 */
async function fillByLabel(page, labelText, value) {
  // Probamos el form pattern más común: label seguido o cerca del input
  const loc = page.locator(`label:has-text("${labelText}")`).first();
  const count = await loc.count();
  if (count === 0) {
    console.log(`[fillByLabel] no encontré label "${labelText}"`);
    return;
  }

  // Intentar via for/id
  const forAttr = await loc.getAttribute("for").catch(() => null);
  if (forAttr) {
    const input = page.locator(`#${cssEscape(forAttr)}`).first();
    if ((await input.count()) > 0) {
      await input.fill(value).catch(() => {});
      return;
    }
  }

  // Fallback: buscar el input dentro o cerca del label
  const nearbyInput = loc.locator("xpath=following::input[1]").first();
  if ((await nearbyInput.count()) > 0) {
    await nearbyInput.fill(value).catch(() => {});
    return;
  }

  console.log(`[fillByLabel] no encontré input para "${labelText}"`);
}

function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
}

/**
 * Devuelve info de debug del estado actual de la página.
 */
async function debugDump(page, message) {
  const url = page.url();
  const title = await page.title().catch(() => "(sin título)");

  let screenshot = null;
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 50, fullPage: false });
    screenshot = buf.toString("base64");
  } catch (e) {
    console.log("[debugDump] screenshot failed:", e?.message);
  }

  const allInputs = await page.$$eval("input", (els) =>
    els.map((el) => ({
      name: el.getAttribute("name"),
      id: el.id || null,
      type: el.type,
      value: el.value,
      visible: el.offsetParent !== null,
      placeholder: el.placeholder || null,
    }))
  ).catch(() => []);

  const bodyHtml = await page
    .evaluate(() => document.body?.innerHTML?.slice(0, 3000) || "(sin body)")
    .catch(() => "(error leyendo body)");

  const forms = await page.$$eval("form", (fs) =>
    fs.map((f) => ({ id: f.id || null, action: f.action || null, method: f.method || null }))
  ).catch(() => []);

  console.log("[debugDump]", { url, title, inputCount: allInputs.length, formCount: forms.length });

  return {
    loggedIn: !url.includes("/login") && !url.includes("/auth/otp"),
    error: message,
    url,
    title,
    forms,
    visibleInputs: allInputs,
    bodyHtmlSnippet: bodyHtml,
    screenshot,
  };
}
