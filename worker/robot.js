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
  // valor = 40000 por default: Envío Nube requiere "Valor declarado" en sucursal
  // (y suma para casos de pérdida/seguro). Como no tenemos el valor real de cada
  // paquete, fijamos un default razonable y seguimos.
  const { mode, destZip, alto = 10, ancho = 15, profundidad = 10, peso = 500, valor = 40000, recipient } = input || {};

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

    // Encontrar el iframe que contiene el form. Los inputs viven adentro de un
    // child frame (Envío Nube es una app embedded de Tiendanube).
    // box.height existe en ambos modos (domicilio y sucursal); zipCode sólo en domicilio.
    const sentinelField = mode === "sucursal" ? "customer.name" : "zipCode";
    const formFrame = await findFrameWithInput(page, sentinelField);
    if (!formFrame) {
      const dump = await debugDump(page, `No encontré el iframe del form de Envío Nube (sentinel: ${sentinelField})`);
      return { ...dump, dryRun: true, filled: {} };
    }

    if (mode === "domicilio") {
      filled.zipCode = await fillByNameInFrame(formFrame, "zipCode", String(destZip));
      filled.height = await fillByNameInFrame(formFrame, "box.height", String(alto));
      filled.width = await fillByNameInFrame(formFrame, "box.width", String(ancho));
      filled.depth = await fillByNameInFrame(formFrame, "box.depth", String(profundidad));
      if (peso) filled.weight = await fillByNameInFrame(formFrame, "box.weight", String(peso));
      if (valor) filled.declaredValue = await fillByNameInFrame(formFrame, "declaredValue", String(valor));
    } else {
      // Sucursal: en /agency-shipment los nombres reales son customer.name/customer.surname/
      // customer.email/customer.phoneNumber (NO firstName/lastName como pensábamos antes).
      if (recipient.nombre) filled.nombre = await fillByNameInFrame(formFrame, "customer.name", recipient.nombre);
      if (recipient.apellido) filled.apellido = await fillByNameInFrame(formFrame, "customer.surname", recipient.apellido);
      if (recipient.email) filled.email = await fillByNameInFrame(formFrame, "customer.email", recipient.email);
      if (recipient.telefono) filled.telefono = await fillByNameInFrame(formFrame, "customer.phoneNumber", recipient.telefono);
      filled.height = await fillByNameInFrame(formFrame, "box.height", String(alto));
      filled.width = await fillByNameInFrame(formFrame, "box.width", String(ancho));
      filled.depth = await fillByNameInFrame(formFrame, "box.depth", String(profundidad));
      if (peso) filled.weight = await fillByNameInFrame(formFrame, "box.weight", String(peso));
      if (valor) filled.declaredValue = await fillByNameInFrame(formFrame, "declaredValue", String(valor));
    }

    // Esperar a que el form se valide (Continuar pasa de gris a azul)
    await page.waitForTimeout(2500);

    // Click "Continuar" para pasar al Paso 2. El botón puede estar en el iframe.
    let continuarClicked = false;
    try {
      const btnFrame = formFrame.locator('button:has-text("Continuar"):not([disabled])').first();
      if ((await btnFrame.count()) > 0) {
        await btnFrame.click({ timeout: 5000 });
        continuarClicked = true;
        console.log("[createShipment] Continuar clickeado en iframe");
      }
    } catch {}
    if (!continuarClicked) {
      try {
        const btnPage = page.locator('button:has-text("Continuar"):not([disabled])').first();
        await btnPage.click({ timeout: 5000 });
        continuarClicked = true;
        console.log("[createShipment] Continuar clickeado en page");
      } catch (err) {
        console.log("[createShipment] no pude clickear Continuar:", err?.message);
      }
    }

    // Esperar a que el Paso 2 (Seleccionar medio de envío) renderice
    await page.waitForTimeout(6000);

    // Paso 2: elegir carrier. Por defecto pickeamos el más barato (primer radio
    // visible). Si input.shippingMethodPreference está, intentamos matchearlo
    // por nombre.
    const carrierResult = await pickCarrierRadio(formFrame, input?.shippingMethodPreference);
    console.log("[createShipment] carrier seleccionado:", JSON.stringify(carrierResult));

    // Esperar a que el form se valide y el Continuar se habilite
    await page.waitForTimeout(2000);

    // Click "Continuar" para pasar al Paso 3
    let continuar2Clicked = false;
    try {
      const btn = formFrame.locator('button:has-text("Continuar"):not([disabled])').first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 5000 });
        continuar2Clicked = true;
        console.log("[createShipment] Continuar Paso 2 clickeado");
      }
    } catch (err) {
      console.log("[createShipment] no pude clickear Continuar Paso 2:", err?.message);
    }

    // Esperar a que el Paso 3 ("Completar datos del destinatario") renderice
    await page.waitForTimeout(6000);

    // Datos del destinatario (con defaults razonables si no se pasaron)
    const ship = input?.ship || {};
    const filledP3 = {};

    // Provincia (select)
    if (ship.provincia) {
      filledP3.provincia = await selectByVisibleText(formFrame, ship.provincia);
    }
    if (ship.ciudad) filledP3.city = await fillByNameInFrame(formFrame, "address.city", ship.ciudad);
    if (ship.calle) filledP3.address = await fillByNameInFrame(formFrame, "address.address", ship.calle);
    if (ship.numero) filledP3.number = await fillByNameInFrame(formFrame, "address.number", String(ship.numero));
    if (ship.departamento) filledP3.complement = await fillByNameInFrame(formFrame, "address.complement", ship.departamento);
    // Barrio: si no viene, usar ciudad como fallback (Tiendanube lo requiere para
    // avanzar y queda vacío rompe el flow).
    const barrioFinal = ship.barrio || ship.ciudad || "-";
    filledP3.neighborhood = await fillByNameInFrame(formFrame, "address.neighborhood", barrioFinal);

    if (recipient?.nombre) filledP3.name = await fillByNameInFrame(formFrame, "customer.name", recipient.nombre);
    if (recipient?.apellido) filledP3.lastName = await fillByNameInFrame(formFrame, "customer.lastName", recipient.apellido);
    if (recipient?.email) filledP3.email = await fillByNameInFrame(formFrame, "customer.email", recipient.email);
    if (recipient?.telefono) filledP3.phone = await fillByNameInFrame(formFrame, "customer.phoneNumber", recipient.telefono);

    console.log("[createShipment] Paso 3 llenado:", JSON.stringify(filledP3));

    // Esperar validación y clickear Continuar al Paso 4
    await page.waitForTimeout(2500);
    let continuar3Clicked = false;
    try {
      const btn = formFrame.locator('button:has-text("Continuar"):not([disabled])').first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 5000 });
        continuar3Clicked = true;
        console.log("[createShipment] Continuar Paso 3 clickeado");
      } else {
        console.log("[createShipment] botón Continuar Paso 3 está disabled o no existe");
      }
    } catch (err) {
      console.log("[createShipment] no pude clickear Continuar Paso 3:", err?.message);
    }

    // Esperar que la URL cambie a /review (Paso 4). Si no cambia, dumpeamos
    // errores de validación.
    let reachedReview = false;
    try {
      await page.waitForURL((u) => u.toString().includes("/review"), { timeout: 15000 });
      reachedReview = true;
    } catch {}
    console.log(`[createShipment] URL después de Paso 3: ${page.url()} (reachedReview=${reachedReview})`);

    // Si no llegamos a /review, dumpear errores de validación visibles
    if (!reachedReview) {
      const validationErrors = await page.evaluate(() => {
        const found = [];
        function walk(root) {
          // Buscamos textos con clases de error típicas de Nimbus o atributos aria-invalid
          const errs = root.querySelectorAll
            ? root.querySelectorAll('[aria-invalid="true"], [class*="error" i], [class*="invalid" i], [role="alert"]')
            : [];
          for (const el of errs) {
            const txt = (el.textContent || "").trim().slice(0, 200);
            if (txt) found.push(txt);
          }
          const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
          for (const el of all) if (el.shadowRoot) walk(el.shadowRoot);
        }
        walk(document);
        for (const f of Array.from(document.querySelectorAll("iframe"))) {
          try { walk(f.contentDocument); } catch {}
        }
        return [...new Set(found)].slice(0, 20);
      }).catch(() => []);
      console.log(`[createShipment] errores de validación Paso 3:`, JSON.stringify(validationErrors));
    }

    await page.waitForTimeout(3000);
    const paso4Inputs = await findAllInputs(page);
    console.log(`[createShipment] Paso 4 inputs: ${paso4Inputs.length}`);

    // Paso 4: si submit=true Y llegamos a /review, clickeamos "Crear envío".
    let submitted = false;
    let postSubmitUrl = null;
    let trackingCode = null;
    let trackingUrl = null;
    if (input?.submit === true && reachedReview) {
      try {
        const btn = formFrame
          .locator('button:has-text("Crear envío"):not([disabled])')
          .first();
        if ((await btn.count()) > 0) {
          await btn.click({ timeout: 5000 });
          submitted = true;
          console.log("[createShipment] 'Crear envío' clickeado");
          await page.waitForTimeout(8000);
          postSubmitUrl = page.url();
          console.log(`[createShipment] post-submit URL: ${postSubmitUrl}`);

          // Ahora el envío está creado. Buscamos el botón "Generar" para generar la etiqueta.
          try {
            await page.waitForTimeout(8000); // damos más tiempo a que cargue la página de detalle

            // Dumpear TODOS los botones visibles (page + frames) para debug
            const allButtons = await collectAllButtons(page);
            console.log(`[createShipment] botones visibles en shipping-details:`, JSON.stringify(allButtons.slice(0, 30)));

            // Intento 1: tal vez el envío ya tiene tracking (sin necesidad de "Generar")
            let trackInfo = await extractTrackingFromAll(page);
            if (trackInfo) {
              trackingCode = trackInfo.code;
              trackingUrl = trackInfo.url || null;
              console.log(`[createShipment] tracking detectado sin Generar: ${trackingCode} url=${trackingUrl}`);
            }

            // Si no había, buscamos el botón Generar
            if (!trackingCode) {
              console.log("[createShipment] buscando botón 'Generar'...");

              const labels = [/^\s*Generar\s*$/i, /Generar etiqueta/i, /Generar\b/i, /Imprimir etiqueta/i, /Generate label/i];
              let generarClicked = false;
              const allTargets = [page, ...page.frames().filter((f) => f !== page.mainFrame() && !f.url().includes("validator"))];

              outer: for (const target of allTargets) {
                for (const label of labels) {
                  try {
                    const btn = target.getByRole("button", { name: label }).first();
                    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
                      await btn.click({ timeout: 5000 }).catch(() => {});
                      generarClicked = true;
                      console.log(`[createShipment] clickeé Generar matching ${label}`);
                      break outer;
                    }
                  } catch {}
                }
              }

              if (!generarClicked) {
                console.log("[createShipment] no encontré botón 'Generar'");
              } else {
                // Esperar a que aparezca el código (con su link) en la página
                for (let i = 0; i < 10; i++) {
                  await page.waitForTimeout(2000);
                  trackInfo = await extractTrackingFromAll(page);
                  if (trackInfo) {
                    trackingCode = trackInfo.code;
                    trackingUrl = trackInfo.url || null;
                    console.log(`[createShipment] tracking detectado tras Generar (intento ${i + 1}): ${trackingCode} url=${trackingUrl}`);
                    break;
                  }
                }
              }
            }
          } catch (err) {
            console.log("[createShipment] error generando etiqueta:", err?.message);
          }
        } else {
          console.log("[createShipment] no encontré botón 'Crear envío' habilitado");
        }
      } catch (err) {
        console.log("[createShipment] error apretando 'Crear envío':", err?.message);
      }
    }

    const dumpMsg = submitted
      ? `Envío creado. URL final: ${postSubmitUrl}`
      : reachedReview
        ? `Pasos 1+2+3 OK. Llegamos al review pero no se apretó 'Crear envío' (dry run o botón no encontrado).`
        : `No llegamos al review. URL final: ${page.url()}. Revisar errores de validación en logs.`;
    const dump = await debugDump(page, dumpMsg);
    return {
      ...dump,
      dryRun: !submitted,
      submitted,
      reachedReview,
      postSubmitUrl,
      trackingCode,
      trackingUrl,
      filled,
      filledP3,
      continuarClicked,
      carrierResult,
      continuar2Clicked,
      continuar3Clicked,
      paso4InputCount: paso4Inputs.length,
      paso4Inputs: paso4Inputs.slice(0, 20),
      inputUsed: { mode, destZip, alto, ancho, profundidad, peso, valor, recipient, ship },
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
 * Construye una URL pública de tracking según el formato del código.
 *  - XX#########AR  → Correo Argentino
 *  - ABCDE#######    → e-pick (modalidades rápidas de Envío Nube)
 */
function inferTrackerUrl(code) {
  if (!code) return null;
  if (/^[A-Z]{2}\d{9}AR$/.test(code)) {
    return `https://www.correoargentino.com.ar/formularios/e-commerce?id=${code}`;
  }
  if (/^[A-Z]{3,6}\d{5,12}$/.test(code)) {
    return `https://e-pick.com.ar/tracking?id=${code}`;
  }
  return null;
}

/**
 * Busca el código de seguimiento en page + todos los frames. Devuelve { code, url }.
 */
async function extractTrackingFromAll(page) {
  const targets = [page, ...page.frames().filter((f) => f !== page.mainFrame() && !f.url().includes("validator"))];
  for (const t of targets) {
    try {
      const result = await t.evaluate(() => {
        // Helper: link válido = http(s), no mailto/tel/javascript/anchor interno
        function isUsefulLink(href) {
          if (!href) return false;
          const h = href.toLowerCase();
          if (h.startsWith("mailto:") || h.startsWith("tel:") || h.startsWith("javascript:") || h.startsWith("#")) return false;
          return h.startsWith("http://") || h.startsWith("https://");
        }
        function looksLikeTrackerHref(href) {
          const h = (href || "").toLowerCase();
          return h.includes("e-pick.com.ar") || h.includes("correoargentino.com.ar") || h.includes("/tracking") || h.includes("/seguimiento");
        }

        // 1) Link http(s) a host conocido de tracker
        for (const link of Array.from(document.querySelectorAll("a[href]"))) {
          const href = link.href || "";
          if (!isUsefulLink(href)) continue;
          if (!looksLikeTrackerHref(href)) continue;
          const code = (link.textContent || "").trim();
          if (code) return { code, url: href };
        }

        // 2) Link http(s) cerca del texto "Código de seguimiento" (sin mailto/tel)
        const labelEls = Array.from(document.querySelectorAll("*")).filter((el) => {
          const txt = (el.textContent || "").trim();
          return /c[oó]digo de seguimiento/i.test(txt) && txt.length < 200;
        });
        for (const el of labelEls) {
          let scope = el.parentElement || el;
          for (let i = 0; i < 5 && scope; i++) {
            const candidates = Array.from(scope.querySelectorAll("a[href]"));
            for (const link of candidates) {
              if (!isUsefulLink(link.href)) continue;
              const code = (link.textContent || "").trim();
              if (code && code.length < 40) return { code, url: link.href };
            }
            scope = scope.parentElement;
          }
        }

        // 3) Último recurso: solo código por regex (sin URL)
        const txt = (document.body?.innerText || "").replace(/\s+/g, " ");
        const m =
          txt.match(/C[oó]digo de seguimiento[:\s]+([A-Z0-9-]{6,30})/i) ||
          txt.match(/\b([A-Z]{2}\d{9}AR)\b/) ||
          txt.match(/(?:Tracking|T&T)[:\s]*([A-Z0-9-]{8,30})/i);
        if (m) return { code: m[1], url: null };

        return null;
      });
      if (result) {
        // Si no encontramos un URL en el DOM, intentamos construirlo según el código
        if (!result.url) {
          result.url = inferTrackerUrl(result.code);
        }
        return result;
      }
    } catch {}
  }
  return null;
}

/**
 * Recolecta todos los botones visibles (page principal + shadow DOM).
 * Útil para debug cuando no encontramos un botón que esperábamos.
 */
async function collectAllButtons(page) {
  const results = [];
  // Botones del documento principal
  try {
    const main = await page.evaluate(() => {
      const found = [];
      function walk(root) {
        const btns = root.querySelectorAll ? root.querySelectorAll('button, [role="button"], a') : [];
        for (const el of btns) {
          const visible = !!(el.offsetParent || el.getClientRects?.().length);
          if (visible) {
            found.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || "").trim().slice(0, 80),
              disabled: el.disabled || el.getAttribute?.("aria-disabled") === "true",
            });
          }
        }
        const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const el of all) if (el.shadowRoot) walk(el.shadowRoot);
      }
      walk(document);
      return found;
    });
    results.push(...main.map((b) => ({ ...b, scope: "page" })));
  } catch {}
  // Botones de cada frame
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.url().includes("validator")) continue;
    try {
      const inFrame = await frame.evaluate(() => {
        const found = [];
        const btns = document.querySelectorAll('button, [role="button"], a');
        for (const el of btns) {
          const visible = !!(el.offsetParent || el.getClientRects?.().length);
          if (visible) {
            found.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || "").trim().slice(0, 80),
              disabled: el.disabled || el.getAttribute?.("aria-disabled") === "true",
            });
          }
        }
        return found;
      });
      results.push(...inFrame.map((b) => ({ ...b, scope: `frame:${frame.url().slice(0, 60)}` })));
    } catch {}
  }
  return results;
}

/**
 * Encuentra el frame hijo que contiene un input con el name dado.
 * Tiendanube embebe Envío Nube en un iframe; los inputs viven adentro.
 */
async function findFrameWithInput(page, name) {
  const frames = page.frames();
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    if (frame.url() === "about:blank" || frame.url().includes("validator")) continue;
    try {
      const exists = await frame.evaluate((n) => !!document.querySelector(`input[name="${n}"]`), name);
      if (exists) {
        console.log(`[findFrameWithInput] form en frame: ${frame.url()}`);
        return frame;
      }
    } catch {}
  }
  return null;
}

/**
 * Llena un input por su name dentro de un frame. Dispara eventos React-compatibles.
 */
async function fillByNameInFrame(frame, name, value) {
  try {
    const result = await frame.evaluate(
      ({ name, value }) => {
        const el = document.querySelector(`input[name="${name}"]`);
        if (!el) return { found: false };
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeSetter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        // También blur para que valide
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        return { found: true, currentValue: el.value };
      },
      { name, value }
    );
    return { ...result, value };
  } catch (err) {
    return { found: false, value, error: err?.message };
  }
}

/**
 * Selecciona una opción en un <select> por texto visible.
 * Maneja tanto selects nativos como custom dropdowns de Nimbus (que usan
 * un combobox con role="combobox" y options dinámicas).
 */
async function selectByVisibleText(frame, optionText) {
  // Estrategia 1: select nativo (busca cualquier <select> de Provincia)
  const nativeResult = await frame.evaluate((optionText) => {
    const selects = Array.from(document.querySelectorAll("select"));
    for (const sel of selects) {
      const opts = Array.from(sel.options || []);
      const opt = opts.find((o) => (o.textContent || "").trim().toLowerCase() === optionText.toLowerCase());
      if (opt) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
        nativeSetter.call(sel, opt.value);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return { found: true, selected: opt.textContent.trim() };
      }
    }
    return { found: false };
  }, optionText);

  if (nativeResult.found) return nativeResult;

  // Estrategia 2: Nimbus combobox — click para abrir, click en la opción
  try {
    const combobox = frame.locator('[role="combobox"], [aria-haspopup="listbox"]').first();
    if ((await combobox.count()) > 0) {
      await combobox.click({ timeout: 5000 });
      await frame.locator(`text="${optionText}"`).first().click({ timeout: 5000 });
      return { found: true, selected: optionText, strategy: "combobox" };
    }
  } catch (err) {
    return { found: false, error: err?.message };
  }
  return { found: false };
}

/**
 * Extrae el nombre "limpio" del carrier de un texto del storefront.
 * Ejemplos:
 *   "Envío Nube - Correo Argentino Clásico a domicilio - Llega entre el viernes 15/05..."
 *     → "correo argentino clásico a domicilio"
 *   "Envio Nube - Entrega rápida a domicilio - Llega entre..."
 *     → "entrega rápida a domicilio"
 *   "Correo Argentino Clásico a domicilio"
 *     → "correo argentino clásico a domicilio"
 */
/**
 * Cotiza los carriers disponibles para un CP en el admin de Envío Nube.
 * Hace login + abre "Crear envío manual" + llena CP y medidas + click Continuar
 * para llegar al Paso 2. Ahí lee TODOS los radios con su label y precio, y
 * devuelve la lista sin crear el envío.
 *
 * Input:
 *   { destZip: "2000", alto: 10, ancho: 15, profundidad: 10, peso: 500 }
 *
 * Output:
 *   { ok: true, zipcode: "2000", carriers: [{ key: "correo argentino clásico a domicilio", name: "Envío Nube - Correo Argentino Clásico a domicilio - Llega entre el viernes 15/05 y el jueves 21/05", price: 7434 }, ...] }
 */
export async function quoteCarriers(input) {
  const { destZip, alto = 10, ancho = 15, profundidad = 10, peso = 500 } = input || {};
  if (!destZip) throw new Error("Falta destZip");

  const url = "https://gelica.mitiendanube.com/admin/apps/envionube/ar#/create-single-shipment";

  const { browser, page } = await launchBrowser();
  try {
    await loginToTiendanube(page, url);
    if (!page.url().startsWith(url.split("#")[0])) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    }
    await page.waitForTimeout(8000);

    const formFrame = await findFrameWithInput(page, "zipCode");
    if (!formFrame) {
      const dump = await debugDump(page, "No encontré el iframe del form de Envío Nube");
      return { ok: false, error: "form-frame-not-found", ...dump };
    }

    await fillByNameInFrame(formFrame, "zipCode", String(destZip));
    await fillByNameInFrame(formFrame, "box.height", String(alto));
    await fillByNameInFrame(formFrame, "box.width", String(ancho));
    await fillByNameInFrame(formFrame, "box.depth", String(profundidad));
    await fillByNameInFrame(formFrame, "box.weight", String(peso));

    await page.waitForTimeout(2500);

    // Click Continuar
    let continuarClicked = false;
    try {
      const btn = formFrame.locator('button:has-text("Continuar"):not([disabled])').first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 5000 });
        continuarClicked = true;
      }
    } catch {}
    if (!continuarClicked) {
      try {
        const btn = page.locator('button:has-text("Continuar"):not([disabled])').first();
        await btn.click({ timeout: 5000 });
        continuarClicked = true;
      } catch (err) {
        console.log("[quoteCarriers] no pude clickear Continuar:", err?.message);
      }
    }

    // Esperar a que el Paso 2 renderice los radios de carrier
    await page.waitForTimeout(6000);

    // Leer todos los radios con su nombre y precio. El precio NO está en el
    // mismo span que el nombre del carrier — vive en un sibling. Por eso
    // subimos por los padres hasta encontrar uno cuyo texto contenga "$"
    // (señal de que ahí adentro está también el precio).
    const carriers = await formFrame.evaluate(() => {
      const radios = Array.from(document.querySelectorAll('input[name="deliveryOptionId"]'));
      const visible = radios.filter((r) => r.offsetParent || r.getClientRects?.().length);

      function ancestorWithPrice(r) {
        let probe = r.parentElement;
        for (let i = 0; i < 10 && probe; i++) {
          const t = (probe.textContent || "").trim();
          if (t.includes("$") && t.length < 2000) return t;
          probe = probe.parentElement;
        }
        // Fallback: el contenedor "razonable" más cercano (lo que devolvía antes)
        probe = r.parentElement;
        for (let i = 0; i < 6 && probe; i++) {
          const t = (probe.textContent || "").trim();
          if (t.length > 3 && t.length < 500) return t;
          probe = probe.parentElement;
        }
        return "";
      }

      // Saca el primer monto "$ 7.434,00" o "$7.434,00" o "$ 7434" del texto
      function extractPrice(text) {
        const m = text.match(/\$\s*([0-9]{1,3}(?:[\.\,][0-9]{3})*(?:[\.\,][0-9]{2})?)/);
        if (!m) return null;
        const raw = m[1];
        // Si tiene ambos separadores, el último es el decimal. En AR ',' es decimal.
        // Si sólo hay '.' o sólo ',', el último que aparece es el decimal salvo que
        // tenga 3 dígitos después (entonces es separador de miles).
        let cleaned = raw;
        if (raw.includes(",")) {
          cleaned = raw.replace(/\./g, "").replace(",", ".");
        } else if ((raw.match(/\./g) || []).length === 1 && /\.\d{3}$/.test(raw)) {
          // "7.434" estilo AR (miles), no decimal
          cleaned = raw.replace(".", "");
        }
        const n = parseFloat(cleaned);
        return Number.isFinite(n) ? n : null;
      }

      // El nombre del carrier es lo que va antes del primer "$" o "\n"
      function extractName(text) {
        const cut = text.split(/\$|\n/)[0];
        return cut.trim();
      }

      return visible.map((r) => {
        const txt = ancestorWithPrice(r);
        return {
          id: r.id,
          value: r.value,
          rawText: txt.slice(0, 400),
          name: extractName(txt),
          price: extractPrice(txt),
        };
      });
    });

    // Si todos los precios vinieron null, dumpeamos el HTML de los radios para diagnosticar
    let stepHtml = null;
    if (carriers.length > 0 && carriers.every((c) => c.price == null)) {
      stepHtml = await formFrame.evaluate(() => {
        const radios = Array.from(document.querySelectorAll('input[name="deliveryOptionId"]'));
        const first = radios[0];
        if (!first) return null;
        // Subir 8 niveles para capturar el contenedor entero de la lista
        let probe = first.parentElement;
        for (let i = 0; i < 8 && probe?.parentElement; i++) probe = probe.parentElement;
        return probe?.outerHTML?.slice(0, 4000) || null;
      });
      console.log("[quoteCarriers] sin precios detectados, HTML snippet:", stepHtml);
    }

    return { ok: true, zipcode: String(destZip), continuarClicked, carriers, stepHtml };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    await browser.close();
  }
}

function extractCarrierKey(name) {
  if (!name) return null;
  let key = String(name).trim();
  // Quitar prefijo "Envío Nube - " o "Envio Nube - "
  key = key.replace(/^env[ií]o\s*nube\s*-\s*/i, "");
  // Quitar todo después de " - Llega" (texto de la fecha de llegada)
  const llegaIdx = key.search(/\s*-\s*llega/i);
  if (llegaIdx > 0) key = key.slice(0, llegaIdx);
  return key.toLowerCase().trim();
}

/**
 * En el Paso 2 ("Seleccionar medio de envío"), elige un carrier:
 *   - Si preference está, busca un radio cuyo label cercano contenga el nombre
 *     del carrier (después de limpiar prefijo "Envío Nube" y sufijo "Llega entre...").
 *   - Si no encuentra match, clickea el primer radio visible (el más barato).
 *
 * Trabaja dentro del iframe del form. Dispara click + change para que React
 * registre la selección.
 */
async function pickCarrierRadio(frame, preference = null) {
  const cleanedPreference = extractCarrierKey(preference);
  console.log(`[pickCarrierRadio] preference original: ${preference}`);
  console.log(`[pickCarrierRadio] preference limpia: ${cleanedPreference}`);

  return frame.evaluate(
    ({ preference, cleanedPreference }) => {
      const radios = Array.from(document.querySelectorAll('input[name="deliveryOptionId"]'));
      const visible = radios.filter((r) => r.offsetParent || r.getClientRects?.().length);
      if (visible.length === 0) return { found: false, reason: "sin radios visibles" };

      // Helper: leer el texto del label asociado al radio (subiendo por padres)
      function radioLabelText(r) {
        let probe = r.parentElement;
        for (let i = 0; i < 6 && probe; i++) {
          const t = (probe.textContent || "").trim();
          // El primer texto razonable (>3 chars y <200) lo tomamos como label
          if (t.length > 3 && t.length < 300) return t.toLowerCase();
          probe = probe.parentElement;
        }
        return "";
      }

      // Listar todos los radios con su texto cercano para debug
      const radiosInfo = visible.map((r) => ({ value: r.value, label: radioLabelText(r).slice(0, 100) }));

      let target = null;
      let matchType = null;
      if (cleanedPreference) {
        // Intento 1: match exacto del nombre limpio dentro del texto del radio
        for (const r of visible) {
          if (radioLabelText(r).includes(cleanedPreference)) {
            target = r;
            matchType = "exacto";
            break;
          }
        }
      }
      if (!target && preference) {
        // Intento 2: match del nombre original completo (fallback)
        const fullNeedle = preference.toLowerCase();
        for (const r of visible) {
          if (radioLabelText(r).includes(fullNeedle)) {
            target = r;
            matchType = "fullName";
            break;
          }
        }
      }
      if (!target) {
        target = visible[0];
        matchType = "fallback-primero";
      }

      target.click();
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        found: true,
        value: target.value,
        id: target.id,
        matchType,
        matchedPreference: cleanedPreference || preference || null,
        totalVisible: visible.length,
        availableRadios: radiosInfo,
      };
    },
    { preference, cleanedPreference }
  );
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
