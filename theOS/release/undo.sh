#!/bin/bash
# theOS's undo, on the server (aip-59ad, c4): current goes back to the build it pointed at before (<site>/previous: theOS's
# earlier build, or avenOS 26.10.31v6 after the first deploy), and previous becomes the build undone, so a second undo
# goes forward again. A build named goes straight to it (26.10.31v6 is avenOS, theos-<12 hex> a theOS build), however many
# deploys came since. Nothing is deleted.
#   bash undo.sh [<site> [<build>]]        <site> defaults to /opt/maia-city/site/aven
set -euo pipefail
site=${1:-/opt/maia-city/site/aven}; to=${2:-}
if [ -n "$to" ]; then
	[[ $to =~ ^[A-Za-z0-9._-]+$ ]] || { echo "undo.sh: not a build name: $to" >&2; exit 2; }
	back=releases/$to
else
	back=$(readlink "$site/previous" || true)
fi
[ -n "$back" ] && [ -f "$site/$back/index.html" ] || { echo "undo.sh: no build to go back to (previous: ${back:-none})" >&2; exit 1; }
now=$(readlink "$site/current" || true)
ln -sfn "$back" "$site/current.next"; mv -fT "$site/current.next" "$site/current"
[ -z "$now" ] || { ln -sfn "$now" "$site/previous.next"; mv -fT "$site/previous.next" "$site/previous"; }
echo "current is $back again (previous: ${now:-none})"
