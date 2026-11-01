#!/bin/bash
# 'avenSANDBOX' (aip-59ad, c1): the box this commit describes (theOS/sandbox/tag.sh: theos-<hash>) is published for amd64
# and arm64, and its tools answer inside it (through theOS/sandbox/run.sh, as theOS's check runs). It builds nothing:
# avenSANDBOX's image workflow builds the box when it changes (aip-6fb1, d-47c5).
#   theOS/release/box.sh
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
image=${AVENSANDBOX_IMAGE:-$(bash "$here/../sandbox/tag.sh")}  # AVENSANDBOX_IMAGE: only for its test
has=$(docker buildx imagetools inspect --raw "$image" 2> /dev/null \
	| jq -r '[.manifests[]?.platform | select(.os == "linux") | .architecture] | sort | join(",")' 2> /dev/null || true)
if [ "$has" != "amd64,arm64" ]; then
	echo "::error::avenSANDBOX $image is not published for amd64 and arm64 (it has: ${has:-nothing}): avenSANDBOX's image workflow builds it on a push that changes the box"
	exit 1
fi
echo "avenSANDBOX $image: amd64 and arm64"
AVENSANDBOX_IMAGE=$image "$here/../sandbox/run.sh" bash -euc 'node --version; bun --version; lean --version; rustc --version; node -e "require(\"playwright\").chromium.launch().then(async (b) => { console.log(\"chromium\", b.version()); await b.close(); })"' \
	|| { echo "::error::a tool in avenSANDBOX $image did not answer"; exit 1; }
