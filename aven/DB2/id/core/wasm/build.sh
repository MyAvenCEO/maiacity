#!/bin/sh
# aven-id's queries as wasm for avenOS (`--target web`), into target/wasm/aven-id: aven_id.js and aven_id_bg.wasm.
# Runs in the box, from aven/DB2: `bun run box sh id/core/wasm/build.sh`.
set -e
cargo build -p aven-id --lib --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir target/wasm/aven-id target/wasm32-unknown-unknown/release/aven_id.wasm
ls -l target/wasm/aven-id/aven_id_bg.wasm
