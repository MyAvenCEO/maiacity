#!/bin/sh
# Builds every runtime module as it ships (README, "Only from the repository"): wasm32, release, in the box, where the
# toolchain and the paths are the same on every run, so a module's bytes, and so its hash, are the same too. The
# bootstrap manifest (manifest.json) freezes each module's hash, and frozen/<hex>.wasm keeps its bytes, loadable by hash after
# its source has moved on. The host's tests hold the newest build of each runtime to its newest frozen bytes and every
# frozen file to its name (`frozen`), run the model's vectors through the frozen modules and hold the host's refusals
# and limits. From aven/runtimes, in the box:
#   sh freeze.sh           builds the modules, prints each one's hash and keeps a new module's bytes in frozen/
#                          (append its entry to the manifest by hand: a change to a runtime is its next version)
#   sh freeze.sh --check   builds them and runs the host's tests; writes nothing
set -e
cargo build -q --release --locked --target wasm32-unknown-unknown -p aven-runtimes-module-markdown -p aven-runtimes-module-face
out="${CARGO_TARGET_DIR:-target}/wasm32-unknown-unknown/release"
hashes=$(cargo run -q --locked -p aven-runtimes-host --example hash -- "$out/aven_runtimes_module_markdown.wasm" "$out/aven_runtimes_module_face.wasm")
echo "$hashes"
if [ "$1" = "--check" ]; then cargo test -q --locked -p aven-runtimes-host; exit; fi
mkdir -p frozen
echo "$hashes" | while read -r hash path; do
  [ -f "frozen/${hash#b3:}.wasm" ] || { cp "$path" "frozen/${hash#b3:}.wasm" && chmod 644 "frozen/${hash#b3:}.wasm"; }
done
