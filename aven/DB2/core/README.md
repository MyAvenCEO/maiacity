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
| `Target`, `TargetCbor` | the one target grammar (A8), its CBOR, verbs, footprints | a narrower target covers only what the wider one does; a target reads back from its CBOR, which is canonical; footprint coverage grows with grants and composes |

The hash and signatures are parameters: a theorem that needs the hash collision-free assumes it (`Injective`), and
signatures are taken as sound, as in every Aven model. `Blake3` is the hash the examples and vectors use.

**In Rust: `aven-core`** (this folder, a member of aven/DB2's workspace). For now the codec and names: `Value`,
`encode` and `decode` in the strict profile, held to `spec/vectors/cbor.json` both ways (every encoding written and
read back, every refusal refused), and BLAKE3 names, Doc ids and type ids, held to `names.json`. `no_std`, no
`unsafe`; it builds for wasm32, so the runtimes in aven/runtimes use it by path. Nothing deeper than 512 is read
(`MAX_DEPTH`, Lean's `maxDepth`, a scalar counting as 1), so a hostile input can't exhaust the stack (ARCHITECTURE
rule 10); `cbor.json` holds it at 512 and 513 deep. Other threads extend the crate (envelopes, logs) Lean-first, as
here.

**Run it in the box,** from `aven/DB2`: `bun run box sh -c 'cd core/spec && lake build'`; `bun run box sh
sandbox/vectors.sh` writes the vectors in [`spec/vectors`](spec/vectors), and `--check` compares them with what's
committed. Lean 4.35.0, pinned exactly; no `sorry`, no axioms.
