#!/bin/bash
# theOS's undo, on the server (aip-59ad, c4): current goes back to the build it pointed at before (<site>/previous: theOS's
# earlier build, or avenOS 26.10.31v6 after the first deploy), and previous becomes the build undone, so a second undo
# goes forward again. Nothing is deleted.
#   bash undo.sh [<site>]        <site> defaults to /opt/maia-city/site/aven
set -euo pipefail
site=${1:-/opt/maia-city/site/aven}
back=$(readlink "$site/previous" || true)
[ -n "$back" ] && [ -f "$site/$back/index.html" ] || { echo "undo.sh: no build to go back to (previous: ${back:-none})" >&2; exit 1; }
now=$(readlink "$site/current" || true)
ln -sfn "$back" "$site/current.next"; mv -fT "$site/current.next" "$site/current"
[ -z "$now" ] || { ln -sfn "$now" "$site/previous.next"; mv -fT "$site/previous.next" "$site/previous"; }
echo "current is $back again (previous: ${now:-none})"
