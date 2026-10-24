#!/usr/bin/env bash
set -euo pipefail
: "${AVENDB_HOST:?AVENDB_HOST is required}"
ssh prod "docker exec maia-city-caddy wget -qO- http://avendb:3350/healthz" && echo " ← its relay answers inside" \
  || echo "::warning::avenDB's relay does not answer inside"
pq() { docker run --rm curlimages/curl:8.16.0 --curves X25519MLKEM768 "$@"; }
if ! pq -fsS --max-time 15 "https://$AVENDB_HOST/healthz"; then
  echo "::warning::https://$AVENDB_HOST does not answer yet — check its A record (-> ${HOST:-unknown}) and let Caddy finish its certificate."; exit 0
fi
echo " ← https://$AVENDB_HOST answers, by X25519MLKEM768"
if curl -fsS --max-time 5 "https://$AVENDB_HOST/healthz" > /dev/null 2>&1; then
  echo "::warning::https://$AVENDB_HOST still takes a classical key exchange: is Caddy's curves line live?"
else
  echo "classical key exchange refused ← as it should be"
fi
if FEED=$(pq -fsS --max-time 10 "https://$AVENDB_HOST/feed/posts"); then
  printf '%s\n' "${FEED:0:300} ← https://$AVENDB_HOST/feed/posts"
else
  echo "::warning::https://$AVENDB_HOST/feed/posts does not answer: the server before its feed, or Caddy's route?"
fi
PASS=$(head -c 24000 /dev/zero | tr '\0' A)
CODE=$(pq -s -o /dev/null -w '%{http_code}' --http1.1 --max-time 5 "https://$AVENDB_HOST/relay?token=$PASS" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: iroh-relay-v1' || true)
if [ "$CODE" != 101 ]; then
  echo "::error::https://$AVENDB_HOST/relay answers $CODE to a browser's pass, not 101: no browser can join (Caddy's max_header_size?)"; exit 1
fi
echo "101 ← its relay takes a browser's pass"
