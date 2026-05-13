# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────────
# WarrantyVault — multi-stage Docker build
#
# - Node 22 alpine (libc6-compat for prebuilt binaries: sharp)
# - builder stage runs `next build` (which calls `prisma generate` first via
#   package.json `build` script). Postgres talks over TCP via `pg`, so no
#   native module compile step.
# - runner stage ships full node_modules so the prisma CLI is available at
#   container start to run `prisma db push` against the postgres service
# - Encrypted attachments live under /data (volume); DB lives in a separate
#   `warranty-pg` volume on the postgres container (see docker-compose.yml).
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat

# ── deps + build ─────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Install deps first (cache layer). Prisma schema is needed because
# `postinstall` runs `prisma generate`.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Copy the rest of the source.
COPY . .

# NEXT_PUBLIC_* must be present at BUILD time — they're inlined into the
# client bundle. Pass via --build-arg or compose `args:`.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_TELEMETRY_DISABLED=1

# Dummy SESSION_SECRET so `src/lib/session.ts` doesn't throw during build
# when Next pre-renders pages that touch the session module.
ENV SESSION_SECRET="build-time-placeholder-must-be-32+chars-long"

RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# Copy build output + runtime deps.
COPY --from=builder --chown=nextjs:nodejs /app/.next         ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public        ./public
COPY --from=builder --chown=nextjs:nodejs /app/node_modules  ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/prisma        ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/package.json  ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs  ./next.config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json    ./tsconfig.json

COPY --chown=nextjs:nodejs docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown -R nextjs:nodejs /data

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "node_modules/next/dist/bin/next", "start"]
