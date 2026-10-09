#!/usr/bin/env bash
# avenDB's device in Chromium (P8d, P8e): builds avendb-browser for the browser (with SIMD, see .cargo/config.toml) into
# target/avendb-browser-pkg/, with passkeys of localhost, then runs its page test (crates/avendb-browser/tests/page.rs),
# which serves the page, starts a relay and the server on this machine, and drives a headless Chromium whose virtual
# authenticator holds Eve's passkey: her browsers found her vault, link and open again from IndexedDB.
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

cargo build -p avendb-browser --target wasm32-unknown-unknown --release --features localhost-passkeys
out=target/avendb-browser-pkg
rm -rf "$out"
wasm-bindgen --target web --no-typescript --out-dir "$out" target/wasm32-unknown-unknown/release/avendb_browser.wasm
ls -l "$out"
# the test's relay and server take the same passkeys of localhost as the page
AVENDB_PKG="$PWD/$out" cargo test -p avendb-browser --features localhost-passkeys --test page -- --ignored --nocapture
