# First principles: one job, one mechanism (31 Oct 2026)

At main `17880922`, independent of the architect. Every item marked **checked** was confirmed against the code by
the architect the same day. What follows from each is in [`ARCHITECTURE.md`](../ARCHITECTURE.md) (A28 to A38).

## 1. The tree's admin is fixed at genesis, not governed (checked)
`Network.lean` `admin` and `adminPasskey` are the genesis claimant's passkey. Running code (`members.rs` `admin_key`)
already derives the admin from the tree. There is no second admin, no owner change and no recovery, against caps' "no
owner outranks another by seniority" and README's "Maia City is the admin, not Alice's key". A sign-in in the tree
(`TreeSays.signIn`) is caps' device cap modelled again. **Merge:** an admin act carries an approval by Maia City's
owners (D14); a sign-in is the device cap, and removing a device is its revocation. *Decided as rule 15 and A28.*

## 2. The tree's statements and peer records bypass Core's envelopes, logs and past (checked)
`TreeStatement` brings its own past (`InPast`, `fresh`, `pastNames`) beside `Aven.Core.Past`, though PEERS calls the
tree "a log of envelopes". `Records.lean` orders five record kinds by a counter alone, and at the same counter the
smaller body wins, against A4 (a split is final). **Merge:** statements are Core envelopes; records are envelopes in
their signer's own log. *A30, A31.*

## 3. Rule 1, one codec, holds in Core but not in running code
Running code has eight text signing formats, each with its parser (`claim 2`, `sign-in 1`, `invite 1`, `withdraw 1`,
`join 1`, `statement 1`, `chat 1`, `line 1`), and the wire is JSON lines. The engine names operations by the hash of
canonical JSON (engine README, "Stored operations"). **Merge:** CBOR frames and statements as envelopes, at a
wire-version bump. *A29; the engine README's line is fixed with it.*

## 4. Release signers are anchored nowhere (checked)
`Records.lean` takes `releasers` as a free parameter, and the genesis doesn't name them, yet they gate avenOS, the Peer
and every runtime module. **Merge:** a release vault named by the genesis, its owners approving each release. *A28,
A36.*

## 5. Two rules name signed things (checked)
Core names a signed thing and an envelope by its whole encoding, signature included (`Signed.lean`, `Log.lean`); caps
names a cap by its body (`Cap.digest`). Passkey (ES256) and ML-DSA signatures are randomized, so one act signed twice
gets two names: a false split once statements are envelopes. **Merge:** a name is the hash of `[label, body]`;
signatures sit beside it, and a split is two different bodies at one place. *A30.*

## 6. One keep (K4), and query targets against caps rule 6
Keep caps were modelled three ways, and A22 said "targets may be queries" while caps rule 6 says a cap never names a
query. **Merge:** #1642 made keep caps ordinary caps on Core's targets, resolved by the issuer's devices; the word
"query" goes. *A32.*

## 7. state-runtime brings a fourth update grammar
`State.lean` has set, merge, append and remove at a path, and a step returns the whole state, so turning it into a
commit and a footprint needs a diff no spec defines. **Merge:** the runtime returns K8's steps (put, patch, remove,
edit), which are the commit and the footprint caps check. *A37.*

## 8. Three presence models and three beats
The hub's connection count (`Presence{peers}`), the chat's `here`/`bye` with a 30 s wall-clock timeout, and the wire's
`Beat{n}`, with signed beats planned (`CatchUp.lean`). **Merge:** one signed beat per device, ordered by its counter,
time only a claim; the other three retire with thread C. *A35.*

## 9. The node-tree allowlist exists three times
Lean, Rust (`aven-runtimes-tree`) and JS (`brain/render/tree.js`), with the JS tests writing their own expected values
(rule 10) and no limits in `tree.js`. The tree crate also hand-writes CBOR's `head`, as aven-core does. **Merge:** the
JS tests replay the vectors until the Rust runs in avenOS as wasm; the tree crate takes aven-core by path.

## 10. Slides and the face-runtime are two drawing formats
Slides are HTML and CSS files; the face-runtime never takes CSS text. Markdown links are rewritten inside the
renderer. **Merge:** slides move onto the face-runtime once its slide style and the tree drawer land (Samuel, 31 Oct
2026); link rewriting becomes a pass over any tree's `a` nodes.

## 11. File types are listed in four places
`files-sw.js`, `Chat.svelte`, `peer/native/src/keep.rs` (by extension) and the runtimes registry (by the bytes). The
registry plan replaces the first two; `keep.rs` joins it, so the native Peer records the sniffed type.

## 12. Core's grant grammar has redundant forms, and a read line allowed writes (checked)
`vaultDef v d` is `vaultType v d false`, and `actor a false` is `doc a`. Verbs exist three ways. `Grant.allows`
ignored a line's verb, so a `read` line with a footprint allowed writes. **Fixed** in #1653 (only write lines carry
footprints); the targets shrink to three forms. *A32.*

## 13. Two vault-to-vault channels and two live transports
Caps' letters (letterbox, then pairwise tags) beside A17's carrier Doc; actors' point-to-point `message`/`ack` frames
beside K11's gossip per group; "ack" with three meanings. **Merge:** a message is an envelope in the pair's carrier
Doc, delivered as any Doc is. *A33.*

## 14. Version numbers overlap
ALPN `aven/db/1` beside the hello's wire version; labels version formats, yet READMEs add `"envelope"`, `"cap"`,
`"role"` body fields the Lean dropped; one release record with a counter beside dated package tags; the runtime
registry's own version and a per-vault runtime catalogue. **Merge:** the ALPN is a frozen name, the hello's number the
only wire version (#1649); the label is a format's version; one release record per package, by its dated version.
*A36.*

## 15. Shared words are defined in five places
README's Terms, ARCHITECTURE's tables, the glossary and each spec's own. README's Terms are stale (a Doc "like IPNS", a
ref "a Doc's head", caps grant "operations"). **Merge:** the glossary is the one list (A1); everything else links to
it. See [`terms.md`](terms.md).

## Decisions that pulled against each other
A2 against actors' "frames as JSON lines" (resolved by A29); A22's query targets against caps rule 6 (A32); the CSS
slides against the face-runtime (item 10); K11 against actors' point-to-point delivery (A33); docs' "no interim fix"
for the chat's chains against thread C's catch-up on them (A34); A4 against Records' tie-break (A31); caps' refusal of
a roster every device downloads against the tree as one Doc (A38).
