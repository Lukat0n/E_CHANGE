# Imagen oficial de Playwright (incluye Chromium + todas las libs de sistema necesarias)
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

# Instalar dependencias primero (mejor cache de Docker).
# Usamos npm install en vez de npm ci porque no commiteamos package-lock.json.
# La imagen base ya trae Chromium instalado, así que evitamos que Playwright
# lo vuelva a bajar durante el install.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copiar el resto del código
COPY . .

# Railway inyecta PORT como env var; Express lee process.env.PORT
EXPOSE 3000

CMD ["node", "server.js"]
