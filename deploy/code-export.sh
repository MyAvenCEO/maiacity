#!/usr/bin/env bash
# What the landing job (.github/workflows/code-land.yml) reads from the database to write into the repo's code/: the
# Generated UI drafts the admin kept. It reads, and changes nothing. Run on the server, in /opt/maia-city (the job pipes
# it over SSH):
#   bash code-export.sh count   "<views kept>"
#   bash code-export.sh land    JSON { views }
set -euo pipefail
MODE="${1:-count}"
# only the database's name and user from .env, as backup.sh does: the app's secrets in it stay out of this
POSTGRES_DB=$(grep -m1 '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2- || true)
POSTGRES_USER=$(grep -m1 '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2- || true)
q() {
  timeout 120 docker exec maia-city-db psql -U "${POSTGRES_USER:-maiacity}" -d "${POSTGRES_DB:-maiacity}" \
    -X -A -t -q -v ON_ERROR_STOP=1 -c "$1" </dev/null
}

KEPT="FROM genui_views g WHERE coalesce(g.keep, false)"
VIEWS="(SELECT coalesce(json_agg(json_build_object('id', g.id, 'title', g.title, 'note', g.note, 'kind', g.kind, 'spec', g.spec) ORDER BY g.id), '[]'::json) $KEPT)"

case "$MODE" in
  count)
    q "SELECT count(*) $KEPT"
    ;;
  land)
    q "SELECT json_build_object('views', $VIEWS)"
    ;;
  *)
    echo "usage: bash code-export.sh count|land" >&2
    exit 2
    ;;
esac
