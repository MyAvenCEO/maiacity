# avenID caps: who may read, write, tell, keep and share what

avenID's capabilities, for a network that is end-to-end encrypted, peer to peer and owned by the people in it
(30 Oct 2026). A **cap** is a signed grant from one vault to another: which operations, on which Docs, under which
conditions. Who may read is decided by who holds a Doc's key; who may write, by every reader checking every change;
who may tell an actor, by its router. It is peer to peer: no peer is special, and a peer that keeps bytes for others,
a keeper, can't read them.

It is written for milestone 3 (avenID and caps) and is what milestones 4 to 7 plug into: the
[docs](../../db/docs/README.md) layer's envelopes, the [engine](../../db/engine/README.md)'s operations and wants, the
[store](../../store/README.md)'s sealed blobs, avenPEER's door and keeper, and avenACTOR's actors. Nothing here is built
before its milestone, and nothing comes in from older systems as code ([README](../../README.md), rule 12). Where each
rule came from is in [`research.md`](research.md): the audit of avenDB-old, avenOS's caps, avenACTOR's discovery
document (moved there whole), and Signal, Matrix, MLS, Biscuit, Keyhive and Meadowcap.

**Status.** Decided by Samuel on 30 Oct 2026:
- this folder is the one caps spec (D1);
- vaults issue caps, and one vault or a group of vaults holds each (D2), in our own grammar (D3);
- caps grant the engine's operations on the engine's targets (D4, D5), and roles are pinned by hash (D6);
- keys come in layers that scale without a dead end (D7);
- a revocation keeps what it names and wins over the rest (D8);
- the keeper is blind (D9);
- hybrid post-quantum signatures go where authority lasts (D10);
- passkeys use the PRF step (D11);
- MaiaCityGuardian stays a full owner through the evaluation phase, and leaves before the network opens beyond the
  founding circle (D12);
- the keeper sees as little as possible: a segment's Doc, epoch and padded length (D13);
- every grant needs its vault's owners' approval, for now (D14);
- the public is the network's members, never the open internet (D15);
- actors act under caps as agreed with avenACTOR, and caps follow an upgrade only so far (D16);
- a vault's secrets live in its safe, which opens only in a safe runtime (D17);
- everything is padded (D18), and keys heal on a schedule and on suspicion (D19);
- write without read comes later (D20);
- keeping is a role any peer can take, and fetch keys chain from each Doc's genesis (D21);
- the network's tree is a Doc of signed statements that one rule settles, from a genesis every member pins, with the
  guardian named in every claim (A10 to A13, decided as recommended);
- a lens grants nothing until it is pinned (rule 35), and a sealed index holds only what all its readers may read
  (A26, rule 36).

The engine thread agreed the footprints caps check (E1–E3). The docs and avenACTOR threads answered their seams on the
same day, and what they agreed is marked where it applies. Nothing in this spec is still a proposal.

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
15. [The safe](#the-safe)
16. [Post-quantum](#post-quantum)
17. [Metadata: what hosts still see](#metadata-what-hosts-still-see)
18. [Wants and caps](#wants-and-caps)
19. [Scale: the battle test](#scale-the-battle-test)
20. [How it plugs in](#how-it-plugs-in)
21. [Decisions](#decisions)
22. [What Lean proves](#what-lean-proves)
23. [Order of work](#order-of-work)
24. [Open questions](#open-questions)
25. [Not in this spec](#not-in-this-spec)

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
- **condition:** not before, expiry, approval, uses, budget, own Records, branches, history.
- **chain:** a cap and its parents, up to a **root cap**, which a vault issues over Docs of its own or of vaults it
  governs.
- **role:** a named bundle of grants, a Value, named by its hash.
- **approval:** k owners' signatures over one digest.
- **ticket:** a one-time key that holds a cap until a vault claims it. An invite is one.
- **public:** a holder meaning every member of the network, and never anyone outside it.
- **revocation:** a signed Record that ends a cap and everything resting on it.
- **ack:** a writer's mark inside an envelope that it has seen a revocation, carrying that revocation. It ends a
  revoked holder's writes in a Doc where the revocation itself doesn't live (rule 14).
- **kept list:** what a revocation keeps: for each Doc its revoker holds, the revoked holder's last envelope it had
  seen.
- **letter:** a sealed Value from one vault to another, which is how a cap reaches its holder.

**Keys**

- **epoch:** one key of a Doc, from one rotation to the next, named by the hash of its key blob.
- **key blob:** an epoch's key sealed to each of its readers, with a commitment to it and a link to the epoch before.
- **reader:** what an epoch is sealed to: a vault, through its vault key, or a group, through its group key.
- **keyring:** a vault's own Doc of keys, the first part of its safe, and the only Doc sealed to devices.
- **safe, safe runtime:** a vault's Doc of secrets, and each host's protected place that alone can open it
  ([the safe](#the-safe)).
- **vault key, group key:** X-Wing key pairs. The private half lives in the keyring or the group's Doc; anyone can seal
  to the public half.
- **rotation:** a new epoch, sealed to the readers that remain.
- **keeper:** a role any peer can take: keeping and serving sealed bytes it can't open, under a keep cap. The Aven Peer
  is one, and so is any member's Peer.
- **fetch key:** what a device proves it holds to be served a Doc's sealed bytes. Each epoch's is signed by the one
  before, back to the Doc's genesis.

## The rules

Each rule is held by a Lean theorem or a check once there is code to hold.

1. **Keys sign; vaults hold.** Only a key signs, and only a vault, a group of vaults (rule 13), a ticket or the public
   (rule 33) holds a cap. A device signs for the vault it serves, within its device cap.
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
   change's footprint. One that doesn't count is kept but shows on no branch, and neither does anything built on it
   (docs rule 10).
10. **Without the key, the key's holder checks.** A holder without `read` gets only what a kernel or a serving peer runs
    for it, and only the operations its cap names. For actors and agents, that holds query by query.
11. **Hidden is not refused.** A peer refuses what no cap grants, whether or not an app showed it.
12. **Caps live where their checkers read them.** A Doc's caps and revocations are Records in that Doc. A cap on a
    vault's Docs lives in the group that opens them. A cap reaches its holder in a letter.
13. **A group can hold a cap.** What a group holds, everyone in it holds, and a write under it carries the writer's way
    into the group. A cap someone issues from a group's cap lives only while its issuer is in the group.
14. **Revocation wins over what it had not seen.** It ends the cap and every cap resting on it.
    - A revoked holder's envelope that has the revocation in its own past never counts.
    - Under a Doc cap, the revocation lives in the Doc, and only its own past is kept. No other writer's ack can add to
      it.
    - For a cap whose revocation lives elsewhere (a vault's Docs, a group, a device's removal), it takes effect in each
      Doc at its kept list, or at the first envelope of another writer there that acks it. Only what those had seen is
      kept. A writer who vouches this way could have written the same itself.
15. **Removal closes reading at the next epoch.** Before writing, the next writer of each Doc a removed reader could
    open rotates its key. What was read stays read; no system can take it back.
16. **A write uses an epoch no older than any in what it builds on.**
17. **Docs are sealed to readers, readers are vaults or groups, and only a keyring is sealed to devices,** to their
    safe runtimes. A device
    added reads at once. A device removed costs its vault one rotation, then each group and Doc it could read one
    rotation at its next use.
18. **Keys travel with what they open.** An envelope names its epoch, an epoch names its key blob, and an epoch links to
    the one before. Nobody waits for a key sent apart, and a new reader can read history while no one else is online.
19. **Nothing is re-encrypted.** A rotation seals a new key for what is written next. Bytes at rest keep the key they
    were sealed with.
20. **Hybrid where authority lasts.**
    - X-Wing for every key sent.
    - Hybrid signatures on caps, revocations, governance, approvals, letters, segments and checkpoints.
    - Ed25519 on single live envelopes, which their segment's hybrid signature covers once the segment closes.
    - Every seal and every signature names its suite.
21. **A passkey's act needs both proofs:** the WebAuthn assertion, which proves the authenticator and the person
    (ES256), and the hybrid signature derived from its PRF (post-quantum).
22. **The keeper is blind.** It keeps and serves sealed bytes under keep caps. It checks the door, quota, that each
    fetch key is signed by the one before (D21), and the proofs that an uploading or fetching device holds the Doc's
    current fetch key, never a write cap. It learns no content,
    type, signer, writer, cap or reader list, beyond what serving a device shows
    ([metadata](#metadata-what-hosts-still-see)).
23. **As little as possible outside the seal** (Samuel, 30 Oct 2026). Outside a segment are only its Doc, its key epoch
    and its padded length. The signer, its writer id and counters, the previous segment, the branch and everything
    else are inside. A keeper serves catch-up by its own arrival order. Readers check a writer's order and catch splits.
24. **A want grants nothing.** A device is served its wants intersected with its caps; an actor is handed its loads
    intersected with its run's caps (engine, rule 7).
25. **Approval is a co-signature over one digest:** k of the named owners, for one act, used once. **What is shown is
    what is signed:** avenOS renders the act being approved by decoding the exact bytes the passkey signs, never from
    a separate copy, and Lean's vectors include that rendering (A2).
26. **Conditions only narrow.** Uses and budgets hold only where one checker counts them: a kernel or a router.
27. **It fails closed.** An envelope counts, doesn't count, or waits for a key, a cap or what it builds on. What it
    names is in its own past or inside it, so a wait is always for something known by hash, and every wait raises the
    stall alarm (README, rule 3). It counts when it fits, is authorized and isn't a split (the docs layer's three
    verdicts), and everything it builds on counts. Fit never changes. A revocation can later turn "authorized" into
    "doesn't count", and the Doc's state is then rebuilt from its envelopes.
28. **No global state.** No check needs the whole tree, a sequencer, a list of every cap or a scan of everyone's
    letters. Proofs travel with the acts, and each check reads only the Docs it concerns.
29. **Every format names its scheme.** A key blob says flat or tree, and seals and signatures say their suite. Scale and
    new cryptography come in as new schemes, never as a redesign.
30. **Recovery is never one key,** except MaiaCityGuardian through the evaluation phase (D12), with its exit written
    [below](#recovery).
31. **The UI holds no rule.** avenOS asks the engine's dry run, and shows each grant as it is, never only a role's name.
32. **Lean first.** Every rule here is a theorem or a check before it is code (README, rule 10).
33. **The public is the network's members** (Samuel, 30 Oct 2026). A public cap reaches every member of the
    invite-only network and nobody outside it. A Doc it reads is sealed to the members, so nothing is ever plain, and
    the public never shares.
34. **Secrets never leave a safe runtime** (Samuel, 30 Oct 2026). Everything else holds handles and asks the safe
    runtime to act ([the safe](#the-safe)).
35. **A lens grants nothing until it is pinned** (Samuel, 30 Oct 2026, the architect's extension of A7). A lens inside
    one type Doc is published by whoever may write that type Doc. A lens between two type Docs is a Value anyone may
    write, and it takes effect for a Doc or a vault only when its owners pin it, as they pin type versions: a write to
    the pins, with their approval (D14). A reader reads through the lenses pinned where it reads, and an actor through
    the receiving vault's. A pin that would make a second path between two versions is refused, and the checker holds
    a lens to the laws before its pin counts (docs, rule 19).
36. **A sealed index holds only what all its readers may read** (A26, decided 30 Oct 2026). An index is sealed under
    the key of its directory and holds fields only from Docs every reader of the directory can read, so a Doc with
    fewer readers never enters it. Equal index Values under one key get equal sealed names (a keyed nonce), so two
    readers' rebuilt roots compare. Its nodes are padded (D18). Only a device that may write the directory folds in
    recent entries and publishes a new root.

## The model

```
 key ──signs for──▶ device ──acts for, within its device cap──▶ vault ──owns, governs──▶ vaults below
                                                                  │
                                    issues, on its own authority  │  or resting on a cap it holds
                                                                  ▼
             cap { issuer, holder, grants: [ target × operations × branches ], conditions, parent }
                                                                  │
                         holder: a vault, a group, the public, or a ticket until it is claimed
```

Four things remain when every concept is reduced to its job (avenACTOR's discovery document, §9):

| Essential | Its one job |
|---|---|
| **Key** | The only thing that signs or opens. Passkeys, device keys, ticket keys, recovery keys and fetch keys differ only in who keeps them |
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

A cap is a Value in avenDB's one codec: deterministic CBOR in the strict profile of A2 (Samuel, 30 Oct 2026;
[`ARCHITECTURE.md`](../../ARCHITECTURE.md)). Its id is the BLAKE3 hash of those bytes. JSON is its readable form, and
the examples here are written in it; bytes appear as `b3:` or base64url text. Roles, key blobs, letters and revocations
are Values the same way.

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
      "branches": "main" } ],
  "conditions": { "expires": "2026-12-31T00:00:00Z" },
  "nonce": "9a0e…" }
```

| Field | Meaning |
|---|---|
| `issuer` | The vault that grants |
| `holder` | A vault (devices are vaults), a group (`g:<doc>`), a ticket's public key, or `public`: every member of the network |
| `parent` | The cap it narrows, by id, or `null` for a root cap |
| `grants` | Each a target, the operations on it and the branches it may write; or `role` and `target` instead |
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
definition's hash doesn't. So a definition names the one it `replaces`. A cap follows the upgrade while every message
it names keeps its schema, and a new or changed message isn't covered until it is granted. `replaces` is a claim anyone
can write, so it moves a cap only when the vault that granted the cap has adopted the new definition. A look-alike
elsewhere inherits nothing (Samuel and avenACTORS, 30 Oct 2026; `aven/actor/ARCHITECTURE.md`, sections 6 and 11).

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
| `own` | `patch` and `remove` only on Records the holder created: the signer of the envelope that made the Record, read from history, never from a field | Every reader |
| `branches` | `main`, a branch's hash, or `proposals` (every branch but main): writes only on proposals, and landing them on main is someone else's merge, which counts only when the merger's grant covers the whole merge. An agent's removals go this way (engine rule 12) | Every reader |
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
| A branch | Propose, don't land | Every reader | The same |
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
  passkey sign-in holds everything its vault may do except govern, as avenID has it today. A grant it prepares counts
  only with an owner's approval (D14). An agent's devices and the Aven Peer hold narrower ones.
- **Groups** (Samuel, 30 Oct 2026: a cap goes to one vault or a group of vaults). A group is a Doc whose readers are
  its members. It holds caps for them: a team editing the team's Docs, a family reading the family's photos. A write
  under a group's cap carries, inside the seal, the writer's read cap on the group. Groups aren't vaults, so they
  aren't in the tree the keeper sees, and making one needs no governance.
- **Actors** hold no keys (`aven/actor/ARCHITECTURE.md`, section 11). Agreed with avenACTOR and confirmed by Samuel on
  30 Oct 2026 (D16); the architect's avenACTORS thread carries them on:
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
- **The network's tree** is a Doc of signed statements, settled the same at every peer from the set of statements alone
  (A10 to A13, decided 30 Oct 2026; `settle` in `Aven.ID.Network`, PEERS.md §5):
  - the genesis is signed by the claimant's passkey and MaiaCityGuardian, and names the RP ID, the origins, the admin
    coop, the agent, the Aven Peer's key and the guardian's hybrid keys. Every member pins its hash, and only its
    descendants count (`genesis_pinned`, `settle_genesis`);
  - every claim names the guardian, so nobody joins without being shown who co-owns their vault (`guardian_consented`);
  - two claims of one ticket: the smallest hash wins (`settle_ticket_once`). A withdrawal wins over every claim not in
    its past (`settle_withdrawn`). An admin device's ack, naming the claim and having it in its past, makes it final,
    and no withdrawal wins over a final claim. An admin device acks only the claim that stands in its own view. Two
    acks that didn't see each other can make two claims of one ticket final; then the smaller hash wins and the ticket
    shows as contested (`settle_final`);
  - the relay and keeper lists are admin statements: a remove wins over every add that hadn't seen it
    (`settle_listed`);
  - the door admits exactly the member vaults' devices (`settle_door`), the same at every peer (`settle_perm`).
- **The public** is every member of the network, as the door admits them (`memberOf` the admin coop), and never
  anyone outside it (Samuel, 30 Oct 2026). There is no open, IPFS-style publishing.
  - A Doc the public reads is sealed to the network's members group, which a member joins when they join and leaves
    when they are removed.
  - The public may write, mutate and tell where the cap says. The city-dome is such a Doc: every member reads and
    writes its lines, and readers check a writer's membership in the tree.
  - The public never shares, since nobody can delegate for everyone. Granting it is a grant (D14).

## Issuing, delegating and delivering

**Who signs what:**

| Act | Signed by |
|---|---|
| Every grant: a root cap, a child cap, a ticket, a group's new reader | The granting vault's owners, k of n (an approval). Today that is one passkey tap, since any one owner suffices (Samuel, 30 Oct 2026, for now) |
| A public cap | The granting vault's owners, k of n |
| Governance | Owners, k of n (avenID) |
| A new device's device cap | The passkey sign-in that adds the device, which is already an owner's act |
| An actor's narrower cap, message by message | The kernel, inside a cap someone approved. Not a new grant |
| A revocation | Any device of a vault that may revoke. It only takes away, so a lost passkey never stops it |

Approvals bind what others check: writes, `share` and `tell`. Reading is holding a key, and anyone holding a Doc's key
can pass it on without an approval. No approval stops that, as no system stops a reader from leaking (rule 15).

A root cap is issued by the target's vault or by a vault that governs it: authority runs down the tree.

**Delegating needs no one online.** The holder signs a child cap that narrows its own and writes it where its target's
caps live. Readers check it when they meet it, as Biscuit's offline attenuation does without Datalog.

**Where caps live** (rule 12):
- **A Doc's caps, revocations and epochs** are Records of avenID's types `cap`, `revoke` and `epoch` in the Doc's
  access map, sealed with the Doc. Its readers are exactly its checkers, and they see who else reads and writes it.
- **A cap on a vault's Docs** lives in the Doc of the group that opens them. A reader given only one Doc can't open
  that group, so every envelope carries, inside the seal, the caps it rests on, and every ack carries the revocation it
  names. A reader of one Doc sees only the caps its writers use.
- **A tell cap** lives with the receiver's vault, where its router checks it.

**Letters.** A cap reaches its holder in a letter. The sending device hybrid-signs the letter's content together with
its recipient, and the signature goes inside the seal to the holder's vault key. So the keeper can't see who sent it,
and nobody can pass it on as if it were sent to someone else. It carries:
- the cap;
- the ids of the target's Docs or group;
- the holder's **tag seed** for finding its stanzas.

The first letter between two vaults goes to the recipient's letterbox, so the keeper can tell whose box it is. Later
letters use tags only the pair can compute. A letterbox takes a bounded number of first letters per sending device per
day.

## Checking

An imported envelope runs through the docs layer's import, in its order
([docs](../../db/docs/README.md#importing-three-verdicts)). The steps marked **caps** are this spec's, and the engine
checks the footprint ([engine](../../db/engine/README.md#who-checks-what)):

1. **Limits** on the sealed bytes, before anything is decoded (docs).
2. **Open** it with its epoch's key, from the keyring or from the key blob its header names, or wait for the blob.
   Key-committing AEAD (**caps**).
3. **Decode** it canonically, and check the device's signature (docs).
4. **Signer:** the device served the signer's vault in the tree as the reader holds it (**caps**).
5. **Log:** the writer id, its sequence and the envelope before, and splits (docs).
6. **Dependencies,** by hash. A wait raises the stall alarm (docs).
7. **Epoch and authority** (**caps**):
   - the epoch is no older than any epoch in what the envelope builds on (rule 16);
   - either the signer's vault is the Doc's vault, or governs it, and the device acts within its device cap;
   - or the envelope names a cap whose chain holds:
     - **valid:** signatures, approvals, every link narrowing, conditions;
     - **live:** kept by every revocation on the chain that the reader holds (rule 14);
     - **covering:** its footprint covers the change; with `approve`, the approvals over this envelope's digest; and
       for a group's cap, the writer's live read cap on the group, and the issuer of each child still in it.

   The chain comes from the Doc's access map or from inside the envelope.
8. **Loro's own checks** (docs).
9. **Fit,** and the footprint for the engine: a named operation is re-lowered, and the change must be what it produces.
10. **Counts:** fit, authorized and not a split, and everything it builds on counts.

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
| Fetch and upload proofs, quota, keep caps | The keeper | Every request |
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
| Device | X-Wing, Ed25519 and ML-DSA-65, made in the device's safe runtime, never leaving it, never derived from a passkey | Nothing: its public halves are in its statement | On suspicion, or on a schedule | One statement |
| Keyring | A key per epoch, and the vault key inside | Its devices; each passkey's PRF-derived seal key; MaiaCityGuardian during evaluation. A coop's goes to its owners' vault keys | A device or a sealing owner leaves | One seal per device |
| Group | A key per epoch, and the group key inside | Its readers: vaults and groups | A reader leaves; a reader's vault key changes | Flat: one seal per reader. Tree, later: one path, about log n |
| Doc | A key per epoch | Its readers: its type's group, the groups it's shared with, at most 64 single vaults | At its next write after a reader leaves or a reader's key changes | One seal per reader, usually one or two |

**Every vault starts with groups for its own Docs:**
- one for all of them;
- one per root type it uses.

A Doc is sealed to its type's group, the type group to the all group, and the all group to the vault itself and to
everyone who reads all its Docs. Granting read on a vault's Docs is joining one group: one seal, and no Doc is touched.
`below` uses a group per vault that reads the all group of every vault it governs. Its keys are sealed downward, so
holding it reads a vault's Docs and those below it, never those above.

A Doc shared with more than 64 vaults one by one is shared with a group instead.

### Epochs

An epoch is named by the BLAKE3 hash of its key blob:

```json
{ "doc": "d:7Hq…", "n": 12, "prev": [ "b3:…" ], "scheme": "flat 1",
  "stanzas": [ { "tag": "…", "ct": "…" } ],
  "commit": "…", "back": "…" }
```

- **`stanzas`:** the epoch's key sealed with X-Wing to each reader's vault or group key. Each stanza is found by a
  **tag**, a keyed BLAKE3 of the reader's tag seed, the Doc's id and the epoch number. Only readers and writers of the
  Doc can compute a tag, so the keeper can't link a reader, or the Docs of one group, across Docs or epochs. The list's
  length is padded with Padmé, at most about 12 % (D18).
- **`commit`:** a commitment to the key. A reader opening a stanza checks it, so a stanza with a wrong key is found at
  once (avenDB-old never checked what its boxes held).
- **`back`:** the previous epoch's key, sealed under this one. With it, the newest key opens all of history, for a
  reader granted `history: all`. A `from-now` grant rotates without it. Old readers keep the old keys in their keyrings.
  Through a group, `from-now` can't hold: the group's own `back` opens its past keys, and those open its Docs' past
  epochs. Joining a group reads its history, so where `from-now` matters, share per Doc.
- **`scheme`:**
  - `flat 1` now;
  - `tree 1` later, for big groups.

  Caps, envelopes and checks never see which (rule 29).

**Rotation:**
- Before writing, a writer rotates when its Doc's epoch isn't sealed to the current key of every reader, or still
  seals to a removed one. The writer knows both from the tree and the groups.
- Two writers may rotate at once. Both epochs are valid, nothing has to be merged, and the next writer uses the one with
  the smaller hash. Where forks follow forks, each goes to the smaller hash, from the genesis on, and keepers take the
  same epoch as current (`Keep.current`). No sequencer is needed, which is what MLS lacks and what DMLS and BeeKEM
  were built for.
- A Doc nobody writes is never rotated, and needs no rotation: nothing new in it is left to protect.

**Readers check only staleness** (rule 16). A malicious writer can always leak what it writes, so checking its epoch
protects nothing more. The rule catches honest but lagging code, which is what avenDB-old's unchecked epochs let
through.

### Sealing

- **Subkeys** come from an epoch's key by BLAKE3's key derivation, one label per use:
  - `avenDB envelope 1`;
  - `avenDB segment 1`;
  - `avenDB snapshot 1`, for checkpoints;
  - `avenDB fetch 1`;
  - `avenDB topic 1`;
  - `avenDB converge 1`.
- **Envelopes, segments and checkpoints** use XChaCha20-Poly1305 with a key commitment. A segment holds one epoch, so a
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
old keys are kept, and the newest key opens the past through `back`. Live changes are closed into segments under the
same key afterwards, so a ratchet on the live channel would add nothing. Forward secrecy exists only for what is never
kept, such as presence, typing and calls (later).

**Healing after a stolen key** (post-compromise security) is an act, the **heal**:
1. the owners revoke the device;
2. the remaining devices make new device keys;
3. the keyring rotates, with a new vault key, new tag seeds and new letterbox keys;
4. every group the vault is in rotates;
5. each Doc rotates at its next use.

That costs one rotation per group, in the background, busiest first. When it runs (Samuel, 30 Oct 2026, D19):
- **Device keys rotate monthly** by themselves. That is cheap, and it limits how long a key copied from a disk stays
  good.
- **The full heal runs on suspicion,** and whenever a device is removed.
- **A scheduled full heal for everyone** waits for the tree: with flat groups, each heal re-keys every group its person
  is in.

Without a heal, a key copied in silence stays good, as in every encrypted store.

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

Keeping is a role any peer can take (D21). Phones and browsers are rarely online at the same time, so some peers keep
a Doc's sealed bytes for its readers: any member's own Peer, or the Aven Peer. None is special.

A keep cap tells a keeper what to keep and nothing about what it is:
- the Doc ids, or the group whose Docs to keep;
- each Doc's first fetch key, from its genesis;
- the gossip topics;
- the quota.

**Fetch keys chain** (A22, Samuel, 30 Oct 2026). Each epoch's fetch key comes from its key (`avenDB fetch 1`). The
rotation's writer signs a link with the fetch key before it: the Doc, the epoch's depth `n` and hash, and the new fetch
key's public half. A keeper takes a link on that signature alone, since it reads no caps:
1. A link counts only if it is for this Doc, one epoch deeper than the key before it, and signed by that key, which the
   keeper has taken. So every fetch key a keeper takes chains back to the genesis (`fetch_chain`), and nobody who
   never held one of the Doc's fetch keys can change it.
2. It keeps every successor (`kept_every`). Where two follow one key, it takes as current the one with the smaller
   epoch hash, as writers do, and flags the fork (`fork_flagged`). Keepers holding the same links agree on the current
   fetch key, whatever order the links came in (`current_agrees`).
3. It takes and serves a Doc's sealed bytes only for a device that signs the connection's TLS exporter with the current
   fetch key (`served_current`). So "nothing leaves for a device that may not receive it" (engine, rule 13) holds at a
   keeper that can't read caps, and nobody outside a Doc can fill it with junk.
4. The uploading vault pays, and only for what the keeper took from it (`uploader_pays`). Uploads are taken in the
   order they come, each only while its vault's spending stays within the quota the keep cap gives it, so no vault ever
   spends past it (`quota_holds`, R10).

Key blobs and letters are served to any member, since they are useless without the keys they're sealed to. A device
whose proof is refused because a newer epoch came fetches that epoch's key blob, opens its stanza and proves again.

**How a ground fork settles** (A22, the architect's answer to this spec's open question, 30 Oct 2026). A reader of an
earlier epoch still holds that epoch's fetch key. Once removed, it can fork the chain from there and grind its epoch
hash below the writers' (`grind_example`). Writers check the rotation's cap and never take that epoch. A keeper can't,
so:
1. while a fork is flagged, it serves proofs by either branch's newest key, so honest readers are never refused
   (`fork_served`);
2. a device of the vault that issued the keep cap, which can check caps, signs which branch to follow, naming the fork
   point. Its devices do this on their own;
3. the keeper checks that signature against the tree, follows that branch, and later forks from that point change
   nothing (`grind_settled`, `settled_example`).

**Catching up from a keeper** knows nothing about writers (rule 23):
1. The keeper numbers each Doc's segments in the order they arrive.
2. A device asks "what came after your number n?" and gets their hashes.
3. It fetches only the blobs it lacks.

A device that got segments elsewhere pays 32 bytes per segment for the list. For many Docs at once, range-based set
reconciliation over the hashes keeps even that small (engine, "What we take from iroh"). Order within a writer's chain,
and a device writing two histories at once (a split), are checked by readers, who see both inside the seal.

## Revocation

| What ends | Who may end it | Its writes stop counting | Its reading ends | Who must be online |
|---|---|---|---|---|
| A cap | Its issuer, any issuer up its chain, the target's vault, or the holder (renouncing) | From its first ack in each Doc | At each Doc's next write | The revoker |
| A device | Its vault's owners, k of n | From the first ack of the removal in each Doc | Keyring at once; groups and Docs at their next use | One owner's device |
| An owner | The owners, k of n, or recovery | Governance: avenID | Keyring at once, if it held keys | The owners |
| A network member | The admin coop | The door closes at the relay and every peer, and public caps stop reaching them at once | The members group rotates at once, so public Docs rotate at their next write. Caps others gave them stand until revoked, behind a closed door | An admin |
| A ticket | Its issuer (a withdrawal) | Nothing to stop before the claim | | The issuer |
| A public cap | As any cap | From its first ack in each Doc | At each Doc's next write | The revoker |

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
ack on it is final like any other: a write the ack hadn't seen doesn't count, whatever time it claims (`time_acked`).
Until the first ack, a write is judged by the time it claims (`before_ack`).

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

**Its exit comes before the network opens beyond the founding circle,** whatever else is ready (Samuel, 30 Oct 2026):
1. one act per vault removes it as an owner;
2. the same act rotates the keyring, so nothing new is sealed to it;
3. the guardian's secrets are destroyed. Everything it could open before stays open to whoever kept them, so destroying
   them is part of the exit.

Recommended on the way there:
- remove it from a vault as soon as that person has their own way back: a second passkey, a recovery kit, or chosen
  guardians;
- until then, keep its secret as 2-of-3 pieces in different places, so no single stolen copy is the master key.

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
- The input can be guessed, so any origin the passkey's RP ID covers could ask for the same output. A dedicated RP ID
  for avenOS, with a secret mixed into the input (A14), is not yet (Samuel, 30 Oct 2026). Until then, the origins are
  few and their releases signed (A15).
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

## The safe

A vault's **safe** holds its secrets (Samuel, 30 Oct 2026, D17):
- its device and vault keys, which the keyring holds today;
- the Doc keys it has learned;
- later, passwords, API tokens, SSH keys and other services' credentials.

It is a Doc like any other, synced by avenDB, and it opens only inside a **safe runtime**: each host's protected place.
It works like a password manager, except that the secrets are never handed out.

**Rules:**
1. **Secrets never leave a safe runtime.** Everything else holds handles and asks the safe runtime to act: sign, open a
   stanza, seal, derive, fill a login, or call a service with a credential. What comes out is signatures, ciphertexts,
   public keys and answers.
2. **It opens nowhere else.** The safe is sealed to each device's safe-runtime key, which never leaves its safe runtime.
   So sync carries only ciphertext. Adding a device seals the safe to the new device's safe runtime.
3. **Unlocking is the safe runtime's:**
   - biometrics, the passkey's PRF, or a timeout;
   - a sensitive act can ask for an approval (rule 25).
4. **Actors and agents use secrets without holding them.** The safe runtime is a door actor whose messages are its
   operations. `tell` caps name them, and it checks the cap again before it acts (D16). An agent can call a bank's API
   with a token it never sees.
5. **Doc keys may be lent to the engine,** in memory, to decrypt quickly, and are wiped when the Doc closes. Identity,
   vault and safe keys never are. A host may keep even Doc keys inside its safe runtime.

**One interface, a backend per host,** as the store has one contract for S3, a folder and OPFS:
- a Rust trait: `unlock`, `lock`, `sign`, `open`, `seal`, `derive`, `use` (a credential, for an operation) and `enroll`
  (seal the safe to a new device);
- one backend per host;
- a Lean model of what may ever leave the safe (`safe_holds`).

| Host | Safe runtime | Strength |
|---|---|---|
| Mac and iOS app | A separate process, its keys in the Secure Enclave or wrapped by it, unlocked with Face ID or Touch ID. avenDB-old already signed with ML-DSA-65 from a Mac's enclave | Strong |
| Android | Keystore, with StrongBox or the TEE | Strong |
| Windows | The TPM, through Windows Hello | Strong |
| An always-on Peer (the Aven Peer, or a member's own) | A separate process, its keys sealed at rest; a hardware security module later | Medium |
| A browser (the Peer-Light) | The Peer-Light's dedicated worker on its own origin, never avenOS's page. Keys at rest wrapped with a WebCrypto key that can't be exported. A strict Content-Security-Policy, and no third-party scripts. Unlocked by the passkey's PRF; "lock when idle" (one passkey tap per session) is a setting later | Weakest, but apart from every app's page |

**Its limits, honestly:**
- The browser tier guards only against other pages' code. A bug on the Peer-Light's own origin can use the keys while
  it is unlocked.
- A compromised operating system beats any app.
- Enclaves run only the algorithms they support. Where ours aren't among them, the enclave guards a wrapping key, and
  our keys are used only inside the safe runtime's process.
- Changed code served from the safe's own origin would run with its keys. Releases are signed (A15, Samuel,
  30 Oct 2026): in the browser, a Service Worker on the safe's origin checks a release's signature before new code
  takes over, which raises the bar but can't close it, since a browser re-checks a worker's script against its
  origin. The Mac app checks signatures before it runs new code, which makes it the trusted path.

The safe gets its own spec, `aven/DB2/id/safe`, when its milestone comes.

## Post-quantum

| What | Suite | Why |
|---|---|---|
| Every key sent: stanzas, letters, the keyring | X-Wing | Harvest now, decrypt later. Hybrid holds while either ML-KEM or X25519 holds |
| Caps, revocations, approvals, governance, letters, segments, checkpoints | Ed25519 + ML-DSA-65 | Authority that lasts. One per segment covers up to 256 envelopes |
| Single live envelopes | Ed25519 | Their segment's hybrid signature covers them once it closes; 64 bytes instead of about 3.4 KB each |
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
| A keeper (the Aven Peer, or a member's own Peer) and its storage (Hetzner, for the Aven Peer) | **The tree:** vaults, owners, devices, network members and public keys, because the door needs them. **Per Doc:** its id, its epochs and their stanza counts (padded), sizes (padded), times, and which device uploads or fetches what. Nothing about a segment's writer: no pseudonym, counters or chain (rule 23). Letterboxes on first contact; the gossip topics it keeps | Content, types, signers, caps, who reads which Doc, groups' rosters, operations |
| A network member who doesn't read a Doc | Its key blobs (sealed stanzas and their padded count) and letters, all sealed. Its topic and fetch key come from its key | Content, readers, writers |
| A reader of a Doc | Its caps, its writers and how many read it; the caps of the groups that open it | Caps on other Docs |
| A peer on a direct path | The other's IP address (README) | |

- **Sealed sender stops at the upload.** The signer is inside the seal, so stored bytes and forwarding peers never show
  it. The keeper still knows which device uploaded what, from the connection.
- **Everything is padded** (Samuel, 30 Oct 2026, D18). Live messages round up to 256 B, 1 KiB or 4 KiB, and above that
  to Padmé (PURBs); segments and files use Padmé. That costs at most about 12 % and hides all but a few bits of a size.
  Signal pads its messages too.
- **Access patterns** (who fetches what, when) are the largest leak left. Batched fetches through other members and
  mixing can come later without changing a format, because an envelope's outside is only its Doc, its epoch and its
  length.
- **Good enough for now** (Samuel, 30 Oct 2026). The Aven Peer still sees each Doc, its sizes and times, how many key
  changes, and which device connects to upload or fetch. Hiding that last one needs mixing, which comes later.
- **Nothing is ever plain** to the keeper: public Docs are sealed to the network's members (D15).
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
| A group of 10,000, one leaves | Flat: about 12–13 MB of stanzas once, padded with Padmé | Flat | Tree: about 14 nodes, roughly 20–30 KB | The key blob's `scheme` byte; vault and group keys are the leaves either way |
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
| docs (`db/docs`) | Envelopes, branches, Records, fit | **Decided by Samuel (30 Oct 2026, D13):** outside a segment are only the Doc, the key epoch and the padded ciphertext. Keepers serve catch-up by arrival order. Inside are the branch, the writer id and counters, the previous segment's hash, the signer, the cap, acks, the operation and params, the changes and the schema. The docs thread had proposed the peer, counters and previous hash outside. **Agreed with the docs thread:** Three verdicts (fit, authorized, not split), and a revocation rebuilds state. A segment holds one epoch, and a rotation closes it. Snapshots and heads are each device's own and never travel. Checkpoints travel from the Loro docs step on (A5), sealed with the `avenDB snapshot 1` subkey and hybrid-signed. A merge is checked against the merger's grant over the whole merge. Each segment carries its writer's hybrid signature. A Doc's genesis fixes its vault and root type (docs D11). A Record's creator is the signer of the envelope that made it, read from history and never from a field, so `own` can't be faked by an edit. Every Doc pins caps' built-in types `cap`, `revoke` and `epoch`, beside docs' `branch`, `closed`, `version` and `split` |
| engine (`db/engine`) | Operations by hash, footprints, wants, the dry run | E1–E3; served is wants intersected with caps; `query` checked by the kernel or serving peer |
| store (`store`) | Blobs and refs | Sealed blobs; key blobs and letters are blobs; the sealing parked in its "Later: sealing" comes here |
| avenPEER | The door, relays and keepers, any peer | `settle`, the tree's one rule (`Aven.ID.Network`); keep caps, fetch-key links and proofs, quota, letterboxes, topics per group |
| actors (`aven/actor`) | Runs, routers, inbox Docs | **Agreed with avenACTOR and confirmed by Samuel (30 Oct 2026, D16):** a `cap` beside `run` on every message; no confused deputy; `tell` caps by name, pinned by the definition's hash; actor targets by address, by spawn and by definition; an inbox Doc belongs to the sender's vault and is born with the tell cap; actors at home on the Aven Peer are readable there |
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
   **A group of vaults can hold a cap too** (Samuel, 30 Oct 2026): a cap goes to one vault or a group of vaults
   (rule 13). Otherwise a team's caps would be issued once per member, and a group would have to be a vault in the tree
   the keeper sees.
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
   - Flat now. A BeeKEM-style tree for big groups behind the `scheme` byte, which drops in later (Samuel, 30 Oct 2026).
     Work on it starts when Maia City passes about 150 members. Nested groups and batched rotation past that.
   - Not MLS: it needs a sequencer, deletes history, and treats every device as a member.
8. **A revocation keeps what it names and wins over the rest** (Samuel, 30 Oct 2026). Acks carry it to Docs the revoker
   doesn't hold. Writes stop counting from the first ack; reading ends at the next epoch; only the revoker must be
   online.
9. **The keeper is blind** (Samuel, 30 Oct 2026). It checks the door, quota, keep caps, fetch-key links and fetch
   proofs, never a write cap. avenDB-old's relay check (T25) needed the plaintext graph, and avenOS's relay kept every
   bad write.
10. **Hybrid signatures where authority lasts** (Samuel, 30 Oct 2026). Ed25519 + ML-DSA-65 on caps, governance,
    segments and checkpoints; Ed25519 on single envelopes; an owner key derived from the passkey's PRF.
11. **The passkey PRF step** (Samuel, 30 Oct 2026). The PRF opens the keyring the keeper keeps, so a new browser needs
    no other device. Device keys are made fresh. Pairing and a recovery kit cover the gaps.
12. **MaiaCityGuardian stays a full owner through the evaluation phase** (Samuel, 30 Oct 2026), its keyring seal
    included. It leaves before the network opens beyond the founding circle (Samuel, 30 Oct 2026): one act per vault
    removes it and rotates the keyring, and its secrets are destroyed.
13. **The keeper sees as little as possible** (Samuel, 30 Oct 2026). Outside a segment are only its Doc, its key epoch
    and its padded length. Keepers serve catch-up by arrival order, and readers check writers. The docs thread had
    proposed showing each writer's pseudonym, counters and previous segment, so a keeper could serve by version and
    catch splits. Arrival order serves catch-up as well, and readers already catch splits. What the Aven Peer still
    sees (each Doc, sizes, times, key changes, which device connects) is good enough for now; mixing comes later.
14. **Every grant needs its vault's owners' approval, for now** (Samuel, 30 Oct 2026). Today that is one passkey tap.
    Three things aren't grants and need none:
    - a new device's rights, approved by its sign-in;
    - an actor narrowing its cap per message;
    - a revocation.

    One-Doc read shares from a trusted device may be relaxed later, once there is a case.
15. **The public is the network's members** (Samuel, 30 Oct 2026). A public cap reaches every member of the invite-only
    network, sealed to them, and may write where the cap says, as in the city-dome. There is no open, IPFS-style public:
    nothing is ever plain to the Aven Peer. The public never shares, and granting it is a grant (D14).
16. **Actors act under caps** (Samuel, 30 Oct 2026), as agreed with avenACTOR.
    - Actors hold no keys.
    - Every message carries a cap beside its run, narrowing at each hop, and no confused deputy.
    - Tell caps name messages. Actor targets go by address, by spawn or by definition.
    - An inbox Doc belongs to its sender and is born with the tell cap.
    - Where an actor lives decides who can read it.
    - A definition names the one it `replaces`. A cap follows the upgrade while its messages keep their schemas, and
      only in a vault that has itself adopted the new definition.

    The architect's avenACTORS thread carries them on.
17. **The safe** (Samuel, 30 Oct 2026). A vault's secrets live in its safe, a Doc synced by avenDB that opens only in a
    safe runtime. There is one interface, with a backend per host: the Secure Enclave, Android's Keystore, Windows' TPM,
    an always-on Peer's own process, and the browser's own-origin worker. Secrets never leave it; everything else asks
    it to act.
18. **Everything is padded** (Samuel, 30 Oct 2026). Live messages to fixed sizes, segments and files with Padmé.
19. **The heal** (Samuel, 30 Oct 2026). Device keys rotate monthly. The full heal runs on suspicion and on a device's
    removal. A scheduled full heal for everyone waits for the tree.
20. **Write without read comes later** (Samuel, 30 Oct 2026), at its first real case: likely invoices sent to a coop.
    A Doc's epoch would also carry an X-Wing key that drop-box writers seal to.
21. **Keeping is a role any peer can take** (Samuel, 30 Oct 2026, A22). Any peer may keep a Doc's sealed bytes for its
    readers under a keep cap, and none is special; nothing is framed as a server. A keeper checks who may add or fetch
    by key proofs, never by reading. Fetch keys chain from the Doc's genesis, each signed by the one before. It keeps
    every successor, takes the smaller epoch hash as current, as writers do, and flags a fork. The uploading vault
    pays.

Agreed with the engine thread (30 Oct 2026):

- **E1.** Footprints carry verbs, fields and constraints, computed once from the lowering.
- **E2.** `where` is checked only on fields that never change.
- **E3.** Caps name the lowered core operation's hash, and an envelope carries its operation's hash and params.

## What Lean proves

`Aven.ID` holds caps' model beside `Governs`, in `id/spec` (Lean 4.35.0, core only, no `sorry`; `lake build` in the box
proves it). Its examples on the cast carry their answers, written by hand and checked as it builds: by `decide`, or by
`#guard` where they go through UTF-8. `lake exe vectors` exports them with generated cases (README, rule 10).

What a grant reaches is `Aven.Core`'s (`core/spec`), which `id/spec` requires. A **line** of a grant is a target in
Core's grammar, a verb, and for a write the footprint grants each step must keep. A line lies within another when its
target is narrower (`Target.le`), its verb the same and its footprint grants no wider, so a chain narrows by Core's
`Target.le_sound`. Caps defines no Values, hashes or targets of its own.

| Module | Theorem | Says |
|---|---|---|
| `CapsCbor` | `Cap.digest_inj` | Two allowed caps with one id say the same thing: the bytes approved and signed name the cap exactly |
| `Authorized` | `authorized_signer`, `authorized_root` | Caps' verdict on a Core envelope: its chain keeps every rule, its last cap is held by the signer's vault, and every step of its footprint is one the chain's root allows on its Doc, on its root issuer's authority (R4) |
| | `counts_iff` | An envelope counts exactly when everything in its past is signed, fresh, authorized, live and fit, and none of it is half of a split. `Aven.Architecture` composes the parts |
| | `readers_agree` | Two readers that hold the same past of an envelope, and the same splits in it, give it the same verdict, whatever else each holds |
| `Caps` | `narrow_chain`, `narrow_steps` | No cap in a chain lets a verb reach a Doc, or allows a write step, that its root doesn't |
| | `root_authority` | Every line a chain grants lies in its root issuer's authority: its own vault, one it governs, or a Doc of one |
| | `chain_short` | A chain is no longer than its root may be shared |
| | `grant_approved` | Every cap in a chain was signed by a device of its issuer and approved by its issuer's owners (D14) |
| | `child_live` | A cap issued from a group's cap holds only while its issuer is in the group |
| | `public_bounded`, `public_no_share` | The public passes nothing on and never shares (D15) |
| | `role_pinned` | A new version of a role changes nothing a cap naming the old one grants (D6) |
| | `chainError_none` | The first rule a chain breaks is none exactly when it keeps them all |
| `Approve` | `approval_exact` | An approval holds only with k distinct owners, each having signed exactly its digest |
| | `shown_is_signed` | What avenOS shows for a passkey tap is decoded from the exact bytes signed (A2, rule 25) |
| `Revoke` | `seen_never_counts` | A revoked holder's envelope with the revocation in its own past never counts: no laundering |
| | `doc_cap_kept` | Under a Doc cap, only the revocation's own past is kept |
| | `elsewhere_kept` | Elsewhere, once the revocation reaches the Doc, only what its kept list or another writer's ack had seen counts |
| | `revocation_wins` | The three together (rule 14). An envelope lists its whole chain, so revoking any link reaches it: the cascade |
| | `waits_named` | A wait names only what the envelope builds on and the reader lacks, by hash |
| `Epochs` | `confidential` | A key is learned only as one's own or by opening a seal with a key already known. Keys are any type with an equality (`WorldOf κ`): names in the examples (`World`), Core's bytes in `Aven.Architecture` (R5) |
| | `unknowable` | Keys of a closed set a party owns none of stay unknown to it; the next three are its instances |
| | `removal_next_epoch` | A new epoch sealed only to the remaining readers stays closed to a removed one |
| | `heal_evicts` | After a heal, a removed device learns none of the new keys: vault key, tag seeds, letterbox keys and next epochs |
| | `keeper_blind`, `outside_blind` | The keeper knows only its own keys, and sees of a segment only its Doc, epoch and padded length (D13). A segment is Core's `DocId`, its epoch's `Hash`, and the Core envelopes inside its seal (R5) |
| | `stale_refused` | A Core envelope under an epoch older than one it builds on doesn't pass (rule 16) |
| `Expiry` | `time_acked`, `claimed_late` | Time is a claim: once a writer whose clock had passed a cap's expiry acks it, a write the ack hadn't seen doesn't count, whatever time it claims; nor does one claiming a time past it (rule 12, R12) |
| | `before_ack` | The limit rule 12 accepts: until the first ack, a write is judged by the time it claims |
| `Recover` | `guardian_exit` | After MaiaCityGuardian's exit, no keyring epoch is sealed to it (D12) |
| | `never_ownerless`, `removals_win` | Removals that clash all stand, unless they'd leave no owner; then none does |
| `Network` | `public_member`, `removal_rotates` | A public write counts only from a member, and a removed member is in no later members epoch |
| | `ticket_once` | A ticket is claimed once, by the smallest claim hash, whatever order the claims arrive in (A12) |
| | `settle_perm`, `settle_genesis` | Peers holding the same statements settle the same tree, and nothing outside the pinned genesis's descendants changes it |
| | `settle_ticket_once`, `settle_withdrawn`, `settle_final` | A ticket founds at most one vault; a withdrawal beats every claim of it outside its past that isn't final; a final claim stays final, and stands unless an ack that never saw its ack makes a smaller one final |
| | `settle_door`, `settle_listed` | The door admits exactly the member vaults' devices; a list's entry stands only through an add that saw every remove of it |
| `Restore`, `Records` (avenPEER) | `settle_restore` | Production's stored statements, migrated in their ref order onto a genesis both its signers signed, all count in the settled tree; vectors in `settled.json` |
| `Network` | `genesis_pinned`, `guardian_consented` | Everything in the tree descends from the pinned genesis, which the claimant's passkey and MaiaCityGuardian signed (A11); a claim counts only if it names that guardian (A13) |
| `Keep` | `fetch_chain`, `kept_every` | A keeper takes exactly the fetch keys that chain back to the Doc's genesis, each signed by the key before it (A22) |
| | `current_agrees`, `current_chained` | Keepers holding the same links take the same current fetch key, whatever order they came in, and it chains |
| | `fork_flagged` | Every fork a keeper takes is flagged |
| | `served_current`, `fork_served` | A keeper serves a fetch or takes an upload only for a proof on that connection by the current fetch key, or, while a fork is unsettled, by a branch's newest key, so honest readers are never refused |
| | `quota_holds`, `admitted_served` | A keeper takes uploads in the order they come, each only while its vault's spending stays within the quota its keep cap gives it, so no vault's spending ever passes its quota; and it takes only what it serves (R10) |
| | `grind_settled`, `settled_example` | Once the keep cap's issuer chooses a branch at a fork, every keeper follows it whatever forks arrive after |
| | `uploader_pays` | The uploading vault pays, and only for what the keeper took from it |
| | `grind_example` | A removed reader's fork with a ground hash becomes current at a keeper until the issuer chooses; it is flagged, and honest readers are still served |
| `SealedIndex`, moving to `Aven.Architecture.Sealed` (the docs thread) | `index_within_key`, `index_skips` | An index holds only entries read under keys every holder of its key holds; one some holder can't read changes nothing in it (rule 36) |
| | `sealed_roots_agree` | Two readers holding the same admissible entries rebuild the same sealed root under one key, so each can check a published one. The root is a parameter here; `Aven.Architecture` joins it with the docs model's `root_set` |
| | `sealed_padded`, `root_by_writer` | Sealed nodes are padded (D18); only a vault that may write the directory publishes a root a reader takes |

**After Core, or with another thread:**
- `merge_covered` and `footprints.json` (Core's footprints, with the engine);
- `want_grants_nothing` and `one_grammar` (Core's target grammar);
- `authority_down` (`below` groups);
- `group_holds` (a group cap's writes in `Revoke`);
- `device_within_cap`;
- `safe_holds` (the safe's interface);
- `upgrade_no_wider` and `no_confused_deputy`, in the cross-spec model `Aven.Architecture`: they need `Aven.Actor`,
  and id/spec never requires the actor spec (the architect, 30 Oct 2026);

Two smaller gaps:
- An owner that is a vault approves by its own quorum, recursively. `Approve` counts owner keys only, so the cast's coop
  can't yet approve a grant.
- The Revoke model's reader holds one Doc; the order in which envelopes arrive changes nothing, because a verdict is
  computed from the Doc and the revocations alone.

**Vectors** (`id/spec/vectors/`):

| File | What |
|---|---|
| `caps.json` | Chains on the cast, their lines in Core's form, each cap with its CBOR bytes, its id and the bytes its device signs, and each chain with the first rule it breaks or none; how avenOS shows a cap; 40 generated chains |
| `revocations.json` | Docs, the revocations held, and verdicts: hand-written, and 30 generated Docs with every envelope's verdict |
| `epochs.json` | Who learns which key after Bob's removal and after Alice's heal |
| `approvals.json` | Signatures, thresholds and digests on the cast, and whether each approval holds |
| `expiry.json` | Writes under a cap that expires, with each envelope's signed time, and whether each counts for the clock |
| `network.json` | A ticket's claims in two orders (A12), removals that clash, MaiaCityGuardian's exit |
| `keep.json` | Fetch-key links in the order they came, with the keys a keeper takes, its current key and its flags; proofs and whether they're served; what each vault pays; 30 generated keepers |

A cap's bytes are its body in Core's deterministic CBOR, its targets as `Aven.Core.TargetCbor` writes them; its id is
their BLAKE3 hash, and its device signs them under the label `avenID cap 1` (`Aven.ID.CapsCbor`). The cast's caps go by
readable names, so a parent and a role are text until R5 makes them hashes. `derivations.json` follows once Core's
BLAKE3 gains its keyed and key-derivation modes. The primitives themselves (X-Wing, ML-DSA, Ed25519, the AEAD)
stay outside Lean, as Ed25519 does today. They are tested against their standards' known answers and Wycheproof.

## Order of work

A proposal for milestone 3's plan, for the architect:

1. **Lean:** `Caps`, `Revoke`, `Epochs`, `Approve`, `Recover`, `Network` and `Keep`, with vectors. The first pass is in
   `id/spec`; what waits for `Aven.Core` is listed [above](#what-lean-proves).
2. **avenID:**
   - owners k of n and approvals;
   - device removal and its acks;
   - devices' X-Wing and ML-DSA-65 keys in their statements;
   - vault keys.
3. **Keys:** keyrings, groups (flat), Doc epochs, key blobs and letters. The first sealed Doc is the city-dome, which
   takes up the store's parked sealing: `public` reads and writes its lines.
4. **Passkey PRF and the safe:**
   - the keyring's seal, sign-in on a new browser, and pairing as the fallback;
   - the safe's interface, and its first runtime: the Peer-Light's own-origin worker, wrapped at rest, with a strict
     Content-Security-Policy;
   - native runtimes come with the Mac app.
5. **Keepers:** keep caps, fetch keys that chain, fetch and upload proofs, quota, and catch-up by arrival order, on
   any peer.
6. **Caps on writes,** with the docs layer's envelopes (milestone 4). Until then, the chat's lines keep checking their
   signer's membership, and the room's key keeps them sealed.
7. **Later:**
   - the `tree 1` scheme, started when Maia City passes about 150 members (D7);
   - recovery owners with a delay;
   - nested groups and batched rotation for communities;
   - MaiaCityGuardian's exit, before the network opens beyond the founding circle (D12).

## Open questions

None at the moment. How a flagged fork of fetch keys settles, which the Lean model turned up, was answered on
30 Oct 2026 ([how a ground fork settles](#blind-keepers)). What comes later is scheduled in
[order of work](#order-of-work).

## Not in this spec

- The door, invites and joins: milestone 2 and `Aven.ID.Invite`.
- The exact text of avenID's statements: `id/core`, from this model.
- Envelopes, branches and fit: the [docs](../../db/docs/README.md).
- Operations, footprints and wants: the [engine](../../db/engine/README.md).
- Blobs and refs: the [store](../../store/README.md).
- The kernel and its router: `aven/actor`.
- The tree scheme's protocol: its own document when it comes.
- The safe's details: `aven/DB2/id/safe`, when its milestone comes.
- Mixing fetches.
