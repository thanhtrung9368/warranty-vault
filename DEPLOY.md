# Deploy WarrantyVault

Hướng dẫn deploy lên **Vercel** với database **Turso** (SQLite cloud, free tier 500 DB × 5GB).

## Tổng quan

- **Frontend + Server Actions**: Vercel (free tier đủ)
- **Database**: Turso (SQLite hosted, dùng lại Prisma schema hiện tại)
- **Uploads (hoá đơn/ảnh BH)**: **Vercel Blob** hoặc S3-compatible (Vercel filesystem không lưu được giữa các request)
- **Email (reset mật khẩu)**: Resend (free 3K email/tháng)
- **Cron**: Vercel Cron (free 2 job/ngày)

## Bước 1 — Chuẩn bị Turso

```bash
# cài Turso CLI
brew install tursodatabase/tap/turso   # macOS
turso auth signup                       # hoặc turso auth login

# tạo DB
turso db create warranty-vault
turso db show warranty-vault --url      # → libsql://<name>-<org>.turso.io
turso db tokens create warranty-vault   # → eyJhbGciOi...

# push schema
DATABASE_URL="libsql://<name>.turso.io?authToken=<token>" \
  npx prisma db push
```

## Bước 2 — Đổi Prisma adapter sang libSQL

Thêm package:
```bash
npm install @libsql/client @prisma/adapter-libsql
npm uninstall @prisma/adapter-better-sqlite3 better-sqlite3
```

Sửa `src/lib/prisma.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';

function createClient() {
  const adapter = new PrismaLibSQL({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  return new PrismaClient({ adapter });
}
// ... rest giống cũ
```

Sửa `prisma.config.ts` tương tự (thay `PrismaBetterSqlite3` → `PrismaLibSQL`).

DATABASE_URL trên Vercel set dạng: `libsql://<name>.turso.io` (không kèm authToken), thêm env `DATABASE_AUTH_TOKEN`.

## Bước 3 — Uploads sang Vercel Blob

File system Vercel serverless không bền vững. Chuyển upload sang Vercel Blob:

```bash
npm install @vercel/blob
```

Sửa `src/app/actions/attachments.ts` thay `fs.writeFile` bằng `put()` của `@vercel/blob`, lưu URL từ Blob vào `Attachment.filePath`. Ảnh/PDF sẽ served trực tiếp từ Blob CDN.

Alternative free: Cloudflare R2 (10GB free), MinIO self-host, Supabase Storage.

## Bước 4 — Environment variables

Set trên Vercel dashboard (Settings → Environment Variables):

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | `libsql://<name>.turso.io` |
| `DATABASE_AUTH_TOKEN` | Turso token (bước 1) |
| `SESSION_SECRET` | Chạy `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` → paste output |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | từ `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | VAPID private |
| `VAPID_SUBJECT` | `mailto:email@của_mày.com` |
| `CRON_SECRET` | Random string dài (≥32 ký tự) |
| `APP_URL` | `https://your-app.vercel.app` |
| `RESEND_API_KEY` | (optional) từ resend.com — bỏ trống thì reset link in ra log |
| `RESEND_FROM` | `WarrantyVault <noreply@yourdomain.com>` (cần verify domain ở Resend) |
| `BLOB_READ_WRITE_TOKEN` | (nếu dùng Vercel Blob) |

**Quan trọng:** `SESSION_SECRET` phải unique production — không reuse của local. Đổi secret = tất cả user bị logout.

## Bước 5 — Deploy

```bash
# Cài Vercel CLI
npm i -g vercel
vercel login
vercel link          # chọn project
vercel --prod        # deploy
```

Hoặc push GitHub → Vercel tự deploy nếu đã connect repo.

## Bước 6 — Vercel Cron

File `vercel.json` đã có sẵn:
```json
{
  "crons": [{ "path": "/api/cron/warranty-check", "schedule": "0 1 * * *" }]
}
```

Chạy 01:00 UTC mỗi ngày. Vercel tự gửi `Authorization: Bearer <CRON_SECRET>` — endpoint đã check sẵn.

Xem log cron: Vercel dashboard → project → Cron Jobs.

## Checklist trước khi share link cho người khác

- [ ] `SESSION_SECRET` & `CRON_SECRET` là random unique (không phải default trong `.env` repo)
- [ ] VAPID keys đã set (nếu không push sẽ fail silent)
- [ ] Resend đã verify domain + `RESEND_FROM` đúng (reset password mới gửi được email thật)
- [ ] Database file / Turso DB có backup (Turso: `turso db shell <name> ".backup ..."`)
- [ ] `APP_URL` đúng domain production (reset password link dùng)
- [ ] Test: đăng ký mới → nhận email → đặt lại mật khẩu → đăng nhập → bật push → `/api/cron/warranty-check?secret=<CRON_SECRET>` trả JSON

## Rollback

Vercel lưu tất cả deployment. Vào dashboard → Deployments → chọn bản cũ → Promote to Production.

Turso: `turso db shell <name> "<SQL restore>"` hoặc giữ backup `.sql` dump.
