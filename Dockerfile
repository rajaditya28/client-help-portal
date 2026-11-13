# One image for the whole product: NestJS API + background worker + the built Vue app.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Skip the browser download for the e2e dev dependency.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY packages/shared packages/shared
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3000
# Apply migrations and (idempotently) seed demo users on every boot, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/seed.js && node dist/main.js"]
