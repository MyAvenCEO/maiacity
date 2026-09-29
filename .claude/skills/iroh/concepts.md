# iroh — the mental model

Read this once before touching iroh code. Names are iroh **1.3** (checked against the crate source).

## One picture

```
   Mac app                                                     Hetzner server
 ┌───────────────────────┐                                   ┌───────────────────────┐
 │ Endpoint              │   1. first packets via relay      │ Endpoint              │
 │  SecretKey (Ed25519)  │ ───────────► our relay ─────────► │  SecretKey (Ed25519)  │
 │  id = EndpointId      │                                   │  id = EndpointId      │
 │                       │   2. hole punching → direct path  │                       │
 │ Router                │ ◄═══════ QUIC (TLS 1.3) ════════► │ Router                │
 │  ALPN "/iroh-bytes/4" │        one connection, many       │  ALPN → our vault/1   │
 │   → BlobsProtocol     │        streams, both paths        │                       │
 │ FsStore (blobs.db +   │        (multipath; relay stays    │ S3 store (bao-tree)   │
 │   data/<hash>.data)   │         as backup path)           │                       │
 └───────────────────────┘                                   └───────────────────────┘
```

## The pieces

**Endpoint** — the one networking object per app. Binds UDP sockets (IPv4 + IPv6), holds the identity, dials
(`connect(addr, alpn)`) and accepts (`accept()`). Created with `Endpoint::builder(preset)…bind().await` or
`Endpoint::bind(preset)`. Useful: `id()`, `addr()`, `watch_addr()`, `online().await` (wait until the home relay is up),
`close().await`.

**SecretKey / EndpointId** — identity is an Ed25519 keypair. `EndpointId` is the public key (a `PublicKey`). There
is no certificate authority: the public key *is* the TLS identity, so **every connection is mutually authenticated —
you always know exactly which EndpointId is on the other end** (`conn.remote_id()`). If you don't persist the
`SecretKey` (`to_bytes()` / `from_bytes(&[u8; 32])`, `SecretKey::generate()`), every start is a new identity.

**EndpointAddr** — how to reach an endpoint: `{ id, addrs }`, where each addr is `TransportAddr::Ip(SocketAddr)`,
`TransportAddr::Relay(RelayUrl)` or `Custom`. Build with `EndpointAddr::new(id).with_relay_url(url).with_ip_addr(sa)`.
`connect` takes `impl Into<EndpointAddr>`, so a bare `EndpointId` works when address lookup can fill in the rest.
**Store EndpointIds in the database, not addresses** — addresses change.

**Relay** — a small stateless server (HTTP/1.1 over TLS upgraded to WebSocket; a revised Tailscale DERP) that does
two jobs: (1) introduce two endpoints so they can hole-punch, (2) forward their traffic when no direct path works
(roughly 1 connection in 10 on the public internet). Traffic stays end-to-end encrypted: the relay forwards by
EndpointId and **cannot read content**, but it does see who talks to whom, when, and how much. Each endpoint keeps a
WebSocket open to its **home relay** (the fastest one it measured). Relays also answer QUIC address discovery (QAD,
UDP 7842) so an endpoint learns its public address. → `self-hosting.md`

**Hole punching / paths** — after first contact, both sides try QUIC NAT traversal toward a direct path. iroh 1.x
runs **multipath** (on the `noq` QUIC stack): one connection holds the direct path(s) *and* the relay path; the
default selector prefers IPv6, then IPv4, keeps the relay as backup. Inspect with `conn.paths()` /
`paths_stream()` — each path says `is_ip()` / `is_relay()` / `is_selected()`. If one side is directly reachable at a
known IP (our Hetzner server), no relay is needed at all.

**Address lookup** (was "discovery") — how an `EndpointId` becomes an `EndpointAddr`. Pluggable, several at once:
`MemoryLookup` (a table we fill ourselves), `PkarrPublisher`/`PkarrResolver` (signed records over HTTP to a pkarr
relay), `DnsAddressLookup` (TXT at `_iroh.<z32-id>.<origin>`), plus separate crates for mDNS and the Mainline DHT.
By default only the relay URL is published, not IPs. We use `MemoryLookup` fed from Postgres. → `connectivity.md`

**ALPN** — every protocol has a byte-string name, negotiated in the TLS handshake. Dialling requires one; the
acceptor must list it. iroh-blobs' is `iroh_blobs::ALPN`. Our own protocols get our own ALPNs (e.g.
`b"maiacity/vault/1"`). An empty ALPN is an error since 1.0.3.

**Router / ProtocolHandler** — `Router::builder(ep).accept(ALPN, handler).spawn()` runs the accept loop and hands
each connection to the handler registered for its ALPN (it also sets the endpoint's ALPN list). A `ProtocolHandler`
implements `accept(Connection)` (own task per connection), optionally `on_accepting` (early reject / 0-RTT) and
`shutdown()`. `RouterBuilder::incoming_filter` runs before the handshake (only IP known — for DoS, not identity).
Keep the `Router` alive; call `router.shutdown().await` on exit (it also shuts protocol stores down cleanly).

**Connection and streams** — a QUIC connection: `open_bi` / `open_uni` / `accept_bi` / `accept_uni`, datagrams,
`stats()`. Streams are cheap and independent (no head-of-line blocking between them). Streams are lazy: the receiver
only sees a new stream after the sender wrote to it. Flow control defaults: per-stream receive window ≈ 1.25 MB
("100 MBit/s at 100 ms"), connection unlimited — raise it for fast long links via `QuicTransportConfig`.
→ `gotchas.md`

**Hooks** — `EndpointHooks` on the builder: `before_connect(&EndpointAddr, alpn)` (outgoing) and
`after_handshake(&Connection)` (both directions, remote id known). The place for an allowlist. → `connectivity.md`

**Tickets** — optional copy-paste strings (`endpoint…`, `blob…`, `doc…`): postcard + base32 packing an
`EndpointAddr` with a hash or doc id. They contain IPs and go stale. We have Postgres as coordination, so **we store
EndpointIds and hashes, not tickets**; tickets are only handy for debugging with `sendme`.

## The protocols (layer above the Endpoint)

| Protocol | Crate | One line |
|---|---|---|
| Blobs | `iroh-blobs` | BLAKE3-named blobs, verified streaming, ranges, resume, a persistent store. **Our core.** → `blobs.md` |
| Docs | `iroh-docs` | multi-writer key→hash replicas, synced by set reconciliation. → `protocols.md` |
| Gossip | `iroh-gossip` | topic broadcast (HyParView/PlumTree). → `protocols.md` |
| RPC | `irpc`, `irpc-iroh` | typed RPC over iroh streams. |
| Your own | — | any byte protocol behind your own ALPN. |

## IPFS → iroh glossary

| IPFS | iroh | Note |
|---|---|---|
| PeerID | EndpointId | Ed25519 public key |
| CID (sha256, UnixFS DAG) | `Hash` (BLAKE3 of the whole file) | 64 hex chars; plain BLAKE3 |
| Block (256 KiB) | chunk group (16 KiB) inside one blob | verification granularity, not a transfer unit |
| Bitswap | iroh-blobs get/push | one verified stream per request, not per-block wants |
| Pin | Tag | named roots; GC keeps everything tagged |
| DHT / content routing | none | you ask a peer you know; content discovery is your job |
| swarm.key private network | allowlist by EndpointId (hooks + relay access) | identity-based, not a shared secret |
| IPFS Cluster pinset | our Postgres index (or iroh-docs) | see `maiacity.md` |
| Gateway | our HTTP gateway (axum + `BlobReader`) | see `browser.md` |
