#!/usr/bin/env bash
# dbtool.sh — chạy client SQL scripts/dbtool (Go + pgx) mà không cần build tay
# và KHÔNG cần `psql`. Lần đầu sẽ build vào api/tmp/e2e/dbtool (đã gitignore),
# các lần sau chạy thẳng binary.
#
# Cách dùng (giống `psql -tA` ở phần in kết quả):
#   api/scripts/dbtool.sh -c 'SELECT count(*) FROM "User";'
#   api/scripts/dbtool.sh -q -c "DELETE FROM \"User\" WHERE email = 'x@y.z';"
#   api/scripts/dbtool.sh -v "user_id='<user-id>'" -f api/scripts/seed_dev.sql
#
# DATABASE_URL lấy từ môi trường, hoặc từ api/.env nếu chưa được set.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_load_env "${API_DIR}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL chưa được đặt — export biến này hoặc điền vào api/.env." >&2
  exit 1
fi
export DATABASE_URL

WV_API_DIR="${API_DIR}"
wv_build_dbtool

exec "${WV_DBTOOL}" "$@"
