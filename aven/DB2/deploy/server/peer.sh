#!/bin/bash
# The Aven Peer on the server (PRODUCTION.md, Part B, "The deploy", 4), run there by avendeploy.yml from /opt/aven,
# where it has put compose.yml:  bash peer.sh IMAGE GUARDIAN USER < secrets
# stdin holds three lines, never an argument: the bucket's access key, its secret key, and a token that reads
# ghcr.io. It prints no secret: only the peer's public half, whether its key was made or kept, and its record. It also
# writes /aven.json, which tells avenOS which Aven Peer its host is in front of.
set -euo pipefail
image=$1 guardian=$2 user=$3
# no Aven Peer in production without MaiaCityGuardian (Samuel, 30 Oct 2026)
[[ "$guardian" =~ ^[0-9a-f]{64}$ ]] || { echo "::error::no MaiaCityGuardian given: the peer is left as it is"; exit 1; }
IFS= read -r s3_key
IFS= read -r s3_secret
IFS= read -r token
cd /opt/aven
umask 077

# The peer's key, made here at its first deploy, in the file `secret` that only the peer's user (nonroot, 65532)
# reads, through --secret-file, so no `docker inspect` shows it; never copied anywhere. A key an earlier deploy kept in
# peer.env moves there
secret=$(sudo cat secret 2>/dev/null || sed -n 's/^AVEN_PEER_SECRET=//p' peer.env 2>/dev/null || true)
secret=$(printf '%s' "$secret" | tr -d '[:space:]')
if [ -z "$secret" ]; then
  secret=$(openssl rand -hex 32)
  echo "key=made"
else
  echo "key=kept"
fi
[[ "$secret" =~ ^[0-9a-f]{64}$ ]] || { echo "::error::peer.env holds a key that is not 64 hex digits; left as it is"; exit 1; }
printf '%s\n' "$secret" | sudo tee secret.next > /dev/null
sudo chown 65532:65532 secret.next
sudo chmod 400 secret.next
sudo mv -f secret.next secret
printf 'AVEN_PEER_S3_KEY=%s\nAVEN_PEER_S3_SECRET=%s\n' "$s3_key" "$s3_secret" > peer.env.next
# QAD (the relay's QUIC address discovery, UDP 7842) on Caddy's certificate for aven.maia.city, copied by qad.sh;
# without one yet, the relay serves no QAD and every other part runs as before
mkdir -p qad
qad=$(bash qad.sh)
echo "$qad"
if [[ "$qad" == qad=on* ]]; then
  printf 'AVEN_PEER_RELAY_CERT=/run/qad/aven.crt\nAVEN_PEER_RELAY_KEY=/run/qad/aven.key\nAVEN_PEER_RELAY_QUIC=0.0.0.0:7842\n' >> peer.env.next
fi
mv -f peer.env.next peer.env
# Caddy renews by itself; once a day the copy is made again, and the peer restarts when it changed
printf '#!/bin/sh\nsu deploy -s /bin/bash -c "bash /opt/aven/qad.sh --restart" >> /opt/aven/qad.log 2>&1\n' \
  | sudo tee /etc/cron.daily/aven-qad > /dev/null
sudo chmod 755 /etc/cron.daily/aven-qad
# Ed25519's public half of the seed, through openssl: the seed wrapped as PKCS#8 DER, the last 32 bytes of the SPKI
public=$(printf '302e020100300506032b657004220420%s' "$secret" \
  | python3 -c 'import sys; sys.stdout.buffer.write(bytes.fromhex(sys.stdin.read()))' \
  | openssl pkey -inform DER -pubout -outform DER \
  | python3 -c 'import sys; print(sys.stdin.buffer.read()[-32:].hex())')
unset secret s3_secret
echo "public=$public"

# /aven.json beside avenOS's builds, which Caddy serves at aven.maia.city/aven.json (aven/ops/deploy/Caddyfile)
site=/opt/maia-city/site/aven
mkdir -p "$site"
printf '{"network":"aven","peer":"%s","rpId":"maia.city"}\n' "$public" > "$site/aven.json.next"
chmod 644 "$site/aven.json.next"
mv -f "$site/aven.json.next" "$site/aven.json"

# The network of v1's Caddy, which the peer joins so Caddy reaches its relay
network=$(docker inspect maia-city-caddy --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')
[ -n "$network" ] || { echo "::error::v1's Caddy (maia-city-caddy) is not running"; exit 1; }
printf 'AVEN_PEER_IMAGE=%s\nAVEN_PEER_GUARDIAN=%s\nCADDY_NETWORK=%s\n' "$image" "$guardian" "$network" > .env

printf '%s' "$token" | docker login ghcr.io -u "$user" --password-stdin > /dev/null
docker compose pull -q
docker logout ghcr.io > /dev/null
docker compose up -d --remove-orphans --force-recreate

# Its first lines, from the run of the container running now (since its start, so a restart's earlier run is not
# read): stored (its record in the bucket), which comes first, as soon as the store answers, then started (its key)
# once its endpoint and relay are up. Until 30 Oct 2026 this read from the last `started` on, which since the
# members-only door (milestone 2) comes after `stored`, so it never saw the record and waited 120 s for nothing.
began=$(date -u +%s)
since=
for _ in $(seq 60); do
  start=$(docker inspect aven-peer --format '{{.State.StartedAt}}' 2>/dev/null || true)
  since=$(docker logs --since "$start" aven-peer 2>/dev/null | grep '^{' || true)
  grep -q '"event":"stored"' <<< "$since" && grep -q '"event":"started"' <<< "$since" && break
  # a peer that stopped, or restarted since it was started, won't keep its record by waiting
  [ "$(docker inspect aven-peer --format '{{.State.Running}} {{.RestartCount}}')" = "true 0" ] || break
  sleep 2
done
python3 -c '
import json, sys
for line in sys.stdin:
    try: e = json.loads(line)
    except ValueError: continue
    if e.get("event") == "started": print("started=" + str(e.get("key")))
    if e.get("event") == "stored": print("record=%s first=%s kept=%s" % (e.get("blob"), e.get("first"), e.get("kept")))
' <<< "$since"
docker inspect aven-peer --format 'running={{.State.Running}} restarts={{.RestartCount}}'
if ! grep -q '"event":"stored"' <<< "$since" || ! grep -q '"event":"started"' <<< "$since"; then
  echo "::error::the Aven Peer kept no record or did not start within $(( $(date -u +%s) - began )) s; its last lines:"
  docker logs --tail 20 aven-peer 2>&1
  exit 1
fi
