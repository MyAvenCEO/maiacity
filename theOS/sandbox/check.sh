#!/bin/bash
# theOS's check (aip-31df) run the way aip-6fb1's c3 compares it: inside avenSANDBOX through run.sh (default) or on this
# host (--host), with its own test (the fixtures, each page red or green as its <meta name="expect"> says), then the
# commit it ran on written next to the reports, so theOS/sandbox/same.mjs can refuse to compare two different commits.
#   theOS/sandbox/check.sh [--host] [--out <dir under theOS/>]     default out: avenCEO/checks/out
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
theos=$(cd "$here/.." && pwd)
where=box; out=avenCEO/checks/out
while [ $# -gt 0 ]; do
	case $1 in --host) where=host ;; --out) out=$2; shift ;; *) echo "check.sh: unknown argument $1" >&2; exit 2 ;; esac
	shift
done
run() { if [ $where = box ]; then "$here/run.sh" node avenCEO/checks/check.mjs --out "/work/$out" "$@"; else (cd "$theos" && node avenCEO/checks/check.mjs --out "$theos/$out" "$@"); fi; }
rm -rf "${theos:?}/$out"
run; code=$?
run --fixtures | tail -n 1; fixtures=${PIPESTATUS[0]}
commit=$(git -C "$theos" rev-parse HEAD)
[ -z "$(git -C "$theos" status --porcelain -- .)" ] || commit="$commit-dirty"
echo "$commit $where" > "$theos/$out/commit.txt"
echo "theOS's check ($where, $commit): exit $code; its own test: exit $fixtures"
[ $code = 0 ] && [ $fixtures = 0 ]
