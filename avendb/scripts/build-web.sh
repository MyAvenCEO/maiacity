#!/usr/bin/env bash
# avenDB's page's WebAssembly: avendb-browser, the page's own device (Your account), with its JS modules, into
# src/lib/avendb/device/. The package is committed, so the site builds without Rust: run this after changing avendb,
# avendb-net or avendb-browser, and commit what it writes. (avendb-web, the simulated Lab's tile, is no longer on the
# page; its tests still run with the workspace's.)
#
#   avendb/scripts/build-web.sh
#
# Needs the wasm32 target (rustup target add wasm32-unknown-unknown) and the wasm-bindgen CLI of the version
# avendb-browser pins (cargo install wasm-bindgen-cli --version 0.2.129).
set -euo pipefail
cd "$(dirname "$0")/.."

want=0.2.129
have=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}') || true
if [ "$have" != "$want" ]; then
	echo "build-web: needs wasm-bindgen $want (found ${have:-none}): cargo install wasm-bindgen-cli --version $want" >&2
	exit 1
fi

# the page's own device (Your account, P8e): avendb-browser and its JS modules, for passkeys of maia.city
cargo build -p avendb-browser --target wasm32-unknown-unknown --release
device=../src/lib/avendb/device
rm -rf "$device"
wasm-bindgen --target web --no-typescript --out-dir "$device" target/wasm32-unknown-unknown/release/avendb_browser.wasm
for js in "$device/avendb_browser.js" crates/avendb-browser/js/passkey.js crates/avendb-browser/js/store.js; do
	{ printf '// @ts-nocheck: written by avendb/scripts/build-web.sh from avenDB\n'; cat "$js"; } > "$js.new"
	mv "$js.new" "$device/$(basename "$js")"
done
ls -l "$device"
