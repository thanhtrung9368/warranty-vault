# Production checklist — WarrantyVault (pre-deploy)

Checklist tick-trước-khi-mở-cửa cho stack `postgres + api + web + cron` sau Caddy.
Đọc kèm `deploy/README.md` (hướng dẫn cài đặt gốc) — file này chỉ chứa **việc phải
làm + cách verify**, kèm những chỗ dễ sai đã đọc trực tiếp trong repo.

> Quy ước: `/opt/warranty-vault` = repo root trên VPS, `<domain>` = domain thật
> (vd `warrantyvault.vn`). Đổi placeholder trước khi copy lệnh.
> ⚠️ = hành vi đã kiểm tra trong code/compose, không phải suy đoán.

---

## 0. Chặn cứng (làm trước khi tick gì khác)

- [ ] VPS Ubuntu 22.04+/Debian 12+, Docker Engine + Compose plugin: `docker compose version`
- [ ] Caddy đã cài: `caddy version`
- [ ] 3 A record trỏ về IP VPS: `<domain>`, `www.<domain>`, `api.<domain>`
      → `dig +short <domain>; dig +short www.<domain>; dig +short api.<domain>`
- [ ] Port 80 + 443 mở (Let's Encrypt HTTP-01)
- [ ] Repo nằm ở `/opt/warranty-vault` — nếu khác, sửa `WorkingDirectory` **và**
      `ExecStart` trong `deploy/systemd/warranty-vault-cron.service`
- [ ] Timezone VPS đã kiểm tra: `timedatectl`. Unit hiện đã ghim rõ
      `OnCalendar=*-*-* 02:00:00 UTC` trong `deploy/systemd/warranty-vault-cron.timer`
      → luôn bắn 02:00 UTC = 09:00 Hanoi, **không** phụ thuộc TZ của host.
      ⚠️ Hậu tố `UTC` là bắt buộc: bỏ đi thì systemd hiểu theo giờ local của host.
      ⚠️ `systemd.timer` **không có** directive `Timezone=` trong `[Timer]` — đừng thêm
      (nó sẽ bị bỏ qua kèm warning). Muốn đổi giờ thì sửa chính biểu thức, ví dụ
      `OnCalendar=*-*-* 09:00:00 Asia/Ho_Chi_Minh` (xem `systemd.time(7)`).

---

## 1. Secrets & `.env`

⚠️ compose **không có `env_file:`** — nó chỉ đọc `.env` ở repo root để nội suy
`${...}`. Sửa `api/.env` hay `website/.env` trên VPS **không có tác dụng gì**;
`api/.env.example` + `website/.env.example` chỉ là danh mục biến cho dev local.
Tạo một file `/opt/warranty-vault/.env` duy nhất.

**Bắt buộc** (compose dùng `${VAR:?}` → thiếu là mọi lệnh `docker compose` báo lỗi
`... must be set` ngay khi đọc file):

| Biến | Sinh bằng | Lưu ý |
|---|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` | ⚠️ **Không dùng base64 thô**: ký tự `/` làm `DATABASE_URL` (compose nối chuỗi `postgresql://user:pass@postgres:5432/...`) parse lỗi `invalid port` → api không kết nối được DB. `+` và `=` thì an toàn. |
| `SESSION_SECRET` | `openssl rand -base64 32` | ≥32 ký tự (Go cũng exit nếu <32 khi biến được set). ⚠️ Chỉ **web** dùng thật (cookie `wv_session`); Go đọc nhưng không dùng. Đổi giá trị = logout toàn bộ user web. |
| `FILE_MASTER_KEY` | `openssl rand -base64 32` | Phải decode ra **≥32 byte** (base64 hoặc hex đều được). Xem cảnh báo ở §6. |
| `CRON_SECRET` | `openssl rand -hex 32` | ⚠️ Chỉ dùng cho `POST /api/v1/cron/warranty-check` (bearer hoặc `?secret=`), không phải cho binary cron. Compose vẫn bắt buộc. |
| `APP_URL` | `https://<domain>` | ⚠️ Dùng để dựng link reset password; quên đổi → link trong email trỏ `http://localhost:3000/reset/...` |

**Nên set** (có default nhưng default là giá trị dev):

| Biến | Default | Ghi chú |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` | `warranty` / `warranty_vault` | `deploy/backup.sh` đọc đúng 2 biến này (cùng default) — đổi ở compose thì phải truyền cùng giá trị cho backup |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Nên là `mailto:` thật |
| `APNS_BUNDLE_ID` | `com.warrantyvault.app` | Khớp bundle id app iOS |
| `RESEND_FROM` | rỗng | Bắt buộc nếu set `RESEND_API_KEY` |

**Optional** (thiếu thì tính năng tương ứng tắt, server vẫn boot — xem §5):
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`,
`APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY`, `APNS_PRODUCTION`, `FCM_SERVICE_ACCOUNT_JSON`,
`FCM_PROJECT_ID`, `RESEND_API_KEY`, `RESEND_FROM`, `RATE_LIMITER`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `SESSION_TTL_DAYS`.

- [ ] `.env` đã tạo, `chmod 600`, `chown root:root`:
      `stat -c '%a %U:%G' /opt/warranty-vault/.env` → `600 root root`
- [ ] `SESSION_SECRET` ≥32 ký tự: `awk -F= '/^SESSION_SECRET=/{print length($2)}' .env`
- [ ] `FILE_MASTER_KEY` dài ~44 ký tự base64:
      `awk -F= '/^FILE_MASTER_KEY=/{print length($2)}' .env`
- [ ] Đổi secret xong nhớ recreate container: `docker compose up -d` (compose tự
      recreate service có config đổi)
- [ ] `.env` **không** nằm trong git: `git check-ignore -v .env` → in ra rule khớp

⚠️ **Các biến sau bị compose ghi đè, đừng đặt trong root `.env`**: `GO_API_URL`
(service `web` = `http://api:4000/api` — **có** hậu tố `/api`, xem ghi chú dưới),
`PORT` (=`4000`), `DATABASE_URL`, `PRIVATE_UPLOAD_ROOT` (=`/data/private-uploads`),
`WEB_URL` (lấy từ `APP_URL`). Giá trị trong `.env` sẽ bị bỏ qua.

> ⚠️ **`GO_API_URL` BẮT BUỘC kết thúc bằng `/api`.** `website/src/lib/api/client.ts`
> ghép `GO_API_URL + '/v1/...'`, còn Go phục vụ `/api/v1/...`. Thiếu `/api` thì
> **mọi** lời gọi web → Go trả 404 và web trông như hỏng hoàn toàn.

✅ **`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` ĐÃ được compose forward** vào service
`api`. Chỉ cần đặt key trong root `.env` rồi `docker compose up -d api` là tính năng
quét hoá đơn OCR hoạt động (vẫn phải bật opt-in theo từng user). Nếu thiếu key,
endpoint trả 503 `feature_disabled`.

---

## 2. Database & migration

- [ ] `docker compose up -d --build` rồi `docker compose ps`:
      cả `postgres` + `api` + `web` = `(healthy)`. Service `api` có healthcheck
      thật (`/app/server -healthcheck` → `GET /readyz`), và `web` chờ
      `api: service_healthy` nên web chỉ lên khi API ping được DB
- [ ] Migration lần đầu: `docker compose run --rm --entrypoint /app/migrate api up`
- [ ] Kiểm tra version: `docker compose run --rm --entrypoint /app/migrate api status`
      → 7 migration đã apply: `0001_initial`, `0002_cron_idempotency`,
      `0003_user_ai_optin`, `0004_seed_category_catalog`, `0005_device_search_unaccent`,
      `0006_device_resale`, `0007_locale_safe_unaccent`
- [ ] **Database PHẢI có encoding UTF-8.** Kiểm tra:
      `docker compose exec -T postgres psql -U warranty -d warranty_vault -c 'SHOW server_encoding; SHOW lc_collate;'`
      → `server_encoding` phải là `UTF8`. (`lc_collate` có thể là `C` — xem bên dưới.)
      ⚠️ Đây không phải chi tiết vụn: nếu encoding **không** phải UTF-8 thì Postgres
      không lưu nổi ký tự tiếng Việt, và **tìm kiếm trả về 0 kết quả — im lặng,
      không lỗi, không log**.
      Image `postgres:17` chính thức mặc định UTF-8 nên thường chỉ cần kiểm tra; nếu
      tự dựng cluster thì `initdb -E UTF8`.
- [ ] Kiểm tra tìm kiếm tiếng Việt chạy thật (bắt được cả lỗi encoding lẫn lỗi
      biểu thức index): tạo 1 thiết bị tên `Điện thoại SamSung`, rồi tìm bằng
      **`dien thoai`** không dấu → phải ra kết quả.
      > Lịch sử: migration `0005` dựng biểu thức là `unaccent(lower(x))` — gọi hàm
      > phụ thuộc locale **trước**. Trên database `lc_collate=C`, `lower()` chỉ xử lý
      > ASCII nên `Đ` không hạ được, `unaccent` trả `D` hoa, và search hỏng hoàn
      > toàn im lặng. Migration `0007` đảo thành `lower(unaccent(x))` nên giờ
      > **collation không còn ảnh hưởng** — đã kiểm chứng bằng test tự dựng cluster
      > `locale=C`. Chỉ encoding mới là ràng buộc thật.
- [ ] Bảng đã tạo: `docker compose exec -T postgres psql -U warranty -d warranty_vault -c '\dt'`
      → thấy `"User"`, `"Device"`, `"Warranty"`, `"Attachment"`, `"Session"`, ...
- [ ] Nếu có migration mới trong release sau: luôn `migrate up` **trước** khi
      smoke test (`docker compose run --rm --entrypoint /app/migrate api up`)

Rollback schema (ghi nhớ cách chạy đúng):

- [ ] `docker compose run --rm --entrypoint /app/migrate api down` → ⚠️ goose v3.27.1
      **bỏ qua** tham số thêm: `down` luôn rollback **đúng 1 migration**. Viết
      `down 1` cũng chỉ là 1 bước, **không** phải "về version 1".
- [ ] Muốn về version cụ thể phải chạy `down` lặp lại — lệnh `down-to` **không có**
      trong allowlist của `api/cmd/migrate` (sẽ báo `unknown command`)
- [ ] `reset` chỉ chạy khi thật sự muốn xoá sạch schema, và phải
      `WV_ALLOW_DESTRUCTIVE=1`; `--force-reset` bị chặn vĩnh viễn

---

## 3. TLS / domain (Caddy)

- [ ] `cp /opt/warranty-vault/deploy/caddy/Caddyfile /etc/caddy/Caddyfile` rồi thay
      domain + email (2 lệnh `sed` trong `deploy/README.md` § Step 4)
- [ ] `caddy validate --config /etc/caddy/Caddyfile` → `Valid configuration`
- [ ] `systemctl reload caddy`
- [ ] Cert đã cấp (chạy sau request HTTPS đầu tiên vài giây):
      `echo | openssl s_client -connect <domain>:443 -servername <domain> 2>/dev/null | openssl x509 -noout -subject -issuer -dates`
      → `issuer=... Let's Encrypt`, `notAfter` ~90 ngày
- [ ] Không có lỗi ACME: `journalctl -u caddy -n 200 --no-pager | grep -i -E 'error|acme'`
- [ ] HTTP redirect sang HTTPS: `curl -sI http://<domain>/login | head -1` → `308`
- [ ] HSTS có mặt: `curl -sI https://<domain>/login | grep -i strict-transport-security`
- [ ] Cả 3 hostname đều trả 200/404 (không có host nào lỗi cert `000`):
      `D=warrantyvault.vn; for h in $D www.$D api.$D; do echo -n "$h "; curl -s -o /dev/null -w '%{http_code}\n' "https://$h/"; done`
      (`api.<domain>/` trả 404 là bình thường — API chỉ phục vụ `/api/v1/*`, `/healthz`, `/readyz`)
- [ ] Cron route bị chặn ở edge: `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.<domain>/api/v1/cron/warranty-check` → `404`

---

## 4. Cron (systemd timer)

- [ ] Đã copy 2 unit + `systemctl daemon-reload` + `systemctl enable --now warranty-vault-cron.timer`
- [ ] Timer active và **đúng giờ local** (`systemctl list-timers | grep warranty`
      in ra giờ local của host): host TZ=UTC → NEXT 02:00 = 09:00 Hanoi;
      host TZ=Asia/Ho_Chi_Minh → NEXT 02:00 = 02:00 sáng Hanoi (sớm hơn dự kiến 7 tiếng)
- [ ] Chạy tay 1 lần: `systemctl start warranty-vault-cron.service`
      rồi `systemctl status warranty-vault-cron.service --no-pager` → `status=0/SUCCESS`
- [ ] Log có nội dung thật, không chỉ dòng khởi động:
      `journalctl -u warranty-vault-cron.service -n 50 --no-pager`
      ⚠️ Cron exit code `0` **không** bảo đảm push đã gửi — exit 0 nghĩa là "pass
      chạy xong", push lỗi vẫn nằm trong log (`api/cmd/cron/main.go`)
- [ ] Chạy qua compose cũng được: `docker compose --profile cron run --rm cron`
- [ ] Cron idempotent (migration `0002`): chạy lần 2 trong cùng ngày không tạo
      thông báo trùng — kiểm tra bằng cách so số push trong 2 lần chạy liên tiếp
- [ ] (tuỳ chọn) dead-man's switch: thêm `ExecStartPost=/usr/bin/curl -fsS --max-time 10 https://hc-ping.com/<uuid>`
      vào `[Service]` của unit để biết khi timer ngừng chạy

---

## 5. Push & email — cái gì tắt âm thầm khi thiếu env

| Tính năng | Env cần | Khi thiếu |
|---|---|---|
| Web push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (+`VAPID_SUBJECT`) | Pusher log `web push not configured`, subscription web bị skip. ⚠️ Public key là **build-arg** của `web` → đổi key phải `docker compose up -d --build web`, restart không ăn |
| APNs (iOS) | `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY` (nội dung file `.p8`) | `apns not configured` → subscription iOS bị skip, cron vẫn exit 0 |
| APNs production | `APNS_PRODUCTION=1` | ⚠️ So sánh `== "1"`; mọi giá trị khác (kể cả `true`) = **sandbox gateway** → push iOS thật sẽ không tới |
| FCM (Android) | `FCM_SERVICE_ACCOUNT_JSON` (JSON 1 dòng), `FCM_PROJECT_ID` (optional) | `fcm not configured` → subscription Android bị skip. File `android/app/google-services.json` là chuyện riêng của client (đang deferred) |
| Email reset password | `RESEND_API_KEY`, `RESEND_FROM` | ⚠️ Không lỗi: Go log link reset ra stdout (`email dev-mode (no RESEND_API_KEY)`) → user không tự reset được mật khẩu. Xem `docker compose logs api \| grep -i reset` |
| Rate limit dùng chung | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Fallback in-memory — đủ cho 1 instance, nhưng counter reset mỗi lần restart api |

Cách điền giá trị nhiều dòng (đã thử với `docker compose config`):

- `APNS_PRIVATE_KEY`: dán cả file `.p8` trên **1 dòng**, thay newline bằng `\n`,
  bọc trong **nháy kép** → compose hiểu `\n` thành newline thật:
  `APNS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"`
- `FCM_SERVICE_ACCOUNT_JSON`: minify `jq -c . service-account.json` rồi bọc **nháy
  đơn** (giữ nguyên `\n` trong chuỗi JSON để Go tự unescape khi `json.Unmarshal`):
  `FCM_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`

- [ ] Ít nhất 1 kênh push đã cấu hình nếu định dùng thông báo
- [ ] Test push thật: đăng nhập web → Settings → nút gửi thử (hoặc
      `curl -s -X POST -H "Authorization: Bearer $TOKEN" https://api.<domain>/api/v1/push/test`)
      rồi `docker compose logs api | grep -i push`
- [ ] Có `RESEND_API_KEY` thì chạy thử luồng "quên mật khẩu" và nhận được email
      thật (không chỉ thấy link trong log)

---

## 6. Backup — và **restore drill** (phần quan trọng nhất)

⚠️ **Cảnh báo gốc, đã verify trong code**: mỗi blob trên đĩa được mã hoá bằng một
**data key riêng**, data key đó được wrap bằng `FILE_MASTER_KEY` và lưu ở cột
`Attachment.wrappedKey` trong DB (`api/internal/files/encrypt.go`: "Disk alone or
DB alone can't decrypt — both are needed"). **Mất `FILE_MASTER_KEY` = toàn bộ
attachment vĩnh viễn không giải mã được**, không có tool rotate/recover trong repo.
DB + blob backup mà thiếu key thì chỉ khôi phục được metadata, không mở được file.

- [ ] `deploy/backup.sh` đã cài lịch chạy (cron.d như `deploy/README.md` § Backup).
      Script cần stack đang chạy (`postgres` + `api`) vì nó `docker compose exec`
- [ ] ⚠️ **cron.d không đọc `.env`**: truyền biến ngay trong dòng cron —
      `0 3 * * * root BACKUP_DIR=/var/backups/warranty-vault /opt/warranty-vault/deploy/backup.sh >> /var/log/wv-backup.log 2>&1`
      (thêm `POSTGRES_USER=` / `POSTGRES_DB=` nếu bạn đã đổi khác default, không thì
      script dump nhầm tên DB và chỉ còn blob được backup)
- [ ] ⚠️ **Đổi `BACKUP_DIR` ra ngoài repo**: default của script là `$REPO_ROOT/backups`
      và `backups/` **không** có trong `.gitignore` (chỉ có `warranty-backup-*.tar.gz`)
      → dump DB rơi vào working tree. Dùng `BACKUP_DIR=/var/backups/warranty-vault`
      (và `mkdir -p` + `chmod 700`), hoặc thêm `backups/` vào `.gitignore`
- [ ] Chạy tay 1 lần và đọc kỹ output:
      `BACKUP_DIR=/var/backups/warranty-vault /opt/warranty-vault/deploy/backup.sh`
- [ ] Có **cả hai** file mới: `ls -lh /var/backups/warranty-vault/`
      → `db-<UTC timestamp>.sql.gz` **và** `uploads-<UTC timestamp>.tar.gz`
- [ ] ⚠️ **Kiểm tra kỹ file uploads**: `backup.sh` archive blob bằng
      `docker compose exec -T api sh -c ...` + `tar`, nhưng image `api` là
      `gcr.io/distroless/static-debian12:nonroot` — **không có `sh`, không có `tar`**
      (`api/Dockerfile`). Khi lệnh đó fail, script rơi vào nhánh else, in
      "(no uploads directory yet — skipping blob archive)" (kèm 1 dòng lỗi exec của
      docker ra stderr) và **vẫn exit 0**.
      Nghĩa là DB được backup còn attachment thì không, mà cron log trông vẫn xanh.
      Nếu chỉ thấy `db-*.sql.gz`, dùng lệnh alpine (image có `tar`) trong
      `deploy/README.md` § Backup:
      `docker run --rm -v warranty-vault_uploads:/data:ro -v /var/backups/warranty-vault:/backup alpine tar czf /backup/uploads-$(date -u +%Y%m%d-%H%M%S).tar.gz -C /data private-uploads`
- [ ] Retention đúng ý: `BACKUP_RETENTION_DAYS` (default 14)
- [ ] Backup `.env` (chứa `FILE_MASTER_KEY`) **riêng**, ngoài VPS: password manager
      hoặc kho mã hoá. Script backup **không** copy secret
- [ ] Copy thư mục backup sang máy khác / object storage (`rsync -az /var/backups/warranty-vault/ ...`)

**Restore drill — backup chưa từng restore thì chưa phải backup. Làm trước khi launch:**

- [ ] 1. Dựng Postgres scratch (không đụng DB thật):
      `docker run -d --name wv-restore-db -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=wv_restore -p 55432:5432 postgres:17-alpine`
- [ ] 2. Chờ healthy: `docker exec wv-restore-db pg_isready -U postgres -d wv_restore`
- [ ] 3. Restore dump (dump dùng `--clean --if-exists` nên tự drop/tạo lại object):
      `gunzip -c /var/backups/warranty-vault/db-<ts>.sql.gz | docker exec -i wv-restore-db psql -q -U postgres -d wv_restore`
- [ ] 4. Đếm dữ liệu — phải khớp với production:
      `docker exec -i wv-restore-db psql -U postgres -d wv_restore -c 'select count(*) from "User"' -c 'select count(*) from "Device"' -c 'select count(*) from "Attachment"'`
- [ ] 5. Kiểm tra archive blob: `tar tzf /var/backups/warranty-vault/uploads-<ts>.tar.gz | head`
      và `tar tzf ... | grep -c '\.enc$'` — số file `.enc` phải xấp xỉ số row `"Attachment"`
      (lệch nhiều = archive thiếu hoặc blob mồ côi)
- [ ] 6. **Test giải mã thật** (bước duy nhất chứng minh `FILE_MASTER_KEY` đúng):
      restore vào stack thật (hoặc bản staging) với **cùng** `FILE_MASTER_KEY`, rồi
      tải 1 attachment đã biết là có trong trình duyệt. ⚠️ Giải mã lỗi (sai key) bị
      `api/internal/services/attachments.go` map thành **404 "Không tìm thấy file"** —
      nên "file cũ tự nhiên 404 sau restore" gần như chắc chắn là **sai/khác `FILE_MASTER_KEY`**,
      không phải mất file
- [ ] 7. Dọn scratch: `docker rm -f wv-restore-db`, và ghi lại ngày + kết quả drill
      (1 dòng vào `README` nội bộ hoặc note cá nhân)

---

## 7. Smoke tests (copy-paste)

Từ **trên VPS** (đường local, không qua Caddy):

```bash
curl -sf http://localhost:4000/healthz        # {"ok":true}  — process còn sống
curl -s  http://localhost:4000/readyz         # {"ok":true}  — ping được DB (503 = DB chết)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login   # 200 — Next.js lên
```

Từ **ngoài** (qua Caddy + TLS):

```bash
curl -s  https://api.<domain>/healthz         # {"ok":true}
curl -s  https://api.<domain>/readyz          # {"ok":true}  ← endpoint đáng đưa cho uptime monitor
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/login        # 200
```

Đăng nhập + gọi endpoint cần auth (`LoginInput`: `email`, `password`; response có
`accessToken`, `expiresAt`, `user`):

```bash
TOKEN=$(curl -s -X POST https://api.<domain>/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ban@example.com","password":"<mật khẩu>"}' | jq -r .accessToken)

curl -s -H "Authorization: Bearer $TOKEN" https://api.<domain>/api/v1/auth/me
curl -s -H "Authorization: Bearer $TOKEN" https://api.<domain>/api/v1/devices   # {"devices":[...]}
```

- [ ] Login trả `accessToken` (không phải `invalid_credentials`)
- [ ] `/api/v1/auth/me` và `/api/v1/devices` trả 200
- [ ] ⚠️ Đừng lặp login quá nhiều: limiter là **20 lần/IP/15 phút** và **5 lần/(IP+email)/15 phút**
      → `429` là do test, không phải app hỏng (`api/internal/ratelimit/helpers.go`)
- [ ] Cron chạy qua HTTP (chặn ở public là đúng, nên gọi local):
      `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:4000/api/v1/cron/warranty-check`
      → `200` + JSON `stats`; sai secret → `401`
- [ ] Upload → tải lại 1 attachment trên web (⚠️ đây là **test duy nhất** chứng minh
      `FILE_MASTER_KEY` đúng: key sai/thiếu không làm api crash, `LoadMasterKey()`
      chỉ chạy lúc upload/download file)
- [ ] Login trên **HTTPS** thật (⚠️ cookie `wv_session` có `secure: true` khi
      `NODE_ENV=production` → test qua `http://<ip>:3000` sẽ không giữ được session)
- [ ] Mobile: đổi `BASE_URL` sang `https://api.<domain>`, login + mở danh sách thiết bị
- [ ] Export dữ liệu JSON trong web Settings → "Xuất dữ liệu" (chạm cả API lẫn quyền user)

---

## 8. Security hardening

- [ ] SSH: chỉ key, `PasswordAuthentication no`; không dùng root cho việc hằng ngày
- [ ] Firewall chỉ mở 22/80/443: `ufw allow 22,80,443/tcp && ufw enable`
- [ ] ⚠️ **`ufw` một mình KHÔNG chặn được 3000/4000**: compose publish
      `"4000:4000"` và `"3000:3000"` ra mọi interface, traffic vào port published đi
      qua chuỗi `FORWARD`/`DOCKER-USER` của Docker **trước** rule INPUT của ufw.
      Verify từ máy ngoài: `curl -m 3 http://<vps-ip>:4000/healthz` và
      `nc -vz <vps-ip> 3000` → **phải fail/timeout**. Nếu vẫn vào được, chặn bằng:
      ```bash
      WAN=$(ip route get 1.1.1.1 | awk '{print $5; exit}')
      iptables -I DOCKER-USER -i "$WAN" -p tcp -m multiport --dports 3000,4000 -j DROP
      ```
      (lưu lại qua `iptables-persistent`/`netfilter-persistent save`, hoặc dùng
      `ufw-docker`). Cách sạch nhất về lâu dài: đổi trong `docker-compose.yml` thành
      `127.0.0.1:4000:4000` và `127.0.0.1:3000:3000` — Caddy vẫn gọi được qua localhost
- [ ] Postgres không publish ra host: cột PORTS của `docker compose ps` để trống ở `postgres`
- [ ] `SESSION_SECRET` ≥32 ký tự và đã backup (đổi = logout toàn bộ user web)
- [ ] `FILE_MASTER_KEY` đã backup ở nơi khác (xem §6) — không nằm cạnh dump DB
- [ ] HSTS bật (đã có trong `deploy/caddy/Caddyfile` snippet `security_headers`) + toàn bộ traffic qua HTTPS
- [ ] Cron route bị Caddy trả 404 từ public (§3) — không expose `POST /api/v1/cron/*`
- [ ] Rate limit: mặc định in-memory là chấp nhận được cho 1 instance; muốn bền qua
      restart thì set Upstash
- [ ] File backup + log chỉ root đọc được: `chmod 700 /var/backups/warranty-vault`,
      `chmod 600 /var/log/wv-backup.log` (log chứa tên DB, không chứa secret)
- [ ] Không có secret nào lọt vào git: `git status --short` sạch, `git check-ignore -v .env` khớp

---

## 9. Rollback

Chuẩn bị **trước** khi deploy (2 phút, đáng giá):

- [ ] Ghi lại SHA đang chạy: `cd /opt/warranty-vault && git rev-parse HEAD`
- [ ] Giữ image cũ để quay lui nhanh (compose dùng tag cố định `warranty-vault-api:local`
      và `warranty-vault-web:local`, build mới sẽ **ghi đè**):
      `docker tag warranty-vault-api:local warranty-vault-api:prev; docker tag warranty-vault-web:local warranty-vault-web:prev`
- [ ] Có 1 dump DB mới nhất + `.env` ở nơi khác (§6)

Khi deploy lỗi:

- [ ] Code: `git checkout <sha-cũ>` → `docker compose up -d --build`
- [ ] Schema (nếu release mới có migration): `docker compose run --rm --entrypoint /app/migrate api status`
      → nếu version mới hơn bản code cũ chịu được, chạy `... api down` cho từng bước
      (⚠️ `down` = 1 bước; `down-to` không được phép qua wrapper)
- [ ] Dữ liệu: chỉ restore dump khi thật sự mất dữ liệu — restore **không** tự khôi
      phục blob, phải restore kèm archive uploads tương ứng (§6)
- [ ] Sau rollback: `docker compose ps`, chạy lại §7 smoke tests, và kiểm tra timer
      cron vẫn active (`systemctl list-timers | grep warranty`)
- [ ] Nếu rollback do lỗi bảo mật (lộ secret): rotate `SESSION_SECRET`, `CRON_SECRET`,
      `POSTGRES_PASSWORD` → `docker compose up -d --force-recreate`; ⚠️ **không** đổi
      `FILE_MASTER_KEY` (sẽ làm toàn bộ attachment cũ không đọc được)

---

## 10. Cổng go-live

- [ ] Tất cả mục trên đã tick (hoặc ghi rõ lý do bỏ qua)
- [ ] `docker compose ps` xanh; `curl localhost:4000/readyz` = 200
- [ ] Timer cron active và đã chạy thành công ít nhất 1 lần
- [ ] Backup đã chạy 1 lần **và** restore drill đã pass **và** `.env` đã backup ngoài VPS
- [ ] Uptime monitor đã trỏ vào `https://api.<domain>/readyz` (xem `deploy/README.md` § Monitoring & health)
- [ ] Login + upload attachment + nhận 1 push thật đã thử trên domain thật
