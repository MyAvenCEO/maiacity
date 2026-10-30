# Core: what every part of avenDB shares

`Aven.Core` is the Lean model of the primitives every part uses ([`ARCHITECTURE.md`](../ARCHITECTURE.md), "The
primitives everything shares" and rules 1 to 3). It is one Lean package, in [`spec`](spec), that `Aven.DB`, `Aven.ID`,
`Aven.Actor` and `Aven.Runtime` require by path, so each defines these once and never again (the architect, for Samuel,
30 Oct 2026). A definition that only one part uses stays in that part's model.

| Module | What | What it proves |
|---|---|---|
| `Bytes` | bytes, numbers big-endian, the bytewise order | reading back what was written, in every width |
| `Cbor`, `CborLaws` | a Value and the one codec: deterministic CBOR in A2's strict profile | `decode_encode`, `encode_decode` (bytes that don't encode back to themselves are refused), `encode_inj` |
| `Blake3` | BLAKE3, in core Lean | the specification's known answers |
| `Json` | the readable form of a Value, which every spec's vectors import | — |
| `ValueEq` | `DecidableEq`, `BEq` and `LawfulBEq` for Values, by structural recursion | `Value.beq_iff`: the equality is lawful |
| `Names` | hashes, Doc ids, type ids (`<type Doc>/<schema hash>`) | names of allowed Values don't collide under an injective hash |
| `Signed` | a label plus a Value, signed over exactly its encoding | a signing input names its label and body |
| `Log` | envelopes, logs, splits, versions | a chain holds no split; two readers' chains agree unless split; splits are final; what counts builds on what counts; versions only grow |
| `Target` | the one target grammar (A8, recommended), verbs, footprints | a narrower target covers only what the wider one does; footprint coverage grows with grants and composes |

The hash and signatures are parameters: a theorem that needs the hash collision-free assumes it (`Injective`), and
signatures are taken as sound, as in every Aven model. `Blake3` is the hash the examples and vectors use.

**Run it in the box,** from `aven/DB2`: `bun run box sh -c 'cd core/spec && lake build'`; `bun run box sh
sandbox/vectors.sh` writes the vectors in [`spec/vectors`](spec/vectors), and `--check` compares them with what's
committed. Lean 4.35.0, pinned exactly; no `sorry`, no axioms.
