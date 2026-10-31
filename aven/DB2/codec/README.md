# Codec: Values, their one encoding and their names

`aven-codec` is the Rust of `Aven.Core.Cbor` and `Aven.Core.Names` ([`core/spec`](../core/spec)): `Value`, `encode` and
`decode` in deterministic CBOR's strict profile (ARCHITECTURE.md rule 1, A2), nothing deeper than `MAX_DEPTH`, and
BLAKE3 names, Doc ids and type ids. It is a crate of its own so that what compiles only these, such as the runtimes'
frozen wasm modules, moves only when the codec does. [`aven-core`](../core) re-exports all of it, so code that imports
these from `aven_core` needn't change; the Lean stays one package, `Aven.Core`.

Held to `core/spec/vectors/cbor.json` and `names.json` by aven-core's tests. `no_std` with `alloc`, no `unsafe`, and it
builds for wasm32 with no imports.
