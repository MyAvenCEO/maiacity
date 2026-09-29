#!/usr/bin/env bash
# The database, dumped to Hetzner Object Storage (bucket `maiacity`, under BACKUPS/pg/).
# Runs before every deploy (from the pipeline) and daily from cron (/etc/cron.d/maia-city-backup);
# by hand: bash /opt/maia-city/deploy/backup.sh [label]
# Access comes from the environment or from ../backup.env (the deploy step writes it, readable by deploy only):
#   BACKUP_BUCKET, BACKUP_ENDPOINT, BACKUP_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# The dump is not encrypted (decided 2026-09-29): the bucket is private and its keys are the protection.
# Restore: docker exec -i maia-city-db pg_restore -U maiacity -d maiacity --clean --if-exists < file.dump
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f backup.env ] && { set -a; . ./backup.env; set +a; }
: "${BACKUP_BUCKET:?}" "${BACKUP_ENDPOINT:?}" "${BACKUP_REGION:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
# only the database's name and user from .env — the app's secrets in it stay out of this
POSTGRES_DB=$(grep -m1 '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2- || true)
POSTGRES_USER=$(grep -m1 '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2- || true)
LABEL="${1:-by-hand}"
FILE="BACKUPS/pg/${POSTGRES_DB:-maiacity}-$(date -u +%Y%m%dT%H%M%SZ)-${LABEL}.dump"
if ! docker ps --format '{{.Names}}' | grep -qx maia-city-db; then
  echo "No database container running — nothing to back up (first deploy?)."; exit 0
fi
# Hetzner's S3 does not take the checksums newer AWS CLIs send by default — only when an operation requires one
aws() {
  docker run --rm -i -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION="$BACKUP_REGION" \
    -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    amazon/aws-cli --endpoint-url "$BACKUP_ENDPOINT" "$@"
}
# pg_dump in the database container (custom format, compressed) → straight into the bucket
docker exec maia-city-db pg_dump -U "${POSTGRES_USER:-maiacity}" -d "${POSTGRES_DB:-maiacity}" -Fc \
  | aws s3 cp - "s3://$BACKUP_BUCKET/$FILE" --expected-size 2000000000 >/dev/null
SIZE=$(aws s3 ls "s3://$BACKUP_BUCKET/$FILE" | awk '{print $3}')
[ -n "$SIZE" ] && [ "$SIZE" -gt 0 ] || { echo "Upload not found: $FILE"; exit 1; }
echo "Backup: s3://$BACKUP_BUCKET/$FILE ($SIZE bytes)"
