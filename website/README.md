# WarrantyVault — Web UI

Web app cá nhân để theo dõi thiết bị, bảo hành, gói đăng ký phần mềm và danh sách "thèm". Multi-user, tiếng Việt 100%.

> **Đây là frontend mỏng.** Backend canonical là Go service ở [`../api`](../api) — web không có DB, không Prisma, không cron route, không business logic. Mọi read/write đi qua typed client `src/lib/api/*` (fetch tới `GO_API_URL`), và Go là thứ duy nhất nói chuyện với Postgres. Đọc thêm [`../api/README.md`](../api/README.md) + [`../CLAUDE.md`](../CLAUDE.md).

## Tech stack

- **Next.js 16** (App Router) + **TypeScript** + **React 19**
- **Tailwind CSS** + shadcn/ui-style primitives trong `src/components/ui` + **lucide-react**
- **iron-session** cookie `wv_session` — chỉ giữ bearer token + expiry do Go cấp; identity lấy lại từ `GET /api/v1/auth/me` mỗi request
- **recharts** (biểu đồ), **sonner** (toast), **next-themes** (dark mode)
- **Zod** chỉ dùng cho form auth public (`actions/auth.ts`, `actions/password-reset.ts`). Validate nghiệp vụ, rate limit, push fanout, email, cron: **tất cả ở Go**
- Không còn `prisma`, `pg`, `bcrypt-ts`, `web-push`, `resend`, `sharp` trong `package.json` — đừng thêm lại

## Tính năng

- Đăng ký/đăng nhập nhiều user, dữ liệu mỗi user riêng (Go giữ session + bearer token)
- **Thiết bị** — CRUD (laptop, điện thoại, đồ gia dụng, …) với ngày mua, giá, nơi mua
- **Bảo hành nhiều lớp** — mỗi thiết bị có thể có nhiều gói (chính hãng, mở rộng, bên thứ 3); ngày hết BH hiệu lực = max(endDate)
- **Đăng ký phần mềm** — Apple One, ChatGPT Plus, iCloud+, … với chu kỳ Hàng tháng / Quý / Năm / Lifetime / Tuỳ chỉnh; cron (Go) tự ghi log thanh toán + cảnh báo trước renewal 3 / 1 / 0 ngày
- **Wishlist ("đồ thèm")** — track sản phẩm muốn mua, lịch sử giá theo thời gian, ngày dự kiến mua, ping định kỳ N ngày; khi flip sang "đã mua" thì Go tự tạo Device trong cùng transaction
- **Upload hoá đơn/phiếu BH** — ảnh + PDF, tối đa 5MB × 5 file/device; Go mã hoá AES-256-GCM trên đĩa (`FILE_MASTER_KEY`) và tự resize ảnh ≤1600px. Web chỉ proxy byte stream qua `/api/files/[id]` để cookie auth hoạt động trong browser
- Gọi trung tâm BH (tel:) + mở Google Maps 1 chạm
- Catalog dùng chung: loại sản phẩm, hãng, nơi mua, trung tâm BH — admin sửa trong DB (Go), web đọc qua `GET /api/v1/catalog` và autofill khi tạo device/sub
- Thống kê: biểu đồ cột chi phí 12 tháng, pie theo loại, top 5 đắt nhất, chi phí sub quy đổi theo tháng
- **Landing page** + Privacy / Terms / Cookies public
- **PWA** — cài được lên điện thoại
- **Push notification** — BH sắp hết, sub sắp gia hạn, wishlist tới ngày dự kiến — dù tab đóng (fanout nằm ở Go)
- **Quên mật khẩu** qua email + đổi mật khẩu trong settings
- Backup/restore JSON (export/import qua Go)
- Dark mode

## Chạy local

Web cần **Go API + Postgres 17** chạy trước. Nhanh nhất là dùng stack Docker ở root repo (postgres + api + cron + web):

```bash
cd ..
cp api/.env.example .env    # điền SESSION_SECRET, FILE_MASTER_KEY, CRON_SECRET, …
docker compose up -d --build
docker compose run --rm --entrypoint /app/migrate api up   # migrate lần đầu
```

Hoặc chạy Go API tay (xem [`../api/README.md`](../api/README.md)):

```bash
cd ../api
cp .env.example .env        # tối thiểu DATABASE_URL
go run ./cmd/migrate up     # schema (goose migrations, không phải prisma)
go run ./cmd/server         # :4000
```

Rồi chạy web:

```bash
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # SESSION_SECRET

npm run dev
# → http://localhost:3000
```

Schema + catalog không do web quản lý: migrations ở `../api/migrations/*.sql`, seed catalog dev bằng `psql "$DATABASE_URL" -v user_id="'<user-id>'" -f ../api/scripts/seed_dev.sql`.

### Scripts

| Lệnh | Việc |
|---|---|
| `npm run dev` | Next dev server (`http://localhost:3000`) |
| `npm run build` | `next build` |
| `npm run start` | serve production build — **bắt buộc** để service worker / web push chạy |
| `npm run lint` | `eslint .` (eslint-config-next, flat config) |
| `npm test` | `vitest run` — unit tests trong `src/lib/__tests__/` |

CI (`.github/workflows/website.yml`) chạy `lint` → `tsc --noEmit` → `npm test` → `npm run build`.

### Truy cập

- `/` — landing page (public)
- `/register`, `/login`, `/forgot`, `/reset/[token]` — auth flows (public)
- `/dashboard` — tổng quan (sau khi login)
- `/devices`, `/subscriptions`, `/wishlist`, `/reminders`, `/stats`, `/settings` — các trang app
- `/privacy`, `/terms`, `/cookies` — public legal pages

### Bật push notification (local)

1. Set VAPID ở **Go**: `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (+ `VAPID_SUBJECT`) trong `api/.env` — thiếu một trong hai key thì mọi lần gửi web push fail với `web push not configured` (cron đếm vào `pushesFailed`, subscription không bị xoá).
2. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` ở `website/.env` phải là **cùng public key**, và phải có **lúc build** (Next inline biến `NEXT_PUBLIC_*` vào client bundle — đổi key = build lại).
3. `npm run build && npm run start` — service worker chỉ chạy bản production.
4. Vào Settings → "Bật thông báo" → cho phép → bấm "Gửi thử".

### Test cron

Cron không còn trong web — nó là `api/cmd/cron` (hoặc `POST /api/v1/cron/warranty-check` trên Go):

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:4000/api/v1/cron/warranty-check
# hoặc: curl "http://localhost:4000/api/v1/cron/warranty-check?secret=$CRON_SECRET"
```

Response: `{ ok, checkedAt, stats: { warrantyNotices, wishlistTargetHits, wishlistCheckins, subscriptionRenewals, subscriptionExpired, sessionsPruned, pushesSent, pushesFailed, pushesGone } }`.

## Chạy bằng Docker

Dùng stack đầy đủ ở root repo: [README.md → Quick start (Docker)](../README.md#quick-start-docker). Root `docker-compose.yml` chạy `postgres + api + cron + web` (service `web`, trỏ `GO_API_URL` vào service `api`) và share volume `/data` cho encrypted attachments.

> ⚠️ `docker-compose.yml` **trong thư mục này** là bản cũ từ thời Prisma (chỉ có `db` + `app`, không có Go API và không set `GO_API_URL`) — không dùng nữa.
>
> ⚠️ Root compose hiện set `GO_API_URL: http://api:4000` — **thiếu `/api`**, nên web sẽ gọi `/v1/...` và bị 404. Giá trị đúng là `http://api:4000/api` (xem mục Environment variables).

## Cấu trúc

```
src/
├── app/
│   ├── (app)/              # protected routes — layout gọi requireUser()
│   │   ├── dashboard/  devices/{,new,[id],[id]/edit}/
│   │   ├── subscriptions/{,new,[id],[id]/edit}/
│   │   ├── wishlist/{,new,[id],[id]/edit}/
│   │   └── reminders/  stats/  settings/
│   ├── (auth)/             # public auth routes
│   │   └── login/  register/  forgot/  reset/[token]/
│   ├── (public)/           # public legal pages
│   │   └── privacy/  terms/  cookies/
│   ├── api/files/[id]/     # HTTP route duy nhất: proxy byte stream sang Go
│   ├── actions/            # server actions ('use server') — thin Go proxy
│   │   ├── auth.ts  password-reset.ts  catalog.ts  ai.ts
│   │   ├── devices.ts  warranties.ts  attachments.ts
│   │   └── subscriptions.ts  wishlist.ts  reminders.ts  push.ts  backup.ts
│   ├── offline/
│   ├── page.tsx            # landing
│   └── layout.tsx          # root layout (theme, PWA register, toaster)
├── components/
│   ├── ui/                 # shadcn-style primitives
│   └── (feature components — device-form, subscription-form, push-settings, …)
└── lib/
    ├── api/                # typed client cho Go REST (client.ts + từng resource)
    ├── auth.ts             # requireUser / getCurrentUser (GET /v1/auth/me)
    ├── auth-cookie.ts      # iron-session cookie (SESSION_SECRET) + bearerHeader()
    ├── warranty.ts  subscription-types.ts  wishlist-types.ts  types.ts  format.ts
    └── __tests__/          # vitest unit tests

public/
├── manifest.webmanifest    # PWA manifest
├── sw.js                   # Service worker (push + offline)
└── icon*.png / icon.svg    # App icons
```

## Environment variables

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `GO_API_URL` | ✅ | Base URL của Go API **kèm prefix `/api`** — vd `http://localhost:4000/api`. `src/lib/api/*` nối thêm `/v1/...` còn Go phục vụ `/api/v1/*`, nên thiếu `/api` là mọi request 404. Root compose hiện set `http://api:4000` (thiếu `/api`) |
| `SESSION_SECRET` | ✅ | ≥32 ký tự, mã hoá cookie `wv_session`. Đổi = logout toàn bộ user web. **Không cần trùng** với `SESSION_SECRET` của Go (Go chỉ validate độ dài, không đọc cookie) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | optional | Public key web push, phải khớp `VAPID_PUBLIC_KEY` ở Go. Inline lúc **build**, không phải runtime |

Chi tiết + comment: xem `.env.example`.

## Deploy

- Self-host VPS (Caddy + systemd + Docker Compose): [`../deploy/README.md`](../deploy/README.md).
- Web-only (Node host / Vercel) trỏ vào Go API đã deploy: [`DEPLOY.md`](./DEPLOY.md).
