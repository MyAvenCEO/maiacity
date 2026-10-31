#!/bin/sh
# The third-party crates, compiled into the box's image, cargo-chef style (SANDBOX.md, "The box"). The Dockerfile copies
# only the workspace's manifests (Cargo.toml, Cargo.lock and every crate's Cargo.toml) into /work and runs this: each
# crate gets a stub source, the stubs are built exactly as `bun run up` and `cargo test --workspace` build them, and
# then the stubs' own artifacts go, so only the dependencies stay in /work/target. A fresh session's empty build-folder
# volume fills from there on its first mount, and the first build finds every dependency fresh.
set -e
cd /work

# A stub for every target a manifest names, ours and aven/runtimes' registry's at /runtimes/registry, which the Peers
# take by path: the library, and each [[bin]], [[example]], [[test]] and [[bench]] at its `path` or cargo's default for
# its name. A crate that came with its source is third-party code, kept whole (none today).
for manifest in $(find . /runtimes -name Cargo.toml -not -path ./Cargo.toml); do
	dir=$(dirname "$manifest")
	[ -e "$dir/src/lib.rs" ] && continue
	mkdir -p "$dir/src"
	: > "$dir/src/lib.rs"
	awk '
		function stub() {
			if (kind == "") return
			if (path == "") path = (kind == "bin" ? "src/bin/" : kind == "example" ? "examples/" : kind == "test" ? "tests/" : "benches/") name ".rs"
			print path
		}
		/^\[/ { stub(); kind = ""; name = ""; path = "" }
		/^\[\[(bin|example|test|bench)\]\]/ { kind = $0; gsub(/[\[\] ]/, "", kind) }
		kind != "" && /^name *=/ { name = $0; sub(/^name *= *"/, "", name); sub(/".*/, "", name) }
		kind != "" && /^path *=/ { path = $0; sub(/^path *= *"/, "", path); sub(/".*/, "", path) }
		END { stub() }
	' "$manifest" | while read -r target; do
		mkdir -p "$dir/$(dirname "$target")"
		echo 'fn main() {}' > "$dir/$target"
	done
done

# What `bun run up` builds (sandbox/up.mjs), then what `cargo test --workspace` builds
cargo build --locked -p aven-peer
cargo build --locked -p aven-peer-light --lib --target wasm32-unknown-unknown
cargo test --locked --workspace --no-run

# The stubs' own artifacts go, and the fork's, whose source the checkout brings again with newer times: our crates and
# the fork, every profile and target
packages=$(for manifest in $(find . /runtimes -name Cargo.toml -not -path ./Cargo.toml); do
	awk '/^\[/ { section = $0 } section == "[package]" && /^name *=/ { gsub(/^name *= *"|".*$/, ""); print; exit }' "$manifest"
done)
for target in "" "--target wasm32-unknown-unknown"; do
	for profile in dev release; do
		for package in $packages; do
			cargo clean --locked -q -p "$package" --profile "$profile" $target
		done
	done
done
rm -rf target/debug/incremental target/wasm32-unknown-unknown/*/incremental
left=$(find target -name '*aven*' | head -5)
if [ -n "$left" ]; then echo "stub artifacts left: $left"; exit 1; fi
