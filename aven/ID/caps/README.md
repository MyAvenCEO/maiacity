# aven/ID/caps

Capabilities, accounts, signers, owners and access control: what our systems taught us about authority, reduced to
first principles, for the model avenID's signing and vault infrastructure will carry. Status: **discovery**. There is
no code here.

avenID's code lives in `aven/DB2/id` today; this folder holds its authority design until avenID moves. How actors get
and use authority is in [`../../actors/README.md`](../../actors/README.md), section 9.4.

1. [The question](#1-the-question)
2. [Where we looked](#2-where-we-looked)
3. [avenDB-old: vaults and shares](#3-avendb-old-vaults-and-shares)
4. [The new avenID and avenDB](#4-the-new-avenid-and-avendb)
5. [avenOS: custodial identity and short grants](#5-avenos-custodial-identity-and-short-grants)
6. [avenVICTORIO: capabilities at the actor door](#6-avenvictorio-capabilities-at-the-actor-door)
7. [Abject: authority from position](#7-abject-authority-from-position)
8. [Rules learned](#8-rules-learned)
9. [First principles: what each concept is for](#9-first-principles-what-each-concept-is-for)
10. [How actors get authority](#10-how-actors-get-authority)
11. [What a capability carries](#11-what-a-capability-carries)
12. [Open questions](#12-open-questions)
13. [Next steps](#13-next-steps)

## 1. The question

Who may make what happen, and how can anyone check it without trusting a server? Every system below answers part of
it. avenDB-old answered most of it, proved it in Lean, and grew too many concepts doing so.

## 2. Where we looked

| Source | Version read | What it is about authority |
| --- | --- | --- |
| avenDB-old (`aven/db`) | this repository | Vaults, owners, devices and shares with levels, ops and cap groups; audiences and keys; all of it modelled and proven in Lean (`aven/db/spec`) |
| New avenID and avenDB (`aven/DB2`) | this repository, 30 Oct 2026 | avenID rebuilt from first principles: vaults that own vaults, devices, passkeys, invites. Caps are named but not built |
| avenOS (`MyAvenCEO/avenOS`) | `main` 8310bc3 | A custodial identity service (`aven.id`), a facade that issues short tenant grants, per-function database roles, and per-person authorization for actors |
| avenVICTORIO | `main` e1c15a8 | A restaurant's team app: a capability on every actor method, runs owned by a person, roles as capability lists. It is private and in production; its failures are described here as patterns only |
| Abject (`mempko/abject`) | v0.16.1 | Authority by where code runs, capability objects behind a permission broker, identity from the transport |

Everything below comes from reading code and documents. None of it was run for this document.

## 3. avenDB-old: vaults and shares

### 3.1 The model

| Concept | Role |
| --- | --- |
| **Vault** | An identity, like a smart account: `{id, kind, owners, threshold, devices, root}`. One kind table (`policy::Kind::rules`) says what each kind may be: **human** (owned by signers, has devices), **coop** (owned by human or coop vaults, no devices), **aven** (a coop's one AI identity, owned by its coop, with the server and agents as its devices), **device vault** (one machine a vault runs) |
| **Owner** | A signer or a vault. Signers own only human vaults |
| **Threshold, root** | A governance edit needs the root (the human vault's passkey) alone, or a threshold of owners, recursively, plus the consent of a newcomer. Since 19 Oct every owner is equal when removals clash, but the root still approves alone |
| **Device** | A key that acts for its vault with all its rights and never governs it. Device keys are derived from the passkey's PRF output at every unlock |
| **Share** | `{over, who, level, wide, select, ops, parent, issuer, group}`. `who` is a vault, everyone, a device (keep shares only) or a one-time invite key. `select` and `ops` are sealed, with a salted commitment in the clear |
| **Level** | keep < relay < backup < read < write < owner. The rank is the wire byte. A share's level is the class of its strongest op, and it travels in the clear |
| **Ops** | relay, backup, read, create, set (path, values, line), setOwn, insert, remove, move, tag, propose, merge (line, path), share. Readers judge them against the touches read off each Loro update |
| **Built-in groups** | Owner, Editor, Suggester, Member, Viewer, Public, Backup, Relay, plus `answering` for access requests |
| **Cap group** | A named, versioned entry the vault creates: caps (an op over a slice) and the groups it includes. A share may name one; later versions narrow every share at once, and never past the share's level (CG1). Maia City's are Traveler, Citizen, Admin, Agent and Measurer |
| **Selector** | An OR of ANDs over type, author, entry, creation time and tags, bounded in size |
| **Audience** | The set of shares whose selectors pick an entry. It carries the entry's keys. Entries have stays (their audience history), and creations through a share land in its intake audience |
| **Stewards and marks** | The vault's own devices compute audiences and wants, and write marks so that relays never need to read selectors |
| **Keep share** | Names one of the issuer's devices and grants nothing; it only says what that device syncs |
| **Invite and claim** | A share to a one-time key. A claim is signed by that key and by a member of the claiming vault; then the share names that vault. An invite is never Owner |
| **Access request** | A record shared with the vault asked, through the `answering` ops |
| **Revocation** | Of a grant, an owner or a device, with the edits it had seen. It cascades to every share resting on the revoked one |
| **Strong removal** | An edit a removal had not seen stands only if it still stands with the removal's facts hidden, so a removed key cannot backdate edits |
| **Proposals and drafts** | Lines beside main. A share's merge into main needs the vault's accept, an empty write of the vault on the proposal; only the vault lands a draft |
| **Gate and admission** | Which new vaults the server takes, and whose passes its relay honours |
| **Standing grant** | An engine convention: a share whose sealed name has a fixed prefix, copied into each vault founded later |
| **Master recovery key** | Every human vault is founded with owners [passkey, master key] at threshold 1 |

### 3.2 A write, end to end

1. The page asks `may`, a dry run of the real engine. The page holds no rule of its own.
2. The device drafts the edit as a vault, naming its chain of owners (`via`). A write through a share carries, inside
   its sealed body, a proof: the ops and salt of every share in the chain.
3. The device signs with ML-DSA-65. A governance edit also needs the root or a threshold of owners, plus the
   newcomer's consent, through the passkey ceremony.
4. **Every peer, the relay included,** runs the operational check: the author acts through `via`; a write is by the
   entry's own vault or through a live share of write or more reaching the entry; creations land only in an intake
   audience; a new share rests correctly on its parent; a revocation is by someone who may revoke. This check reads no
   selector, type, tag or op (T25).
5. **Readers** decide whether the write counts: each grant matches its commitment, the ops (or the cap group's caps at
   that point) allow every touch, the write fits its schemas, and what it builds on counts. A write that does not count
   stays in the log and shows on no line.

### 3.3 A read

Confidentiality comes from keys. An audience key is wrapped to the key of each share of read or more that reaches it;
share keys are sealed to the grantee's seed; seeds are sealed to the vault's devices and owners. Sync filtering
decides who receives what: by audiences and marks (T12, T28). Backup receives ciphertext without keys, a relay only the
vault's log (T26), and files follow their edits (T27). Sealing used X-Wing with Classic McEliece.

### 3.4 What is proven

All families are marked proven in `aven/db/spec/README.md`, with no `sorry`:

- **T1** only authorized writes are accepted, and a revocation wins over what it had not seen; **T2** governance
  needs the root or the threshold plus consent, and devices never govern; **T3** no ownership cycles; **T4** shares
  name vaults, everyone or an invite key, and only keep shares name devices.
- **T5** a key opens only for one who could read; **T6** forward secrecy on removal; **T7** the server is blind;
  **T8** everyone only reads; **T15** rotation follows revocation; **T24** an entry's key reaches only its readers.
- **T12, T26, T27, T28** sync and files go only where shares reach; **T16** strong removal; **T17** the schema lane
  holds only the vault's own creations; **T21** vaults keep to the kind table; **T22** a share grants no more than the
  share it rests on, and no owner share is wide; **T23** marks mean what the shares say; **T25** a relay that reads no
  selector decides every edit as an owner does.
- **C1–C5** chains narrow, readers agree, counted writes do only what their ops allow, allowed writes count, members
  change only their own rows; **CG1** a cap group never lifts a share past its level; **G1–G3** an invite is claimed
  once, the server takes only vaults it welcomes; **M1, M2** merges stay under their path, and a share's merge into main
  needs the vault's accept; **D1–D3** drafts; **K1** revoking a keep share cuts nothing; **H1, H2** holdings come only
  from the device that proved itself; **V1–V7** faster replays proven equal to a full one.

The proofs take an edit's touches and schema fit as given, so "readers agree" assumes that reading touches off a Loro
update is deterministic and complete; that part is tested, not proven. Signatures are assumed unforgeable.

### 3.5 Strengths to keep

- **An executable Lean model**, shared test vectors, and Rust that mirrors it rule for rule under the same names.
- **Two layers of checking.** Relays enforce what they can see in the clear (T25); readers enforce the fine-grained
  ops, which stay sealed behind salted commitments.
- **Attenuation by one rule.** Every share rests on one its issuer holds, chains only narrow (T22, C1), and
  revocation cascades.
- **Strong removal.** A stolen or removed key cannot backdate edits (T16).
- **Path-level ops**: own rows, merges by path, accepts and drafts, all proven.
- **Devices never govern; keep shares grant nothing.** The kind table is defined once.
- **Post-quantum signatures by default** (ML-DSA-65 on every edit).
- **The UI holds no rule.** `may` is a dry run of the real engine.

### 3.6 Weaknesses

- **Too many overlapping concepts.** About twenty nouns cover authority: level, op, built-in group, cap group, cap,
  share, keep share, standing grant, audience, intake, stay, mark, wants, copy setting, follow, interest, invite,
  access request, `answering`, gate, admission, session. "Owner" alone means three things: a vault's owner, the Owner
  level and the Owner group.
- **Overloaded operations.** One `share` op makes a co-owner, a device, a grant or a keep share. A field named `level`
  carries a group.
- **Authority by name.** The gate finds admins by the cap group named `Admin`; standing grants are found by a name
  prefix; the app opens pages by the names of the groups a person holds. The app does look the groups up in the right
  coop by its id, never by its name, but a name is still the key.
- **A server not fully blind.** The gate must read Maia City's cap-group entries.
- **Uncounted writes as log bloat.** A write through a write-level share is accepted by relays even when its ops
  forbid it, and stays in the log forever.
- **Social graph in the clear.** Relays see who holds which share, at which level, from whom, and which shares reach
  which audiences; invite and public slices are in the clear.
- **Upkeep on every change.** A new share or a tag change makes the stewards write a mark per affected entry, each
  listing every write of its entry; drafting a revocation loops full replays; settling a removal costs about holders
  times seals plus every write; the gate replays everything on each pass. Key trees, which would cut the boxes per
  device per epoch, are proven (V6) but not wired in.
- **One recovery key.** The master recovery key is an owner at threshold 1 of every human vault, and through them of
  their coops and avens: one key controls everything.
- **Heavy keys.** Classic McEliece made a 1 MB public key per key, which took most of a second to make.
- **Docs drift.** Several documents still describe the root as winning clashes, an older kind table, or theorem labels
  that collide between files.

## 4. The new avenID and avenDB

`aven/DB2` rebuilds identity as its own package, avenID, Lean first.

### 4.1 The model

| Concept | Role |
| --- | --- |
| **Kind** | person, network, coop, device |
| **Owner** | A key or another vault: vaults own vaults |
| **Governs** | Ownership followed down any number of levels. "Authority runs down the tree, never up" |
| **Well-formed tree** | Eleven rules: unique ids; every vault owned; a device has exactly one owner, the vault it serves; devices and device keys own nothing; an owner ranks strictly below what it owns, so no cycles; each device has its own key; a coop is owned only by person or coop vaults and holds no devices |
| **Acting** | A device acts for the one vault it serves, and through it on whatever that vault governs (`mayActOn`). The verifier computes the chain from the tree; a statement names none |
| **Accounts** | Whom a device may act as in avenOS: people only. "A network acts through its own devices, and no person switches into it" |
| **Statement** | A body a device signs for the vault it serves, with a domain tag per kind (`avenID statement 1`, `claim 2`, `invite 1`, `join 1`, `avenDB chat 1`) |
| **Claim, sign-in** | The first signup claims the network; later sign-ins add browsers |
| **Invite, join, withdrawal** | A one-time key that lets one newcomer in; the door is checked at the relay and at every peer |
| **Passkey** | ES256 only; checks in WebAuthn Level 3 order (type, challenge, origin, cross-origin, RP ID, user present, user verified, signature). The challenge is the hash of the statement text, so the passkey signs the statement itself. A rising counter catches a cloned authenticator |
| **Cap** | Named only: "a signed grant: which vault may read or write which document" (`aven/DB2/README.md`) |

Proven in Lean: governance is transitive, irreflexive and asymmetric, and devices govern nothing; the queries are
correct; the account switcher shows people only; signatures verify; a network is claimed once; invites are joined once
and withdrawn ones refused. Implemented in Rust and WebAssembly: `aven-id` (tree, query, sign, passkey, claim,
network, invite, members), read by avenOS through the wasm `Cast`. The Aven Peer stores statements by compare-and-set
and checks them all again on restart.

### 4.2 Not built yet

- **Thresholds.** Owners are a flat list and any one owner is enough. k of n is planned for milestone 3.
- **Caps, roles and delegation.** Milestone 3. Membership "only opens the door; what a member may read or write
  inside is decided per document by caps".
- **Device rights.** The docs say a device acts "within the rights Alice's vault gives it and can take back"; the model
  gives a device its vault's full authority.
- **Recovery.** MaiaCityGuardian is added as an owner of every person vault, but nothing it could sign is accepted
  yet. Planned: guardian vaults that can replace a vault's owners after a delay in which the owners can cancel.
- **Revocation.** Only invite withdrawal exists. Revoking a device by a signed act of its vault is milestone 3.
- **Encryption and post-quantum signatures.** Planned: X-Wing as the only key encapsulation, a suite byte on every
  sealed box, HQC as the backup, no McEliece; Ed25519 and passkeys now, ML-DSA later. None of it is in code yet.

No DB2 document says that avenDB-old's shares, root, thresholds or `via` chains were dropped on purpose. They are not
rebuilt yet; the rebuild's stated reasons are the old system's shape (one lock, catch-up loops), not its authority
model.

## 5. avenOS: custodial identity and short grants

avenOS keeps identity on a server:

- **`aven.id`** is the only identity origin and passkey relying party. Accounts are made only after a verified
  purchase, through a setup link stored hashed and valid for seven days; a setup session is refused by every
  service. More passkeys can be added; there is no email recovery.
- **Device approval** follows RFC 8628 device codes, approved from a signed-in session.
- **The identity token** is an Ed25519 JWT for audience `aven-services`, valid for 5 minutes, keys rotated every
  30 days.
- **The facade** (`api.aven.ceo`) strips the caller's authorization, cookies and trusted headers, checks the route's
  role, maps the method to one action, and asks for a **tenant grant**: a JWT bound to one customer environment, one
  database, one routing generation and a list of actions, valid for 60 seconds or less, checked both when signed and
  when verified. Only environment owners get one today.
- **Per-function database roles.** Each component owns one schema, and each executable function gets its own login
  per customer, with a password derived from a root secret.
- **Actor authorization** (`libs/aven-actors/src/authorization.ts`) decides at four moments, discover, plan, spawn and
  invoke, with decisions that carry constraints (forced configuration, a use limit) and obligations. Discover and plan
  are advisory; spawn and invoke are decided again.
- **Designed, not built:** human approval as "one-use, short-lived, digest-bound", where "the user clicked approve once"
  is not a reusable permission; delegated capabilities.

Strengths: a hard split between identity, commerce and customer data; authentication kept apart from authorization;
short grants bound to an audience and an action; a routing generation that fences stale grants; fail-closed defaults.
Weaknesses: authority is custodial and signed by an online key; no user-held keys, delegation, attenuation, thresholds
or recovery beyond another passkey; coarse roles; revocation waits for expiry. Passkeys cannot move between relying
parties, so `aven.id` and `maia.city` credentials cannot be shared.

## 6. avenVICTORIO: capabilities at the actor door

What worked:

- **Every method names the capability its caller must hold.** A method that names none can be called by nobody.
- **The tool list the model sees is filtered** by the person's capabilities.
- **Clicks are checked like calls,** and a click on a held method is held as well.
- **Every run belongs to a person** and acts with their rights.
- **Viewing as someone else narrows rights**; administrative capabilities are removed while switched.
- **Data has read and write capabilities per schema,** with a narrow right to change one's own rows.
- **Roles are lists of capabilities.**

What failed, as patterns:

- **Hidden is not refused.** A method left out of the model's tool list was still callable if named.
- **Identity in the payload.** "Who decided" was read from the message body.
- **Identity guessed from context.** The person behind a store call was taken from whatever message was in flight;
  with no owner found, the store acted with every right.
- **Rights cached** until a restart, past revocation.
- **Laws checked by text matching** over actor source, which an actor written at runtime can evade.

## 7. Abject: authority from position

- **Authority comes from where code runs and whom it can message, not from what it declares.** Built-in objects are
  trusted; generated ones are not, and cannot pass for built-in.
- **Capability objects** own every real effect: HTTP, files, shell, storage. A permission broker combines an autonomy
  level (`ask`, `read`, `edit`, `full`) with a ceiling set by the workspace; a public workspace is capped at `ask`.
- **One place asks the person.** The first answer wins from any device; with no one to ask, the answer is no.
- **True names**: a peer is named by the hash of its public key. The receiving side sets the authenticated sender;
  "a value from the wire is never trusted".
- **Workspaces** are local (nothing in or out), shared (named peers, end-to-end encrypted) or public.

## 8. Rules learned

1. **Identity is a key, never a name.** Vaults, devices and peers are named by keys or ids; authority is never found
   by a name string.
2. **Authority runs down, never up.** A vault governs what it owns. Devices act and never govern.
3. **Authentication is not authorization.** Proving control of a key opens the door; capabilities decide what
   happens inside.
4. **The sender comes from the signature or the transport,** never from the payload.
5. **Nothing is ambient.** No owner means no access; a call without a run is refused.
6. **Every grant narrows what it rests on.** Chains only narrow, and revoking a grant revokes what rests on it.
7. **Revocation wins** over what it had not seen, and a removed key cannot backdate.
8. **Check twice.** Whoever routes checks what it can see in the clear; whoever performs the effect checks the full
   capability.
9. **Hidden is not refused.** What a caller is not shown must still be refused at the door.
10. **Laws are code.** Never enforced by prompts, by reading source text, or by names.
11. **Human approval is a co-signature** over one digest, used once, and the passkey signs the thing itself.
12. **Short grants for servers, revocable capabilities for peers.** Each fits a different place.
13. **Viewing as someone else narrows rights** and never widens them.
14. **Recovery is never one key.** Guardians, a quorum, and a delay in which the owners can cancel.
15. **Hosts see ciphertext and as little metadata as possible,** including the social graph.
16. **The UI holds no rule.** It asks the engine for a dry run.
17. **Budgets are capabilities.** Uses, expiry, money and autonomy levels are conditions on a grant.
18. **Checking stays cheap.** A grant must not cost upkeep on every entry it reaches.
19. **Proven first.** The model and its theorems in Lean, then tests from it, then code.
20. **One meaning per word.**

## 9. First principles: what each concept is for

Strip each concept to the job it does; where two do the same job, keep one. Four essentials remain.

| Essential | Its one job |
| --- | --- |
| **Key** | The only thing that can sign. Passkeys, device keys, invite keys, recovery keys and server keys are all keys; they differ only in who keeps them |
| **Vault** | A principal: a set of owners (keys or vaults) and a rule for when they agree (k of n). People, coops, networks and devices are vaults of different kinds, and ownership forms the tree |
| **Capability** | A signed grant from a vault that narrows one it holds: to whom, which ops, on what, and under which conditions (expiry, uses, budget, approval) |
| **Proof** | The chain from a signing key, through owners and capabilities, to one act. Anyone can check it |

Everything else is one of these four:

| Seen in the sources as | What it really is |
| --- | --- |
| Level, ops, built-in groups, cap groups | A capability's ops. A level is a named preset, derivable from the ops; a group is a named, versioned capability template |
| Owner (principal), the Owner level, the Owner group | Only principal ownership governs. "May share on" is an op |
| Share, cap, tenant grant, per-method capability, broker rule, actor authorization decision | A capability |
| Role, membership role | A named capability template granted to a vault |
| Threshold, root, newcomer's consent, merge accept, human gate, permission prompt, approving a goal | Approval: a vault's quorum co-signs one digest, once. It is a condition on a capability |
| Invite share, access request, link or pass, device-code approval, sign-in adding a browser | A ticket: a one-time capability to claim something |
| Keep share, copy setting, follow list, interest, an actor's `loads` | A want: what a device or an actor asks to have synced, written in the same selector grammar as capabilities. It grants nothing; what is served still needs a capability (`served_needs_authority`, `aven/db/spec/AvenDB/Interest.lean`) |
| Audience, stays, marks, intake | Key distribution derived from capabilities. Capabilities per document remove the upkeep |
| Standing grant | A capability whose target is "every vault under X" |
| Device rights, agent session limits, viewing as someone, actor capabilities | Narrowed capabilities held by a device, an agent or an actor. Not ownership |
| Recovery key, guardians | Owners whose approval carries a delay condition |
| Gate, admission, door, membership | A capability to connect: the relay op |
| Identity token, session | Evidence that a key was used. Not authority |

## 10. How actors get authority

An actor is not a vault and owns nothing. It holds capabilities delegated by whoever spawned it, each narrower than
the spawner's, rooted in a person's vault. Every envelope carries its run, and the run's owner bounds what can happen.
The kernel's router checks the capability on every message; the door actor that performs an effect checks it again
against the run's owner; a capability with an approval condition waits at the gate for the quorum's signed press over
that exact call. See [`../../actors/README.md`](../../actors/README.md), sections 8 and 9.

## 11. What a capability carries

A checklist from avenDB-old's shares and avenOS's grants:

| Field | Why |
| --- | --- |
| Issuer | The vault that grants it |
| Holder | A vault, a device, an actor or a one-time ticket key |
| Parent | The capability it narrows; revoking the parent revokes it |
| Ops | What it allows |
| Target | What it applies to: a document, a selection, a vault subtree, an actor's messages |
| Conditions | Not before, expiry, uses, budget, approval quorum |
| Verifier | Who checks it: a peer, a component, the kernel (avenOS's audience) |
| Generation | Fences stale grants after a move or a rotation |
| Id | What a revocation names |
| Suite and signatures | Which algorithm, and the issuer's signature or its quorum's |

## 12. Open questions

1. **Capabilities per document, or selectors over a vault?** Per-document caps (DB2's definition) remove the marks and
   re-keying upkeep and hide more metadata, but cost a grant per document. Meadowcap is a reference.
2. **How k of n is signed:** a list of signatures over one digest, or an aggregate.
3. **Recovery:** who the guardians are, and how long the delay.
4. **Post-quantum signatures:** when ML-DSA joins through the suite byte.
5. **Actors and keys:** does an actor ever hold a key, or only capabilities the kernel holds for it?
6. **Offline checks and short grants:** which places verify capability chains, and which accept short server grants.
7. **Metadata:** how much of a capability a relay must see to route.

## 13. Next steps

1. Model capabilities in Lean beside avenID's `Governs` (`aven/DB2/id/spec`), before any code.
2. Theorems: a capability never exceeds its parent; revocation wins; an approval needs the quorum's signatures over
   the exact digest; no act without a proof; an actor's capabilities stay within its run owner's.
3. A wire format with a suite byte.
4. A first slice: a person vault with two passkeys approving one act 2 of 2.
