# Deploy WarrantyVault

App giờ chạy Postgres native nên đường deploy đơn giản: bất cứ host nào support Node 22 + Postgres đều OK. Hai option chính:

- **Self-host bằng Docker compose** — repo đã sẵn sàng, xem [README.md → Chạy bằng Docker](./README.md#chạy-bằng-docker-local-self-host).
- **Vercel + Postgres managed** (Neon / Supabase / Render / Railway / RDS) — hướng dẫn dưới đây.

## Tổng quan (Vercel route)

- **Frontend + Server Actions**: Vercel (free tier đủ)
- **Database**: Postgres hosted — Neon (free 0.5GB), Supabase (free 500MB), Render Postgres (free), hoặc bất kỳ Postgres ≥ 14 nào
- **Uploads (hoá đơn/ảnh BH)**: **Vercel Blob** hoặc S3-compatible — Vercel filesystem ephemeral nên không lưu được encrypted attachments giữa các request
- **Email (reset mật khẩu)**: Resend (free 3K email/tháng)
- **Cron**: Vercel Cron (free 2 job/ngày)

## Bước 1 — Chuẩn bị Postgres

Ví dụ với Neon (free, sinh URL kèm `sslmode=require`):

```bash
# 1. Tạo project ở https://neon.tech → copy connection string:
#    postgresql://user:pass@ep-xxx.region.aws.neon.tech/warranty_vault?sslmode=require

# 2. Push schema (dùng URL Neon, không cần migrations folder):
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" npx prisma db push

# 3. Seed catalog tables (categories, brands, stores, warranty providers):
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" node prisma/seed.mjs
```

Lưu ý: `DATABASE_URL` Vercel cần **`sslmode=require`** (hoặc `?ssl=true`) — managed Postgres luôn enforce TLS.

## Bước 2 — Uploads sang Vercel Blob

File system Vercel serverless không bền. Chuyển upload sang Vercel Blob:

```bash
npm install @vercel/blob
```

Sửa `src/app/actions/attachments.ts` + `src/lib/files.ts`:
- Thay `fs.writeFile` bằng `put()` của `@vercel/blob`
- `storagePath` lưu URL từ Blob (vẫn validate path traversal)
- `readAndDecrypt` fetch URL về buffer rồi decrypt như cũ

Alternative free: Cloudflare R2 (10GB free), Supabase Storage, MinIO self-host. Mọi backend object-storage đều OK miễn server action ghi/đọc được.

## Bước 3 — Environment variables

Set trên Vercel dashboard (Settings → Environment Variables):

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `FILE_MASTER_KEY` | Tương tự SESSION_SECRET (32-byte base64). **Đổi key = mọi attachment cũ không decrypt được nữa.** |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | từ `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | VAPID private |
| `VAPID_SUBJECT` | `mailto:email@của_mày.com` |
| `CRON_SECRET` | Random string dài (≥32 ký tự) |
| `APP_URL` | `https://your-app.vercel.app` |
| `RESEND_API_KEY` | (optional) từ resend.com — bỏ trống thì reset link in ra log |
| `RESEND_FROM` | `WarrantyVault <noreply@yourdomain.com>` (cần verify domain ở Resend) |
| `BLOB_READ_WRITE_TOKEN` | (nếu dùng Vercel Blob) |

**Quan trọng:**
- `SESSION_SECRET` phải unique production — không reuse của local. Đổi secret = tất cả user bị logout.
- `FILE_MASTER_KEY` quan trọng hơn: rotate được nhưng phải re-wrap tất cả `Attachment.wrappedKey` (xem comment trong `src/lib/files.ts`). Mất key này = mất hết file đính kèm.

## Bước 4 — Deploy

```bash
# Cài Vercel CLI
npm i -g vercel
vercel login
vercel link          # chọn project
vercel --prod        # deploy
```

Hoặc push GitHub → Vercel tự deploy nếu đã connect repo. Postgres adapter `pg` chạy thuần JS qua TCP nên Vercel build không cần native compile step.

## Bước 5 — Vercel Cron

File `vercel.json` đã có sẵn:
```json
{
  "crons": [{ "path": "/api/cron/warranty-check", "schedule": "0 1 * * *" }]
}
```

Chạy 01:00 UTC mỗi ngày. Vercel tự gửi `Authorization: Bearer <CRON_SECRET>` — endpoint đã check sẵn.

Xem log cron: Vercel dashboard → project → Cron Jobs.

## Checklist trước khi share link cho người khác

- [ ] `SESSION_SECRET` & `CRON_SECRET` & `FILE_MASTER_KEY` là random unique (không phải default trong `.env` repo)
- [ ] Postgres URL có `sslmode=require`
- [ ] Schema đã push + catalog đã seed (`prisma/seed.mjs`)
- [ ] VAPID keys đã set (nếu không push sẽ fail silent)
- [ ] Resend đã verify domain + `RESEND_FROM` đúng (reset password mới gửi được email thật)
- [ ] Postgres có backup tự động (Neon/Supabase đều có sẵn point-in-time hoặc daily snapshot)
- [ ] `APP_URL` đúng domain production (reset password link dùng)
- [ ] Test: đăng ký mới → nhận email → đặt lại mật khẩu → đăng nhập → bật push → `/api/cron/warranty-check?secret=<CRON_SECRET>` trả JSON

## Rollback

- **Code**: Vercel lưu tất cả deployment. Dashboard → Deployments → chọn bản cũ → Promote to Production.
- **DB**: dùng snapshot/point-in-time của provider (Neon, Supabase đều support). Hoặc giữ `pg_dump` định kỳ:
  ```bash
  pg_dump "postgresql://user:pass@host/db?sslmode=require" | gzip > backup-$(date +%F).sql.gz
  ```

## Self-host bằng Docker

Tham khảo [README.md → Chạy bằng Docker](./README.md#chạy-bằng-docker-local-self-host). Compose stack: Postgres + Next app, 2 volume riêng cho DB và file đính kèm. Phù hợp cho bản dùng nội bộ / chia sẻ giới hạn vài user.
