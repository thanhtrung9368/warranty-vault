# Warrly API (Go)

Standalone Go service that owns the Warrly backend: REST API under `/api/v1/*` (file streaming at `/api/files/{id}`), push fanout, and the cron worker. Web (`website/`) and mobile (`ios/`, `android/`) are pure clients of this service. See `../BACKEND_GO_PLAN.md` for the full migration plan.

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

### Timestamps are UTC

Every `timestamp without time zone` column stores a UTC value. `internal/dbconn`
pins `timezone=UTC` in the connection startup parameters for `cmd/server`,
`cmd/cron` and `cmd/migrate` (`scripts/dbtool` pins the same parameter itself),
and each service entrypoint calls `AssertUTC` before writing anything. **Do not add another entrypoint that calls
`pgxpool.New`/`sql.Open` directly** — use `dbconn.NewPool` / `dbconn.OpenSQL`, and
remember that pgx encodes a local `time.Time` as its local wall clock even when
the session is UTC (normalise with `.UTC()` for instant columns; calendar dates
from `parseDate` are already UTC midnight).

### Timestamps on the wire

`pgtype.Timestamp` marshals as a *zoneless* RFC 3339 string, which violates
`openapi.yaml`'s `format: date-time` and is read as local time by JavaScript
clients. Every timestamp column is therefore generated as one of the two scalars
in `internal/wire` (mapped by the overrides in `sqlc.yaml`):

* `wire.Instant` — a point in time, JSON `2026-10-19T13:03:39.428Z`
  (`format: date-time`). This is the default for a new timestamp column.
* `wire.Day` — a calendar day, JSON `2026-10-19` (`format: date`). The fourteen
  date-only columns are listed explicitly in `sqlc.yaml`; a day has no timezone,
  so no client can move a warranty's end date by applying one.
  `internal/wire/wire_test.go` fails when a timestamp column is neither an
  Instant nor in that inventory.

Do not hand-format timestamps in a response DTO — the model's type is the
contract.

### Calendar days use the process-local day (and the image pins it)

The instant/day rule above is about the *wire*. The **business calendar** is
separate: the reminder window (`services.ListUpcomingReminders`), the
return-window countdown, the action queue and the cron buckets all derive
"today" from `time.Local`. That is deliberate — a date-only column is the day
the user picked, so it must be compared against the day the user is living in,
not UTC.

The shipped image therefore sets `TZ=Asia/Ho_Chi_Minh` (`api/Dockerfile`),
which encodes the product assumption: **server-computed relative days are
Vietnamese days**. A user in another timezone gets Vietnamese days from those
fields until the API grows a per-user timezone; a client's own `YYYY-MM-DD`
arithmetic is unaffected. `TZ` is an ordinary image default and can be
overridden at runtime (`docker run -e TZ=…`, or `environment: TZ: …` in
compose) — but it must stay consistent with the date-only columns' calendar,
because changing it moves the cron buckets and all four local-day comparisons
together. A mismatch between the process day and the user's day silently shifts
notification days, and reopens the duplicate-push window the `notifiedSince`
bound closed. DB sessions stay UTC regardless (`dbconn` forces
`timezone=UTC`), so `TZ` changes only which calendar day the service reasons
about, never what it stores. Running the binary outside Docker needs the same
`TZ=Asia/Ho_Chi_Minh` in its environment.

Migration `0024_utc_timestamp_baseline.sql` corrects legacy rows. It classifies
each row from the millisecond clock embedded in its cuid id, shifts only the rows
that provably used the +07 wall clock, records them in
`WVUTCTimezoneCorrected`, and lists unverifiable (non-cuid) rows in
`WVUTCTimezoneSkipped` instead of guessing. It refuses to run twice and aborts on
an offset that is neither UTC nor +07.

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
| `check_openapi_drift.sh` | kiểm tra tĩnh: route Go ↔ `openapi.yaml` **và** field set của mọi request struct giải mã strict ↔ schema tương ứng (không cần server; cần PyYAML) |
| `check_request_field_drift.py` | phần request-shape của script trên: quét mọi `decodeJSON(r, &x)`, so json tag của struct với `components.schemas` (raw-map decoder phải nằm trong allowlist) |

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

## OCR text search (migration 0019)

`POST /api/v1/ai/extract-receipt` now keeps the text the model read. On the
`attachmentId` branch it is written to `Attachment.extractedText`; the multipart
branch has no attachment to own it, so it returns `draft.extractedText` but stores
nothing (`draft.extractedTextStored: false`). Clients that want a scanned receipt
to be searchable upload it first (`POST /api/v1/attachments`, optionally as an
inbox item) and then call the OCR endpoint with that id.

`GET /api/v1/search` returns a fourth group, `attachments`, matched by the same
`lower(public.wv_unaccent(...))` expression and GIN trigram index as the device
search; the index expression in migration 0019 and the predicate in
`internal/store/queries/search.sql` must stay byte-for-byte identical.

**Privacy:** the blob stays AES-256-GCM encrypted, but `extractedText` is
**plaintext in Postgres** — the trigram index has to read the unaccented value.
The write only happens after the user opts in to AI, every read is owner-scoped,
and the text is deliberately **not** included in backups (it is a derived search
projection; see `openapi.yaml` → `BackupV1`). The value is trimmed, NUL-free and
capped at 8000 runes before it is stored or returned.

## Inbound email — the mail path into the inbox (migration 0020)

`POST /api/v1/inbox/email` lets a mail provider drop a receipt's attachments into
the capture-first inbox with no device and no Warrly session. The owner has not
picked a provider, so the contract is **neutral by design**: the server defines
the shape (multipart primary, JSON + base64 secondary) instead of speaking any
vendor's webhook schema. See `openapi.yaml` for the full contract.

- **Auth.** Header `X-Warrly-Inbox-Token` must equal `INBOX_EMAIL_TOKEN`
  (constant-time; neither value is logged). There is no bearer token. If either
  `INBOX_EMAIL_TOKEN` or `INBOX_EMAIL_DOMAIN` is unset the endpoint answers
  `503 feature_disabled` and the server still boots.
- **Routing.** The recipient must be `<inboxToken>@<INBOX_EMAIL_DOMAIN>`. The
  local part is a 122-bit secret generated by the DB (migration 0020), not derived
  from the user's id/email/name. Every failure — wrong token, wrong domain,
  malformed address, deleted account — is the same 404 body; the endpoint is not
  an enumeration oracle. The address is exposed as `user.inboxAddress` in
  `GET /api/v1/auth/me` (and the login/register responses) and omitted entirely
  while the feature is unconfigured.
- **Storage.** Each attachment calls the same `services.Upload` as
  `POST /api/v1/attachments` with `deviceId = NULL`: same `Attachment` row, same
  AES-256-GCM blob under `_inbox/`, same MIME whitelist, 5 MB/file and 100 MB/user
  caps. A refused part is reported in `skipped[]` with its reason (and the shared
  upload message) while the other parts are stored; the response is 200 once the
  recipient resolves.
- **Limits.** 10 attachment parts per message (≤50 MB, half the per-user ceiling),
  a 55 MB multipart / 70 MB JSON envelope, and 60 requests / 15 min / IP.
- **No dedupe.** The neutral shape has no message id, so a provider retry will
  duplicate what already landed. This is documented rather than guessed at.
- **Backup.** `User.inboxToken` is deliberately not exported: the payload has no
  `User` object, and the token is an append-only credential that must not be
  copied into backup files (see `openapi.yaml` → `BackupV1`).

To go live, point a provider's inbound webhook at
`https://<api-host>/api/v1/inbox/email`, add the MX record the provider gives you
for `INBOX_EMAIL_DOMAIN`, set both env vars, and configure the provider to POST
**multipart/form-data** (or its JSON equivalent) with `to`, `from`, `subject` and
one `attachment` part per file.

Two operator steps live outside `api/` and are easy to miss: run migration
`0020` before deploying the new binary, and raise the reverse-proxy body cap for
this route. `deploy/caddy/Caddyfile` currently applies
`request_body { max_size 10MB }` to the whole API host, which is large enough for
the existing 5 MB single-file upload but **not** for a multi-attachment email
(the handler accepts up to 55 MB multipart / 70 MB JSON). Cloudflare's proxy also
needs a WAF skip for this path if the API host is orange-clouded, because a
managed challenge would block the mail worker's server-to-server POST.

## Profile editing — email change is NOT supported

`PATCH /api/v1/auth/me` accepts exactly one field, `displayName` (trimmed, max 80 bytes; `null`/`""` clears it). It returns the same `{ "user": ... }` envelope as `GET /api/v1/auth/me` plus a Vietnamese `message`.

**The account email cannot be changed through the API.** There is no endpoint for it, `PATCH /api/v1/auth/me` rejects `email`/`newEmail` with a 400 `fieldErrors` entry saying so (rather than silently ignoring it), and `RegisterInput` is the only place an email is ever set. A real email change needs a two-step verified flow (prove control of the new address, then re-authenticate); it is deliberately out of scope for this pass. Do not add an email field to this endpoint as a shortcut — it would let a stolen bearer token silently move the account to an attacker-controlled address, which is exactly why the flow is gated on verification.

## Backups: attachments are metadata only

`GET /api/v1/backup/export` is JSON schema version 5 and contains attachment **metadata** (`fileName`, `fileType`, `fileSize`, `iv`, `wrappedKey`, `storagePath`) — never the encrypted blob bytes. Restoring onto a fresh server therefore does not bring invoice images back: the blobs live under `PRIVATE_UPLOAD_ROOT` and additionally need `FILE_MASTER_KEY` to decrypt. The payload states this itself via `includesAttachmentBytes: false` + `attachmentBytesNote` (Vietnamese) so clients warn from the data instead of hardcoding it. The opt-in `.zip` export (`?includeBlobs=true`, `data.json` version 6) carries the encrypted bytes and flips the note accordingly. The OCR transcript (`Attachment.extractedText`, migration 0019) is **not** exported either: it is a derived search projection, it would invalidate the metadata-only note above, and the ZIP format can regenerate it by re-running OCR on the restored blob.

Both exports record `instantTimeZone: "UTC"` (additive; the JSON version stays 5). A payload **without** that marker predates the UTC fix and may contain local-wall-clock instants that the old JSON printed with a `Z` suffix, so its instant columns can be 7 hours off. Import restores such a file **unchanged** and reports the caveat in `ImportResult.warnings`; it never guesses an offset, because migration `0024` exists precisely because a blanket shift corrupts rows that were already correct.

`POST /api/v1/backup/import` accepts any payload whose `version` falls in `[MinBackupVersion, BackupVersion]` (see `internal/services/backup.go`) rather than testing for equality: an equality check means a routine version bump instantly makes every backup a user already holds unimportable. Older versions import by letting added fields decode to their zero values; newer versions are refused with a Vietnamese message naming the received version.

