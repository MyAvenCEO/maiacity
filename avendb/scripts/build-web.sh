#!/usr/bin/env bash
# The avenDB tile's WebAssembly: builds avendb-web for the browser (with SIMD, see .cargo/config.toml) and writes the
# page's package into src/lib/avendb/pkg/. The package is committed, so the site builds without Rust: run this after
# changing avendb or avendb-web, and commit what it writes.
#
#   avendb/scripts/build-web.sh
#
# Needs the wasm32 target (rustup target add wasm32-unknown-unknown) and the wasm-bindgen CLI of the version
# avendb-web pins (cargo install wasm-bindgen-cli --version 0.2.129).
set -euo pipefail
cd "$(dirname "$0")/.."

want=0.2.129
have=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}') || true
if [ "$have" != "$want" ]; then
	echo "build-web: needs wasm-bindgen $want (found ${have:-none}): cargo install wasm-bindgen-cli --version $want" >&2
	exit 1
fi

cargo build -p avendb-web --target wasm32-unknown-unknown --release
out=../src/lib/avendb/pkg
rm -rf "$out"
wasm-bindgen --target web --no-typescript --out-dir "$out" target/wasm32-unknown-unknown/release/avendb_web.wasm

# the site type-checks its JavaScript; this file is written by wasm-bindgen
js="$out/avendb_web.js"
{ printf '// @ts-nocheck: written by wasm-bindgen (avendb/scripts/build-web.sh)\n'; cat "$js"; } > "$js.new"
mv "$js.new" "$js"
ls -l "$out"
