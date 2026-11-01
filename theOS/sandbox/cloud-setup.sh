#!/bin/bash
# avenSANDBOX's warm-up (theOS/aip/AIP-2.json, c4). The environment's setup script finds this file and runs it once,
# before the disk is snapshotted, so new sessions find the box already pulled. It only starts Docker and pulls the
# image; it never fails a session. If run.sh started dockerd here, it stops that one again and waits, so the snapshot
# holds a clean /var/lib/docker.
pid=/var/run/avensandbox-dockerd.pid; rm -f "$pid"
"$(dirname "$0")/run.sh" true || echo "avenSANDBOX: the warm-up did not finish; run.sh pulls the box when it is first used"
if [ -f "$pid" ] && kill "$(cat "$pid")" 2> /dev/null; then
	for _ in $(seq 1 30); do kill -0 "$(cat "$pid")" 2> /dev/null || break; sleep 1; done
	rm -f "$pid"
	sync
fi
exit 0
