# avenID caps: who may read, write, tell, keep and share what

avenID's capabilities, for a network that is end-to-end encrypted, peer to peer and owned by the people in it
(30 Oct 2026). A **cap** is a signed grant from one vault to another: which operations, on which Docs, under which
conditions. Who may read is decided by who holds a Doc's key; who may write, by every reader checking every change;
who may tell an actor, by its router. No server decides anything, and the servers that keep the bytes can't read them.

It is written for milestone 3 (avenID and caps) and is what milestones 4 to 7 plug into: the
[docs](../../db/docs/README.md) layer's envelopes, the [engine](../../db/engine/README.md)'s operations and wants, the
[store](../../store/README.md)'s sealed blobs, avenPEER's door and keeper, and avenACTOR's actors. Nothing here is built
before its milestone, and nothing comes in from older systems as code ([README](../../README.md), rule 12). Where each
rule came from is in [`research.md`](research.md): the audit of avenDB-old, avenOS's caps, avenACTOR's discovery
document (moved there whole), and Signal, Matrix, MLS, Biscuit, Keyhive and Meadowcap.

**Status.** Decided by Samuel on 30 Oct 2026:
- this folder is the one caps spec (D1);
- vaults issue and hold caps (D2), in our own grammar (D3);
- caps grant the engine's operations on the engine's targets (D4, D5), and roles are pinned by hash (D6);
- keys come in layers that scale without a dead end (D7);
- a revocation keeps what it names and wins over the rest (D8);
- the keeper is blind (D9);
- hybrid post-quantum signatures go where authority lasts (D10);
- passkeys use the PRF step (D11);
- MaiaCityGuardian stays a full owner through the evaluation phase (D12).

The engine thread agreed the footprints caps check (E1–E3). The docs and avenACTOR threads answered their seams on the
same day, and what they agreed is marked where it applies. Two things are proposals of this document, marked where they
appear: groups holding caps (an extension of D2) and the exact layers of D7.

## Contents

1. [What it takes from before](#what-it-takes-from-before)
2. [Terms](#terms)
3. [The rules](#the-rules)
4. [The model](#the-model)
5. [A cap](#a-cap)
6. [What a cap grants](#what-a-cap-grants)
7. [Granularity, and who enforces it](#granularity-and-who-enforces-it)
8. [Holders](#holders)
9. [Issuing, delegating and delivering](#issuing-delegating-and-delivering)
10. [Checking](#checking)
11. [Keys](#keys)
12. [Revocation](#revocation)
13. [Recovery](#recovery)
14. [Passkeys and the PRF step](#passkeys-and-the-prf-step)
15. [Post-quantum](#post-quantum)
16. [Metadata: what hosts still see](#metadata-what-hosts-still-see)
17. [Wants and caps](#wants-and-caps)
18. [Scale: the battle test](#scale-the-battle-test)
19. [How it plugs in](#how-it-plugs-in)
20. [Decisions](#decisions)
21. [What Lean proves](#what-lean-proves)
22. [Order of work](#order-of-work)
23. [Open questions](#open-questions)
24. [Not in this spec](#not-in-this-spec)

## What it takes from before

| From | What held | What hurt | Here |
|---|---|---|---|
| avenDB-old (`aven/db`) | A chain's slice and ops are intersected by the verifier, so they stay sealed; revoking a share revokes what rests on it; strong removal; a want grants nothing; X-Wing with both ciphertexts and keys in the derivation; key-committing AEAD; purpose labels on every derivation; 64 KiB file units; a passkey write needs the assertion and a post-quantum signature | Levels mixing five axes; about twenty nouns; cap groups that changed after issuing; no expiry; one device could grant its whole vault; audiences kept by honest stewards; epochs nobody checked; history sealed under each new key, so no forward secrecy despite the name; keys derived from the PRF with a fixed salt; the relay saw the whole graph; a master key at threshold 1 | Rules 3–5, 9, 14–16, 20, 21; no levels; roles pinned; Docs and groups instead of audiences |
| avenOS's `aven-caps` | A blind replicate right that hands out no key; delete, roster and key writes gated apart; an epoch high-water mark; the last owner kept; roles as labels over facts that never change on the wire; a report of raw facts | Third-party blocks nobody checked; no expiry; a removal re-minted the chain from genesis; static-static ECDH with signing keys; a plaintext roster, owner bindings and edit signatures | `keep`; rule 4; the raw grants in avenOS; keys sealed to vault keys |
| avenVICTORIO and Abject (avenACTOR's survey) | Every method names its cap; hidden is not refused; the sender comes from the signature; viewing as someone narrows; laws are code | Identity read from the payload; rights cached past revocation | Rules 1, 11, 27, 31 |
| Signal | A hybrid KEM for long-term secrecy (PQXDH); sealed sender; safety numbers; healing by fresh keys | A ratchet's forward secrecy can't keep a history people read again | X-Wing everywhere a key is sent; the signer inside the seal; vault fingerprints; the heal |
| Matrix | Megolm's rotation on the next message after a member leaves; cross-signing; device verification by short codes; key backup | Undecryptable messages when keys travel apart from messages; key backup undoing forward secrecy; MLS needing a decentralised variant | Lazy rotation; keys travel with what they open; the keyring's backup |
| MLS (RFC 9420) | A tree makes a membership change cost log n | Commits need one order; members are devices; forward secrecy deletes the history Docs keep | Flat now, a tree for big groups later, behind one scheme byte |
| Biscuit | Offline attenuation; third-party blocks; revocation ids | Datalog: hard to prove, and avenOS's blocks went unchecked | Chains signed by holders; approvals; a fixed grammar |
| Keyhive (Ink & Switch) | Access control in the data's own causal history; revocation wins over what it hadn't seen; BeeKEM: a tree that needs no sequencer | Young, classical crypto | Caps as Records in their Docs; acks; BeeKEM-style trees for big groups |
| Meadowcap (Willow) | One grammar for caps and areas of interest | | Rule 6 |
| Tahoe-LAFS | The convergence secret | | Files dedup inside a Doc's epoch |
| The web's PKI | Short-lived certificates beat revocation lists at scale | | Memberships of huge groups renew |

## Terms

**Who**

- **key:** signs or opens. Ed25519, ML-DSA-65 and ES256 sign; X-Wing (ML-KEM-768 with X25519) opens. A **hybrid
  signature** is Ed25519 and ML-DSA-65 over the same bytes, and both must verify.
- **vault, owner, governs, device:** as avenID has them ([README](../../README.md#terms)). A device signs for the vault
  it serves.
- **device cap:** what a device may do for its vault. By default, all its vault may do except govern.
- **group:** a Doc whose readers are its members, whose key opens every Doc sealed to it. **In a group:** holding read
  on it. ("Member" stays the network's word: a person's vault let in through the door.)

**Grants**

- **cap:** a signed Value in which an issuer grants a holder operations on targets under conditions, resting on a
  parent cap or on the issuer's own authority. Its id is its hash.
- **issuer, holder:** the vault that grants and the vault (or group, or ticket) that receives.
- **target:** what a cap or a want names: a Doc, a vault's Docs, or a vault's Docs of one root type, each with or
  without the vaults below it.
- **operation:** what a cap allows: `read`, `query`, `write`, `mutate`, `tell`, `keep`, `share`.
- **footprint:** what a write may touch: types, verbs, fields and their constraints
  ([engine](../../db/engine/README.md#terms)).
- **condition:** not before, expiry, approval, uses, budget, own Records, lines, history.
- **chain:** a cap and its parents, up to a **root cap**, which a vault issues over Docs of its own or of vaults it
  governs.
- **role:** a named bundle of grants, a Value, named by its hash.
- **approval:** k owners' signatures over one digest.
- **ticket:** a one-time key that holds a cap until a vault claims it. An invite is one.
- **revocation:** a signed Record that ends a cap and everything resting on it.
- **ack:** a writer's mark inside an envelope that it has seen a revocation. From the first ack in a Doc on, the revoked
  holder's writes there count only if an ack had seen them.
- **kept list:** what a revocation keeps: for each Doc its revoker holds, the revoked holder's last envelope it had
  seen.
- **letter:** a sealed Value from one vault to another, which is how a cap reaches its holder.

**Keys**

- **epoch:** one key of a Doc, from one rotation to the next, named by the hash of its key blob.
- **key blob:** an epoch's key sealed to each of its readers, with a commitment to it and a link to the epoch before.
- **reader:** what an epoch is sealed to: a vault, through its vault key, or a group, through its group key.
- **keyring:** a vault's own Doc of keys, and the only Doc sealed to devices.
- **vault key, group key:** X-Wing key pairs. The private half lives in the keyring or the group's Doc; anyone can seal
  to the public half.
- **rotation:** a new epoch, sealed to the readers that remain.
- **keeper:** a peer that keeps and serves sealed bytes it can't open: the Aven Peer, or any member's Peer.
- **fetch key:** what a device proves it holds to be served a Doc's sealed bytes.

## The rules

Each rule is held by a Lean theorem or a check once there is code to hold.

1. **Keys sign; vaults hold.** Only a key signs, and only a vault, a group of vaults (rule 13) or a ticket holds a cap.
   A device signs for the vault it serves, within its device cap.
2. **Governing is ownership, never a cap.** A vault's owners change its owners, devices, thresholds and recovery, k of
   n. No cap governs, and no device governs (`Aven.ID.Governs`).
3. **Every cap narrows what it rests on.** A root cap rests on its issuer's authority over the target's vault. Every
   other cap rests on a parent its issuer holds and grants part of it: targets within, operations within, footprints
   within, conditions at least as strict, and a lower share depth.
4. **The verifier computes the chain, and a cap never changes.** Nothing a cap says about itself widens it. It names
   operations and roles by hash, so what it grants is fixed when it is signed.
5. **A cap grants operations on targets.** The engine's operations (`read`, `query`, `write`, `mutate`) and the
   network's (`tell`, `keep`, `share`). There are no levels.
6. **One target grammar.** Caps and wants name the same targets (engine, D4). A want may add a stored query; a cap
   never names one, because what a query covers changes with the data.
7. **Read is the key, per Doc.** Holding read means holding the Doc's key. Nothing inside a Doc is secret from its
   readers: a part that must be secret is a Doc of its own (docs rule 16).
8. **Write needs read.** A vault writes a Doc only with its key. A holder without `read` acts only through someone who
   holds the key (rule 10).
9. **Every reader checks every write.** A change counts only when its signer's chain is valid, live and covers the
   change's footprint. One that doesn't count is kept but shows on no line, and neither does anything built on it (docs
   rule 10).
10. **Without the key, the key's holder checks.** A holder without `read` gets only what a kernel or a serving peer runs
    for it, and only the operations its cap names. For actors and agents, that holds query by query.
11. **Hidden is not refused.** A peer refuses what no cap grants, whether or not an app showed it.
12. **Caps live where their checkers read them.** A Doc's caps and revocations are Records in that Doc. A cap on a
    vault's Docs lives in the group that opens them. A cap reaches its holder in a letter.
13. **A group can hold a cap.** What a group holds, everyone in it holds, and a write under it carries the writer's way
    into the group.
14. **Revocation wins over what it had not seen.** It ends the cap and every cap resting on it. In each Doc it takes
    effect at its first ack: the revocation itself where it lives in that Doc, its kept list for the Docs it names, or
    the first envelope of any other writer there that names it. From then on, the revoked holder's writes count only if
    an ack had seen them.
15. **Removal closes reading at the next epoch.** Before writing, the next writer of each Doc a removed reader could
    open rotates its key. What was read stays read; no system can take it back.
16. **A write uses an epoch no older than any in what it builds on.**
17. **Docs are sealed to readers, readers are vaults or groups, and only a keyring is sealed to devices.** A device
    added reads at once. A device removed costs its vault one rotation, then each group and Doc it could read one
    rotation at its next use.
18. **Keys travel with what they open.** An envelope names its epoch, an epoch names its key blob, and an epoch links to
    the one before. Nobody waits for a key sent apart, and a new reader can read history while no one else is online.
19. **Nothing is re-encrypted.** A rotation seals a new key for what is written next. Bytes at rest keep the key they
    were sealed with.
20. **Hybrid where authority lasts.**
    - X-Wing for every key sent.
    - Hybrid signatures on caps, revocations, governance, approvals, letters, segments and checkpoints.
    - Ed25519 on single live envelopes, which their segment's hybrid signature covers once they are sealed into it.
    - Every seal and every signature names its suite.
21. **A passkey's act needs both proofs:** the WebAuthn assertion, which proves the authenticator and the person
    (ES256), and the hybrid signature derived from its PRF (post-quantum).
22. **The keeper is blind.** It keeps and serves sealed bytes under keep caps. It checks the door, quota and fetch
    proofs, never a write cap. It learns no content, type, signer, cap or reader list, beyond what serving a device
    shows ([metadata](#metadata-what-hosts-still-see)).
23. **The signer is inside the seal.** Outside a segment is only what a blind keeper needs to serve catch-up and catch a
    split: the Doc, the key epoch, the writer's Loro peer for that Doc and branch, its counter range, the previous
    segment's hash and the padded length. The peer is a pseudonym that names no device or vault. It is worked out from
    the signing device and checked against it on import, and a key rotation doesn't change it.
24. **A want grants nothing.** A device is served its wants intersected with its caps; an actor is handed its loads
    intersected with its run's caps (engine, rule 7).
25. **Approval is a co-signature over one digest:** k of the named owners, for one act, used once.
26. **Conditions only narrow.** Uses and budgets hold only where one checker counts them: a kernel or a router.
27. **It fails closed.** An envelope counts, doesn't count, or waits for a key, a cap or what it builds on. It counts
    when it fits, is authorized and isn't a split (the docs layer's three verdicts), and everything it builds on counts.
    Fit never changes. A revocation can later turn "authorized" into "doesn't count", and the Doc's state is then
    rebuilt from its envelopes.
28. **No global state.** No check needs the whole tree, a sequencer, a list of every cap or a scan of everyone's
    letters. Proofs travel with the acts, and each check reads only the Docs it concerns.
29. **Every format names its scheme.** A key blob says flat or tree, and seals and signatures say their suite. Scale and
    new cryptography come in as new schemes, never as a redesign.
30. **Recovery is never one key,** except MaiaCityGuardian through the evaluation phase (D12), with its exit written
    [below](#recovery).
31. **The UI holds no rule.** avenOS asks the engine's dry run, and shows each grant as it is, never only a role's name.
32. **Lean first.** Every rule here is a theorem or a check before it is code (README, rule 10).

## The model

```
 key ──signs for──▶ device ──acts for, within its device cap──▶ vault ──owns, governs──▶ vaults below
                                                                  │
                                    issues, on its own authority  │  or resting on a cap it holds
                                                                  ▼
             cap { issuer, holder, grants: [ target × operations × lines ], conditions, parent }
                                                                  │
                                       holder: a vault, a group, or a ticket until it is claimed
```

Four things remain when every concept is reduced to its job (avenACTOR's discovery document, §9):

| Essential | Its one job |
|---|---|
| **Key** | The only thing that signs or opens. Passkeys, device keys, ticket keys, recovery keys and server keys differ only in who keeps them |
| **Vault** | A principal: owners (keys or vaults) and how many must agree. People, coops, agents and devices are kinds of vault |
| **Cap** | A signed grant that narrows something its issuer holds: to whom, which operations, on what, under which conditions |
| **Proof** | The way from a signing key, through devices, owners and caps, to one act. Anyone can check it |

Everything older is one of these four, or gone:

| Seen before as | Here |
|---|---|
| Level, ops, built-in groups, cap groups | Operations; a role |
| Share, tenant grant, per-method capability | A cap |
| The Owner level, the Owner group | Governing (never a cap), or `share` |
| Threshold, root, consent, merge accept, human gate | Approval |
| Invite share, access request, link | A ticket |
| Keep share, copy setting, follow list, interest, an actor's `loads` | A want, which grants nothing; `keep` for the keeper |
| Audience, stays, marks, intake | Gone: Docs and groups carry keys |
| Standing grant | A cap on a vault's Docs with `below` |
| Device rights, agent limits, viewing as someone | Device caps; run caps |
| Recovery key, guardians | Owners with a delay; MaiaCityGuardian for now |
| Gate, admission, door, membership | The network's door (milestone 2): a cap to connect in all but name |
| Identity token, session | Evidence that a key was used, not authority |

## A cap

A cap is a Value: canonical JSON, named by its BLAKE3 hash, which is its id.

```json
{ "cap": 1,
  "issuer": "v:alice",
  "holder": "v:bob",
  "parent": null,
  "grants": [
    { "target": { "doc": "d:7Hq…" },
      "read": { "history": "all" },
      "write": [ { "type": "b3:due…", "verbs": [ "put-new", "patch" ],
                   "fields": { "x1": "free", "x2": { "is": "d:7Hq…/t1" } } } ],
      "mutate": [ "b3:4f1c…" ],
      "share": 0,
      "lines": "main" } ],
  "conditions": { "expires": "2026-12-31T00:00:00Z" },
  "nonce": "9a0e…" }
```

| Field | Meaning |
|---|---|
| `issuer` | The vault that grants |
| `holder` | A vault (devices are vaults), a group (`g:<doc>`), or a ticket's public key |
| `parent` | The cap it narrows, by id, or `null` for a root cap |
| `grants` | Each a target, the operations on it and the lines it may write; or `role` and `target` instead |
| `conditions` | [Below](#conditions); they apply to every grant |
| `nonce` | Makes two caps with the same grants two caps, each revocable on its own |

**Signed** by a device acting for the issuer, with a hybrid signature over `avenID cap 1`, a newline and the cap's hash,
plus the approvals where [issuing](#issuing-delegating-and-delivering) needs them. The signature travels beside the
Value, never inside it, so a cap's id doesn't depend on who signed it.

## What a cap grants

### Targets

The same grammar as the engine's wants (D4):

```json
{ "doc": "d:7Hq…" }                              one Doc
{ "vault": "v:alice" }                           every Doc of Alice's vault
{ "vault": "v:alice", "below": true }            and every Doc of the vaults she governs
{ "vault": "v:alice", "type": "b3:invoice…" }    her Docs of one root type
{ "actor": "e:9f78…/list" }                      one actor (an actor is a Doc)
{ "actor": "e:9f78…/list", "below": true }       and every actor it spawned: a screen and its buttons
{ "vault": "v:alice", "def": "b3:todo…" }        every actor of one definition in her vault
```

A want may also name `{ "query": "b3:…", "column": "x2" }`; a cap never does. Readers decide whether a Doc is in a
target from its vault and its root type, both fixed when it is made. An actor's address survives its upgrades and a
definition's hash doesn't, so a cap by address carries over to a new version and a cap by definition doesn't
(avenACTOR, 30 Oct 2026).

### Operations

| Operation | What it allows | Checked by |
|---|---|---|
| `read` | The Doc's keys. `history`: `all` (every epoch) or `from-now` | Crypto |
| `query` | Running these stored queries, named by the hash of their lowered core operation | The kernel or serving peer that holds the key. For a vault that holds `read` too, only its honest code |
| `write` | Changes within these footprints: types, verbs, fields and their constraints | Every reader |
| `mutate` | These mutations, by the hash of their lowered core operation: their footprints, and exactly what they produce when the envelope names them | Every reader |
| `tell` | Sending these messages, by name in the receiver's interface, as `tell` or `ask` | The receiver's router |
| `keep` | Keeping and serving the sealed bytes, without a key | Nothing to check: the keeper keeps |
| `share` | Issuing narrower caps, to a depth | Every reader of where the caps live |

The engine is how a cap says what its holder may do (Samuel, 30 Oct 2026). Queries and mutations are operations stored
by hash ([engine](../../db/engine/README.md#operations)); a cap names exactly the ones it allows, or the core verbs over
types for writes no operation made, such as typing in an editor. `want` needs no cap.

### Footprints

Agreed with the engine thread on 30 Oct 2026 (E1–E3). A footprint is computed once, from an operation's lowering to
core operations, and per lowered step it says:

- **the type**, and the **verb**: `put-new` (a Record that didn't exist at the envelope's base), `put-replace`, `patch`
  or `remove`. A put under a slot id ([ontology](../../db/ontology/README.md#the-rules), rule 9) is an upsert by design,
  so it is `put-replace`;
- **the fields** written, each with a **constraint**:
  - a literal or a fixed param, compared exactly;
  - `$actor` or `$vault`, compared with the envelope's signer;
  - `{ "ref": n }`, a Record made in the same envelope;
  - `free`, which leaves it to the schema;
  - `$now`, which is free or within a bound of the envelope's signed time, because nothing in a Loro change carries a
    clock anyone can trust (docs rule 3);
- **`where`** on `patch` and `remove` only over fields that never change once a Record exists: immutable in the schema,
  or written once by `put-new` (an owner field set to `$actor`). Those read the same at the envelope's base and now, so
  the check is a lookup of the touched Records. Anything else narrows by type and field only.

A cap names the hash of the **lowered** core operation (E3), which a plugin upgrade can't widen. The operation's own
hash may ride along for display and grants nothing. An envelope made by an operation carries the operation's hash and
its params inside the seal, so a reader re-lowers it and checks the change is exactly what it produces.

### Conditions

| Condition | Meaning | Enforced |
|---|---|---|
| `not_before`, `expires` | When the cap holds | **Reads:** at the first rotation after expiry. **Writes:** against the envelope's signed time, and for good from the first ack after expiry, so an expiry works like a revocation the clock makes. **Tells:** by the router's clock |
| `approve` | `{ "k": 2, "of": [ owners ] }`: every act under the cap carries k approvals over its digest | Every reader, or the router |
| `uses`, `budget` | How many acts, how much spend | Only where one router or kernel counts them |
| `own` | `patch` and `remove` only on Records the holder created. The docs layer knows each Record's creator from its first envelope | Every reader |
| `lines` | `main`, or `proposals`: writes only on proposal lines, and landing them on main is someone else's merge, which counts only when the merger's grant covers the whole merge. An agent's removals go this way (engine rule 12). The docs thread proposes calling lines **branches** | Every reader |
| `history` | On `read`: `all` or `from-now` | Crypto: a `from-now` grant rotates without a link back |

### Roles

A role is a Value: `{ "role": 1, "name": "Editor", "grants": [ … ] }`, its targets written as `$target`. A cap may name
a role by hash with a target instead of listing grants. Pinned by hash, a role never changes under its holders.
Changing one is one act of its vault: the new role, and every cap naming the old one revoked and issued again. A name is
for people; authority never looks one up, and avenOS shows the grants a role expands to.

## Granularity, and who enforces it

| Granularity | Example | Enforced by | Holds against |
|---|---|---|---|
| A Doc | Read one invoice | Crypto: its key | Anyone without the key, the keeper included |
| A vault's Docs | Read all of Alice's photos | Crypto: the group for that type | The same |
| A type within a Doc | Write `due` and `done` facts | Every reader | Any writer, honest or not: an outside write doesn't count |
| A field, a constant, own Records | Change only your own Records' `status` | Every reader | The same |
| A predicate | Assert `member_of` | Every reader (a predicate is a type) | The same |
| A kind | `invoice.create` | Every reader, through the kind's compiled mutation | The same |
| A line | Propose, don't land | Every reader | The same |
| A query | Run `invoice.list` and nothing else | The kernel or serving peer holding the key | Everyone without the key. A vault holding the key could read the whole Doc with a changed client |
| A message | `tell` a todo list `add` | The receiver's router | Any sender |
| Keeping | The Aven Peer keeps Alice's Docs | The keeper keeps | Nothing to break: it holds no key |
| Delegation | Bob may share on, one hop | Every reader of where caps live | Any issuer |

So crypto decides reading down to a Doc, every reader decides writing down to a field, and a router or a kernel decides
messages and queries. For people with keys, reading is whole Docs; for actors and agents, it can be query by query.

## Holders

- **Vaults** (D2): person, coop, agent and device vaults. A coop holds no devices; what it holds, its owners act on
  through their own devices, with its approvals where needed.
- **Devices** act for their vault within a **device cap**, a cap from the vault to its device vault. A device added by a
  passkey sign-in holds everything its vault may do except govern, as avenID has it today. An agent's devices and the
  Aven Peer hold narrower ones.
- **Groups** (an extension of D2, proposed here). A group is a Doc whose readers are its members. It holds caps for
  them: a team editing the team's Docs, a family reading the family's photos. A write under a group's cap carries,
  inside the seal, the writer's read cap on the group. Groups aren't vaults, so they aren't in the tree the keeper sees,
  and making one needs no governance.
- **Actors** hold no keys (`aven/actor/ARCHITECTURE.md`, section 11). Agreed with avenACTOR on 30 Oct 2026, for
  Samuel to confirm:
  - **Every message carries a `cap` beside its `run`.** The run is the causal chain and stays the same; the cap narrows
    at every hop. It starts from the person whose click began the run. When an actor acts on its own (a timer, or a duty
    its definition declares), it starts a new run under the actor's standing cap.
  - **No confused deputy:** a turn's effects carry the cap of the message it handled, or a narrower one, never the
    actor's standing cap mixed in.
  - **The kernel** holds the keys and runs only the operations the message's cap names.
  - **The receiver's router** checks `tell` on the message's `name`. The interface is part of the definition, so its
    hash pins it.
  - **The inbox Doc from A to B** belongs to A's vault and is written only by A's home device. It comes into being when
    B's vault grants A a tell cap, together with B's read cap on it, so no inbox exists that its receiver can't read.
  - **Where an actor lives is a privacy decision.** The keeper is blind exactly for the Docs of actors it doesn't host.
    Inbox Docs it keeps for absent homes stay sealed, and face actors never live on the Aven Peer.
- **Agents** are vaults whose devices run their actors (ontology rule 13). Their caps usually write removals only as
  proposals, and spend only with an approval.
- **Tickets** hold a cap until a vault claims it, with a statement signed by the ticket key and by a device of the
  claiming vault. Milestone 2's invites are tickets for the network's door. A ticket never holds `share` beyond its own
  depth, and never governs.

## Issuing, delegating and delivering

**Who signs what:**

| Act | Signed by |
|---|---|
| A root cap on one Doc, without `share` | One device of the issuer, within its device cap |
| A root cap on a vault's Docs, a root cap with `share`, or a ticket | The issuer's owners, k of n (an approval) |
| A child cap | One device of its parent's holder, or of a vault in the holding group |
| Publishing a Doc unsealed | Its vault's owners, k of n |
| Governance | Owners, k of n (avenID) |

A root cap is issued by the target's vault or by a vault that governs it: authority runs down the tree.

**Delegating needs no one online.** The holder signs a child cap that narrows its own and writes it where its target's
caps live. Readers check it when they meet it, as Biscuit's offline attenuation does without Datalog.

**Where caps live** (rule 12):
- **A Doc's caps, revocations and epochs** are Records of avenID's types `cap`, `revoke` and `epoch` in the Doc's
  access map, sealed with the Doc. Its readers are exactly its checkers, and they see who else reads and writes it.
- **A cap on a vault's Docs** is a read cap on that vault's group for the target, plus its writes. It lives in that
  group's Doc, which every reader of the covered Docs can open. So readers of Alice's Docs see her caps that span many
  Docs, and never her caps on other single Docs.
- **A tell cap** lives with the receiver's vault, where its router checks it.

**Letters.** A cap reaches its holder in a letter. The letter is sealed to the holder's vault key and hybrid-signed by
the sending device, and it carries:
- the cap;
- the ids of the target's Docs or group;
- the holder's **tag seed** for finding its stanzas.

The first letter between two vaults goes to the recipient's letterbox, so the keeper can tell whose box it is. Later
letters use tags only the pair can compute.

## Checking

An imported envelope, in order. The docs layer and the engine run these checks
([docs](../../db/docs/README.md#envelopes-and-peers), [engine](../../db/engine/README.md#who-checks-what)):

1. **Open** it with its epoch's key, from the keyring or from the key blob its header names, or wait for the blob.
   Key-committing AEAD.
2. **Signer.** The signature holds, and the device served the signer's vault in the tree as the reader holds it.
3. **Epoch.** It is no older than any epoch in what the envelope builds on (rule 16).
4. **Authority.** Either the signer's vault is the Doc's vault, or governs it, and the device acts within its device
   cap. Or the envelope names a cap whose chain holds:
   - **valid:** signatures, approvals, every link narrowing, conditions;
   - **live:** no ack of a revocation on the chain had not seen this envelope;
   - **covering:** its footprint covers the change; with `approve`, the approvals over this envelope's digest; and for
     a group's cap, the writer's live read cap on the group.
5. **The docs layer's own checks:** the signer's Loro peer, what it builds on, fit, and no split (docs rules 2 and 10).
6. **The engine's:** a named operation is re-lowered, and the change must be what it produces.

**A merge into main** counts only when the merger's grant covers the footprint of the whole merge: every type and field
that differs between the base and the merged state, not only the commit that fixes conflicts. Otherwise a merger with a
narrow cap could land a proposal's wider changes (agreed with the docs thread, 30 Oct 2026).

**Three verdicts per envelope** (the docs layer's):
- **fit**, which depends only on the envelope and never changes;
- **authorized**, steps 1–4 and 6, which a later revocation can turn;
- **not a split**.

An envelope counts when all three hold and everything it builds on counts.
- A revocation that discounts envelopes already imported rebuilds the Doc's state from its envelopes. The last state
  stays on screen until the rebuild is done.
- Honest edits built on a discounted envelope are re-applied by their devices on top.
- Verdicts are cached per envelope, per revocations known and per code version (README, rules 4 and 5). Two readers
  holding the same revocations always agree.

| Check | Who | When |
|---|---|---|
| The door | The relay and every peer (milestone 2) | Every connection |
| Fetch proof, quota, keep caps | The keeper | Every request |
| Signer, epoch, chain, revocations | Every reader (docs layer) | Every envelope |
| Footprint, operation | Every reader (engine) | Every envelope |
| An operation against its caps before it runs | The engine | Before it runs (engine, rule 10) |
| Served is wants intersected with caps | The serving peer | Every request |
| `tell` | The receiver's router | Every message |
| Loads intersected with the run's caps | The kernel | Every turn |

## Keys

### The layers

```
 device keys ───▶ keyring ───────────▶ groups ──────────────▶ Docs ──────────────▶ envelopes, segments,
 X-Wing, Ed25519,  a vault's own Doc,   sealed to their        sealed to their       snapshots, files
 ML-DSA-65, made   sealed to its        readers: vaults and    readers: their
 on the device     devices; holds the   groups. Flat now,      vault's groups, the
                   vault key            a tree when big        groups they're shared
                                                               with, a few vaults
```

| Layer | Its key | Sealed to | Rotates when | A rotation costs |
|---|---|---|---|---|
| Device | X-Wing, Ed25519 and ML-DSA-65, made on the device and never derived from a passkey | Nothing: its public halves are in its statement | On suspicion, or on a schedule | One statement |
| Keyring | A key per epoch, and the vault key inside | Its devices; each passkey's PRF-derived seal key; MaiaCityGuardian during evaluation. A coop's goes to its owners' vault keys | A device or a sealing owner leaves | One seal per device |
| Group | A key per epoch, and the group key inside | Its readers: vaults and groups | A reader leaves; a reader's vault key changes | Flat: one seal per reader. Tree, later: one path, about log n |
| Doc | A key per epoch | Its readers: its type's group, the groups it's shared with, at most 64 single vaults | At its next write after a reader leaves or a reader's key changes | One seal per reader, usually one or two |

**Every vault starts with groups for its own Docs:**
- one for all of them;
- one per root type it uses.

A Doc is sealed to its type's group, the type group to the all group, and the all group to the vault itself and to
everyone who reads all its Docs. Granting read on a vault's Docs is joining one group: one seal, and no Doc is touched.
`below` adds the all groups of the vaults it governs as readers of its own.

A Doc shared with more than 64 vaults one by one is shared with a group instead.

### Epochs

An epoch is named by the BLAKE3 hash of its key blob:

```json
{ "doc": "d:7Hq…", "n": 12, "prev": [ "b3:…" ], "scheme": "flat 1",
  "stanzas": [ { "tag": "…", "ct": "…" } ],
  "commit": "…", "back": "…" }
```

- **`stanzas`:** the epoch's key sealed with X-Wing to each reader's vault or group key. Each stanza is found by a
  **tag**, a keyed BLAKE3 of the reader's tag seed and the epoch number. Only readers and writers of the Doc can compute
  a tag, so the keeper can't link a reader across Docs or epochs. The list is padded to the next power of two.
- **`commit`:** a commitment to the key. A reader opening a stanza checks it, so a stanza with a wrong key is found at
  once (avenDB-old never checked what its boxes held).
- **`back`:** the previous epoch's key, sealed under this one. With it, the newest key opens all of history, for a
  reader granted `history: all`. A `from-now` grant rotates without it. Old readers keep the old keys in their keyrings.
- **`scheme`:** `flat 1` now; `tree 1` later for big groups (rule 29). Caps, envelopes and checks never see which.

**Rotation:**
- Before writing, a writer rotates when its Doc's epoch isn't sealed to the current key of every reader, or still
  seals to a removed one. The writer knows both from the tree and the groups.
- Two writers may rotate at once. Both epochs are valid, nothing has to be merged, and the next writer uses the one with
  the smaller hash. No sequencer is needed, which is what MLS lacks and what DMLS and BeeKEM were built for.
- A Doc nobody writes is never rotated, and needs no rotation: nothing new in it is left to protect.

**Readers check only staleness** (rule 16). A malicious writer can always leak what it writes, so checking its epoch
protects nothing more. The rule catches honest but lagging code, which is what avenDB-old's unchecked epochs let
through.

### Sealing

- **Subkeys** come from an epoch's key by BLAKE3's key derivation, one label per use:
  - `avenDB envelope 1`;
  - `avenDB segment 1`;
  - `avenDB snapshot 1`;
  - `avenDB fetch 1`;
  - `avenDB topic 1`;
  - `avenDB converge 1`.
- **Envelopes, segments and snapshots** use XChaCha20-Poly1305 with a key commitment. A segment holds one epoch, so a
  rotation closes the open segment (agreed with the docs thread).
- **Each segment** carries its writer's hybrid signature, inside the seal (agreed with the docs thread). A device closes
  only its own segments, and one signature covers up to 256 envelopes.
- **Files:**
  - Each file's key is a keyed BLAKE3 of the epoch's convergence secret and the plaintext's BLAKE3, so a Doc's epoch
    stores a file once, and nobody without the secret can test a guess (Tahoe-LAFS).
  - The key goes in the file's Record. The bytes are sealed in 64 KiB units, with the last unit marked, and each unit is
    verified by BLAKE3 before it is opened ([store](../../store/README.md#later-sealing)).
  - Sharing a file into another Doc copies its Record and key, never its bytes.
- **Live changes** travel on the gossip topic named by the `avenDB topic 1` subkey, so only readers, and the keepers
  told the topic, can find it. For big groups the topic belongs to the group, not to each Doc.

### What removal guarantees

- **A removed reader can't open an epoch made after a writer has seen the removal.** That covers everything written in
  that Doc from then on, by every writer who knows.
- **Writes made concurrently** by writers who hadn't heard of the removal stay readable to the removed reader, since
  those writers used the old epoch.
- **What a reader read stays read.** A remaining reader can always pass on keys or plaintext; no cryptography stops a
  reader from leaking.
- **A removed device** keeps the keyring as it was when it left. Nothing written after the rotations it causes opens for
  it.

### Forward secrecy and healing, honestly

**No forward secrecy for kept data.** A Doc's history must stay readable to its readers and to their new devices, so its
old keys are kept, and the newest key opens the past through `back`. Live changes are sealed into segments under the
same key afterwards, so a ratchet on the live channel would add nothing. Forward secrecy exists only for what is never
kept, such as presence, typing and calls (later).

**Healing after a stolen key** (post-compromise security) is an act, the **heal**:
1. the owners revoke the device;
2. the remaining devices make new device keys;
3. the keyring rotates;
4. every group the vault is in rotates;
5. each Doc rotates at its next use.

That costs one rotation per group, in the background, busiest first. The heal can also run on a schedule. Without it, a
key copied in silence stays good, as in every encrypted store.

### Why not MLS, and when trees come (D7)

- **MLS** needs one order of commits per group (RFC 9420, section 14), which here would mean a sequencer.
- **MLS's forward secrecy** deletes the history Docs keep.
- **MLS's members are devices**, so every new phone would be a commit in every group.

The four layers keep device changes inside one keyring and send each Doc's key to a group, so trees are needed only
where groups are big. There they come as `tree 1`: a BeeKEM-style tree (Keyhive), which tolerates updates made at the
same time, with X-Wing at its nodes and vault and group keys as its leaves. Its cost grows with how many updates happen
at once, until a later update folds them together.

**Groups past a size a single key can't serve** (see [scale](#scale-the-battle-test)) nest:
- a community is a group of groups;
- its rotations are batched;
- its memberships are short-lived and renewed.

### Blind keepers

A keep cap tells a keeper what to keep and nothing about what it is:
- the Doc ids, or the group whose Docs to keep;
- for each epoch, the public half of the fetch key, which the rotation's writer sends it by letter;
- the gossip topics;
- the quota, and which network member's vault pays.

The keeper serves a Doc's sealed bytes only to a device that proves it holds the current fetch key, by signing the
connection's TLS exporter. So "nothing leaves for a device that may not receive it" (engine, rule 13) holds at a keeper
that can't read caps. Key blobs and letters are served to any member, since they are useless without the keys they're
sealed to.

## Revocation

| What ends | Who may end it | Its writes stop counting | Its reading ends | Who must be online |
|---|---|---|---|---|
| A cap | Its issuer, any issuer up its chain, the target's vault, or the holder (renouncing) | From its first ack in each Doc | At each Doc's next write | The revoker |
| A device | Its vault's owners, k of n | From the first ack of the removal in each Doc | Keyring at once; groups and Docs at their next use | One owner's device |
| An owner | The owners, k of n, or recovery | Governance: avenID | Keyring at once, if it held keys | The owners |
| A network member | The admin coop | The door closes at the relay and every peer | Its caps stand until their issuers revoke them | An admin |
| A ticket | Its issuer (a withdrawal) | Nothing to stop before the claim | | The issuer |

**The race.** A revocation and a write can cross: the holder writes while the revocation travels. Every reader decides
it the same way, through acks.
- **A Doc cap** is revoked by a Record in that Doc, and the revocation's own causal past is what it keeps.
- **A cap on a vault's Docs** is revoked in its group. Its kept list covers the Docs the revoker holds, and the first
  writer of any other covered Doc acks it.
- **A device removal** is acked the same way.

Until a Doc has an ack, the revoked holder can still slip writes into it. How fast revocations spread bounds that
window, and an envelope that arrives later and no ack had seen never counts, in any order of arrival. Honest work done
offline, made concurrently with a revocation, is cut as well. It shows as "didn't count", with the reason, and someone
still holding a cap can apply it again.

**Cascade.** Revoking a cap ends every cap whose chain runs through it: one Record, no re-minting. avenOS rebuilt the
whole chain from genesis for every removal.

**Expiry** is a revocation made by the clock. It is acked by the first writer whose clock has passed it, and from that
ack on it is final like any other.

**Lost and stolen devices.** Owners remove the device. A device that may have been copied gets the heal.

**Removals that clash.** Two owners may remove each other at the same time.
- Removals win over additions.
- Two removals both stand, unless together they leave a vault with no owner. Then both fail, and the vault's recovery
  owners decide.
- No owner outranks another by seniority: in avenDB-old, a stolen founding passkey beat the co-owners revoking it.

## Recovery

**Owners, k of n** (milestone 3).
- A vault's owners are keys (passkeys, a recovery kit, MaiaCityGuardian) or vaults.
- An act that needs the owners carries k approvals over its digest: a list of signatures, not an aggregate, so each
  stays post-quantum on its own.
- An owner that is a vault approves by its own quorum, recursively.

| Lost | Back in by | Data |
|---|---|---|
| One device | Another device or a passkey removes it; the heal if it may be copied | Nothing lost |
| One passkey, while a synced copy remains | The synced copy (iCloud Keychain, Google Password Manager) | Nothing lost: the copy's PRF opens the keyring |
| Every device, with a passkey left | Sign in on a new browser: the passkey adds it as a device, and its PRF opens the keyring | Nothing lost |
| Every passkey, with a device left | Devices never govern, so recovery: other owners, a recovery kit, or MaiaCityGuardian now | The device still opens the keyring |
| Everything | A recovery kit, or MaiaCityGuardian now; recovery owners after a delay later | From the kit or the guardian's seal; otherwise gone. Nobody else holds the keys |

**MaiaCityGuardian, now** (Samuel, 30 Oct 2026):
- It stays an owner of every person's vault, as [`PRODUCTION.md`](../../PRODUCTION.md#maiacityguardian) has it, and any
  one owner is enough.
- Once sealing comes, each keyring is also sealed to the guardian's seal key, so a recovery restores data and not just
  control. It needs an X-Wing key beside its Ed25519 key; `bun run guardian` would make both.
- It is the one place where recovery is one key, kept for the evaluation phase.

**Its exit,** when Samuel calls it:
1. one act per vault removes it as an owner;
2. the same act rotates the keyring, so nothing new is sealed to it;
3. the guardian's secrets are destroyed. Everything it could open before stays open to whoever kept them, so destroying
   them is part of the exit.

**The end state:**
- **Recovery owners:** a person chooses guardian vaults, k of n, whose act takes effect only after a delay (seven days,
  say) in which any owner can cancel it.
- They restore control, never data keys, unless the person opts in.
- Data comes back through the passkeys' PRF and the recovery kit.

**A recovery kit** (opt-in) is a printed secret. Its owner key and seal key are derived as a passkey's are from its PRF,
which makes it a passkey without a device.

## Passkeys and the PRF step

The WebAuthn PRF extension (CTAP2's hmac-secret) returns 32 bytes that only the authenticator can make, for a given
input. avenID uses it so that **a new browser signing in with a passkey opens its vault with no other device online.**

**Derivations.**
- The input is `avenID prf 1`, the vault's id and the owner's epoch. The browser hashes it into the authenticator's
  salt.
- From the output, BLAKE3's key derivation makes:
  - `avenID owner 1`: the Ed25519 and ML-DSA-65 seeds of the passkey's **hybrid owner key**;
  - `avenID seal 1`: the X-Wing seed of its **seal key**.
- Both public halves go into the vault's statement with the passkey's own (ES256) key.
- Device keys are never derived from it (D11), so devices rotate on their own.

**Signing up:**
1. `create()` asks for `prf`. Some platforms only say it's enabled, so a `get()` follows at once.
2. The keyring is made and sealed to the device and to the passkey's seal key.

**Signing in on a new browser:**
1. `get()` with the PRF input returns the assertion and the output.
2. The sign-in statement carries both proofs (rule 21) and adds the browser as a device, so the door opens.
3. The browser fetches the keyring's stanza for this passkey from the keeper.
4. It opens the stanza with the seal key, seals the keyring to itself, and reads everything its vault can.

**Rotating the keyring needs no ceremony:** it seals to the seal key's public half. Only opening it needs the passkey.

**Support,** as reported in October 2026. Sources disagree, so this is checked on Samuel's devices before relying on it,
and avenOS learns at sign-up whether PRF answered, never by guessing from the browser:

| Where | PRF | Notes |
|---|---|---|
| iCloud Keychain: Safari and Chrome, macOS 15+, iOS 18+ | Yes | Require 18.4 or later: earlier 18.x had a reported bug that lost PRF output |
| Google Password Manager: Chrome and Edge on Android | Yes | |
| Google Password Manager: desktop Chrome, signed in | Yes, from about Chrome 132 | Only passkeys saved there: the local profile's authenticator has no PRF |
| Windows Hello | Only Windows 11 25H2+, with recent Chrome, Edge or Firefox | Older Windows: none |
| Firefox | Partly: macOS and Windows | Not Android; versions reported differ |
| Security keys (YubiKey 5.2+) | Yes in Chrome and Firefox | Safari returned the output still encrypted (WebKit bug, March 2026) |
| 1Password | Its output isn't spec-compliant | |
| Bitwarden, Dashlane | No (June 2026) | |

**Without PRF:**
- **Pairing** from a device already in: the new browser shows a QR with a one-time X-Wing key, both screens show a short
  code, and the old device seals the keyring to it after the person confirms (Matrix's and Signal's device linking).
- **A recovery kit**, or **MaiaCityGuardian** for now.
- Without PRF, that passkey's owner signatures are ES256 only, so classical.

**Caveats:**
- Deleting a passkey loses its PRF, so every vault keeps at least two ways in: its devices and the keyring's other
  seals.
- The PRF output passes through the page, so a script injected during a ceremony could take it. Rotating the owner's
  epoch changes the input and every key derived from it.
- Over USB and NFC, the browser and a security key protect the output with a classical P-256 exchange. That exchange,
  if recorded, is the remaining quantum risk.

## Post-quantum

| What | Suite | Why |
|---|---|---|
| Every key sent: stanzas, letters, the keyring | X-Wing | Harvest now, decrypt later. Hybrid holds while either ML-KEM or X25519 holds |
| Caps, revocations, approvals, governance, letters, segments, checkpoints (milestone 7) | Ed25519 + ML-DSA-65 | Authority that lasts. One per segment covers up to 256 envelopes |
| Single live envelopes | Ed25519 | Their segment's hybrid signature covers them once they are sealed into it; 64 bytes instead of about 3.4 KB each |
| Passkey owners | ES256 assertion + PRF-derived hybrid key, both required | PRF is HMAC-SHA-256 inside the authenticator, which a quantum computer only halves |
| Content | XChaCha20-Poly1305, BLAKE3 | Symmetric, 256-bit keys |
| iroh's connections | iroh's own handshake | Content is sealed above it; it protects transport metadata only |

**Fallback suites:** HQC for key encapsulation and SLH-DSA for signatures, if lattices ever weaken. Each joins through
the suite byte, and each rotation moves to it.

**Sizes:**
- an X-Wing public key is 1,216 bytes, a ciphertext 1,120;
- an ML-DSA-65 public key is 1,952 bytes, a signature 3,309.

**Passkeys, honestly.** ES256 falls to a quantum computer; the PRF-derived hybrid key doesn't. An owner's act needs
both, so a quantum attacker would also need the PRF output. A passkey without PRF is classical until authenticators sign
with ML-DSA, which COSE is standardising and no authenticator we know of ships.

## Metadata: what hosts still see

| Who | Sees | Doesn't see |
|---|---|---|
| The relay | The device keys of the connections it carries, their IP addresses, timing and volume | Anything inside iroh's encryption |
| The keeper (the Aven Peer) and its storage (Hetzner) | **The tree:** vaults, owners, devices, network members and public keys, because the door needs them. **Per Doc:** its id, its epochs and their stanza counts (padded), sizes (padded), times, and which device uploads or fetches what. **Per segment:** its writer's pseudonym for that Doc and branch, its counter range and the segment before. So it learns how many write a Doc and how much each writes, and can follow one writer across key epochs within that Doc (whose writing stops after a rotation, say), but not who it is or what else it writes. Letterboxes on first contact; the gossip topics it keeps | Content, types, signers, caps, who reads which Doc, groups' rosters, operations |
| A network member who doesn't read a Doc | Nothing of it: its topic and fetch key come from its key | |
| A reader of a Doc | Its caps, its writers and how many read it; the caps of the groups that open it | Caps on other Docs |
| A peer on a direct path | The other's IP address (README) | |

- **Sealed sender stops at the upload.** The signer is inside the seal, so stored bytes and forwarding peers never show
  it. The keeper still knows which device uploaded what, from the connection.
- **Lengths** are padded with Padmé (PURBs), which costs at most about 12 % and hides all but a few bits of a size.
- **Access patterns** (who fetches what, when) are the largest leak left. Batched fetches through other members and
  mixing can come later without changing a format, because an envelope's outside is only its Doc, its epoch and its
  length.
- **Verifying who's who.** The keeper serves the tree, but it can't change a key a vault signed. It could invent a vault
  that looks like Bob. So avenOS shows a **vault fingerprint** to compare once, as Signal's safety numbers. Members
  gossip the tree's head, so a keeper showing different trees to different members is caught.

## Wants and caps

- **One grammar.** A want's target is a cap's target, plus a stored query (engine, D4). A want's `part`, `window`,
  `follow`, `tier`, `by` and `lifetime` are demand only.
- **Served is wants intersected with caps.**
  - A member's Peer that reads a Doc serves it to a device whose vault holds read, which it checks in the Doc's caps.
  - A keeper serves only against fetch proofs.
  - Nobody serves on a want alone.
- **Actors** get their loads intersected with their run's caps. The `now` tier is handed into the turn; the kernel opens
  it with keys the actor never holds.
- **Keep caps tell a keeper what to keep without saying what it is** ([blind keepers](#blind-keepers)). What a device
  keeps for itself is its profile (engine, D5); what a keeper keeps for others is a keep cap.
- **Tiers only order.** A tier never grants or withholds (engine, rule 9).

## Scale: the battle test

The targets (Samuel, 30 Oct 2026): millions of people and devices, terabytes shared, and groups that people are invited
to and leave all the time. Scale need not be built from day one, but no choice made now may become a dead end.

| Load | What happens | Built now | Later | Why it's no dead end |
|---|---|---|---|---|
| A person adds a phone; 5 devices, 300 groups, 100,000 Docs | One seal into their keyring. No group or Doc notices | Yes | | Nothing but the keyring is sealed to devices (rule 17) |
| A person loses a phone | Keyring rotates; each of their 300 groups rotates in the background, busiest first; Docs at their next write | Flat | Trees make big groups cheap | Rotations are lazy and need no one else online |
| A group of 10,000, one leaves | Flat: about 11 MB of stanzas once | Flat | Tree: about 14 nodes, roughly 20–30 KB | The key blob's `scheme` byte; vault and group keys are the leaves either way |
| A group of 1,000,000 | A single key can't serve it: each member would hold the whole tree (about 2 GB with post-quantum keys), and churn never stops | | A group of groups: 1,000 groups of 1,000. Rotations batched (say hourly); memberships live a week and renew | Groups can read groups, and readers are vaults or groups from day one |
| Hundreds join or leave a big group per minute, with no sequencer | Flat: rotations at once are all valid, nothing to merge | Flat | Tree: cost grows with updates made at once, then heals | Epochs form a graph, not a counter |
| 10 TB shared with a group, then someone removed | Nothing re-encrypted; each Doc seals one new key, about 1.2 KB, at its next write | Yes | | Rule 19; file keys live in Records |
| A vault with 1,000,000 Docs grants read on all of them | Joins one group: one seal | Yes | | Docs seal to their vault's groups from birth |
| A cap on 50,000 Docs revoked | One Record; a kept list for the Docs the revoker holds; acks elsewhere | Yes | | No per-Doc upkeep |
| 1,000 writers in one hot Doc | Each cap verified once (hybrid) and cached; envelopes Ed25519 | Yes | Batch verification | Caps never change, so a verdict on a chain is cached for good |
| Millions of devices at the door | | Today every peer reads the whole tree | Each device proves its vault and membership with the statements it carries | Statements verify on their own (rule 28) |
| Terabytes at keepers | Sealed blobs by hash, ranges of 64 KiB | One keeper | Many keepers, split by Doc id; any member's Peer can keep | Keep caps name a keeper vault, not the Aven Peer |
| Letters among millions | First contact to a letterbox, then pairwise tags | Yes | | No scan of everyone's letters |
| Gossip among millions of Docs | | One topic per Doc | One topic per group | Topics derive from keys |
| A broken lattice | | | HQC, SLH-DSA through the suite byte | Every seal and signature names its suite; rotations move to the new one |

**What we refuse, because each is a dead end at this scale:**
- keys sealed per device on Docs, as avenDB-old's seeds and MLS's leaves are;
- a sequencer;
- selectors with marks kept up per entry;
- re-encrypting data on revocation;
- caps or roles that change after issuing;
- unbounded checks per message, as Datalog is;
- a roster or tree every device must download;
- trial decryption over a shared mailbox;
- one key per huge group.

**What scale costs, honestly:**
- Losing a device rotates every group its person is in.
- A huge community is a group of groups, with rotations batched to an hour and memberships that renew.
- Who fetches what stays visible to keepers until fetches are mixed.

## How it plugs in

| Package | What it gives caps | What caps give it |
|---|---|---|
| avenID (`id/spec`, `id/core`) | The tree, `Governs`, statements, passkeys, invites | `Aven.ID.Caps` beside `Governs`; owners k of n; approvals; device removal and its acks; device and vault keys in statements (X-Wing and ML-DSA-65 public halves); recovery |
| docs (`db/docs`) | Envelopes, lines (branches), Records, fit | **Agreed with the docs thread (30 Oct 2026):** outside a segment are the Doc, the key epoch, the writer's Loro peer per Doc and branch (unchanged by a key rotation), its counter range, the previous segment's hash and the ciphertext. Inside are the branch, the signer, the cap, acks, the operation and params, the changes and the schema. Three verdicts (fit, authorized, not split), and a revocation rebuilds state. A segment holds one epoch, and a rotation closes it. Snapshots and heads are each device's own and never travel, so checkpoints (milestone 7) carry the hybrid signatures. A merge is checked against the merger's grant over the whole merge. Each segment carries its writer's hybrid signature. **Proposed:** a Doc's vault and root type fixed at birth; every Record's creator known; the access map's types `cap`, `revoke` and `epoch` |
| engine (`db/engine`) | Operations by hash, footprints, wants, the dry run | E1–E3; served is wants intersected with caps; `query` checked by the kernel or serving peer |
| store (`store`) | Blobs and refs | Sealed blobs; key blobs and letters are blobs; the sealing parked in its "Later: sealing" comes here |
| avenPEER | The door, the relay, the keeper | Keep caps, fetch proofs, quota per network member, letterboxes, topics per group |
| actors (`aven/actor`) | Runs, routers, inbox Docs | **Agreed with avenACTOR (30 Oct 2026), for Samuel to confirm:** a `cap` beside `run` on every message; no confused deputy; `tell` caps by name, pinned by the definition's hash; actor targets by address, by spawn and by definition; an inbox Doc belongs to the sender's vault and is born with the tell cap; actors at home on the Aven Peer are readable there |
| avenOS | The UI | The dry run, raw grants, vault fingerprints, PRF sign-in and pairing |

**Proposals for other documents**, to be agreed with their threads, not edited by this one:
- **README Terms:**
  - "cap" becomes "a signed grant: which operations a vault may run on which Docs".
  - "member" says the admin coop's `memberOf`. The current wording, "owned in the tree by the admin coop", contradicts
    `Aven.ID.Invite`.
- **docs:** the envelope's outside and inside, and the import order above.
- **engine:** the footprint fields above (E1–E3, agreed), and `query` without `read`.
- **avenACTOR:** the run's cap, tell caps, and inbox Docs owned by the sender's vault.

## Decisions

1. **This folder is the one caps spec** (Samuel, 30 Oct 2026). It lives beside `id/spec` and `id/core`. avenACTOR's
   discovery document folds in: its rules learned and first principles became the rules and the model here, and its
   survey moved whole to [`research.md`](research.md). Its old path becomes a pointer on its branch.
2. **Vaults issue and hold caps** (Samuel, 30 Oct 2026). A device is a vault, so "a narrower cap for one device" is a
   cap its device vault holds. A ticket holds one until a vault claims it. Actors hold no keys.
   **Proposed extension: a group can hold a cap** for everyone in it (rule 13). Without it, a team's caps would be
   issued once per member, and a group would have to be a vault in the tree the keeper sees.
3. **Our own grammar, not Biscuit's Datalog** (Samuel, 30 Oct 2026). Attenuation is a subset check proven in Lean. We
   keep Biscuit's offline attenuation and turn its third-party blocks into approvals. Datalog is hard to prove, needed a
   100 ms budget in avenOS, and its unchecked blocks added facts. It would also be a second grammar beside the wants'.
4. **Caps grant the engine's operations on the engine's targets** (Samuel, 30 Oct 2026). Queries and mutations are named
   by hash, writes by core verbs over types and fields. There is one target grammar for caps and wants.
5. **Independent operations instead of levels** (Samuel, 30 Oct 2026). `read`, `query`, `write`, `mutate`, `tell`,
   `keep` and `share`. A total order forced "read implies backup implies relay" and gave "owner" two meanings.
6. **Roles pinned by hash** (Samuel, 30 Oct 2026). Changing a role reissues the caps that name it. avenDB-old's cap
   groups changed under their holders.
7. **Keys in layers that scale without a dead end** (Samuel, 30 Oct 2026: "battle proof it against those targets; we
   needn't scale from day one, but mustn't end in a dead end").
   - Docs are sealed to readers, readers are vaults or groups, and only a keyring is sealed to devices.
   - Flat now. A BeeKEM-style tree for big groups behind the `scheme` byte. Nested groups and batched rotation past
     that.
   - Not MLS: it needs a sequencer, deletes history, and treats every device as a member.
8. **A revocation keeps what it names and wins over the rest** (Samuel, 30 Oct 2026). Acks carry it to Docs the revoker
   doesn't hold. Writes stop counting from the first ack; reading ends at the next epoch; only the revoker must be
   online.
9. **The keeper is blind** (Samuel, 30 Oct 2026). It checks the door, quota, keep caps and fetch proofs, never a write
   cap. avenDB-old's relay check (T25) needed the plaintext graph, and avenOS's relay kept every bad write.
10. **Hybrid signatures where authority lasts** (Samuel, 30 Oct 2026). Ed25519 + ML-DSA-65 on caps, governance and
    heads; Ed25519 on single envelopes; an owner key derived from the passkey's PRF.
11. **The passkey PRF step** (Samuel, 30 Oct 2026). The PRF opens the keyring the keeper keeps, so a new browser needs
    no other device. Device keys are made fresh. Pairing and a recovery kit cover the gaps.
12. **MaiaCityGuardian stays a full owner through the evaluation phase** (Samuel, 30 Oct 2026), its keyring seal
    included. Its exit is written above and comes when Samuel calls it.

Agreed with the engine thread (30 Oct 2026):

- **E1.** Footprints carry verbs, fields and constraints, computed once from the lowering.
- **E2.** `where` is checked only on fields that never change.
- **E3.** Caps name the lowered core operation's hash, and an envelope carries its operation's hash and params.

## What Lean proves

`Aven.ID` grows a caps model beside `Governs`, in modules `Caps` (targets, grants, chains), `Revoke` (revocations, kept
lists, acks), `Epochs` (keys, symbolically: what each party can know), `Approve` and `Recover`. As everywhere (README,
rule 10), its examples and generated cases are exported as vectors every implementation loads, and stateful models
export traces.

| Theorem | Says |
|---|---|
| `narrow_chain` | Every link grants a part of its parent; a leaf grants a part of its root, and a root no more than its issuer's authority over the target's vault |
| `root_authority` | A valid chain's root is issued by the target's vault or one that governs it, with approvals where required |
| `counts_iff` | An envelope counts exactly when its signer, epoch, chain, liveness and footprint hold. The model is the check, and it runs against the Rust on random cases |
| `readers_agree` | A verdict depends only on the envelope, its causal past and the revocations known |
| `revocation_wins` | After an ack, no envelope of the revoked holder that no ack had seen ever counts, in any order of arrival |
| `cascade` | Revoking a cap ends every cap whose chain contains it |
| `stale_refused` | An envelope under an epoch older than one in its causal past doesn't count |
| `confidential` | A vault learns an epoch's key only by being its reader, by reading a later epoch with history, or by a reader handing it on |
| `removal_next_epoch` | No epoch made by a writer who had seen a removal opens for the removed |
| `keeper_blind` | Keep caps, blobs, key blobs and the keeper's letters yield it no Doc's key |
| `want_grants_nothing`, `one_grammar` | What is served lies within the caps; wants and caps share one `Target`, and served is their intersection |
| `approval_exact` | An act that needs k approvals counts only with k distinct owners' signatures over exactly its digest |
| `group_holds` | A write under a group's cap counts only with the writer's live read on the group |
| `merge_covered` | A merge into main counts only when the merger's grant covers every type and field the merge changes from its base |
| `no_confused_deputy` | A turn's effects carry the handled message's cap or a narrower one, never the actor's standing cap |
| `device_within_cap` | A device acts only within its device cap, and never governs (extending `device_governs_nothing`) |
| `guardian_exit` | After its exit, no keyring epoch is sealed to MaiaCityGuardian |

**Vectors:**
- `caps.json`: chains, valid and not, each with the first rule a bad one breaks;
- `revocations.json`: traces of revocations, acks and late arrivals;
- `epochs.json`: traces of rotations and who can open what;
- `approvals.json`;
- `footprints.json`, shared with the engine;
- `derivations.json`: labels to bytes, once `Aven.DB.Blake3` gains BLAKE3's keyed and key-derivation modes.

The primitives themselves (X-Wing, ML-DSA, Ed25519, the AEAD) stay outside Lean, as Ed25519 does today. They are tested
against their standards' known answers and Wycheproof.

## Order of work

A proposal for milestone 3's plan, for the architect:

1. **Lean:** `Caps`, `Revoke`, `Epochs` and `Approve`, with vectors.
2. **avenID:**
   - owners k of n and approvals;
   - device removal and its acks;
   - devices' X-Wing and ML-DSA-65 keys in their statements;
   - vault keys.
3. **Keys:** keyrings, groups (flat), Doc epochs, key blobs and letters. The first sealed Doc is the city-dome, which
   takes up the store's parked sealing.
4. **Passkey PRF:** the keyring's seal, sign-in on a new browser, and pairing as the fallback.
5. **The blind keeper:** keep caps, fetch proofs and quota.
6. **Caps on writes,** with the docs layer's envelopes (milestone 4). Until then, the chat's lines keep checking their
   signer's membership, and the room's key keeps them sealed.
7. **Later:**
   - the `tree 1` scheme, before any group passes about 256 vaults;
   - recovery owners with a delay;
   - nested groups and batched rotation for communities;
   - MaiaCityGuardian's exit.

## Open questions

1. **Groups holding caps** (D2's extension): yes?
2. **Which root caps need the owners' approval:** caps on a vault's Docs, `share`, tickets and publishing, as proposed,
   or more?
3. **When the tree scheme comes:** at the first group of about 256 vaults, or in milestone 3 to prove scale early?
4. **Write without read:** a drop-box Doc whose epoch also has an X-Wing key, so a holder can append without reading
   (forms, tips, submissions). Later?
5. **Device secrets at rest in a browser:** OPFS is readable by the page's own scripts. Wrap them under a
   non-extractable WebCrypto key, at least?
6. **The heal on a schedule:** monthly, or only on suspicion?
7. **When MaiaCityGuardian exits,** and whether the guardian vaults chosen later may hold a keyring seal when a person
   opts in.
8. **Caps across an actor's upgrade:** a cap by definition hash doesn't carry over to a new version. Should a definition
   name the one it replaces, so such a cap follows an upgrade that doesn't widen the interface?
9. **Padding:** Padmé on every envelope, or only on segments and files?
10. **What a blind keeper may see of writers:** per segment, a pseudonymous peer and its counters, so it can serve
    catch-up by version and catch splits (the docs thread's proposal, taken here). The alternative, "everything after
    segment X", hides how many write a Doc but costs bandwidth and loses split detection at the keeper.

## Not in this spec

- The door, invites and joins: milestone 2 and `Aven.ID.Invite`.
- The exact text of avenID's statements: `id/core`, from this model.
- Envelopes, lines and fit: the [docs](../../db/docs/README.md).
- Operations, footprints and wants: the [engine](../../db/engine/README.md).
- Blobs and refs: the [store](../../store/README.md).
- The kernel and its router: `aven/actor`.
- The tree scheme's protocol: its own document when it comes.
- Mixing fetches.
