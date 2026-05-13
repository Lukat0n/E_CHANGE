import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getLatestTiendanubeOtp } from "./gmail.js";
import zlib from "zlib";

// Disfraz contra detección de browser automatizado (oculta navigator.webdriver,
// fingerprints de canvas, etc.). Tiendanube nos servía un HTML vacío sin esto.
chromiumExtra.use(StealthPlugin());
const chromium = chromiumExtra;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Lanza Chromium con la config "stealth" que necesitamos para Tiendanube.
 * Si SESSION_STATE_B64 está seteada (bootstrap manual), carga la sesión guardada
 * para saltarse el login automatizado (que pelea con el anti-bot).
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

  const contextOptions = {
    userAgent: UA,
    viewport: { width: 1366, height: 768 },
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    extraHTTPHeaders: { "Accept-Language": "es-AR,es;q=0.9,en;q=0.8" },
  };

  const sessionB64 = process.env.SESSION_STATE_B64;
  if (sessionB64) {
    try {
      const buf = Buffer.from(sessionB64, "base64");
      // Probamos primero gzipped (formato nuevo del bootstrap). Si falla, plain base64.
      let json;
      try {
        json = zlib.gunzipSync(buf).toString("utf-8");
      } catch {
        json = buf.toString("utf-8");
      }
      contextOptions.storageState = JSON.parse(json);
      console.log("[browser] sesión persistente cargada (cookies:",
        contextOptions.storageState?.cookies?.length || 0, ")");
    } catch (err) {
      console.error("[browser] error parseando SESSION_STATE_B64:", err?.message);
    }
  }

  const context = await browser.newContext(contextOptions);
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
  // Si tenemos sesión persistente (Plan B), saltamos el login automatizado
  // y solo verificamos que la sesión sigue válida.
  if (process.env.SESSION_STATE_B64) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000); // dar tiempo al SPA a inicializar

    const finalUrl = page.url();
    if (finalUrl.includes("/login") || finalUrl.includes("/auth/otp")) {
      throw new Error(
        "Sesión persistente expirada o inválida. Corré 'node bootstrap.js' localmente y actualizá SESSION_STATE_B64 en Railway."
      );
    }
    if (!finalUrl.includes("mitiendanube.com")) {
      throw new Error(`Sesión llevó a URL inesperada: ${finalUrl}`);
    }
    return finalUrl;
  }

  // Si NO hay sesión persistente, fallback al login automatizado (puede pelear con anti-bot)
  const user = process.env.TIENDANUBE_USER;
  const pass = process.env.TIENDANUBE_PASS;
  if (!user || !pass) {
    throw new Error(
      "No hay sesión persistente (SESSION_STATE_B64) ni credenciales (TIENDANUBE_USER/PASS). Corré bootstrap.js."
    );
  }

  // Loguear todos los cambios de URL para debug
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      console.log("[nav]", frame.url());
    }
  });

  // Navegamos al destino. Tiendanube nos va a redirigir a la pantalla de login
  // con el parámetro login_to seteado.
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);

  // Si ya estamos logueados (sesión reusada) y la URL no contiene /login, listo.
  if (!page.url().includes("/login") && !page.url().includes("/auth/")) {
    return page.url();
  }

  // Capturamos el login_to de la URL actual. Esto es la cadena que después del
  // login tenemos que visitar para que se seteen las cookies en el subdominio
  // de la tienda.
  const loginToMatch = page.url().match(/[?&]login_to=([^&]+)/);
  const loginToUrl = loginToMatch ? decodeURIComponent(loginToMatch[1]) : null;
  console.log("[login] login_to capturado:", loginToUrl || "(ninguno)");

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

  // Esperamos hasta 60s a que la cadena natural de redirects nos lleve al subdominio
  // mitiendanube.com. La página /auth/token tiene JS que hace POST/redirect al store
  // subdomain con un token de un solo uso. Damos tiempo a que se ejecute.
  let waits = 0;
  while (!page.url().includes("mitiendanube.com") && waits < 40) {
    await page.waitForTimeout(1500);
    waits++;
    if (waits % 5 === 0) console.log(`[login] esperando redirect, URL actual: ${page.url()}`);
  }

  // Si después de 60s seguimos en www.tiendanube.com, capturamos info detallada
  if (!page.url().includes("mitiendanube.com")) {
    const stuckUrl = page.url();
    console.log("[login] STUCK at:", stuckUrl);

    const cookies = await page.context().cookies().catch(() => []);
    const cookieSummary = cookies.map((c) => `${c.domain}${c.path}: ${c.name}`).join("\n  ");
    console.log(`[login] COOKIES (${cookies.length}):\n  ${cookieSummary || "(none)"}`);

    const inspect = await page.evaluate(() => ({
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 1500),
      forms: Array.from(document.forms).map((f) => ({ action: f.action, method: f.method })),
      metaRefresh: document.querySelector('meta[http-equiv="refresh"]')?.getAttribute("content"),
      // Buscar links/scripts que contengan "mitiendanube" o "redirect"
      mtuMentions: document.documentElement.outerHTML.match(/mitiendanube[^"'\s]*/g)?.slice(0, 5),
      authMentions: document.documentElement.outerHTML.match(/auth\/new-admin[^"'\s]*/g)?.slice(0, 5),
    })).catch((e) => ({ error: e?.message }));
    console.log("[login] PAGE INSPECT:", JSON.stringify(inspect, null, 2));

    // Intento manual: si hay una redirección encolada en el HTML, intentar
    // dispararla via window.location desde dentro del page
    if (inspect.metaRefresh) {
      console.log("[login] meta-refresh detectado:", inspect.metaRefresh);
    }
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
    // El SPA tarda en hidratar e ir renderizando inputs
    await page.waitForTimeout(8000);

    // Enumerar TODOS los inputs (light DOM + shadow DOM recursivo + iframes)
    const inputsInfo = await findAllInputs(page);
    console.log(`[createShipment] inputs encontrados (light + shadow + iframes): ${inputsInfo.length}`);
    console.log(JSON.stringify(inputsInfo, null, 2));

    const filled = {};

    if (mode === "domicilio") {
      filled.codigoPostal = await fillByPlaceholder(page, /c[oó]digo postal/i, String(destZip));

      // Alto/Ancho/Profundidad: 3 inputs con placeholder "30" en ese orden — llenamos via evaluate
      const dimResult = await fillNthByPlaceholderShadow(page, "30", [String(alto), String(ancho), String(profundidad)]);
      filled.alto = { found: dimResult.filled >= 1, value: alto };
      filled.ancho = { found: dimResult.filled >= 2, value: ancho };
      filled.profundidad = { found: dimResult.filled >= 3, value: profundidad };

      if (peso) filled.peso = await fillByPlaceholder(page, /^peso$/i, String(peso));
      if (valor) filled.valor = await fillByPlaceholder(page, /^\$$/, String(valor));
    } else {
      // Para sucursal, los labels son Nombre/Apellido/Email/Teléfono
      if (recipient.nombre) filled.nombre = await fillByLabelOrPlaceholder(page, /nombre/i, recipient.nombre);
      if (recipient.apellido) filled.apellido = await fillByLabelOrPlaceholder(page, /apellido/i, recipient.apellido);
      if (recipient.email) filled.email = await fillByLabelOrPlaceholder(page, /email/i, recipient.email);
      if (recipient.telefono) filled.telefono = await fillByLabelOrPlaceholder(page, /tel[eé]fono/i, recipient.telefono);

      const dimResult2 = await fillNthByPlaceholderShadow(page, "30", [String(alto), String(ancho), String(profundidad)]);
      filled.alto = filled.ancho = filled.profundidad = { found: dimResult2.filled >= 3 };

      if (peso) filled.peso = await fillByPlaceholder(page, /^peso$/i, String(peso));
      if (valor) filled.valor = await fillByPlaceholder(page, /valor declarado|^\$$/i, String(valor));
    }

    // DRY RUN: no apretamos Continuar. Tomamos screenshot del estado actual.
    await page.waitForTimeout(2000);
    const dump = await debugDump(page, `Paso 1 llenado (DRY RUN). Modo: ${mode}.`);
    return {
      ...dump,
      dryRun: true,
      filled,
      inputUsed: { mode, destZip, alto, ancho, profundidad, peso, valor, recipient },
    };
  } finally {
    await browser.close();
  }
}

/**
 * Encuentra TODOS los inputs en la página, incluyendo dentro de shadow DOM y
 * iframes. Cada elemento incluye una "ruta" (path de selectores con shadow
 * piercing) para poder ubicarlo después.
 */
async function findAllInputs(page) {
  // En el documento principal: walk recursivo
  const mainInputs = await page.evaluate(() => {
    const found = [];
    function walk(root, pathPrefix) {
      try {
        const inputs = root.querySelectorAll
          ? root.querySelectorAll("input, textarea, [contenteditable='true']")
          : [];
        for (const el of inputs) {
          found.push({
            tag: el.tagName.toLowerCase(),
            placeholder: el.placeholder || el.getAttribute?.("placeholder") || null,
            name: el.name || el.getAttribute?.("name") || null,
            type: el.type || el.getAttribute?.("type") || null,
            id: el.id || null,
            ariaLabel: el.getAttribute?.("aria-label") || null,
            value: el.value || el.textContent || null,
            visible: !!(el.offsetParent || el.getClientRects?.().length),
          });
        }
        // Buscar shadow roots y bajar
        const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const el of all) {
          if (el.shadowRoot) {
            walk(el.shadowRoot, pathPrefix);
          }
        }
      } catch {}
    }
    walk(document, "");
    return found;
  });

  // Probar también iframes hijos (excluyendo about:blank y validators)
  const frames = page.frames();
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    if (frame.url() === "about:blank" || frame.url().includes("validator")) continue;
    try {
      const frameInputs = await frame.evaluate(() => {
        const found = [];
        const inputs = document.querySelectorAll("input, textarea");
        for (const el of inputs) {
          found.push({
            tag: el.tagName.toLowerCase(),
            placeholder: el.placeholder || null,
            name: el.name || null,
            type: el.type || null,
            visible: !!(el.offsetParent || el.getClientRects?.().length),
            frame: true,
          });
        }
        return found;
      });
      mainInputs.push(...frameInputs);
    } catch {}
  }

  return mainInputs;
}

/**
 * Llena un input por placeholder, atravesando shadow DOM via page.evaluate.
 * Devuelve { found, value, ... } igual que antes.
 */
async function fillByPlaceholder(page, placeholderRegex, value) {
  const regexSource = placeholderRegex.source;
  const regexFlags = placeholderRegex.flags;

  const result = await page.evaluate(
    ({ regexSource, regexFlags, value }) => {
      const re = new RegExp(regexSource, regexFlags);
      function findIn(root) {
        const inputs = root.querySelectorAll ? root.querySelectorAll("input, textarea") : [];
        for (const el of inputs) {
          const ph = el.placeholder || el.getAttribute?.("placeholder") || "";
          if (re.test(ph)) return el;
        }
        const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const el of all) {
          if (el.shadowRoot) {
            const found = findIn(el.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      }
      const el = findIn(document);
      if (!el) return { found: false };

      // Disparar evento React-compatible
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeSetter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { found: true, placeholder: el.placeholder || null };
    },
    { regexSource, regexFlags, value }
  );

  return { ...result, value };
}

/**
 * Llena la enésima ocurrencia de inputs con un placeholder dado (shadow-DOM aware).
 * Para campos como Alto/Ancho/Profundidad donde 3 inputs comparten placeholder "30".
 * values: array de valores a llenar en orden.
 */
async function fillNthByPlaceholderShadow(page, placeholderExact, values) {
  return page.evaluate(
    ({ placeholderExact, values }) => {
      const found = [];
      function collect(root) {
        const inputs = root.querySelectorAll ? root.querySelectorAll("input") : [];
        for (const el of inputs) {
          const ph = el.placeholder || el.getAttribute?.("placeholder") || "";
          if (ph === placeholderExact) found.push(el);
        }
        const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const el of all) {
          if (el.shadowRoot) collect(el.shadowRoot);
        }
      }
      collect(document);

      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      let filled = 0;
      for (let i = 0; i < Math.min(found.length, values.length); i++) {
        nativeSetter.call(found[i], values[i]);
        found[i].dispatchEvent(new Event("input", { bubbles: true }));
        found[i].dispatchEvent(new Event("change", { bubbles: true }));
        filled++;
      }
      return { found: found.length, filled };
    },
    { placeholderExact, values }
  );
}

/**
 * Intenta llenar buscando por label asociado, placeholder o role textbox.
 */
async function fillByLabelOrPlaceholder(page, textRegex, value) {
  // Estrategia 1: getByLabel
  let input = page.getByLabel(textRegex).first();
  if ((await input.count()) > 0 && (await input.isVisible().catch(() => false))) {
    try {
      await input.fill(value);
      return { found: true, value, strategy: "label" };
    } catch {}
  }
  // Estrategia 2: getByPlaceholder
  input = page.getByPlaceholder(textRegex).first();
  if ((await input.count()) > 0 && (await input.isVisible().catch(() => false))) {
    try {
      await input.fill(value);
      return { found: true, value, strategy: "placeholder" };
    } catch {}
  }
  return { found: false, value };
}

/**
 * Helper legacy — mantenemos para no romper otros call sites.
 */
async function typeIntoInput(page, textRegex, value, { byPlaceholder = false } = {}) {
  // Estrategia 1: getByLabel (Tiendanube probablemente usa esto)
  let input = page.getByLabel(textRegex).first();
  if ((await input.count()) === 0 || !(await input.isVisible().catch(() => false))) {
    // Estrategia 2: getByPlaceholder
    input = page.getByPlaceholder(textRegex).first();
  }
  if ((await input.count()) === 0 || !(await input.isVisible().catch(() => false))) {
    // Estrategia 3: locator con role textbox y label
    input = page.getByRole("textbox", { name: textRegex }).first();
  }
  if ((await input.count()) === 0 || !(await input.isVisible().catch(() => false))) {
    console.log(`[typeIntoInput] no encontré input para ${textRegex}`);
    return { found: false, value };
  }

  try {
    await input.click({ timeout: 5000 });
    await input.fill(value);
    return { found: true, value };
  } catch (err) {
    console.log(`[typeIntoInput] fill falló para ${textRegex}:`, err?.message);
    return { found: false, value, error: err?.message };
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
