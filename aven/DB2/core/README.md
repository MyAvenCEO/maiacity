# core: avenCORE's Lean and `aven-core`

This folder is avenCORE: the primitives every part of avenDB builds on (Values and their names, signed things,
envelopes, logs, the past, splits, counting, limits, ops, calls, targets, steps and built-in type names). Its Lean is
one package, `Aven.Core` in [`spec`](spec), that every other package's Lean requires by path. Its Rust is `aven-core`,
a member of aven/DB2's workspace, which re-exports the codec and names from [`aven-codec`](../codec). `no_std`, no
`unsafe`; it builds for wasm32. The runtimes in aven/runtimes take only its codec, `aven-codec`, by path.

Its architecture: [avenCORE](../brain/core/README.md)

## Build and test

**Run it in the box,** from `aven/DB2`: `bun run box sh -c 'cd core/spec && lake build'`; `bun run box sh
sandbox/vectors.sh` writes the vectors in [`spec/vectors`](spec/vectors), and `--check` compares them with what's
committed. Lean 4.35.0, pinned exactly; no `sorry`, no axioms.

`cargo test -p aven-core` holds the crate to the vectors byte for byte and to the running model. `tests/model.rs` asks
the running model, `aven-core-model` (`lake build aven-core-model` in `spec`, or `AVEN_CORE_MODEL` set to a built one).

## The Lean

| Module | What |
|---|---|
| `Bytes` | bytes, numbers big-endian, the bytewise order |
| `Cbor`, `CborLaws` | a Value and the one codec: deterministic CBOR in A2's strict profile |
| `Text` | a `String`'s UTF-8 as a Value's text |
| `Blake3` | BLAKE3, in core Lean |
| `Json` | the readable form of a Value, which every spec's vectors import |
| `ValueEq` | `DecidableEq`, `BEq` and `LawfulBEq` for Values, by structural recursion |
| `Names` | hashes, Doc ids, type ids (`<type Doc>/<schema hash>`) |
| `Signed` | a label plus a Value, signed over exactly its encoding, and named by the hash of those bytes, its signatures beside it (A30): a set, one per signer, sorted by signer, that only grows (`addSig`) |
| `Hybrid` | hybrid signatures, Ed25519 with ML-DSA-65, as one `Verify` (avenID's concept) |
| `Log` | envelopes, named by what their signers sign (A30), placed by their log's writer's signature, the others approvals (`Envelope.placed`, with who writes a log a parameter, `Writes`); logs, splits, a whole past (`Closed`), the one counting rule (`Counts nm fit authorized`, A45), versions |
| `Past` | an envelope's past among those a reader holds, decided |
| `Limits` | every input's limit (rule 10): 1 MiB an envelope or signed thing, 256 deps, 256 bytes a branch or label, 16 signatures, 4 KiB a signer, 16 KiB a signature; what a reader accepts from bytes (`Envelope.accept`, `Signed.accept`) |
| `Verdicts` | `Split`, `Closed`, `Discounted`, `Counts` and `Version.holds`, decided for what a reader holds |
| `Model` | what the running model `aven-core-model` and the vectors answer: worlds of envelopes, coverage of targets, bounds, and bytes to accept |
| `Target`, `TargetCbor` | the one target grammar (A8) in three forms (A32): a Doc with what it spawned or lists, or neither; a vault's Docs; a vault's Docs of one root type; its CBOR; a lowered step |
| `Op` | ops by hash (A32): `core/1`'s read, put, patch, remove, edit, tell, keep and share with fixed ids, any plugin's op id (`OpId.ofPlugin`), `core/1`'s write params, a call's op and parameters, bounds by enumeration; built-in types (`builtinType`, A45) and the type of types (A39) |

Beside them, `Model.lean` is the running model's executable and `Vectors.lean` writes [`spec/vectors`](spec/vectors).

## The Rust

| File | What |
|---|---|
| `src/lib.rs` | the crate's exports, `aven-codec`'s among them |
| `src/signed.rs` | `signing_bytes`, `Sig`, `add_sig`, `Signed`, `Verify` |
| `src/log.rs` | `Envelope`, `Writes`, `split`, `Held`, `is_log`, `Log` |
| `src/past.rs` | `Parents`, `past`, `in_past` |
| `src/op.rs` | `OpId`, `op_id`, `CoreOp`, `TYPE_PARAM`, `FIELDS_PARAM`, `Bound`, `Call`, `builtin_type`, `type_of_types` |
| `src/target.rs` | `Facts`, `Reach`, `Target`, `StepVerb`, `Step` |
| `src/limits.rs` | Lean's `Aven.Core.Limits`, the same numbers |
| `tests/vectors.rs` | the codec and names against `cbor.json` and `names.json` |
| `tests/log.rs` | signed things, envelopes, logs, the past and the limits against `envelopes.json`, `logs.json`, `signed.json`, `limits.json`, `past.json` and `counts.json` |
| `tests/ops.rs` | ops, bounds, calls and targets against `ops.json`, `targets.json` and `target-bytes.json` |
| `tests/model.rs` | the crate against the running model on random inputs |
