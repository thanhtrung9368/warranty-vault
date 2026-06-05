# Deploy — WarrantyVault lên VPS (template)

Hướng dẫn deploy WarrantyVault lên 1 VPS Linux đơn lẻ (Hetzner CX22 /
DigitalOcean $6 droplet / Vultr / etc). Stack: Postgres + Go API + Next.js
web + cron one-shot, đứng sau Caddy reverse proxy.

> File trong `deploy/` đều là **template**. Đường dẫn `/opt/warranty-vault/`
> và domain `warrantyvault.tld` là placeholder — sửa cho khớp môi trường
> thật trước khi chạy.

---

## Prerequisites

- VPS Ubuntu 22.04+ (hoặc Debian 12+). ARM cũng được vì cả 2 image build
  multi-arch.
- Docker Engine + Compose plugin:
  ```
  curl -fsSL https://get.docker.com | sh
  ```
- Caddy:
  ```
  apt install -y caddy
  ```
- Một domain (vd `warrantyvault.tld`) với 3 A record trỏ về IP VPS:
  - `warrantyvault.tld`
  - `www.warrantyvault.tld`
  - `api.warrantyvault.tld`
- Port 80 + 443 mở trên firewall (cho Caddy / Let's Encrypt). Port 3000 +
  4000 KHÔNG cần expose ra ngoài — chỉ Caddy nói chuyện với chúng qua
  `localhost`.

---

## Step 1 — Đẩy code + deploy artifacts lên VPS

Trên máy local:
```bash
# Clone về /opt/warranty-vault trên VPS.
ssh root@<vps-ip> "git clone https://github.com/thanhtrung9368/warranty-vault.git /opt/warranty-vault"

# Hoặc nếu repo private, scp từ máy đã clone:
rsync -av --exclude .git --exclude node_modules \
  ./ root@<vps-ip>:/opt/warranty-vault/
```

> Nếu muốn để repo ở chỗ khác (vd `/srv/warranty-vault/`), nhớ sửa
> `ExecStart` trong `deploy/systemd/warranty-vault-cron.service` cho khớp.

---

## Step 2 — Soạn `.env` ở repo root

`docker-compose.yml` đọc `.env` ở thư mục cùng cấp. Tạo `/opt/warranty-vault/.env`
với các biến **bắt buộc** dưới đây. Full list xem `api/.env.example` và
`website/.env.example`.

```bash
# Postgres
POSTGRES_USER=warranty
POSTGRES_PASSWORD=<random-strong-password>
POSTGRES_DB=warranty_vault

# App
APP_URL=https://warrantyvault.tld

# Secrets — sinh bằng `openssl rand -base64 32`
SESSION_SECRET=<>=32-char-random>
FILE_MASTER_KEY=<base64-32-byte; openssl rand -base64 32>
CRON_SECRET=<random-32-char>

# Push (optional, có thì điền)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@warrantyvault.tld

# APNs / FCM khi có Apple Dev / Firebase
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_BUNDLE_ID=com.warrantyvault.app
APNS_PRIVATE_KEY=
APNS_PRODUCTION=true
FCM_SERVICE_ACCOUNT_JSON=
FCM_PROJECT_ID=

# Email reset link (optional, không có thì reset chỉ in log)
RESEND_API_KEY=
RESEND_FROM=no-reply@warrantyvault.tld
```

> `chmod 600 /opt/warranty-vault/.env` — file chứa secret, không cho group/other đọc.

---

## Step 3 — Build + start stack

```bash
cd /opt/warranty-vault
docker compose up -d --build
docker compose ps    # cả `postgres`, `api`, `web` healthy
```

Migrate DB lần đầu (binary `migrate` cùng image với `api`):
```bash
docker compose run --rm --entrypoint /app/migrate api up
```

Kiểm tra:
```bash
curl -sf http://localhost:4000/healthz   # Go API
curl -sIf http://localhost:3000/login    # Next.js web
```

---

## Step 4 — Caddy reverse proxy + TLS

```bash
# Backup config gốc của Caddy package.
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak

# Copy template + sửa domain.
cp /opt/warranty-vault/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sed -i 's/warrantyvault.tld/<your-domain>/g' /etc/caddy/Caddyfile
sed -i 's/admin@warrantyvault.tld/<your-email>/g' /etc/caddy/Caddyfile

# Validate + reload.
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy tự xin cert Let's Encrypt khi nhận request đầu tiên cho domain. Log:
```
journalctl -u caddy -f
```

Verify:
```bash
curl -sIf https://warrantyvault.tld/login
curl -sIf https://api.warrantyvault.tld/healthz
```

---

## Step 5 — systemd timer cho cron daily

```bash
cp /opt/warranty-vault/deploy/systemd/warranty-vault-cron.service /etc/systemd/system/
cp /opt/warranty-vault/deploy/systemd/warranty-vault-cron.timer   /etc/systemd/system/

systemctl daemon-reload
systemctl enable --now warranty-vault-cron.timer

# Verify timer đã active + next trigger đúng giờ.
systemctl list-timers | grep warranty
# Expect: NEXT = ngày mai 02:00 UTC = 09:00 Hanoi.

# Test ngay 1 lần (không cần chờ timer).
systemctl start warranty-vault-cron.service
journalctl -u warranty-vault-cron.service -n 50
```

---

## Troubleshooting

| Triệu chứng | Check |
|---|---|
| Web/API không lên | `docker compose logs api web postgres` |
| TLS không cấp được | `journalctl -u caddy -n 200`. DNS đã propagate? Port 80 mở? |
| 502 từ Caddy | Container chưa healthy. `docker compose ps`, `curl localhost:3000/login`, `curl localhost:4000/healthz`. |
| Cron không chạy | `systemctl list-timers`. `journalctl -u warranty-vault-cron.service`. Chạy tay: `docker compose --profile cron run --rm cron`. |
| Migration fail | `docker compose run --rm --entrypoint /app/migrate api status`. Rollback: `... migrate api down 1`. |
| Push không gửi | VAPID/APNS/FCM env có đủ? `docker compose logs cron \| grep -i push`. |

---

## Backup

Encrypted attachment + DB cần backup tách:

```bash
# Postgres dump.
docker exec warranty-vault-postgres pg_dump -U warranty warranty_vault \
  | gzip > /var/backups/warranty-vault-db-$(date +%F).sql.gz

# Encrypted blobs. Blob đã encrypted (AES-256-GCM) nên dump file là OK —
# nhưng KHÔNG decrypt được nếu thiếu FILE_MASTER_KEY trong DB row tương ứng.
docker run --rm \
  -v warranty-vault_uploads:/data:ro \
  -v /var/backups:/backup \
  alpine tar czf /backup/warranty-vault-uploads-$(date +%F).tar.gz -C /data private-uploads
```

> **Quan trọng**: backup luôn cả `.env` (đặc biệt `FILE_MASTER_KEY`).
> DB + blobs mà thiếu `FILE_MASTER_KEY` thì attachment vĩnh viễn không decrypt
> được — đây là design intentional (xem `api/internal/files/files.go`).

Tự động hoá: dùng sẵn script `deploy/backup.sh` — nó gộp cả dump DB + tar blob
(qua `docker compose exec`), tự đặt timestamp và prune bản cũ
(`BACKUP_RETENTION_DAYS`, mặc định 14 ngày). Ghi ra `./backups/` (đổi bằng
`BACKUP_DIR`). Cài vào cron:

```bash
chmod +x /opt/warranty-vault/deploy/backup.sh
# Nightly 03:00, log ra file.
echo '0 3 * * * root /opt/warranty-vault/deploy/backup.sh >> /var/log/wv-backup.log 2>&1' \
  > /etc/cron.d/warranty-vault-backup
```

Rồi rsync `backups/` sang object storage / máy khác. Vẫn phải backup `.env`
(`FILE_MASTER_KEY`) riêng — script không đụng tới secret.

---

## Update

```bash
cd /opt/warranty-vault
git pull
docker compose up -d --build
docker compose run --rm --entrypoint /app/migrate api up   # nếu có migration mới
```

Rollback: `git checkout <previous-sha>` rồi lặp lại. Migrate `down` nếu cần.
