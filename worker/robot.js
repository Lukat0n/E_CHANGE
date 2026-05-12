import { chromium } from "playwright";

/**
 * Lanza un browser, loguea al admin de Tiendanube con las credenciales del .env
 * y devuelve la URL a la que cayó después del login (debería ser el dashboard).
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
    });
    const page = await context.newPage();

    await page.goto("https://www.tiendanube.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });

    // Tiendanube login: typically input[name="user"] y input[name="password"]
    // Probamos varios selectores comunes para tolerar variaciones.
    const emailSel = ['input[name="user"]', 'input[name="email"]', 'input[type="email"]'];
    const passSel = ['input[name="password"]', 'input[type="password"]'];

    let filled = false;
    for (const sel of emailSel) {
      const el = await page.$(sel);
      if (el) {
        await el.fill(user);
        filled = true;
        break;
      }
    }
    if (!filled) throw new Error("No se encontró el campo de email en el login");

    let filledPass = false;
    for (const sel of passSel) {
      const el = await page.$(sel);
      if (el) {
        await el.fill(pass);
        filledPass = true;
        break;
      }
    }
    if (!filledPass) throw new Error("No se encontró el campo de password en el login");

    // Submit
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);

    // Esperar un poco para que aparezca el dashboard
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    const finalUrl = page.url();
    const title = await page.title();

    // Si la URL final sigue conteniendo /login, algo salió mal (credenciales o captcha)
    const looksLoggedIn = !finalUrl.includes("/login");

    return {
      loggedIn: looksLoggedIn,
      url: finalUrl,
      title,
    };
  } finally {
    await browser.close();
  }
}

/**
 * FASE 3+: stub para crear un envío. Por ahora solo devuelve los datos recibidos
 * (dry run total). Cuando avancemos, acá va la navegación al panel de envíos +
 * llenado del formulario.
 */
export async function createShipment(input) {
  return {
    received: input,
    note: "Aún no implementado. Estamos en Fase 1.",
  };
}
