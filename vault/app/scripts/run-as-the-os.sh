#!/bin/sh
# Cargo runner (see ../.cargo/config.toml): run the app as "theOS", so the Dock shows that name in `tauri dev`.
# Anything else cargo runs (tests, other binaries) runs as it is.
bin="$1"; shift
if [ "$(basename "$bin")" = "maiacity-studio" ]; then
	named="$(dirname "$bin")/theOS"
	ln -f "$bin" "$named" 2>/dev/null || cp -f "$bin" "$named"
	bin="$named"
fi
exec "$bin" "$@"
