#!/bin/bash
# avenSANDBOX: the cloud environment's setup script, as pasted into its settings (theOS/aip/AIP-2.json, Gate B). It only
# finds theOS/sandbox/cloud-setup.sh, wherever the repository is cloned, runs it under a time limit, and never fails a
# session. AVENSANDBOX_LIMIT (seconds, default 600) exists for its own test.
for f in theOS/sandbox/cloud-setup.sh */theOS/sandbox/cloud-setup.sh /home/user/*/theOS/sandbox/cloud-setup.sh; do
	if [ -f "$f" ]; then timeout "${AVENSANDBOX_LIMIT:-600}" bash "$f"; exit 0; fi
done
exit 0
