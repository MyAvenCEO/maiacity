#!/bin/bash
# avenSANDBOX's runner (theOS/aip/AIP-2.json, c4): runs a command inside the box with theOS/ mounted at /work, the same
# in a cloud session, on a GitHub runner and on a Mac (bash 3.2 too). A snapshot keeps files, not processes, so it starts
# dockerd when it is down and it runs as root (on a Mac, OrbStack must be running). The image is the one this checkout's
# committed theOS/sandbox/box describes (theOS/sandbox/tag.sh reads HEAD: uncommitted edits to box/ run the old image),
# never another: until it is published, run.sh says so and stops.
# Only theOS/ is mounted, so there is no .git inside the box. The box runs as root (its tools live in root's /opt, and
# cargo writes to /opt/cargo); on a Linux host, files it writes into theOS/ are root's.
#   theOS/sandbox/run.sh <command...>     with no command: a shell in the box
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
theos=$(cd "$here/.." && pwd)
image=$("$here/tag.sh")
tag=${image##*:}

if ! docker info > /dev/null 2>&1; then
	if ! command -v dockerd > /dev/null; then
		echo "avenSANDBOX: Docker is not running (on a Mac, start OrbStack)" >&2; exit 1
	elif [ "$(id -u)" != 0 ]; then
		echo "avenSANDBOX: Docker is not running, and only root can start dockerd here: start it yourself" >&2; exit 1
	fi
	dockerd --allow-direct-routing > /var/log/dockerd.log 2>&1 &
	for _ in $(seq 1 60); do docker info > /dev/null 2>&1 && break; sleep 1; done
	docker info > /dev/null 2>&1 || { echo "avenSANDBOX: dockerd did not start (/var/log/dockerd.log)" >&2; exit 1; }
fi

if ! docker image inspect "$image" > /dev/null 2>&1; then
	if ! docker buildx imagetools inspect "$image" > /dev/null 2>&1 && ! docker manifest inspect "$image" > /dev/null 2>&1; then
		echo "avenSANDBOX: $tag is not published (or the registry is out of reach): push the change, and the image" \
			"workflow builds it" >&2
		exit 1
	fi
	echo "avenSANDBOX: pulling $tag (several GB the first time)" >&2
	docker pull "$image" >&2
fi

[ $# -gt 0 ] || set -- bash
tty=(); [ -t 0 ] && [ -t 1 ] && tty=(-it)
exec docker run --rm ${tty[@]+"${tty[@]}"} -v "$theos:/work" -w /work "$image" "$@"
