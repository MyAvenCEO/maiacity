#!/bin/bash
# avenSANDBOX: the cloud environment's setup script, as pasted into its settings (theOS/aip/AIP-2.json, Gate B). It only
# finds theOS/sandbox/cloud-setup.sh, wherever the repository is cloned, runs it under a time limit (600 s, then
# killed at 630 s), and never fails a session. AVENSANDBOX_LIMIT (seconds, default 600) and AVENSANDBOX_HOME (default /home/user)
# exist for its own test.
for f in theOS/sandbox/cloud-setup.sh */theOS/sandbox/cloud-setup.sh "${AVENSANDBOX_HOME:-/home/user}"/*/theOS/sandbox/cloud-setup.sh; do
	if [ -f "$f" ]; then timeout -k 30 "${AVENSANDBOX_LIMIT:-600}" bash "$f"; exit 0; fi
done
exit 0
