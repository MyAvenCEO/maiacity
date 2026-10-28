#!/usr/bin/env bash
# avenDB's page's WebAssembly: avendb-browser, the page's own device (Your account), with its JS modules, into
# aven/db/page/device/. A build output, not in git (B1): `bun aven/ops/devx/wasm.mjs ensure` fills the folder from
# CI's build of the same sources, or runs this where there is none (uncommitted Rust changes); `wasm.mjs build` runs
# it and stamps what it wrote.
#
#   aven/db/scripts/build-web.sh
#
# Needs the wasm32 target (rustup target add wasm32-unknown-unknown) and the wasm-bindgen CLI of the version
# avendb-browser pins (cargo install wasm-bindgen-cli --version 0.2.129); binaryen's wasm-opt, if installed, optimizes
# what it writes.
set -euo pipefail
cd "$(dirname "$0")/.."

want=0.2.129
have=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}') || true
if [ "$have" != "$want" ]; then
	echo "build-web: needs wasm-bindgen $want (found ${have:-none}): cargo install wasm-bindgen-cli --version $want" >&2
	exit 1
fi

# the page's own device (Your account, P8e): avendb-browser and its JS modules, for passkeys of maia.city
cargo build -p avendb-browser --target wasm32-unknown-unknown --profile wasm
device=./page/device
rm -rf "$device"
wasm-bindgen --target web --no-typescript --out-dir "$device" "${CARGO_TARGET_DIR:-../../target}/wasm32-unknown-unknown/wasm/avendb_browser.wasm"
# smaller and quicker where binaryen's wasm-opt is installed (the features Rust's wasm32 target uses, which it reads
# from the module itself); left as wasm-bindgen wrote it where it isn't
if command -v wasm-opt >/dev/null 2>&1; then
	wasm-opt -O "$device/avendb_browser_bg.wasm" -o "$device/avendb_browser_bg.wasm"
fi
modules=crates/avendb-browser/js
for js in "$device/avendb_browser.js" "$modules/passkey.js" "$modules/store.js" "$modules/store.worker.js"; do
	{ printf '// @ts-nocheck: written by aven/db/scripts/build-web.sh from avenDB\n'; cat "$js"; } > "$js.new"
	mv "$js.new" "$device/$(basename "$js")"
done
ls -l "$device"
