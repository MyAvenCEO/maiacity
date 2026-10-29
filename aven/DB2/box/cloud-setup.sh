#!/bin/bash
# The avenSANDBOX cloud environment's setup script (aven/DB2/SANDBOX.md, "Where it runs"): paste it into the
# environment's Setup script, or load this file there. It runs once; Anthropic then snapshots the disk, and new
# sessions start from it for about 7 days with the box's image and the page's dependencies already there. The snapshot
# keeps files, not processes: `bun run up` starts dockerd again in each session. It starts one directory above the
# repository, and anything that fails leaves the session to do it itself.
export PATH="$HOME/.bun/bin:$PATH"
dockerd --allow-direct-routing > /var/log/dockerd.log 2>&1 &
for i in $(seq 1 60); do docker info > /dev/null 2>&1 && break; sleep 1; done
cd maiacity/aven/DB2 && bun run up && bun run down
exit 0
