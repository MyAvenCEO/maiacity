# Core: what every part of avenDB shares

`Aven.Core` is the Lean model of the primitives every part uses ([`ARCHITECTURE.md`](../ARCHITECTURE.md), "The
primitives everything shares" and rules 1 to 3). It is one Lean package, in [`spec`](spec), that `Aven.DB`, `Aven.ID`,
`Aven.Actor` and `Aven.Runtime` require by path, so each defines these once and never again (the architect, for Samuel,
30 Oct 2026). A definition that only one part uses stays in that part's model.

| Module | What | What it proves |
|---|---|---|
| `Bytes` | bytes, numbers big-endian, the bytewise order | reading back what was written, in every width |
| `Cbor`, `CborLaws` | a Value and the one codec: deterministic CBOR in A2's strict profile | `decode_encode`, `encode_decode` (bytes that don't encode back to themselves are refused), `encode_inj`; `decodeAll_deep`: nothing nests deeper than 512 |
| `Text` | a `String`'s UTF-8 as a Value's text | `utf8_text`: Lean's strings are valid UTF-8 by the codec's table; `fromUTF8_text`, `text_inj` |
| `Blake3` | BLAKE3, in core Lean | the specification's known answers |
| `Json` | the readable form of a Value, which every spec's vectors import | — |
| `ValueEq` | `DecidableEq`, `BEq` and `LawfulBEq` for Values, by structural recursion | `Value.beq_iff`: the equality is lawful |
| `Names` | hashes, Doc ids, type ids (`<type Doc>/<schema hash>`) | names of allowed Values don't collide under an injective hash |
| `Signed` | a label plus a Value, signed over exactly its encoding, and named by the hash of those bytes, its signatures beside it (A30) | a signing input names its label and body; signing again keeps the name (`Signed.name_resign`); one name is one label and body (`Signed.name_inj`) |
| `Log` | envelopes, named by what their writer signs (A30); logs, splits, versions | one name is one envelope but for its signature (`Envelope.name_inj`), and an envelope signed twice is no split (`resign_no_split`); a chain holds no split; two readers' chains agree unless split; splits are final; what counts builds on what counts; versions only grow |
| `Past` | an envelope's past among those a reader holds, decided | `reaches_iff`: `Reaches` is the envelope itself and what is `Before` it; `found_iff`, `inPast_iff`: the rounds find exactly that |
| `Limits` | every input's limit (rule 10): 1 MiB an envelope or signed thing, 256 deps, 256 bytes a branch or label, 4 KiB a signer, 16 KiB a signature; what a reader accepts from bytes (`Envelope.accept`, `Signed.accept`) | what is accepted is within every limit (`accept_limits`) and encodes back to exactly its bytes (`accept_encode`) |
| `Verdicts` | `Split`, `Discounted`, `Counts` and `Version.holds`, decided for what a reader holds | each decision is its proposition (`splitB_iff`, `discountedB_iff`, `countsB_iff`, `holdsB_iff`) |
| `Model` | what the running model `aven-core-model` and the vectors answer: worlds of envelopes, coverage of targets, bounds, and bytes to accept | — |
| `Target`, `TargetCbor` | the one target grammar (A8) in three forms (A32): a Doc with what it spawned or lists, or neither; a vault's Docs; a vault's Docs of one root type; its CBOR; a lowered step | a narrower target covers only what the wider one does (`Target.le_sound`); `Target.coversB` decides coverage; a target reads back from its CBOR, which is canonical |
| `Op` | ops by hash (A32): `core/1`'s read, put, patch, remove, edit, tell, keep and share with fixed ids, a call's op and parameters, bounds by enumeration; the type of types (A39) | a narrower bound allows nothing a wider one doesn't (`Bound.within_allows`); the type of types is its own type (`typeOfTypes_typed`) |

The hash and signatures are parameters: a theorem that needs the hash collision-free assumes it (`Injective`), and
signatures are taken as sound, as in every Aven model. `Blake3` is the hash the examples and vectors use.

**In Rust: `aven-core`** (this folder, a member of aven/DB2's workspace). `no_std`, no `unsafe`; it builds for
wasm32, so the runtimes in aven/runtimes use it by path.

- **The codec and names:** `Value`, `encode` and `decode` in the strict profile, held to `spec/vectors/cbor.json` both
  ways (every encoding written and read back, every refusal refused), and BLAKE3 names, Doc ids and type ids, held to
  `names.json`. Nothing deeper than 512 is read (`MAX_DEPTH`, Lean's `maxDepth`, a scalar counting as 1), so a
  hostile input can't exhaust the stack (ARCHITECTURE rule 10); `cbor.json` holds it at 512 and 513 deep.
- **Signed things** (`signed.rs`): `signing_bytes`, `Signed` with its `value`, `name` and `valid`. A thing's name is
  the hash of `[label, body]`, never of its signature (A30). Verification is the `Verify` trait, a parameter as in the
  Lean: aven-core holds no keys, and avenID implements the schemes.
- **Envelopes, logs, splits, versions** (`log.rs`): `Envelope` with `unsigned`, `value`, `signing` (under
  `avenDB envelope 1`), `name` and `valid`, read back by `Envelope::decode`; `split`; `Held`, what a reader holds, which
  decides `discounted`, `counts` and a version's `holds`; `is_chain`, and `Log`, a writer's log that grows only at its
  head and refuses a split. Held to `envelopes.json` and `logs.json` byte for byte.
- **The past** (`past.rs`): `Parents`, and `past` and `in_past` for anything named that names its parents.
- **Ops** (`op.rs`, A32): `OpId`, `CoreOp` (`core/1`'s eight ops, their stored forms, fixed ids and whether they
  write), `Bound` (`allows`, `within`, `of_value`), `Call` (`param`, `value`, `of_value`), `type_of_types`. Held to
  `ops.json`.
- **Targets** (`target.rs`, A8): `Facts`, `Reach`, `Target` (`covers` with who governs whom, which actor spawned which
  and what a collection lists as parameters; `le`; its CBOR, a Doc or type id exactly 32 bytes), `StepVerb`, `Step`.
  Held to `targets.json` and `target-bytes.json`.
- **Limits** (`limits.rs`, rule 10): Lean's `Aven.Core.Limits`, the same numbers, held to `limits.json`, which has
  an envelope and a signed thing exactly at each limit and one past it.

`tests/log.rs` holds the crate to `envelopes.json`, `logs.json`, `signed.json`, `limits.json`, `past.json` and
`counts.json` byte for byte, with round trips of every encoding and a writer's log. `tests/model.rs` asks the running
model, `aven-core-model` (`lake build aven-core-model` in `spec`, or `AVEN_CORE_MODEL` set to a built one), on random
worlds of envelopes, random targets, facts and bounds, and random bytes: names, the past, splits, discounting,
counting, versions, coverage, narrowing, bounds and what a reader accepts must all be its answers, and `split_final`, `counts_past` and `Version.holds_mono` must hold of the crate.

**Run it in the box,** from `aven/DB2`: `bun run box sh -c 'cd core/spec && lake build'`; `bun run box sh
sandbox/vectors.sh` writes the vectors in [`spec/vectors`](spec/vectors), and `--check` compares them with what's
committed. Lean 4.35.0, pinned exactly; no `sorry`, no axioms.
