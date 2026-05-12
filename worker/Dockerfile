# Imagen oficial de Playwright (incluye Chromium + todas las libs de sistema necesarias)
FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app

# Instalar dependencias primero (mejor cache de Docker)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copiar el resto del código
COPY . .

# Railway inyecta PORT como env var; Express lee process.env.PORT
EXPOSE 3000

CMD ["node", "server.js"]
