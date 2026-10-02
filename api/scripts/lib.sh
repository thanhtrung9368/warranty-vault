#!/usr/bin/env bash
# shellcheck shell=bash
# ============================================================================
# lib.sh — tiện ích dùng chung cho các script e2e trong api/scripts/
#
# KHÔNG phụ thuộc `psql`: bản Postgres chạy trên máy dev (zonky embedded
# binaries) chỉ có initdb/pg_ctl/postgres, không kèm client. Mọi truy vấn SQL
# đi qua ./dbtool (Go + pgx — xem scripts/dbtool/main.go).
#
# Một script test chỉ cần:
#
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
#   . "${SCRIPT_DIR}/lib.sh"
#   wv_init "${API_DIR}"
#
# rồi dùng: wv_require_server, wv_curl, wv_curl_status, wv_register, wv_sql,
# wv_cleanup_user, assert, wv_summary.
#
# Biến do runner (e2e.sh) hoặc người gọi export luôn THẮNG giá trị trong
# api/.env: WV_BASE_URL, DATABASE_URL, CRON_SECRET, FILE_MASTER_KEY,
# PRIVATE_UPLOAD_ROOT, PORT, WV_CLIENT_IP, WV_BODY_FILE.
# ============================================================================

# Đường dẫn file JSON của response gần nhất (dùng cho jq + dump khi assert lỗi).
WV_BODY_FILE="${WV_BODY_FILE:-/tmp/wv_body.json}"

WV_PASS=0
WV_FAIL=0

# wv_init API_DIR [TÊN_SCRIPT]
#   - nạp api/.env (không ghi đè biến đã có trong môi trường)
#   - kiểm tra công cụ bắt buộc, build dbtool nếu cần
#   - chốt WV_BASE_URL + WV_CLIENT_IP cho script này
wv_init() {
  local api_dir="${1:-}"
  if [ -z "${api_dir}" ]; then
    echo "wv_init: thiếu tham số API_DIR" >&2
    exit 1
  fi

  WV_API_DIR="${api_dir}"
  # Khi được `source`, BASH_SOURCE[1] là file script đang gọi wv_init.
  WV_SCRIPT_NAME="${2:-${BASH_SOURCE[1]##*/}}"

  wv_load_env "${api_dir}"

  WV_BASE_URL="${WV_BASE_URL:-http://localhost:4000}"
  BASE="${WV_BASE_URL}"

  # Mỗi script giả một client IP riêng qua X-Forwarded-For: rate limit auth là
  # 10 register / 15 phút theo IP (internal/ratelimit/helpers.go) nên chạy cả
  # bộ từ 127.0.0.1 sẽ đụng 429 từ script thứ 11 trở đi. Server đọc XFF ở hop
  # đầu tiên (GetClientIP) nên chỉ cần gắn header, không cần IP thật.
  WV_CLIENT_IP="${WV_CLIENT_IP:-$(wv_fake_ip "${WV_SCRIPT_NAME}")}"

  local tool
  for tool in curl jq; do
    command -v "${tool}" >/dev/null 2>&1 || {
      echo "Thiếu công cụ bắt buộc: ${tool}" >&2
      exit 1
    }
  done

  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL chưa được đặt — cần cho dbtool (dọn user test + seed fixture)." >&2
    echo "  → Chạy cả bộ:   ./scripts/e2e.sh   (runner tự tạo DB tạm rồi export)" >&2
    exit 1
  fi
  export DATABASE_URL

  wv_build_dbtool
  mkdir -p "$(dirname "${WV_BODY_FILE}")"
}

# wv_load_env API_DIR — đọc api/.env, bỏ qua biến đã có trong môi trường.
#
# Không dùng `source .env` vì như vậy .env sẽ ghi đè DATABASE_URL do runner
# trỏ vào database tạm, khiến test chạy nhầm vào DB dev.
wv_load_env() {
  local f="${1}/.env" line key value
  [ -f "${f}" ] || return 0

  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      '' | '#'*) continue ;;
      *=*) ;;
      *) continue ;;
    esac

    key="$(printf '%s' "${line%%=*}" | tr -d '[:space:]')"
    case "${key}" in
      '' | *[!A-Za-z0-9_]*) continue ;;
    esac

    value="${line#*=}"
    case "${value}" in
      \"*\") value="${value#\"}" && value="${value%\"}" ;;
      \'*\') value="${value#\'}" && value="${value%\'}" ;;
    esac

    # Biến đã có sẵn (kể cả rỗng) thì giữ nguyên.
    if [ -z "${!key:-}" ]; then
      export "${key}=${value}"
    fi
  done < "${f}"
}

# wv_build_dbtool — build ./scripts/dbtool vào api/tmp/e2e/dbtool (đã gitignore).
# Build lại khi source mới hơn binary. Không dùng `go run` vì mỗi truy vấn một
# tiến trình: build một lần rồi gọi binary cho nhanh và ổn định.
wv_build_dbtool() {
  local src="${WV_API_DIR}/scripts/dbtool"
  local bin="${WV_DBTOOL:-${WV_API_DIR}/tmp/e2e/dbtool}"

  if [ ! -x "${bin}" ] || [ -n "$(find "${src}" -newer "${bin}" -print -quit 2>/dev/null)" ]; then
    command -v go >/dev/null 2>&1 || {
      echo "Thiếu công cụ bắt buộc: go (dùng để build scripts/dbtool)" >&2
      exit 1
    }
    mkdir -p "$(dirname "${bin}")"
    if ! (cd "${WV_API_DIR}" && go build -o "${bin}" ./scripts/dbtool); then
      echo "Build scripts/dbtool thất bại" >&2
      exit 1
    fi
  fi

  WV_DBTOOL="${bin}"
  export WV_DBTOOL
}

# wv_fake_ip TÊN — IP giả ổn định (10.42.x.y) suy ra từ tên script.
wv_fake_ip() {
  local sum
  sum="$(printf '%s' "${1:-script}" | cksum | cut -d' ' -f1)"
  printf '10.42.%d.%d\n' "$(((sum / 251) % 251 + 1))" "$((sum % 251 + 1))"
}

# wv_db_url_with_name URL TÊN_DB — thay database trong URL kết nối (giữ nguyên
# scheme, host:port và query string như ?sslmode=disable).
wv_db_url_with_name() {
  local url="$1" name="$2" scheme rest hostport query=""

  case "${url}" in
    *://*) ;;
    *)
      echo "wv_db_url_with_name: URL không hợp lệ (thiếu scheme): ${url}" >&2
      return 1
      ;;
  esac

  case "${url}" in
    *\?*)
      query="?${url#*\?}"
      url="${url%%\?*}"
      ;;
  esac

  scheme="${url%%://*}://"
  rest="${url#*://}"
  case "${rest}" in
    */*) hostport="${rest%%/*}" ;;
    *) hostport="${rest}" ;;
  esac

  printf '%s%s/%s%s\n' "${scheme}" "${hostport}" "${name}" "${query}"
}

# wv_drop_db URL_ADMIN TÊN_DB — ngắt mọi kết nối rồi DROP DATABASE.
# Không bao giờ fail: đây là hàm dọn dẹp.
wv_drop_db() {
  local admin_url="$1" db="$2"
  DATABASE_URL="${admin_url}"
  wv_sql -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  wv_sql -q -c "DROP DATABASE IF EXISTS \"${db}\";" >/dev/null 2>&1 || true
  return 0
}

# wv_require_server — thoát sớm nếu server chưa chạy.
wv_require_server() {
  echo "→ Kiểm tra server: ${WV_BASE_URL}"
  if wv_curl -sf -m 3 "${WV_BASE_URL}/healthz" -o /dev/null; then
    echo "  OK    server đang chạy"
    return 0
  fi
  echo "Không kết nối được ${WV_BASE_URL}." >&2
  echo "  → Chạy cả bộ:   ./scripts/e2e.sh" >&2
  echo "  → Hoặc tự chạy: cd api && go run ./cmd/server" >&2
  exit 1
}

# wv_curl — curl + header X-Forwarded-For của script này.
wv_curl() {
  curl -H "x-forwarded-for: ${WV_CLIENT_IP}" "$@"
}

# wv_curl_status — như wv_curl nhưng in HTTP status, body lưu vào WV_BODY_FILE.
wv_curl_status() {
  curl -s -o "${WV_BODY_FILE}" -w '%{http_code}' \
    -H "x-forwarded-for: ${WV_CLIENT_IP}" "$@"
}

# wv_register EMAIL PW NAME — đặt WV_STATUS (HTTP code) và WV_TOKEN.
wv_register() {
  local email="$1" pw="$2" name="$3"
  WV_STATUS="$(wv_curl_status -X POST "${WV_BASE_URL}/api/v1/auth/register" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${email}\",\"password\":\"${pw}\",\"name\":\"${name}\"}")"
  WV_TOKEN="$(jq -r '.accessToken // empty' "${WV_BODY_FILE}" 2>/dev/null)"
}

# wv_sql — chạy SQL qua dbtool (tham số y như `psql -tA`, xem scripts/dbtool).
wv_sql() {
  if [ -z "${WV_DBTOOL:-}" ]; then
    echo "wv_sql: phải gọi wv_init trước" >&2
    exit 1
  fi
  "${WV_DBTOOL}" "$@"
}

# wv_cleanup_user EMAIL — xoá user test (cascade xuống mọi bảng con).
# Không bao giờ làm script fail: đây là hàm dọn dẹp chạy trong trap EXIT.
wv_cleanup_user() {
  local email="$1"
  [ -n "${WV_DBTOOL:-}" ] || return 0
  "${WV_DBTOOL}" -q -c "DELETE FROM \"User\" WHERE email = '${email}';" >/dev/null 2>&1 || true
  return 0
}

# assert ĐIỀU_KIỆN THÔNG_ĐIỆP — ĐIỀU_KIỆN là chuỗi "true"/"false".
assert() {
  local cond="$1" msg="$2"
  if [ "${cond}" = "true" ]; then
    echo "  OK    ${msg}"
    WV_PASS=$((WV_PASS + 1))
  else
    echo "  FAIL  ${msg}  body=$(head -c 400 "${WV_BODY_FILE}" 2>/dev/null)"
    WV_FAIL=$((WV_FAIL + 1))
  fi
}

# wv_summary "THÔNG_ĐIỆP KHI ĐẠT" — in tổng kết, exit 1 nếu có assertion lỗi.
wv_summary() {
  echo
  echo "Đạt: ${WV_PASS}  Lỗi: ${WV_FAIL}"
  if [ "${WV_FAIL}" != "0" ]; then
    exit 1
  fi
  echo "${1:-TẤT CẢ TEST ĐỀU ĐẠT}"
}
