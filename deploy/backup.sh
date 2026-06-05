#!/usr/bin/env bash
#
# backup.sh — dump the WarrantyVault Postgres database + the encrypted upload
# blobs into a timestamped pair of gzip archives, and prune old ones.
#
# Assumes the docker-compose stack at the repo root is up (services `postgres`
# and `api`). Run it from anywhere — it resolves the compose file relative to
# this script. Wire it into cron / a systemd timer for nightly backups, e.g.:
#
#     0 3 * * *  /opt/warranty-vault/deploy/backup.sh >> /var/log/wv-backup.log 2>&1
#
# IMPORTANT: the upload blobs are AES-256-GCM encrypted with FILE_MASTER_KEY.
# A blob backup is USELESS without that key, so make sure your `.env` (which
# holds FILE_MASTER_KEY) is backed up separately and securely. This script
# does NOT copy secrets.
set -euo pipefail

# ── Resolve paths ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose.yml}"

# ── Config (override via env) ────────────────────────────────────────────────
OUT_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
PG_USER="${POSTGRES_USER:-warranty}"
PG_DB="${POSTGRES_DB:-warranty_vault}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
UPLOAD_DIR="${PRIVATE_UPLOAD_SUBDIR:-private-uploads}" # under /data in the api container

# `docker compose` (v2) preferred; fall back to legacy `docker-compose`.
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose -f "$COMPOSE_FILE")
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose -f "$COMPOSE_FILE")
else
  echo "ERROR: neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 1
fi

TS="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"

DB_OUT="$OUT_DIR/db-$TS.sql.gz"
UPLOADS_OUT="$OUT_DIR/uploads-$TS.tar.gz"

# ── 1. Database dump ─────────────────────────────────────────────────────────
echo "[$(date -u +%H:%M:%S)] dumping database '$PG_DB' → $DB_OUT"
"${DC[@]}" exec -T postgres \
  pg_dump -U "$PG_USER" -d "$PG_DB" --no-owner --clean --if-exists \
  | gzip -9 > "$DB_OUT"

# ── 2. Encrypted upload blobs ────────────────────────────────────────────────
echo "[$(date -u +%H:%M:%S)] archiving uploads (/data/$UPLOAD_DIR) → $UPLOADS_OUT"
if "${DC[@]}" exec -T api sh -c "[ -d /data/$UPLOAD_DIR ]"; then
  "${DC[@]}" exec -T api tar -C /data -cf - "$UPLOAD_DIR" | gzip -9 > "$UPLOADS_OUT"
else
  echo "  (no uploads directory yet — skipping blob archive)"
  rm -f "$UPLOADS_OUT"
fi

# ── 3. Prune old backups ─────────────────────────────────────────────────────
echo "[$(date -u +%H:%M:%S)] pruning backups older than ${RETENTION_DAYS}d"
find "$OUT_DIR" -maxdepth 1 -type f \
  \( -name 'db-*.sql.gz' -o -name 'uploads-*.tar.gz' \) \
  -mtime +"$RETENTION_DAYS" -print -delete || true

echo "[$(date -u +%H:%M:%S)] done. Latest:"
ls -lh "$OUT_DIR" | tail -n +1 | grep -E "$TS" || true

echo
echo "Reminder: back up your .env (FILE_MASTER_KEY) separately — the blob"
echo "archive cannot be decrypted without it."
