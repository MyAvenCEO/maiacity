#!/bin/bash
# avenSANDBOX's test (theOS/aip/AIP-2.json, c4). The environment's script, in a scratch copy of the repository's layout,
# exits 0 with a planted failure, a planted hang (cut at its limit) and no setup file; then, where Docker can run,
# run.sh runs a command inside the box with theOS/ mounted at /work.
#   theOS/sandbox/test.sh            all of it
#   theOS/sandbox/test.sh --no-box   the environment's script only (no Docker needed)
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }

scratch=$(mktemp -d); trap 'rm -rf "$scratch"' EXIT
plant() { rm -rf "$scratch/repo"; mkdir -p "$scratch/repo/theOS/sandbox"; [ -z "$1" ] || printf '%s\n' "$1" > "$scratch/repo/theOS/sandbox/cloud-setup.sh"; }
envrun() { (cd "$scratch" && AVENSANDBOX_LIMIT=3 bash "$here/environment-setup.sh" > /dev/null 2>&1); }

plant 'exit 1';   envrun && ok "a failing warm-up never fails a session" || bad "a failing warm-up failed the session"
plant 'sleep 30'; t0=$(date +%s); envrun; code=$?; t=$(( $(date +%s) - t0 ))
[ $code = 0 ] && [ $t -lt 10 ] && ok "a hanging warm-up is cut at its limit (${t} s)" || bad "a hanging warm-up: exit $code after ${t} s"
plant '';         envrun && ok "no setup file: exits 0" || bad "no setup file failed the session"
plant 'touch "$(dirname "$0")/ran"'; envrun; [ -f "$scratch/repo/theOS/sandbox/ran" ] && ok "it finds theOS/sandbox/cloud-setup.sh one folder down" || bad "it did not find cloud-setup.sh"

if [ "${1:-}" != --no-box ]; then
	out=$("$here/run.sh" bash -c 'test -f /work/sandbox/run.sh && pwd && rustc --version' 2>&1)
	[ $? = 0 ] && grep -qx /work <<< "$out" && ok "run.sh runs a command in the box with theOS/ at /work" || bad "run.sh: $out"
fi
[ $fails = 0 ] && echo "avenSANDBOX's test: green" || { echo "avenSANDBOX's test: $fails failed"; exit 1; }
