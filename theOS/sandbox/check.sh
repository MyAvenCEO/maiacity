#!/bin/bash
# theOS's check (aip-31df) run the way aip-6fb1's c3 compares it: inside avenSANDBOX through run.sh (default) or on this
# host (--host), with its own test (the fixtures, each page red or green as its <meta name="expect"> says), then the
# commit it ran on, where, and its Playwright written to commit.txt beside the reports, so theOS/sandbox/same.mjs can
# refuse to compare two different commits.
#   theOS/sandbox/check.sh [--host] [--out <folder under avenCEO/checks/out>]     default: avenCEO/checks/out
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
theos=$(cd "$here/.." && pwd)
where=box; out=avenCEO/checks/out
while [ $# -gt 0 ]; do
	case $1 in --host) where=host ;; --out) out=${2:-}; shift ;; *) echo "check.sh: unknown argument $1" >&2; exit 2 ;; esac
	shift
done
# out is removed first: only a folder under avenCEO/checks/out (gitignored), never theOS/ or above
[[ $out =~ ^avenCEO/checks/out(/[A-Za-z0-9_][A-Za-z0-9._-]*)*$ && $out != *..* ]] || { echo "check.sh: --out must be avenCEO/checks/out or a folder under it" >&2; exit 2; }
log=$(mktemp); trap 'rm -f "$log"' EXIT
run() { if [ $where = box ]; then "$here/run.sh" node avenCEO/checks/check.mjs --out "/work/$out" "$@"; else (cd "$theos" && node avenCEO/checks/check.mjs --out "$theos/$out" "$@"); fi; }
rm -rf "${theos:?}/$out" || { echo "check.sh: could not remove $out (made by the box as root? remove it as root)" >&2; exit 2; }
# made here, by this host's user: the box runs as root, and a folder it made is not writable by a runner's user
mkdir -p "$theos/$out" || exit 2
run | tee "$log"; code=${PIPESTATUS[0]}
run --fixtures | tail -n 1; fixtures=${PIPESTATUS[0]}
# hand the box's files back to this host's user, so the next run (in the box or not) can remove them
[ $where = box ] && [ "$(id -u)" != 0 ] && "$here/run.sh" chown -R "$(id -u):$(id -g)" "/work/$out"
commit=$(git -C "$theos" rev-parse HEAD)
[ -z "$(git -C "$theos" status --porcelain -- .)" ] || commit="$commit-dirty"
playwright=$(sed -n 's/.* with Playwright \([0-9.]*\);.*/\1/p' "$log" | tail -n 1)
echo "$commit $where ${playwright:-unknown}" > "$theos/$out/commit.txt" || { echo "check.sh: could not write $out/commit.txt" >&2; exit 2; }
echo "theOS's check ($where, $commit, Playwright ${playwright:-unknown}): exit $code; its own test: exit $fixtures"
[ $code = 0 ] && [ $fixtures = 0 ]
