#!/bin/sh
# aven-id's queries as wasm for avenOS (`--target web`), into target/wasm/aven-id: aven_id.js and aven_id_bg.wasm.
# `bun run up` and `bun run build` run it in the box; by hand, from aven/DB2: `bun run box sh id/core/wasm/build.sh`.
# wasm-bindgen runs only for a new wasm, and swaps the folder in one move, so Vite never serves half a build.
set -e
cargo build -q -p aven-id --lib --target wasm32-unknown-unknown --release
wasm=target/wasm32-unknown-unknown/release/aven_id.wasm
src=$(sha256sum $wasm | cut -c1-64)
if [ "$src" != "$(cat target/wasm/aven-id/.source 2>/dev/null)" ]; then
	rm -rf target/wasm/aven-id.next
	wasm-bindgen --target web --out-dir target/wasm/aven-id.next $wasm
	echo "$src" > target/wasm/aven-id.next/.source
	rm -rf target/wasm/aven-id
	mv target/wasm/aven-id.next target/wasm/aven-id
fi
