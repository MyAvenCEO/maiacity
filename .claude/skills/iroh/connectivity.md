# Connectivity — a private endpoint with no n0 dependency

Names checked against the iroh 1.3.0 source. Re-check on every version bump.

## What the presets do (and why we never use N0)

| Preset | Sets | Use |
|---|---|---|
| `presets::Empty` | nothing; `bind()` fails without a crypto provider | only if you set everything yourself |
| `presets::Minimal` | crypto provider only (`ring`, or `aws-lc-rs`) — no relay, no lookup | **our base** |
| `presets::N0` | Minimal + `PkarrPublisher::n0_dns()` + `PkarrResolver::n0_dns()` + `DnsAddressLookup::n0_dns()` (all `iroh.link`) + `RelayMode::Default` (n0 relays) | **never** |
| `presets::N0DisableRelay` | N0 without relays | never (still publishes to n0 DNS) |

Careful: the docs site's own "use your own relay" snippet starts from `presets::N0`, which still publishes every
endpoint to n0's DNS server. Do not copy it.

`RelayMode`: `Disabled` · `Default` (n0 prod — never) · `Staging` (n0 staging — never) · `Custom(RelayMap)` (ours).
Never set `IROH_FORCE_STAGING_RELAYS`.

## Other outbound traffic to switch off or point at us

- **Net report** (probes to find the best relay and our public address) goes only to the *configured* relays — with
  our relay map it only talks to our relay. `NetReportConfig::minimal()` exists for fewer probes.
- **Portmapper** (UPnP / PCP / NAT-PMP to the local router): on by default. On the server: `.portmapper_config(PortmapperConfig::Disabled)`. On the Mac it can help hole punching; leave it on unless it causes prompts.
- **DNS resolver** falls back to public resolvers by default. We don't need DNS for lookup (MemoryLookup), only to
  resolve our relay's hostname — the system resolver is fine. To remove the fallback:
  `.dns_resolver(DnsResolver::builder().with_system_defaults().disable_fallback().build())` (**UNVERIFIED** end to end).

## The endpoint we build (sketch)

```rust
use iroh::{
    Endpoint, EndpointAddr, RelayConfig, RelayMap, RelayMode, SecretKey,
    address_lookup::MemoryLookup,
    endpoint::{presets, AfterHandshakeOutcome, Connection, EndpointHooks},
    protocol::Router,
};
use iroh_blobs::{store::fs::FsStore, BlobsProtocol, ALPN as BLOBS_ALPN};

// 1. identity — persisted (Mac: macOS Keychain; server: a 0600 file on the volume)
let sk = SecretKey::from_bytes(&load_32_bytes()?);

// 2. our relay only (pairs with iroh-relay `access.allowlist` / `access.shared_token`)
let relay_url: iroh::RelayUrl = "https://relay.maia.city".parse()?;
let relay_map: RelayMap = [RelayConfig::new(relay_url.clone(), Some(iroh_relay::RelayQuicConfig::new(7842)))]
    .into_iter().collect();            // RelayMap: FromIterator<RelayConfig>; or RelayMode::custom([url])

// 3. address lookup = a table we fill from Postgres (approved devices + the server's fixed address)
let lookup = MemoryLookup::new();
lookup.add_endpoint_info(EndpointAddr::new(server_id).with_relay_url(relay_url.clone()).with_ip_addr(server_sa));

// 4. allowlist hook (also fed from Postgres; see below)
let allow = Allow::new(approved_ids);

let ep = Endpoint::builder(presets::Minimal)
    .secret_key(sk)
    .relay_mode(RelayMode::Custom(relay_map))
    .address_lookup(lookup.clone())           // MemoryLookup implements AddressLookup → AddressLookupBuilder
    .hooks(allow.clone())
    // server only: fixed port + known public address, no portmapping
    // .bind_addr("0.0.0.0:7400")?.external_addr(server_sa).portmapper_config(PortmapperConfig::Disabled)
    .bind().await?;

let store = FsStore::load(data_dir).await?;
let router = Router::builder(ep.clone())
    .accept(BLOBS_ALPN, BlobsProtocol::new(&store, Some(events)))   // events: access control, see blobs.md
    .spawn();
// … on exit: router.shutdown().await
```

`RelayQuicConfig` lives in `iroh_relay` (add it as a direct dependency if it is not re-exported). `RelayConfig` and
`RelayMap` are re-exported from `iroh`. `RelayMap`'s `with_auth_token(..)` pairs with the relay's `shared_token`.

## Access control — who may connect

Three layers, all keyed by EndpointId, all fed from the same Postgres table of approved devices:

1. **Endpoint hook** (`EndpointHooks::after_handshake`) — runs for incoming *and* outgoing connections once the
   remote id is known; first `Reject` wins.

```rust
#[derive(Debug, Clone)]
struct Allow(std::sync::Arc<std::sync::RwLock<std::collections::HashSet<iroh::EndpointId>>>);

impl EndpointHooks for Allow {
    async fn after_handshake(&self, conn: &Connection) -> AfterHandshakeOutcome {
        if self.0.read().unwrap().contains(&conn.remote_id()) {
            AfterHandshakeOutcome::Accept
        } else {
            AfterHandshakeOutcome::Reject { error_code: 403u32.into(), reason: b"not paired".to_vec() }
        }
    }
}
```

   Rules: never store the `Endpoint` inside a hook (reference cycle); never keep a cloned `Connection` — use
   `conn.weak_handle()`. Revocation = remove the id from the set *and* close its live connections.

2. **Blobs provider events** — `BlobsProtocol::new(&store, Some(events))` with an `EventMask` that intercepts
   `connected`, `get`, `get_many` and `push` (`ConnectMode::Intercept`, `RequestMode::Intercept`). Push is disabled
   by default; we enable it only for paired devices with the `vault:sync` capability. → `blobs.md`

3. **The relay** — `access.allowlist = [ids]` (or `shared_token`, or `access.http` callback to our API) so strangers
   can't even use it as a relay. → `self-hosting.md`

`RouterBuilder::incoming_filter` runs before the handshake (only IP known) — use it for rate limits, not identity.

## Paths — direct vs relayed

- The server has a static public IP: give it a fixed UDP port (`bind_addr`) and `external_addr`, open that UDP port in
  the Hetzner firewall. The Mac then usually reaches it **directly**, relay only for the first packets or as backup.
- Mac ↔ Mac across two NATs: hole punching via our relay; falls back to relaying through it.
- Browsers: always relayed (no UDP in browsers). → `browser.md`
- Watch it: `conn.paths()` / `paths_stream()`; each path reports `is_ip()` / `is_relay()` / `is_selected()`. Log the
  selected path at the start of every big transfer — a transfer running over the relay is the first suspect when
  throughput is low.
- No relay at all is possible (`RelayMode::Disabled` + dial `EndpointAddr::new(id).with_ip_addr(..)`), but then there
  is no hole punching: only the directly reachable server can be dialled. We keep our relay.

## Ports (server)

| Port | Proto | For |
|---|---|---|
| our fixed iroh port (e.g. 7400) | UDP | the server endpoint (direct QUIC) |
| 443 | TCP | relay (HTTPS/WebSocket), and the HTTP gateway if on the same host behind Caddy |
| 80 | TCP | ACME http-01 for the relay's Let's Encrypt cert (if the relay terminates TLS itself) |
| 7842 | UDP | relay QAD (address discovery) — optional but helps hole punching |
| 9090 | TCP | relay metrics — **firewall it**, localhost only |

## What leaks where (privacy)

- Content: nowhere — end-to-end encrypted QUIC; the relay forwards ciphertext by EndpointId.
- Our relay sees: which EndpointIds talk, IPs, timing, volume. It is ours, so that stays with us.
- Nothing is published anywhere public: no pkarr, no DNS, no DHT — MemoryLookup only.
