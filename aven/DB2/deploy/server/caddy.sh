#!/bin/bash
# Caddy's site block for aven.maia.city and avenOS's build (PRODUCTION.md, Part B, "The deploy", 5), run on the server
# by avendeploy.yml:  bash caddy.sh VERSION RUN
# /opt/aven holds what the job put there: aven.caddy (the block, as aven/ops/deploy/Caddyfile holds it) and
# aven-os-web-VERSION.tar.gz (checked against its release's SHA256SUMS on the runner). v1's blocks stay as they are:
# only the lines between the block's markers are replaced, and Caddy reloads only a file it has validated.
set -euo pipefail
version=$1 run=$2
site=/opt/maia-city/site
config=/opt/maia-city/deploy/Caddyfile

# avenOS's build beside the last, then one link switched: site/aven/current, which Caddy serves as /srv/site/aven/current
mkdir -p "$site/aven/releases/$version.next"
tar -xzf "/opt/aven/aven-os-web-$version.tar.gz" -C "$site/aven/releases/$version.next"
[ -f "$site/aven/releases/$version.next/index.html" ] || { echo "::error::aven-os-web-$version.tar.gz has no index.html"; exit 1; }
rm -rf "$site/aven/releases/$version"
mv "$site/aven/releases/$version.next" "$site/aven/releases/$version"
ln -sfn "releases/$version" "$site/aven/current.next"
mv -fT "$site/aven/current.next" "$site/aven/current"
echo "avenOS $version is current"
# the three newest builds stay, for a quick way back
ls -1t "$site/aven/releases" | tail -n +4 | while read -r old; do rm -rf "${site:?}/aven/releases/$old"; done

# The server's Caddyfile without its last copy of the block and the blank lines that ended it, then one blank line and
# the block: a candidate where the container sees it
candidate="$site/.Caddyfile-aven-$run"
awk '/^# >>> aven.maia.city$/ { skip = 1 } !skip { print } /^# <<< aven.maia.city$/ { skip = 0 }' "$config" \
  | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' > "$candidate"
{ echo; cat /opt/aven/aven.caddy; } >> "$candidate"
if cmp -s "$candidate" "$config"; then
  echo "Caddy's config already has this block"
  rm "$candidate"
  exit 0
fi
diff -u "$config" "$candidate" | sed -n '1,2d;/^[-+]/p' | head -60 || true
docker exec maia-city-caddy caddy validate --config "/srv/site/.Caddyfile-aven-$run" --adapter caddyfile
cp "$config" "/opt/aven/Caddyfile.before-$run"
# the same inode, mounted into the running container: only its contents change
cat "$candidate" > "$config"
rm "$candidate"
docker exec maia-city-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
echo "Caddy reloaded with aven.maia.city (the config before: /opt/aven/Caddyfile.before-$run)"
