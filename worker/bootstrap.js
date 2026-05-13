/**
 * Bootstrap de sesión Tiendanube para el robot.
 *
 * Lo corrés LOCALMENTE en tu compu (NO en Railway). Te abre Chromium real,
 * loguéas a mano (con OTP y todo lo que pida), y cuando estás en el admin
 * apretás Enter en la terminal. Se guardan las cookies + localStorage en
 * un archivo y un .b64 para pegar en Railway.
 *
 * Uso:
 *   cd worker
 *   npm install   (instala playwright si no lo tenés)
 *   node bootstrap.js
 */

import { chromium } from "playwright";
import fs from "fs";
import readline from "readline";
import zlib from "zlib";

const TARGET = "https://gelica.mitiendanube.com/admin";

async function waitForEnter(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  console.log("\n=== Bootstrap de sesión Tiendanube ===\n");
  console.log("Abriendo Chromium con interfaz gráfica...");

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
  });
  const page = await context.newPage();

  await page.goto(TARGET, { waitUntil: "domcontentloaded" });

  console.log("\n--- INSTRUCCIONES ---");
  console.log("1. En la ventana de Chromium que se abrió, logueate a Tiendanube como SIEMPRE.");
  console.log("2. Si te pide OTP por mail, completalo.");
  console.log("3. Esperá hasta llegar al admin (gelica.mitiendanube.com/admin/...).");
  console.log("4. Cuando estés DENTRO del admin, volvé a esta terminal.");
  console.log("---------------------\n");

  await waitForEnter("→ Presioná Enter cuando estés dentro del admin: ");

  const currentUrl = page.url();
  if (!currentUrl.includes("mitiendanube.com")) {
    console.error(`\n❌ Error: la URL actual no parece del admin de tu tienda.`);
    console.error(`   URL actual: ${currentUrl}`);
    console.error(`   Asegurate de estar en gelica.mitiendanube.com antes de presionar Enter.\n`);
    await browser.close();
    process.exit(1);
  }

  console.log(`\n✅ Detectado en: ${currentUrl}`);
  console.log("Guardando sesión...");

  const fullState = await context.storageState();

  // FILTRAMOS para mantener solo lo que importa (Tiendanube/mitiendanube).
  // El estado completo trae cookies de HubSpot, LinkedIn, FB, Google, etc.
  // que no necesitamos y hacen que el base64 exceda 32KB en Railway.
  const isRelevantDomain = (d) =>
    d.includes("tiendanube.com") || d.includes("mitiendanube.com");

  const filteredState = {
    cookies: fullState.cookies.filter((c) => isRelevantDomain(c.domain || "")),
    origins: (fullState.origins || []).filter((o) =>
      isRelevantDomain(o.origin || "")
    ),
  };

  console.log(`   Cookies originales: ${fullState.cookies.length}`);
  console.log(`   Cookies filtradas (Tiendanube): ${filteredState.cookies.length}`);
  console.log(`   Origins con localStorage: ${filteredState.origins.length}`);

  if (filteredState.cookies.length === 0) {
    console.error("⚠️  No encontré cookies de Tiendanube. Algo salió mal en el login.");
    await browser.close();
    process.exit(1);
  }

  // Guardar JSON completo como backup
  const jsonPath = "session.json";
  fs.writeFileSync(jsonPath, JSON.stringify(filteredState, null, 2));

  // Comprimir con gzip y luego base64 para que entre en 32KB
  const json = JSON.stringify(filteredState);
  const gzipped = zlib.gzipSync(json);
  const b64 = gzipped.toString("base64");
  const b64Path = "session.b64.txt";
  fs.writeFileSync(b64Path, b64);

  const ratio = ((1 - b64.length / json.length) * 100).toFixed(1);
  console.log(`\n✅ Sesión guardada en:`);
  console.log(`   - ${jsonPath} (${json.length} bytes JSON filtrado)`);
  console.log(`   - ${b64Path} (${b64.length} caracteres base64+gzip, ${ratio}% más chico)`);

  console.log(`\n--- PRÓXIMO PASO ---`);
  console.log(`1. Abrí el archivo "${b64Path}" en cualquier editor.`);
  console.log(`2. Copiá TODO su contenido (Ctrl+A, Ctrl+C).`);
  console.log(`3. En Railway → tu worker → Variables → nueva variable:`);
  console.log(`   Nombre:  SESSION_STATE_B64`);
  console.log(`   Valor:   (pegá el contenido)`);
  console.log(`4. Railway redeploya solo. Probá "Test login" en el admin.`);
  console.log(`--------------------\n`);

  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
