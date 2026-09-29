# Self-hosting — our relay, no n0 services

Everything is open source (MIT/Apache). n0 sells hosted relays (shared $19/mo, dedicated $199/mo per region, plus
egress), metrics and extended support — **we use none of it**. n0's free public relays and `dns.iroh.link` are
rate-limited, "dev and hobby use only", no SLA, latest major only — also not for us.

## Our setup (decided 2026-09-29)

No separate relay host and no new DNS: **the relay runs inside the `vault-server` process** (`iroh-relay` with feature
`server`, `iroh_relay::server::Server::spawn(ServerConfig)`), in the existing `docker-compose.prod.yml`, behind the
existing Caddy on `api.maia.city`. Caddy routes `/relay` (WebSocket upgrade), `/generate_204` and `/healthz` to the
relay's plain-HTTP port; the relay has no TLS of its own. The relay URL the nodes use is `https://api.maia.city`
(clients append `/relay` themselves — `RELAY_PATH` in `iroh-relay/src/http.rs`). Cost: no QAD, because QAD needs the
relay to own its TLS; acceptable, since the server has a static IP and the Macs reach it directly.

## iroh-relay (1.3.0)

Binary from GitHub releases, `cargo install iroh-relay`, or Docker `n0computer/iroh-relay`. Run
`iroh-relay --config-path config.toml` (`-c` for short). Full option list: the crate's
`src/main.rs` (the docs page is "community maintained").

```toml
# relay.maia.city
http_bind_addr = "[::]:80"               # ACME http-01 + captive-portal check (/generate_204)
enable_quic_addr_discovery = true        # QAD on UDP 7842 — default is false
enable_metrics = true                    # metrics on :9090 by default → firewall it
# access control — default is "everyone"! Never leave it.
access.allowlist = ["<mac endpoint id>", "<server endpoint id>"]
# alternatives: access.denylist, access.shared_token = ["…"], access.http.url = "https://api…/relay-access"

[tls]
https_bind_addr = "[::]:443"
hostname = "relay.maia.city"
cert_mode = "LetsEncrypt"                # or "Manual" (cert/key files) or "Reloading"
cert_dir = "/var/lib/iroh-relay/certs"
contact = "…"

# [limits.client.rx]                     # per-client rate limit; OFF by default — keep off for our own nodes
# bytes_per_second = 1_000_000
```

- **Access control is the must.** `access.http` (POST with `X-Iroh-Endpoint-Id`) is the cleanest for us: the relay
  asks our API, which checks the paired-devices table — revocation is instant, no config reload. `allowlist` is fine
  to start.
- Browser clients can't set WebSocket headers; with `shared_token` they send `?token=`.
- Stateless: restart freely; run a second one in another region later for redundancy.
- ~60k concurrent connections per relay — irrelevant at our size.
- Health: `GET /healthz`. Captive portal: `/generate_204`.
- Relayed traffic is server egress. With a static-IP server most Mac ↔ server traffic is direct, not relayed.

### TLS on our box

The API host already runs **Caddy** on 443 (`deploy/Caddyfile`). Two options:
1. **Relay behind Caddy** — Caddy terminates TLS for `relay.maia.city` and reverse-proxies (WebSocket upgrade) to the
   relay's plain HTTP port; relay runs without `[tls]`. Simplest cert story, **but QAD needs TLS on the relay itself**
   ("TLS is required for QUIC", `main.rs`), so this mode loses QAD — hole punching still works, a bit less well.
   (**UNVERIFIED** that the relay works cleanly behind a proxy — test.)
2. **Relay on its own IP/host** with `cert_mode = "LetsEncrypt"`.

Start with 1 on the existing server (Docker service in `docker-compose.prod.yml`); move to 2 if it misbehaves.

## iroh-dns-server (1.3.0) — we skip it

A pkarr relay + authoritative DNS (`/pkarr` PUT/GET, `/dns-query` DoH, UDP/TCP 53, Let's Encrypt, needs NS
delegation of a subdomain). It exists so endpoints can find each other by EndpointId alone.
We don't need it: we control every node, Postgres knows every EndpointId, and the server has a static address. Each
node's `MemoryLookup` is filled from the API. Add iroh-dns-server only if nodes ever need to find each other without
our API.

## Hetzner firewall (Pulumi, `infra/index.ts`)

Open: UDP `<iroh port>` (server endpoint), TCP 443 (already), TCP 80 (already, ACME), UDP 7842 (QAD).
Keep closed: 9090 (relay metrics), the server endpoint's metrics, anything else.
Infra changes deploy through CI only.
