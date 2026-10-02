#!/usr/bin/env bash
# ============================================================================
# e2e.sh — runner cho toàn bộ suite HTTP e2e của api/.
#
# Vì sao có runner này: các script test_*.sh chỉ là client HTTP — chúng cần một
# server thật + một DB đã migrate + env đầy đủ (DATABASE_URL, FILE_MASTER_KEY,
# CRON_SECRET…). Trước đây không ai làm phần đó nên suite chưa từng chạy được
# đầu-cuối. Runner này làm hết:
#
#   1. tạo database tạm (CREATE DATABASE trên Postgres admin)
#   2. áp migration bằng cmd/migrate
#   3. build + chạy cmd/server ở cổng test, chờ /readyz
#   4. chạy từng script test_*.sh, in pass/fail + log riêng
#   5. DỌN SẠCH dù thành công hay thất bại: kill server, DROP database tạm
#      (trap EXIT/INT/TERM nên Ctrl-C giữa chừng cũng không để lại rác)
#
# Cách dùng:
#   ./scripts/e2e.sh                       # chạy hết
#   ./scripts/e2e.sh --only stats          # chỉ script có tên chứa "stats"
#   ./scripts/e2e.sh --db-url 'postgres://user@host:5432/postgres?sslmode=disable'
#   ./scripts/e2e.sh --port 4321           # đổi cổng server test
#   ./scripts/e2e.sh --go-tests            # thêm `go test ./...` với DB tạm
#   ./scripts/e2e.sh --list                # liệt kê script sẽ chạy
#
# Không cần `psql`: mọi thao tác SQL đi qua scripts/dbtool (Go + pgx), gọi từ
# lib.sh; người dùng cuối có thể gọi tay qua scripts/dbtool.sh.
#
# Sau khi chạy: server bị dừng, database tạm bị DROP, không còn tiến trình treo.
# Log từng script được giữ ở api/tmp/e2e/run-*/logs/ (đã gitignore) để soi lại;
# runner tự dọn các thư mục run cũ, chỉ giữ 5 lần chạy gần nhất.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

# Postgres mặc định của môi trường dev (zonky embedded binaries). Chỉ dùng làm
# kết nối ADMIN để CREATE/DROP database tạm — suite không ghi vào DB này.
WV_DEFAULT_DB_URL="postgres://postgres@127.0.0.1:55432/postgres?sslmode=disable"

# FILE_MASTER_KEY cho test: 32 byte base64 hợp lệ. Key thật của dev (nếu có
# trong .env) vẫn được ưu tiên vì wv_load_env chỉ điền khi biến chưa được set.
WV_E2E_FILE_MASTER_KEY="d2FycmFudHktdmF1bHQtZTJlLW1hc3Rlci1rZXkhISE="

DB_URL_OVERRIDE=""
PORT="${WV_E2E_PORT:-4187}"
ONLY=""
WITH_GO_TESTS=0
LIST_ONLY=0

usage() {
  cat <<'EOF'
usage: e2e.sh [tuỳ chọn]

  --db-url URL   Postgres admin dùng để tạo DB tạm (mặc định: $WV_E2E_DATABASE_URL
                 → $WV_TEST_DATABASE_URL → postgres://postgres@127.0.0.1:55432/postgres?sslmode=disable)
  --port N       cổng chạy server test (mặc định 4187, hoặc $WV_E2E_PORT)
  --only CHUỖI   chỉ chạy script có tên chứa CHUỖI (ví dụ: stats, cron, auth)
  --go-tests     chạy thêm `go test ./...` với WV_TEST_DATABASE_URL trỏ DB tạm
  --list         in danh sách script rồi thoát
  -h, --help     in trợ giúp này
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --db-url)
      DB_URL_OVERRIDE="${2:?--db-url cần một giá trị}"
      shift 2
      ;;
    --port)
      PORT="${2:?--port cần một giá trị}"
      shift 2
      ;;
    --only)
      ONLY="${2:?--only cần một giá trị}"
      shift 2
      ;;
    --go-tests)
      WITH_GO_TESTS=1
      shift
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Tham số không hợp lệ: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# matches_only TÊN_SCRIPT — có khớp --only không (rỗng = khớp tất cả).
matches_only() {
  [ -z "${ONLY}" ] && return 0
  case "$1" in
    *"${ONLY}"*) return 0 ;;
  esac
  return 1
}

# Danh sách script test (khớp --only nếu có).
select_scripts() {
  local s base
  for s in "${SCRIPT_DIR}"/test_*.sh; do
    [ -f "$s" ] || continue
    base="$(basename "$s")"
    matches_only "${base}" || continue
    printf '%s\n' "$s"
  done
}

if [ "$LIST_ONLY" = 1 ]; then
  echo "Script sẽ chạy:"
  select_scripts | while IFS= read -r s; do echo "  $(basename "$s")"; done
  if matches_only "check_openapi_drift.sh"; then
    echo "  check_openapi_drift.sh (kiểm tra tĩnh, không cần server)"
  fi
  exit 0
fi

if [ -z "$(select_scripts)" ] && ! matches_only "check_openapi_drift.sh"; then
  echo "Không có script nào khớp --only '${ONLY}'." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Chuẩn bị môi trường
# ---------------------------------------------------------------------------
wv_load_env "${API_DIR}"
WV_API_DIR="${API_DIR}"

ADMIN_DB_URL="${DB_URL_OVERRIDE:-${WV_E2E_DATABASE_URL:-${WV_TEST_DATABASE_URL:-${WV_DEFAULT_DB_URL}}}}"
DATABASE_URL="${ADMIN_DB_URL}"
export DATABASE_URL

wv_build_dbtool

if ! ping_err="$(wv_sql -q -c 'SELECT 1' 2>&1)"; then
  echo "Không kết nối được Postgres admin: ${ADMIN_DB_URL}" >&2
  echo "  chi tiết: ${ping_err}" >&2
  echo "  → kiểm tra Postgres có đang chạy không, hoặc truyền --db-url." >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)-$$"
SCRATCH_DB="wv_e2e_${STAMP//-/_}"
GO_TEST_DB="wv_e2e_go_${STAMP//-/_}"
SCRATCH_URL="$(wv_db_url_with_name "${ADMIN_DB_URL}" "${SCRATCH_DB}")"
GO_TEST_URL="$(wv_db_url_with_name "${ADMIN_DB_URL}" "${GO_TEST_DB}")"

RUN_DIR="${API_DIR}/tmp/e2e/run-${STAMP}"
mkdir -p "${RUN_DIR}/logs" "${RUN_DIR}/body" "${RUN_DIR}/tmp" "${RUN_DIR}/uploads"

CRON_SECRET="${CRON_SECRET:-wv-e2e-cron-secret}"
FILE_MASTER_KEY="${FILE_MASTER_KEY:-${WV_E2E_FILE_MASTER_KEY}}"
SESSION_SECRET="${SESSION_SECRET:-wv-e2e-session-secret-0123456789abcdef}"
PRIVATE_UPLOAD_ROOT="${RUN_DIR}/uploads"
export CRON_SECRET FILE_MASTER_KEY SESSION_SECRET PRIVATE_UPLOAD_ROOT

# ---------------------------------------------------------------------------
# Dọn dẹp: luôn chạy, kể cả khi script fail hoặc bị Ctrl-C
# ---------------------------------------------------------------------------
SERVER_PID=""
SERVER_STOPPED=0
CURRENT_SCRIPT_PID=""
DBS_CREATED="" # mỗi dòng một tên DB đã tạo

cleanup_all() {
  local rc=$?
  trap - EXIT INT TERM
  set +e

  if [ -n "${CURRENT_SCRIPT_PID}" ] && kill -0 "${CURRENT_SCRIPT_PID}" 2>/dev/null; then
    kill -TERM "${CURRENT_SCRIPT_PID}" 2>/dev/null
    sleep 0.3
    kill -KILL "${CURRENT_SCRIPT_PID}" 2>/dev/null
    echo "→ Đã dừng script đang chạy (pid ${CURRENT_SCRIPT_PID})"
  fi

  if [ -n "${SERVER_PID}" ] && [ "${SERVER_STOPPED}" = "0" ]; then
    if kill -0 "${SERVER_PID}" 2>/dev/null; then
      kill -TERM "${SERVER_PID}" 2>/dev/null
      local i
      for i in $(seq 1 50); do
        kill -0 "${SERVER_PID}" 2>/dev/null || break
        sleep 0.1
      done
      kill -KILL "${SERVER_PID}" 2>/dev/null
      echo "→ Đã dừng server test (pid ${SERVER_PID})"
    fi
    SERVER_STOPPED=1
  fi

  local db
  while IFS= read -r db; do
    [ -n "${db}" ] || continue
    wv_drop_db "${ADMIN_DB_URL}" "${db}"
    echo "→ Đã xoá database tạm ${db}"
  done <<< "${DBS_CREATED}"

  # Log được giữ lại để soi lỗi; body JSON + file upload tạm thì xoá.
  rm -rf "${RUN_DIR}/tmp" "${RUN_DIR}/uploads"
  wv_prune_run_dirs

  exit "${rc}"
}
trap cleanup_all EXIT INT TERM

wv_create_db() {
  DATABASE_URL="${ADMIN_DB_URL}"
  wv_sql -q -c "CREATE DATABASE \"$1\";"
  DBS_CREATED="${DBS_CREATED}${DBS_CREATED:+
}$1"
}

# wv_prune_run_dirs — chỉ giữ 5 thư mục run gần nhất trong api/tmp/e2e/.
wv_prune_run_dirs() {
  local dirs old
  dirs="$(ls -1dt "${API_DIR}"/tmp/e2e/run-* 2>/dev/null | tail -n +6 || true)"
  [ -n "${dirs}" ] || return 0
  while IFS= read -r old; do
    [ -n "${old}" ] || continue
    case "${old}" in
      "${API_DIR}"/tmp/e2e/run-*) rm -rf "${old}" ;;
    esac
  done <<< "${dirs}"
  return 0
}

# ---------------------------------------------------------------------------
# Kết quả từng script
# ---------------------------------------------------------------------------
RESULTS_FILE="${RUN_DIR}/results.txt"
: > "${RESULTS_FILE}"
record_result() { # rc name seconds
  printf '%s|%s|%s\n' "$1" "$2" "$3" >> "${RESULTS_FILE}"
}

echo "════════════════════════════════════════════════════════════════"
echo " WarrantyVault API — e2e suite"
echo " Postgres admin : ${ADMIN_DB_URL}"
echo " DB tạm         : ${SCRATCH_DB}"
echo " Server         : http://127.0.0.1:${PORT}"
echo " Log            : ${RUN_DIR}/logs"
echo "════════════════════════════════════════════════════════════════"

# ---------------------------------------------------------------------------
# 1. Kiểm tra tĩnh: OpenAPI ↔ route Go (không cần server)
# ---------------------------------------------------------------------------
if matches_only "check_openapi_drift.sh"; then
  echo
  echo "════ check_openapi_drift.sh (kiểm tra tĩnh) ════"
  set +e
  (
    cd "${API_DIR}" && bash "${SCRIPT_DIR}/check_openapi_drift.sh"
  ) 2>&1 | tee "${RUN_DIR}/logs/check_openapi_drift.sh.log"
  drift_rc=${PIPESTATUS[0]}
  set -e
  if [ "${drift_rc}" = "2" ]; then
    echo "→ Bỏ qua: thiếu PyYAML (pip install pyyaml) — không tính là lỗi của suite."
    record_result "skip" "check_openapi_drift.sh" "0"
  else
    record_result "${drift_rc}" "check_openapi_drift.sh" "0"
  fi
fi

# ---------------------------------------------------------------------------
# 2. Go tests (tuỳ chọn, dùng DB tạm riêng)
# ---------------------------------------------------------------------------
if [ "${WITH_GO_TESTS}" = "1" ]; then
  echo
  echo "════ go test ./... (WV_TEST_DATABASE_URL=${GO_TEST_DB}) ════"
  wv_create_db "${GO_TEST_DB}"
  set +e
  (
    cd "${API_DIR}" && WV_TEST_DATABASE_URL="${GO_TEST_URL}" go test ./...
  ) 2>&1 | tee "${RUN_DIR}/logs/go-test.log"
  go_rc=${PIPESTATUS[0]}
  set -e
  record_result "${go_rc}" "go test ./..." "0"
fi

# ---------------------------------------------------------------------------
# 3. DB tạm + migration + server
# ---------------------------------------------------------------------------
echo
echo "→ Tạo database tạm ${SCRATCH_DB}"
wv_create_db "${SCRATCH_DB}"

echo "→ Build server + migrate"
(
  cd "${API_DIR}" &&
    go build -o "${RUN_DIR}/server" ./cmd/server &&
    go build -o "${RUN_DIR}/migrate" ./cmd/migrate
) > "${RUN_DIR}/logs/build.log" 2>&1 || {
  echo "Build thất bại — xem ${RUN_DIR}/logs/build.log" >&2
  tail -30 "${RUN_DIR}/logs/build.log" >&2
  exit 1
}

echo "→ Áp migration lên ${SCRATCH_DB}"
if ! (
  cd "${API_DIR}" && DATABASE_URL="${SCRATCH_URL}" "${RUN_DIR}/migrate" up
) > "${RUN_DIR}/logs/migrate.log" 2>&1; then
  echo "Migration thất bại — xem ${RUN_DIR}/logs/migrate.log" >&2
  tail -30 "${RUN_DIR}/logs/migrate.log" >&2
  exit 1
fi

if curl -sf -m 2 "http://127.0.0.1:${PORT}/healthz" -o /dev/null 2>/dev/null; then
  echo "Cổng ${PORT} đã có service trả lời /healthz — chọn cổng khác bằng --port." >&2
  exit 1
fi

echo "→ Khởi động server ở cổng ${PORT}"
(
  cd "${API_DIR}" &&
    DATABASE_URL="${SCRATCH_URL}" PORT="${PORT}" exec "${RUN_DIR}/server"
) > "${RUN_DIR}/logs/server.log" 2>&1 &
SERVER_PID=$!

ready=0
for _ in $(seq 1 80); do
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    break
  fi
  if curl -sf -m 2 "http://127.0.0.1:${PORT}/readyz" -o /dev/null 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.25
done

if [ "${ready}" != "1" ]; then
  echo "Server không lên được (hoặc thoát sớm) — log cuối:" >&2
  tail -40 "${RUN_DIR}/logs/server.log" >&2
  exit 1
fi
echo "  OK    /readyz trả 200"

# ---------------------------------------------------------------------------
# 4. Chạy từng script
# ---------------------------------------------------------------------------
while IFS= read -r script; do
  name="$(basename "${script}")"
  log="${RUN_DIR}/logs/${name}.log"

  echo
  echo "════ ${name} ════"
  started="$(date +%s)"
  # Chạy script trong subshell `exec` để PID bắt được chính là tiến trình
  # script — nhờ vậy trap ở trên kill được nó nếu người dùng Ctrl-C giữa chừng.
  # Output ghi vào file rồi in ra sau khi xong: log luôn đầy đủ và đúng thứ tự.
  (
    export WV_BASE_URL="http://127.0.0.1:${PORT}"
    export DATABASE_URL="${SCRATCH_URL}"
    export CRON_SECRET FILE_MASTER_KEY PRIVATE_UPLOAD_ROOT
    export WV_BODY_FILE="${RUN_DIR}/body/${name}.json"
    export WV_E2E_TMP="${RUN_DIR}/tmp"
    exec bash "${script}"
  ) > "${log}" 2>&1 &
  CURRENT_SCRIPT_PID=$!
  set +e
  wait "${CURRENT_SCRIPT_PID}"
  rc=$?
  set -e
  CURRENT_SCRIPT_PID=""
  cat "${log}"
  elapsed=$(($(date +%s) - started))
  record_result "${rc}" "${name}" "${elapsed}"
done < <(select_scripts)

# ---------------------------------------------------------------------------
# 5. Tổng kết
# ---------------------------------------------------------------------------
echo
echo "════════════════════════════════════════════════════════════════"
echo " TỔNG KẾT"
echo "════════════════════════════════════════════════════════════════"
passed=0
failed=0
skipped=0
while IFS='|' read -r rc name secs; do
  [ -n "${name}" ] || continue
  case "${rc}" in
    0)
      printf '  ĐẠT       %-28s %ss\n' "${name}" "${secs}"
      passed=$((passed + 1))
      ;;
    skip)
      printf '  BỎ QUA    %-28s (thiếu PyYAML)\n' "${name}"
      skipped=$((skipped + 1))
      ;;
    *)
      printf '  KHÔNG ĐẠT %-28s exit=%s %ss  → %s\n' \
        "${name}" "${rc}" "${secs}" "${RUN_DIR}/logs/${name}.log"
      failed=$((failed + 1))
      ;;
  esac
done < "${RESULTS_FILE}"

echo
echo "Tổng: ${passed} đạt, ${failed} không đạt, ${skipped} bỏ qua"
echo "Log : ${RUN_DIR}/logs"

if [ "${failed}" != "0" ]; then
  exit 1
fi
echo "TOÀN BỘ SUITE E2E ĐẠT"
