# Browsers — iroh in WASM, and why web clients use our HTTP gateway

## iroh in the browser (what exists)

- `iroh = { version = "1", default-features = false, features = ["tls-ring"] }`, `getrandom` with `wasm_js`,
  target `wasm32-unknown-unknown`, wasm-bindgen. **No npm package** — you write your own wrapper crate.
- **Relay-only.** Browsers can't send UDP → every browser connection runs through a relay (still end-to-end
  encrypted). WebTransport/WebRTC are only mentioned as future work.
- A browser endpoint can also *accept* (n0's `browser-echo` runs a `Router` in the page).
- Compiled out: `DnsAddressLookup`, custom `dns_resolver`. Available: `PkarrResolver`, `MemoryLookup`.
- iroh-blobs in the browser (`iroh-examples/browser-blobs`): **memory store only, no persistence.**
- iroh-gossip builds for WASM.
- Bundle size: undocumented (examples use `opt-level="z"`, LTO, `panic=abort`) — **UNVERIFIED**.

Conclusion: a browser iroh node gains nothing over HTTP to our server (its traffic goes through our relay on the same
server anyway), costs a big WASM bundle, and can't keep data. **Web clients speak HTTP to the gateway.**
Revisit only for browser ↔ browser features.

## The HTTP gateway (ours, on the server node)

An axum service inside the server node process (it owns the `FsStore`), behind Caddy at e.g. `vault.maia.city`.

```
GET  /blob/<hex>            → bytes; supports Range (206 + Content-Range + exact Content-Length), ETag = hex
HEAD /blob/<hex>            → size, type
POST /upload                → resumable upload (chunked); server hashes while writing, adds with ImportMode::Copy,
                              registers in Postgres; the result is the hash
```

- **Serving:** `store.blobs().reader(hash)` → `AsyncRead + AsyncSeek`; seek to the range start, stream the length.
  Check `status(hash)` first — a partial blob would error mid-stream.
- **Content-Type** comes from Postgres (mime), not from the bytes.
- **Caching:** content never changes for a hash → `Cache-Control: public, max-age=31536000, immutable` for public
  blobs; `private` for the rest.
- **Auth:** `public: true` → no login. Everything else → the existing session cookie or API key, checked against the
  capability system (`media:admin`, later finer). Never put secrets in URLs; for `<video src>` of private media use a
  short-lived signed URL minted by the API.
- **Verification on the way out:** the store's local reader trusts its own data (it was verified on import). Every copy is checked end to end when it is made; no scrub or self-repair for now.
- **Video:** Range support is enough for `<video>` seeking on MP4/MOV. Adaptive streaming (HLS) would be our own
  ffmpeg job producing segment blobs + a playlist blob — later, only if needed.
- **Uploads from the web:** hash in the browser only for small files (noble-hashes `blake3` is pure JS and slow for
  GBs); for big files the server computes the hash while receiving. The hash the server computes is the truth.

References to crib from: `iroh-examples/iroh-gateway` (Range handling in `src/ranges.rs`) and
`iroh-content-discovery/iroh-local-gateway` (206, exact Content-Length, per-chunk verification).

Bunny is dropped (2026-09-29): this gateway serves public files too.
