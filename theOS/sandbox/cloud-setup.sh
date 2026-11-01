#!/bin/bash
# avenSANDBOX's warm-up (theOS/aip/AIP-2.json, c4). The environment's setup script finds this file and runs it once,
# before the disk is snapshotted, so new sessions find the box already pulled. It only starts Docker and pulls the
# image; it never fails a session. If it started dockerd, it stops it again and waits, so the snapshot holds a clean
# /var/lib/docker.
up=0; docker info > /dev/null 2>&1 && up=1
"$(dirname "$0")/run.sh" true || echo "avenSANDBOX: the warm-up did not finish; run.sh pulls the box when it is first used"
if [ $up = 0 ] && pkill -x dockerd; then
	for _ in $(seq 1 30); do pgrep -x dockerd > /dev/null || break; sleep 1; done
	sync
fi
exit 0
