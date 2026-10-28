#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fixture=$(mktemp /private/tmp/ceremony-result.XXXXXX.swift)
trap 'rm -f "$fixture"' EXIT
printf 'import Foundation\n' > "$fixture"
sed -n '/^\/\/ BEGIN ceremony result state/,/^\/\/ END ceremony result state/p' "$root/enclave/Enclave.swift" >> "$fixture"
cat "$root/scripts/test-ceremony-result.swift" >> "$fixture"
xcrun swift -module-cache-path /private/tmp/avendb-ceremony-swift-cache "$fixture"
