#!/bin/sh
# The conformance suite on OPFS, in the box's Chromium: build the example to wasm, bind it, run it in a page.
# From aven/DB2: bun run box sh db/store/opfs/run.sh
set -e
cargo build -q -p aven-db-store --example opfs_conformance --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir target/opfs-conformance \
  target/wasm32-unknown-unknown/release/examples/opfs_conformance.wasm
node db/store/opfs/run.mjs target/opfs-conformance
