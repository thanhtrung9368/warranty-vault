#!/bin/sh
set -e

# Ensure the persistent data dir exists. /data is a Docker volume.
mkdir -p /data /data/private-uploads

# Sync the Prisma schema into the SQLite file. Idempotent — if the schema
# already matches, this is a no-op.
echo "[entrypoint] prisma db push → $DATABASE_URL"
node node_modules/prisma/build/index.js db push

echo "[entrypoint] starting Next.js"
exec "$@"
