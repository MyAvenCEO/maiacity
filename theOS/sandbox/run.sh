#!/bin/bash
# avenSANDBOX's runner (theOS/aip/AIP-2.json, c4): runs a command inside the box with theOS/ mounted at /work, the same
# in a cloud session, on a GitHub runner and on a Mac. A snapshot keeps files, not processes, so it starts dockerd when
# it is down (on a Mac, OrbStack must be running). The image is the one this checkout's theOS/sandbox/box and image
# workflow describe (theos-<hash>), never another: until it is published, run.sh says so and stops.
#   theOS/sandbox/run.sh <command...>     with no command: a shell in the box
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
theos=$(cd "$here/.." && pwd)
image=$("$here/tag.sh")
tag=${image##*:}

if ! docker info > /dev/null 2>&1; then
	if command -v dockerd > /dev/null && [ "$(id -u)" = 0 ]; then
		dockerd --allow-direct-routing > /var/log/dockerd.log 2>&1 &
		for _ in $(seq 1 60); do docker info > /dev/null 2>&1 && break; sleep 1; done
	fi
	docker info > /dev/null 2>&1 || { echo "avenSANDBOX: no Docker here (on a Mac, start OrbStack)" >&2; exit 1; }
fi

if ! docker image inspect "$image" > /dev/null 2>&1 && ! docker pull -q "$image" > /dev/null 2>&1; then
	echo "avenSANDBOX: $tag is not published yet: push the change, and the image workflow builds it" >&2
	exit 1
fi

[ $# -gt 0 ] || set -- bash
tty=(); [ -t 0 ] && [ -t 1 ] && tty=(-it)
exec docker run --rm "${tty[@]}" -v "$theos:/work" -w /work "$image" "$@"
