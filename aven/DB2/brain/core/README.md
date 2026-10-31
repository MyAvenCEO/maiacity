# avenCORE

avenCORE is the ground every other package of avenDB stands on: Values and their one encoding, names, signed things,
envelopes and logs, counting, limits, ops and targets, each defined once and reused by all.

## Owns

- [Values](#values): a Value and its one encoding, deterministic CBOR in a strict profile, and the codec crate.
- [Names](#names): hashes, a Value's name, Doc ids, type ids, and BLAKE3.
- [Signed things](#signed-things): a label and a body, named by `[label, body]`, with a set of `Sig`s beside the name.
- [Envelopes](#envelopes): the one signed unit of change, placed in its log by its writer's signature (`Writes`).
- [Logs](#logs): one writer's envelopes in one Doc and branch, each naming the one before.
- [Splits](#splits): two envelopes at one place of a log, final.
- [The past](#the-past): what an envelope builds on, decided for what a reader holds, and versions.
- [Counting](#counting): a whole past held (`Closed`) and the one counting rule, `Counts`, over fit, authorized and
  revoked.
- [Limits](#limits): the limits on Values, signed things, envelopes, calls and bounds, and what a reader accepts.
- [Ops and calls](#ops-and-calls): `OpId`, `OpId.ofPlugin`, `core/1`'s eight ops and write params, calls and bounds.
- [Targets and steps](#targets-and-steps): the one target grammar in three forms, its CBOR, and a write's steps.
- [Built-in types](#built-in-types): `builtinType` and the type of types.
- [The running model](#the-running-model): `aven-core-model` and the vectors every implementation is held to.

## Uses

avenCORE imports no other package. What it needs from one, it takes as a parameter, and that package supplies it.

- [avenID](../id/README.md): the signature schemes behind `Verify` (Ed25519, the hybrid of Ed25519 and ML-DSA-65,
  passkeys), each travelling as a `Sig`'s opaque bytes; a vault's name; who governs whom (`gov`); what k of a vault's
  owners' signatures beside one name decide; sealing.
- [avenDOCS](../docs/README.md): `Writes`, from its writer ids; `fit`; a Doc's genesis, whose name is the Doc's id; an
  envelope's `body`; types and their versions; segments.
- [avenCAPS](../caps/README.md): `authorized`; `revoked`, whether a revocation the reader holds discounts an
  envelope; `lists`, what a collection lists; the check of a writer's key against its device cap; cap lines, which name
  ops and bound their params.
- [avenOPS](../ops/README.md): lowering a call to steps; stored queries and plugins' ops.
- [avenACTORS](../actors/README.md): `spawned`, which actor spawned which.
- [avenSTORE](../store/README.md): a Value at rest, a blob.
- [avenPEERS](../peers/README.md): the wire's hello and `update`, which keep their own frozen form; beats.

## Values

Everything avenDB signs, names or sends is a Value, and a Value has exactly one encoding. So a signature covers one
byte string, a name names one Value, and nobody can reshape signed bytes into something that reads the same. A reader
refuses any bytes that don't encode back to themselves.

The encoding is deterministic CBOR, RFC 8949's core deterministic encoding, in a strict profile. JSON is only how
people and the vectors read a Value.

- **A Value** is an unsigned or negative integer below 2⁶⁴, a byte string, text, an array, a map, `true`, `false` or
  `null`. No floats, no tags, no other simple values.
- **One form.** Every length and number in its shortest form; definite lengths only; text is valid UTF-8 (RFC 3629: no
  overlong forms, no surrogates, nothing above U+10FFFF).
- **Maps** have text keys, sorted by their encodings (shorter first, then bytewise), none twice. This is **the codec's
  order**, the order every format on these pages writes its keys in.
- **Depth.** Nothing nests deeper than 512 (`maxDepth`). A scalar, or an empty array or map, is 1 deep, and each array
  or map around it one more. A hostile input can't exhaust a reader's stack, and the reader and the writer agree on
  where the limit is.
- **Whole.** A byte string is one Value, with nothing after it.
- **No null in a built-in body.** Every built-in body (caps, revocations, passkey records, keeper records and the rest)
  leaves an absent field out of its map instead of writing `null`, and its decoder refuses a `null`, so a field has one
  form, not two. A user's Values may still hold `null`.
- **Proven:** decoding an encoding gives the Value back (`decode_encode`, `decodeAll_encode`); every byte string the
  decoder accepts is exactly the encoding of what it decoded (`encode_decode`, `encode_decodeAll`); two allowed Values
  with one encoding are one Value (`encode_inj`); nothing accepted nests deeper than 512 (`decodeAll_deep`).
- **The readable form.** In JSON, an integer is a number, text a string, a byte string `{"bytes": "<hex>"}` in
  lowercase hex, a hash among them. Every package's vectors use this one form.
- **Two frozen forms** are never written in the codec: what was stored before the network's genesis, read as it is and
  never written again, and the wire's hello and `update`, which every version must read
  ([avenPEERS](../peers/README.md)).
- **In Rust,** the codec is a crate of its own, `aven-codec`: `Value`, `encode`, `decode`, `MAX_DEPTH` and the
  [names](#names). What compiles only the codec, such as the runtimes' frozen modules, moves only when the codec does.
  `aven-core` re-exports it. Both are `no_std`, with no `unsafe`, and build for wasm32.

**Decided:** rule 1, A2, A29, A45, A52 (512 deep), A98 (the codec crate), A174 (bytes in JSON), A184 (no null in a
built-in body) · **Lean:** `Aven.Core.CborLaws` — `decode_encode`, `encode_decode`, `decodeAll_encode`,
`encode_decodeAll`, `decodeAll_deep`, `encode_inj`; `Aven.Core.Text` — `utf8_text`, `text_inj`; `Aven.Core.ValueEq` —
`Value.beq_iff`

## Names

A Value is named by the hash of its one encoding. Anyone can recompute a name from the bytes, and two allowed Values
with one name are one Value. The hash is BLAKE3. Every model takes the hash as a parameter, and a theorem that needs it
collision-free says so (`Injective`): the one assumption every Aven model makes.

- **A hash** is BLAKE3's 32 bytes. In CBOR it is a byte string of exactly 32 bytes, and `Hash.ofValue?` is the one
  reader of a hash: every id, `prev`, dep and op id is read through it. In JSON it is `{"bytes": "<hex>"}`, as every
  byte string is; `b3:<64 lowercase hex>` (`Hash.text`) is only for display.
- **A Value's name** is the hash of its encoding (`nameOf`; in Rust `name_of`). Two allowed Values with one name are
  one Value (`nameOf_inj`).
- **A Doc id** is the [name of a signed thing](#signed-things): the Doc's genesis under `avenDB genesis 1`. The genesis
  itself is [avenDOCS](../docs/README.md)'. In CBOR a Doc id is its 32 bytes; `d:<hex>` is only for display.
- **A type id** names one version of a type: `<type Doc>/<schema hash>`, the version Record's address in its type Doc,
  and the one way a version is named anywhere. In CBOR it is `[type Doc's id, schema hash]`, two byte strings of 32
  bytes, and any other length is refused (`TypeId.ofValue_value`). It is shown as `d:<hex>/b3:<hex>`. Types and their
  versions are [avenDOCS](../docs/README.md)'.
- **A sealed Value** is named by the hash of its sealed bytes; sealing is [avenID](../id/README.md)'s.
- **BLAKE3 in Lean** is the specification's algorithm, held to its known answers: hashing, the keyed mode, `derive_key`
  and the extendable output of all three. avenID's keys and avenDOCS' writer ids derive with it. Rust uses the `blake3`
  crate, pinned exactly.

**Decided:** rule 1, A2, A45, A96 (text forms are display only), A145 (one hash reader), A174 (a hash in JSON),
docs 24 (a Doc id is its genesis's A30 name) · **Lean:**
`Aven.Core.Names` — `nameOf_inj`, `Hash.ofValue?_value`, `Hash.ofValue_value`, `TypeId.ofValue_value`;
`Aven.Core.Blake3` — `digestXof`, `keyedHash`, `deriveKey`, held to the specification's answers

## Signed things

Everything signed is a label plus a body. A signer signs exactly the encoding of `[label, body]`, so a signature made
for one kind of thing can't be read as another's. The thing is named by the hash of exactly those bytes, and its
signatures sit beside the name, never in it. Signing one act twice, by the same signer or another, never makes two
names: the other signatures are approvals over the same bytes.

- **The signing bytes** are the encoding of `[label, body]`, the label as text (`signingBytes`). One signing input is
  one label and one body (`signing_separates`).
- **A label** names the kind of thing and its version, such as `avenDB envelope 1`: a format's label is its version.
  Labels are frozen strings, spelled the same whichever package owns the concept. At most 256 bytes.
- **The name** is the hash of the signing bytes (`Signed.name`). Two well-formed signed things with one name have one
  label and one body (`Signed.name_inj`), and signatures never touch it (`Signed.name_sigs`, `Signed.name_addSig`). The
  name holds no signer, so a body carries whatever makes an act its own.
- **A signature, `Sig`,** is `{"sig": bytes, "signer": bytes}`. Both are opaque: the scheme and its suite live inside
  them ([avenID](../id/README.md)), and avenCORE checks them only through `Verify`, a parameter: it holds no keys.
- **A set of signatures** is strictly sorted by signer, bytewise, so it has one per signer (`sigsOk`); a set out of
  order, or with a signer twice, is refused on read. It only grows: adding puts a signature in its place, or leaves the
  set as it is when that signer has signed already (`addSig`), and drops nothing (`addSig_mono`, `addSig_signed`,
  `Signed.signedBy_addSig`). At most 16 ([limits](#limits)).
- **As it travels:** `{"body": body, "sigs": [Sig, …], "label": label}`, keys in the codec's order.
- **Valid** when it has a signature and every one verifies over its signing bytes (`Signed.valid`); **signed by a key**
  when one of its signatures is that key's and verifies (`Signed.signedBy`).
- **History or a beat.** Whatever decides something is history: written by an envelope in a log, where a split is
  final and the newest is the latest. A beat decides nothing ([avenPEERS](../peers/README.md)' presence).

**Decided:** rule 1, A30, A31, A36 (a format's label is its version), A45, A65 (a body carries what makes an act its
own), A94 (`Sig`, one per signer), A161 (labels are frozen strings) · **Lean:** `Aven.Core.Signed` —
`signing_separates`, `Signed.name_inj`, `Signed.name_sigs`, `Signed.name_addSig`, `addSig_mono`, `addSig_signed`,
`Signed.signedBy_addSig`

## Envelopes

An envelope is the one signed unit of change. It says where it belongs: its Doc, its branch, its writer and its place
in that writer's log. It names what it builds on by hash: the envelope before it in its log, and the tips of the other
logs it builds on, never a counter alone. What it carries beyond that is its body. It is a
[signed thing](#signed-things) under the label `avenDB envelope 1`, and what is signed is everything but its
signatures.

As it travels (`Envelope.value`), keys in the codec's order:

| Key | What | Form |
|---|---|---|
| `doc` | its Doc | a Doc id, 32 bytes |
| `seq` | its place in its log | an integer, from 1 |
| `body` | what it carries | a Value, in [avenDOCS](../docs/README.md)' form; its `authority` is [avenCAPS](../caps/README.md)' |
| `deps` | the tips of other logs it builds on | their names, 32 bytes each, at most 256 |
| `prev` | the envelope before it in its log | its name, 32 bytes, or `null` for the first |
| `sigs` | its signatures, not signed | a set of `Sig`s, at most 16 |
| `branch` | its branch | text, at most 256 bytes |
| `writer` | its writer id | an integer, made by [avenDOCS](../docs/README.md) |

- **What is signed:** `["avenDB envelope 1", unsigned]`, where `unsigned` is the map above without `sigs`
  (`Envelope.unsigned`, `Envelope.signing`).
- **Its name** is the hash of exactly that. One name is one envelope but for its signatures (`Envelope.name_inj`), and
  adding a signature never renames it (`Envelope.name_sigs`, `Envelope.name_addSig`).
- **Placed by its writer.** An envelope is placed in its log when one of its signatures verifies and its signer writes
  that log (`Envelope.placed`). Which key writes which log is a parameter, `Writes`: avenDOCS supplies it from how it
  makes a writer id, and avenCAPS checks the key against the device cap. An envelope that isn't placed is nothing: a
  reader refuses it, so it is never held, never counts and is never half of a split. Adding a signature keeps it placed
  (`Envelope.placed_addSig`).
- **Approvals.** The signatures that verify, the writer's among them, are its approvals (`Envelope.approvals`): k of a
  vault's owners, or a passkey's signature beside its owner's at a sign-in. What they decide is
  [avenID](../id/README.md)'s and [avenCAPS](../caps/README.md)'.
- **Read from bytes** only within its [limits](#limits) and in exactly this shape (`Envelope.accept`).

**Decided:** rule 2, A3, A30, A45 (writer ids are docs'; Core takes `writes`), A94 (an envelope that isn't placed is
nothing), A145 (`Writes`, a named trait in Rust) · **Lean:** `Aven.Core.Log` — `Envelope.name_inj`,
`Envelope.unsigned_inj`, `Envelope.value_inj`, `Envelope.name_sigs`, `Envelope.name_addSig`, `Envelope.placed_addSig`

## Logs

A log is one writer's envelopes in one Doc and branch, in order. Each names the one before it by hash, so nobody can
reorder a log or fill a gap in it unseen, and no reader needs a counter it trusts.

- **One log** is the envelopes with one Doc, one branch and one writer id (`SameLog`).
- **In order.** The first has `seq` 1 and `prev` `null`; each next one has the next `seq` and names the one before as
  its `prev`.
- **One writer, never waiting.** A device's own log is its truth, and it never waits for another peer to confirm its
  head. How a writer id is made, when a device starts a fresh one (a generation), and a log's closed runs (segments)
  are [avenDOCS](../docs/README.md)'.
- **Read in order, a log holds no split** (`chain_no_split`), and two readers' copies of one log agree wherever both
  hold it, unless a split lies between them (`chains_agree`).
- **A writer's log grows only at its head.** An envelope of another log, at the wrong place, or naming the wrong
  `prev` is refused; a different envelope at a place the log holds is a split; the same envelope again adds only its
  signatures.

**Decided:** rule 2, rule 3, A3, A45 · **Lean:** `Aven.Core.Log` — `chain_no_split`, `chains_agree`

## Splits

A split is a writer signing two different envelopes at one place of its log. It is final: neither side counts, for any
reader, however much more it learns, and nobody settles it by picking a side.

- **Precisely:** two envelopes of one log (`SameLog`) with one `seq` and two names (`Split`).
- **Signing again is no split.** A split is two different bodies at one place, never two sets of signatures over one
  (`sigs_no_split`, `addSig_no_split`).
- **Final.** An envelope whose past holds half of a split is discounted (`Discounted`), never counts
  (`discounted_not_counts`), and no reader that learns more ever counts it (`split_final`): more envelopes never undo a
  path through the past (`reaches_mono`).
- **"Fork"** means only a copy into a new Doc ([avenDOCS](../docs/README.md)).

**Decided:** rule 3, A4, A30 · **Lean:** `Aven.Core.Log` — `sigs_no_split`, `addSig_no_split`, `split_final`,
`reaches_mono`, `discounted_not_counts`; `Aven.Core.Verdicts` — `splitB_iff`, `discountedB_iff`

## The past

An envelope's past is everything it builds on, directly or not: the envelope before it in its log, the tips it names,
and their pasts in turn. History is ordered by what each envelope names, never by a clock: a time an envelope carries
is its writer's claim.

- **Builds on.** `a` builds on `b` when `b` is `a`'s `prev` or one of its `deps`, by name (`BuildsOn`). `Reaches` is
  that, any number of times, through envelopes a reader holds.
- **Decided for what a reader holds.** In rounds of names, each adding what something already found builds on, until a
  round adds nothing, in no more rounds than there are envelopes (`past`, `inPast`). The rounds find exactly the past
  (`found_iff`, `inPast_iff`), and the past is the envelope itself and what is before it (`reaches_iff`).
- **Found by name.** Two held envelopes with one name are both in a past or neither is (`Before.rename`). Anything
  named that names its parents (`Parents`) has its past decided the same way.
- **A version** is a set of envelopes with everything they build on, named by its tips (`Version`). An envelope is in
  a version when it is in the past of one of its tips (`Version.holds`), and a version holds more as more arrives,
  never less (`Version.holds_mono`). avenDOCS uses it as a Doc's version; snapshots and checkpoints are
  [avenDOCS](../docs/README.md)'.

**Decided:** rule 2, rule 12, A3, A175 (versions are avenCORE's) · **Lean:** `Aven.Core.Past` — `reaches_iff`,
`found_iff`, `inPast_iff`, `Before.rename`; `Aven.Core.Log` — `reaches_mono`, `Version.holds_mono`;
`Aven.Core.Verdicts` — `holdsB_iff`

## Counting

An envelope counts when a reader can rely on it: its whole past is held, every envelope in that past is fit and
authorized, and none of it is half of a split or discounted by a revocation. This is the one counting rule. avenDOCS
supplies `fit`, and avenCAPS supplies `authorized` and `revoked`, as parameters, and no package defines a counting rule
of its own.

- **A whole past held** (`Closed`): every envelope it reaches names, as `prev` and `deps`, only envelopes the reader
  holds. An envelope built on a parent the reader lacks waits, and counts for nothing until the parent arrives. A whole
  past stays whole as more arrives, where one name is one set of parents (`closed_mono`), and what it reaches has a
  whole past too (`closed_past`).
- **Counts** (`Counts nm fit authorized`, to become `Counts nm fit authorized revoked`): `Closed`, and every envelope
  in its past fit, authorized, in no split and not revoked. What a counted envelope builds on counts too
  (`counts_past`).
- **Revoked** is avenCAPS': an envelope is discounted when the reader holds a counted revocation of a cap in its chain
  that has taken effect in that Doc, and whose kept past doesn't hold the envelope
  ([revocation](../caps/README.md#revocation-and-acks)). `authorized` reads only the envelope and its own past;
  `revoked` reads what the reader holds, so it is a parameter of its own.
- **Not monotone, by design.** A split learned later discounts (`split_final`), and so does a revocation learned later;
  a parent learned later is the first step to counting. Every reader holding the same envelopes counts the same, with
  no settle order.
- **Decided for what a reader holds,** each decision its proposition: `countsB_iff`, `closedB_iff`, `discountedB_iff`,
  `splitB_iff`, `holdsB_iff`.
- **Readers judge.** The verdict every reader reaches alone is this rule, with avenCAPS' `authorized` and `revoked`
  and avenDOCS' fit (`Aven.Architecture`'s `rule4_one_verdict`).

**Decided:** rule 4, rule 11, A4, A30, A45, A94 (counting is not monotone, by design), A159 (`authorized` is
avenCAPS'), A182 (a revocation discounts, as a split does) · **Lean:** `Aven.Core.Log` — `counts_past`, `closed_mono`,
`closed_past`, `split_final`, `discounted_not_counts`; `Aven.Core.Verdicts` — `countsB_iff`, `closedB_iff`,
`discountedB_iff`; `Aven.Architecture` — `rule4_one_verdict`; to come: `Counts nm fit authorized revoked`, and
`rule4_one_verdict` over the three

## Limits

Every input has a limit before it costs memory or time. avenCORE holds the limits of its own primitives; every other
limit lives with the primitive it bounds.

| Limit | Value | Lean |
|---|---|---|
| a Value's nesting | 512 deep | `maxDepth` |
| an encoded envelope or signed thing | 1 MiB (1,048,576 bytes), a store chunk | `maxEnvelopeBytes` |
| the deps of one envelope | 256 | `maxDeps` |
| a branch | 256 bytes of UTF-8 | `maxBranchBytes` |
| a label | 256 bytes of UTF-8 | `maxLabelBytes` |
| a signer | 4 KiB: room for a hybrid key or a passkey's | `maxSignerBytes` |
| a signature | 16 KiB: room for a hybrid signature or a passkey's assertion | `maxSigBytes` |
| the signatures beside one name | 16: the writer's and k of a vault's owners | `maxSigs` |
| the params of one call | 64 | `maxParams` |
| the values one bound allows | 256 | `maxBoundValues` |

Rust holds the same numbers: `MAX_DEPTH` in `aven-codec`, the rest in `aven-core`'s `limits` (`MAX_ENVELOPE_BYTES`
and so on).

- **What a reader accepts** as an envelope or a signed thing (`Envelope.accept`, `Signed.accept`): at most 1 MiB,
  checked before anything is read; one Value in the codec; exactly the shape its `value` writes, each key in the
  codec's order and each value in its one form; every field within its limit. What is accepted is within every limit
  (`Envelope.accept_limits`, `Signed.accept_limits`) and encodes back to exactly the bytes it came from
  (`Envelope.accept_encode`, `Signed.accept_encode`), so a reader keeps, and names, exactly what it was given.
- **A call or a bound** past its limit doesn't read ([ops and calls](#ops-and-calls)).
- **Elsewhere:** the wire's frames and pages and a keeper's admission are [avenPEERS](../peers/README.md)'; what a
  vault may hold, from keepers' offers, is [avenCAPS](../caps/README.md)'; a runtime's fuel and memory are
  [avenRUNTIME](../runtime/README.md)'s; a query's bounds are [avenOPS](../ops/README.md)'.

**Decided:** rule 10, A52, A73 and A94 (the numbers), A145 (each limit with its primitive's owner) · **Lean:**
`Aven.Core.Limits` — `Envelope.accept_limits`, `Envelope.accept_encode`, `Signed.accept_limits`, `Signed.accept_encode`;
`Aven.Core.CborLaws` — `decodeAll_deep`; `Aven.Core.Op` — `Call.ofValue_value`, `Bound.ofValue_value`

## Ops and calls

An op is something that can be done to a Doc, named by the hash of its stored form. A cap names ops by id and bounds
their params; an envelope names the ops it ran, as calls. So what an owner approves is an op's name and definition:
exactly what it lets the holder do. An op is pinned by its id: a new version is a new id, so a cap never changes
behaviour by itself.

**Ops.**
- **An op id** (`OpId`) is a hash: the name of the op's stored form.
- **A plugin's built-in op** is stored as `{"op": name, "plugin": plugin}`, and its id is that Value's name
  (`OpId.ofPlugin`). This is the one way any plugin's op is named: `core/1`'s, `tree/1`'s (the register,
  [avenCAPS](../caps/README.md)) and `id/1`'s.
- **`core/1`, the core verbs:** `read`, `put`, `patch`, `remove`, `edit`, `tell`, `keep` and `share` (`CoreOp`), each
  with a fixed id (`CoreOp.id`). `put`, `patch`, `remove` and `edit` write: they lower to [steps](#targets-and-steps).
  `read`, `tell`, `keep` and `share` lower to none (`CoreOp.writes`). Reading is holding the key; free editing is
  `edit` on a type and field.
- **`core/1`'s write params:** `type` (`typeParam`), the type a write is on, and `fields` (`fieldsParam`), the fields it
  sets. Cap lines and the lowering read them here.
- **Any other op,** such as a stored query or a plugin's op, is named by the hash of its stored form. Queries,
  plugins and their lowering are [avenOPS](../ops/README.md)'.

**Calls.**
- **A call** (`Call`) is an op called: `{"op": op id, "params": {name: value, …}}` (`Call.value`), the op id as its 32
  bytes, the params a map with text keys, at most 64. The Doc it acts on is the envelope's. A param the call doesn't
  give reads as `null` (`Call.param`).
- **A call is canonical or isn't a call.** Params out of the codec's order, or one named twice, are refused when
  decoded, so one call has one encoding; a call within its limits reads back as itself (`Call.ofValue_value`).

**Bounds.**
- **A bound** (`Bound`) is what a cap allows for one param: any value (`null`), or one of a list of values (an array,
  at most 256). For a list param, each of its elements must be one of them (`Bound.allows`). Ranges come only when a
  real op needs them.
- **Narrowing a bound** (`Bound.within`): any value the narrower one allows, the wider one allows too
  (`Bound.within_allows`), and narrowing composes (`Bound.within_trans`). A bound within its limit reads back as itself
  (`Bound.ofValue_value`).
- A cap line, an op with bounds on its params, is [avenCAPS](../caps/README.md)'.

**Decided:** A32, A45, A66 (a query is a stored op; bounds are enumerated values), A75 (`OpId`), A88 (a call is
canonical or isn't one), A109 (`OpId.ofPlugin`, the write params) · **Lean:** `Aven.Core.Op` — `Call.ofValue_value`,
`Bound.ofValue_value`, `Bound.within_allows`, `Bound.within_trans`; the ids are definitions (`OpId.ofPlugin`,
`CoreOp.id`, `typeParam`, `fieldsParam`), held by `ops.json`

## Targets and steps

One grammar says what a cap covers, what a want asks for and what a query ranges over. A target reads only what a
Doc's genesis fixes: its id, its vault and its root type (`Facts`), never its content, so what a target covers can't
drift with the data.

**The three forms** (`Target`), each a map with its keys in the codec's order:

| Form | Covers | CBOR |
|---|---|---|
| one Doc, with its reach | the Doc; with `spawned` also every actor it spawned, directly or not; with `lists` also every Doc the collection lists | `{"doc": Doc id, "reach": "self" or "spawned" or "lists"}` |
| a vault's Docs | every Doc of the vault; with `below`, also every Doc of the vaults it governs | `{"below": bool, "vault": vault}` |
| a vault's Docs of one root type | the same, only the Docs whose root type is that type Doc | `{"type": type Doc id, "below": bool, "vault": vault}` |

- **What a target reads from others:** who governs whom ([avenID](../id/README.md)), which actor spawned which
  ([avenACTORS](../actors/README.md)), and what a collection lists, by its issuer's signed listings
  ([avenCAPS](../caps/README.md)). avenCORE takes the three as parameters (`Target.covers`), and a device evaluates
  them as tests (`Target.coversB`, held to `Target.covers` by `Target.coversB_iff`).
- **Narrowing** (`Target.le`), read from the two targets alone: a Doc alone is within that Doc with any reach, and a
  reach within the same reach; a vault's Docs of one type are within the same, or within that vault's Docs; a target
  without `below` is within one with or without it; nothing else. A narrower target covers only what the wider one
  does (`Target.le_sound`).
- **In CBOR,** Doc and type ids are their 32 bytes, and any other length is refused. A vault, in a target and in a
  Doc's facts, is its name: plain 32 bytes, never text. How a name is made is [avenID](../id/README.md#vaults)'s, and
  only avenID's vectors show it; avenCORE's use plain 32-byte names, and 32 zero bytes is the type of types' vault.
  Each form has keys no other form has, so a target reads back as itself
  (`Target.ofValue_value`), and an allowed target is canonical (`Target.value_canon`): a cap's bytes, and its name,
  name its targets exactly.

**Steps.** A step is what one lowered write touches. Steps are computed from an op's lowering, never written in a cap.
- **A step** (`Step`): `type`, a type Doc's id; `verb`; `fields`, the names of the fields it writes.
- **Its verb** (`StepVerb`): `put-new` (a Record that didn't exist at the envelope's base), `put-replace` (one that
  did), `patch`, `remove`, or `edit` (of a text, a list or a tree).
- Lowering a call to steps is [avenOPS](../ops/README.md)'; checking steps against a cap's footprint is
  [avenCAPS](../caps/README.md)'.

**Decided:** A8, A19, A32, A39, A88 (ids are 32 bytes), A162, A164 and A190 (a vault is its plain 32-byte name) ·
**Lean:** `Aven.Core.Target` — `Target.le_sound`, `Target.coversB_iff`; `Aven.Core.TargetCbor` — `Target.ofValue_value`,
`Target.value_canon`

## Built-in types

Every Doc has a type, always. Some types are built in: every reader knows them without fetching anything, because a
built-in type's id is the name of a fixed label.

- **A built-in type** (`builtinType H ns name`) is the Doc id that is the name of the text `<ns> <name> 1`, such as
  `avenID keyring 1`. It has no genesis and no schema Doc, and it is never pinned; whoever defines it checks its shape.
  Each package lists its own types through this one function ([avenID](../id/README.md),
  [avenDOCS](../docs/README.md)).
- **The type of types** (`typeOfTypes`) is `avenDB type of types 1`: the root type of every type Doc, and its own
  (`typeOfTypes_typed`). It is built in, in no vault, since no genesis could name its own hash.
- **A type Doc** is one whose root type is the type of types (`Facts.isType`).

**Decided:** A39, A42 (the type of types is a fixed, built-in id), A45, A67 (the type of types), docs 24 (built-in
types are named by their labels and never pinned) · **Lean:** `Aven.Core.Op` — `typeOfTypes_typed`;
`builtinType` and `typeOfTypes` are definitions

## The running model

Every answer an implementation's tests check comes from the Lean. The Lean writes vectors, and a running build of the
model answers random cases, so Rust is held to the Lean itself, not to a transcription of it.

- **The vectors** (`lake exe vectors` in `core/spec`, written to [`core/spec/vectors`](../../core/spec/vectors)):
  `cbor.json`, `names.json`, `signed.json`, `envelopes.json`, `logs.json`, `past.json`, `counts.json`, `limits.json`
  (an envelope and a signed thing exactly at each limit and one past it), `ops.json`, `targets.json` and
  `target-bytes.json`. Each vector file has one owner; these are avenCORE's alone.
- **The running model, `aven-core-model`,** reads one case per line and answers each with one line. For a world of
  envelopes (which a reader holds, which are unfit or unauthorized, a version's tips) it gives every envelope's name,
  past and splits, and whether its past is whole, it is discounted, it counts and the version holds it. For targets,
  facts and bounds it gives coverage, narrowing and what a bound allows; for bytes, what a reader accepts as an
  envelope, a signed thing or a target.
- **The property tests** of `aven-core` ask it on random inputs and must give its answers, and check `split_final`,
  `counts_past` and `Version.holds_mono` of the Rust on the same worlds.

**Decided:** README rule 10, A45 (one owner per vector file), A73 (the running model) · **Lean:**
`Aven.Core.Model`, with the executables `Model.lean` and `Vectors.lean`

## Status

Lean 4.35.0, pinned exactly, with no `sorry` and no axioms. Rust: `aven-codec` and `aven-core`, `no_std`, with no
`unsafe`, for native and wasm32. TS: none of its own; the browser runs `aven-core` inside the Peer-Light's wasm, and the
runtimes' frozen modules compile `aven-codec`.

| Concept | Lean | Rust | Landed | Open work (owner) |
|---|---|---|---|---|
| Values | `Cbor`, `CborLaws`, `Text`, `ValueEq`, `Json`, `Bytes` | `aven-codec`: `Value`, `encode`, `decode`, `MAX_DEPTH` | #1532, #1651, #1710 | — |
| Names | `Names`, `Blake3` | `aven-codec`: `Hash`, `DocId`, `TypeId`, `blake3`, `name_of` | #1532, #1710, #1733 | `Names`' module doc and `DocId`'s Rust doc say a Doc is named by its "signed genesis"; the genesis is unsigned and named by A30 (docs 24) (avenCORE). A174 has JSON write a hash as `{"bytes": hex}` and says the vectors already do; `names.json`, `past.json`, `counts.json` and the other vectors still write hashes and Doc ids as `b3:`/`d:` text (architect) |
| Signed things | `Signed` | `Signed`, `Sig`, `add_sig`, `signing_bytes`, `Verify` | #1666, #1679, #1710 | — |
| Envelopes | `Log` | `Envelope`, `Writes`, `ENVELOPE_LABEL` | #1679, #1710, #1733 | — |
| Logs | `Log` | `Log`, `LogId`, `Refused`, `is_chain` | #1679 | A1's rename `IsChain` → `IsLog`, and the names built on it: `chain_no_split`, `chains_agree` and Rust's `is_chain` (avenCORE), `Aven.Architecture`'s `rule3_chain_whole` (architect); no PR |
| Splits | `Log`, `Verdicts` | `split`, `Held::discounted` | #1679, #1710 | `split`'s Rust doc cites `resign_no_split`; the theorem is `sigs_no_split` (avenCORE) |
| The past, versions | `Past`, `Log`, `Verdicts` | `past`, `in_past`, `Parents`, `Held::holds` | #1679, #1710 | `Past`'s module doc names the tree's statements, and `Aven.ID.Network` keeps a `Parents` instance for `TreeStatement`; both go once the register's statements are envelopes (A30) (avenCORE, avenCAPS) |
| Counting | `Log`, `Verdicts` | `Held::closed`, `Held::counts` | #1710 | `Counts nm fit authorized revoked`, with avenCAPS' `revoked` from `Aven.ID.Revoke`, and `rule4_one_verdict` over the three: to come (A182; avenCORE, avenCAPS, architect). `Counts`' doc cites "docs, rule 13"; it should cite A4, A30 and A45 (avenCORE). Defined again elsewhere, to switch to avenCORE's (A45): avenDOCS' `Verdicts` and db's copies of `envelopes.json`, `logs.json` and `counts.json` (avenDOCS); the register's `counted` (avenCAPS); `Aven.Architecture`'s `rule3_split_final` rests on avenDOCS' `split_final` (architect) |
| Limits | `Limits`, `Op` | `limits` | #1688, #1733 | `Aven.Architecture`'s rule 10 doesn't rest on `Envelope.accept_limits` (architect) |
| Ops and calls | `Op` | `OpId`, `op_id`, `stored_op`, `CoreOp`, `TYPE_PARAM`, `FIELDS_PARAM`, `Call`, `Bound` | #1681, #1699, #1710, #1733 | avenCAPS' `pluginOp` and `idOp` and the register's `TreeOp.id` compute op ids themselves, not through `OpId.ofPlugin` (avenCAPS) |
| Targets and steps | `Target`, `TargetCbor` | `Facts`, `Reach`, `Target`, `Step`, `StepVerb` | #1681, #1699 | A vault is text in `Facts`, `Target` and its CBOR. Plain 32 bytes in one step (A162, A190): `claude/aven-core-logs`, with the edits to every Lean it breaks (the engine's `Query.lean` included), then avenID's PR for avenCAPS and avenID, merged back to back (avenCORE, avenID) |
| Built-in types | `Op` | `builtin_type`, `type_of_types`, `Facts::is_type` | #1681, #1710 | avenDOCS' `Genesis.builtinType` names its four types itself, not through `builtinType` (avenDOCS) |
| The running model | `Model`, `Model.lean`, `Vectors.lean` | `tests/vectors.rs`, `tests/log.rs`, `tests/ops.rs`, `tests/model.rs` | #1688 | — |
| Hybrid signatures | `Hybrid`, in this package | in `aven-id` | — | The concept is avenID's (A159), so its Lean is avenID's to hold (A45); its doc cites "rule 29", which is caps' rule 29 (avenID) |

## Open questions

None.
