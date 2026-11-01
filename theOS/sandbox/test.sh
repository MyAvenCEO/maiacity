#!/bin/bash
# avenSANDBOX's test (theOS/aip/AIP-2.json, c4).
#  1. The environment's script, in a scratch copy of the repository's layout (its search kept inside the scratch folder),
#     exits 0 with a planted failure, a planted hang (started, then cut at its limit) and no setup file, and finds
#     cloud-setup.sh one folder down. Only where GNU timeout exists: the script runs in cloud sessions, never on a Mac.
#  2. run.sh runs a command inside the box with theOS/ mounted at /work.
#  3. run.sh refuses a tag that is not published, and says so.
#  4. With --cold (as root, where dockerd is installed; it stops every running container): dockerd is stopped, as
#     after a snapshot, and the real cloud-setup.sh must start it, have the box, and stop it again; then run.sh must
#     start it once more.
#   theOS/sandbox/test.sh [--no-box | --cold]
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
mode=${1:-}
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }

if command -v timeout > /dev/null; then
	scratch=$(mktemp -d); trap 'rm -rf "$scratch"' EXIT
	plant() { rm -rf "$scratch/repo"; mkdir -p "$scratch/repo/theOS/sandbox"; [ -z "$1" ] || printf '%s\n' "$1" > "$scratch/repo/theOS/sandbox/cloud-setup.sh"; }
	envrun() { (cd "$scratch" && AVENSANDBOX_LIMIT=3 AVENSANDBOX_HOME="$scratch/none" bash "$here/environment-setup.sh" > /dev/null 2>&1); }
	mark="$scratch/repo/theOS/sandbox/ran"

	plant 'exit 1'; envrun && ok "a failing warm-up never fails a session" || bad "a failing warm-up failed the session"
	plant 'touch "$(dirname "$0")/ran"; sleep 30'; t0=$(date +%s); envrun; code=$?; t=$(( $(date +%s) - t0 ))
	[ $code = 0 ] && [ -f "$mark" ] && [ $t -ge 3 ] && [ $t -lt 10 ] && ok "a hanging warm-up is started, then cut at its limit (${t} s)" \
		|| bad "a hanging warm-up: exit $code after ${t} s, started: $([ -f "$mark" ] && echo yes || echo no)"
	plant ''; envrun && ok "no setup file: exits 0" || bad "no setup file failed the session"
	plant 'touch "$(dirname "$0")/ran"'; envrun; [ -f "$mark" ] && ok "it finds theOS/sandbox/cloud-setup.sh one folder down" || bad "it did not find cloud-setup.sh"
else
	echo "skip the environment's script: no GNU timeout here (it runs only in cloud sessions)"
fi

if [ "$mode" = --cold ]; then
	if [ "$(id -u)" = 0 ] && command -v dockerd > /dev/null; then
		pkill -x dockerd; for _ in $(seq 1 30); do pgrep -x dockerd > /dev/null || break; sleep 1; done
		docker info > /dev/null 2>&1 && bad "dockerd did not stop" || ok "dockerd stopped, as after a snapshot"
		bash "$here/cloud-setup.sh" > /dev/null 2>&1; code=$?
		[ $code = 0 ] && ok "the real warm-up exits 0" || bad "the real warm-up exited $code"
		pgrep -x dockerd > /dev/null && bad "the warm-up left dockerd running" || ok "the warm-up stopped the dockerd it started"
	else
		bad "--cold needs root and dockerd"
	fi
fi
if [ "$mode" != --no-box ]; then
	out=$(AVENSANDBOX_IMAGE=ghcr.io/myavenceo/aven/sandbox:theos-0000000000000000 "$here/run.sh" true 2>&1); code=$?
	[ $code = 1 ] && grep -q "is not published" <<< "$out" && ok "run.sh refuses a tag that is not published" || bad "unpublished tag: exit $code: $out"
	[ "$mode" = --cold ] && { docker image inspect "$("$here/tag.sh")" > /dev/null 2>&1 && ok "the box is here after the warm-up" || bad "the box is not here after the warm-up"; }
	out=$("$here/run.sh" bash -c 'test -f /work/sandbox/run.sh && pwd && rustc --version' 2>&1)
	[ $? = 0 ] && grep -qx /work <<< "$out" && ok "run.sh runs a command in the box with theOS/ at /work" || bad "run.sh: $out"
	[ "$mode" = --cold ] && { docker info > /dev/null 2>&1 && ok "run.sh started dockerd" || bad "run.sh did not start dockerd"; }
fi
[ $fails = 0 ] && echo "avenSANDBOX's test: green" || { echo "avenSANDBOX's test: $fails failed"; exit 1; }
