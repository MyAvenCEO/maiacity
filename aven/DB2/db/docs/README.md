# aven-db-docs

This folder is avenDOCS, avenDB's docs layer: the Rust crate `aven-db-docs`, with Loro 1.17.1 pinned exactly, and its
fuzz targets. Its Lean model is `Aven.DB.Docs`, in [`db/spec/Aven/DB/Docs`](../spec/Aven/DB/Docs), with its vectors in
[`db/spec/vectors`](../spec/vectors).

Its architecture: [avenDOCS](../../brain/docs/README.md)

## Build and test

From `aven/DB2`, in the box:

| Command | What |
|---|---|
| `bun run box cargo test -p aven-db-docs` | the crate's tests, against the Lean's vectors |
| `bun run box sh sandbox/vectors.sh --check` | the Lean built, its vectors written elsewhere and compared with what's committed |
| `bun run box sh sandbox/fuzz.sh` | every fuzz target, 600 s each, on the image's dated nightly |
| `bun run box sh sandbox/fuzz.sh envelope 60` | one target, for 60 s |

`aven-db-docs` refuses to compile natively without `panic = "unwind"`.

## Files

| Path | What |
|---|---|
| `src/lib.rs` | the crate's exports, and the `panic = "unwind"` guard |
| `src/genesis.rs` | `Genesis` (`Aven.DB.Docs.Genesis`, `genesis.json`) |
| `src/body.rs` | `Body`, `Call`, `Version` (`Aven.DB.Docs.Body`, `bodies.json`) |
| `src/writer.rs` | `writer` (`Aven.DB.Docs.Writers`, `writers.json`) |
| `src/opids.rs` | rule 7: `ops_agree`, `loro_agrees`, `carried_deps` (`Aven.DB.Docs.OpIds`, `loro.json`) |
| `src/doc.rs` | `Doc`: open, commit (`prepare`, `finish`), import (`import_page`, `import_sealed_page`), `Head`, `HeldPage`, `Snapshot`, `Feed`, `Authorize`, `mark_unfit` |
| `src/fit.rs` | fit and `RecordChange` (`Aven.DB.Docs.Fit`, `Changes`, `fit.json`) |
| `src/schema.rs` | the built-in types' names and step 1's toy schema language |
| `src/builtins.rs` | `BuiltinFit`, `DocsBuiltins`, `Either` (`Aven.DB.Docs.Builtins`, `builtins.json`) |
| `src/segment.rs` | `Segment`, `Closer`, `Closed` (`Aven.DB.Docs.Segment`, `segments.json`) |
| `src/seal.rs` | the one seal (`Aven.ID.Seal`, id's `seals.json`) |
| `src/limits.rs` | `Limits` (`Aven.DB.Docs.Limits`) |
| `src/device.rs` | `Device`: a writer's Ed25519 and hybrid keys |
| `src/value.rs` | a field's value between Loro and the codec |
| `tests/formats.rs` | `genesis.json`, `bodies.json`, `segments.json`, `heads.json`, `loro.json` and id's `seals.json`, byte for byte |
| `tests/vectors.rs` | `writers.json`, `envelopes.json`, `logs.json`, `counts.json` and `fit.json`, byte for byte |
| `tests/doc.rs` | commit, import and the verdicts on real Loro |
| `tests/properties.rs` | property tests over random histories |
| `tests/segments.rs` | segments, seals and sealed pages |
| `tests/catchup.rs` | 500 envelopes of one Doc in one page, measured |
| `tests/hostile.rs` | the fuzz targets' inputs on stable, and bit-flipped real updates |
| `tests/aead.rs` | XChaCha20-Poly1305's known answers, through the seal's calls |
| `fuzz/` | `aven-db-docs-fuzz`, a workspace of its own: the targets `envelope`, `changes` and `segment` |
