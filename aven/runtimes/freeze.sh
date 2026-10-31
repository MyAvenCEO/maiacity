#!/bin/sh
# Builds every runtime module as it ships (README, "Only from the repository"): wasm32, release, in the box, where the
# toolchain and the paths are the same on every run, so a module's bytes, and so its hash, are the same too. The
# manifest (manifest.json) freezes each module's hash; the host's tests check the build against it (`frozen`), run
# the model's vectors through the modules and hold the host's refusals and limits. From aven/runtimes, in the box:
#   sh freeze.sh           builds the modules and prints each one's hash
#   sh freeze.sh --check   builds them and runs the host's tests
set -e
cargo build -q --release --locked --target wasm32-unknown-unknown -p aven-runtimes-module-markdown -p aven-runtimes-module-face
out="${CARGO_TARGET_DIR:-target}/wasm32-unknown-unknown/release"
cargo run -q --locked -p aven-runtimes-host --example hash -- "$out/aven_runtimes_module_markdown.wasm" "$out/aven_runtimes_module_face.wasm"
if [ "$1" = "--check" ]; then cargo test -q --locked -p aven-runtimes-host; fi
