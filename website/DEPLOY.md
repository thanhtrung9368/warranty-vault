# Deploy web UI (WarrantyVault)

Web này là **frontend mỏng**: nó không có DB, không giữ state, không cron — mọi thứ nằm ở Go API ([`../api`](../api)). Vì vậy có 2 kiểu deploy:

1. **Full stack trên 1 VPS** (khuyến nghị) — Caddy + Docker Compose (postgres + api + cron + web) + systemd timer cho cron. Xem [`../deploy/README.md`](../deploy/README.md).
2. **Web-only** — host chỉ chạy Next.js, trỏ `GO_API_URL` sang Go API đã deploy ở chỗ khác (VPS khác, Fly.io, Render, Railway…). Hướng dẫn dưới đây.

> Deploy web một mình **không đủ**: không có Go API thì mọi trang app đều lỗi (web chỉ proxy sang Go). Postgres, migrations (goose), attachments, push, email, cron đều thuộc Go.

## Bước 1 — Chuẩn bị Go API trước

Deploy `api/` + Postgres theo [`../deploy/README.md`](../deploy/README.md) (hoặc host Go bất kỳ). Kiểm tra:

```bash
curl -sf https://api.<domain>/healthz   # {"ok":true}
curl -sf https://api.<domain>/readyz    # {"ok":true} khi ping được DB
```

Trên Go phải set `WEB_URL=https://<domain>` (CORS allowlist cho browser gọi API) và `APP_URL=https://<domain>` (link reset password trong email trỏ về web).

## Bước 2 — Set env cho web

| Biến | Bắt buộc | Giá trị |
|---|---|---|
| `GO_API_URL` | ✅ | Base URL của Go API **kèm prefix `/api`**, **không** có dấu `/` cuối — vd `https://api.<domain>/api`. `src/lib/api/*` nối thêm `/v1/...` còn Go phục vụ `/api/v1/*`, nên thiếu `/api` là mọi request 404 |
| `SESSION_SECRET` | ✅ | Random ≥32 ký tự: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Đổi = logout toàn bộ user web |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | optional | Cùng public key với `VAPID_PUBLIC_KEY` ở Go. **Phải có lúc BUILD**, không phải runtime — Next inline biến `NEXT_PUBLIC_*` vào client bundle. Đổi key = build lại |

Không cần `DATABASE_URL`, `FILE_MASTER_KEY`, `CRON_SECRET`, `RESEND_*`, `VAPID_PRIVATE_KEY` ở web — đó là env của Go (xem `api/.env.example`). Web cũng **không** cần object storage (Vercel Blob/S3): attachments đã nằm (mã hoá) trên đĩa của Go.

**Lưu ý:**
- `SESSION_SECRET` của web độc lập với `SESSION_SECRET` của Go — Go chỉ validate độ dài ≥32 ký tự, không đọc cookie `wv_session`.
- `GO_API_URL` phải reachable **từ server** chạy Next.js (server actions fetch), không phải từ browser.
- ⚠️ **Proxy file đang lệch path** (tính đến lúc viết): `src/app/api/files/[id]/route.ts` gọi `${GO_API_URL}/v1/files/{id}` → `/api/v1/files/{id}`, trong khi Go chỉ có `GET /api/files/{id}` (xem `api/internal/handlers/attachments.go`). Attachment xem/tải qua web vì vậy trả 404 cho tới khi proxy đổi thành `${GO_API_URL}/files/{id}`. Đây là bug ở code web, không phải env.

## Bước 3 — Build + chạy

```bash
npm ci
npm run build
npm run start        # Next production server, mặc định :3000
```

Hoặc build Docker image của web (root compose đã làm sẵn — `docker compose up -d --build web`). `NEXT_PUBLIC_VAPID_PUBLIC_KEY` truyền qua build arg/compose `args:`, không phải `environment:`.

Với host PaaS (Vercel/Fly/Render/Railway): set env ở dashboard, build command `npm run build`, start command `npm run start`. Web stateless nên host nào chạy Node 20+ cũng được.

## Bước 4 — Cron

**Cron không chạy ở web.** Nó là `api/cmd/cron` và cũng expose ở `POST /api/v1/cron/warranty-check` (auth bằng `Authorization: Bearer $CRON_SECRET` hoặc `?secret=`). Schedule bằng systemd timer ([`../deploy/README.md`](../deploy/README.md)), GitHub Actions, hoặc cron của host.

> ✅ `website/vercel.json` **đã bị xoá.** File đó khai báo cron `/api/cron/warranty-check`,
> một route đã bị gỡ từ Phase F — nếu deploy web lên Vercel thì nó chỉ gọi vào 404 mỗi ngày.
> Cron giờ chỉ có một nguồn duy nhất là Go, như mô tả ở trên.

## Bước 5 — Verify

```bash
curl -sIf https://<domain>/login                        # 200 = Next.js sống
curl -s https://api.<domain>/readyz                     # Go + DB sống
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://api.<domain>/api/v1/cron/warranty-check       # cron chạy tay được
```

Checklist:

- [ ] `GO_API_URL` trỏ đúng Go API và reachable từ server web
- [ ] `SESSION_SECRET` random ≥32 ký tự, unique production
- [ ] `NEXT_PUBLIC_VAPID_PUBLIC_KEY` set **lúc build** (nếu dùng push) và khớp `VAPID_PUBLIC_KEY` ở Go
- [ ] `WEB_URL` + `APP_URL` bên Go trỏ đúng domain web (CORS + link reset password)
- [ ] Migrations đã chạy ở Go (`go run ./cmd/migrate up` / image `migrate`)
- [ ] Test: đăng ký → nhận email reset → đặt lại mật khẩu → đăng nhập → tạo device → upload hoá đơn → bật push

## Rollback

Web stateless nên rollback = deploy lại bản build trước (Vercel: Deployments → Promote; VPS: `git checkout <sha>` + `docker compose up -d --build web`). DB/attachments rollback là việc của Go/Postgres — xem [`../deploy/README.md`](../deploy/README.md).
