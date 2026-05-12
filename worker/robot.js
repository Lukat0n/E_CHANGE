import { chromium } from "playwright";

/**
 * Lanza un browser, loguea al admin de Tiendanube con las credenciales del .env
 * y devuelve la URL a la que cayó después del login.
 *
 * Esta es FASE 1: probar que las credenciales y el flujo de login funcionan
 * desde el contenedor de Railway antes de meternos con scraping del panel de envíos.
 */
export async function testLogin() {
  const user = process.env.TIENDANUBE_USER;
  const pass = process.env.TIENDANUBE_PASS;
  if (!user || !pass) {
    throw new Error("Faltan env vars TIENDANUBE_USER y/o TIENDANUBE_PASS");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Tiendanube tiene varios puntos de login; vamos al universal.
    // Usamos "domcontentloaded" (no "networkidle") porque las páginas de Tiendanube
    // cargan scripts de analytics constantemente y nunca llegan a estar idle.
    await page.goto("https://www.tiendanube.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    // Dejar que el JS hidrate y los inputs queden visibles
    await page.waitForTimeout(2500);

    // Cerrar cookie banner si aparece (no bloqueante)
    const cookieBtns = [
      'button:has-text("Aceptar")',
      'button:has-text("Acepto")',
      'button:has-text("OK")',
      '[id*="cookie"] button',
    ];
    for (const sel of cookieBtns) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(500);
        break;
      }
    }

    // Buscar el primer input visible que parezca email/usuario
    const emailLocator = page
      .locator('input[type="email"], input[name="email"], input[name="user"], input[name="username"], input[id*="email" i], input[id*="user" i]')
      .filter({ visible: true })
      .first();

    try {
      await emailLocator.waitFor({ state: "visible", timeout: 15000 });
    } catch {
      return debugDump(page, "No apareció un input de email visible");
    }

    await emailLocator.fill(user);

    const passLocator = page.locator('input[type="password"]').filter({ visible: true }).first();
    await passLocator.waitFor({ state: "visible", timeout: 10000 });
    await passLocator.fill(pass);

    // Botón submit — probamos el más obvio primero
    const submitLocator = page
      .locator('button[type="submit"], button:has-text("Ingresar"), button:has-text("Iniciar"), input[type="submit"]')
      .filter({ visible: true })
      .first();

    // Navegamos después de submit. Algunas implementaciones hacen SPA y no disparan navegación.
    const navPromise = page.waitForURL(/.+/, { timeout: 30000 }).catch(() => null);
    await submitLocator.click();
    await navPromise;
    // Esperar el DOM cargado, no networkidle (Tiendanube nunca llega a idle por analytics)
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000); // dar tiempo a redirects post-login

    const finalUrl = page.url();
    const title = await page.title();
    const looksLoggedIn = !finalUrl.includes("/login");

    if (!looksLoggedIn) {
      // Login falló — devolvemos info para debug
      return debugDump(page, "Login no avanzó (sigue en /login). Probablemente credenciales o captcha.");
    }

    return {
      loggedIn: true,
      url: finalUrl,
      title,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Devuelve info de debug del estado actual de la página. Útil cuando el robot
 * no encuentra los elementos esperados y necesitamos ver qué está pasando.
 */
async function debugDump(page, message) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const screenshot = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false }).catch(() => null);
  const visibleInputs = await page.$$eval("input", (els) =>
    els.map((el) => ({
      name: el.getAttribute("name"),
      id: el.id,
      type: el.type,
      visible: el.offsetParent !== null,
      placeholder: el.placeholder,
    }))
  ).catch(() => []);

  return {
    loggedIn: false,
    error: message,
    url,
    title,
    visibleInputs,
    screenshot: screenshot ? screenshot.toString("base64") : null,
  };
}

/**
 * FASE 3+: stub para crear un envío.
 */
export async function createShipment(input) {
  return {
    received: input,
    note: "Aún no implementado. Estamos en Fase 1.",
  };
}
