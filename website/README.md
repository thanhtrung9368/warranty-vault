# WarrantyVault

Web app cá nhân để theo dõi thiết bị, bảo hành, gói đăng ký phần mềm và danh sách "thèm". Multi-user, tiếng Việt 100%.

## Tech stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript** + **React 19**
- **Tailwind CSS** + **shadcn/ui** + **lucide-react**
- **Prisma 7** (driver adapter `@prisma/adapter-pg` + `pg`) + **PostgreSQL 17**
- Auth: **iron-session** cookie + **bcrypt-ts** (pure JS)
- Push: **web-push** (VAPID, free) + Service Worker
- Email: **Resend** (optional, free 3K/tháng — không set thì reset link in ra console)
- Charts: **recharts**

## Tính năng

- Đăng ký/đăng nhập nhiều user, dữ liệu mỗi user riêng
- **Thiết bị** — CRUD (laptop, điện thoại, đồ gia dụng, …) với ngày mua, giá, nơi mua
- **Bảo hành nhiều lớp** — mỗi thiết bị có thể có nhiều gói (chính hãng, mở rộng, bên thứ 3); ngày hết BH hiệu lực = max(endDate)
- **Đăng ký phần mềm** — Apple One, ChatGPT Plus, iCloud+, … với chu kỳ Hàng tháng / Quý / Năm / Lifetime / Tuỳ chỉnh; cron tự ghi log thanh toán + cảnh báo trước renewal 3 / 1 / 0 ngày
- **Wishlist ("đồ thèm")** — track sản phẩm muốn mua, lịch sử giá theo thời gian, ngày dự kiến mua, ping định kỳ N ngày; khi flip sang "đã mua" thì tự link sang Device
- **Upload hoá đơn/phiếu BH** — ảnh + PDF, tối đa 5MB × 5 file/device, **mã hoá AES-256-GCM trên đĩa** (`FILE_MASTER_KEY`); ảnh tự resize ≤1600px
- Gọi trung tâm BH (tel:) + mở Google Maps 1 chạm
- Catalog dùng chung: loại sản phẩm, hãng, nơi mua, trung tâm BH (admin sửa qua Prisma Studio, autofill khi tạo device/sub)
- Thống kê: biểu đồ cột chi phí 12 tháng, pie theo loại, top 5 đắt nhất, chi phí sub quy đổi theo tháng
- **Landing page** + Privacy / Terms / Cookies public
- **PWA** — cài được lên điện thoại
- **Push notification** — BH sắp hết, sub sắp gia hạn, wishlist tới ngày dự kiến — dù tab đóng
- **Rate limit** login/register/change-password (chống brute-force) + 60 writes/phút/user
- **Quên mật khẩu** qua email + đổi mật khẩu trong settings
- Backup/restore JSON
- Dark mode
- Cron job hàng ngày: warranty + subscription auto-bill + wishlist ping

## Chạy local

Cần Postgres 17+ chạy local. Trên macOS dùng Homebrew:

```bash
brew install postgresql@17
brew services start postgresql@17
createdb warranty_vault_dev
createdb warranty_vault_test    # chỉ cần nếu chạy test scripts
```

Hoặc dùng Docker:

```bash
docker run -d --name wv-pg \
  -e POSTGRES_USER=warranty -e POSTGRES_PASSWORD=warranty \
  -e POSTGRES_DB=warranty_vault_dev -p 5432:5432 \
  postgres:17-alpine
```

Sau đó:

```bash
# cài deps
npm install

# env: sao chép mẫu, đổi DATABASE_URL theo Postgres mày + sinh các secret
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # FILE_MASTER_KEY
npx web-push generate-vapid-keys

# tạo schema + seed catalog (categories, brands, stores, …)
npm run db:push
npm run db:seed

# dev
npm run dev
# → http://localhost:3000

# build production
npm run build
npm run start
```

### Truy cập

- `/` — landing page (public)
- `/register` — tạo tài khoản
- `/login` — đăng nhập
- `/dashboard` — tổng quan (sau khi login)
- `/devices`, `/subscriptions`, `/wishlist`, `/reminders`, `/stats`, `/settings` — các trang app
- `/privacy`, `/terms`, `/cookies` — public legal pages

### Bật push notification (local)

1. Build prod (`npm run build && npm run start`) — service worker chỉ chạy prod
2. Vào Settings → bấm "Bật thông báo" → cho phép
3. Bấm "Gửi thử" — thông báo sẽ pop-up

### Test cron

```bash
curl "http://localhost:3000/api/cron/warranty-check?secret=<CRON_SECRET từ .env>"
```

Endpoint trả về `{ warrantySent, wishlistSent, subscriptionSent, removedSubscriptions, perUser }`. Vercel Cron dùng header `Authorization: Bearer $CRON_SECRET`.

### Scripts test (chạy thẳng vào dev DB, tự dọn user `__*_test__@local.test`)

```bash
node scripts/test-backup-restore.mjs       # export → wipe → import round-trip
node scripts/test-warranty-refactor.mjs    # multi-warranty + effective-end-date
node scripts/test-cron-flow.mjs            # subscription auto-bill + wishlist ping
```

## Chạy bằng Docker (local, self-host)

Compose chạy 2 service: `db` (postgres:17-alpine) + `app` (Next.js production build). DB lưu ở volume `warranty-pg`, file đính kèm mã hoá ở `warranty-data` mount vào `/data` — rebuild không mất dữ liệu.

```bash
# 1. Đảm bảo .env ở project root đã có đủ secrets:
#    POSTGRES_PASSWORD (compose tự ghép DATABASE_URL từ cái này)
#    SESSION_SECRET (≥32 ký tự), FILE_MASTER_KEY, CRON_SECRET,
#    NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
#    (DATABASE_URL & PRIVATE_UPLOAD_ROOT bị compose ghi đè — không cần sửa)

# 2. Build + chạy nền
docker compose up -d --build

# 3. Xem log / status
docker compose logs -f app
docker compose ps

# 4. Stop (giữ dữ liệu)
docker compose down

# 5. Stop + XOÁ DB và uploads — cẩn thận
docker compose down -v
```

App chạy ở `http://localhost:3000`. Entrypoint tự động chạy `prisma db push` mỗi lần start (idempotent), schema mới sẽ tự sync.

### Lưu ý khi build Docker

- **`NEXT_PUBLIC_VAPID_PUBLIC_KEY` phải có lúc BUILD**, không phải runtime — Next inline biến `NEXT_PUBLIC_*` vào client bundle. `docker-compose.yml` đã pass qua `args:` từ `.env`. Đổi VAPID public key = phải `--build` lại.
- **Service worker / push** chỉ chạy bản production, mà container đã chạy `next start` nên push hoạt động bình thường.
- Postgres adapter `pg` chạy thuần TypeScript/JS qua TCP — Dockerfile không cần `python3/make/g++` nữa, build nhanh hơn bản SQLite cũ.
- Container chạy với user non-root `nextjs:1001`. Image cuối giữ full `node_modules` để có Prisma CLI cho `db push` lúc startup.

### Backup / restore

DB và attachments giờ ở 2 volume khác nhau — backup cả 2.

```bash
# Backup DB (pg_dump qua container)
docker compose exec -T db pg_dump -U warranty warranty_vault \
  | gzip > warranty-db-$(date +%F).sql.gz

# Backup attachments volume
docker run --rm \
  -v warranty-vault_warranty-data:/data \
  -v "$PWD":/backup alpine \
  tar -czf /backup/warranty-files-$(date +%F).tar.gz -C /data .

# Restore DB
gunzip -c warranty-db-YYYY-MM-DD.sql.gz \
  | docker compose exec -T db psql -U warranty warranty_vault

# Restore attachments
docker run --rm \
  -v warranty-vault_warranty-data:/data \
  -v "$PWD":/backup alpine \
  tar -xzf /backup/warranty-files-YYYY-MM-DD.tar.gz -C /data
```

## Deploy

Xem [DEPLOY.md](./DEPLOY.md) cho Vercel + Turso.

## Cấu trúc

```
src/
├── app/
│   ├── (app)/              # protected routes (sidebar + requireUser)
│   │   ├── dashboard/
│   │   ├── devices/{,new,[id],[id]/edit}/
│   │   ├── subscriptions/{,new,[id],[id]/edit}/
│   │   ├── wishlist/{,new,[id],[id]/edit}/
│   │   ├── reminders/
│   │   ├── stats/
│   │   └── settings/
│   ├── (auth)/             # public auth routes
│   │   ├── login/  register/  forgot/  reset/[token]/
│   ├── (public)/           # public legal pages
│   │   ├── privacy/  terms/  cookies/
│   ├── api/
│   │   ├── cron/warranty-check/    # warranty + sub + wishlist
│   │   └── files/[id]/             # encrypted attachment stream
│   ├── actions/            # server actions
│   │   ├── devices.ts  warranties.ts  attachments.ts
│   │   ├── subscriptions.ts  wishlist.ts
│   │   ├── reminders.ts  push.ts  backup.ts
│   │   ├── auth.ts  password-reset.ts  catalog.ts
│   ├── offline/
│   ├── page.tsx            # landing
│   └── layout.tsx          # root layout (theme, PWA register, toaster)
├── components/
│   ├── ui/                 # shadcn primitives
│   └── (feature components — device-form, subscription-form, wishlist-actions, …)
└── lib/
    ├── prisma.ts           # Prisma client + adapter (@prisma/adapter-pg)
    ├── session.ts          # iron-session config
    ├── auth.ts             # getCurrentUser, requireUser
    ├── files.ts            # AES-256-GCM encrypted attachment storage
    ├── push.ts             # web-push wrapper
    ├── email.ts            # Resend + console fallback
    ├── rate-limit.ts       # in-memory token bucket
    ├── warranty.ts         # effective-end-date helpers
    ├── subscription-types.ts wishlist-types.ts types.ts
    └── (devices, subscriptions, wishlist, reminders, stats, queries, format, …)

prisma/schema.prisma          # User, Device, Warranty, Attachment, Reminder, PushSubscription,
                              # PasswordReset, Subscription, SubscriptionPayment, WishlistItem,
                              # WishlistPrice, Category, Brand, BrandCategory, Store, WarrantyProvider
prisma.config.ts              # Prisma 7 config
public/
├── manifest.webmanifest      # PWA manifest
├── sw.js                     # Service worker (push + offline)
└── icon.svg                  # App icon
private-uploads/[deviceId]/   # AES-256-GCM encrypted attachments (NOT served publicly —
                              # accessed via /api/files/<attachmentId> with auth)
vercel.json                   # Vercel Cron schedule
```

## Environment variables

Xem `.env.example` — đầy đủ comments.
