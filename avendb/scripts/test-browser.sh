#!/usr/bin/env bash
# avenDB's device in Chromium (P8d): builds avendb-browser for the browser (with SIMD, see .cargo/config.toml) into
# target/avendb-browser-pkg/, then runs its page test (crates/avendb-browser/tests/page.rs), which serves the page,
# starts a relay, the server and Samuel's Mac on this machine, and has two headless Chromiums link through them.
#
#   avendb/scripts/test-browser.sh
#
# Needs the wasm32 target (rustup target add wasm32-unknown-unknown), the wasm-bindgen CLI of the version
# avendb-browser pins (cargo install wasm-bindgen-cli --version 0.2.129), and Chromium: $AVENDB_CHROMIUM, or
# Playwright's at /opt/pw-browsers/chromium.
set -euo pipefail
cd "$(dirname "$0")/.."

want=0.2.129
have=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}') || true
if [ "$have" != "$want" ]; then
	echo "test-browser: needs wasm-bindgen $want (found ${have:-none}): cargo install wasm-bindgen-cli --version $want" >&2
	exit 1
fi

cargo build -p avendb-browser --target wasm32-unknown-unknown --release
out=target/avendb-browser-pkg
rm -rf "$out"
wasm-bindgen --target web --no-typescript --out-dir "$out" target/wasm32-unknown-unknown/release/avendb_browser.wasm
ls -l "$out"
AVENDB_PKG="$PWD/$out" cargo test -p avendb-browser --test page -- --ignored --nocapture
