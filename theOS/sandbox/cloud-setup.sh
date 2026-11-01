#!/bin/bash
# avenSANDBOX's warm-up (theOS/aip/AIP-2.json, c4). The environment's setup script finds this file and runs it once,
# before the disk is snapshotted, so new sessions find the box already pulled. It only starts Docker and pulls the
# image; it never fails a session.
"$(dirname "$0")/run.sh" true || echo "avenSANDBOX: the warm-up did not finish; run.sh pulls the box when it is first used"
exit 0
