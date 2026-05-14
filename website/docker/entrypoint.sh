#!/bin/sh
set -e

# Post Phase F: the website is a pure frontend. Database schema, encrypted
# attachment storage, and migrations are owned by the Go service (api/).
# This entrypoint just starts Next.js.

echo "[entrypoint] starting Next.js (GO_API_URL=${GO_API_URL:-unset})"
exec "$@"
