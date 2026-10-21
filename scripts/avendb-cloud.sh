#!/bin/sh
# avenDB for Claude Code sessions in Anthropic's cloud, as the repo's .mcp.json starts it (avendb-cloud): agentCloud,
# a device of avenMAIA (avendb-device agent cloud), its key the one theOS app showed once, which the cloud
# environment keeps as AVENDB_AGENT_KEY. It runs the latest Linux build from its rolling release
# (.github/workflows/avendb-agent.yml), fetched again only when the release's checksum changed, and checked against it;
# kept in ~/.cache/avendb. Anywhere but a cloud session, as on a Mac, whose own agent the Mac app runs
# (avendb-device agent claude), and in a cloud environment that holds no key, it stops at once and fetches nothing.
# Its stdout is the MCP's alone: whatever else it says goes to stderr.
set -eu
[ "${CLAUDE_CODE_REMOTE:-}" = true ] && [ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] || exit 0
[ -n "${AVENDB_AGENT_KEY:-}" ] || exit 0
release=https://github.com/MyAvenCEO/maiacity/releases/download/avendb-agent
asset=avendb-device-x86_64-linux
dir="$HOME/.cache/avendb"
mkdir -p "$dir"
want=$(curl -fsSL --max-time 20 "$release/$asset.sha256" 2>/dev/null | cut -d' ' -f1) || want=
have=$(cat "$dir/$asset.sha256" 2>/dev/null) || have=
if [ -n "$want" ] && [ "$want" != "$have" ]; then
	curl -fsSL --max-time 300 -o "$dir/$asset.part" "$release/$asset" >&2
	got=$(sha256sum "$dir/$asset.part" | cut -d' ' -f1)
	if [ "$got" != "$want" ]; then
		echo "avendb-cloud: the download doesn't match its release's checksum" >&2
		rm -f "$dir/$asset.part"
		exit 1
	fi
	chmod +x "$dir/$asset.part"
	mv "$dir/$asset.part" "$dir/$asset"
	echo "$want" > "$dir/$asset.sha256"
fi
[ -x "$dir/$asset" ] || { echo "avendb-cloud: no avendb-device, and its release can't be reached" >&2; exit 1; }
exec "$dir/$asset" agent cloud
