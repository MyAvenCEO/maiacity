#!/bin/bash
# The cloud environment's setup script (Project settings > Cloud environment > gear > Setup script: paste this file).
# It runs once; Anthropic then snapshots the disk, and new sessions start from that snapshot for ~7 days without
# running it again. It must finish in ~5 minutes or nothing is cached (measured 2026-10-27: about 1 minute).
# What it puts in the snapshot: the Rust toolchain avenDB's dev cache was built with (plus the WebAssembly target), and
# the dev cache unpacked in /opt/avendb-dev-cache, which .claude/hooks/session-start.sh moves into avendb/target in an
# instant when the cache on GitHub is still the same one (otherwise it downloads the newer one, as without this).
# Anything that fails just leaves the hook to do it as before.
set -u
rel=https://github.com/MyAvenCEO/maiacity/releases/download/avendb-dev-cache
dir=/opt/avendb-dev-cache
m=$(curl -fsSL --max-time 30 "$rel/manifest") || exit 0
v=$(sed -n 's/^rustc=//p' <<< "$m")
[[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 0
( rustup toolchain install "$v" --profile minimal -c rustfmt -c clippy --no-self-update \
	&& rustup target add wasm32-unknown-unknown --toolchain "$v" && rustup default "$v" ) &
rm -rf "$dir" && mkdir -p "$dir/parts" || exit 0
parts=()
while read -r name sum; do
	[[ "$name" =~ ^dev-cache\.tgz\.[0-9]+$ ]] || exit 0
	curl -fsSL --max-time 240 -o "$dir/parts/$name" "$rel/$name" || exit 0
	[ "$(sha256sum "$dir/parts/$name" | cut -d' ' -f1)" = "$sum" ] || exit 0
	parts+=("$dir/parts/$name")
done < <(sed -n 's/^part=//p' <<< "$m")
mkdir -p "$dir/unpacked" && cat "${parts[@]}" | tar -xz -C "$dir/unpacked" && mv "$dir/unpacked/debug" "$dir/debug" \
	&& printf '%s\n' "$m" > "$dir/manifest"
rm -rf "$dir/parts" "$dir/unpacked"
wait
exit 0
