# Gotchas, maturity, speed — read before trusting anything

## How production-ready is iroh? (2026-09-29)

| Part | Status | Meaning for us |
|---|---|---|
| `iroh` core (endpoint, QUIC, hole punching, relays) | **1.x, stable**: semver on API and wire; 1 year support per major, 3 months per minor; wire-compatible with the previous major. Features `unstable-custom-transports` and `unstable-net-report` are outside semver. | Safe to build on. |
| `iroh-relay` | 1.x, stable. Self-hosting docs are "community maintained". | Fine; read `main.rs` for options. |
| `iroh-blobs` | **0.103, "not yet considered production quality"** (its README; it points to 0.35 for production, which predates iroh 1.x). Breaking release roughly monthly. | The part we lean on most is the least mature. Mitigate (below). |
| `iroh-docs`, `iroh-gossip` | 0.101, 0.x. | Not in our critical path. |

**How we carry the iroh-blobs risk:**
1. Pin exact versions (`=0.103.0`) and upgrade on purpose, one bump at a time, with the benchmark and restore tests.
2. Wrap it: all blob calls go through one small module of ours (`vault::store`), so an API break touches one file.
3. Backups never depend on it: plain `<hex>` files in Object Storage (Storage Box mirror later), restorable with `b3sum`.
4. Postgres is the index, so a broken store can be rebuilt from backups.
5. Every copy is hash-checked when it is made (ingest, iroh transfers, backup uploads). A periodic scrub with
   self-repair comes later (not now — 2026-09-29).

## Speed — what to expect

**Local ingest (disk → store on the same Mac): gigabytes per second, not network speed.**
- Same APFS volume (e.g. internal SSD → store on the internal SSD): `ImportMode::Copy` reflinks → the copy is
  near-instant; the cost is **reading the file once to hash it**. BLAKE3 hashes at GB/s (SIMD, and multi-threaded in the
  `blake3` crate); whether iroh-blobs' import uses more than one core is **UNVERIFIED** — measure.
- External SSD → internal store: a real copy, bounded by the slower disk: roughly **~1 GB/s** on USB 3.2 Gen 2
  (10 Gbit/s), **~2.5–3 GB/s** on Thunderbolt 3/4 NVMe; internal Apple SSDs read/write several GB/s.
- So ~1 GB/s ingest from an external SSD is the right expectation; from internal to internal, faster.

**Network sync (Mac ↔ Hetzner): bounded by the internet uplink, not the disks.**
- 50 Mbit/s upload ≈ 6 MB/s ≈ 21 GB/hour. 1 Gbit/s fibre ≈ 110 MB/s at best. 1 GB/s would need 10 Gbit/s.
- Reported iroh numbers: issue iroh#4286 measured a single stream at ~40–50 MB/s on a 110 MB/s LAN between two
  Macs with BBR, and far lower with CUBIC. No fix posted yet. n0's "8 Gbps" sendme claim has no published benchmark.
- Defaults are tuned for ~100 Mbit/s at 100 ms: per-stream receive window ≈ 1.25 MB. For fast links raise
  `QuicTransportConfig::builder().stream_receive_window(..).send_window(..)` via `.transport_config(..)` — and test,
  the docs warn it can affect connectivity.
- Always log `conn.paths()` — a relayed transfer is slower and costs server egress.

**Benchmarks to run before trusting any number**
1. Ingest: Day 01 (1.08 GB) and one 20+ GB file into the Mac store — time and CPU; check APFS clone (disk usage
   unchanged).
2. Mac ↔ Mac on the LAN: `iroh/examples/transfer.rs` (n0's own harness, reports path stats) and `sendme`.
3. Mac → Hetzner: same, direct path confirmed; compare against a plain `scp`/`rclone` of the same file to see if iroh
   is the bottleneck or the uplink is.

## Pitfalls

- **`presets::N0` anywhere = data about us goes to n0.** Grep for `N0`, `RelayMode::Default`, `n0_dns`, `iroh.link`
  in review.
- **Relay default access is `everyone`.** Always set `access.*`.
- **Relay metrics on :9090 are on by default.** Firewall.
- **QAD needs TLS on the relay itself** — a relay behind Caddy loses QAD.
- **Unpersisted `SecretKey` = new identity every start** = unpaired device.
- **`TryReference` + a changed source file** → local reads return wrong bytes unverified. Use `Copy`.
- **Temp tags vanish on exit.** Anything that must stay needs a named tag.
- **GC off by default; when on, feed it from Postgres and abort on error.**
- **Deletion is only via GC** — there is no "delete this blob now" call.
- **iroh-docs' GC protection pins every hash the catalog names** — the files too (`blobs/<hash>`). A store that keeps
  only a bounded cache of files (the server, `vault-server/src/cold.rs`) must take them out of the docs' set.
- **iroh-blobs 0.103 applies `EventMask.get` to every request kind** (get, get_many, push, observe) — so push is *not*
  disabled with the default sender, and with `get: Intercept` the handler must answer push and observe too (the
  server refuses push, allows observe).
- **Unclean shutdown can lose the last seconds of writes** — always `router.shutdown().await`.
- **Re-importing existing blobs can leak memory** (iroh-blobs #266) — check `has(hash)` first on bulk ingest.
- **Don't hold `Endpoint` in a hook; don't clone `Connection` out of a hook** — use `weak_handle()`.
- **Docs lag the code.** Old names: discovery → address lookup; NodeId/NodeAddr → EndpointId/EndpointAddr;
  `StaticProvider` → `MemoryLookup`; QUIC is `noq` now, not quinn. When in doubt, read the source in
  `~/.cargo/registry/src/*/iroh-*`.

## Sources

- https://docs.rs/iroh/latest/iroh/ · https://docs.rs/iroh-blobs/latest/iroh_blobs/
- https://docs.iroh.computer (full text: `/llms-full.txt`) — quickstart, concepts, relays, address lookup, WASM,
  release policy, iroh services pricing
- https://github.com/n0-computer/iroh (CHANGELOG, `iroh-relay/src/main.rs`, `examples/transfer.rs`)
- https://github.com/n0-computer/iroh-blobs (README, DESIGN.md, CHANGELOG) · issues #84, #266 · iroh#4286
- https://github.com/n0-computer/iroh-examples (iroh-gateway, browser-blobs, browser-echo, tauri-todos)
- https://github.com/n0-computer/sendme · https://www.iroh.computer/blog/v1
