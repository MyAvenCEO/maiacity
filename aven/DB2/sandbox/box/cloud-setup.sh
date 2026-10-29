#!/bin/bash
# The avenSANDBOX cloud environment's setup (aven/DB2/SANDBOX.md, "Where it runs"). The environment's own setup script
# only finds this file and runs it (SANDBOX.md, "Samuel's part", gives that script), so it works wherever the repository
# is cloned. It runs once; Anthropic then snapshots the disk, and new sessions start from it for about 7 days with the
# box's image and the page's dependencies already there. The snapshot keeps files, not processes: `bun run up` starts
# dockerd again in each session. It never fails a session: one whose setup didn't finish does the same work in
# `bun run up`.
export PATH="$HOME/.bun/bin:$PATH"
dockerd --allow-direct-routing > /var/log/dockerd.log 2>&1 &
for i in $(seq 1 60); do docker info > /dev/null 2>&1 && break; sleep 1; done
cd "$(dirname "$0")/../.." && bun run up && bun run down
exit 0
