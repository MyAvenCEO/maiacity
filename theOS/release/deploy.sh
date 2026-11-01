#!/bin/bash
# theOS's deploy, on the server (aip-59ad, c3): one commit's theOS/ tree into its own folder beside every earlier build,
# then one link switched. The folder is named by the tree's git hash (git rev-parse <commit>:theOS), so a push that
# changes nothing under theOS/ finds its build there and current already on it, and changes nothing. It writes nothing
# but <site>/releases/theos-<first 12 hex of the tree> and the links <site>/current and
# <site>/previous: no Caddyfile, nothing in /opt/aven, no container (d-56). v1's Caddy serves <site>/current as
# aven.maia.city (its block in aven/ops/deploy/Caddyfile; /opt/maia-city/site is its /srv/site). Learned from avenDB's
# caddy.sh, not called. Run by the deploy job over SSH:
#   bash deploy.sh <tree> <archive.tar.gz> [<site>]        <site> defaults to /opt/maia-city/site/aven
set -euo pipefail
tree=${1:?the tree}; archive=${2:?the archive}; site=${3:-/opt/maia-city/site/aven}
[[ $tree =~ ^[0-9a-f]{40}$ ]] || { echo "deploy.sh: not a tree hash: $tree" >&2; exit 2; }
[ -d "$site/releases" ] || { echo "deploy.sh: $site/releases is not there" >&2; exit 2; }
name=theos-${tree:0:12}
next="$site/releases/$name.next"

# unpacked beside the others first; current stays where it is until the tree is whole. A build already there is the
# same tree (its name is its hash) and may be the one served: it is never unpacked again.
if [ ! -d "$site/releases/$name" ]; then
	rm -rf "$next"; mkdir -p "$next"
	tar -xzf "$archive" -C "$next" || { rm -rf "$next"; echo "deploy.sh: the archive did not unpack" >&2; exit 1; }
	[ -f "$next/index.html" ] || { rm -rf "$next"; echo "deploy.sh: the archive has no index.html" >&2; exit 1; }
	mv "$next" "$site/releases/$name"
fi

now=$(readlink "$site/current" || true)
if [ "$now" = "releases/$name" ]; then echo "theOS $name is current already: nothing changed"; exit 0; fi
ln -sfn "releases/$name" "$site/current.next"; mv -fT "$site/current.next" "$site/current"
# previous is what the undo goes back to: the build that was current until now (switched second, so a run that stops
# between the two keeps the old previous, never one equal to current)
if [ -n "$now" ]; then ln -sfn "$now" "$site/previous.next"; mv -fT "$site/previous.next" "$site/previous"; fi
echo "theOS $name is current (previous: ${now:-none})"
