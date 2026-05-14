# Plan kế tiếp — chạy hết trong khi chờ Apple Dev / Firebase / VPS

> Ngữ cảnh: NEXT cũ (tomorrow plan) gần như xong trong working tree — `.gitignore`, dead-code `devices.ts`, Go route prefix `/api/v1/*`, push test endpoint, CLAUDE.md, iOS RegisterView, `docker-compose.yml`, 4 CI workflow. Tất cả còn uncommitted. Chỉ còn backup endpoint là TODO duy nhất.
>
> Bước tiếp theo nhắm vào: (a) đóng nốt Phase E, (b) chuẩn bị Phase F (decommission Next.js `/api/v1/*` + Prisma), (c) polish mobile + Go quality để khi có account/server là deploy được luôn.
>
> Ước tổng: **2-3 tuần part-time**. Order theo phụ thuộc.

---

## Block 0 — Đóng băng tiến trình hiện tại (30 phút)

### 0.1 Commit working tree
Status hiện tại có 30+ file modified + 5 untracked. Cần chia ít nhất 2 commit cho dễ revert:

1. `chore: ignore android/.kotlin cache + remove tracked salive` — chỉ `.gitignore` + file deleted.
2. `feat: finish NEXT day-1 — Go /api/v1 prefix, push test, register UI, docker-compose, CI` — phần còn lại.

Validate trước commit:
```bash
cd website && npm run lint && npx tsc --noEmit
cd ../api && go build ./... && go vet ./...
cd ../ios && swift build
```

### 0.2 Tag mốc
`git tag phase-e-mid` để có điểm rollback trước khi đụng vào Phase F.

---

## Block 1 — Đóng nốt Phase E (4-6h)

3 server action còn dùng Prisma trực tiếp (đếm theo `git grep "prisma\." website/src/app/actions/`):

### 1.1 Backup endpoint sang Go (~3h, #4b cũ)
File hiện tại: `website/src/app/actions/backup.ts` (537 dòng, comment TODO ở đầu).

Go side:
- `api/internal/store/queries/backup.sql` — query gom Device + Warranty + Reminder + Attachment + WishlistItem + WishlistPrice + Subscription + SubscriptionPayment cho 1 user (8 SELECT, không JOIN — để serialize riêng).
- `api/internal/services/backup.go`:
  - `Export(ctx, userID) (*BackupV1, error)` — trả struct map 1-1 với JSON schema hiện tại trong TS (`exportBackup()`).
  - `Import(ctx, userID, payload, mode 'merge'|'replace') error` — transactional. Mode `replace` xoá device/sub/wishlist của user trước. Validate `wrappedKey` length (32B + 16B GCM tag = 48B base64) trước khi insert Attachment.
- `api/internal/handlers/backup.go`:
  - `GET /api/v1/backup/export` — Bearer, stream JSON. Set `Content-Disposition: attachment; filename=warranty-vault-{userID}-{date}.json`.
  - `POST /api/v1/backup/import?mode=merge|replace` — Bearer, body là JSON file (max 50MB).
- Register routes ở `cmd/server/main.go`.

Web side:
- `website/src/lib/api/backup.ts` — typed client.
- Rewrite `website/src/app/actions/backup.ts` thành thin proxy (~60 dòng thay vì 537).
- Xoá toàn bộ logic Prisma + service.

OpenAPI:
- Thêm 2 endpoint vào `openapi.yaml`. Schema `BackupV1` reuse từ types đang export ở web.

Verify: `node website/scripts/test-backup-restore.mjs` phải pass sau khi update để gọi qua Go (file này hiện gọi action trực tiếp; có thể giữ nguyên vì action là proxy giờ).

### 1.2 Password reset confirm sang Go (~1h)
File: `website/src/app/actions/password-reset.ts:73-92` — `confirmReset()` còn đụng `prisma.passwordReset` + `prisma.user.update`.

Go side:
- `POST /api/v1/auth/reset-password` — body `{ token, newPassword }`. Service: find PasswordReset by `tokenHash`, check expire, transaction update user password + mark used + invalidate other reset tokens. Revoke tất cả Session của user (security).
- Reuse `rateLimitAuth` middleware (key `reset`, limit 5/15min).

Web side: rewrite `confirmReset()` proxy. Xoá Prisma import.

OpenAPI: thêm endpoint + ResetPasswordRequest schema.

### 1.3 Delete-account sang Go (~30 phút)
File: `website/src/app/actions/auth.ts:196-212` — `deleteAccount()` query devices để xoá `private-uploads/`, sau đó `prisma.user.delete()`.

Go side:
- `DELETE /api/v1/auth/me` — Bearer, transaction: xoá user (cascades qua schema), best-effort `os.RemoveAll(privateUploadRoot + "/" + userID)`.

Web: proxy + clear cookie + redirect.

---

## Block 2 — Phase F decommission Next.js `/api/v1/*` (1-2 ngày)

Sau Block 1, mobile và web đều gọi Go. Có thể xoá luôn legacy.

### 2.1 Audit parity Go vs Next.js `/api/v1` (~1h)
Script kiểm tra:
```bash
# List Go routes
grep -rh 'mux.HandleFunc\|RegisterReminders\|Register[A-Z][a-z]*' api/cmd/server/main.go api/internal/handlers/ | grep -oE '"[A-Z]+ /api/[^"]*"'

# List Next.js v1 routes
find website/src/app/api/v1 -name 'route.ts' | sed 's|website/src/app|→|; s|/route.ts||'
```

Mỗi route Next.js phải có route Go tương ứng. Nếu thiếu (vd: `/api/v1/reminders` hoặc backup mới làm) — thêm vào Go trước khi xoá Next.

### 2.2 Mobile smoke test với Go-only (~30 phút)
Tạm thời disable Next.js `/api/v1` bằng cách stub return 410. Build iOS + Android, login + CRUD device + upload attachment + list warranties. Pass → đảm bảo mobile không còn fallback nào về Next.

### 2.3 Xoá `website/src/app/api/v1/**` + cron route (~30 phút)
- `rm -rf website/src/app/api/v1`
- `rm -rf website/src/app/api/cron` (đã có `api/cmd/cron` + `POST /api/v1/cron/warranty-check` Go).
- Giữ `website/src/app/api/files/[id]/` — đây là proxy ra Go theo Phase E.4.

### 2.4 Xoá Prisma + services khỏi `website/` (~1h)
Tất cả file dưới đây phải gone nếu sau Block 1 không còn ai import:
```
website/src/lib/prisma.ts
website/src/lib/services/*
website/src/lib/files.ts         # Go xử lý encrypt; nhưng nếu /api/files proxy cần verify ownership, giữ thin version
website/src/lib/push-fanout.ts
website/src/lib/push-apns.ts
website/src/lib/push-fcm.ts
website/src/lib/push.ts          # giữ helpers VAPID nếu web push còn fanout từ Next; nếu Go làm thì xoá
website/src/lib/rate-limit*.ts
website/src/lib/email.ts
website/src/lib/queries.ts
website/src/lib/stats.ts
website/src/lib/warranty.ts      # chỉ giữ phần effectiveEndDate dùng cho RSC render
website/src/lib/api-auth.ts
website/src/lib/auth.ts          # downgrade: chỉ còn iron-session cookie + bearer extract
website/src/lib/session.ts       # giữ — vẫn dùng iron-session cho cookie
```

Trước khi xoá, chạy `git grep` import từng file. Nếu còn user → migrate user đó trước.

### 2.5 Xoá `website/prisma/`
- `rm -rf website/prisma`
- Update `website/package.json`: xoá `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg`, `bcrypt-ts`, `web-push`, `resend`, `sharp`. `npm i` lại.
- Xoá script `db:push`, `db:studio` khỏi `package.json`. Schema management từ giờ là `api/migrations/*.sql` qua goose.
- Update `prisma.config.ts` → xoá.

### 2.6 Xoá `website/scripts/test-*.mjs`
Move equivalent test sang `api/scripts/test_*.sh` (đa số đã có rồi). Kiểm tra `test-backup-restore.mjs` đã được Block 1.1 cover chưa.

### 2.7 Update CLAUDE.md cho Phase F
- Xoá hết phần Prisma layout, rate-limit, push fanout — chuyển thành "tất cả ở Go, xem `api/README.md`".
- Phần "Server actions wrap the Go API" giữ.
- Phần Vietnamese copy: `website/src/lib/types.ts` vẫn là source — note rõ.

Verify: `git grep -E '@prisma|prisma\.' website/` empty. `npm run build` ở `website/` xanh + bundle giảm rõ.

### 2.8 Tag mốc
`git tag phase-f-done`.

---

## Block 3 — Go API quality (1-2 ngày, song song được)

Mấy việc này không block deploy, nhưng làm trước thì ngày đầu prod yên tâm hơn.

### 3.1 Encrypted attachment interop test (~1h) [P]
- Lấy 1 file từ `private-uploads/` (encrypted by TS hiện tại) + biết plaintext hash từ DB.
- `api/internal/files/interop_test.go`: load `Attachment` row, decrypt bằng Go, sha256 plaintext, assert == hash gốc.
- Fixture: tạo dev user `__interop_test__@local.test`, upload 1 JPG biết trước qua TS, dùng làm fixture cho cả test Go và regression sau.

### 3.2 bcrypt cross-compat test (~30 phút) [P]
- Test: tạo user qua `POST /api/v1/auth/register` từ Go → login bằng TS action (cookie flow) → pass.
- Ngược lại: register qua server action TS (cũ) → login bằng Go bearer → pass.
- Code thành Go test, dùng `httptest`.
- Risk #3 trong `BACKEND_GO_PLAN.md` đóng.

### 3.3 Goose migration parity (~1h)
- `api/migrations/0001_initial.sql` đang là 1 file lớn. So sánh với `website/prisma/schema.prisma`:
  ```bash
  cd website && npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/prisma.sql
  diff /tmp/prisma.sql api/migrations/0001_initial.sql
  ```
- Hoà giải diff. Sau khi xoá Prisma ở Block 2.5, file `schema.prisma` không còn, nhưng làm bước này trước Block 2.5 để có ground truth.

### 3.4 `golangci-lint` config + fix warnings (~30 phút) [P]
- `api/.golangci.yml`: bật `errcheck`, `govet`, `staticcheck`, `unused`, `gosimple`, `ineffassign`, `gocritic`.
- `cd api && golangci-lint run` → fix tất cả. CI workflow `.github/workflows/api.yml` đã chạy lint chưa? Check.

### 3.5 OpenAPI drift check (~30 phút) [P]
Script CI:
```bash
# Extract Go route list
grep -hroE '"[A-Z]+ /api/[^"]+"' api/cmd/server/main.go api/internal/handlers/ | sort -u > /tmp/go-routes.txt

# Extract openapi paths
yq -r '.paths | keys[]' openapi.yaml | sort -u > /tmp/openapi-routes.txt

diff /tmp/go-routes.txt /tmp/openapi-routes.txt
```
Add vào `.github/workflows/api.yml` để CI fail nếu drift.

### 3.6 Cron idempotency test (~1h) [P]
- `api/scripts/test_cron_flow.sh` chạy được rồi (theo git status đã modified). Mở rộng:
  - Chạy `cmd/cron` 2 lần liên tiếp → `SubscriptionPayment` không duplicate.
  - Warranty notification sent 2 lần không spam push (cần `lastNotifiedAt` trên `Reminder`? Check schema).

---

## Block 4 — Mobile polish (2-3 ngày, song song được)

### 4.1 iOS — màn Settings push management (~2h) [P]
- `ios/App/Features/Settings/PushDevicesView.swift`: list `PushSubscription` của user (cần endpoint Go `GET /api/v1/push` — check `api/internal/handlers/push.go` đã có chưa, nếu chưa thì thêm).
- Unregister 1 device (xoá `PushSubscription` row).
- Test push từ Settings (gọi `POST /api/v1/push/test` đã làm xong ở Block trước).

### 4.2 iOS — change password screen (~1h) [P]
- `ios/App/Features/Settings/ChangePasswordView.swift`.
- Wire `POST /api/v1/auth/change-password`.
- Vietnamese copy mirror từ `website/src/components/settings/change-password-form.tsx`.

### 4.3 iOS — forgot password screen (~30 phút) [P]
- ForgotPasswordView.swift đã có rồi (check `ios/App/Features/Auth/`). Verify đã wire vào `POST /api/v1/auth/forgot` đúng chưa.
- Thêm screen reset (`/auth/reset?token=...`) nếu mobile có deep link. Bỏ qua nếu chỉ web nhận link.

### 4.4 iOS — Subscription detail + payment history (~2h) [P]
- `ios/App/Features/Subscriptions/SubscriptionDetailView.swift`.
- List `SubscriptionPayment` (cần endpoint `GET /api/v1/subscriptions/{id}/payments`).
- Manual renew button (`POST /api/v1/subscriptions/{id}/renew`).

### 4.5 iOS — Stats screen (~1.5h) [P]
- `ios/App/Features/Stats/StatsView.swift` — port từ `website/src/app/(app)/stats/page.tsx`.
- Charts: SwiftCharts (built-in iOS 16+).
- Endpoint `GET /api/v1/stats` đã có.

### 4.6 Android — toàn bộ items 4.1-4.5 (~6-8h) [P]
- `android/.../feature/settings/PushDevicesScreen.kt`, `ChangePasswordScreen.kt`.
- `android/.../feature/subscriptions/SubscriptionDetailScreen.kt`.
- `android/.../feature/stats/StatsScreen.kt` — Compose `androidx.compose.foundation` cho chart basic, hoặc dep `vico` nếu muốn đẹp.
- Setup `google-services.json` placeholder để build pass (KHÔNG cần Firebase project — chỉ cần stub file để Gradle plugin ko crash). Note: real FCM register chờ Block 6.

### 4.7 Vietnamese label parity (~30 phút) [P]
Diff:
```bash
# extract labels
node -e 'console.log(JSON.stringify(require("./website/src/lib/types.ts").DEVICE_STATUS_LABEL))'
# vs
grep "DEVICE_STATUS_LABEL\|deviceStatusLabel" ios/Sources/WarrantyVaultKit/Models.swift
grep "deviceStatusLabel" android/app/src/main/java/com/warrantyvault/core/network/Models.kt
```
Sync nếu lệch. Mỗi enum: DEVICE_STATUS, WARRANTY_TYPE, BILLING_CYCLE, WISHLIST_STATUS, SUB_STATUS.

---

## Block 5 — Web polish + bundle (2-3h)

### 5.1 Web bundle audit (~30 phút)
Sau Block 2.5 (xoá Prisma + sharp + web-push + resend):
```bash
cd website && npm run build 2>&1 | tail -50
# So với pre-Phase-F (commit 55417d6 hoặc 57938d8 sau khi rebase) — expect giảm >10MB
```

### 5.2 Effective end-date test (~1h)
- Thêm `vitest` vào `website/`:
  ```bash
  cd website && npm i -D vitest @vitest/ui
  ```
- `website/src/lib/__tests__/warranty.test.ts` — cover các case `effectiveEndDate()`:
  - 0 warranty
  - 1 STANDARD active
  - 1 STANDARD + 1 EXTENDED kéo dài hơn
  - 1 dismissed reminder → vẫn tính
  - Tất cả expired
- Script `npm test` chạy vitest.
- CI: add step vào `.github/workflows/website.yml`.

### 5.3 RSC streaming check (~30 phút)
Sau khi mọi page hit Go API qua server action, mỗi dashboard render giờ là 1 fetch RTT extra. Đo:
```bash
cd website && npm run build && npm run start
# trong terminal khác: curl -w "%{time_total}\n" -o /dev/null -s -b "wv_session=..." http://localhost:3000/dashboard
```
Nếu >500ms → check parallel `Promise.all` ở RSC page (`dashboard/page.tsx`, `stats/page.tsx`). Cần `await Promise.all([api.devices.list(), api.subs.list(), api.wishlist.list()])` thay vì sequential.

---

## Block 6 — Pre-deploy prep (2h, không bấm trigger)

Mấy việc này soạn sẵn, chờ có server + account là chạy.

### 6.1 Reverse proxy config (~30 phút)
- `deploy/caddy/Caddyfile` (chưa có):
  ```
  api.warrantyvault.tld {
    reverse_proxy api:4000
  }
  warrantyvault.tld {
    reverse_proxy web:3000
  }
  ```
- Lưu dưới `deploy/` ở root. README ngắn cách up trên Hetzner / DigitalOcean.

### 6.2 `.env.example` cross-check (~30 phút)
- `api/.env.example` — đã modified, recheck đủ: `DATABASE_URL`, `SESSION_SECRET`, `FILE_MASTER_KEY`, `PRIVATE_UPLOAD_ROOT`, `CRON_SECRET`, `VAPID_*`, `APNS_*`, `FCM_SERVICE_ACCOUNT_JSON`, `RESEND_API_KEY`, `UPSTASH_*`, `WEB_URL`, `PORT`.
- `website/.env.example` — recheck: chỉ còn `GO_API_URL`, `SESSION_SECRET` (cho iron-session cookie), `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (web push subscribe ở client).
- Mọi env Prisma (`DATABASE_URL` ở web) xoá sau Block 2.5.

### 6.3 systemd unit cho cron (~30 phút)
- `deploy/systemd/warranty-vault-cron.service` + `.timer`.
- Daily 09:00 Hanoi (`OnCalendar=*-*-* 02:00:00` UTC).
- `ExecStart=/usr/bin/docker exec wv-api /app/cron`.

### 6.4 README root update (~30 phút)
- Phần "Tech stack" — note Go là backend chính.
- Phần "Quick start" — `docker compose up --build` từ root.
- Link sang `api/README.md`, `BACKEND_GO_PLAN.md`, `MOBILE_PLAN.md`.

---

## Validation cuối cùng (trước khi đi ngủ mỗi ngày)

- [ ] `cd website && npm run lint && npx tsc --noEmit && npm run build` xanh
- [ ] `cd website && npm test` xanh (sau Block 5.2)
- [ ] `cd api && go build ./... && go vet ./... && go test ./... && golangci-lint run` xanh
- [ ] `cd ios && swift build` xanh
- [ ] `cd android && ./gradlew :app:assembleDebug` xanh
- [ ] `docker compose up --build` → cả `web`, `api`, `postgres` healthz
- [ ] `git grep -E "@prisma|prisma\." website/` empty (sau Block 2.5)
- [ ] `git status` clean

---

## Defer hẳn (chờ account/server)

| Việc | Chờ gì |
|---|---|
| Apple Developer Program + APNs cert (.p8) | $99/năm + verify identity |
| Firebase project + service account JSON | Google account + Firebase Console setup |
| VPS deploy (Hetzner CX22 hoặc DO droplet $6/mo) | Card + DNS |
| Domain + Caddy TLS | Mua domain |
| TestFlight beta + Play Console internal track | Apple/Google account |
| Real-device push end-to-end | All of the above |
| Production rate-limit Upstash (free tier ok) | Upstash signup |
| Email Resend prod key (free tier ok) | Resend signup |
| Sentry prod DSN (optional) | Sentry signup |

---

## Effort estimate

| Block | Effort |
|---|---|
| 0 — Đóng băng + commit | 30 min |
| 1 — Đóng Phase E (3 action còn lại) | 4-6h |
| 2 — Phase F decommission | 1-2 ngày |
| 3 — Go API quality (parallel) | 1-2 ngày |
| 4 — Mobile polish (parallel) | 2-3 ngày |
| 5 — Web polish + bundle | 2-3h |
| 6 — Pre-deploy prep | 2h |
| **Tổng** | **~2-3 tuần part-time** |

Khi 6 block xong, ngày có account/server chỉ cần:
1. `scp .env.production` lên VPS.
2. `git pull && docker compose up -d --build`.
3. `docker compose run --rm --entrypoint /app/migrate api up`.
4. Caddy DNS A record → IP.
5. Apple/Firebase keys → `.env` → restart.

Không còn code phải viết. Đó là target.
