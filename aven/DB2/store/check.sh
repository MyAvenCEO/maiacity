#!/bin/sh
# The store's one check: the conformance suite on all four backends, in the box. From aven/DB2, after `bun run up`
# (which starts the box's S3 server):  bun run box sh store/check.sh
# memory, fs and s3 run under cargo test; opfs runs as wasm in Chromium (opfs/run.sh).
set -e
if [ -z "$AVEN_DB_S3_ENDPOINT" ]; then
  # A cloud session runs the box on the host's network; elsewhere (OrbStack) the host is host.docker.internal
  for at in http://127.0.0.1:7070 http://host.docker.internal:7070; do
    if curl -s -o /dev/null -m 2 "$at"; then export AVEN_DB_S3_ENDPOINT="$at"; break; fi
  done
  [ -n "$AVEN_DB_S3_ENDPOINT" ] || { echo "aven-db-store: the box's S3 server doesn't answer: run bun run up"; exit 1; }
fi
cargo test -q -p aven-db-store
sh store/opfs/run.sh
