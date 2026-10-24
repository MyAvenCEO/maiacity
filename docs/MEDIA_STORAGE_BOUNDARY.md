# Media storage boundary (A03)

## Current ownership

The original audit described an older checkout. On current main, the legacy desktop catalog, its startup/sync and its Rust storage crates have already been retired (#1112). New originals, metadata, proxies, transcripts, analyses and deliveries belong to avenDB file/task entries. The studio's `MediaItem` is a presentation projection of those records, not another catalog to write to.

Do not restore a fallback to the retired catalog. A legacy film reference must be imported and resolved to its avenDB file before native playback or rendering. A valid reference identifies bytes; it does not grant access. The device still checks whether it can open them.

## Reference contract

- `src/lib/media/ref.js` is the page's typed boundary, independent of auth and studio. It distinguishes avenDB files, public hash aliases and external HTTP(S) URLs. Unrecognized values are not media references.
- Private references retain their existing wire format: `aven:<root>:<sealed-size>:<plain-length>[:<percent-encoded-media>]`. Four-field references remain readable. Roots are 64 lowercase hexadecimal characters. Sizes are nonnegative decimal safe integers; sealed size cannot be smaller than plain length. Unknown lengths are not silently replaced by zero. Empty files remain supported.
- `vault/app/src/media_ref.rs` implements the same private-file contract. Playback, colour/LUT readers, rendering and the `aven://` handler use this parser. Malformed encodings, extra fields, unsafe numbers and control characters fail before storage access. Both runtimes exercise `tests/fixtures/media-refs.tsv`.
- Native readers enter through `aven::source_of_ref` (or `source_on` for a dedicated runtime), producing the existing `vault_media::Source`/`ByteSource`. Storage access stays in avenDB; media processing does not choose a backend.
- `aven://localhost/<root>?size=…&len=…&media=…` is a private, ranged device transport. Its existing origin restrictions, passive-content allowlist and bounded Range handling remain in force.

## Public compatibility is a separate contract

`src/lib/media/url.ts` resolves public plaintext-hash aliases to `https://api.maia.city/vault/files/<hash>[.<extension>]`. These hashes are not avenDB sealed roots. `deploy/Caddyfile` already forwards this stable public route to avenDB's `/feed/media/…`, including the existing Range/CORS handling. Keep the URL, manifest and publication alias mapping intact. Never manufacture a private file reference from a public hash or publish a private reference through this gateway.

External URLs and static paths retain their existing `asset()` pass-through behavior. The public adapter cannot be used to read private avenDB files.

## Retirement acceptance — not established by code tests alone

This change does not delete bytes, catalogs, backups, buckets, API tables or public aliases. Source inspection and contract tests cannot prove historical migration completeness. Before removing any remaining archive or service, retain an inventory and prove:

1. Every original and derived proxy has readable bytes, matching plaintext hashes and lengths, with original/proxy relationships preserved.
2. Transcripts and analyses include their spilled JSON files, not only task metadata or an old timeline snapshot.
3. Cuts, shots, LUTs, graded stills and published deliveries resolve every reference, including archived cuts and every shape/codec deliverable.
4. Every published manifest URL still returns the expected bytes through the public alias, with full, bounded and suffix Range requests tested.
5. A clean device can recover keys, metadata and bytes from supported backups/peers with retired services unavailable; render and playback must work there.

Record the inventory, verification results, unavailable items and clean-device evidence before a destructive retirement. The shared reference tests and macOS compilation establish the code boundary, not this operational recovery gate.
