# syntax=docker/dockerfile:1
#
# NASA Sky Tracker — production image (VAL-DOCKER-001/003/004/005).
#
# Multi-stage build on node:24-slim (matches the pinned Node 24 in `.nvmrc`
# and `package.json` engines). The builder compiles the NestJS backend
# (`nest build` -> dist/) and the Vite frontend (`web` -> web/dist), then a
# slim runtime stage ships only the compiled artifacts + production deps.
#
# `bcrypt` is a native addon; the builder installs the toolchain so it is
# compiled against the same Debian/glibc/Node ABI as the runtime base, then
# the prod-only node_modules is copied into the runtime stage (same slim base
# => the binary loads without a toolchain in the final image).

# ----------------------------------------------------------------------------
# Stage 1: builder
# ----------------------------------------------------------------------------
FROM node:24-slim AS builder

# Toolchain for native addons (bcrypt). Removed in the runtime stage.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Install root dependencies (full, incl. dev tools needed for `nest build`) ---
# Copy lockfiles first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# --- Install web dependencies ---
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

# --- Copy source (everything not in .dockerignore) ---
COPY . .

# --- Build backend (-> dist/) and frontend (-> web/dist) ---
RUN npm run build
RUN cd web && npm run build

# --- Prune to production-only node_modules for the runtime stage ---
# Reinstall prod deps in-place (builder still has the toolchain, so bcrypt is
# rebuilt natively). Web node_modules is not needed at runtime.
RUN npm ci --omit=dev && rm -rf web/node_modules

# ----------------------------------------------------------------------------
# Stage 2: runtime
# ----------------------------------------------------------------------------
FROM node:24-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    APOD_BOOT_CATCHUP=false \
    EONET_BOOT_CATCHUP=false

WORKDIR /app

# Production deps (bcrypt built in the builder against this same base).
COPY --from=builder /app/node_modules ./node_modules

# App metadata + compiled artifacts.
COPY package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist

# Entrypoint: run compiled migrations (no ts-node) THEN boot the API.
# Serves the SPA at `/` (ServeStaticModule resolves `join(__dirname,'..','web','dist')`
# from dist/main) and the API under `/api/*` from one Node process.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main"]
