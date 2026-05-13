# Bootstrap de sesión Tiendanube

El robot del worker NO puede loguearse solo a Tiendanube porque el SPA tiene anti-bot que detecta navegadores automatizados. Para resolverlo, vos hacés el login **una vez** desde tu compu, guardás la sesión, y el worker la reutiliza.

La sesión dura aproximadamente **30 días**. Cuando expire, repetís los pasos de abajo.

## Pre-requisitos

- Node.js 20+ instalado en tu compu ([nodejs.org](https://nodejs.org))
- 5 minutos

## Pasos

### 1. Instalar Playwright local (una sola vez)

Abrí una terminal en la carpeta `worker` del proyecto:

```bash
cd c:/Users/Lkato/Desktop/procesador_reclamos/worker
npm install
npx playwright install chromium
```

### 2. Correr el bootstrap

```bash
node bootstrap.js
```

Va a:
- Abrir una ventana real de Chromium (NO es headless)
- Cargar `https://gelica.mitiendanube.com/admin`

### 3. Loguear MANUALMENTE en la ventana

Cuando se abre Chromium:
1. Vas a ver la pantalla de login de Tiendanube
2. Apretá **"Ingresar con e-mail"**
3. Poné el email del robot: `robot.gelica.envios@gmail.com`
4. Poné la password
5. Si te pide código OTP, fijate en el Gmail del robot y pegalo
6. **Esperá hasta llegar al admin de tu tienda** (URL que contenga `gelica.mitiendanube.com/admin`)

### 4. Confirmar en la terminal

Cuando estés DENTRO del admin, volvé a la terminal donde corre el script y apretá **Enter**.

El script va a:
- Guardar la sesión en `session.json` (para tener backup)
- Guardar el base64 en `session.b64.txt`
- Mostrarte instrucciones para pegar en Railway

### 5. Pegar en Railway

1. Abrí `session.b64.txt` con cualquier editor (Notepad, VSCode, etc.)
2. **Seleccioná todo** (Ctrl+A) y **copiá** (Ctrl+C)
3. Andá a [railway.app](https://railway.app) → tu proyecto E_CHANGE → Variables
4. Click **+ New Variable**
5. Nombre: `SESSION_STATE_B64`
6. Valor: pegá el contenido (Ctrl+V)
7. Guardar

Railway redeploya el worker solo (~30 segundos).

### 6. Probar en el admin

1. Abrí tu admin de E-Change
2. Hard refresh (Ctrl+Shift+R)
3. En el panel "Robot Envío Nube", apretá **"Test login"**
4. Debería decir `✅ Login OK — URL final: https://gelica.mitiendanube.com/admin/...`

Si dice eso, el robot ya puede entrar al admin de Tiendanube. Avisame y seguimos con la creación de envíos.

## Renovación cuando expira

Cuando veas un error tipo "Sesión persistente expirada":
1. Repetí pasos 2-5 (con la sesión ya logueada en Chromium probablemente no te pida OTP)
2. Pegá el nuevo base64 en Railway, reemplazando el viejo
3. Listo
