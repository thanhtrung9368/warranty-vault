#!/usr/bin/env bash
# Parity test for /api/v1/devices/{id}/attachments + /api/files/{id} against the Go
# service. Verifies upload, listing, download (byte length), MIME whitelist
# enforcement (fake-jpeg-with-script body), 5MB cap, and delete-then-404.
# Cleans up via cascade delete of the scoped test user.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -f "${API_DIR}/.env" ]; then
  set -o allexport
  # shellcheck disable=SC1090,SC1091
  source "${API_DIR}/.env"
  set +o allexport
fi

BASE="${WV_BASE_URL:-http://localhost:4000}"
TEST_EMAIL="__goattachtest__@local.test"
PW="attach-test-pw-12345"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set." >&2
  exit 1
fi
for tool in curl jq psql python3; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

PASS=0
FAIL=0
assert() {
  local cond="$1" msg="$2"
  if [ "$cond" = "true" ]; then
    echo "  OK    $msg"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $msg  body=$(cat /tmp/wv_body.json 2>/dev/null | head -c 400)"
    FAIL=$((FAIL+1))
  fi
}

cleanup() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc \
    "DELETE FROM \"User\" WHERE email = '${TEST_EMAIL}';" >/dev/null
  rm -f /tmp/wv_pixel.png /tmp/wv_pixel.jpg /tmp/wv_fake.jpg /tmp/wv_big.jpg /tmp/wv_dl.bin
}

curl_status() {
  curl -s -o /tmp/wv_body.json -w "%{http_code}" "$@"
}

ping_server() {
  curl -sf -m 3 "${BASE}/healthz" -o /dev/null
}

echo "→ Server check: ${BASE}"
ping_server || { echo "Server not reachable. Start \`go run ./cmd/server\` first." >&2; exit 1; }

cleanup
trap cleanup EXIT

echo "→ Register"
status=$(curl_status -X POST "${BASE}/api/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${PW}\",\"name\":\"Attach Test\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "register returns 201 (got $status)"
TOKEN=$(jq -r '.accessToken' /tmp/wv_body.json)
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Create device for attachments"
status=$(curl_status -X POST "${BASE}/api/v1/devices" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"Attachment Host Device",
    "category":"PHONE",
    "purchaseDate":"2026-01-01",
    "purchasePrice":1000000,
    "warrantyMonths":0
  }')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "create device returns 201 (got $status)"
DEVICE_ID=$(jq -r '.device.id' /tmp/wv_body.json)

echo
echo "→ Generate a 1-pixel PNG (real magic bytes — simpler decode than JPEG)"
python3 - <<'PY'
import zlib, struct
def chunk(t, d):
    crc = zlib.crc32(t + d) & 0xFFFFFFFF
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', crc)
sig = b'\x89PNG\r\n\x1a\n'
ihdr = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)  # 1x1, 8-bit RGB
raw = b'\x00\xff\xff\xff'  # filter byte + RGB white pixel
idat = zlib.compress(raw)
out = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')
open('/tmp/wv_pixel.png','wb').write(out)
PY
[ -s /tmp/wv_pixel.png ] && cond=true || cond=false
assert "$cond" "1-pixel PNG fixture written"

echo
echo "→ Upload 1-pixel PNG"
status=$(curl_status -X POST "${BASE}/api/v1/devices/${DEVICE_ID}/attachments" \
  -H "$H_AUTH" \
  -F "file=@/tmp/wv_pixel.png;type=image/png" \
  -F "description=Test PNG")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "upload returns 201 (got $status)"
ATT_ID=$(jq -r '.attachment.id' /tmp/wv_body.json)
ATT_TYPE=$(jq -r '.attachment.fileType' /tmp/wv_body.json)
[ "$ATT_TYPE" = "image/png" ] && cond=true || cond=false
assert "$cond" "fileType detected as image/png (got $ATT_TYPE)"
ATT_SIZE=$(jq -r '.attachment.fileSize' /tmp/wv_body.json)
[ "$ATT_SIZE" != "null" ] && [ "$ATT_SIZE" -gt 0 ] && cond=true || cond=false
assert "$cond" "fileSize > 0 (got $ATT_SIZE)"

echo
echo "→ List attachments"
status=$(curl_status -X GET "${BASE}/api/v1/devices/${DEVICE_ID}/attachments" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list attachments returns 200 (got $status)"
COUNT=$(jq '.attachments | length' /tmp/wv_body.json)
[ "$COUNT" = "1" ] && cond=true || cond=false
assert "$cond" "list returns exactly 1 attachment (got $COUNT)"

echo
echo "→ GET /api/files/{id} → assert byte length matches fileSize"
http_code=$(curl -s -o /tmp/wv_dl.bin -w "%{http_code}" \
  -H "$H_AUTH" "${BASE}/api/files/${ATT_ID}")
[ "$http_code" = "200" ] && cond=true || cond=false
assert "$cond" "download returns 200 (got $http_code)"
DL_SIZE=$(wc -c < /tmp/wv_dl.bin | tr -d ' ')
[ "$DL_SIZE" = "$ATT_SIZE" ] && cond=true || cond=false
assert "$cond" "downloaded byte length ($DL_SIZE) == fileSize ($ATT_SIZE)"

echo
echo "→ Fake JPEG (declared image/jpeg, body literal <script>) → 400"
printf '<script>alert(1)</script>' > /tmp/wv_fake.jpg
status=$(curl_status -X POST "${BASE}/api/v1/devices/${DEVICE_ID}/attachments" \
  -H "$H_AUTH" \
  -F "file=@/tmp/wv_fake.jpg;type=image/jpeg")
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "fake-jpeg-with-script returns 400 (got $status)"

echo
echo "→ Oversize file (6 MB) → 413"
# 6 MB of zeros, magic bytes are PDF-ish? Actually empty bytes — service will
# reject MIME first (400) UNLESS we exceed 5MB cap, in which case service
# returns 413 before MIME detect runs. Let's just test the 5MB cap.
dd if=/dev/zero of=/tmp/wv_big.jpg bs=1024 count=6144 2>/dev/null
status=$(curl_status -X POST "${BASE}/api/v1/devices/${DEVICE_ID}/attachments" \
  -H "$H_AUTH" \
  -F "file=@/tmp/wv_big.jpg;type=image/jpeg")
[ "$status" = "413" ] && cond=true || cond=false
assert "$cond" "6MB upload returns 413 (got $status)"

echo
echo "→ Delete attachment"
status=$(curl_status -X DELETE "${BASE}/api/v1/attachments/${ATT_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "delete attachment returns 200 (got $status)"

echo
echo "→ GET /api/files/{id} after delete → 404"
status=$(curl_status -X GET "${BASE}/api/files/${ATT_ID}" -H "$H_AUTH")
[ "$status" = "404" ] && cond=true || cond=false
assert "$cond" "GET deleted file returns 404 (got $status)"

echo
echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL ATTACHMENTS FLOW TESTS PASSED"
