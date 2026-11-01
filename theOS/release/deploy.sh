#!/bin/bash
# theOS's deploy, on the server (aip-59ad, c3): one commit's theOS/ tree into its own folder beside every earlier build,
# then one link switched. It writes nothing but <site>/releases/theos-<commit> and the links <site>/current and
# <site>/previous: no Caddyfile, nothing in /opt/aven, no container (d-56). v1's Caddy serves <site>/current as
# aven.maia.city (its block in aven/ops/deploy/Caddyfile; /opt/maia-city/site is its /srv/site). Learned from avenDB's
# caddy.sh, not called. Run by the deploy job over SSH:
#   bash deploy.sh <commit> <archive.tar.gz> [<site>]        <site> defaults to /opt/maia-city/site/aven
set -euo pipefail
commit=${1:?the commit}; archive=${2:?the archive}; site=${3:-/opt/maia-city/site/aven}
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo "deploy.sh: not a commit: $commit" >&2; exit 2; }
[ -d "$site/releases" ] || { echo "deploy.sh: $site/releases is not there" >&2; exit 2; }
name=theos-${commit:0:12}
next="$site/releases/$name.next"

# unpacked beside the others first; current stays where it is until the tree is whole
rm -rf "$next"; mkdir -p "$next"
tar -xzf "$archive" -C "$next"
[ -f "$next/index.html" ] || { rm -rf "$next"; echo "deploy.sh: the archive has no index.html" >&2; exit 1; }
rm -rf "${site:?}/releases/$name"; mv "$next" "$site/releases/$name"

now=$(readlink "$site/current" || true)
if [ "$now" = "releases/$name" ]; then echo "theOS ${commit:0:12} is current already"; exit 0; fi
# previous is what the undo goes back to: the build that was current until now
if [ -n "$now" ]; then ln -sfn "$now" "$site/previous.next"; mv -fT "$site/previous.next" "$site/previous"; fi
ln -sfn "releases/$name" "$site/current.next"; mv -fT "$site/current.next" "$site/current"
echo "theOS ${commit:0:12} is current (previous: ${now:-none})"
