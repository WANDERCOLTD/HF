# =============================================================================
# Multi-stage Dockerfile for HF Admin
#
# Targets:
#   runner (default) — Minimal production image (server.js only)
#   seed             — Full image for database seeding (includes specs + scripts)
#   migrate          — Minimal image for running prisma migrate deploy
#
# Usage:
#   docker build -t hf-admin .                          # production server
#   docker build --target seed -t hf-admin-seed .       # seeding image
#   docker build --target migrate -t hf-admin-migrate . # migration image
#
# Cache strategy (#726 Phase 2G):
#   - deps stage: COPY package + lock + prisma schema FIRST, then npm ci + prisma generate
#     → both layers cache as long as deps + schema haven't changed
#   - builder stage: COPY package + prisma + config files BEFORE COPY . .
#     → prisma generate caches based on schema only
#   - .next/cache persistence to GCS still missing (orchestrated by cloudbuild,
#     not Dockerfile) — tracked in #726 Phase E
# =============================================================================

# --- Stage 1: Install dependencies + generate Prisma client ------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Tallyseal packages are vendored as local tarballs (items 12+13 onward).
# package-lock.json carries `file:vendor/tallyseal/*.tgz` references — npm ci
# resolves these against the working directory, so vendor/ MUST exist BEFORE
# the install. Pre-2026-06-04 this directory was empty so the bug stayed
# latent; #1012 added 13 file: references and #1013 resynced the lock, which
# is when Cloud Build started failing with ENOENT on the tarballs.
COPY vendor ./vendor
RUN npm ci
# Prisma generate happens once here so all downstream targets share the cached client.
COPY prisma ./prisma
RUN npx prisma generate

# --- Stage 2: Build Next.js app ----------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
ARG NODE_OPTIONS
ARG NEXT_PUBLIC_APP_ENV=PROD
ENV NODE_ENV=production
ENV NODE_OPTIONS=$NODE_OPTIONS
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV
# Bring in cached node_modules + pre-generated prisma client first.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
# Copy package + tsconfig + next config separately so source-only changes don't
# bust the prisma + deps layers above.
COPY package.json package-lock.json tsconfig.json next.config.ts ./
# Finally pull in the rest of the source. This is the layer that source-edits invalidate.
COPY . .
RUN npm run build

# --- Target: runner (default) — Production server -----------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# prisma/ schema + migrations are NOT needed at runtime — server.js uses the
# generated client already bundled into node_modules. Dropped for image size.
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]

# --- Target: seed — Database seeding image ------------------------------------
# Includes full node_modules, seed scripts, spec files, and tsx runner.
# Used for initial bootstrap and re-seeding.
#
# Usage:
#   docker run --rm --env DATABASE_URL=... hf-admin-seed
#   docker run --rm --env DATABASE_URL=... --env SEED_PROFILE=core hf-admin-seed
FROM node:20-alpine AS seed
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package.json tsconfig.json ./
COPY docs-archive/bdd-specs ./docs-archive/bdd-specs
COPY lib ./lib
COPY scripts ./scripts
COPY transcripts ./transcripts
CMD ["npx", "tsx", "prisma/seed-full.ts"]

# --- Target: migrate — Database migration image -------------------------------
# Minimal image for running prisma migrate deploy in CI/CD.
#
# Usage:
#   docker run --rm --env DATABASE_URL=... hf-admin-migrate
FROM node:20-alpine AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]
