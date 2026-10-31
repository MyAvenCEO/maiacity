# codec: avenCORE's `aven-codec`

`aven-codec` is avenCORE's codec in Rust, the Rust of `Aven.Core.Cbor` and `Aven.Core.Names`
([`core/spec`](../core/spec)): `Value`, `encode` and `decode` in deterministic CBOR's strict profile, nothing deeper
than `MAX_DEPTH`, and BLAKE3 names, Doc ids and type ids. [`aven-core`](../core) re-exports all of it; the Lean stays
one package, `Aven.Core`.

Its architecture: [avenCORE](../brain/core/README.md#values)

## Build and test

Held to `core/spec/vectors/cbor.json` and `names.json` by aven-core's tests (`cargo test -p aven-core`). `no_std` with
`alloc`, no `unsafe`, and it builds for wasm32 with no imports.

## Files

| File | What |
|---|---|
| `src/lib.rs` | the crate's exports: `Value`, `encode`, `decode`, `MAX_DEPTH`, `Hash`, `DocId`, `TypeId`, `blake3`, `name_of` |
| `src/cbor.rs` | a Value and the one codec (`Aven.Core.Cbor`) |
| `src/names.rs` | hashes, Doc ids and type ids, and a Value's name (`Aven.Core.Names`) |
