#!/bin/bash
# avenSANDBOX's image name and tag (theOS/aip/AIP-2.json, c2): ghcr.io/myavenceo/aven/sandbox:theos-<hash>, the hash of
# theOS/sandbox/box, .github/workflows/avensandbox-image.yml and this file at
# HEAD. One formula, used by the image workflow and by
# run.sh, so both always name the same box.
set -euo pipefail
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
sha() { if command -v sha256sum > /dev/null; then sha256sum; else shasum -a 256; fi; }
hash=$(printf '%s %s %s' "$(git -C "$repo" rev-parse HEAD:theOS/sandbox/box)" \
	"$(git -C "$repo" rev-parse HEAD:.github/workflows/avensandbox-image.yml)" \
	"$(git -C "$repo" rev-parse HEAD:theOS/sandbox/tag.sh)" | sha | cut -c1-16)
echo "ghcr.io/myavenceo/aven/sandbox:theos-$hash"
