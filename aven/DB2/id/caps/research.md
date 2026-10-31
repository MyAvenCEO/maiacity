# avenID caps: research

The notes behind [`README.md`](README.md), the caps spec. They are notes, not spec. They quote other code as evidence,
and nothing here is code for avenDB ([README](../../README.md), rule 12). Written on 30 Oct 2026 from reading code and
documents; nothing was run.

1. [avenDB-old: the Lean model](#1-avendb-old-the-lean-model)
2. [avenDB-old: the Rust](#2-avendb-old-the-rust)
3. [avenOS: `aven-caps` at `2894d6eb`](#3-avenos-aven-caps-at-2894d6eb)
4. [Outside: Signal, Matrix, MLS, Biscuit, Keyhive, Meadowcap and others](#4-outside)
5. [The passkey PRF, October 2026](#5-the-passkey-prf-october-2026)
6. [Scale arithmetic](#6-scale-arithmetic)
7. [avenACTOR's discovery document, moved here whole](#7-avenactors-discovery-document-moved-here-whole)

## 1. avenDB-old: the Lean model

Read: `aven/db/spec/README.md` and `aven/db/spec/AvenDB/`. There is no `sorry` or `axiom` anywhere.
`CapGroupsOnce` and `KeyDerivation` only prove that a cache gives the same answers.

### The model

**A share** (`State.lean:35`).
- **Fields:** `id`, `over` (the vault), `who`, `level`, `wide`, `select` (a sealed selector), `ops` (sealed, with a
  public commitment), `parent`, `issuer` and `group` (an optional cap-group entry).
- **No time at all:** no expiry, not-before or use count. Time appears only in the API pass's freshness, in another
  grammar.
- **What is public:** `level`, `wide`, `who`, `issuer`, `parent` and `group`. `select` and `ops` are sealed to the
  share's readers (`Step.lean:284`). For `everyone` and invite shares nothing is sealed, so their selectors are public.

**Levels** (`Basic.lean:101`): keep < relay < backup < read < write < owner. The rank is the wire byte, and a share's
level is the class of its strongest op (`Rules.lean:94`). The `share` op counts as owner level.

**`Who`** (`Basic.lean:135`): a vault, everyone, a device, or an invite key.
- Only a keep share names a device, and every keep share must (`Step.lean:409`).
- A share to everyone is read at most.
- An invite share can be any level but owner. It is claimed once, signed by the invite key and a member of the claiming
  vault (`Step.lean:326`).

**Selectors** (`Selector.lean:40-80`).
- An OR of ANDs over type, author, entry id, a `createdIn` range (whatever time the creator claims) and three tag
  tests.
- `fits` decides whether one selector lies inside another, proven sound.
- Bounded at 8 conjunctions × 16 tests × 1,000 ids.

**Cap groups** (`State.lean:333-376`) are mutable entries of caps and include links. A share naming a group gets the
caps of the group's current version, limited to the share's level.

**Delegation** (`shareParentOk`, `Step.lean:253`).
- A root share is issued by the vault it is over.
- A child share is issued by its parent's grantee, over the same vault, at no higher a level, wide only if the parent
  is.
- The selector is never checked at issue time, since it is sealed. The slice a share really grants is the intersection
  along its chain, which the verifier computes (`effSelects`, `State.lean:401`). Ops are checked at every hop
  (`chainAllows`, `:405`).

**Revocation** (`Step.lean:426`).
- Who may revoke: the issuer, the vault the share is over, the holder, or anyone up the chain (`mayRevoke`, `:278`).
- Revoking cascades to everything resting on the share.
- A removal names what it saw and keeps (`keep`), so an edit it hadn't seen is cut even if it sorts earlier: strong
  removal.
- Clashing removals are settled by `priority` (`:669`).

**Keys.**
- Families: `seed v` (the vault's key), `share v c`, sealed to the grantee's seed, and `audience v x`, wrapped under
  each read-or-more share key reaching it (`Basic.lean:188`, `targets` at `State.lean:747`).
- Entry keys are derived per entry, stay and epoch.
- `settle` (`:818`) compares, after every edit, what each holder could open before and after (`staleKeys`, `:767`), and
  bumps every family someone may no longer open.
- `bump` (`:777`) seals the old epoch's key under the new one, so whoever reads now reads all history.
- The attacker model is symbolic (`Knows`, `:669`).

**KeyTree** (`KeyTree.lean`) is a TreeKEM/BeeKEM-style model with adds, removes and commits, keeping concurrent commits
side by side. It is proven (V6) but **not wired into the key schedule**.

**Keep shares and wants** (`State.lean:520-610`).
- A keep share grants nothing.
- Stewards, meaning any device of the vault, read its sealed selector and write **marks** listing which keep shares
  pick each entry. The blind relay learns what to hold from the marks alone.
- **Interests** (`Interest.lean:56`) only order. "Caps bound interests" is `served = schedule.filter may`, with `may`
  an abstract parameter (`:214`).

**The blind index** (`BlindIndex.lean`): a keyed BLAKE3 token per key family, epoch and label. A peer answers which
entries carry a label, and learns only equality.

### What is proven

| Family | Says | Strength |
|---|---|---|
| T22 (`Theorems.lean:155-172`) | A child share is over the same vault, its level no higher, its slice within its parent's; no owner share is wide | Real |
| CG1 (`:230`) | A cap group grants no more than its share's level | Real, but a group can still change under its holders |
| C1–C5, M1, M2, D1–D3 | Counted writes are exactly those the chain's ops allow; merges stay in their paths and need an accept | Real |
| T23 (`:186`) | If the marks are the desired ones, the public rule and the wants match the sealed selectors | Conditional on honest stewards |
| T5 (`:598`) | Opening any epoch of a family means one was once entitled to it | Weak: per family, not per epoch, "before or after" (`Props.lean:92`) |
| T6 "forward secrecy" (`:605`) | The current key opens only for those entitled now | Secrecy against removed members, not forward secrecy |
| T12 (`:933-958`), T19 (`:1027-1042`) | Sync sends nothing that may not be received (or that belongs to a vault's log), and misses nothing it would send | Real; the vault-log exception leaks the tree |
| T16, K1, T26–T28 | Strong removal; revoking a keep share cuts nothing; files follow edits; sync obeys keep shares | Real |
| V6 (`KeyTree.lean:967-1272`) | Members open, the removed don't, history kept, concurrent commits both kept | Real, for a model the schedule never used |
| Interests, sessions | `served_needs_authority` is `mem_filter`; `sessionOpens_session` is `And.right` | Definitional |

### Wins

1. The verifier intersects a chain's slices, so selectors stay sealed and need no check when issued.
2. Ops are checked at every hop: a delegate never exceeds any ancestor.
3. Revocation cascades.
4. Strong removal: a removal names what it saw.
5. One selector grammar, closed under and/or, with a sound `fits`.
6. A proof (T25) that a relay reading no selector decides as an owner does.
7. A want grants nothing (T28, K1).
8. Blind tokens scoped per audience and epoch, unlinkable across them.
9. The executable model generates the Rust's vectors.

### Problems

1. **One order for five axes.** keep is a sync preference, relay is routing metadata, backup is holding ciphertext, read
   is holding a key, and write and owner are policy. Owner also means "may delegate" (`Rules.lean:85`). The order forces
   "read implies backup implies relay", and keep sits below relay while granting nothing.
2. **"Owner" means two things,** a governing principal and a level. WideOwner (`Step.lean:418`) and threshold approval
   for owner shares exist to patch the clash.
3. **Several grammars for one thing:**
   - a share's ops and its mutable group, with the level check waived for groups (`State.lean:384`);
   - built-in groups and cap-group entries;
   - `wide` and `Selector.all`;
   - keep shares that reuse `Share` with `who = device`;
   - interests tied to nothing;
   - the API pass.
4. **Cap groups change after issuing:** a holder's rights grow with no new grant.
5. **No expiry or conditions.**
6. **Any device can grant.** A grant needs only `actsVia` (`Step.lean:406-424`), so a single browser can grant wide
   read or write on its whole vault, or read to everyone.
7. **Any steward can re-share by marking** an entry into a wider audience (`Step.lean:482-497`), and the schedule then
   hands out its keys.
8. **Tags escalate.** Tag ops change which shares reach an entry, removing a tag can widen access through `tagNone`, and
   `createdIn` trusts the creator's clock.
9. **No forward secrecy:**
   - each old key is sealed under the new one;
   - device keys are static;
   - the tree has no leaf update.
10. **T5 is weak,** and nothing proves "removed at t opens no epoch after t".
11. **Nobody checks a write's epoch** (`Step.lean:436`).
12. **KeyTree is disconnected** from the schedule, which re-seals the whole vault on every seed bump.
13. **Public metadata:**
    - the whole delegation graph;
    - audiences and their moves;
    - each device's wants;
    - file roots;
    - the vault logs (`Sync.lean:148-157`);
    - invite and everyone selectors;
    - blind-index equality, and creation order.
14. **The root's documentation contradicts the code.** The root "wins every clash" in prose, but no tier exists for it
    in code. `approvesN` (`State.lean:252`) lets the root alone approve anything, so a stolen root passkey takes the
    vault. There is no recovery model, only backup restore.
15. **Interests and sessions prove nothing about caps.**
16. **Too much machinery:**
    - the whole state replayed per edit, with `hide`, `narrow` and `resolve` retrying removals;
    - two layers kept equal by steward upkeep;
    - intake audiences with rules per chain.

## 2. avenDB-old: the Rust

Read: `aven/db/crates/avendb/src/` (policy.rs, sealed.rs, keys.rs, sign.rs, recovery.rs, gate.rs, selector.rs, rules.rs,
admission.rs, quota.rs) and `aven/db/README.md`'s master recovery key.

### Primitives

- **Signatures.** Edits are signed with ML-DSA-65 (`sign.rs:69-80`). SLH-DSA signers are legacy, checked against a
  frozen Merkle anchor (`legacy.rs:41`).
- **Passkeys.** A passkey's signature needs a P-256 assertion with UP and UV, origin and RP checked and cross-origin
  refused, **and** an ML-DSA signature from a key derived from the PRF (`sign.rs:717-763`).
- **Touch ID.** On a Mac, a Secure Enclave key signs with ML-DSA-65. Device Ed25519 keys serve only iroh's TLS, and a
  post-quantum hello binds the TLS exporter (`sign.rs:427-452`).
- **Key encapsulation.** `seal` is X-Wing plus Classic McEliece 6688128f, with the box key a BLAKE3 over both shared
  secrets, both ciphertexts, both public keys and the info (`keys.rs:500-516`). `seal_tree` and `seal_once` use X-Wing
  alone.
- **AEAD.**
  - Small data: XChaCha20-Poly1305 with a random 24-byte nonce, a subkey per nonce and a 32-byte key commitment
    (`keys.rs:622-648`).
  - Files: ChaCha20-Poly1305 STREAM over 64 KiB segments, verified by BLAKE3 first (`sealed.rs:258-290`).
- **Derivation.** Keyed BLAKE3 with a purpose string everywhere (`keys.rs:156-195`).
- **File keys.** Convergent within a person: a BLAKE3 over a vault secret, the length and the content
  (`sealed.rs:101-139`).

### Key hierarchy and onboarding

- **Seeds.** Each vault has a seed per epoch, sealed to its devices, its owner signers (passkeys through their
  PRF-derived seal keys) and its owner vaults' seeds (`policy.rs:2145`). Share keys are sealed to grantees' seeds,
  audience keys wrapped under share keys, and entry keys derived per stay (`keys.rs:671`). Edits carry the key id in the
  clear.
- **Adding a device** needs the vault's approval and the device's signature (`policy.rs:2415-2433`). Then an entitled
  online device must post the real boxes (`Action::Keys`). Until that upkeep runs, the newcomer opens nothing.
- **Device keys** are derived again from the passkey's PRF with a per-device salt at every unlock (`sign.rs:13-16`).

### Revocation and rotation

- A removal bumps the epoch of every family the removed party could open (`stale_keys`, `policy.rs:3080`). The old key
  is wrapped under the new one.
- The writer picks the epoch and nobody checks it (`policy.rs:364-368`).
- Removals cut what they hadn't seen through `keep` lists (`policy.rs:3661-3700`), and clashes go by owner seniority
  (`policy.rs:4033-4065`).

### Recovery

- One global master key, a software passkey from 32 bytes kept offline, is an owner of every human vault with
  threshold 1 (`recovery.rs:1-5`; `avendb-net/src/lib.rs:1248`).
- It can add a device, receive the seeds and read everything.
- There are no guardians and no social recovery.

### Where checks run

- **Every peer, the relay included,** runs `State::check` (`policy.rs:2322-2752`) on cleartext: owners, devices, share
  level, `wide`, audience.
- **Only readers** run the op-level layer (`lets`, `chain_allows`, `uncounted`, `policy.rs:1866-1957`). So the relay
  stores writes readers later drop.
- **Sync filtering** is honest-peer enforcement by the responder (`sync.rs`).
- **Fail-open spots:**
  - `lets` returns true for any write by the vault itself (`policy.rs:1915`);
  - `quota::keeps` returns true when the signer has no payer, so storage is free and unlimited for multi-owner vaults
    (`quota.rs:123`; also `Quota.lean:78`);
  - edits have no quota (`quota.rs:121`);
  - `Signup::Anyone` is the default (`admission.rs:13-15`);
  - debug builds admit any SLH-DSA edit listed in `ADMITTED` (`legacy.rs:61-79`).

### Why policy.rs is 6,083 lines

| Lines | What |
|---|---|
| 60–1170 | Wire types: the kind table, Level, Who, Share, a 14-variant `Action`, about 70 refusals |
| 1178–3198 | `impl State`, 139 methods: governance and approval; admission checks (about 430 lines); the op layer; the key schedule; keep and sync interest; slices and indexing |
| 3198–3600 | Readings, groups, meaning |
| 3600–5390 | The replay engine: ordering by self-reported depth, removals resolved by trial replays, and caching layered on top (`TailRun`, rungs, marks, `ReplayRun`, `Late`, `policy/view.rs`) |
| 5390–5910 | Log storage and indexing |

Authorization, key management, conflict resolution, sync interest and performance caching share one `State` and one
replay. Cutting what a removal hadn't seen forced replays of the whole history, and those forced the caching.

### Wins and problems, beyond the Lean's

**Wins:**
- a hybrid KEM with everything bound into its derivation;
- key-committing AEAD;
- purpose-labelled derivation;
- STREAM file segments verified before decryption;
- an entry's id hashing its vault, author and nonce;
- passkey writes needing the assertion and a post-quantum signature;
- a hello bound to the TLS exporter;
- standing consent limited to adding owners;
- secrets zeroized;
- a `Keys` edit accepted only when each box goes where the schedule says.

**Problems:**
- The master key is a backdoor at threshold 1, and the root approves anything.
- PRF-derived keys use a fixed salt, so one leaked output is permanent and compromises every device.
- New epochs exist only once an online device posts boxes, and nobody checks what a box holds.
- Several keys can exist for one epoch when devices rotate at once (`keys.rs:470-472`).
- The relay sees the social graph, and the gate reads Maia City's cap-group names (`gate.rs:14-17`).
- Convergent keys with cleartext roots link identical files across one person's vaults.
- Order trusts depth that authors report themselves.
- The PQ story is inconsistent: McEliece on seeds, X-Wing alone elsewhere, P-256 passkeys, Ed25519 for iroh, and a
  1 MB public key per McEliece seal key.

## 3. avenOS: `aven-caps` at `2894d6eb`

Read: `libs/aven-caps` (`caps.rs` 2,088 lines, `crypto.rs` 840, `ownership.rs` 345), the relay's gate
(`libs/aven-node/src/main.rs:117-205`), the client's gate (`app/src-tauri/src/biscuit_resolver.rs:113-262`), and boards
0026, 0037 and 0049. Summarised before in
[`../../db/research/C2-avenos-invoice.md`](../../db/research/C2-avenos-invoice.md), section 3; this corrects one point
of it.

**Biscuits.**
- The authority block holds `owns(<device did:key>, "safe:<uuid>")` and a `right` per admin op, rooted at the device's
  Ed25519 key (`caps.rs:299`).
- Attenuation is only third-party blocks, each one fact: `owns`, `reads`, `replicate` or `grant(did, op, prefix)`
  (`caps.rs:405-497`).
- **No block has a check, a TTL or an expiry.**
- The authorizer's Datalog allows when a trusted admin holds the right and the resource starts with its prefix, with
  limits of 100 ms, 10,000 facts and 1,000 iterations, because 1 ms gave false denials. Everyone else is decided in
  Rust by pulling facts out with `query_all`, which reads every block regardless of its signer (`caps.rs:1078-1163`).

**Keys per SAFE.**
- A random 32-byte DEK per SAFE.
- To share it, the granter turns its Ed25519 secret into X25519, runs ECDH with the recipient's converted key, then
  HKDF-SHA256, and wraps with XChaCha20-Poly1305. The AAD binds the URN, recipient, wrapper and DEK version
  (`crypto.rs:65-140`).
- Low-order keys are rejected.
- The recipient and version stay plaintext for routing.
- A cell's AAD binds its place and version, so a moved or rolled-back cell fails to open (`crypto.rs:171-284`).

**Operations:**
- Read; Write; Delete, gated apart from Write;
- Replicate: blind store-and-forward, no key;
- Admit: roster writes;
- RotateDek: key writes.

Roles are bundles of these (admin, reader, relay), and the wire predicates never change. A rename from `owns` to `admin`
broke the first claim and was reverted.

**The relay's gate.**
- It checks authenticity, not authority: an owner binding (`ownership.rs`) and an edit signature over a digest the relay
  recomputes.
- It denies for good on any failure.
- It reads no membership, because chains are sealed.
- The quota is 10 MiB per binding owner.
- Correction to C2: by this commit every row needs a binding at the relay. Only the client still exempts tables outside
  a SAFE.

**Removal.**
- The chain is re-minted from genesis without the removed member (`caps.rs:535`). Only the genesis owner can do it, and
  an earlier version dropped every reader on any revoke.
- The DEK version goes up, and the new key goes only to those still members (`chain_still_member`).
- Old data is not re-encrypted.
- A first genesis is trusted on first use, with a high-water mark against rollback.

**The sealed directory's lesson** (board 0049).
- Content was sealed, but the relay could read the roster: signer DIDs, kinds and status, SAFE types and slugs, and
  controllers and roles. That is the whole membership and trust graph.
- The fix sealed a profile table under its own DEK and cut the tier-0 grant.
- Still plaintext afterwards:
  - every key share's recipient and version;
  - every row's owner binding and edit signer;
  - so the relay can rebuild who writes to which SAFE.

**Wins:**
- one crate shared by app and relay;
- a raw-facts report;
- roles as labels;
- a blind replicate right;
- deletes, roster writes and key writes gated apart;
- three-state gates where only a permanent deny is final;
- owner bindings fixed at creation;
- the receiver recomputing digests and AADs;
- low-order keys rejected;
- zeroized secrets;
- an epoch high-water mark;
- the last owner kept;
- separate key domains.

**Problems:**
- third-party blocks nobody checked;
- no expiry;
- re-minting from genesis on every removal;
- a quota anyone can fill by signing a binding to someone else's UUID;
- binding and edit authors never compared;
- a client gate that allows rows of a SAFE it doesn't hold;
- static-static ECDH with signing keys, so no forward secrecy and one key both signing and agreeing keys;
- no re-encryption;
- trust on first use;
- plaintext routing metadata;
- facts built with `format!` and hand-escaped quotes.

## 4. Outside

What each system teaches this design. The rules it became are in the spec's
[first table](https://github.com/MyAvenCEO/maiacity/blob/dd5bfebad2f41ef4dff535b6c446953c55769a9d/aven/DB2/id/caps/README.md#what-it-takes-from-before).

- **Signal.**
  - PQXDH puts a hybrid KEM (X25519 and ML-KEM) into first contact, so a recording stays sealed while either holds; its
    triple ratchet adds a post-quantum ratchet to the double ratchet. The double ratchet gives forward secrecy and
    healing for messages nobody reads again.
  - Sender keys make groups cheap.
  - Sealed sender hides the author from the server.
  - Safety numbers let two people check keys out of band, and key transparency (WhatsApp, Apple's Contact Key
    Verification) lets clients detect a server that shows different keys to different people.
  - **Taken:** hybrid KEMs, the signer inside the seal, fingerprints and gossiped tree heads.
  - **Not taken:** ratchets on kept data.
- **Matrix.**
  - Megolm keeps a ratcheting session per sender and room, replaced after a member leaves.
  - Cross-signing: a master key signs a self-signing key that signs devices, and a user-signing key signs other people's
    master keys.
  - Devices are verified by short codes.
  - Key backup is sealed by a recovery key, and room keys are forwarded to new devices on request.
  - Its well-known failure is the message that can't be decrypted because its key travelled apart from it. Its move to
    MLS needed a decentralised variant (DMLS) that lets epochs fork and keeps old epoch secrets for late commits, at a
    cost to forward secrecy.
  - **Taken:** lazy rotation, keys travelling with what they open, pairing by short codes, a sealed backup.
- **MLS (RFC 9420).**
  - TreeKEM makes adds and removes cost about log n.
  - But commits for one epoch conflict and need one order (section 14).
  - Members are clients, meaning devices; an IETF draft on "virtual clients" works on showing one user's devices as one
    member.
  - Post-quantum suites are drafts.
  - **Taken:** the tree, later, for big groups, with vault and group keys as its leaves.
- **Biscuit.**
  - Offline attenuation by appending blocks, third-party blocks, revocation ids, and Datalog checks.
  - **Taken:** attenuation by the holder, approvals as third-party signatures, revocation by id.
  - **Not taken:** Datalog (see avenOS).
- **Keyhive** (Ink & Switch, 2024–2026).
  - Local-first access control: delegations and revocations live in the document's causal history, and every peer
    converges on the same access state.
  - BeeKEM is a TreeKEM variant that needs no server to order updates. The lab notes say TreeKEM needs a central server
    to order and pick winners, and that Causal TreeKEM's merge needs an associative, commutative operation they wanted
    to avoid. BeeKEM uses standard Diffie-Hellman and BLAKE3, is efficient when one device updates at a time, and grows
    linearly with updates made concurrently.
  - A 2026 paper on IACR ePrint (2026/1434) lists Ink & Switch authors with NYU, Cornell and Cambridge.
  - This session's network policy blocked `inkandswitch.com` and `eprint.iacr.org`, so these notes come from search
    summaries and should be read against the sources.
  - **Taken:** caps and revocations as Records of the Doc they govern; a BeeKEM-style tree for big groups.
- **Meadowcap (Willow).**
  - Read and write capabilities over areas (subspace, path prefix, time range), owned and communal namespaces,
    delegation by appending.
  - "Areas of interest" use the caps' grammar.
  - **Taken:** one grammar for caps and wants (the engine's D4).
- **Tahoe-LAFS.** A convergence secret makes convergent encryption safe against outsiders' confirm-a-file guesses.
- **PURBs and Padmé** (Nikitin and others, 2019). Padding lengths to a few significant bits costs at most about 12 % and
  leaks only O(log log n) bits of a length.
- **The web's PKI.** Revocation lists and OCSP never worked at web scale, and short-lived certificates replaced them. So
  memberships of huge groups renew instead of being revoked one by one.

## 5. The passkey PRF, October 2026

What the searches reported, with their disagreements kept:

- **iCloud Keychain:** works with Safari and Chrome on macOS 15+ and iOS 18+. An iOS 18.0–18.3 bug that lost PRF output
  was fixed in 18.4.
- **Google Password Manager:** works on Android in Chrome and Edge, and in signed-in desktop Chrome from about version
  132.
  - Only passkeys saved in it carry PRF. The local profile's authenticator has no hmac-secret, and Chrome may save there
    when its password-saving setting is off or another manager's extension intercepts.
- **Windows Hello:** one source says it has no hmac-secret. Another lists Windows Password Manager working on Windows 11
  25H2+ with Edge, Chrome 147+ and Firefox 148+ (2026).
- **Firefox:** one source says macOS and Windows from version 139, not Android; another lists 148+ on Windows. Mozilla
  tracks it in bug 1863819.
- **Security keys:** YubiKey 5.2+ with Chrome 116+ works. A WebKit bug of March 2026 says Safari returns the
  hmac-secret output still encrypted for USB and NFC keys.
- **Password managers:** 1Password's extension returns output that isn't spec-compliant. Bitwarden and Dashlane were
  marked unsupported in a table dated 1 June 2026.
- **A warning** worth heeding: data keyed only by one passkey's PRF is lost with the passkey. The spec seals the
  keyring to every device and passkey, plus a kit or the guardian, so no single PRF is the only way in.

Sources:
- Corbado's PRF article and demo;
- the authenticator support table at `mera.category.xyz`;
- WebKit bug 311099;
- Mozilla bug 1863819;
- the 1Password and Bitwarden community threads;
- Apple's developer forum thread 733413;
- cryptkey's passkey notes;
- lilting.ch's warning on PRF-derived keys.

## 6. Scale arithmetic

| Quantity | Value |
|---|---|
| X-Wing public key / ciphertext | 1,216 / 1,120 bytes |
| A stanza (ciphertext, wrapped key, tag) | about 1.2 KB |
| ML-DSA-65 public key / signature | 1,952 / 3,309 bytes |
| A hybrid signature (Ed25519 + ML-DSA-65) | 3,373 bytes |
| A flat rotation for n readers | about 1.2 KB × n: 12 KB at 10, 360 KB at 300, 12 MB at 10,000 |
| A tree path for n leaves | about log2 n nodes: 14 at 10,000, 20 at 1,000,000, each about 1.2 KB, plus siblings left blank by removals |
| A tree's public state | about 2n nodes × 1.2 KB: 24 MB at 10,000, about 2.4 GB at 1,000,000 |

So:
- a flat list is right up to a few hundred readers;
- a tree up to some tens of thousands;
- beyond that, a single key's state per member is the limit, and groups nest.

## 7. avenACTOR's discovery document, moved here whole

Samuel's avenACTOR session wrote this as `aven/ID/caps/README.md` on its branch (`claude/vibrant-bohr-y20cy7`, 30 Oct
2026). Its rules learned (section 8) and first principles (section 9) became the spec's rules and model; its sections
10, 11 and 13 are answered by the spec, and its open questions (section 12) by the spec's decisions. Everything is kept
below as written, its headings one level down and its links to the actor architecture written as paths.

### aven/ID/caps

Capabilities, accounts, signers, owners and access control: what our systems taught us about authority, reduced to
first principles, for the model avenID's signing and vault infrastructure will carry. Status: **discovery**. There is
no code here.

avenID's code lives in `aven/DB2/id` today; this folder holds its authority design until avenID moves. How actors get
and use authority is in `aven/actor/ARCHITECTURE.md`, which leaves capabilities to
this package and keeps the router's place for the check.

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

### 1. The question

Who may make what happen, and how can anyone check it without trusting any one peer? Every system below answers part of
it. avenDB-old answered most of it, proved it in Lean, and grew too many concepts doing so.

### 2. Where we looked

| Source | Version read | What it is about authority |
| --- | --- | --- |
| avenDB-old (`aven/db`) | this repository | Vaults, owners, devices and shares with levels, ops and cap groups; audiences and keys; all of it modelled and proven in Lean (`aven/db/spec`) |
| New avenID and avenDB (`aven/DB2`) | this repository, 30 Oct 2026 | avenID rebuilt from first principles: vaults that own vaults, devices, passkeys, invites. Caps are named but not built |
| avenOS (`MyAvenCEO/avenOS`) | `main` 8310bc3 | A custodial identity service (`aven.id`), a facade that issues short tenant grants, per-function database roles, and per-person authorization for actors |
| avenVICTORIO | `main` e1c15a8 | A restaurant's team app: a capability on every actor method, runs owned by a person, roles as capability lists. It is private and in production; its failures are described here as patterns only |
| Abject (`mempko/abject`) | v0.16.1 | Authority by where code runs, capability objects behind a permission broker, identity from the transport |

Everything below comes from reading code and documents. None of it was run for this document.

### 3. avenDB-old: vaults and shares

#### 3.1 The model

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

#### 3.2 A write, end to end

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

#### 3.3 A read

Confidentiality comes from keys. An audience key is wrapped to the key of each share of read or more that reaches it;
share keys are sealed to the grantee's seed; seeds are sealed to the vault's devices and owners. Sync filtering
decides who receives what: by audiences and marks (T12, T28). Backup receives ciphertext without keys, a relay only the
vault's log (T26), and files follow their edits (T27). Sealing used X-Wing with Classic McEliece.

#### 3.4 What is proven

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

#### 3.5 Strengths to keep

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

#### 3.6 Weaknesses

- **Too many overlapping concepts.** About twenty nouns cover authority: level, op, built-in group, cap group, cap,
  share, keep share, standing grant, audience, intake, stay, mark, wants, copy setting, follow, interest, invite,
  access request, `answering`, gate, admission, session. "Owner" alone means three things: a vault's owner, the Owner
  level and the Owner group.
- **Overloaded operations.** One `share` op makes a co-owner, a device, a grant or a keep share. A field named `level`
  carries a group.
- **Authority by name.** The gate finds admins by the cap group named `Admin`; standing grants are found by a name
  prefix; the app opens pages by the names of the groups a person holds. The app does look the groups up in the right
  coop by its id, never by its name, but a name is still the key.
- **A gate not fully blind.** The gate must read Maia City's cap-group entries.
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

### 4. The new avenID and avenDB

`aven/DB2` rebuilds identity as its own package, avenID, Lean first.

#### 4.1 The model

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

#### 4.2 Not built yet

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

### 5. avenOS: custodial identity and short grants

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

### 6. avenVICTORIO: capabilities at the actor door

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

### 7. Abject: authority from position

- **Authority comes from where code runs and whom it can message, not from what it declares.** Built-in objects are
  trusted; generated ones are not, and cannot pass for built-in.
- **Capability objects** own every real effect: HTTP, files, shell, storage. A permission broker combines an autonomy
  level (`ask`, `read`, `edit`, `full`) with a ceiling set by the workspace; a public workspace is capped at `ask`.
- **One place asks the person.** The first answer wins from any device; with no one to ask, the answer is no.
- **True names**: a peer is named by the hash of its public key. The receiving side sets the authenticated sender;
  "a value from the wire is never trusted".
- **Workspaces** are local (nothing in or out), shared (named peers, end-to-end encrypted) or public.

### 8. Rules learned

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
12. **Short grants where one host checks online, revocable capabilities where peers check offline.** Each fits a
    different place.
13. **Viewing as someone else narrows rights** and never widens them.
14. **Recovery is never one key.** Guardians, a quorum, and a delay in which the owners can cancel.
15. **Hosts see ciphertext and as little metadata as possible,** including the social graph.
16. **The UI holds no rule.** It asks the engine for a dry run.
17. **Budgets are capabilities.** Uses, expiry, money and autonomy levels are conditions on a grant.
18. **Checking stays cheap.** A grant must not cost upkeep on every entry it reaches.
19. **Proven first.** The model and its theorems in Lean, then tests from it, then code.
20. **One meaning per word.**

### 9. First principles: what each concept is for

Strip each concept to the job it does; where two do the same job, keep one. Four essentials remain.

| Essential | Its one job |
| --- | --- |
| **Key** | The only thing that can sign. Passkeys, device keys, invite keys, recovery keys and a keeper's keys are all keys; they differ only in who keeps them |
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

### 10. How actors get authority

An actor is not a vault and owns nothing. It holds capabilities delegated by whoever spawned it, each narrower than
the spawner's, rooted in a person's vault. Every envelope carries its run, and the run's owner bounds what can happen.
The kernel's router checks the capability on every message; the door actor that performs an effect checks it again
against the run's owner; a capability with an approval condition waits at the gate for the quorum's signed press over
that exact call. See `aven/actor/ARCHITECTURE.md`.

### 11. What a capability carries

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

### 12. Open questions

1. **Capabilities per document, or selectors over a vault?** Per-document caps (DB2's definition) remove the marks and
   re-keying upkeep and hide more metadata, but cost a grant per document. Meadowcap is a reference.
2. **How k of n is signed:** a list of signatures over one digest, or an aggregate.
3. **Recovery:** who the guardians are, and how long the delay.
4. **Post-quantum signatures:** when ML-DSA joins through the suite byte.
5. **Actors and keys:** does an actor ever hold a key, or only capabilities the kernel holds for it?
6. **Offline checks and short grants:** which places verify capability chains, and which accept short grants.
7. **Metadata:** how much of a capability a relay must see to route.

### 13. Next steps

1. Model capabilities in Lean beside avenID's `Governs` (`aven/DB2/id/spec`), before any code.
2. Theorems: a capability never exceeds its parent; revocation wins; an approval needs the quorum's signatures over
   the exact digest; no act without a proof; an actor's capabilities stay within its run owner's.
3. A wire format with a suite byte.
4. A first slice: a person vault with two passkeys approving one act 2 of 2.
