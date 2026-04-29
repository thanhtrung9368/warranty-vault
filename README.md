# WarrantyVault

Web app cá nhân để theo dõi thiết bị, bảo hành và chi phí mua sắm. Multi-user, tiếng Việt 100%.

## Tech stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript** + **React 19**
- **Tailwind CSS** + **shadcn/ui** + **lucide-react**
- **Prisma 7** (driver adapter) + **SQLite** (local) / **Turso libSQL** (prod)
- Auth: **iron-session** cookie + **bcrypt-ts** (pure JS)
- Push: **web-push** (VAPID, free) + Service Worker
- Email: **Resend** (optional, free 3K/tháng — không set thì reset link in ra console)
- Charts: **recharts**

## Tính năng

- Đăng ký/đăng nhập nhiều user, dữ liệu mỗi user riêng
- CRUD thiết bị (laptop, điện thoại, đồ gia dụng, …) với ngày mua, giá, bảo hành
- Tự động tính ngày hết BH, cảnh báo 30/60/90 ngày
- Upload hóa đơn/phiếu BH (ảnh + PDF, tối đa 5MB × 5 file/device)
- Gọi trung tâm BH (tel:) + mở Google Maps 1 chạm
- Thống kê: biểu đồ cột chi phí 12 tháng, pie theo loại, top 5 đắt nhất
- **Landing page** public
- **PWA** — cài được lên điện thoại
- **Push notification** — nhận thông báo khi sắp hết BH dù tab đóng
- **Rate limit** login/register (chống brute-force)
- **Quên mật khẩu** qua email + đổi mật khẩu trong settings
- Backup/restore JSON
- Dark mode
- Cron job check BH hàng ngày

## Chạy local

```bash
# cài deps
npm install

# tạo DB + migrate schema
npx prisma db push

# env: sao chép mẫu, sửa SESSION_SECRET
cp .env.example .env
# Generate keys:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx web-push generate-vapid-keys

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
- `/devices`, `/reminders`, `/stats`, `/settings` — các trang app

### Bật push notification (local)

1. Build prod (`npm run build && npm run start`) — service worker chỉ chạy prod
2. Vào Settings → bấm "Bật thông báo" → cho phép
3. Bấm "Gửi thử" — thông báo sẽ pop-up

### Test cron

```bash
curl "http://localhost:3737/api/cron/warranty-check?secret=<CRON_SECRET từ .env>"
```

## Chạy bằng Docker (local, self-host)

Bản đóng gói multi-stage Node 22 alpine. DB SQLite + thư mục đính kèm đã mã hoá đều nằm trong volume `warranty-data` (mount vào `/data` trong container) — rebuild không mất dữ liệu.

```bash
# 1. Đảm bảo .env ở project root đã có đủ secrets:
#    SESSION_SECRET (≥32 ký tự), FILE_MASTER_KEY, CRON_SECRET,
#    NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
#    (DATABASE_URL & PRIVATE_UPLOAD_ROOT bị compose ghi đè sang /data — không cần sửa)

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
- **Native module `better-sqlite3`** được compile trong stage builder (`python3/make/g++`), runtime stage chỉ giữ `libc6-compat`. Container chạy với user non-root `nextjs:1001`.
- Image cuối ~1.6GB (giữ full `node_modules` để có Prisma CLI cho `db push` lúc startup). Đủ nhẹ cho self-host, không cần optimize thêm.

### Backup / restore volume

```bash
# Backup
docker run --rm \
  -v warranty-vault_warranty-data:/data \
  -v "$PWD":/backup alpine \
  tar -czf /backup/warranty-backup-$(date +%F).tar.gz -C /data .

# Restore (vào volume sạch — stop container trước)
docker compose down
docker volume create warranty-vault_warranty-data
docker run --rm \
  -v warranty-vault_warranty-data:/data \
  -v "$PWD":/backup alpine \
  tar -xzf /backup/warranty-backup-YYYY-MM-DD.tar.gz -C /data
docker compose up -d
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
│   │   ├── reminders/
│   │   ├── stats/
│   │   └── settings/
│   ├── (auth)/             # public auth routes
│   │   ├── login/
│   │   ├── register/
│   │   ├── forgot/
│   │   └── reset/[token]/
│   ├── api/cron/warranty-check/
│   ├── offline/
│   ├── actions/            # server actions (devices, auth, push, backup, …)
│   ├── page.tsx            # landing
│   └── layout.tsx          # root layout (theme, PWA register, toaster)
├── components/
│   ├── ui/                 # shadcn primitives
│   └── (feature components)
└── lib/
    ├── prisma.ts           # Prisma client + adapter
    ├── session.ts          # iron-session config
    ├── auth.ts             # getCurrentUser, requireUser
    ├── push.ts             # web-push wrapper
    ├── email.ts            # Resend + console fallback
    ├── rate-limit.ts       # in-memory token bucket
    └── (devices, reminders, stats, format, types, …)

prisma/schema.prisma          # User, Device, Attachment, Reminder, PushSubscription, PasswordReset
prisma.config.ts              # Prisma 7 config (schema + datasource)
public/
├── manifest.webmanifest      # PWA manifest
├── sw.js                     # Service worker (push + offline)
├── icon.svg                  # App icon
└── uploads/[deviceId]/       # User-uploaded hoá đơn/phiếu BH
vercel.json                   # Vercel Cron schedule
```

## Environment variables

Xem `.env.example` — đầy đủ comments.
