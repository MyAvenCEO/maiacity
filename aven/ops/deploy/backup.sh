#!/usr/bin/env bash
# The database, dumped to Hetzner Object Storage (bucket `maiacity`, under BACKUPS/pg/).
# Runs before every deploy (from the pipeline) and daily from cron (/etc/cron.d/maia-city-backup);
# by hand: bash /opt/maia-city/deploy/backup.sh [label]
# Access comes from the environment or from ../backup.env (the deploy step writes it, readable by deploy only):
#   BACKUP_BUCKET, BACKUP_ENDPOINT, BACKUP_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# The dump is not encrypted (decided 2026-09-29): the bucket is private and its keys are the protection.
# Restore: docker exec -i maia-city-db pg_restore -U maiacity -d maiacity --clean --if-exists < file.dump
#
# The dump goes to a file first and is then uploaded as a file: no stream through stdin, no command that could wait
# for input, and every step says where it is — a hang shows up in the log at the step that hung.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f backup.env ] && { set -a; . ./backup.env; set +a; }
: "${BACKUP_BUCKET:?}" "${BACKUP_ENDPOINT:?}" "${BACKUP_REGION:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
# only the database's name and user from .env — the app's secrets in it stay out of this
POSTGRES_DB=$(grep -m1 '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2- || true)
POSTGRES_USER=$(grep -m1 '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2- || true)
LABEL="${1:-by-hand}"
# --no-media: everything but the media library's bytes (media_chunks, many GB of already-compressed video). The dump
# before a deploy uses it — fast, and all a bad migration could hurt; the daily dump keeps everything.
MEDIA="${2:-}"
EXCLUDE=()
[ "$MEDIA" = "--no-media" ] && { EXCLUDE=(--exclude-table-data=media_chunks); LABEL="$LABEL-no-media"; }
NAME="${POSTGRES_DB:-maiacity}-$(date -u +%Y%m%dT%H%M%SZ)-${LABEL}.dump"
KEY="BACKUPS/pg/$NAME"
if ! docker ps --format '{{.Names}}' | grep -qx maia-city-db; then
  echo "No database container running — nothing to back up (first deploy?)."; exit 0
fi
WORK="$(pwd)/backups-tmp"
mkdir -p "$WORK"
trap 'rm -f "$WORK/$NAME"' EXIT

echo "backup: dumping ${POSTGRES_DB:-maiacity} ${EXCLUDE[*]:-(everything)} …"
# -Z 0: the bulk is video that does not compress; a lock held longer than two minutes fails the dump instead of
# letting it wait forever
timeout 3000 docker exec maia-city-db pg_dump -U "${POSTGRES_USER:-maiacity}" -d "${POSTGRES_DB:-maiacity}" -Fc -Z 0 -w \
  --lock-wait-timeout=120s "${EXCLUDE[@]}" </dev/null >"$WORK/$NAME"
SIZE=$(stat -c %s "$WORK/$NAME")
echo "backup: dump is $SIZE bytes; uploading to s3://$BACKUP_BUCKET/$KEY …"

# Hetzner's S3 does not take the checksums newer AWS CLIs send by default — only when an operation requires one
timeout 3000 docker run --rm -v "$WORK:/work:ro" \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION="$BACKUP_REGION" \
  -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
  amazon/aws-cli --endpoint-url "$BACKUP_ENDPOINT" --cli-connect-timeout 20 --cli-read-timeout 120 \
  s3 cp "/work/$NAME" "s3://$BACKUP_BUCKET/$KEY" --only-show-errors </dev/null
echo "backup: s3://$BACKUP_BUCKET/$KEY ($SIZE bytes)"
