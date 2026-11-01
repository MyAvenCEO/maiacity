#!/bin/bash
# avenSANDBOX: warms the box for new sessions. The real script is the repository's
# aven/DB2/sandbox/box/cloud-setup.sh; this only finds it, wherever the repository is cloned,
# and never fails a session.
# (The environment's script before AIP-2, kept so pasting it back undoes the switch.)
for f in aven/DB2/sandbox/box/cloud-setup.sh */aven/DB2/sandbox/box/cloud-setup.sh /home/user/*/aven/DB2/sandbox/box/cloud-setup.sh; do
  if [ -f "$f" ]; then bash "$f"; exit 0; fi
done
