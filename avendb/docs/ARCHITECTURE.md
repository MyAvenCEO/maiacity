# avenDB architecture

avenDB is the user-owned, end-to-end encrypted, local-first database under maiaCITY. This file describes it as it
ships with edit format version 10, from first principles. It is the one reference for the design.

Three things keep it honest. The Lean model in `avendb/spec` states what must always hold and proves it. The Rust
crates in `avendb/crates` build it. Shared test vectors (`avendb/spec/vectors`) hold the two to the same answers, edit
by edit. Where this file and the model disagree, the model is right and this file is wrong.

The other documents each hold one thing. `spec/README.md` lists every theorem with the Rust tests that guard it.
`README.md` says how to build, test, run and deploy avenDB. The page `/docs/avendb/` in the app tells this file's story
for people. Many module doc comments name the section of this file they build.

Paths below are relative to `avendb/` unless they start with `src/` or `static/`, which are the app's.

## Contents

1. [The shape: Entry, Share, Blob](#1-the-shape-entry-share-blob)
2. [What it guarantees](#2-what-it-guarantees)
3. [Vaults, owners and devices](#3-vaults-owners-and-devices)
4. [Edits, logs and the replay](#4-edits-logs-and-the-replay)
5. [Shares](#5-shares)
6. [Audiences, marks and keys](#6-audiences-marks-and-keys)
7. [Entries, writes and history](#7-entries-writes-and-history)
8. [One API: run(op), op groups and fit](#8-one-api-runop-op-groups-and-fit)
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
| Vault | An identity, like a smart account: a person's (human), a group's (coop), a person's agent identity (aven), or one machine's or agent's (device vault). It owns entries. |
| Entry | One item of data in one vault: a Loro document with a type and tags. |
| Edit | One signed change. Its id is the BLAKE3 hash of its bytes. Seven kinds. |
| Log | The edits of one vault, one share, one audience or one entry. Each edit builds on its log's frontier. |
| Share | Who may do what on which entries of a vault: who, level, what. |
| Level | Keep, Relay, Backup, Read, Write or Owner, in that rank order. |
| Keep share | A share to one device of the issuer: which entries it syncs, and whether it keeps files whole. |
| Audience | The shares that pick an entry, in the clear. It carries the entry's key. |
| Mark | The edit in which a steward writes an entry's audience, its wants, or both. |
| Steward | A device acting for the vault itself. It reads every selector and keeps the marks true. |
| Stay | One period of an entry in one audience, named by the mark that began it. |
| Epoch | The generation of a key family. It moves on when someone loses access. |
| Lane | The schemas and lenses a vault's readers read off its own schema and lens entries. |
| Interest | A device's reason to be sent what a vault shares with Everyone: it acts for the vault or a holder of a share over it. |
| Follow | A vault a device names in its requests, to be sent what that vault shares with Everyone. |
| Op | One read or change, as JSON, through `run(op)`. |
| Row | One record of a list of records, named by its integer id. A row may hold lists of rows in turn, at any depth. |
| Path | A place in a record from the top: a field, then a row by its id, then a field of that row, and so on. |
| Link | A field that points at another entry, or at a row of one, at its newest or at a version. Queries follow it. |
| Shelf | The one place a device keeps what lasts: OPFS in a browser, a folder on a desktop, a bucket on the server. |
| Holdings | What one device says it holds for good: each log's frontier, and each file whole or in pieces. |
| Statement | A device's holdings, signed by it with when it checked: its word, which outlives its connection. |

## 1. The shape: Entry, Share, Blob

Everything in avenDB is one of three things, one per layer.

1. **Entry: what.** All data is an entry in a vault. Notes, todos, articles, files, a device's card, a vault's
   profile, and also schemas and lenses. An entry changes only by writes.
2. **Share: who may.** A share says who, at which level, on what. People, Everyone, servers and a device's keep shares
   are shares. A vault's owners and its devices are shares too. A revocation ends any of them. A vault has two
   settings beside them: how many owners must approve (its threshold), and its root passkey.
3. **Blob + holdings: where.** All bytes are blobs named by their BLAKE3 hash, on one shelf per place. Each device
   tells its peers, for itself alone, what it holds for good.

Everything else is derived and never typed in: whom an entry is shared with, its audience's key, the marks, which
devices an entry is synced to, and what a device still has to fetch.

Eight principles follow from the shape:

1. **One log of signed edits is the only truth.** Shares, marks, keys and writes are signed edits. Every view is
   computed from them.
2. **One kind of permission.** A share is a named group of ops on a selector. Revoke ends any share.
3. **One label per entry.** The mark says, in the clear, which shares pick an entry. Relays route and check writes by
   it, and readers check it against the selectors.
4. **One kind of bytes.** Content-addressed blobs on one shelf per place. Durable means finished on the shelf.
5. **One frontier.** Holdings. Every "where is it" answer comes from them.
6. **One API.** Every read and change is one JSON op through `run(op)`, the same on every device. The page keeps no
   rule; it asks the device.
7. **One transport per job, the iroh way.** Our protocol decides what a peer may get. iroh-blobs moves the bytes.
8. **Put aside, clear at a reset.** An old store becomes an older generation beside the new one. A reset clears what
   came before it, on every place.

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
- **Sync sends only what shares reach.** A peer sends a device only what its vaults may receive, and what a vault
  shares with Everyone only to a device with an interest or that follows it (T12). A relay share receives nothing of
  the entries (T26). A keep share narrows what comes, never widens it (T28). A file goes only with a write that brings
  it (T27).
- **Holdings speak for their device alone and authorize nothing.** A node keeps a device's holdings only as that
  device said them on its own proven connection, and announces nobody's (H1). What it passes on is only what a device
  signed itself, with when it checked, and only to a peer that may know all of it (H2). No holding gets anyone a file
  the rules refuse (T27).
- **Relays are blind and still exact.** The server reads no selector, type or tag, yet every edit stands or falls for
  it exactly as for an owner (T25).
- **Post-quantum.** Every edit, a write too, counts by its hash-based SLH-DSA signature alone, so nothing counts on
  the curves.
- **Readers agree.** Whether a write counts reads nothing a reader may lack (C2), a counted write did only what its
  chain allows (C3), and it fits its entry's schemas (S3).

What the proofs don't cover: the Rust and Loro code itself (the vectors and tests do), timing and traffic analysis, a
file's exact length (its sealed size shows it), and a device compromised while it is unlocked.

## 3. Vaults, owners and devices

A vault is an identity. Its id is the id of its genesis edit. It comes in four kinds (T21, `policy::Kind`), and one
table, defined once, says what each kind may be (`Kind::rules`, `Kind.rules` in `spec/AvenDB/Basic.lean`): who may own
it, how many owners it takes, whether it holds devices, and how many of the kind one owner may own. The owner and
device rules and the one-aven limit read that table and nothing else, and the engine answers it to the page as it does
the cap groups (the `kinds` op, and `kinds` in the world), so the page never decides a kind's rules itself:

| Kind | Owned by | Owners | Devices | One owner may own |
|---|---|---|---|---|
| Human | Signers: the person's passkeys and the master recovery key | Any, by threshold | Their desktops, phones, browsers and drives | Any number |
| Coop | Human and coop vaults | Any, by threshold | None: it acts through its owners | Any number |
| Aven | One human vault | Exactly one (`OneOwner`) | None: it acts through its agents' device vaults | One: one aven per human (`SecondAven`) |
| Device vault | One human, coop or aven vault | Exactly one (`OneOwner`) | Its devices, which act for it and never govern | Any number |

Only a human vault has a root, a passkey. A device vault owns nothing and governs nothing: it holds only the shares
its owner gives it. An owner that isn't of a kind the table names is refused (`WrongOwnerKind`), as is a device of a
coop or an aven (`NoDevices`).

**Approval.** A vault approves a change through its root alone, or through its threshold of owners. The root passkey
of a human vault approves anything on its own, wins every clash, and is the only one that hands the root on.

**Governance** is the vault's settings (threshold, root) and the sharing or revoking of an owner or a device. It needs
the vault's approval plus the newcomer's consent, except that an owner or a device may leave on its own (T2). Devices
never govern: a device of a human vault or of a device vault acts for it and approves nothing. So a change
that needs approval is drafted on a device and signed by the person's passkey in one ceremony (sections 8 and 11).

**Acting through owners.** A coop has no devices, so a person acts for it from a device of their own vault. Every edit
that acts for a vault names the chain of owners it goes through (`via`): from an owner of the vault down to the vault
the author's device belongs to, each an owner of the one before. The rules check that chain alone
(`State::acts_via`, `actsVia` in `spec/AvenDB/State.lean`). A removal anywhere along it cuts the edit the same way on
every device (T1, T16).

**Who stands behind an edit.** Every edit that acts for a vault traces back to the passkeys that let it be made
(`data::Audit::chain`). Its chain has one link per step: the author's device in the vault it belongs to, then each
vault of `via` as an owner of the next, up to the vault it acted for. Each link names the latest edit that stands and
made it so, the `addDevice` or `addOwner` that added it or the genesis that named it, and that edit's signers, each by
the vault it is in and how: its root passkey, an owner or a device. The chain ends with who owns the acting vault now.
So a write from a person's Mac for a coop shows the passkey that added the Mac to the person's vault and the passkeys
that made the person an owner of the coop. The server signs on its own, yet its chain leads to the coop that owns its
device vault: the edit that added the server as that vault's device is signed by an owner's passkey and by the server
itself. The `history`, `note` and `log` ops carry it as `chain`, and the page shows it under each edit.

**The master recovery key.** One master recovery key is a way back in beside the passkeys. It is a signer like any
other, a passkey kept in software (`crates/avendb/src/recovery.rs`), whose keys all derive from 32 secret bytes kept
offline. Its public file is built in (`crates/avendb/master-recovery.pub`; an empty file builds avenDB without one),
and every device's Lab knows it (`Lab::set_recovery`). Every human vault is founded with it among its owners: it is an
Owner share on Everything, added at genesis (`Lab::human_owners`). The key signed one standing consent as it was made
(`sign::consent_challenge`), which an edit that adds it takes in place of its signature (`sign::standing`). It shows
among the owners as "Master recovery key" and is removed like any owner, and added again the same way (section 8,
`share` and `revoke`). Whoever holds the secret signs as an owner in full: alone, it adds a device to a vault whose
person lost every passkey and device, and that device opens the vault, as its keys were sealed to the master key as to
every owner. So only the `.pub` file is handed on. The tool is `cargo run -p avendb --bin master-key`
(`crates/avendb/src/bin/master-key.rs`).

**avenCEO server.** The server is the device of avenCEO server, a device vault that avenCEO GmbH owns. A new server
belongs to no vault. The first person to found a human vault through it claims it in the same ceremony, and founds the
seed (`world::SEED`), each vault owned by the one before alone:

| Vault | Kind | Owned by |
|---|---|---|
| Maia Holding GmbH | Coop | The person's human vault |
| avenCEO GmbH | Coop | Maia Holding GmbH |
| avenCEO server | Device vault | avenCEO GmbH; the server is its device |
| Maia City | Coop | avenCEO GmbH; the city's content lives here |

So the server acts for avenCEO server on its own, and every edit it makes traces back through avenCEO GmbH and Maia
Holding GmbH to the person's passkey. The claim:

1. The device takes the server's card (`Lab::card`). If it names no device vault the server belongs to, nobody has
   claimed the server, and the device asks it for its key to seal to (`Lab::claim_key`).
2. The person's passkey signs, in one ceremony, their human vault's genesis, the edit that adds the device, the
   seed's four geneses, and the edit that adds the server as avenCEO server's device, sealed to that key
   (`Lab::drafting`, `Lab::claim`). The passkey approves for each coop, as the root of the vault that owns it.
3. The server checks that the edit adds itself and seals to its own key, every signature, and the rules, then signs
   it too and keeps it (`Lab::accept_claim`). Its answer lets the device box the device vault's key for it.

After that, nobody can claim it again: whoever founds a vault later finds avenCEO server on the server's card
(`Lab::server_vault_of`). A device
of a vault founded before claims a new server the same way (`Node::claim`). The founding device writes each seed
vault's profile with its name (`world::SEED_NAMES`) as it settles, before the page opens; the page names a seed that
has none the same way.

**Avens and agent devices.** An aven is a person's one agent identity: an aven vault their human vault alone owns,
one per human, which holds the shares the person and the coops that hire it give it. It holds no devices and acts
through its agents, each a device vault it owns with one agent device in it, a key of its own, never a token: Claude
Code as agentClaude, Codex as agentCodex, and likewise Cursor, Grok and our own native aven. An agent holds what its
aven passes on to it, sub caps of the aven's own shares by the one rule a share rests on another by (section 5): no
stronger and no wider than the aven's, and a coop that revokes its share to the aven ends every agent's share resting
on it (Lab scenario 27). So each harness signs by its own key with no more than its aven gives it, and one is taken
out by removing its device or revoking its shares, leaving the others. (The device and net crates still adopt an
agent into a device vault the person's own vault owns, `Node::adopt_with`; founding it under their aven, with its
sub caps, is their next step.) `avendb-device agent <harness> [--aven <name>]`
(`crates/avendb-device/src/agent.rs`) runs an agent device as the harness's MCP server on its stdin and stdout, in a
folder beside the desktop app's that the app never clears (`<app folder>-agents/<device>`). It keeps its secret on its
shelf, as the server does (`server::open_agent`), and its iroh key derives from it. It keeps no file whole of its own
accord and reads its person's files from their desktop's one store, so nothing is kept twice. It saves a file of the
desktop as every device does, its vault's shares deciding (`put_file`, the file named by its path beside the op): an
Editor share creates its entry, a Suggester's or a Viewer's doesn't. It seals the file onto its own shelf, and lets go
of it once the desktop app's device, the one whose key is the endpoint of the offer the app leaves it, holds it whole
by that device's holdings (`Node::holds_whole`, `Node::let_go`): a read of it then fetches it from there. Where the
desktop keeps a light copy, the agent's copy is the one. A reset clears its folder as the app's, and it asks to join
again.

**Asking for access.** Access is asked for and given as any share is, on one consent screen. An agent device leaves an
access request for the desktop app (`<device>.request`): who asks, by its device's name and key, the aven it would join,
if it names one, a level (Viewer, Suggester or Editor), why, and the vaults it names, if any; while it is no vault's
device, its offer too. It asks again for more with its MCP tool `avendb_request_access`. The page shows the request and
the person picks the aven it joins, one their vault owns or a new one they name, then all their vaults or only some, a
level each, and approves or denies. Approving a device that is none of the aven's yet adds it in one ceremony, the way a
server is claimed (`Node::adopt_with`): the passkey signs the genesis of a new device vault their vault owns alone, if
it is new, and the edit that adds the device, sealed to the device's key, which the device signs too. Each vault picked
then gives that device vault a share at its level, which the device issues alone. A no is left for the agent
(`<device>.denied`), which asks no more until it asks again. A share covers one vault: a share of the person's own vault
reaches none of the vaults it owns, so "all my vaults" is a share of each.

**A drive's own device.** Each external drive the person uses for avenDB is a device of their own vault, as a phone
is, on the same sync, shares, copy setting and holdings as every other: nothing in sync knows it is a drive
(`crates/avendb-device/src/drive.rs`). Its store is a folder on the drive, `<volume>/.avendb/`, laid out as the
desktop's (section 14), so the drive holds ciphertext, signed edits and public keys only. Its key is 32 random bytes of
its own, never on the drive in plain: its meta keeps them masked by the PRF output of the person's passkey on the
drive's own salt, as every device keeps its secret, so one ceremony opens it on any Mac of the person's; and the shelf
of each Mac that hosts it keeps them wrapped (`keys::wrap`) under a key that Mac's device alone derives from its own
(`Lab::own_key`), `drives/<device>`, so that Mac opens it silently while its own device is open. Joining takes one
ceremony, which unlocks the new device and is its pass: the Mac's device links it to the vault as a new phone links
(`Node::link_by_pass`), sets it to a full copy and writes its card with its name. While the drive is plugged into a
Mac that holds its key, the Mac's device runs it as a second node beside its own, on the drive's shelf. The Mac looks
at its volumes every few seconds (in `/Volumes` on macOS, a folder of its own in a test): an unplugged drive's node
stops, and its last signed statement of what it holds stays with the person's other devices, which show when it
checked; plugged in again, it is hosted again without a ceremony. The page's Eject stops the drive's node first, so
nothing on the drive stays open, then has macOS eject the volume (`diskutil eject`), so Finder never finds it in use;
an Eject in Finder itself isn't heard, and the drive's node stops as the volume goes. A lost drive is revoked like a
lost phone, and its peers refuse it from then on.

**One passkey, one human vault.** A device that founds asks the server first, with the passkey's pass, for the vault
that passkey roots (`Node::rejoin_by_pass`, the same card as linking). If the server knows one, the device joins it
in the same ceremony and founds nothing: a person who sets up avenDB on a second device with the same passkey, as a
Mac and a phone that share it, gets one vault, the one that owns their seed.

## 4. Edits, logs and the replay

**An edit** is `{parents, depth, author, cosigners, action}` (`policy::Edit`). Its bytes have one canonical encoding,
which starts with the version byte 10 (`encode::VERSION`, `crates/avendb/src/encode.rs`). Its id is the BLAKE3 hash
of those bytes, the name iroh-blobs gives the same bytes, and its signatures sign the id (`crates/avendb/src/sign.rs`).

**Seven kinds.** The action's first byte is its kind (`policy::Action`, `Action` in `spec/AvenDB/Step.lean`):

| Tag | Kind | What it does | Log | Removal |
|---|---|---|---|---|
| 0 | Genesis | A new vault: kind, owners, threshold, root | Its vault | No |
| 1 | Settings | 0 Threshold, or 1 Root (hand the root on) | The vault | Root only |
| 2 | Share | 0 Grant (a share), 1 Owner, 2 Device | Grant: its share. Owner, Device: the vault | No |
| 3 | Revoke | 0 Grant, 1 Owner, 2 Device | Grant: the share's. Owner, Device: the vault | Yes |
| 4 | Write | An encrypted change of one entry, and the files it brings | The entry | No |
| 5 | Mark | An entry's audience, its wants, or both | The entry | With an audience |
| 6 | Keys | The real boxes of one key | The key's family | No |

Every other tag decodes as unknown. The tags of earlier kinds (7 a checkpoint, 8 a lane publish, 9 and 10 a sync rule
and its end, 11 a pick) went into the signature, the write, the share, the revocation and the mark, and are never used
again. The kind alone says which
log an edit belongs to (`sync::log_of`), so a peer that knows nothing else routes it. Owners and devices keep sub-kinds
of their own under Share and Revoke for the same reason: the functions that read an edit alone (its log, its rank, its
standing consent, the pass key) find the class in the tag.

**Logs.** Every edit belongs to one log (`sync::LogId`): a vault's (its genesis, settings, owners, devices and seed
keys), a share's (the share, its revocation, its keys), an audience's (its keys) or an entry's (its writes, marks and
keys). An edit names as its parents the frontier of its own log as its device held it. Its depth is one
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
is no longer an owner at its place. A mark of the wants alone takes nothing away and is no removal, and neither is the
revocation of a keep share (K1).

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
| 0 | Keep | Keep whole, Keep when opened, Never keep | Nothing. It says what one device syncs. A mode byte follows. |
| 1 | Relay | Relay | Learn the vault's devices from its log, so a server lets them through. Receive no entry. |
| 2 | Backup | Backup | Keep and pass on the ciphertext of the entries it reaches. No key. |
| 3 | Read | Viewer, Public | Open the entries it reaches. |
| 4 | Write | Editor, Suggester | Also write them, as its ops allow, and create entries through it. |
| 5 | Owner | Owner | Also issue shares resting on it. Governance. |

A share's level is never chosen apart from its ops: it is the class of its strongest op (section 8). A rank of 6 or
more, or a keep mode of 3 or more, decodes as unknown.

### What

A share is **wide** (the whole vault, said in the clear) or picks entries by a **selector** over their labels: type,
author (the vault that created it), entry id, creation time, and tags (has, has none of, only these). A selector is
`all`, or up to 8 conjunctions OR-ed, each of up to 16 tests, with lists of up to 1,000 ids (`crates/avendb/src/
slice.rs`). A share whose selector is `all` is wide. Type, author, entry and creation time never change; tags do, so a
share reaches each entry tagged so now and later, and lets go of one untagged.

The selector, the share's name and its ops travel **sealed** in `select`: to the seed of the vault it is over, of its
grantee and of its issuer. In the clear, `select` carries only a salted hash of the ops (`rules::Grant::commitment`).
So a relay sees who holds which level, and nothing of what it picks or allows.

### Chains (T22)

A share may rest on another (`parent`), a sub cap, by one rule (`State::share_parent_ok`, `shareParentOk` in
`spec/AvenDB/Step.lean`): the parent is a live share over the same vault that its issuer holds, other than a keep share;
the new share is at a level no higher than the parent's, and wide only if the parent is; and either the parent is an
owner share, whose `share` op lets its holder share on with anyone, or the new share goes to a vault its issuer owns
directly. So the holder of an owner share of a slice shares it on with anyone, a person passes a share a coop gave them
on to their aven, and an aven passes its shares on to its agents' device vaults (Lab scenario 27). A chain selects the
AND of its selectors, and allows only what every share of it allows (C1), and revoking a share ends every share resting
on it. A share with no parent is issued by the vault it is over, or is a keep share. No owner share is wide (below), so
a wide share rests on none, or on a wide share passed on to a vault its issuer owns.

### Owners and devices are shares

A vault's owners and devices are rows in one list of shares, beside its grants and keep shares (the `shares` op,
section 8). The page shows them under Owners and devices, and on its one Sharing page who has the vault: each vault it
is shared with, and Everyone where it is public.

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
follow it by name (section 12, interest and follow).

### Servers: Relay or Backup

A vault gives avenCEO server, the server's device vault, a wide Backup share at founding, so the server keeps the
ciphertext of all its entries and opens none. With backups off it gives Relay instead: the server learns the vault's
devices from its log, to let them through its relay, and keeps nothing of its entries (T26). The person switches between
the two with the `back_up` op, for their vault and the vaults it acts for at once (`world::server_level`). A vault that
a person's vault founds gives avenCEO server the same level as the person's vault has.

### Keep shares

A keep share is `{over: V, who: Device(d), level: Keep(mode), wide, select, parent: None, issuer}`. It says which
entries of V device `d` syncs, and how. It grants nothing, has no ops and is in no audience.

- **Who may issue one.** The issuer acts through its owners as for any edit. `d` must be a device of the issuer vault
  itself (NotDevice). The issuer must be V, or hold a share over V at Backup or more (NoCap, `State::may_hold`). It
  rests on nothing (BadParent). The device signs it alone: a keep share is no governance (the `keep` op).
- **Modes.** `Whole` syncs the entries it picks and keeps their files whole. `Opened` syncs them and fetches file
  pieces as they are read. `Never` subtracts: the device doesn't sync what it picks.
- **What a device wants.** With no keep share over V, or only Never ones, it wants all of V but what a Never share
  picks. With a Whole or Opened one, it wants what one of those picks and no Never one does. It keeps an entry's files
  whole exactly where a Whole share picks it (`wantsWith`, `keepsWith` in `State.lean`; `State::wants`, `keeps`; T28).
- **Copy setting.** A device's copy setting is one wide keep share its own vault issues over itself, Whole for a
  full copy or Opened for a light one (`copyOf` in `State.lean`, `State::copy_of`; the `copy` op). Over any vault
  where the device has no keep share of its own, it counts as one (`keepsFor`, `State::keeps_for`). So a full copy
  keeps whole every entry and file the device may read, and a light copy syncs every entry and fetches a file's
  pieces as they are read. The person picks it when the device joins: the desktop app is a full copy by default,
  and any browser a light one, as a browser may clear a site's storage (Safari after a week unused). They change it
  in Owners and devices.
- **No keep share.** Where the keep shares a device syncs a vault by, its own or else its copy setting, are none or
  only Never ones, it falls back on its own setting (`Options::keep`): the server keeps every file whole, any other
  device fetches pieces as it reads them.
- **Schemas ride along.** A Whole or Opened share also picks every schema and lens entry of V; a Never share that
  isn't wide picks none (`keepPicks`, `policy::keep_picks`). So every reader of V syncs its schemas (section 9). A wide
  Never share stops the device syncing V at all.
- **Changing one.** A keep share is never edited: it is revoked and issued again, which cuts nothing.
- **Revoking one.** Only its issuer revokes it: not the vault it is over, which could otherwise force a device to
  sync all of it. A keep share's revocation cuts nothing: nothing rests on it, no audience holds one and no write
  relies on one (K1). A device that leaves its vault drops that vault's keep shares without any revocation
  (`State::keeps_of`).
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
WrongVault, BadMark, BadAudience, SameAudience, BadWants and SameWants. Writes have NotActing, NotAllowed, NotAView,
UnknownEntry, UnknownDep and NotOnProposal. The names stay those of the code (`UnknownCap`, `NoCap`, `BadCap`), which
say share.

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
  steward changed meanwhile. Only a change of `caps` cuts writes or starts a stay.
- **Checks** (WrongVault, NotActing, BadMark, BadAudience, SameAudience, BadWants, SameWants): the entry is in the
  vault; the author acts for it; at least one part is there, and `keep` only with `caps`; `caps` is canonical, of shares
  over the vault that aren't wide or keep shares, and not the audience it is in; wants is canonical, of keep shares
  over the vault that aren't wide. Neither list is checked for liveness: readers leave out what isn't live. A
  liveness check would let a revocation that sorts earlier refuse a mark, and then every write in its stay would fall.
- **Upkeep.** After each batch of edits, a steward compares each entry's live marks with what the selectors say, and
  emits one mark where they differ (`Lab` upkeep in `crates/avendb/src/lab.rs`). It answers tag asks first. The `mark`
  op runs that same mark of one entry at once (`Lab::mark_now`); nobody hand-sets `caps` or `wants`.

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
| Device key | Per device, from 32 random bytes it keeps masked by its passkey's PRF output, unmasked at each unlock | The device itself |
| Seed of vault V | Random per epoch, with a sealing key pair | V's devices and signer owners, its owner vaults' seeds |
| Share key | Random per epoch, for shares at Read or more | Wrapped under V's seed, sealed to the grantee's seed |
| Audience key | Random per epoch | Wrapped under V's seed and under each live Read-or-more share key that reaches it |
| Entry key | Derived from the audience key, per entry, stay and epoch | Whoever opens the audience key |

Relay, Backup and keep shares get no key at all (T7). An Everyone share's key, and the keys under it, are published in
the clear: that is what Public means.

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
| A keep share is issued or revoked | Nothing: it holds no key |

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
order they came in. Text merges character by character. A list of records merges row by row, matched by id, and a
list of values item by item. Any other field takes one value, the same on every device: an object, a tuple or a list
with bounds too, kept whole (`crates/avendb/src/doc.rs`, `ops.rs`).

**Records inside records.** A row of a list of records may hold lists of records in turn, at any depth: an outline's
nodes, a thread's replies, a part's parts. Each such list is stored as the record's own lists are, a Loro movable list
of maps inside its row's map, so it is a container of its own and merges row by row by id, whatever holds it. A list
that two devices make at once in one row is made mergeable, so they share it and neither hides the other. A row's id
is an integer, one per row in its list; a place is named from the top by its chain of rows, each list's field and the
row's id in turn (`["nodes", {"id": 1}, "kids", {"id": 11}, "text"]`). The page keeps row ids below 2^53, so a
JavaScript number holds each exactly. Every walk over a record, in Rust and on the page, is a loop over a stack of its
own, never a recursion, so a record nested deep can't overflow a stack. Two behaviours follow from Loro, and stay:

- **A move to another list is a delete and an insert.** Moving a row within its list (`move`) keeps the row, so an
  edit made to it at the same time on another device lands. A row moved to another list is deleted from its list and
  inserted anew in the other, so an edit made to it at the same time on another device is lost.
- **Two copies of a row.** Two devices that add a row with the same id to one list at once both keep theirs: two
  copies, the second named `{"id": n, "copy": 1}`. Each keeps the rows under it, and apps see the first copy and what
  it holds; the others go wherever it goes, and are deleted with it.

**The ceiling.** No write reaches deeper than 256 rows (`lens::CEILING`): a write that adds a row deeper, or sets a
value in one, fits no schema, so it counts for no reader (section 8, S2). The ceiling is fixed, not set per device, so
every reader reaches the same verdict.

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
| Merge | A write on the target that builds on both lines' heads: the union of both histories (T10g), reading as the three-way merge of both lines from their base (T10h) |
| Restore | A new write that puts back an older version |
| Undo | A new write that takes out one older write, by a three-way merge of records |
| Variant | A new entry with what a line reads now and its tags, linked to that version of the original |

A write on one line changes no other line (T10f). Nothing is ever overwritten: restore and undo are writes too.

**Variants keep their link.** A write carries only its own signer's changes to an entry's Loro document, so a variant
can't copy the original's history into itself: those edits stay signed by whoever made them, in the original. It
links to it instead. Its first write puts a mark in its own tags, `avendb:variant:<entry>@<edit>,<edit>`: the
original entry and the heads of the version it copied, by hash (`world::variant_mark`). A variant of a variant names
its own original and drops the older mark. The world gives each note's `variantOf` and `variantAt`, and the page walks
the original's edits back from those heads, so the variant's history goes on into the original's, up to that version.
The original lists its variants, each with the version it was made from. Anyone who reads the variant but not the
original sees that it came from a note they can't read, and nothing of it.

**Merge, as git merges.** A merge works as a pull request merges a branch, and loses nothing
(`crates/avendb/src/merge.rs`, `Doc.lean`'s `mergeInto`). Its base is what both lines' histories hold in common. A
record is seen place by place: each field, each row of a list of records with all its fields, and each list's order. A
place only one line changed since the base takes that change. A place both changed is joined where the changes don't
clash: a text edited at places apart, a list of values both added to, a row whose fields they changed apart, rows added
or moved on one side. Where they clash, a conflict, the target keeps its own value, unless the person merging takes the
proposal's there (`take`). So nothing the target changed since the base is lost (T10d), all the proposal changed alone
lands (T10e), and the person's choice touches the conflicts alone. The merge's write carries the change that brings
Loro's merged item to that record, none where Loro's already reads so. Every write of both lines stays in the history
(T10g).

A row of the record's own lists stays one place, however deep it goes (`merge::join_row`), so T10 holds as proved.
Inside it, fields join as an object's do, and each list of records joins row by row by id, at any depth; a list that
one side lacks counts as an empty list. A clash anywhere inside makes the whole top row the conflict, and the page
shows where under it both lines changed it ("the text of row 11 of the kids").

**Restore and undo at any depth.** Restore puts back the record a version shows, rows of rows too. Undo takes out one
write by a three-way merge of records (`history::undo`), at any depth. Undoing a merge takes out only the change it
carried on Loro's merged item: what comes back is the CRDT union of the merge's two parents. To take back the merge
itself, restore the version before it.

**Whether a write counts** is decided by every reader the same way. It counts when it fits its schemas (section 8),
builds only on writes that count, and its actor is the entry's vault or its proof names a live share whose chain
allows what it touched. A write that doesn't count stays in the log, sealed, and shows on no line, nor does anything
built on it. So an app patched to skip the checks writes nothing anyone reads.

## 8. One API: run(op), op groups and fit

### One entry point

Every read and every change of avenDB is one JSON op, whatever the schema, through one entry point, `run(op)`, the
same on every device. The page keeps no rule: it reads levels, ops and who may do what from the device's answers,
asks `may` before it shows a button, and words what comes back.

- **On a Lab.** `engine::run(lab, me, op)` (`crates/avendb/src/engine.rs`, `engine/vaults.rs`) runs an op on a
  device's state: a read on what the device holds, an ask as a dry run that checks, proves and refuses as a change
  would and makes nothing (`Lab::dry`), and a change as signed edits.
- **On a node.** `Node::run(op, bytes, authenticator)` (`crates/avendb-net/src/run.rs`) runs it on a node, and does
  what a Lab alone can't: `world` adds where each entry and file is synced to, `read_file` and `put_file` carry the
  file's bytes beside the op, `jobs` tells its background work, a change the vault's owners approve has the passkey
  sign it in a ceremony, every change is told to the device's peers, and `follow` asks every peer again at once.

Every caller goes through `Node::run`:

| Caller | How it calls |
|---|---|
| A browser | `PageDevice.run(op, ceremony?, read?)`, WebAssembly (`crates/avendb-browser`). `ceremony(challenge, step)` runs the passkey's prompt; `read(at, n)` hands `put_file` its bytes a megabyte at a time; `read_file`'s bytes come back as `bytes`, a `Uint8Array`. |
| The desktop app | The same device, native, beside the app (`crates/avendb-device`), in lines of JSON: `run [op]`, with `read_file`'s `bytes` in base64; `fileStart [op]`, `fileChunk [n, at, base64]` in order, `fileAgain [n]` for the second pass, `fileEnd [n]` and `fileDrop [n]` for `put_file`; `agents` (the access requests), `grant [name, device, aven, shares]`, `deny [name, device]` and `agentCommand [harness?]` for the agent devices on the desktop; `drives`, `joinDrive [path, name]`, `openDrive [path]` and `ejectDrive [path]` for the drives plugged into it (section 3). Its ceremonies run in the app's sign-in sheet (section 11). |
| An agent harness on the desktop | Its agent device, as its MCP server (`avendb-device agent <harness>`, section 3): `avendb_vaults`, `avendb_ask` for a read, `avendb_run` for a change, `put_file` too with the absolute `path` of a file on the desktop beside the op, each acting for its device vault, whose shares decide, and `avendb_request_access` for more. It has no passkey, so a change the owners approve answers `approve`. |
| No passkey at hand | `Node::run` with no authenticator (`NoCeremony`): a change the owners approve answers `approve` and makes nothing. |

A device's lifecycle stays outside `run`: founding, linking and opening a device (`Device.found`, `Device.link`,
`Device.open`), its name, its offer and QR code, and closing it. Everything else is an op.

### Answers

- **Done:** `{"ok": value}`, the value each op names below.
- **Refused:** `{"refused": "<Name>", "why": "<words>"}`. The name is a `policy::Refusal` by its Rust name, or the
  engine's own `BadOp` (the JSON says nothing the engine does, or a field the op doesn't take), `NoSchema` or
  `NoEntry`. A batch's refusal adds `at` and `done`. A refusal is an answer, never an error: a call fails only where no
  answer comes, as when a ceremony is cancelled, the store or the network fails, or a file's bytes end early.
- **Approve:** `{"approve": {"challenge", "signers", "draft"}}`, for a change the vault's owners approve, run with no
  ceremony at hand. Nothing is made.

**Approval.** A change is first tried for the device alone. Where the rules refuse it for want of approval
(BelowThreshold, NoConsent or NotRoot), it is drafted for the person's passkey (`engine::passkey_of`: the vault's
root, or else a passkey among its owners, never the master recovery key), with any newcomer that signs too, such as
the master recovery key by its standing consent (`engine::prepare`). With a ceremony at hand, the passkey signs the
`challenge` and the device keeps the edits (`engine::approve`). Without one, the answer hands out `challenge` (the 32
bytes the passkey signs: the edit's id, or the batch challenge of edits drafted together), `signers` (the passkey
first) and `draft` (the drafted edits on the wire, each behind its length in four bytes little-endian, in base64url
without padding). `share`, `revoke`, `settings` and `found` may answer `approve`; no other op does.

### Reads and asks

| Op | Fields | Answer |
|---|---|---|
| `query` | `vault`, `where`, `schema`, `select`, `order`, `limit`, `offset`, `depth`, `follow` | The entries the `where` holds of, picked by its labels' selector first, a page at a time, each read `depth` rows down, the links at the places `follow` names followed (below) |
| `get` | `entry`, `schema`, `line`, `at` | One entry on a line, or at a version |
| `history` | `entry`, `limit` | An entry's lines and every write of it, each with the changes it made and who stands behind it (`chain`) |
| `schemas` | `vault` | The schemas and lenses the vault's entries are read through |
| `groups` | none | The built-in groups of ops, each with its level |
| `kinds` | none | The kind table (section 3): each kind's name, `ownedBy` (`"signers"` or the kinds of vault that may own it), `most` owners (`null` for any), whether it holds `devices`, and how many of it one owner may own (`each`, `null` for any) |
| `limits` | none | How deep the device's queries read: `{depth, default, ceiling}` (below) |
| `world` | none | The device's world (below), or `null` while it belongs to no vault |
| `database` | `vault` | A vault's database as the device holds it: its tables, audiences, schemas, lenses and counts |
| `note` | `entry` | A note's page, an article's or any other record's alike: its lines, each proposal with its base and conflicts, and its edits |
| `log` | none | Every signed edit the device holds, in words, each that acts for a vault with its `chain` |
| `read_file` | `root`, `size`, `from`, `to` | `{root, from, to, len}` and the bytes beside; `NoCap` for a file the device doesn't open |
| `jobs` | none | What the node does in the background (`Node::jobs`): `{running, ended}`, the last 200 that ended, newest first |
| `creatable` | `vault`, `type`, `tags`, `as` | The tags a new entry needs to land where vault `as` may create it, or `NoCap` |
| `taggable` | `entry`, `as` | The tags `as` may add or take off: `"any"`, or a list |
| `may` | `ops`, `as` | For each change op: `true`, `{"approve": {signers}}`, or the refusal |
| `shares` | `over`, `as` | Every share over a vault, owners and devices among them, each with `may` of its revocation |

A job (`crates/avendb-net/src/jobs.rs`) is a file brought into the store as its bytes are sealed (`bring`, in bytes), a
file kept whole as its pieces come from its holders (`keep`, in pieces), or the edits a peer holds for the device,
taken page by page (`pull`, in edits). Each says its subject (a file's root, a peer's device), its stage, how far it
is of how much, when it started and ended, why it failed, and the vaults and entries it is about, each with how many
of its units are theirs (`vaults`, `entries`: a file's, the entry that brings it; a pull's, each whose edits it took).
One that did nothing is forgotten: a keep whose pieces were all there or that failed before it fetched one (the keeper
tries again), a pull that took nothing. The page's Jobs view reads it each second and shows only the jobs of the vault
it shows, each that ended with where what it worked on is synced to now (`syncedTo`), beside what still syncs of that
vault by entry and by file.

`may` and `shares` are asks: they run dry on the Lab, as their answers are dry runs, so a node runs them on a dry Lab
(`Node::dry`), never on a read-only view. A `shares` row says its kind (`owner`, `device`, `grant` or `keep`), its
who, its level in words (`owner` to `relay`, `keepWhole`, `keepOpened`, `keepNever`, or `actsFor` for a device), its
group, what it reaches (`"everything"`, or its `where` where the device reads the slice), its issuer and parent, and
`revoke`, the `may` of the revocation that ends it: for a keep share, acting as its issuer.

**The world.** `world` is what the page draws everything from (`crates/avendb/src/world.rs`): every vault the device
knows, with its kind, owners, devices (each with its copy setting where it set one, `copy`: `full` or `light`),
threshold and root, and as which vault the person acts in it (`acting`); every share in force (`shares`), with its
`who`, its `level` and its group, whether it is on the whole vault, whether its who reads (`reads`) and receives
(`gets`) what it reaches, and who may revoke it; every audience (`audiences`) with its `epoch` and the devices that
sync it; every entry with its type, tags, `audience`, `levels` by vault, readers, writers and sharers, and the files
its writes bring, each with how many pieces it is in and where it is synced to (`syncedTo`, as for the entry);
whether the person's vault owns avenCEO server (`ownsServer`) and whether avenCEO server backs it up (`backsUp`); the
built-in groups of ops (`groups`) and the kind table (`kinds`), as the ops of those names answer them, so the page
reads a kind's rules and never decides them. Its JSON names everything as the core does.

### Changes

**Entries.** `create {vault, type, tags, schema, value, as}`; the record ops `set`, `unset`, `insert`, `remove`,
`move` `{entry, line, schema, path, value, at, to, as}`; `tag {entry, add, remove, as}`; `propose`;
`merge {entry, from, into, take, as}`, `take` the conflicts where the target takes the other line's value, each
`{at: path, what: value | row | order}`, as `note` lists a proposal's `conflicts`; `restore`, `undo`, `variant`; and
`batch {ops, as}`, whose record ops in a row on one entry's line make one write. A schema or a lens is created as an
entry of its type (section 9).

**Vaults.** Each runs alone, never in a batch, and `may` covers each:

| Op | What it makes | Approval |
|---|---|---|
| `share {over, who, level, what, as}` | `who` is `{"vault": id}`, `"everyone"`, `{"signer": id}` or `{"device": id}`; `level` a built-in group's name, a group of its own `{name, ops}`, a keep level, or `"actsFor"`; `what` is `"everything"` or a `where` of labels. Owner on everything to a vault or a signer adds a co-owner (`Sharing::Owner`), `actsFor` a device (`Sharing::Device`), a keep level a keep share, anything else a grant (`Sharing::Grant`) resting, where the acting vault isn't the vault itself, on a share it holds that the one rule lets it rest on (section 5, `world::parent`): an owner share first, or, to a vault it owns, one at that level or more. `{"edit"}` or `{"share"}` | Owners, devices, Owner grants |
| `keep {over, mode, what, device, as}` | A keep share to one of the acting vault's devices, this one unless named; `mode` is `"whole"`, `"opened"` or `"never"`. `{"share"}` | Never |
| `copy {device, full}` | The copy setting of one of the person's devices, this one unless named: a wide keep share their vault issues over itself, Whole when `full`, else Opened; the device's other copy shares are revoked. `{"share"}` | Never |
| `revoke {share, as}`, `{vault, owner}` or `{vault, device}` | `Revoking::Grant`, `Owner` or `Device`. A keep share is revoked acting as its issuer. `{"edit"}` | Owner shares, owners, devices; not a device leaving |
| `settings {vault, threshold}` or `{vault, root}` | A threshold, or handing the root on. `{"edit"}` | Always |
| `found {vaults: [{kind, name}]}` or `{kind, name}` | New vaults the person's vault founds and owns, in one ceremony, each of a kind by its name in the kind table (coops, one aven, device vaults); then avenCEO server's share and a profile on each. `{"vaults"}` | Always |
| `put_file {vault, name, media, tags, len, as}` | The bytes sealed into the store as they come, then an entry of type `file` that brings them (section 13). `{"entry", "root", "size"}` | Never |
| `back_up {on}` | avenCEO server's share on the person's vault and the vaults it acts for: Backup, or Relay alone. `{"changed"}` | Never |
| `mark {entry}` | The steward's mark of the entry, now. `{"edit"}`, `null` where the marks are right already | Never |
| `card {name}`, `profile {vault, name}` | The device's card in its person's vault; a vault's profile. `{"wrote"}` | Never |
| `follow {vault, on}` | The vaults the device follows (section 12), kept in its shelf's meta. `{"follow"}` | Never |
| `set_limits {depth}` | The most rows and links down the device's queries read, 1 to 256, kept in its shelf's meta. Its `limits` | Never |

**Who may.** `share` and `revoke` through a share need the `share` op in the chain the acting vault holds. `put_file`
and a schema's creation are creations, under the `create` and `set` ops. `read_file` needs read reach (T27). `mark`,
`settings`, `found`, `keep`, `copy`, `back_up`, `card` and `profile` are only for devices acting for the vault itself,
never through a share. `follow` and `set_limits` need nothing: any device follows any vault, and sets its own
limits. An agent device runs neither (section 3).

### Paths, queries and two laws

A path names a place in a record, at any depth: a field, then a row of the list in it by its id, then a field of that
row, and so on (`["title"]`, `["blocks", {"id": 2}, "text"]`, `["nodes", {"id": 1}, "kids", {"id": 11}, "text"]`). A
copy of a row is `{"id": n, "copy": 1}` (section 7). A query's `where` mixes labels (type, author, entry, created, tag)
with tests on values, at a place or in any row of a list (`"*"`), at any depth: `["nodes", "*", "kids", "*",
"text"]`. Its labels compile to the very selector a share holds, so a device picks entries by labels before it opens
any (O3). Two laws tie changes to what they did, proved in `spec/AvenDB/Ops.lean` at any depth by induction on the
path: a diff explains any two records (O1), and an op changes only what it names (O2). The ops engine's cases are
pinned by `spec/vectors/ops.json`.

### Limits

Records nest without a limit of their own (up to the ceiling, section 7), and links make a graph. The limits sit where
a device reads: in its queries. avenDB keeps no paging, as each device holds what it reads.

- **A query reads so many levels down.** Each record is read `depth` rows down: 16 unless the query names its own
  (`engine::QUERY_DEPTH`), and never deeper than the device's most. A list of rows deeper than that is taken out of
  the row that holds it before anything else reads the record: no lens translates it, no `where` tests it, no order
  sorts by it, and the entry's row of the answer shows `"cut": true`. An empty list stays, as it holds nothing to
  read.
- **The device's most.** Each device sets its own (`set_limits`, Settings → Query limits), 1 to 256, and keeps it with
  what opens it again, in a browser's shelf and in the desktop app's folder alike (`Meta::query_depth`); until it sets
  one, it reads as deep as any write reaches. `limits` answers `{depth, default, ceiling}`: its most, the query's
  default and the ceiling.
- **Every level is a row or a hop.** A row a list down and a link followed (below) each take one level, so a deep
  record and a long chain of links cost only what the device allows.

### Links

A field holds a record's own rows, inline, or a link: another entry, maybe a row of it, at its newest or pinned at a
version (`ops::Link`, `spec/AvenDB/Links.lean`). The schema says which, field by field: what lives and dies with its
record is inline; what has a life of its own, its own shares and keys, is linked. A record holds a link as
`{"vault": id, "entry": id, "row"?: [field, {"id": n}, ..], "at"?: [edit, ..]}`, `row` and `at` left out where they
name nothing; `at` pins it at the version those writes make.

A query follows the links at the places its `follow` names, a level at a time (`ops::follow`): a field, or a path to
one through rows (`["cards", "*", "owner"]`), each holding a link or a list of links. Each link it follows shows what
it leads to as `"to"`, with the links there at those places followed in turn, or shows nothing and why, as `"empty"`
(a name) and `"why"` (words):

| `empty` | Why the hop shows nothing |
|---|---|
| `NoEntry` | The device opens no such entry: none of its shares reaches it, or no key it holds opens it |
| `WrongVault` | The entry is another vault's than the link names |
| `NoVersion` | The device holds no such version of the entry |
| `NoSchema` | No schema in the vault's lane reads the record |
| `NoRow` | The record holds no such row |
| `Deep` | Deeper than the query reads |

Each hop opens only what the device reading may read, as `get` would, and reads the record there as many rows down as
the query has levels left. So every record a query shows through links is one its reader opened, and every hop that
shows nothing says why (L1, L2). Every hop is one level of the query's depth, so a chain of links ends there, and a
cycle of links too (L3).

### A share is a named group of ops

A share, as the page writes it, is `{name, where, ops}` and nothing else (`slice::spec_of_json`,
`crates/avendb/src/rules.rs`, `Rules.lean`). Sealed in its slice, its ops carry a salt, and the ops of the shares it
rests on ride along (`above`), so its grantee can prove a write against the whole chain:

```
Op      = {"op": "relay" | "backup" | "read" | "create" | "propose" | "share"}
        | {"op": "set", "path": Pattern, "to": [v]?, "on": On?}
        | {"op": "insert" | "remove" | "move", "path": Pattern?, "on": On?}
        | {"op": "tag", "tags": [tag]?}
        | {"op": "merge", "on": On?}
Pattern = a path whose steps may be "*", at any depth; [] is the whole record
On      = "main" | "proposals"
```

A pattern names places at any depth, as a path does: `["nodes", "*", "kids", "*", "text"]` is the text of any row of
the kids of any node. An op on a row covers everything under it, its fields and its lists of rows at any depth. The
page's Share dialog offers each field of the newest schema at any depth, in words ("the text of any row of the kids of
any row of its nodes"), and each list of records to add, delete or reorder rows of.

The level is the class of the strongest op (`rules::level_of`): relay, backup, read, write (any op that writes) or
owner (`share`). A keep share has no ops. The built-in groups (`rules::groups`):

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
tag asked. A chain allows a write when every share of it allows every touch. A device refuses to make a write its
chain doesn't allow (NotAllowed), as its readers wouldn't count it.

- **C1** chains narrow: a chain allows nothing one of its shares forbids.
- **C2** readers agree: whether a write counts reads no selector, type or tag.
- **C3** counted writes do what they may.
- **C4** allowed writes count, and nothing built on an uncounted write does.

### Writes that fit their schemas

Every reader judges each write by the schemas its entry was written under, once the write is in
(`lens::Lane::fits`, `spec/AvenDB/Schemas.lean`). Each place it changed holds a value a schema allows there, and each
row it added or changed reads under one of them. Each change is judged on the innermost row around it, by the shape
the schema gives that row, at any depth. A write is judged by what it changed alone (S1), so a record that fits stays
so (S2). The schemas are capped at the ceiling (section 7): a write that adds a row deeper than 256 fits none of them,
whatever they let a row hold, so no record that fits holds one (S2, `S2_ceiling`). One that doesn't fit counts for no
reader, nor anything built on it (S3). Relays can't tell, and don't judge (S4). A device refuses to make a write that
wouldn't fit (NotAView).

## 9. Schemas and lenses

**Schemas** are JSON Schemas, each named by its hash. A **lens** says how a record of one schema version reads as
another, both ways (`crates/avendb/src/lens.rs`, `spec/AvenDB/Lens.lean`). No record is ever migrated: each field stays
in the version it was written in, each app reads through the lens into its own version, and its edits go back as only
what changed (T9). So an old app and a new one edit the same todo side by side, and defaults live in the lens.

**Every record has a schema.** avenDB ships the newest schema of each kind of record (`lens::blobs::SHIPPED`), each
told by its `kind`: a **document** (a note: a title, blocks and tags), a **todo**, an **article** (a title and one
Markdown text), a **flow** (stages an item can be in, each with whether it is public and where it goes next), a
**function** (a script that runs when an item enters or leaves a stage of a flow), a **post** (a public post of a
stream, about an entry), a device's **card** and a vault's **profile** (each a title, its name), a **file** (its
name and its media type), and a **story** (one content piece from its first spark to every platform it goes out on:
its title and format, the sparks it grew from, its journey's beats and its hook variants as rows, its intro,
description and launch; the story flow's tag says which of its stages it is in), and a **spark** (anything that might
become something, a thought, a link, a picture, a mood board, someone else's post, a video with its words, a quote: a
document's title and blocks, so a note's page edits it, and beside them its look, its link, whose it is, its language,
its transcript, its files and, for a mood board, the sparks it gathers; a story names the sparks it grows from, and
those with a link or whose they are are its sources). A note keeps its type, a document; the page lists notes among
the sparks, and the world gives a spark's record beside its title and text (`world::What::Note`). Every shipped
schema starts at v1.
The lens engine's worked example, a v0 of documents and todos and the lenses from it to v1 (`lens::example`), lives
only in the tests; nothing ships it, and no record is written under it.

**What a schema can say** (`lens::Schema`). An object's `properties` and `required`; each property a `const`, an
`enum`, or a `type`: a string (with `maxLength`, counted in characters), an integer or a number (any finite one, each
with `minimum` and `maximum`), a boolean, an object (its own `properties`, `required` and `additionalProperties:
false`, nested to any depth) or an array. An array of `items` is a list of values (with `minItems` and `maxItems`) or
of records (objects with a required integer `id`); one of `prefixItems` is a tuple of so many values, a position `[x,
y, z]`. A list of records may sit in a row of a list of records, at any depth (section 7). `$ref` names a shape of the
schema's own `$defs`; one that names no shape makes it no schema. A shape may hold a list of rows of its own shape,
an outline whose nodes hold nodes: a `$ref` that goes round through a list of records resolves lazily, one row at a
time. One that goes round through plain objects or values would be a value with no end, and makes it no schema.
`"x-loro": "text"` marks free text, and `default` what a field reads as when it is absent. `"x-link"` marks a link
(section 8): `true` any link, `"newest"` one that follows its entry's newest version, `"pinned"` one pinned at a
version; a property is one link, or an array of them. A field whose value doesn't fit reads as absent, and a record
that lacks a required one doesn't read. Other keywords change nothing.

**A lens reads rows of rows.** A lens's steps reach into the rows of a list of records (`in`), and into the rows of
their lists in turn (`in` inside `in`), so a shape that changes many lists down reads both ways as one at the top
does. A query translates only what it reads: each list of rows deeper than the query reads is emptied as stored
before the lens translates anything, then taken out of what the app reads (`engine`'s `see_within`).

**avenCEO GmbH holds them.** Every app knows avenDB's own schemas by heart, so each vault reads and writes them
offline. Beside that, avenCEO GmbH holds each as an entry of its own, of the very same bytes and so of the same id,
shared with Everyone: the founder's page adds those it lacks once their seed is there. A vault's lane doesn't reach
into another's, so any other vault's records still read through the copies every app ships.

**Schemas and lenses are entries.** A vault's schema or lens is an entry of the built-in type `schema` or `lens`
(`slice::SCHEMA_TYPE`, `LENS_TYPE`), whose creation holds the schema's or lens's JSON alone, as its content, with no
tags. It is made with the `create` op, `{"op": "create", "vault", "type": "schema" | "lens", "value": "<the JSON, as
text>"}`, which answers `{"entry", "blob"}`, the blob being the hash of those bytes (`Lab::add_schema`). JSON that
isn't a schema or a lens of the type named is BadOp.

**Shared with Everyone.** Every vault shares its schemas and lenses with Everyone, so that whoever reads anything of
it can read the schemas it was written under. Its first schema or lens entry made acting for the vault itself makes
the share first: a Read share to Everyone, over the vault, named "Schemas and lenses", not wide, whose selector picks
the two types (`Selector::lane`). It is made then, never at genesis.

**The lane** is what readers read off those entries (`laneOf` in `State.lean`, `State::lane_of`): for each schema or
lens entry of V that V created itself, through the owners its creation names, and that its readers count, the blob of
its creation, in creation order, each blob once. A creation whose content doesn't parse as its type is accepted and
adds nothing. One created by anyone else through a share adds nothing. A later write to such an entry is ignored. No
peer checks the lane, and the server knows none (T17, T25).

A write counts once its reader holds its schema: the lane only grows, so a verdict changes at most once, from not
counted to counted. Readers agree on the lane because every reader of V syncs V's schema entries: a keep share always
picks them (section 5), and the Everyone share sends them to every device with an interest in V or that follows it.

**Flows and functions.** A flow is a recipe of stages any entry can be in (`src/lib/avendb/flows.js`): the content
flow takes an article from idea to draft to published. An entry is in a stage while it carries the entry tag
`<flow>:<stage>`, so moving it is one `tag` op. A public stage is one Public share of the vault picking that tag
(`{"tag": "content:published"}`), which reaches each entry tagged so, now and later, and lets go of one untagged:
nothing is shared or revoked entry by entry. A function names a flow, a stage and whether it runs as an entry enters
or leaves it; its code, a JS module exporting `run(event)`, runs in QuickJS on the device that moves the entry, with no
page, network or keys, and hands back the ops it asks for (`src/lib/avendb/functions.js`). The device makes them as
the acting vault, on the entry's vault alone, a share among them only a Public one: caps still decide. Publishing
makes a `post` entry about the article that carries the stage's tag, so the same share makes it public. The story
flow takes a story through idea, hook, thumbnail, journey, writing, movie, derivatives, scheduled and published, every
stage private; a vault's Stories page is a board of its stories by stage. Every app knows both flows and the content
flow's two functions; avenCEO GmbH holds them as entries, Public by their type, and a vault's own flows and functions,
then avenCEO GmbH's, come before the app's, never anyone else's.

**The Maia Universe's feed.** avenDB's server keeps the vaults that give avenCEO server backup, the seed's among them,
and opens what everyone may read. Its feed (`GET avendb.maia.city/feed/posts`, `world::public_posts`) lists the `post`
entries it opens that are public and not deleted, newest first, each with its vault's name and kind, as JSON any page
may read; the Maia Universe page takes it in and shows each post under the vault that published it. A post leaves the
feed as its article goes back from Published: its function deletes it and takes its tag off, so no Public share reaches
it.

An article shows the pictures of its vault's Library by their names (`<hash>.jpg`), and a post lists those of them
everyone may read (`pictures`): each a `file` entry of the vault, public and not deleted (`world::public_files`). The
server serves each whole, as it opens it, at `GET avendb.maia.city/feed/files/<vault>/<name>`, pictures alone, by
their names' endings; the post's page shows its cover and its pictures from there, and leaves out any other. Publishing
an article asks first whether the pictures it shows that are not public yet go public too: if so, the Publish function
tags them with the stage's tag, as it tags the post, so the same Public share covers them; going back from Published,
the other function takes the tag off those no other published entry shows. A published article that leaves any out
offers it again.

## 10. Post-quantum only

Every node trusts no elliptic curve alone, and there is no switch back.

| Where | How |
|---|---|
| Signatures | SLH-DSA-SHA2-128f on every edit, the only signature that counts (17,088 bytes each). |
| Passkeys | A passkey's WebAuthn assertion (P-256) rides beside its SLH-DSA signature: it shows a person was there. |
| Sealed keys | Every box is sealed to X-Wing (ML-KEM-768 with X25519) and Classic McEliece 6688128f at once. |
| Data | XChaCha20-Poly1305 for edits and boxes, ChaCha20-Poly1305 per 64 KiB file segment, 256-bit keys. |
| Hashes | BLAKE3 for every hash of avenDB's own: an id is the plain hash of its bytes, the name iroh-blobs gives them; every other hash derives its own key for its purpose (`hash`). |
| Connections | TLS 1.3 with X25519MLKEM768 as the only key exchange, on every link between nodes. |
| Hellos | Each connection opens with an SLH-DSA signature each way over the TLS exporter (section 12). |
| The bucket | Its endpoint is classical, so the server seals every object first, with a 256-bit key of its own. |

A box opens only with both shared secrets, so it stays closed while either scheme holds. A McEliece public key is a
megabyte, so it travels as a blob named by its hash, beside the edits that name it. The Verifpal model `seal.vp` shows
that a sealed key stays secret when either scheme falls (`spec/protocol`).

A device's ed25519 key is only its iroh endpoint's identity: its hello binds it to its SLH-DSA key, and it signs no
edit. A person's device keeps the secret its keys come from masked by its passkey's PRF output, and unmasks it at each
unlock, so the SLH-DSA key behind each of its edits traces back to the passkey.

## 11. Passkeys

A person's passkey is the root of everything they hold. It stays in their platform's authenticator, used through
WebAuthn with the PRF extension (`crates/avendb-browser/js/passkey.js`). A device never holds it, only what one
ceremony brings back: an assertion over a challenge, and PRF outputs on avenDB's salts.

- **One passkey for maiaCITY and avenDB.** Both use the relying party `maia.city`, so the passkey a person signed up
  with can be their vault's root. Sign-up asks for PRF, and for a P-256 key first, as avenDB's ceremonies take P-256
  signatures alone (`src/lib/auth/client.ts`). A passkey without PRF still signs the person in to maiaCITY; avenDB then
  offers to make one of its own, and refuses one it made without PRF.
- **User verification in every ceremony.** Without it an authenticator's PRF answers with another secret. Every
  ceremony requires it, and every assertion must show it (`sign::Assertion` checks the UP and UV flags).
- **Salts of its own.** The passkey's keys derive from the output on avenDB's salt (`sign::PRF_SALT`). Each device's
  own secret is kept masked by the output on its own salt, which ends in 32 random bytes the device keeps
  (`sign::device_salt`). The browser hashes each salt under the label "WebAuthn PRF" first, so no other use of the
  credential gets these outputs. Each key derives under a label of its own. So a device unlocks only with its
  person's passkey, and a stolen, locked device opens nothing.
- **Bound to the passkey.** A ceremony counts only if its assertion verifies under the passkey's P-256 key and the
  SLH-DSA key derived from its PRF output is the one the vault knows (`sign::Ceremony`). So maiaCITY's API, which sees
  its own sign-ins' assertions and never a PRF output, can't sign for a vault.
- **One prompt for many edits.** Edits drafted together are signed in one ceremony over their batch: its challenge is
  the hash of their ids, smallest first (`sign::batch_challenge`), and SLH-DSA still signs each edit's own id.
  A first browser founds its vault, adds itself and claims a new server in one prompt after the unlock. New vaults its
  vault owns come in one more (`found`).
- **The pass.** The ceremony that unlocks a new device is its passkey's pass for it (`sign::RelayPass`): an assertion
  and an SLH-DSA signature over the device's keys and the time, good for ten minutes. It lets the device onto the
  server's relay and proves it to the peer it links through. A device that never saw its passkey made learns its
  P-256 key from the next ceremony: it drafts for each key the unlock's assertion recovers to, and keeps the drafts of
  the one that ceremony verifies under (`Lab::drafting_for`).
- **Held briefly.** The device copies each PRF output into memory that wipes itself, and wipes the buffer it came in.
  None is ever sent open, logged or shown.
- **In the desktop app.** macOS lets an app's web view use maia.city's passkeys only with an Apple-signed entitlement,
  so each ceremony runs in a sign-in sheet: the device makes a one-time X-Wing key, names it in the URL of maia.city's
  sheet page (`/app/avendb/sheet/`), and the sheet page runs the ceremony and seals what it brings back to that key at
  once (`keys::seal_once`). The device opens it (`keys::open_once`). Nothing crosses the app open. The sheet's answer
  goes to whichever app opened it, so the person's prompt is the only gate there, and the sheet says to confirm only
  what they just asked for.

Every page on `maia.city` can ask the person's authenticator for a ceremony of that relying party, so the site's own
scripts are part of what guards the root, as for any passkey. Each ceremony shows the person a prompt.

**A device's secure boundary.** Nothing on disk, in a view, in a log line or in a debug print holds a secret: a node's
store holds signed edits and McEliece public keys, and a key prints as its id. The server's device secret is the one
exception, sealed in its bucket, or in its folder where it keeps no bucket. Every key wipes itself as it is dropped. A
locked device holds no key, nothing a key opened, and no McEliece secret half. Its randomness keeps one key that every
draw replaces with a hash of it, and an unlock reseeds it from the device's own key, so a copy of its memory can't
rewind what it drew, nor, taken while the device was locked, foresee what it draws.

### Device keys: one per install

Your passkey stands for you and is the same on every device it syncs to: its keys derive from its PRF output on
`sign::PRF_SALT` the same way every time, and it owns the vault. A device key stands for one install, a browser on
`maia.city` or the desktop app, and signs what that install writes.

- **Random, not derived.** A new device draws its secret, 32 bytes, from its own randomness (`avendb_browser::Fresh`),
  so its keys and id exist before any prompt. The prompt that unlocks it is then also its passkey's pass for it, as
  the pass names its id (`sign::RelayPass`): two prompts to set up or sign in, where a derived key would need a
  third. A device key holds no data, so nothing needs it back: a wiped or new install joins with the passkey and
  syncs from the person's other devices and the server, and the old device is revoked. Making an old key again would
  do harm: the copy would sign edits that don't build on the old device's own, which sync reports as a fork
  (`sync::forks`), as for a stolen key, and a revoked device would come back.
- **As long as its storage.** Closing a tab, the browser or the app keeps the device whole. The next start takes one
  prompt (`Device::open`), opens with everything the device held, and syncs only what changed, log by log. Only wiped
  storage makes a new device: cleared site data, a private window, an uninstall, a new phone. Browsers may clear a
  site's storage on their own (Safari after a week unused), so a browser starts as a light copy and the desktop app
  as a full one (section 5, Copy setting).
- **What opens it.** Its shelf keeps one record that opens it again (`avendb_browser::Meta`, as `meta/<n>` objects,
  put once, the newest that reads counting): its name, relay and id, the 32 bytes of its salt, the passkey's
  credential and P-256 key, the vaults it follows, and its secret XORed with the PRF output on its salt
  (`Fresh::mask`). None of it is a secret. A browser keeps the shelf in `maia.city`'s OPFS, the desktop app in
  `~/avenDB/mac/`.
- **Kept safe.** Unmasking the secret takes the PRF output on the device's salt, which only the person's
  authenticator gives, with user verification and to `maia.city` alone; the device checks that the unmasked secret
  is the key of its id before it touches its shelf. While open, the key is in memory only and wiped as the device
  locks. A disk copy gets nothing; malware on a machine while the device is open, or the site's own scripts asking
  for a prompt, are outside what a disk can guard. The server's device is the one whose secret is on disk, sealed in
  its bucket, as nobody is there to unlock it.

## 12. Sync over iroh

### The node

Each device is a node on its own iroh endpoint (`crates/avendb-net/src/lib.rs`). The endpoint's key is the device's
ed25519 key, so iroh's TLS proves the endpoint. It uses no n0 service: addresses come from offers, and connections go
direct where they can and through avenDB's own relay where they must.

One `Router` hands each connection to a protocol by its ALPN, as iroh intends:

- `avendb/sync/1` (`ALPN`), avenDB's one protocol of its own (`session.rs`): hellos, requests, replies and holdings.
  It decides what moves.
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
| 2 | Card: the server's contact card | The vault logs of avenCEO server and its owners, up the chain |
| 3 | Link: a passkey's pass for this connection's device | The link card |
| 4 | Join: the edit that adds the new device | Nothing, once taken |
| 5 | Claim key | The unclaimed server's key to seal to, or an agent device's |
| 6 | Claim: the edit that adds the server to avenCEO server, or an agent device to its device vault | It, signed by the claimed device too |
| 7 | Ask logs: a request for some logs alone | A page of edits of those logs |
| 8 | State: a device's signed statement of its holdings, its own or passed on | Nothing, once kept or found older |

### Frontiers per log

When a device asks, it names of each log its frontier, the edits 1, 2, 4, 8, … steps back from it, and the oldest
(`sync::Ask`). It lists its loose edits, and the vaults it follows. The peer sends what it would send whole, less those
loose edits and whatever lies at or below an edit the device named (`respondSince`). A peer that is behind sends
exactly what the device lacks. Nothing the device lacks is withheld (T19). Replies come a page at a time, about 4 MiB
(`Options::page`), each edit after its past.

### What a peer sends

A peer sends a device, by its own view (`sync::answer`, `respond` in `spec/AvenDB/Sync.lean`):

- the logs of the entries the device may receive and its keep shares want (T12, T28). It may receive an entry if it
  acts for the entry's vault, or for the grantee of a live share at Backup or more that is wide or in the entry's
  audience, or an Everyone share reaches the entry and it has an interest in the vault or follows it;
- the logs of the audiences and shares needed to check those;
- the logs of the vaults all that names, up their chains of owners.

Nothing else. A relay share gives the vault log alone, so the server learns the devices to let through and nothing of
the entries (T26).

**Interest and follow.** What a vault shares with Everyone goes only to a device with an interest in the vault: one
that acts for it, or for a vault holding a live share over it, at any level (`interested` in `Sync.lean`,
`sync::Reach`). A device may also name vaults in its request's `follow` list (`Ask::follow`, a sorted set). Following
brings nothing that isn't public, and a device that acts for no vault and follows none is sent nothing at all (T12). So
a device learns nothing of a vault it has no interest in and doesn't follow, not even its governance log. A device
sets its list with the `follow` op; a browser or the desktop app keeps it in its shelf's meta (`Meta::follow`), so it
survives a restart, and a change asks every peer again at once. The blob gate reads the follow list of the last
request on the asker's sync connection, so a follower fetches the public files of what it follows.

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
  An announcement names no device, so a device speaks only for itself, and nobody announces anyone else's. A record
  that claims more than 2^18 logs or files is dropped (`MOST`).
- **Asking.** A node that hears of a head it lacks, in a log the claimant may hold by the node's view, asks for those
  logs alone (Ask logs), naming of them only what it may name to that peer. A claim to any other log the node holds
  steers nothing. A log the node holds nothing of is still asked for, naming nothing.
- **Synced to.** One list for entries and files alike (`Node::synced_to`, `Holder`): the devices that hold some of
  it, this device by its own shelf, and others only by what they said themselves, on their own proven connection or
  in a statement they signed (below), and only if they may hold it by the node's view; each with how much it holds,
  `has` of `of`: of an entry, the edits of its log the node holds, of a file, its pieces. A device holds all of an
  entry when its stated frontier covers every edit of the entry's log the node holds, and all of a file when it holds
  it whole. A device that holds none of it as far as the node's edits show isn't listed. An entry or a file is backed
  up once the server is synced to all of it.
- **Routing, never permission.** Holdings choose which logs to ask for and which peers to fetch from first. The blob
  gate still hands out a file by T27 alone.

The model defines these in `Logs.lean` (`Holdings`, `Node.record`, `Node.syncedTo`, `Node.hands`), states them in
`Theorems.lean` and proves them in `SyncLemmas.lean` (section 15, H1 and T27).

### Signed holdings

An announcement counts only on its device's own connection, so once a device leaves, its peers that never met it
would not know where anything is. So each device also signs what it tells each peer it holds, with when it checked
(`crates/avendb-net/src/statements.rs`, `wire::Statement`, H2):

```
Statement { keys, checked: u64, logs: [(LogId, Frontier)], files: [(FileRoot, Whole | Pieces)], sig }
```

- **Signed by the device.** SLH-DSA-SHA2-128f over the version, the device, `checked` (seconds since 1970 by its
  clock) and its holdings, under its own context string (`sign::STATEMENT_CONTEXT`): it counts as nothing else, and
  only a device's own key proves one. A passkey's keys prove none.
- **When.** A device signs one statement for each set of holdings it tells a peer, on each new connection, once they
  changed, at most every 10 seconds, and again every 15 minutes while they stay the same. It tells them to the peers it
  is connected to, beside its announcements (State); nobody dials anyone for them.
- **Kept, newest wins.** A node keeps of each device it knows the statement checked last, whoever brought it, as it
  proves itself. It refuses one checked more than a day past its own clock, one of more than 2^18 logs or files, a
  stranger's, and its own device's.
- **Passed on, only to who may know it.** A node passes the statement it keeps of a device to each connected peer that
  may know every log and file it states by the node's view, once on each connection.
- **On the shelf.** A node keeps statements on its shelf as `stated/<device>/<checked>`, put once: the first of a
  device at once, then a newer one at most once an hour if its holdings changed, and once a day if they didn't. As it
  starts, it takes back the newest of each device that proves it. So the server still says where everything is after
  a restart.
- **Synced to, with when.** A device on a live connection, or of which the node keeps no statement, is listed by what
  it announced, `checked: null`. Any other device is listed by its newest statement, `checked` its time, which the page
  shows as "checked 2 h ago". A device's word outlives its connection.
- **Showing, never permission.** Statements only say where things are: a node asks and fetches by what its peers
  announce alone, and the blob gate never reads them (`T27_gate_reads_no_statements`).

The model defines these in `Logs.lean` (`Statement`, `Node.states`, `Node.statement`, `Node.passes`,
`Node.syncedToAt`), states them in `Theorems.lean` (H2) and proves them in `SyncLemmas.lean`.

### Blobs

- **One pool.** A node fetches every blob over one iroh-blobs `ConnectionPool` (`blobs.rs`). The McEliece keys a reply
  names come in one GetMany request, one at a time if the peer refuses one of them. File pieces come from peers whose
  holdings hold them first, then other connected peers, then holders it would have to dial.
- **The gate (T27).** A blob connection is let in only while the same endpoint has a live sync connection whose hello
  proved its device. Each request names one blob, never a HashSeq with its children. The gate hands out a McEliece key
  the device may fetch, or a file's root or piece only if the device may receive a write that brings the file. Push is
  off.

### The relay and linking

The server runs iroh's relay beside its node (`crates/avendb-server`). It lets in only the devices the server knows:
those of the vaults it relays or backs up, of avenCEO server's owners, and itself. A device it doesn't know yet comes in
by its passkey's pass for ten minutes. While sign-up is open, or the server is unclaimed, any passkey's pass does. It
forwards only encrypted QUIC.

A page has no socket of its own: it reaches nobody until its relay has let it in, and a dial it sends sooner is lost
and sent again ever later. So a node without a socket waits for its relay first, up to 20 s, as its `relay` step, then
dials (`Node::on_relay`). A node with a socket of its own dials at once.

A new device links by its passkey alone:

1. A device that holds the vault shows its offer as a QR code (`Node::offer`, text `AVENDB1…`): its device, its
   endpoint and where to reach it. The app knows the server's offer too.
2. The new device connects, both say their hellos, and it shows its passkey's pass for itself (Link).
3. The peer checks the pass is for the device whose hello proved it on this connection, and hands back the link card
   of each passkey the pass may be from: the logs of the vaults the passkey owns, up the chains, and nothing of a
   share, an audience or an entry (T20, `Lab::link_card`).
4. The new device adds itself to the vault whose root is the passkey, a Device share signed by the passkey and by
   itself, from the same ceremony as its pass (Join). The peer takes that edit only for the device on the connection
   (`Lab::accept_join`). Then they sync.

With every other device lost, the server's offer brings the vault back. The Verifpal model `link.vp` covers this.

**Not gossip.** Announcements go straight to one proven device. A gossip topic would tell every member of a log, its
members learn each other's addresses, and its 4 KiB messages can't carry one SLH-DSA signature.

## 13. Files

A file enters avenDB with a write of the entry it belongs to. A file in a vault's Library is an entry of type `file`,
a record of the `file` schema with the file's name and media type, made by one write and brought by the next (the
`put_file` op). Shares, sync and deletion work on it as on a note.

**Sealed blob, version 2** (`crates/avendb/src/sealed.rs`, its bytes pinned by vectors):

- **Key.** Each file has its own 32-byte key, derived from what the file holds, keyed by a secret of the person's
  vault (`sealed::Convergent`): BLAKE3 over that secret, the format, the file's length and every byte. The secret
  is a child of the vault's current seed (`Lab::convergence`, "avendb file convergence"), which every device of that
  vault holds and nobody outside it. So the same file sealed again by any device of the vault, into any vault it acts
  for, gives the same bytes, which iroh keeps once. Another person's devices derive an unrelated key, so nobody else
  can tell which files they hold. A device with no such seed takes 32 random bytes.
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

- `put_file` checks the entry it would create before it reads a byte. `Node::store_file` reads the file twice: once
  to derive its key, once to seal it, checking the key again over the bytes it seals, so two different files never
  share a key. It streams each piece onto the shelf, so a file of any size passes through a few segments of memory;
  then the entry and the write that brings it are made.
- `read_file` (`Node::read_file`) reads any range: the segments that hold it, from its own shelf, or fetched from a
  peer, 4 MiB at a time, verified and opened. Pieces read but not kept stay in memory windows, 64 MiB at most, oldest
  out first.
- The keeper fetches whole the files a device keeps (`Lab::kept_files`): where a Whole share among those it syncs the
  vault by, its own or else its copy setting, picks the entry, or by the device's own setting where those are none or
  only Never ones. Entries a Never share picks aren't synced at all. It retries with backoff until each piece is
  finished on the shelf, and drops nothing it kept.

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
| Drive | A folder on the drive, `<volume>/.avendb/`, laid out as the desktop's | The folder | Memory windows |
| Server | An S3 bucket, every object sealed (`crates/avendb-net/src/bucket.rs`) | The bucket | Its folder |

A browser tab's worker holds the store's lock, so one device never runs in two tabs at once.

**Generations and resets.** A place keeps its shelves side by side, one per generation, `g1`, `g2` and on. The newest
is in use; every older one is put aside, never read again. Forgetting a device starts a new one. A reset of avenDB
raises `shelf::FLOOR`, the generation every place is at least: as a place opens, it clears every shelf older than that
and whatever else an earlier avenDB kept there (`shelf::kept`), and starts empty, the server with a new device key. The
Mac clears its folder (`disk::clear`), a page its OPFS folder, the server its folder as it starts and its bucket while
it runs (`bucket::clear`). `FLOOR` is 9 since the master recovery key is built in again, so every human vault starts with it, the last reset.

### Layout of one generation

```
<root>/g<n>/
  journal/<n>      what one save added: new edits of the device's log, and the McEliece keys they brought
  heads/<n>        after every 64 journal entries: the packs that hold the log so far, and every McEliece key
  blobs/<hash>     edit packs, McEliece keys, HashSeqs and file pieces, each named by its BLAKE3 hash
  outboards/<hash> each blob's outboard, written last: a blob counts once its outboard is there
  new/             blobs and objects being written
  meta/<n>         what opens the device again, follow list included (browser, desktop); device.key on the server
  stated/<device>/<checked>  each device's signed statements of its holdings, at most one an hour each (H2)
  drives/<device> the key of each drive this desktop hosts, wrapped under its own device's (section 3)
```

- **Edits** (`crates/avendb-net/src/edits.rs`). A save appends a journal entry. Every 64 entries, a pack blob takes
  them and a new head names the packs. A node starts from its newest head that reads whole, and the journal after it:
  a few dozen objects, however long the log. Once a head would name 64 packs, the next names one pack of the whole log.
  Every head and entry ends with the BLAKE3 hash of all before it, so a torn one reads as none. Every edit is checked
  again as it comes back.
- **Packs, not one object per edit.** An edit is a few kilobytes and object storage bills at least 64 KB per object,
  so packs keep "everything is a blob" true and cheap.
- **Generations.** A place keeps its shelves side by side: `g1`, `g2` and on. The newest is in use. Forgetting an
  account, or starting fresh, makes a new generation beside the old one, which is never read again. A reset clears
  every generation below `FLOOR` and whatever else the folder or bucket holds, such as an older avenDB's store.

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
  compromised server wipes the backup. What a reset clears stays there 7 more days, then goes.

A server with no bucket runs on a folder shelf, laid out the same. A node with no shelf at all keeps its blobs in
memory and nothing past its end; only tests run one.

## 15. The Lean model: what guards what

The model is Lean 4 with no Mathlib (`spec/`). `lake build` checks every proof, every scenario (`#guard` in
`Examples.lean`) and every vector file. `lake exe vectors` writes the vectors again after a rule changes. Many Rust
tests carry their theorem's name, and `crates/avendb/tests/vectors.rs` replays `spec/vectors/vaults.json` edit by edit.
The full table, with each theorem's Rust guards, is `spec/README.md`.

| Model file | What it holds |
|---|---|
| `Basic.lean` | Ids, levels and keep modes, Who, selectors, headers, audiences, key families and names |
| `State.lean` | What a peer knows: vaults, acting via owners, shares, entries, stays, wants and keeps, the lane |
| `Step.lean` | The seven kinds and the rules that take or refuse each; the replay order; strong removal (`view`) |
| `Sync.lean` | What a peer sends a device, interest and follow, the files it may fetch, the link card |
| `Logs.lean` | Logs, frontiers, asks, forks; holdings, announcements, connections, signed statements, Synced to and the blob gate |
| `Rules.lean`, `Ops.lean`, `Schemas.lean` | Op groups and touches; records inside records, diffs and queries at any depth; schema fit per row, the ceiling |
| `Links.lean` | Links, a record read so many rows down (`Doc.cut`), and following links a level at a time (`follow`) |
| `Lens.lean`, `Doc.lean`, `Proposals.lean` | Lenses (T9); merge of histories and the three-way merge of records (T10a to T10e); lines of history (T10f to T10h) |
| `Props.lean`, `Theorems.lean` | The predicates the theorems use; every other theorem's statement, the proofs in the `*Lemmas.lean` files and `Schemas.lean` |
| `Examples.lean`, `Vectors.lean`, `OpsVectors.lean` | The scenarios, checked on every build; the cases the Rust core replays |

Each guarantee and the theorems that state it, in `Theorems.lean` unless the row names another file:

| # | Guarantee | Theorems |
|---|---|---|
| T1 | Only authorized writes are accepted, and revocation wins over what it hadn't seen | `T1_authorized_writes`, `T1_created_entries`, `T1_revocation_wins` |
| T2 | Governance needs approval and consent; devices never govern | `T2_governance`, `T2_consent`, `device_cannot_govern`, `devices_cannot_govern` |
| T3 | No ownership cycles | `T3_no_cycles` |
| T4 | Shares name a vault or Everyone; a device only in a keep share of its issuer's device | `T4_shares_name_vaults` |
| T5 | A key opens only for whoever could read its family | `T5_confidentiality` |
| T6 | Forward secrecy: current keys open only for those entitled now | `T6_forward_secrecy` |
| T7 | Blind server: no key of a vault whose seed it never held, unless public | `T7_blind_server` |
| T8 | Everyone only reads | `T8_everyone_read_only` |
| T9 | Lens laws: round trips, edits through a view keep what it can't see | `T9_*` in `Lens.lean` |
| T10 | Merge is the union of histories and reads as the three-way merge, keeping the target's changes; lines don't touch | `T10_*` in `Doc.lean` and `Proposals.lean`, with `writes_ordered` |
| T11 | Same edits in any order, same state | `T11_convergence`, `T11_same_standing` |
| T12 | Sync sends what shares reach; Everyone only to interest or follow; strangers get nothing | `T12_sync_sends_only_what_shares_reach`, `T12_interest`, `T12_stranger_gets_nothing`, `T12_since` |
| T13 | Two devices that asked each other once converge | `T13_sync_converges` |
| T14 | Accepted writes are causally closed | `T14_causally_closed`, `T14_entries_whole` |
| T15 | Rotation follows revocation | `T15_rotation_follows_revocation`, `T15_no_older_epoch` |
| T16 | Strong removal: what a removal hadn't seen and relied on is cut | `T16_strong_removal`, `T16_resolved_removals_stand` |
| T17 | The lane holds only the vault's own schema and lens creations | `T17_lane_from_creations`, `T17_writes_ignored` |
| T18 | Retired with the checkpoints: every edit carries an SLH-DSA signature | |
| T19 | Frontier sync loses nothing; one frontier per log tells whether to ask | `T19_frontier_sync`, `T19_frontiers_alone`, `T19_same_frontier` |
| T20 | Linking hands out vault logs alone | `T20_link_shares_only_vault_logs`, `T20_stranger_gets_nothing` |
| T21 | Vaults keep to their kind, by one kind table; one aven per human | `T21_vault_kinds`, `T21_owners_count`, `T21_aven_owner`, `T21_one_aven` |
| T22 | A share grants no more than what it rests on, by one rule; no wide owner share | `T22_slices_narrow`, `T22_sub_cap_level`, `T22_wide_shares` |
| T23 | Marks mean what the shares say: audiences and wants, from `mark_means` | `T23_marks_mean_shares`, `T23_creations` |
| T24 | An entry's key reaches only its audience's readers | `T24_entry_keys`, `T24_entry_history` |
| T25 | Blind relays decide every edit as an owner does | `T25_blind_relays` |
| T26 | A relay share receives none of the entries | `T26_relay_keeps_nothing` |
| T27 | Files follow their edits; holdings never authorize, and name only files the peer may fetch | `T27_files_follow_their_edits`, `T27_holdings_never_authorize`, `T27_gate_reads_no_holdings`, `T27_holdings_name_only_fetchable_files` |
| T28 | Sync follows the keep shares, and their modes | `T28_sync_follows_keeps`, `T28_keep_modes` |
| K1 | A keep share's revocation cuts nothing | `K1_keep_revocation_cuts_nothing`, `K1_keep_revocation_hides_nothing` |
| H1 | Holdings come only from their proving connection, a node announces none but its own and states only its shelf, and Synced to lists only devices that said so and may hold it | `H1_heard_on_their_connection`, `H1_third_party_ignored`, `H1_passes_nothing_on`, `H1_states_its_shelf`, `H1_synced_to`, `H1_synced_to_held`, `H1_synced_to_file` |
| H2 | A statement counts only as the word of the device that signed it, newest wins, passes only to who may know it, and Synced to lists a device with a time only by its own signed statement | `H2_signed_by_its_device`, `H2_newest_wins`, `H2_unsigned_ignored`, `H2_states_its_shelf`, `H2_passes_only_what_they_may_know`, `H2_synced_to_checked`, `H2_synced_to_now`, `H2_synced_to_held`, `T27_gate_reads_no_statements` |
| O1 | A diff explains any two records | `apply_diff`, `diff_complete`, `diff_sound` in `Ops.lean` |
| O2 | An op changes only what it names | `diff_within` in `Ops.lean` |
| O3 | Queries pick by labels first | `cover_sound`, `plan_sound`, `plan_run` in `Ops.lean` |
| C1 | Chains narrow | `chain_narrows`, `child_narrows` |
| C2 | Readers agree whether a write counts | `counts_seen`, `creates_seen` |
| C3 | Counted writes do what they may | `counted_allowed`, `counted_writes`, and `changes_allowed` in `Rules.lean` |
| C4 | Allowed writes count, and nothing built on an uncounted one does | `allowed_counts`, `allowed_creates`, `uncounted_closed` |
| S1 | A write is judged by what it changed | `S1_judged_by_changes` |
| S2 | Records that fit stay so; no write reaches deeper than the ceiling | `S2_clean_stays_clean`, `S2_first_write`, `S2_ceiling`, with `capped_change`, `capped_fits`, `capped_deep` and `capped_clean` in `Schemas.lean` |
| S3 | Writes that don't fit count for no reader | `S3_unfit_uncounted`, `S3_step` |
| S4 | Relays don't judge records | `S4_fit_unread` |
| L1 | A hop the reader opens nothing of shows nothing, and why | `follow_refused` in `Links.lean` |
| L2 | Every record a query shows through links is one its reader opened, and every empty hop says why | `follow_opened` in `Links.lean` |
| L3 | A query follows links no deeper than its depth, so a cycle of links ends there | `follow_height` in `Links.lean` |

T29 (marks mean what the keep rules say) is merged into T23, whose wants part it is.

**Protocol models.** The theorems take signatures and encryption as given. What devices say on the network is modelled
in Verifpal against an attacker who breaks the curves (`spec/protocol/*.vp`, run by `check.sh`): `seal.vp` (the sealed
box), `hello.vp` (the hello) and `link.vp` (linking by passkey).

**Assumptions**, each part of the model and none an axiom: signatures can't be forged; sealed data reveals nothing
without its key; ids don't collide; Loro converges and can revert to any version it holds. A hello proves the device
whose keys sign it on that connection.

## 16. Where to look

| Path | What it holds |
|---|---|
| `crates/avendb/src/policy.rs` | Edits, the seven kinds, shares, refusals, the replay, strong removal, meaning |
| `crates/avendb/src/sync.rs` | Logs, frontiers, asks, follow lists, what a peer sends (`answer`, `Reach`) |
| `crates/avendb/src/keys.rs` | Key families, epochs, sealed boxes (X-Wing and McEliece) |
| `crates/avendb/src/sign.rs` | SLH-DSA signatures with a passkey's WebAuthn assertion, hellos, passkey ceremonies, standing consent, the pass |
| `crates/avendb/src/wire.rs`, `encode.rs` | Every message and edit as bytes, one encoding each; holdings' `Announce` |
| `crates/avendb/src/lab.rs` | A device's state and its upkeep: stewards, keys, schema entries, dry runs |
| `crates/avendb/src/engine.rs`, `engine/vaults.rs` | `run(op)`: every read, ask and change as one JSON op, and approval |
| `crates/avendb/src/world.rs`, `data.rs`, `words.rs` | The world, a vault's database and its history as JSON; the names of the core's words |
| `crates/avendb/src/ops.rs`, `rules.rs` | Record ops, queries, diffs, links and following them; op groups, touches and proofs |
| `crates/avendb/src/lens.rs`, `doc.rs`, `history.rs`, `merge.rs` | Schemas and lenses, the ceiling, Loro items, lines of history, the three-way merge |
| `crates/avendb/src/sealed.rs`, `slice.rs` | Sealed blob v2; selectors, headers and write bodies |
| `crates/avendb/src/recovery.rs` | The master recovery key |
| `crates/avendb-net/src/lib.rs`, `session.rs` | The node, its router and messages |
| `crates/avendb-net/src/run.rs` | `Node::run`: an op on a node, with bytes beside it and the passkey's ceremony |
| `crates/avendb-net/src/holdings.rs`, `blobs.rs` | Holdings, Synced to, the blob pool and gate |
| `crates/avendb-net/src/statements.rs` | Signed holdings: signing, keeping, passing on and shelving statements |
| `crates/avendb-net/src/shelf.rs`, `edits.rs` | The shelf, and edits on it |
| `crates/avendb-net/src/disk.rs`, `bucket.rs` | The folder shelf and the bucket shelf |
| `crates/avendb-net/src/files.rs` | Bringing, reading and keeping files |
| `crates/avendb-server` | The server's binary, its relay and its feed |
| `crates/avendb-browser` | A device in a web page, as WebAssembly, `PageDevice.run`, and its OPFS worker |
| `crates/avendb-device` | The same device, native beside the desktop app, and its calls in lines of JSON; the agents' devices (`agent.rs`) and the drives' it hosts (`drive.rs`) |
| `spec/` | The Lean model, vectors and protocol models |
| `src/lib/avendb/` | The app's avenDB pages, which run every op through `ops.js` and `native.js` |
| `src/routes/app/avendb/` | The avenDB page, `/app/avendb/`, and the sign-in sheet's page |
| `src/routes/docs/avendb/` | The public architecture page |
