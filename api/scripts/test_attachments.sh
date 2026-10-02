#!/usr/bin/env bash
# Parity test for /api/v1/devices/{id}/attachments + /api/files/{id} against the
# Go service. Verifies upload, listing, download (byte length), MIME whitelist
# enforcement (fake-jpeg-with-script body), 5MB cap, and delete-then-404.
#
# Chạy qua runner: ./scripts/e2e.sh [--only attachments]
# Dọn dẹp: xoá user test (cascade) qua dbtool — không cần psql.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__goattachtest__@local.test"
PW="attach-test-pw-12345"
TMP_PREFIX="${WV_E2E_TMP:-/tmp}"

for tool in python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Thiếu công cụ bắt buộc: $tool" >&2; exit 1; }
done

cleanup() {
  wv_cleanup_user "${TEST_EMAIL}"
  rm -f "${TMP_PREFIX}/wv_pixel.png" "${TMP_PREFIX}/wv_fake.jpg" \
    "${TMP_PREFIX}/wv_big.jpg" "${TMP_PREFIX}/wv_dl.bin"
}

wv_require_server

echo "→ Dọn dữ liệu test cũ"
cleanup
trap cleanup EXIT

echo "→ Đăng ký"
wv_register "${TEST_EMAIL}" "${PW}" "Attach Test"
[ "$WV_STATUS" = "201" ] && cond=true || cond=false
assert "$cond" "register trả 201 (nhận $WV_STATUS)"
TOKEN="$WV_TOKEN"
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Tạo thiết bị để gắn attachment"
status=$(wv_curl_status -X POST "${BASE}/api/v1/devices" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"Attachment Host Device",
    "category":"PHONE",
    "purchaseDate":"2026-01-01",
    "purchasePrice":1000000,
    "warrantyMonths":0
  }')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "tạo thiết bị trả 201 (nhận $status)"
DEVICE_ID=$(jq -r '.device.id' "$WV_BODY_FILE")

echo
echo "→ Sinh PNG 1 pixel (magic bytes thật — decode đơn giản hơn JPEG)"
python3 - "${TMP_PREFIX}/wv_pixel.png" <<'PY'
import struct
import sys
import zlib


def chunk(t, d):
    crc = zlib.crc32(t + d) & 0xFFFFFFFF
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', crc)


sig = b'\x89PNG\r\n\x1a\n'
ihdr = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)  # 1x1, 8-bit RGB
raw = b'\x00\xff\xff\xff'  # filter byte + RGB white pixel
idat = zlib.compress(raw)
out = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')
with open(sys.argv[1], 'wb') as fh:
    fh.write(out)
PY
[ -s "${TMP_PREFIX}/wv_pixel.png" ] && cond=true || cond=false
assert "$cond" "đã tạo fixture PNG 1 pixel"

echo
echo "→ Upload PNG 1 pixel"
status=$(wv_curl_status -X POST "${BASE}/api/v1/devices/${DEVICE_ID}/attachments" \
  -H "$H_AUTH" \
  -F "file=@${TMP_PREFIX}/wv_pixel.png;type=image/png" \
  -F "description=Test PNG")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "upload trả 201 (nhận $status)"
ATT_ID=$(jq -r '.attachment.id' "$WV_BODY_FILE")
ATT_TYPE=$(jq -r '.attachment.fileType' "$WV_BODY_FILE")
[ "$ATT_TYPE" = "image/png" ] && cond=true || cond=false
assert "$cond" "fileType nhận diện là image/png (nhận $ATT_TYPE)"
ATT_SIZE=$(jq -r '.attachment.fileSize' "$WV_BODY_FILE")
[ "$ATT_SIZE" != "null" ] && [ "$ATT_SIZE" -gt 0 ] && cond=true || cond=false
assert "$cond" "fileSize > 0 (nhận $ATT_SIZE)"

echo
echo "→ Liệt kê attachment"
status=$(wv_curl_status -X GET "${BASE}/api/v1/devices/${DEVICE_ID}/attachments" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list attachments trả 200 (nhận $status)"
COUNT=$(jq '.attachments | length' "$WV_BODY_FILE")
[ "$COUNT" = "1" ] && cond=true || cond=false
assert "$cond" "danh sách đúng 1 attachment (nhận $COUNT)"

echo
echo "→ GET /api/files/{id} → so số byte với fileSize"
http_code=$(wv_curl -s -o "${TMP_PREFIX}/wv_dl.bin" -w "%{http_code}" \
  -H "$H_AUTH" "${BASE}/api/files/${ATT_ID}")
[ "$http_code" = "200" ] && cond=true || cond=false
assert "$cond" "download trả 200 (nhận $http_code)"
DL_SIZE=$(wc -c < "${TMP_PREFIX}/wv_dl.bin" | tr -d ' ')
[ "$DL_SIZE" = "$ATT_SIZE" ] && cond=true || cond=false
assert "$cond" "số byte tải về ($DL_SIZE) == fileSize ($ATT_SIZE)"

echo
echo "→ JPEG giả (khai image/jpeg, nội dung <script>) → 400"
printf '<script>alert(1)</script>' > "${TMP_PREFIX}/wv_fake.jpg"
status=$(wv_curl_status -X POST "${BASE}/api/v1/devices/${DEVICE_ID}/attachments" \
  -H "$H_AUTH" \
  -F "file=@${TMP_PREFIX}/wv_fake.jpg;type=image/jpeg")
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "jpeg giả chứa script trả 400 (nhận $status)"

echo
echo "→ File quá khổ (6 MB) → 413"
# 6 MB số 0. Service chặn theo 5MB cap TRƯỚC khi detect MIME, nên kỳ vọng 413
# (nếu không qua cap thì đã là 400 vì MIME rác).
dd if=/dev/zero of="${TMP_PREFIX}/wv_big.jpg" bs=1024 count=6144 2>/dev/null
status=$(wv_curl_status -X POST "${BASE}/api/v1/devices/${DEVICE_ID}/attachments" \
  -H "$H_AUTH" \
  -F "file=@${TMP_PREFIX}/wv_big.jpg;type=image/jpeg")
[ "$status" = "413" ] && cond=true || cond=false
assert "$cond" "upload 6MB trả 413 (nhận $status)"

echo
echo "→ Xoá attachment"
status=$(wv_curl_status -X DELETE "${BASE}/api/v1/attachments/${ATT_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "xoá attachment trả 200 (nhận $status)"

echo
echo "→ GET /api/files/{id} sau khi xoá → 404"
status=$(wv_curl_status -X GET "${BASE}/api/files/${ATT_ID}" -H "$H_AUTH")
[ "$status" = "404" ] && cond=true || cond=false
assert "$cond" "GET file đã xoá trả 404 (nhận $status)"

wv_summary "TOÀN BỘ TEST ATTACHMENTS ĐỀU ĐẠT"
