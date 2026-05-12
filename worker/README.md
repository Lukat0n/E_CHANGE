# E-Change Worker

Robot Playwright que loguea al admin de Tiendanube y (eventualmente) crea envíos de Envío Nube automáticamente. Corre en Railway como servicio separado del backend principal en Vercel.

## Variables de entorno requeridas

| Nombre | Para qué |
| --- | --- |
| `WORKER_API_KEY` | Clave secreta que Vercel manda en el header `x-api-key`. Generala con `openssl rand -hex 32` o cualquier random largo. La misma se guarda en Vercel. |
| `TIENDANUBE_USER` | Email del usuario robot de Tiendanube (NO tu admin principal). |
| `TIENDANUBE_PASS` | Password del usuario robot. |
| `PORT` | Railway la inyecta sola, no la setees. |

## Deploy en Railway

1. Entrá a [railway.app](https://railway.app) y creá una cuenta (login con GitHub).
2. **New Project → Deploy from GitHub repo** → seleccioná `E_CHANGE`.
3. En el setup, marcá **"Set Root Directory"** y poné `worker`. Eso le dice a Railway que el `Dockerfile` está en esa subcarpeta.
4. Cuando arranque el build, Railway va a usar el `Dockerfile` automáticamente.
5. Andá a **Variables** y agregá las 3 env vars (sin `PORT`).
6. **Settings → Networking → Generate Domain** para tener una URL pública tipo `echange-worker-production.up.railway.app`.
7. Esa URL la copiás a Vercel como `WORKER_URL`.

## Endpoints

- `GET /health` — healthcheck (no requiere auth)
- `POST /api/test-login` — prueba el login con las credenciales configuradas. Requiere `x-api-key`.
- `POST /api/shipment` — crea un envío (todavía stub). Requiere `x-api-key`.

## Test local

```bash
cd worker
npm install
npx playwright install chromium
WORKER_API_KEY=dev TIENDANUBE_USER=... TIENDANUBE_PASS=... node server.js
```

Después:

```bash
curl -X POST http://localhost:3000/api/test-login -H "x-api-key: dev"
```
