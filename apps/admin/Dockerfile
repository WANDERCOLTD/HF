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
# =============================================================================

# --- Stage 1: Install dependencies -------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage 2: Build Next.js app ----------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
ARG NODE_OPTIONS
ARG NEXT_PUBLIC_APP_ENV=LIVE
ENV NODE_ENV=production
ENV NODE_OPTIONS=$NODE_OPTIONS
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
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
COPY --from=builder /app/prisma ./prisma
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
COPY package.json tsconfig.json ./
COPY prisma ./prisma
COPY docs-archive/bdd-specs ./docs-archive/bdd-specs
COPY lib ./lib
COPY scripts ./scripts
COPY transcripts ./transcripts
RUN npx prisma generate
CMD ["npx", "tsx", "prisma/seed-full.ts"]

# --- Target: migrate — Database migration image -------------------------------
# Minimal image for running prisma migrate deploy in CI/CD.
#
# Usage:
#   docker run --rm --env DATABASE_URL=... hf-admin-migrate
FROM node:20-alpine AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
RUN npx prisma generate
CMD ["npx", "prisma", "migrate", "deploy"]
