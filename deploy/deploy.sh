#!/usr/bin/env bash
#
# Deploy một commit cụ thể của Warrly lên VPS đang chạy.
#
#   ./deploy/deploy.sh <sha> [thư-mục-repo]
#
# Đây là nửa "chạy trên VPS" của CD. `.github/workflows/deploy.yml` gọi script
# này qua SSH; chạy tay cũng được và cho ra đúng kết quả. Mọi thứ script làm đều
# là thứ README mô tả từ trước — script chỉ làm nó theo đúng thứ tự và dừng lại
# khi sai, thay vì để người vận hành nhớ thứ tự.
#
# THỨ TỰ QUAN TRỌNG. API container **không** tự chạy migration lúc khởi động
# (`api/Dockerfile` có `CMD ["/app/server"]` và một binary `migrate` riêng), nên
# migration phải chạy giữa "build xong image mới" và "server mới nhận traffic".
# Đảo thứ tự là chạy code mới trên schema cũ.
#
# Rollback: script ghi lại SHA đang chạy trước khi đổi. Nếu health check sau khi
# deploy thất bại, nó tự quay về SHA đó. `.env` không nằm trong git nên rollback
# không đụng tới secret.
set -euo pipefail

SHA="${1:-}"
REPO_DIR="${2:-/opt/warranty-vault}"

if [ -z "$SHA" ]; then
  echo "usage: $0 <sha> [repo-dir]" >&2
  exit 64
fi

cd "$REPO_DIR"

say() { printf '\n\033[1m[deploy] %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m[deploy] FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. Biến bắt buộc phải có trong .env ──────────────────────────────────────
# Thiếu APP_URL thì website không dựng được metadata (canonical, og:url,
# hreflang) và compose giờ từ chối khởi động — nhưng báo lỗi ở đây rõ hơn là để
# `docker compose up` in ra một thông báo lồng trong log build.
say "kiểm tra .env"
[ -f .env ] || fail "không thấy .env trong $REPO_DIR"
for key in APP_URL SESSION_SECRET POSTGRES_PASSWORD; do
  grep -qE "^${key}=.+" .env || fail ".env thiếu ${key} — xem deploy/README.md"
done
grep -qE '^APP_URL=https?://' .env || fail "APP_URL trong .env không phải URL http(s)"
echo "  .env ok ($(grep -cE '^[A-Z_]+=' .env) biến)"

# ── 1. Ghi lại SHA đang chạy, để rollback được ───────────────────────────────
PREV_SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"
say "đang chạy: ${PREV_SHA:0:7} → deploy: ${SHA:0:7}"

# ── 2. Lấy đúng commit ───────────────────────────────────────────────────────
# `checkout --force` vì VPS có thể có file build còn sót; không có file nào do
# người sửa tay trong repo này mà cần giữ.
say "git fetch + checkout ${SHA:0:7}"
git fetch --prune --tags origin
git checkout --force "$SHA"
echo "  HEAD = $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

# ── 3. Build trước khi ngắt cái đang chạy ────────────────────────────────────
# Build hỏng ở bước này thì site cũ vẫn sống. Đó là lý do tách khỏi `up -d`.
say "docker compose build (site hiện tại vẫn đang chạy)"
docker compose build

# ── 4. Migration, trước khi server mới nhận request ──────────────────────────
# Migration của repo này là additive (thêm bảng/cột/index), nên server CŨ vẫn
# chạy được trên schema MỚI trong khoảng thời gian giữa bước này và bước 5. Đó
# là điều kiện để thứ tự này an toàn.
say "migrate"
docker compose run --rm api /app/migrate up

# ── 5. Đưa container mới lên ─────────────────────────────────────────────────
say "docker compose up -d"
docker compose up -d --remove-orphans

# ── 6. Caddy: reload, không restart ──────────────────────────────────────────
# Chỉ cần nếu Caddyfile đổi; reload là no-op rẻ khi không đổi. Không có sudo
# passwordless thì bỏ qua chứ không làm hỏng deploy — container đã lên rồi.
say "reload caddy"
sudo -n systemctl reload caddy 2>/dev/null || echo "  (bỏ qua — không có sudo -n; Caddyfile có đổi thì reload tay)"

# ── 7. Health check, có rollback ─────────────────────────────────────────────
# Kiểm từ chính VPS qua localhost, không qua Cloudflare: đây là kiểm app, không
# phải kiểm CDN. `/vi` và `/sitemap.xml` là hai thứ chỉ tồn tại sau đợt SEO, nên
# chúng chứng minh đúng commit đã lên chứ không chỉ "có gì đó trả 200".
say "health check"
BAD=0
# `up -d` trả về khi container được tạo, không phải khi Next đã nghe port. Kiểm
# ngay thì lần deploy nào cũng thấy 000 và rollback oan; chờ tối đa 90s cho web.
for _ in $(seq 1 45); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/ || echo 000)" = 200 ] && break
  sleep 2
done
check() {
  local path="$1" want="$2" got
  got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:3000${path}" || echo 000)"
  if [ "$got" = "$want" ]; then printf '  ✓ %-16s %s\n' "$path" "$got"
  else printf '  ✗ %-16s %s (mong %s)\n' "$path" "$got" "$want"; BAD=1; fi
}
for path in / /vi /robots.txt /sitemap.xml /privacy; do check "$path" 200; done
check "/favicon.ico" 200
check "/notification-badge-96.png" 200

# API sống thì web mới có nghĩa; kiểm riêng vì nó là service khác.
api_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:4000/healthz || echo 000)"
if [ "$api_code" = 200 ]; then echo "  ✓ /healthz (api)    200"; else echo "  ✗ /healthz (api)    $api_code"; BAD=1; fi

if [ "$BAD" -ne 0 ]; then
  echo
  echo "Health check thất bại. Container đang chạy:"
  docker compose ps
  if [ -n "$PREV_SHA" ]; then
    say "ROLLBACK về ${PREV_SHA:0:7}"
    git checkout --force "$PREV_SHA"
    docker compose up -d --build --remove-orphans
    echo "  đã rollback — kiểm lại bằng: curl -sI http://127.0.0.1:3000/ | head -1"
  else
    echo "  không có SHA trước đó để rollback (lần deploy đầu tiên?)"
  fi
  exit 1
fi

say "xong — ${SHA:0:7} đang chạy"
echo "  rollback nếu cần: $0 ${PREV_SHA:-<sha>} $REPO_DIR"
