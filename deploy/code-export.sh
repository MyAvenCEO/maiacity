#!/usr/bin/env bash
# What the landing job (.github/workflows/code-land.yml) reads from the database to write into the repo's code/: the
# Sandbox 7 MIPs the admin accepted that wait to land, and the Generated UI drafts the admin kept. It reads, and
# changes nothing. Run on the server, in /opt/maia-city (the job pipes it over SSH):
#   bash code-export.sh count   "<MIPs waiting> <views kept>"
#   bash code-export.sh land    JSON { mips, views }
#   bash code-export.sh full    JSON { versions, configs, mips, views }: also every config version the database kept
#                               (the first export, done 2026-10-16); views stay the kept drafts only, as in land
set -euo pipefail
MODE="${1:-count}"
# only the database's name and user from .env, as backup.sh does: the app's secrets in it stay out of this
POSTGRES_DB=$(grep -m1 '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2- || true)
POSTGRES_USER=$(grep -m1 '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2- || true)
q() {
  timeout 120 docker exec maia-city-db psql -U "${POSTGRES_USER:-maiacity}" -d "${POSTGRES_DB:-maiacity}" \
    -X -A -t -q -v ON_ERROR_STOP=1 -c "$1" </dev/null
}

# a MIP waits to land from its accept (api/src/economy.js) until the API finds it in code/ after the deploy
WAITING="FROM mips m WHERE m.status = 'accepted' AND m.result->>'landing' = 'waiting'"
# `keep` is read through to_jsonb: the column comes with the API change that adds drafts
KEPT="FROM genui_views g WHERE coalesce((to_jsonb(g)->>'keep')::boolean, false)"
MIPS="(SELECT coalesce(json_agg(json_build_object('number', m.number, 'title', m.title, 'action', m.action, 'config', m.config_id,
  'name', m.name, 'about', m.about, 'from', m.from_id, 'cards', m.cards, 'remove', m.remove, 'world_id', m.world_id,
  'world', m.world, 'decided', m.decided) ORDER BY m.number), '[]'::json) $WAITING)"
views() { echo "(SELECT coalesce(json_agg(json_build_object('id', g.id, 'title', g.title, 'note', g.note, 'kind', g.kind, 'spec', g.spec) ORDER BY g.id), '[]'::json) $1)"; }

case "$MODE" in
  count)
    q "SELECT (SELECT count(*) $WAITING) || ' ' || (SELECT count(*) $KEPT)"
    ;;
  land)
    q "SELECT json_build_object('mips', $MIPS, 'views', $(views "$KEPT"))"
    ;;
  full)
    q "SELECT json_build_object(
      'versions', (SELECT coalesce(json_agg(json_build_object('config', v.config_id, 'version', v.version, 'body', v.body, 'mip', v.mip, 'at', v.at) ORDER BY v.config_id, v.version), '[]'::json) FROM econ_config_versions v),
      'configs', (SELECT coalesce(json_agg(json_build_object('id', c.id, 'deleted', c.deleted) ORDER BY c.id), '[]'::json) FROM econ_configs c),
      'mips', $MIPS,
      'views', $(views "$KEPT"))"
    ;;
  *)
    echo "usage: bash code-export.sh count|land|full" >&2
    exit 2
    ;;
esac
