#!/bin/sh
set -e

# Ensure the persistent data dir for encrypted attachments exists. /data is
# a Docker volume mounted from compose. The DB itself lives in a separate
# postgres container/volume.
mkdir -p /data /data/private-uploads

# Sync the Prisma schema into the postgres DB. Idempotent — if the schema
# already matches, this is a no-op. Compose makes `app` wait until `db` is
# healthy via depends_on, so the connection should succeed on first try.
echo "[entrypoint] prisma db push → $DATABASE_URL"
node node_modules/prisma/build/index.js db push

echo "[entrypoint] starting Next.js"
exec "$@"
