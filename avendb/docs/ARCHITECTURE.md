# avenDB architecture

avenDB is the user-owned, end-to-end encrypted, local-first database under maiaCITY. This file describes it as it
ships with edit format version 8, from first principles. It is the one reference for the design.

Three things keep it honest. The Lean model in `avendb/spec` states what must always hold and proves it. The Rust
crates in `avendb/crates` build it. Shared test vectors (`avendb/spec/vectors`) hold the two to the same answers, edit
by edit. Where this file and the model disagree, the model is right and this file is wrong.

Paths below are relative to `avendb/` unless they start with `src/` or `static/`, which are the app's.

## Contents

1. [The shape: Entry, Share, Blob](#1-the-shape-entry-share-blob)
2. [What it guarantees](#2-what-it-guarantees)
3. [Vaults, owners and devices](#3-vaults-owners-and-devices)
4. [Edits, logs and the replay](#4-edits-logs-and-the-replay)
5. [Shares](#5-shares)
6. [Audiences, marks and keys](#6-audiences-marks-and-keys)
7. [Entries, writes and history](#7-entries-writes-and-history)
8. [JSON ops, op groups and fit](#8-json-ops-op-groups-and-fit)
9. [Schemas and lenses](#9-schemas-and-lenses)
10. [Post-quantum only](#10-post-quantum-only)
11. [Passkeys](#11-passkeys)
12. [Sync over iroh](#12-sync-over-iroh)
13. [Files](#13-files)
14. [Storage: one shelf per place](#14-storage-one-shelf-per-place)
15. [The Lean model: what guards what](#15-the-lean-model-what-guards-what)
16. [Where to look](#16-where-to-look)

## Words

| Word | Meaning |
|---|---|
| Vault | An identity, like a smart account: a person's, a group's (coop) or an agent's (aven). It owns entries. |
| Entry | One item of data in one vault: a Loro document with a type and tags. |
| Edit | One signed change. Its id is the SHA-3 hash of its bytes. Eight kinds. |
| Log | The edits of one vault, one share, one audience or one entry. Each edit builds on its log's frontier. |
| Share | Who may do what on which entries of a vault: who, level, what. |
| Level | Keep, Relay, Backup, Read, Write or Owner, in that rank order. |
| Audience | The shares that pick an entry, in the clear. It carries the entry's key. |
| Mark | The edit in which a steward writes an entry's audience, its wants, or both. |
| Steward | A device acting for the vault itself. It reads every selector and keeps the marks true. |
| Keep share | A share to one device of the issuer: which entries it syncs, and whether it keeps files whole. |
| Stay | One period of an entry in one audience, named by the mark that began it. |
| Epoch | The generation of a key family. It moves on when someone loses access. |
| Shelf | The one place a device keeps what lasts: OPFS in a browser, a folder on a desktop, a bucket on the server. |
| Holdings | What one device says it holds for good: each log's frontier, and each file whole or in pieces. |

## 1. The shape: Entry, Share, Blob

Everything in avenDB is one of three things, one per layer.

1. **Entry: what.** All data is an entry in a vault. Notes, todos, files, a device's card, a vault's profile, and also
   schemas and lenses. An entry changes only by writes.
2. **Share: who may.** A share says who, at which level, on what. People, Everyone, servers and a device's keep rule
   are shares. A vault's owners and its devices are shares too. A revocation ends any of them. A vault has two
   settings beside them: how many owners must approve (its threshold), and its root passkey.
3. **Blob + holdings: where.** All bytes are blobs named by their BLAKE3 hash, on one shelf per place. Each device
   tells its peers, for itself alone, what it holds for good.

Everything else is derived and never typed in: whom an entry is shared with, its audience's key, the marks, which
devices an entry is synced to, and what a device still has to fetch.

Seven principles follow from the shape:

1. **One log of signed edits is the only truth.** Shares, marks, keys and writes are signed edits. Every view is
   computed from them.
2. **One kind of permission.** A share is a named group of ops on a selector. Revoke ends any share.
3. **One label per entry.** The mark says, in the clear, which shares pick an entry. Relays route and check writes by
   it, and readers check it against the selectors.
4. **One kind of bytes.** Content-addressed blobs on one shelf per place. Durable means finished on the shelf.
5. **One frontier.** Holdings. Every "where is it" answer comes from them.
6. **One transport per job, the iroh way.** Our protocol decides what a peer may get. iroh-blobs moves the bytes.
7. **Never delete, put aside.** An old store becomes an older generation beside the new one.

## 2. What it guarantees

Each line names the theorem that states it (section 15).

- **Local first.** A write is signed, encrypted and saved on its device, and counts there at once, online or not. No
  server orders, approves or merges anything.
- **Only authorized edits stand.** A write stands only if its author acts for a vault that may write the entry (T1).
  Governance needs the vault's approval and the newcomer's consent (T2). Shares never grant more than the shares they
  rest on (T22), and Everyone only reads (T8).
- **Only readers open.** A key opens only for whoever could read its family (T5). The server opens nothing but what is
  public (T7). An entry's key reaches only its audience's readers (T24).
- **Revocation is final for the future.** After a removal, the current keys open only for those still entitled (T6),
  and a device that has seen the removal writes under keys the removed never get (T15). Edits signed on an old copy
  and dated before the removal are cut, if they relied on what it took away (T16).
- **Everyone ends the same.** The same edits in any order give the same state (T11). Frontier sync loses nothing
  (T19), and two devices that asked each other once hold the same edits of what both sync (T13).
- **Sync sends only what shares reach.** A peer sends a device only what its vaults may receive (T12). A relay share
  receives nothing of the entries (T26). A keep share narrows what comes, never widens it (T28). A file goes only with
  a write that brings it (T27).
- **Relays are blind and still exact.** The server reads no selector, type or tag, yet every edit stands or falls for
  it exactly as for an owner (T25).
- **Post-quantum.** Once the curves fall, a write counts only if its author's hash-based checkpoint covers it (T18).
  Every other edit carries a hash-based signature anyway.
- **Readers agree.** Whether a write counts reads nothing a reader may lack (C2), a counted write did only what its
  chain allows (C3), and it fits its entry's schemas (S3).

What the proofs don't cover: the Rust and Loro code itself (the vectors and tests do), timing and traffic analysis, a
file's exact length (its sealed size shows it), and a device compromised while it is unlocked.

## 3. Vaults, owners and devices

A vault is an identity. Its id is the id of its genesis edit. It comes in three kinds (T21, `policy::Kind`):

| Kind | Owned by | Devices | Root |
|---|---|---|---|
| Human | Signers: the person's passkeys and the master recovery key | Their desktops, phones and browsers | A passkey |
| Coop | Human and coop vaults | None: it acts through its owners | None |
| Aven | Human and coop vaults | Its servers, which act for it and never govern | None |

**Approval.** A vault approves a change through its root alone, or through its threshold of owners. The root passkey
of a human vault approves anything on its own, wins every clash, and is the only one that hands the root on.

**Governance** is the vault's settings (threshold, root) and the sharing or revoking of an owner or a device. It needs
the vault's approval plus the newcomer's consent, except that an owner or a device may leave on its own (T2). Devices
never govern: a device of a human vault or a server of an aven vault acts for it and approves nothing.

**Acting through owners.** A coop has no devices, so a person acts for it from a device of their own vault. Every edit
that acts for a vault names the chain of owners it goes through (`via`): from an owner of the vault down to the vault
the author's device belongs to, each an owner of the one before. The rules check that chain alone
(`State::acts_via`, `actsVia` in `spec/AvenDB/State.lean`). A removal anywhere along it cuts the edit the same way on
every device (T1, T16).

**The master recovery key.** One master recovery key is a way back in beside the passkeys. It is a signer like any
other, a passkey kept in software (`crates/avendb/src/recovery.rs`), whose keys all derive from 32 secret bytes kept
offline. Its public file is built in (`crates/avendb/master-recovery.pub`, key `d9941b22…`). Every human vault is
founded with it among its owners: it is an Owner share on Everything, added at genesis. The key signed one standing
consent as it was made (`sign::consent_challenge`), which an edit that adds it takes in place of its signature
(`sign::standing`). It shows among the owners as "Master recovery key" and is removed like any owner. Whoever holds
the secret owns every vault that has it, so only the `.pub` file is handed on. The tool is
`cargo run -p avendb --bin master-key` (`crates/avendb/src/bin/master-key.rs`).

**avenCEO and the server.** The server is a device of avenCEO, an aven vault. A new server belongs to no vault. The
first person to found a human vault through it claims it in the same ceremony: their passkey founds avenCEO, owned by
their vault, and adds the server as its device; the server checks the edit and signs it too (`Lab::accept_claim`).
After that, nobody can claim it again.

## 4. Edits, logs and the replay

**An edit** is `{parents, depth, author, cosigners, action}` (`policy::Edit`). Its bytes have one canonical encoding,
which starts with the version byte 8 (`crates/avendb/src/encode.rs`). Its id is the SHA-3 (cSHAKE256) hash of those
bytes, and its signatures sign the id (`crates/avendb/src/sign.rs`).

**Eight kinds.** The action's first byte is its kind (`policy::Action`, `Action` in `spec/AvenDB/Step.lean`):

| Tag | Kind | What it does | Log | Removal |
|---|---|---|---|---|
| 0 | Genesis | A new vault: kind, owners, threshold, root | Its vault | No |
| 1 | Settings | 0 Threshold, or 1 Root (hand the root on) | The vault | Root only |
| 2 | Share | 0 Grant (a share), 1 Owner, 2 Device | Grant: its share. Owner, Device: the vault | No |
| 3 | Revoke | 0 Grant, 1 Owner, 2 Device | Grant: the share's. Owner, Device: the vault | Yes |
| 4 | Write | An encrypted change of one entry, and the files it brings | The entry | No |
| 5 | Mark | An entry's audience, its wants, or both | The entry | With an audience |
| 6 | Keys | The real boxes of one key | The key's family | No |
| 7 | Checkpoint | A device vouches for its own writes of one entry | The entry | No |

The kind alone says which log an edit belongs to (`sync::log_of`), so a peer that knows nothing else routes it.
Owners and devices keep sub-kinds of their own under Share and Revoke for the same reason: the functions that read an
edit alone (its log, its rank, its standing consent, the pass key) find the class in the tag.

**Logs.** Every edit belongs to one log (`sync::LogId`): a vault's (its genesis, settings, owners, devices and seed
keys), a share's (the share, its revocation, its keys), an audience's (its keys) or an entry's (its writes, marks,
checkpoints and keys). An edit names as its parents the frontier of its own log as its device held it. Its depth is one
more than the deepest edit its device held, across logs, so depth is one clock for the whole replay.

**Closed part and frontier.** A device's closed part of a log is the edits whose whole past it holds. Its frontier is
the closed edits nothing else builds on. An edit whose parent hasn't arrived waits outside, with whatever builds on
it (`sync.rs`, `spec/AvenDB/Logs.lean`).

**One order.** Every peer replays the edits it holds in one order: by depth, removals first, then by id. So concurrent
edits settle the same way everywhere (T11).

**Strong removal (T16).** Ordering alone doesn't stop a removed owner, or a thief with a stolen passkey, from signing
edits on an old copy that claim to come first. So every removal names the edits it had seen (`keep`). Any other edit
before it in the order stands only if it also stands with what the removal takes away hidden. The removals are: every
revocation, handing the root on, and a mark that moves an entry to another audience. When removals clash, the senior
stands (`priority` in `Step.lean`, `resolve` in `policy.rs`):

1. A vault's own removals: revoked owners and devices and a new root. A vault's before those of the coops it owns.
   Within a vault, the root's first, then owners in the order they joined, then removals no owner approved.
2. Revoked grants, the most senior revoker first: the vault the share is over, then issuers up the share's chain.
3. Marks that move an entry. Such a mark takes away only what writes of its own entry relied on, so Rust tries them
   in one batch and chooses what the model's one-by-one tries choose.

A junior owner can't keep his own removal out by removing his remover: his removal is tried later and refused, as he
is no longer an owner at its place. A mark of the wants alone takes nothing away and is no removal.

**Forks.** A device signs its edits in a log one after another. Two of its edits in one log where neither builds on
the other mean its key signed twice from the same past: a restored backup, a clone or a stolen key. Every peer flags
such forks (passkeys, which sign on several devices, aside). Both edits stand, as concurrent edits do.

## 5. Shares

A share is `{over, who, level, wide, select, parent, issuer, nonce}` (`policy::Share`, `Share` in `Basic.lean`). Its
id is the id of the edit that issued it. To a person it is three things: **who**, **level**, **what**.

### Who

| Who | Byte | Rules |
|---|---|---|
| A vault | 0 | Never the vault the share is over (CapToItself). A share to a vault reaches all its devices. |
| Everyone | 1 | Read only (T8, PublicBeyondRead). Its audience's key is published in the clear. |
| A device | 2 | Only as a keep share, and only of a device of the issuer (T4: KeepNeedsDevice, DeviceOnlyKeeps). |

A new phone needs no new share: a share to a vault reaches every device that acts for it.

### Level

A level's byte on the wire is its rank, and each level includes those below it, Keep aside:

| Rank | Level | Group a person sees | What it allows |
|---|---|---|---|
| 0 | Keep | Keep (whole, when opened, never) | Nothing. It says what one device syncs. A mode byte follows. |
| 1 | Relay | Relay | Learn the vault's devices from its log, so a server lets them through. Receive no entry. |
| 2 | Backup | Backup | Keep and pass on the ciphertext of the entries it reaches. No key. |
| 3 | Read | Viewer, Public | Open the entries it reaches. |
| 4 | Write | Editor, Suggester | Also write them, as its ops allow, and create entries through it. |
| 5 | Owner | Owner | Also issue shares resting on it. Governance. |

A share's level is never chosen apart from its ops: it is the class of its strongest op (section 8).

### What

A share is **wide** (the whole vault, said in the clear) or picks entries by a **selector** over their labels: type,
author (the vault that created it), entry id, creation time, and tags (has, has none of, only these). A selector is
`all`, or up to 8 conjunctions OR-ed, each of up to 16 tests, with lists of up to 1,000 ids (`crates/avendb/src/
slice.rs`). Type, author, entry and creation time never change; tags do, so a share reaches each entry tagged so now
and later, and lets go of one untagged.

The selector, the share's name and its ops travel **sealed** in `select`: to the seed of the vault it is over, of its
grantee and of its issuer. In the clear, `select` carries only a salted hash of the ops (`rules::Grant::commitment`).
So a relay sees who holds which level, and nothing of what it picks or allows.

### Chains (T22)

A share may rest on another (`parent`): a live owner share over the same vault whose grantee is its issuer. A chain
selects the AND of its selectors, and allows only what every share of it allows (C1). A share with no parent is
issued by the vault it is over. A wide share rests only on a wide one, and no owner share is wide (below), so every
wide share rests on none.

### Owners and devices are shares

To a person, a vault's owners and devices are rows in one list of shares:

- An **owner** is "Owner on Everything": a co-owner who approves governance. On the wire it is `Sharing::Owner`.
- A **device** "acts for" the vault. On the wire it is `Sharing::Device`.
- `Revoke` ends any row: `Revoking::Grant`, `Revoking::Owner` or `Revoking::Device`.

Each keeps the rules it needs. An owner needs the vault's approval and the newcomer's consent, and a signer owner of a
human vault brings the key that keys are sealed to. A device needs the vault's approval and signs too; coops have none
(NoDevices). Owners and devices leave on their own. Their edits go to the vault log, which carries governance alone.

**WideOwner.** "Owner of the whole vault" means co-owner, which only `Sharing::Owner` makes. A wide grant at Owner is
refused (WideOwner). So a coop or a person can't be made Owner on Everything of a human vault: T21 lets only signers
own one. An Owner share on a slice, one todo or a tag, stays: its holder may share that slice on, and issuing it takes
the issuer's approval.

### Everyone

Everyone gets read alone. An audience that an Everyone share reaches is public: its key is published in the clear, so
anyone who receives its edits opens them. Everyone shares reach only devices with an interest in the vault, or that
ask for it by name (section 12, interest and follow).

### Servers: Relay or Backup

A vault gives avenCEO, the server's vault, a wide Backup share at founding, so the server keeps the ciphertext of all
its entries and opens none. With backups off it gives Relay instead: the server learns the vault's devices from its
log, to let them through its relay, and keeps nothing of its entries (T26). The person switches between the two in
the vault's Sharing.

### Keep shares

A keep share is `{over: V, who: Device(d), level: Keep(mode), wide, select, parent: None, issuer}`. It says which
entries of V device `d` syncs, and how. It grants nothing.

- **Who may issue one.** The issuer acts through its owners as for any edit. `d` must be a device of the issuer vault
  itself (NotDevice). The issuer must be V, or hold a share over V at Backup or more (NoCap). It rests on nothing
  (BadParent).
- **Modes.** `Whole` syncs the entries it picks and keeps their files whole. `Opened` syncs them and fetches file
  pieces as they are read. `Never` subtracts: the device doesn't sync what it picks.
- **What a device wants.** With no keep share over V, or only Never ones, it wants all of V but what a Never share
  picks. With a Whole or Opened one, it wants what one of those picks and no Never one does. It keeps an entry's files
  whole exactly where a Whole share picks it (`wantsWith`, `keepsWith` in `State.lean`; T28).
- **No keep share.** A device with no Whole or Opened share over a vault falls back on its own setting
  (`Options::keep`): the server keeps every file whole, a desktop fetches pieces as it reads them.
- **Schemas ride along.** A Whole or Opened share also picks every schema and lens entry of V; a Never share picks
  none (`keepPicks`). So every reader of V syncs its schemas (section 9).
- **Revoking one.** Only its issuer revokes it: not the vault it is over, which could otherwise force a device to
  sync all of it. A keep share's revocation cuts nothing: nothing rests on it, no audience holds one and no write
  relies on one (K1). A device that leaves its vault drops that vault's keep shares without any revocation.
- **Where it lives.** In its own share log, like any grant. Vault logs, and the link cards cut from them (T20), carry
  governance alone.

### Revocation

`Revoking::Grant` ends a share and every share resting on it. The issuer may revoke it, so may the vault it is over,
the grantee giving it up, and whoever may revoke a share higher up its chain; a keep share only its issuer. Revoking an
owner or a device takes the vault's approval, or the owner or device leaving.

Every revocation is a removal (section 4). It moves no entry: the audiences the share was in move to a new epoch,
whose key only the shares still live get (section 6). What the revoked read before stays read.

### Refusals

A refused edit is never applied, and every peer refuses the same edits for the same reason (`policy::Refusal`). The
share refusals are UnknownCap, NoCap, BadCap, CapToItself, PublicBeyondRead, WideOwner, BadParent, Revoked,
KeepNeedsDevice, DeviceOnlyKeeps and NotDevice. Governance has BadOwners, AlreadyMember, NotMember, NoConsent,
BelowThreshold, BadThreshold, WrongOwnerKind, LastOwner, Cycle (T3), NotHuman, NoDevices and NotRoot. Marks have
WrongVault, BadMark, BadAudience, SameAudience, BadWants and SameWants.

## 6. Audiences, marks and keys

### Audiences

No rule a peer checks reads a selector, a type or a tag. So each entry carries, in the clear, the list of shares
that pick it: its **audience**. It is the canonical list of the live shares over the vault that are not wide, not keep
shares, and whose chain selects the entry (`semAudience` in `State.lean`, `Meaning` in `policy.rs`). Wide shares
reach every audience, so they never split one. An audience is named by `AudienceId::of(vault, shares)`, a hash with
the context "audience id" (`crates/avendb/src/id.rs`).

The audience is the unit of keys and of sync. Share the todos tagged garden with Bob as an Editor, and every todo
tagged garden has the audience `[that share]`. Bob gets that audience's key once.

### Stewards and the Mark

The devices that act for the vault itself are its **stewards**. They read every selector and every entry, and keep
the clear labels true by writing one edit:

```
Mark { vault, entry, caps: Option<[ShareId]>, wants: Option<[ShareId]>, keep: [EditId], via }
```

- **caps** moves the entry to the audience of those shares. It begins a new stay, and keeps the writes it had seen.
  It is a removal: a write it hadn't seen that relied on the old audience is cut, so nobody backdates an edit into an
  entry after it left their slice.
- **wants** lists the keep shares that pick the entry. It takes nothing away and is no removal.
- A part left out (`None`) stays as it is. So a stale mark of the wants alone never puts back an audience another
  steward changed meanwhile. Only a change of caps cuts writes or starts a stay.
- **Checks** (WrongVault, NotActing, BadMark, BadAudience, SameAudience, BadWants, SameWants): the entry is in the
  vault; the author acts for it; at least one part is there, and `keep` only with caps; caps is canonical, of shares
  over the vault that aren't wide or keep shares, and not the audience it is in; wants is canonical, of keep shares
  over the vault that aren't wide. Neither list is checked for liveness: readers leave out what isn't live. A
  liveness check would let a revocation that sorts earlier refuse a mark, and then every write in its stay would fall.
- **Upkeep.** After each batch of edits, a steward compares each entry's live marks with what the selectors say, and
  emits one mark where they differ (`Lab` upkeep in `crates/avendb/src/lab.rs`). It answers tag asks first.

**T23, marks mean what the shares say.** Where an entry's live audience is its semantic audience, the write rule every
peer checks allows exactly the vaults the selectors allow, and never refuses a creation inside its creator's slice.
Where its live wants are its semantic wants, each device wants the entry, and keeps its files whole, exactly as its
keep shares say. Both parts follow from one lemma, `mark_means` (`spec/AvenDB/CapLemmas.lean`). So a peer that reads
no selector, such as the server, applies every share and every keep share from the marks alone.

**Creating through a share.** A writer who is not a steward reads no other share, so it can't work out the audience.
It creates the entry in its share's **intake audience**: the non-wide shares of its chain. A steward then marks it
into its semantic audience. If the creator made it outside its own slice, the steward moves it to an audience none of
the creator's shares reaches.

**Tags by request.** Tags travel inside the encrypted body of writes. A write acting for the vault changes them at
once. Any other writer's tag change is an ask, which the stewards answer in a write of their own that names it
(`answers`), granting what the asker's share's `tag` ops allow, where its slice holds the entry before and after.

### Keys

Derive inside the owner's domain, wrap only across a trust boundary. Every key is 32 secret bytes, and named by its
hash, which every box and write names (`crates/avendb/src/keys.rs`).

| Family | What it is | Who gets it |
|---|---|---|
| Device key | Per device, derived from the passkey's PRF output at each unlock | The device itself |
| Seed of vault V | Random per epoch, with a sealing key pair | V's devices and signer owners, its owner vaults' seeds |
| Share key | Random per epoch, for shares at Read or more | Wrapped under V's seed, sealed to the grantee's seed |
| Audience key | Random per epoch | Wrapped under V's seed and under each live Read-or-more share key that reaches it |
| Entry key | Derived from the audience key, per entry, stay and epoch | Whoever opens the audience key |

Relay and Backup shares get no key at all (T7). An Everyone share's key, and the keys under it, are published in the
clear: that is what Public means.

- **Boxes.** A key is sealed to a signer or a seed (X-Wing and Classic McEliece, section 10), or wrapped under a key
  the boxing device holds. A `Keys` edit carries the real boxes. A peer accepts it only if every box goes where the
  schedule (`State::seals`, `sealAll` in the model) says it may (T5, T6).
- **Epochs.** A family's key moves to a new epoch when someone who could open it no longer may. The old key is sealed
  under the new one, so whoever remains reads the whole history.
- **Move links.** A mark that moves an entry wraps its earlier stays' keys under the new one. So whoever reads an entry
  now reads its whole history, and nothing of an entry it can't read now (T24).
- **Writing.** A device encrypts each write under its entry's key in its stay, at the audience's newest epoch it
  knows (T15). So once it has seen a removal, the removed can't open what it writes.
- **An audience that comes back into use.** An audience no entry is in keeps its key through removals. The entry that
  brings it back moves it to a new epoch, which whoever a removal took out meanwhile can't open.

What rotates on what:

| Trigger | Work |
|---|---|
| A share is issued, a vault gains a device | A few boxes: the share key to the grantee, the seed to the device |
| A share is revoked | Each audience it reached moves to a new epoch, boxed to the shares still live |
| A vault loses a device or an owner | Its seed moves on, and with it its share and audience keys in use |
| An entry's tags change, a new share picks it | One mark, with its move link |

**Why stays remain.** Entry keys are derived per stay, not per (audience, epoch). Suppose an entry is in audience X
at epoch 1, a mark moves it to Y (the move link gives Y's readers its X key), and another mark moves it back to X.
Nobody left X, so X is still at epoch 1. Y's readers would then open the entry's new writes without being able to
open X's current key. That breaks T24 and T15. A new stay at each mark keeps them true.

## 7. Entries, writes and history

**An entry** belongs to one vault and is named by 32 random bytes its creator draws. Its first write creates it and
carries its header, which never changes: its type and when it was created. Its author is the vault the creating write
acted for. Its tags are a set of symbols that writes change by deltas. Header, tags and content all travel in the
write's encrypted body (`slice::Body`): `{header, tags, answers, content, proof, files}`. No relay sees a type or a tag.

**Loro.** Each entry is a Loro document, a CRDT. Two devices that hold the same writes read the same entry, whatever
order they came in. Text merges character by character. A list of records merges row by row, matched by id. Any other
field takes one value, the same on every device. Records are flat (`crates/avendb/src/doc.rs`, `ops.rs`).

**A write** is `Write { vault, entry, actor, stay, epoch, deps, proposal, via, create, files, body }`. `deps` are the
entry's writes it builds on (its Loro frontier). `create` names a new entry's first audience. `files` names, in the
clear, the files it brings. `body` is encrypted under the entry's key and bound to the rest of the edit
(`encode::write_context`), so it can't be moved to another edit, entry, stay or epoch.

**Lines of history.** Every write extends one line of its entry's history: the main line, or a proposal. A proposal
starts from any version and is named, encrypted. A write on a proposal builds on its start, so a revocation that cuts
the start cuts the whole proposal (`spec/AvenDB/Proposals.lean`).

| Action | What it writes |
|---|---|
| Propose | A write that starts a line from any version |
| Merge | A write on the target that builds on both lines' heads: the union of both histories (T10g) |
| Promote | A merge that also makes the target read exactly like the proposal (T10h) |
| Restore | A new write that puts back an older version |
| Undo | A new write that takes out one older write, by a three-way merge of records |
| Variant | A new entry with what a line reads now and its tags, and none of its history |

A write on one line changes no other line (T10f). Nothing is ever overwritten: restore and undo are writes too.

**Whether a write counts** is decided by every reader the same way. It counts when it fits its schemas (section 8),
builds only on writes that count, and its actor is the entry's vault or its proof names a live share whose chain
allows what it touched. A write that doesn't count stays in the log, sealed, and shows on no line, nor does anything
built on it. So an app patched to skip the checks writes nothing anyone reads.

## 8. JSON ops, op groups and fit

### One language for every read and change

Every read and change of avenDB is one JSON op, whatever the schema (`crates/avendb/src/engine.rs`):

- **Reads:** `query`, `get`, `history`, `schemas`, `groups`.
- **Changes:** `create`; the record ops `set`, `unset`, `insert`, `remove`, `move`; `tag`; `propose`, `merge`,
  `restore`, `undo`, `variant`; and `batch`.
- **Asking:** `may` runs ops dry and answers, for each, whether this device would make it now. The page asks before it
  shows a button.

A path names a place in a record: `["title"]`, `["blocks", {"id": 2}, "text"]`. A query's `where` mixes labels
(type, author, entry, created, tag) with tests on values. Its labels compile to the very selector a share holds, so a
device picks entries by labels before it opens any (O3). Every answer is `{"ok": ...}`, or
`{"refused": name, "why": "..."}` with the rule's name.

One engine runs on every device. The browser's device answers `Device::run(op)` (`crates/avendb-browser`); the
desktop app's native device answers the same JSON on its `run` call (`crates/avendb-device`). The page writes ops
through `src/lib/avendb/ops.js`. Sharing, settings and files go through one `run(op)` too; that part of the API is
still being settled.

Two laws tie changes to what they did, proved in `spec/AvenDB/Ops.lean`: a diff explains any two records (O1), and an
op changes only what it names (O2).

### A share is a named group of ops

A share's sealed slice is `{name, where, ops}` and nothing else (`crates/avendb/src/rules.rs`, `Rules.lean`):

```
Op      = {"op": "relay" | "backup" | "read" | "create" | "propose" | "share"}
        | {"op": "set", "path": Pattern, "to": [v]?, "on": On?}
        | {"op": "insert" | "remove" | "move", "path": Pattern?, "on": On?}
        | {"op": "tag", "tags": [tag]?}
        | {"op": "merge", "on": On?}
Pattern = a path whose steps may be "*"; [] is the whole record
On      = "main" | "proposals"
```

The level is the class of the strongest op (`rules::level_of`): relay, backup, read, write (any op that writes) or
owner (`share`). The built-in groups (`rules::groups`):

| Group | Ops | Level |
|---|---|---|
| Owner | Everything, and share on | Owner |
| Editor | Read, create, set, any tag, propose, merge | Write |
| Suggester | Read, set on proposals, propose, merge on proposals | Write |
| Viewer | Read | Read |
| Public | Read, to Everyone | Read |
| Backup | Keep and pass on the ciphertext | Backup |
| Relay | Find the vault's devices, keep nothing | Relay |

Anyone may name a group of their own. "Bob may set the status of the todos tagged work, to doing or done":

```json
{ "name": "Tick work",
  "where": { "all": [{ "type": ["todo"] }, { "tag": "work" }] },
  "ops": [{ "op": "read" }, { "op": "set", "path": ["status"], "to": ["doing", "done"] }] }
```

**Proof-carrying writes.** A write through a share carries in its encrypted body a proof (`rules::Proof`): the share
it relies on, and the ops and salt of each share of its chain. Readers check them against each share's commitment and
level. They read the write's **touches** off its Loro ops, imported on the version it builds on
(`doc::Item::footprint`): each place set, row added, removed or moved, the creation, a proposal started, a merge, a
tag asked. A chain allows a write when every share of it allows every touch.

- **C1** chains narrow: a chain allows nothing one of its shares forbids.
- **C2** readers agree: whether a write counts reads no selector, type or tag.
- **C3** counted writes do what they may.
- **C4** allowed writes count, and nothing built on an uncounted write does.

### Writes that fit their schemas

Every reader judges each write by the schemas its entry was written under, once the write is in
(`lens::Lane::fits`, `spec/AvenDB/Schemas.lean`). Each place it changed holds a value a schema allows there, and each
row it added or changed reads under one of them. A write is judged by what it changed alone (S1), so a record that fits
stays so (S2). One that doesn't fit counts for no reader, nor anything built on it (S3). Relays can't tell, and don't
judge (S4).

## 9. Schemas and lenses

**Schemas** are JSON Schemas, each named by its hash. A **lens** says how a record of one schema version reads as
another, both ways (`crates/avendb/src/lens.rs`, `spec/AvenDB/Lens.lean`). No record is ever migrated: each field stays
in the version it was written in, each app reads through the lens into its own version, and its edits go back as only
what changed (T9). So an old app and a new one edit the same todo side by side, and defaults live in the lens.

**Schemas and lenses are entries.** A vault's schema or lens is an entry of the built-in type `schema` or `lens`,
whose creation holds the schema or lens itself. Every vault shares them with Everyone, through a Viewer share of its
own that picks those two types, made just before its first schema or lens entry. So whoever reads anything of a vault
can read the schemas it was written under.

**The lane** is what readers read off those entries (`laneOf` in `State.lean`): for each schema or lens entry of V
that V created itself, through the owners its creation names, and that its readers count, the blob of its creation,
in creation order. One created by anyone else through a share adds nothing. A later write to such an entry is ignored.
No peer checks the lane, and the server knows none (T17, T25).

A write counts once its reader holds its schema: the lane only grows, so a verdict changes at most once, from not
counted to counted. Readers agree on the lane because every reader of V syncs V's schema entries: a keep share always
picks them (section 5).

## 10. Post-quantum only

Every node trusts no elliptic curve alone, and there is no switch back.

| Where | How |
|---|---|
| Signatures | Hybrid: ed25519 and SLH-DSA-SHA2-128f on a device, P-256 and SLH-DSA on a passkey, both checked. |
| Writes | The classical half alone, to stay small. Its device vouches for it in a Checkpoint, which carries both. |
| Counting | A write counts only once a checkpoint by its own author covers it (T18). |
| Sealed keys | Every box is sealed to X-Wing (ML-KEM-768 with X25519) and Classic McEliece 6688128f at once. |
| Data | XChaCha20-Poly1305 for edits and boxes, ChaCha20-Poly1305 per 64 KiB file segment, 256-bit keys. |
| Hashes | SHA-3 (cSHAKE256) for ids and what is signed. BLAKE3 only to store and move bytes. |
| Connections | TLS 1.3 with X25519MLKEM768 as the only key exchange, on every link between nodes. |
| Hellos | Each connection opens with an SLH-DSA signature each way over the TLS exporter (section 12). |
| The bucket | Its endpoint is classical, so the server seals every object first, with a 256-bit key of its own. |

A box opens only with both shared secrets, so it stays closed while either scheme holds. A McEliece public key is a
megabyte, so it travels as a blob named by its hash, beside the edits that name it. The Verifpal model `seal.vp` shows
that a sealed key stays secret when either scheme falls (`spec/protocol`).

A node checkpoints each write of its own as it makes it, and at its start what it holds that no checkpoint covers.
`spec/AvenDB/Step.lean` (`checkpointed`) models what a peer counts once the curves fall.

## 11. Passkeys

A person's passkey is the root of everything they hold. It stays in their platform's authenticator, used through
WebAuthn with the PRF extension (`crates/avendb-browser/js/passkey.js`). A device never holds it, only what one
ceremony brings back: an assertion over a challenge, and PRF outputs on avenDB's salts.

- **One passkey for maiaCITY and avenDB.** Both use the relying party `maia.city`, so the passkey a person signed up
  with can be their vault's root. Sign-up asks for PRF and P-256 first.
- **User verification in every ceremony.** Without it an authenticator's PRF answers with another secret. Every
  assertion must show it (`sign::Assertion`).
- **Salts of its own.** The passkey's keys derive from the output on avenDB's salt (`sign::PRF_SALT`). Each device's
  own secret is kept masked by the output on its own salt, which ends in 32 random bytes the device keeps. So a device
  unlocks only with its person's passkey, and a stolen, locked device opens nothing.
- **Bound to the passkey.** A ceremony counts only if its assertion verifies under the passkey's P-256 key and the
  SLH-DSA key derived from its PRF output is the one the vault knows (`sign::Ceremony`).
- **One prompt for many edits.** Edits drafted together are signed in one ceremony over their batch
  (`sign::batch_challenge`). A first browser founds its vault, adds itself and claims a new server in one prompt after
  the unlock.
- **The pass.** The ceremony that unlocks a new device is its passkey's pass for it (`sign::RelayPass`): an assertion
  and an SLH-DSA signature over the device's keys and the time, good for ten minutes. It lets the device onto the
  server's relay and proves it to the peer it links through.
- **In the desktop app.** macOS lets an app's web view use maia.city's passkeys only with an entitlement, so each
  ceremony runs in a sign-in sheet that seals what it brings back to a one-time X-Wing key of the app's
  (`keys::seal_once`).

**A device's secure boundary.** Nothing on disk, in a view or in a log holds a secret. Every key wipes itself as it is
dropped. A locked device holds no key and nothing a key opened. Its randomness can't be rewound or foreseen from a copy
of its memory.

## 12. Sync over iroh

### The node

Each device is a node on its own iroh endpoint (`crates/avendb-net/src/lib.rs`). The endpoint's key is the device's
ed25519 key, so iroh's TLS proves the endpoint. It uses no n0 service: addresses come from offers, and connections go
direct where they can and through avenDB's own relay where they must.

One `Router` hands each connection to a protocol by its ALPN, as iroh intends:

- `avendb/sync/1`, avenDB's one protocol of its own (`session.rs`): hellos, requests, replies and holdings. It
  decides what moves.
- `/iroh-bytes/4`, iroh-blobs: McEliece keys and file pieces, verified against their BLAKE3 hash as they arrive. It
  carries the bytes.

A desktop's node binds UDP on every interface and maps a port where the router lets it. A browser has no UDP, so its
node reaches every peer through the relay; its TLS is rustls with ring, and X25519MLKEM768 is pure Rust
(`crates/avendb-net/src/kx.rs`).

### The hello

Each connection opens with a hello each way, on the first stream (`session::dial_hello`, `listen_hello`). Both ends
draw a 32-byte TLS exporter with the label `avendb hello`. Each signs it with SLH-DSA, with a flag for its end, and
sends its keys (`sign::Hello`). The verifier checks that the hello's ed25519 key is the one TLS proved. So the curve
half is proven by TLS, the hash-based half by the hello, and the hello can't be replayed on another connection or
reflected. The listener checks the dialer's hello before it sends its own, and closes a connection without one. The
Verifpal model `hello.vp` shows what this protects once the curves fall.

### Messages

After the hellos, each message is a stream of its own: one byte for its kind, then `avendb::wire` bytes, and the answer
on the same stream. Every value has exactly one encoding, fuzzed and checked against the Lean vectors
(`crates/avendb/src/wire.rs`).

| Kind | Message | Answer |
|---|---|---|
| 0 | Request: haves per log, loose edits, wanted keys, the vaults it follows | A page of edits and the keys they name |
| 1 | Announce: the sender's holdings | Nothing |
| 2 | Card: the server's contact card | avenCEO's vault logs |
| 3 | Link: a passkey's pass for this connection's device | The link card |
| 4 | Join: the edit that adds the new device | Nothing, once taken |
| 5 | Claim key | The unclaimed server's key to seal to |
| 6 | Claim: the edit that adds the server to avenCEO | It, signed by the server too |
| 7 | Ask logs: a request for some logs alone | A page of edits of those logs |

### Frontiers per log

When a device asks, it names of each log its frontier, the edits 1, 2, 4, 8, … steps back from it, and the oldest
(`sync::Ask`). It lists its loose edits. The peer sends what it would send whole, less those loose edits and whatever
lies at or below an edit the device named (`respondSince`). A peer that is behind sends exactly what the device lacks.
Nothing the device lacks is withheld (T19). Replies come a page at a time, about 4 MiB, each edit after its past.

### What a peer sends

A peer sends a device, by its own view (`sync::answer`, `respond` in `spec/AvenDB/Sync.lean`):

- the logs of the entries the device may receive and its keep shares want (T12, T28). It may receive an entry if it
  acts for the entry's vault, or for the grantee of a live share at Backup or more that is wide or in the entry's
  audience, or an Everyone share reaches it and it has an interest;
- the logs of the audiences and shares needed to check those;
- the logs of the vaults all that names, up their chains of owners.

Nothing else. A relay share gives the vault log alone, so the server learns the devices to let through and nothing of
the entries (T26).

**Interest and follow.** What a vault shares with Everyone goes only to a device with an interest in the vault: one
that acts for it, or for a vault holding a live share over it, at any level. A device may also name vaults in its
request's `follow` list. Following brings nothing that isn't public, and a device that acts for no vault and follows
none is sent nothing at all (T12). So nobody who connects learns a vault's governance log unless they know its id.

### Holdings

Each device tells each peer what it holds **for good** (`crates/avendb-net/src/holdings.rs`, `wire::Announce`):

```
Announce { full: bool, logs: [(LogId, Frontier { heads, waiting })], files: [(FileRoot, Option<Whole | Pieces>)] }
```

- **For good** means on its shelf. A log's frontier counts only the edits its shelf holds. A file counts whole or by
  the pieces its shelf holds. On the server, that is what the bucket took: nothing counts until the bucket has it.
- **Only what the peer may know.** The logs the peer may receive by the sender's view, and the files those edits bring
  (T27). A relay share's holder learns no file root.
- **Full, then changes.** The first announcement on a new connection is full. After that only logs whose frontier
  changed, files whose holding changed, and `None` for a file no longer held. If nothing changed, nothing goes.
- **Only from the device itself.** A node records holdings of device D only from a connection whose hello proved D.
  An announcement names no device, so a device speaks only for itself, and nobody passes anyone's holdings on.
- **Asking.** A node that hears of a head it lacks asks for those logs alone (Ask logs). A log nobody changed is never
  named again.
- **Synced to.** Each entry and file shows the devices that hold it: this device by its own shelf, and others only by
  what they said on their own proven connection, and only if they may hold it. "Backed up" is synced to the server.
- **Routing, never permission.** Holdings choose which peers to ask and fetch from. The blob gate still hands out a
  file by T27 alone.

The Lean statements for holdings belong in `Logs.lean` and `SyncLemmas.lean`. The Rust tests that guard them are in
`crates/avendb-net/tests/holdings.rs` and `bucket.rs`.

### Blobs

- **One pool.** A node fetches every blob over one iroh-blobs `ConnectionPool` (`blobs.rs`). The McEliece keys a reply
  names come in one GetMany request. File pieces come from peers whose holdings hold them first, then other connected
  peers, then peers it would have to dial.
- **The gate (T27).** A blob connection is let in only while the same endpoint has a live sync connection whose hello
  proved its device. Each request names one blob, never a HashSeq with its children. The gate hands out a McEliece key
  the device may fetch, or a file's root or piece only if the device may receive a write that brings the file. Push is
  off.

### The relay and linking

The server runs iroh's relay beside its node (`crates/avendb-server`). It lets in only the devices the server knows:
those of the vaults it relays or backs up, of avenCEO's owners, and itself. A device it doesn't know yet comes in by
its passkey's pass for ten minutes. While sign-up is open, or the server is unclaimed, any passkey's pass does. It
forwards only encrypted QUIC.

A new device links by its passkey alone, through another device's QR code (an offer, `AVENDB1…`) or the server's
offer. After the hellos it shows its pass. The peer hands back the link card: the logs of the vaults the passkey owns,
up the chains, and nothing of a share, an audience or an entry (T20). The new device adds itself to the vault whose
root is the passkey (a Device share signed by the passkey and itself), and the peer takes that edit only for the
device on the connection. With every other device lost, the server's offer brings the vault back. The Verifpal model
`link.vp` covers this.

**Not gossip.** Announcements go straight to one proven device. A gossip topic would tell every member of a log, its
members learn each other's addresses, and its 4 KiB messages can't carry one SLH-DSA signature.

## 13. Files

A file enters avenDB with a write of the entry it belongs to. A file in a vault's Library is an entry of type `file`,
a document named after the file, whose first write brings it. Shares, sync and deletion work on it as on a note.

**Sealed blob, version 1** (`crates/avendb/src/sealed.rs`, its bytes pinned by vectors):

- **Key.** Each file has its own random 32-byte key, never derived from its content. Two vaults holding the same film
  hold two unrelated blobs.
- **Segments.** The plaintext is cut into segments of 65,520 bytes, each sealed with ChaCha20-Poly1305 under a nonce of
  its number across the whole file and a flag for the last one. A sealed segment is 65,536 bytes, four iroh-blobs
  chunk groups, so a seek fetches whole segments and nothing more.
- **Pieces.** 16,384 sealed segments make a piece of 1 GiB, each a blob. A file of several pieces is named by an iroh
  HashSeq of its pieces' hashes. A 4 TB film is 3,727 pieces, and its sealed bytes are 0.024 % more than its own.
- **What it guarantees.** A changed byte, a swapped, reordered or dropped segment, or a file cut short at a segment's
  edge: none of them opens.

**The write that brings it** names each file in the clear by its root and sealed size, so a node that keeps it without
its key knows what to fetch. Its encrypted body holds each file's key and length (`sealed::Brought`), so the key
reaches exactly the entry's readers. Whoever may fetch the write may fetch its files, and nobody else (T27): a Viewer
fetches and opens, Backup fetches the ciphertext, Relay fetches nothing.

**Bringing, reading, keeping** (`crates/avendb-net/src/files.rs`):

- `Node::store_file` seals a file as it reads it and streams each piece onto the shelf. A file of any size passes
  through a few segments of memory.
- `Node::read_file` reads any range: the segments that hold it, from its own shelf, or fetched from a peer, 4 MiB at a
  time, verified and opened. Pieces read but not kept stay in memory windows, 64 MiB at most, oldest out first.
- The keeper fetches whole the files a device keeps: where a Whole keep share picks the entry, or by the device's own
  setting where it has no keep share over the vault. It retries with backoff until each piece is finished on the
  shelf, and drops nothing it kept.

**Playing.** In a browser, a film or a song streams through a service worker (`static/app/avendb-files.sw.js`) that
asks the page for byte ranges. Pictures and PDFs open whole. An SVG opens as an image, never as a page of the site.

## 14. Storage: one shelf per place

Each place keeps what lasts on one **shelf** (`crates/avendb-net/src/shelf.rs`), laid out the same everywhere. A
shelf answers a call only once its place's source of truth holds what it was asked to keep:

| Call | What it does |
|---|---|
| List | Every blob the shelf holds whole, with its size |
| Read, Outboard | A range of a blob, or its BLAKE3 outboard |
| Write, Finish | A blob being written, then finished under its hash with its outboard |
| Drop | Lets go of a blob |
| Put, Get, Names | A named object, put once and never replaced; read it; list names by prefix |

Over its shelf a node runs a blob store of its own (`ShelfStore`), which iroh-blobs reads and writes like any other.

### Places

| Place | Shelf | Source of truth | Cache |
|---|---|---|---|
| Browser | OPFS `avendb/<name>/`, run by `crates/avendb-browser/js/store.worker.js` | OPFS | Memory windows |
| Desktop | A folder (`crates/avendb-net/src/disk.rs`), on a Mac in Application Support | The folder | Memory windows |
| Server | An S3 bucket, every object sealed (`crates/avendb-net/src/bucket.rs`) | The bucket | Its folder |

A browser tab's worker holds the store's lock, so one device never runs in two tabs at once.

### Layout of one generation

```
<root>/g<n>/
  journal/<n>      what one save added: new edits of the device's log, and the McEliece keys they brought
  heads/<n>        after every 64 journal entries: the packs that hold the log so far, and every McEliece key
  blobs/<hash>     edit packs, McEliece keys, HashSeqs and file pieces, each named by its BLAKE3 hash
  outboards/<hash> each blob's outboard, written last: a blob counts once its outboard is there
  new/             blobs and objects being written
  meta/...         what opens the device again (browser, desktop); device.key on the server
```

- **Edits** (`crates/avendb-net/src/edits.rs`). A save appends a journal entry. Every 64 entries, a pack blob takes
  them and a new head names the packs. A node starts from its newest head that reads whole, and the journal after it:
  a few dozen objects, however long the log. Once a head would name 64 packs, the next names one pack of the whole log.
  Every head and entry ends with the BLAKE3 hash of all before it, so a torn one reads as none. Every edit is checked
  again as it comes back.
- **Packs, not one object per edit.** An edit is a few kilobytes and object storage bills at least 64 KB per object,
  so packs keep "everything is a blob" true and cheap.
- **Generations.** A place keeps its shelves side by side: `g1`, `g2` and on. The newest is in use. Forgetting an
  account, or starting fresh, makes a new generation beside the old one, which is never read again and never deleted.
  Whatever else the folder or bucket holds, such as an older avenDB's store, stays as it is.

### The server's bucket

- **Sealed.** Every object is sealed with XChaCha20-Poly1305 under a key derived from the server's seal
  (`AVENDB_BUCKET_SEAL`), and bound to its name, so an object read back under another name doesn't open.
- **Blobs in parts.** `g<n>/blobs/<hash>/<part>` holds each blob in sealed parts of 8 MiB, and
  `g<n>/outboards/<hash>-<size>` its outboard, put once every part is in: a blob counts once its outboard is there.
  A part is fetched whole, as a sealed object opens only whole.
- **Its folder is only a cache.** Blobs being written are staged in the folder's `g<n>/new/`. Parts read lately are
  cached in `g<n>/cache/`, 8 GiB by default, least lately read out first. A server whose folder is lost starts again
  from the bucket alone, as the same device: its secret is in the bucket too (`device.key`, sealed).
- **Nothing counts until the bucket has it.** The shelf answers Finish and Put only once the bucket holds the object.
  So the server's holdings name an edit or a file only once it is in the bucket. Until then, the device that wrote it
  sees the server lacks it, keeps it and offers it again.
- **Locked.** The bucket keeps every object version for 7 days in compliance mode (Object Lock), so not even a
  compromised server wipes the backup.

## 15. The Lean model: what guards what

The model is Lean 4 with no Mathlib (`spec/`). `lake build` checks every proof, every scenario (`#guard` in
`Examples.lean`) and every vector file. `lake exe vectors` writes the vectors again after a rule changes. The Rust
tests carry the theorems' names, and `crates/avendb/tests/vectors.rs` replays `spec/vectors/vaults.json` edit by edit.
The full table, with each theorem's Rust guards, is `spec/README.md`.

| Model file | What it holds |
|---|---|
| `Basic.lean` | Ids, levels and keep modes, Who, selectors, headers, audiences, key families and names |
| `State.lean` | What a peer knows: vaults, acting via owners, shares, entries, stays, wants and keeps, the lane |
| `Step.lean` | The eight kinds and the rules that take or refuse each; the replay order; strong removal (`view`) |
| `Sync.lean`, `Logs.lean` | What a peer sends a device, interest and follow, files; logs, frontiers, asks |
| `Rules.lean`, `Ops.lean`, `Schemas.lean` | Op groups and touches; records, diffs and queries; schema fit |
| `Theorems.lean` | Every theorem's statement; the proofs live in the `*Lemmas.lean` files |
| `Vectors.lean` | The cases the Rust core replays |

| # | Guarantee | Proved in |
|---|---|---|
| T1 | Only authorized writes are accepted, and revocation wins over what it hadn't seen | `Lemmas.lean` |
| T2 | Governance needs approval and consent; devices never govern | `Lemmas.lean` |
| T3 | No ownership cycles | `Lemmas.lean` |
| T4 | Shares name a vault or Everyone; a device only in a keep share of its issuer's device | `Lemmas.lean` |
| T5 | A key opens only for whoever could read its family | `KeyLemmas.lean` |
| T6 | Forward secrecy: current keys open only for those entitled now | `KeyLemmas.lean` |
| T7 | Blind server: no key of a vault whose seed it never held, unless public | `KeyLemmas.lean` |
| T8 | Everyone only reads | `Lemmas.lean` |
| T9 | Lens laws: round trips, edits through a view keep what it can't see | `Lens.lean` |
| T10 | Merge is the union of histories; promote gives the proposal; lines don't touch | `Doc.lean`, `Proposals.lean` |
| T11 | Same edits in any order, same state | `SyncLemmas.lean` |
| T12 | Sync sends what shares reach; Everyone only to interest or follow; strangers get nothing | `SyncLemmas.lean` |
| T13 | Two devices that asked each other once converge | `SyncLemmas.lean` |
| T14 | Accepted writes are causally closed | `Lemmas.lean` |
| T15 | Rotation follows revocation | `KeyLemmas.lean` |
| T16 | Strong removal: what a removal hadn't seen and relied on is cut | `CapLemmas.lean` |
| T17 | The lane holds only the vault's own schema and lens creations | `Lemmas.lean` |
| T18 | Once the curves fall, only checkpointed writes count | `CapLemmas.lean` |
| T19 | Frontier sync loses nothing; one frontier per log tells whether to ask | `SyncLemmas.lean` |
| T20 | Linking hands out vault logs alone | `SyncLemmas.lean` |
| T21 | Vaults keep to their kind | `Lemmas.lean` |
| T22 | A share grants no more than what it rests on; no wide owner share | `CapLemmas.lean` |
| T23 | Marks mean what the shares say: audiences and wants, from `mark_means` | `CapLemmas.lean` |
| T24 | An entry's key reaches only its audience's readers | `KeyLemmas.lean` |
| T25 | Blind relays decide every edit as an owner does | `RelayLemmas.lean` |
| T26 | A relay share receives none of the entries | `SyncLemmas.lean` |
| T27 | Files follow their edits | `SyncLemmas.lean` |
| T28 | Sync follows the keep shares, and their modes | `SyncLemmas.lean` |
| K1 | A keep share's revocation cuts nothing | `CapLemmas.lean` |
| O1 to O3 | Diffs explain records; ops change what they name; queries pick by labels | `Ops.lean` |
| C1 to C4 | Chains narrow; readers agree; counted writes do what they may; allowed writes count | `RuleLemmas.lean` |
| S1 to S4 | Writes judged by what they changed; fit stays; unfit counts for none; relays don't judge | `Schemas.lean` |

T29 (marks mean what the sync rules say) is merged into T23. Holdings add two statements: a node records a device's
holdings only from the connection that proved it, and holdings never let a file past T27.

**Protocol models.** The theorems take signatures and encryption as given. What devices say on the network is modelled
in Verifpal against an attacker who breaks the curves (`spec/protocol/*.vp`, run by `check.sh`): `seal.vp` (the sealed
box), `hello.vp` (the hello) and `link.vp` (linking by passkey).

**Assumptions**, each part of the model and none an axiom: signatures can't be forged; sealed data reveals nothing
without its key; ids don't collide; Loro converges and can revert to any version it holds.

## 16. Where to look

| Path | What it holds |
|---|---|
| `crates/avendb/src/policy.rs` | Edits, the eight kinds, shares, refusals, the replay, strong removal, meaning |
| `crates/avendb/src/sync.rs` | Logs, frontiers, asks, what a peer sends (`answer`, `Reach`) |
| `crates/avendb/src/keys.rs` | Key families, epochs, sealed boxes (X-Wing and McEliece) |
| `crates/avendb/src/sign.rs` | Hybrid signatures, hellos, passkey ceremonies, standing consent, the pass |
| `crates/avendb/src/wire.rs`, `encode.rs` | Every message and edit as bytes, one encoding each |
| `crates/avendb/src/lab.rs` | A device's state and its upkeep: stewards, keys, checkpoints |
| `crates/avendb/src/engine.rs`, `ops.rs`, `rules.rs` | JSON ops, record ops, op groups and proofs |
| `crates/avendb/src/lens.rs`, `doc.rs`, `history.rs` | Schemas and lenses, Loro items, lines of history |
| `crates/avendb/src/sealed.rs`, `slice.rs` | Sealed blob v1; selectors, headers and write bodies |
| `crates/avendb/src/recovery.rs` | The master recovery key |
| `crates/avendb-net/src/lib.rs`, `session.rs` | The node, its router and messages |
| `crates/avendb-net/src/holdings.rs`, `blobs.rs` | Holdings, Synced to, the blob pool and gate |
| `crates/avendb-net/src/shelf.rs`, `edits.rs` | The shelf, and edits on it |
| `crates/avendb-net/src/disk.rs`, `bucket.rs` | The folder shelf and the bucket shelf |
| `crates/avendb-net/src/files.rs` | Bringing, reading and keeping files |
| `crates/avendb-server` | The server's binary and its relay |
| `crates/avendb-browser` | A device in a web page, as WebAssembly, and its OPFS worker |
| `crates/avendb-device` | The same device, native beside the desktop app |
| `spec/` | The Lean model, vectors and protocol models |
| `src/lib/avendb/` | The app's avenDB pages |
| `src/routes/docs/avendb/` | The public architecture page |
