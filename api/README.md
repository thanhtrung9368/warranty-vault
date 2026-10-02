# WarrantyVault API (Go)

Standalone Go service that owns the WarrantyVault backend: REST API under `/api/v1/*` (file streaming at `/api/files/{id}`), push fanout, and the cron worker. Web (`website/`) and mobile (`ios/`, `android/`) are pure clients of this service. See `../BACKEND_GO_PLAN.md` for the full migration plan.

Stack: Go 1.22+ (`net/http` ServeMux), `pgx/v5` + `sqlc`, `pressly/goose` migrations, `go-playground/validator/v10`, stdlib `log/slog`. No frameworks (no gin/fiber/echo/gorm/viper).

## Local dev

```bash
cp .env.example .env          # fill DATABASE_URL at minimum
go run ./cmd/migrate up       # apply schema (migrations live in api/migrations/)
go run ./cmd/server           # serves on :4000
```

Verify:

```bash
curl localhost:4000/healthz   # {"ok":true}
curl localhost:4000/readyz    # {"ok":true} when DB is reachable, 503 otherwise
```

The server reads `.env` automatically when present; required env is `DATABASE_URL`. Optional: `PORT` (default `4000`), `WEB_URL` (CORS allowlist), `SESSION_SECRET` (only length-validated — the server never reads the web's `wv_session` cookie; min 32 chars when set). Everything else (push, email, rate limit, encrypted uploads, cron) is documented with comments in `.env.example`.

## CLIs

- `go run ./cmd/server` — HTTP server.
- `go run ./cmd/migrate <up|down|status|version|redo|reset>` — goose wrapper. `reset` is destructive and requires `WV_ALLOW_DESTRUCTIVE=1`. `--force-reset` is always blocked (per repo CLAUDE.md).
- `go run ./cmd/cron` — one-shot warranty-check pass (warranty + wishlist + subscription notifications, subscription auto-bill). Shares `internal/cron.Run` with `POST /api/v1/cron/warranty-check`.

## Layout

```
api/
├── cmd/
│   ├── server/      HTTP entrypoint
│   ├── cron/        one-shot cron entrypoint (systemd timer / k8s CronJob)
│   └── migrate/     goose CLI wrapper
├── internal/
│   ├── ai/          Anthropic vision client for OCR receipt extraction
│   ├── auth/        bearer issue/verify, bcrypt
│   ├── handlers/    /api/v1/* HTTP handlers
│   ├── services/    pure business logic
│   ├── cron/        cron.Run — shared by cmd/cron + the HTTP endpoint
│   ├── store/
│   │   ├── queries/ .sql files, sqlc input
│   │   └── gen/     sqlc output (committed; run `sqlc generate` to refresh)
│   ├── files/       AES-256-GCM encrypted attachments
│   ├── push/        web push / APNs / FCM dispatch
│   ├── ratelimit/   in-memory + Upstash
│   ├── email/       Resend REST wrapper
│   ├── config/      env loading + validation
│   ├── httpx/       JSON helpers + middleware (logging, recover, request id)
│   └── validate/    go-playground/validator setup
├── migrations/      goose .sql (owned by the migrations tooling)
├── scripts/         seed_dev.sql + parity/e2e shell tests
├── sqlc.yaml
├── go.mod
└── README.md
```

## Generating sqlc code

After migrations are in place:

```bash
sqlc generate
```

The generated package lands in `internal/store/gen/`. It is committed so contributors don't need sqlc installed just to build.
