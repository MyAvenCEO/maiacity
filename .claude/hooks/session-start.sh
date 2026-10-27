#!/bin/bash
# A warm start for avenDB's Rust in Claude Code cloud sessions: the compiled test dependencies that
# .github/workflows/avendb-dev-cache.yml puts on the release "avendb-dev-cache", unpacked into avendb/target, with the
# Rust toolchain they were built with (cargo reuses nothing another rustc built). A session's first test build then
# compiles only our own crates: avendb-net's tests in about 4 minutes instead of about 10 (avendb/CLAUDE.md).
#
# Cloud sessions only. It never replaces a build folder it did not make, and anything that fails leaves the session as
# it was: a cold build, as before. What it says goes to stderr, but for one line on stdout for the session.
set -uo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = true ] && [ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] || exit 0

release="${AVENDB_DEV_CACHE_URL:-https://github.com/MyAvenCEO/maiacity/releases/download/avendb-dev-cache}"
target="${CLAUDE_PROJECT_DIR:-$(pwd)}/avendb/target"
stamp="$target/.dev-cache"
say() { echo "avendb dev cache: $*" >&2; }

# The cloud environment's setup script (docs/devx/cloud-setup.sh) can unpack the cache once into the environment's disk
# snapshot, which every new session starts from: then it is moved into place instead of downloaded and unpacked.
snapshot=${AVENDB_DEV_CACHE_DIR:-/opt/avendb-dev-cache}
manifest=$(curl -fsSL --max-time 20 "$release/manifest") || manifest=$(cat "$snapshot/manifest" 2>/dev/null) \
	|| { say "no manifest; builds start cold"; exit 0; }
rustc=$(sed -n 's/^rustc=//p' <<< "$manifest")
[[ "$rustc" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { say "manifest names no toolchain"; exit 0; }

# cargo builds again whatever it finds under another registry path, so only where CI's registry lies too
home="${CARGO_HOME:-$HOME/.cargo}"
[ "$home" = "$(sed -n 's/^cargo_home=//p' <<< "$manifest")" ] || { say "this session's cargo home $home is not the cache's"; exit 0; }

# its toolchain, the default from now on in this container
if ! rustup run "$rustc" rustc -V > /dev/null 2>&1; then
	rustup toolchain install "$rustc" --profile minimal -c rustfmt -c clippy --no-self-update >&2 || { say "toolchain $rustc not installed"; exit 0; }
fi
rustup default "$rustc" >&2 || exit 0

# vendor/iroh, a path dependency, counts as changed when its files' newest time differs from its build's, as it does in
# every fresh clone: they get the one time CI gave them, but only while they are the very files the cache was built from
repo="${CLAUDE_PROJECT_DIR:-$(pwd)}"
commit=$(sed -n 's/^commit=//p' <<< "$manifest")
if [[ "$commit" =~ ^[0-9a-f]{40}$ ]] && git -C "$repo" cat-file -e "$commit^{commit}" 2>/dev/null \
	&& git -C "$repo" diff --quiet "$commit" -- avendb/vendor/iroh 2>/dev/null; then
	find "$repo/avendb/vendor/iroh" -type f -exec touch -m -d '2001-01-01T00:00:00Z' {} + 2>/dev/null
fi

# only into an empty build folder: one that holds a build already (the cache's, or the session's own) stays as it is
if [ -e "$target/debug" ]; then
	[ -f "$stamp" ] && echo "avenDB dev cache already in avendb/target (rustc $rustc)."
	exit 0
fi

# the snapshot's copy, when it is this manifest's: one rename on the same disk
if [ -d "$snapshot/debug" ] && [ "$manifest" = "$(cat "$snapshot/manifest" 2>/dev/null)" ] \
	&& mkdir -p "$target" && mv "$snapshot/debug" "$target/debug" 2>/dev/null; then
	printf '%s\n' "$manifest" > "$stamp"
	echo "avenDB dev cache moved into avendb/target from the environment snapshot (rustc $rustc)."
	exit 0
fi

mkdir -p "$target" && work=$(mktemp -d "$target/.dev-cache-download.XXXXXX") || exit 0
trap 'rm -rf "$work"' EXIT
parts=()
while read -r name sum; do
	[[ "$name" =~ ^dev-cache\.tgz\.[0-9]+$ ]] || { say "odd part name"; exit 0; }
	curl -fsSL --max-time 600 -o "$work/$name" "$release/$name" || { say "download of $name failed"; exit 0; }
	[ "$(sha256sum "$work/$name" | cut -d' ' -f1)" = "$sum" ] || { say "$name doesn't match its manifest (a new cache being uploaded?)"; exit 0; }
	parts+=("$work/$name")
done < <(sed -n 's/^part=//p' <<< "$manifest")
[ ${#parts[@]} -gt 0 ] || exit 0

# unpacked aside and moved into place whole, so a failed unpack leaves no half a build folder
mkdir -p "$work/unpacked" "$target" || exit 0
if cat "${parts[@]}" | tar -xz -C "$work/unpacked" && [ ! -e "$target/debug" ] && mv "$work/unpacked/debug" "$target/debug"; then
	printf '%s\n' "$manifest" > "$stamp"
	echo "avenDB dev cache unpacked into avendb/target (rustc $rustc): the first test build compiles only our own crates."
else
	say "unpacking failed"
fi
exit 0
