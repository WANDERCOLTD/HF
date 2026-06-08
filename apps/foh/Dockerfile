# =============================================================================
# Multi-stage Dockerfile for HF Front-of-House (foh)
#
# Target:
#   runner (default) — Minimal production image (Next.js standalone server)
#
# Usage:
#   docker build -t hf-foh .
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
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
