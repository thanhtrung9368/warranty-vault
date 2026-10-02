# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────────
# WarrantyVault — multi-stage Docker build (web UI only)
#
# Post Phase F: the website is a pure Next.js frontend that talks to the Go
# API over HTTP. No Prisma, no Postgres driver, no native compile step.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat

# ── deps + build ─────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Install deps first (cache layer).
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source.
COPY . .

# NEXT_PUBLIC_* must be present at BUILD time — they're inlined into the
# client bundle. Pass via --build-arg or compose `args:`.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_TELEMETRY_DISABLED=1

# Dummy SESSION_SECRET for the build. `src/lib/auth-cookie.ts` throws at module
# load when SESSION_SECRET is missing or shorter than 32 chars, and Next
# evaluates that module while pre-rendering. The value is irrelevant at build
# time — the real secret is injected as a runtime env var.
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
COPY --from=builder --chown=nextjs:nodejs /app/package.json  ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs  ./next.config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json    ./tsconfig.json

COPY --chown=nextjs:nodejs docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "node_modules/next/dist/bin/next", "start"]
