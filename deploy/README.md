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
# (Unit ghim `OnCalendar=*-*-* 02:00:00 UTC` — hậu tố UTC là bắt buộc, bỏ đi là
#  systemd hiểu theo giờ local của host. `Timezone=` KHÔNG tồn tại trong [Timer].)

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
> được — đây là design intentional (xem `api/internal/files/encrypt.go`).

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

---

## Monitoring & health

### Healthcheck có sẵn kiểm tra đúng cái gì

| Service | Healthcheck trong `docker-compose.yml` | Thực chất kiểm tra |
|---|---|---|
| `postgres` | `pg_isready -U <POSTGRES_USER> -d <POSTGRES_DB>`, mỗi 5s, timeout 3s, 10 lần, start_period 10s | Postgres nhận kết nối |
| `web` | `wget -qO- http://127.0.0.1:3000/login` — mỗi 30s, timeout 5s, 3 lần, start_period 20s | Next.js serve được trang `/login` (trang public, **không** chạm Go API) |
| `api` | `["CMD", "/app/server", "-healthcheck"]` — mỗi 10s, timeout 5s, 3 lần, start_period 30s | `GET /readyz` → **có ping DB thật**. Probe tự timeout 4s (< 5s của compose) để tự báo lỗi thay vì bị SIGKILL |
| `cron` | không có (one-shot, `restart: "no"`, profile `cron`) | — |

> Image `api` là `distroless` — **không có shell, không có `curl`/`wget`**, nên
> healthcheck phải gọi chính binary (`/app/server -healthcheck`, exec form).
> Đừng đổi sang `CMD-SHELL` hay `wget`: nó sẽ fail vĩnh viễn và ghim container
> ở trạng thái `unhealthy`.

API có 2 endpoint để tự kiểm (không cần auth):

```bash
curl -s http://localhost:4000/healthz   # {"ok":true} — chỉ nói process còn sống, KHÔNG kiểm tra DB
curl -s http://localhost:4000/readyz    # {"ok":true} khi ping được DB; 503 {"code":"db_unavailable"} khi DB chết
```

> ✅ `api` **có** healthcheck và `web` chờ `api: service_healthy`, nên web chỉ lên
> khi API ping được DB. Đồ thị phụ thuộc không có vòng lặp: `postgres ← api ← web`.
> `/readyz` chỉ là `pool.Ping`, **không** cần migration, nên DB chưa migrate vẫn
> báo healthy.
> `GET /readyz` (ping DB, timeout 2s) là tín hiệu đúng để đưa cho uptime monitor —
> đừng dùng `/healthz` vì nó luôn trả `{"ok":true}` kể cả khi DB chết.

### Kiểm tra nhanh trên VPS

```bash
docker compose ps                                  # postgres + api + web đều có (healthy); cron không có cột health
docker inspect --format '{{.State.Health.Status}}' warranty-vault-web
docker inspect --format '{{.RestartCount}} lần restart, start lúc {{.State.StartedAt}}' warranty-vault-api
docker compose logs --tail=100 api web postgres    # log gần nhất
systemctl list-timers warranty-vault-cron.timer    # LAST = "n/a" nghĩa là timer chưa từng chạy
```

Restart policy: `postgres`, `api`, `web` = `unless-stopped` (tự lên lại sau crash
hoặc reboot); `cron` = `restart: "no"` (one-shot, do systemd timer kích hoạt).
`RestartCount` tăng liên tục = container đang crash-loop, xem log ngay.

### Log nằm ở đâu

| Nguồn | Xem bằng | Ghi chú |
|---|---|---|
| `postgres` / `api` / `web` | `docker compose logs -f --tail=200 api` | Docker json-file driver, mặc định **không giới hạn** |
| Cron daily | `journalctl -u warranty-vault-cron.service -n 100` | Unit ghi ra journald (`StandardOutput=journal`) |
| Caddy / TLS | `journalctl -u caddy -f` | Lỗi ACME, 502, reload |
| Backup | `/var/log/wv-backup.log` | Do dòng `cron.d` trong § Backup ghi ra |

Log của container nằm ở `/var/lib/docker/containers/*/*-json.log`:

```bash
sudo du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail -5
```

### Uptime check ngoài (miễn phí, không phụ thuộc provider)

Check trên VPS không giúp gì khi cả VPS chết → cần 1 monitor **bên ngoài**.
Chọn dịch vụ free bất kỳ (UptimeRobot, Better Stack, HetrixTools, Uptime Kuma
self-host…) và tạo 2 monitor HTTP:

1. `https://api.<domain>/readyz` — 200 = API + DB OK, 503 = DB chết, timeout = VPS/container chết. **Monitor chính.**
2. `https://<domain>/login` — 200 = Next.js còn phục vụ.

`/readyz` đang public (Caddy không chặn) và chỉ trả `{"ok":true}` hoặc 503 —
không lộ dữ liệu. Nếu muốn chặn ở edge thì phải tự check nội bộ thay thế.

Monitor ngoài **không** biết: cron có chạy không, push có gửi được không, backup
có tươi không, disk có đầy không → cần thêm check định kỳ dưới đây.

### Check disk + độ tươi của backup (chạy trên VPS)

Lưu script sau thành `/usr/local/bin/wv-healthcheck.sh` (`chmod +x`), rồi thêm
`/etc/cron.d/warranty-vault-health`:

```
0 */6 * * * root PING_URL=https://hc-ping.com/<uuid> /usr/local/bin/wv-healthcheck.sh >> /var/log/wv-health.log 2>&1
```

```bash
#!/bin/sh
# WarrantyVault — API/web sống? disk còn chỗ? backup có tươi?
# PING_URL (tuỳ chọn) = dead-man's switch kiểu healthchecks.io:
# không ping được trong N giờ → dịch vụ đó tự alert.
BACKUP_DIR="${BACKUP_DIR:-/var/backups/warranty-vault}"
PING_URL="${PING_URL:-}"

api=FAIL; web=FAIL
curl -fsS --max-time 10 -o /dev/null http://localhost:4000/readyz && api=ok
curl -fsS --max-time 10 -o /dev/null http://localhost:3000/login  && web=ok

used=$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
fresh=$(find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.sql.gz' -mmin -1560 -print -quit 2>/dev/null)

echo "[$(date -u +%FT%TZ)] api=$api web=$web disk=${used}% backup=${fresh:-STALE}"
[ "$api" = ok ]   || echo "ALERT: api /readyz fail"
[ "$web" = ok ]   || echo "ALERT: web /login fail"
[ "$used" -lt 85 ] || echo "ALERT: disk / đã dùng ${used}%"
[ -n "$fresh" ]   || echo "ALERT: không có db-*.sql.gz mới hơn 26h trong $BACKUP_DIR"

if [ -n "$PING_URL" ]; then
  if [ "$api" = ok ] && [ "$web" = ok ] && [ "$used" -lt 85 ] && [ -n "$fresh" ]; then
    curl -fsS --max-time 10 -o /dev/null "$PING_URL" || true
  else
    curl -fsS --max-time 10 -o /dev/null "$PING_URL/fail" || true
  fi
fi
```

Khi disk bắt đầu chật, xem thứ tự này (build cache là thủ phạm thường gặp nhất
sau vài lần `up -d --build`):

```bash
df -h /                                       # còn bao nhiêu chỗ (đổi path nếu /var/lib/docker ở mount khác)
docker system df                              # images / containers / volumes / build cache
docker volume ls | grep uploads               # tên volume = <project>_uploads
du -sh /var/lib/docker/volumes/warranty-vault_uploads/_data   # blob attachment
du -sh /var/backups/warranty-vault            # backup (prune theo BACKUP_RETENTION_DAYS)
docker image prune -f && docker builder prune -f              # dọn image + cache cũ
```

> Blob bị chặn trần 100MB/user (`MAX_UPLOAD_BYTES_PER_USER`) nên volume uploads
> tăng chậm; đầy disk thường do build cache, log hoặc image cũ, không phải user.

### Log rotation (đừng để log ăn hết disk)

Docker json-file mặc định **không** rotate. Đặt mặc định toàn cục trong
`/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

```bash
systemctl restart docker     # container restart: unless-stopped sẽ tự lên lại (có downtime ngắn)
```

Hoặc chỉnh riêng từng service bằng khối `logging:` trong `docker-compose.yml`
rồi `docker compose up -d` (recreate container đó).

Journald (cron + Caddy) và log backup:

```bash
journalctl --disk-usage                 # journal đang chiếm bao nhiêu
journalctl --vacuum-size=200M           # dọn ngay
```

Đặt trần trong `/etc/systemd/journald.conf` (`SystemMaxUse=500M`) rồi
`systemctl restart systemd-journald`. Riêng `/var/log/wv-backup.log` không ai
rotate — thêm `/etc/logrotate.d/warranty-vault`:

```
/var/log/wv-backup.log /var/log/wv-health.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
```
