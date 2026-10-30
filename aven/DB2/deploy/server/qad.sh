#!/bin/bash
# The Aven Peer's certificate for QUIC address discovery (QAD, the relay's UDP 7842): Caddy's own Let's Encrypt
# certificate for aven.maia.city, which Caddy gets and renews by itself. Copied out of v1's Caddy into /opt/aven/qad,
# readable only by the peer's user (nonroot, 65532), since Caddy keeps its keys for root alone. Run by peer.sh at every
# deploy, and daily by cron (/etc/cron.daily/aven-qad): when Caddy has renewed, the copy changes and the peer restarts.
#   bash qad.sh [--restart]     prints qad=on or qad=off, and why
set -euo pipefail
site=aven.maia.city
dir=/opt/aven/qad
cd /opt/aven

crt=$(docker exec maia-city-caddy sh -c "find /data/caddy/certificates -name '$site.crt' | head -1" 2>/dev/null || true)
if [ -z "$crt" ]; then
  echo "qad=off: Caddy has no certificate for $site yet"
  exit 0
fi
key="${crt%.crt}.key"

sudo install -d -o deploy -g deploy -m 755 "$dir"
docker exec maia-city-caddy cat "$crt" > "$dir/aven.crt.next"
docker exec maia-city-caddy cat "$key" | sudo tee "$dir/aven.key.next" > /dev/null
changed=no
for f in aven.crt aven.key; do
  if ! sudo cmp -s "$dir/$f.next" "$dir/$f" 2>/dev/null; then changed=yes; fi
done
sudo chown 65532:65532 "$dir/aven.crt.next" "$dir/aven.key.next"
sudo chmod 444 "$dir/aven.crt.next"
sudo chmod 400 "$dir/aven.key.next"
sudo mv -f "$dir/aven.crt.next" "$dir/aven.crt"
sudo mv -f "$dir/aven.key.next" "$dir/aven.key"
echo "qad=on: $site's certificate from Caddy ($(basename "$(dirname "$(dirname "$crt")")")), changed: $changed"

if [ "${1:-}" = --restart ] && [ "$changed" = yes ] && docker inspect aven-peer > /dev/null 2>&1; then
  docker compose restart peer > /dev/null
  echo "the peer restarted on the renewed certificate"
fi
