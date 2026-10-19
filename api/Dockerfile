# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────────
# Warrly Go API — multi-stage Docker build
#
# - Stage 1 (builder): golang:1.24-alpine builds three static binaries:
#   server, cron, migrate. CGO disabled so the binaries run on
#   distroless/static. -ldflags "-s -w" strips the symbol/debug tables to
#   shrink the image (~20MB final).
# - Final stage: gcr.io/distroless/static-debian12:nonroot — UID 65532,
#   no shell, only TLS roots + tzdata. Encrypted attachments live under
#   /data/private-uploads (mounted volume).
#
# Default command runs the HTTP server. Override CMD to run cron or
# migrate, e.g.:
#   docker run --rm warranty-vault-api /app/migrate up
#   docker run --rm warranty-vault-api /app/cron
# ─────────────────────────────────────────────────────────────────────────────

# ── builder ──────────────────────────────────────────────────────────────────
FROM golang:1.25-alpine AS builder
WORKDIR /src

# Cache module downloads on a separate layer.
COPY go.mod go.sum* ./
RUN go mod download

# Copy the full source tree (the .dockerignore strips junk).
COPY . .

ENV CGO_ENABLED=0 \
    GOOS=linux \
    GOFLAGS=-trimpath

RUN go build -ldflags="-s -w" -o /out/server  ./cmd/server  \
 && go build -ldflags="-s -w" -o /out/cron    ./cmd/cron    \
 && go build -ldflags="-s -w" -o /out/migrate ./cmd/migrate

# ── final ────────────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

# nonroot user (UID 65532) is preset in the distroless image.
COPY --from=builder --chown=nonroot:nonroot /out/server  /app/server
COPY --from=builder --chown=nonroot:nonroot /out/cron    /app/cron
COPY --from=builder --chown=nonroot:nonroot /out/migrate /app/migrate

# Migrations are embedded into the binary in the migrate command, but we
# also ship the raw .sql for ad-hoc inspection / out-of-band tooling.
COPY --from=builder --chown=nonroot:nonroot /src/migrations /app/migrations

ENV PORT=4000 \
    PRIVATE_UPLOAD_ROOT=/data/private-uploads

# The calendar-day logic (reminder window, return-window countdown, action
# queue, cron day windows) is written against the PROCESS-LOCAL day, because a
# date-only column is the day the user picked. An image without TZ runs that
# logic on UTC, which is a day behind Vietnam for the first seven hours of every
# day. Pin the business calendar the code already assumes. This does NOT change
# what is stored: dbconn forces every DB session to UTC and Go writes instants
# with .UTC(), so only "which calendar day is it for the user" moves. The
# distroless static base ships tzdata (see the header).
#
# This is an ordinary image DEFAULT: `docker run -e TZ=...` (or compose
# `environment: TZ: ...`) overrides it at runtime. See api/README.md
# "Calendar days use the process-local day" for what moves together — changing
# it alone silently shifts the cron buckets and the four local-day comparisons.
ENV TZ=Asia/Ho_Chi_Minh

EXPOSE 4000

USER nonroot:nonroot

ENTRYPOINT []
CMD ["/app/server"]
