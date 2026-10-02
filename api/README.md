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

## Kiểm thử e2e (`api/scripts/`)

Bộ `scripts/test_*.sh` là chỗ **duy nhất** exercise HTTP surface thật (Go unit test gọi thẳng services, không đi qua route). Một lệnh chạy hết:

```bash
cd api
./scripts/e2e.sh
```

Runner tự làm mọi thứ mà trước đây các script giả định đã có sẵn: tạo database tạm → `cmd/migrate up` → build & chạy `cmd/server` ở cổng test (mặc định `4187`) → chờ `/readyz` → chạy từng script → in bảng đạt/không đạt kèm log riêng. Khi kết thúc — kể cả khi có script fail, hay bạn `Ctrl-C` giữa chừng — runner **luôn** dừng server và `DROP DATABASE` tạm (trap `EXIT`/`INT`/`TERM`), nên không để lại tiến trình treo hay DB rác.

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `--only CHUỖI` | chỉ chạy script có tên chứa `CHUỖI` (vd `--only stats`, `--only cron`) |
| `--db-url URL` | Postgres **admin** để tạo DB tạm. Mặc định: `$WV_E2E_DATABASE_URL` → `$WV_TEST_DATABASE_URL` → `postgres://postgres@127.0.0.1:55432/postgres?sslmode=disable` |
| `--port N` | cổng server test (mặc định `4187`, hoặc `$WV_E2E_PORT`) |
| `--go-tests` | chạy thêm `go test ./...` với `WV_TEST_DATABASE_URL` trỏ vào một DB tạm riêng |
| `--list` | liệt kê các script sẽ chạy rồi thoát |

Biến do runner export luôn **đè** giá trị trong `api/.env` (`DATABASE_URL`, `CRON_SECRET`, `FILE_MASTER_KEY`, `PRIVATE_UPLOAD_ROOT`, `SESSION_SECRET`, `PORT`) — nhờ vậy suite không bao giờ ghi vào DB dev. Mỗi script tự tạo rồi tự xoá user test của mình (email `__go*test__@local.test`, xoá cascade).

### Suite bao gồm

| Script | Nội dung |
|---|---|
| `test_auth.sh` | register → login → me → sai mật khẩu → logout → token bị thu hồi, forgot-password |
| `test_change_password.sh` | change-password: sai current, confirm lệch, happy path, mật khẩu cũ hết hiệu lực |
| `test_devices.sh` | devices + warranty inline/EXTENDED + reminders (dismiss/restore) + xoá → 404 |
| `test_subscriptions.sh` | CRUD subscription, log payment, renew (payments + renewalDate), 404 sau xoá |
| `test_wishlist.sh` | CRUD wishlist, lịch sử giá, mark PURCHASED sinh Device |
| `test_reminders.sh` | 401/200, scope theo user, `withinDays` không hợp lệ → 400 |
| `test_attachments.sh` | upload PNG, list, tải file đúng số byte, MIME whitelist → 400, quá 5MB → 413, xoá → 404 |
| `test_catalog.sh` | catalog auth-gated + 4 mảng categories/brands/stores/warrantyProviders |
| `test_stats.sh` | seed fixture ở tầng DB rồi đối chiếu toàn bộ số liệu `/api/v1/stats` |
| `test_cron_flow.sh` | seed sub/wishlist quá hạn, gọi cron 2 lần, kiểm tra side-effect + idempotency ở tầng DB |
| `test_push.sh` | register/list/delete push subscription (web/apns/fcm), validate platform |
| `test_seed_dev.sh` | chạy `seed_dev.sql` qua `dbtool`: khớp schema, idempotent, đọc lại được qua API |
| `check_openapi_drift.sh` | kiểm tra tĩnh: route Go ↔ `openapi.yaml` (không cần server; bỏ qua nếu thiếu PyYAML) |

Log từng lần chạy nằm ở `api/tmp/e2e/run-*/logs/` (đã gitignore, runner tự dọn chỉ giữ 5 lần gần nhất).

Chạy một script lẻ khi đã có server + DB:

```bash
WV_BASE_URL=http://localhost:4000 \
DATABASE_URL='postgresql://trungit@localhost:5432/warranty_vault_dev' \
CRON_SECRET=... ./scripts/test_stats.sh
```

### Vì sao không có `psql`

Máy dev dùng Postgres 17 lấy từ zonky embedded binaries — chỉ có `initdb`/`pg_ctl`/`postgres`, **không kèm client `psql`**. Các fixture mà HTTP API không diễn tả được (`renewalDate` trong quá khứ, `lastNotifiedAt` 8 ngày trước, `status=EXPIRED`, hay đếm `SubscriptionPayment` sau khi cron chạy) đi qua `scripts/dbtool`: client SQL nhỏ viết bằng Go + `pgx` (driver sẵn có của module, không thêm dependency), in kết quả đúng định dạng `psql -tA`:

```bash
api/scripts/dbtool.sh -c 'SELECT count(*) FROM "User";'
api/scripts/dbtool.sh -q -c "DELETE FROM \"User\" WHERE email = 'x@y.z';"
api/scripts/dbtool.sh -v "user_id='<user-id>'" -f api/scripts/seed_dev.sql
```

`scripts/lib.sh` là phần dùng chung cho các script (nạp `.env` không ghi đè biến của runner, `wv_curl`/`wv_curl_status`, `wv_sql`, `assert`, `wv_summary`). Mỗi script giả một client IP riêng qua `X-Forwarded-For` để không đụng rate limit auth (10 register / 15 phút theo IP).

### Go test cần DB thật

`WV_TEST_DATABASE_URL` bật các test Go bị gate theo Postgres (migration goose, search `unaccent`/`pg_trgm`); không đặt thì chúng **skip im lặng**:

```bash
WV_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:55432/wv_test?sslmode=disable' go test ./...
```

`./scripts/e2e.sh --go-tests` làm việc này tự động với DB tạm do runner tạo và xoá.

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
├── scripts/         seed_dev.sql + e2e suite:
│                    e2e.sh (runner) · lib.sh (helpers) · dbtool/ (SQL client thay psql)
│                    check_openapi_drift.sh + test_*.sh
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

## Profile editing — email change is NOT supported

`PATCH /api/v1/auth/me` accepts exactly one field, `displayName` (trimmed, max 80 bytes; `null`/`""` clears it). It returns the same `{ "user": ... }` envelope as `GET /api/v1/auth/me` plus a Vietnamese `message`.

**The account email cannot be changed through the API.** There is no endpoint for it, `PATCH /api/v1/auth/me` rejects `email`/`newEmail` with a 400 `fieldErrors` entry saying so (rather than silently ignoring it), and `RegisterInput` is the only place an email is ever set. A real email change needs a two-step verified flow (prove control of the new address, then re-authenticate); it is deliberately out of scope for this pass. Do not add an email field to this endpoint as a shortcut — it would let a stolen bearer token silently move the account to an attacker-controlled address, which is exactly why the flow is gated on verification.

## Backups: attachments are metadata only

`GET /api/v1/backup/export` is JSON schema version 5 and contains attachment **metadata** (`fileName`, `fileType`, `fileSize`, `iv`, `wrappedKey`, `storagePath`) — never the encrypted blob bytes. Restoring onto a fresh server therefore does not bring invoice images back: the blobs live under `PRIVATE_UPLOAD_ROOT` and additionally need `FILE_MASTER_KEY` to decrypt. The payload states this itself via `includesAttachmentBytes: false` + `attachmentBytesNote` (Vietnamese) so clients warn from the data instead of hardcoding it. A zip-with-blobs format is deliberately deferred.

`POST /api/v1/backup/import` accepts any payload whose `version` falls in `[MinBackupVersion, BackupVersion]` (see `internal/services/backup.go`) rather than testing for equality: an equality check means a routine version bump instantly makes every backup a user already holds unimportable. Older versions import by letting added fields decode to their zero values; newer versions are refused with a Vietnamese message naming the received version.

