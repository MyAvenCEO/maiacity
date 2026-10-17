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
3. [Identity: vaults, owners, devices and shares](#3-identity-vaults-owners-devices-and-shares)
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
| Vault | An identity, like a smart account: a person's (human), a group's (coop), a person's one AI identity (aven), or the keys of one agent or of the server (device vault). It owns entries. |
| Owner | A signer or a vault that owns a vault: it approves the vault's governance and acts for it. |
| Device | A key in a human or device vault. It signs for its vault with all its rights, and governs nothing. |
| Agent | A device vault an aven owns, whose device is one agent harness's key, as agentClaude. It holds sub caps. |
| Seed | The vaults a claim of the server founds: Maia Holding GmbH, avenCEO GmbH, avenCEO server and Maia City. |
| Entry | One item of data in one vault: a Loro document with a type and tags. |
| Edit | One signed change. Its id is the BLAKE3 hash of its bytes. Seven kinds. |
| Log | The edits of one vault, one share, one audience or one entry. Each edit builds on its log's frontier. |
| Share | Who may do what on which entries of a vault: who, level, what. |
| Sub cap | A share that rests on another: no stronger, no wider, and ended with it. |
| Request | An access request: a record of the `request` schema, shared with the vault asked, which writes its answer in it. |
| Proposal | A line of an entry's history beside its main line, started from any version, which a merge brings into another. |
| Accept | A write of an entry's vault on one of its proposals that changes nothing: the vault accepts it as it stands, so anyone else may merge it into main. |
| Review | A vault's answer to a proposal, accepted, declined or revise: a record of the `review` schema in the vault. |
| Code entry | A recipe, a view, a logic or a function: code as an entry, its source, its engine, a manifest of the names it uses and its params. |
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
  Governance needs the vault's approval and the newcomer's consent (T2). Every vault keeps to its row of the kind table,
  so an aven has one owner, a human vault, and a person one aven (T21). Shares never grant more than the shares they
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

## 3. Identity: vaults, owners, devices and shares

Who may do what in avenDB is made of four primitives, and nothing else. Each is defined once in the Lean model,
mirrored in the Rust core and read by the page, so no layer adds a rule of its own.

| Primitive | What it is | It answers | In the code |
|---|---|---|---|
| Vault | An identity of one kind (below). Its id is the id of its genesis edit. | Who | `policy::Vault`, `policy::Kind` |
| Owns | A parent owns a child vault. The child's owners approve its governance and act for it. | Who decides | `Vault::owners`, `Sharing::Owner` |
| Device | A key that signs for one vault. It acts with all its vault's rights, and governs nothing. | Who signs | `Vault::devices`, `Sharing::Device` |
| Share | `{name, where, ops}` (section 8) over a slice of a vault, to a grantee, resting on a parent share or on none | Who may do what | `policy::Share`, section 5 |

On the wire, an owner and a device are shares of their own sub-kinds (section 5), so the three parts of section 1 still
hold. Their rules differ from a grant's, so this section treats them as primitives of their own.

Two facts follow from the four. avenDB stores neither: every device works them out the same way.

- **The acting chain.** A device acts for its vault, and through owners for each vault they own, up to a passkey at the
  top. Every edit shows that chain (Who stands behind an edit, below).
- **The effective right.** What a vault may do through a chain of shares is the intersection of every share of the
  chain (C1). Revoking a share ends every share that rests on it, so a right taken back above is taken back below too.

### The kind table

A vault is of one of four kinds (T21, `policy::Kind`). One table, defined once, says what each kind may be
(`Kind::rules`; `Kind.rules` in `spec/AvenDB/Basic.lean`): who may own it, how many owners it takes, whether it holds
devices, and how many of the kind one owner may own.

| Kind | Owned by | Owners | Holds devices | One owner may own | For example |
|---|---|---|---|---|---|
| Human | Signers: the person's passkeys and the master recovery key | Any, by threshold | Yes: the person's desktops, phones, browsers and drives | Any number | Samuel |
| Coop | Human and coop vaults | Any, by threshold | No: it acts through its owners | Any number | Maia Holding GmbH, avenCEO GmbH, Maia City |
| Aven | One human vault | Exactly one | No | One: one aven per human | avenSamuel |
| Device vault | One human, coop or aven vault | Exactly one | Yes: the keys of one agent's harness, of the server or of a studio worker | Any number | agentClaude, agentCodex, avenCEO server, a studio's Render Mac |

The owner rules, the device rules and the one-aven limit read this table, and nothing checks a kind anywhere else. The
engine answers it to the page as it answers the built-in groups (the `kinds` op, and `kinds` in the world), so the page
reads each kind's rules from the device and never decides them. A change to a kind is a change to one row, and the
vectors hold Lean and Rust to the same rows (`the_kind_table_is_the_models`). An edit that breaks the table is refused:
an owner of a kind the row doesn't name (`WrongOwnerKind`), a second owner of an aven or a device vault (`OneOwner`), a
second aven of one human vault (`SecondAven`), a device of a coop or an aven (`NoDevices`), and a root of any vault but
a human one (`NotHuman`).

Three things follow from the table:

- Only a human vault has a root, a passkey, so every chain of owners ends in a person.
- A device vault owns nothing and governs nothing: no row names it as an owner, and its devices approve nothing. It
  holds only the shares its owner gives it or passes on to it.
- An aven holds no devices. Its person's own devices act for it through their human vault. Its agents act for
  themselves, each as a device vault the aven owns, with the shares the aven passes on to them (Your aven and its
  agents, below).

An aven has one owner because it is its person's one AI identity: coops hire it by sharing with it, and only that
person decides what it passes on, and to which agent.

### Owners: approval and governance

**Approval.** A vault approves a change through its root alone, or through its threshold of owners. The root passkey
of a human vault approves anything on its own, wins every clash, and is the only one that hands the root on. An owner
that is a vault approves as that vault does, so the person's passkey approves for each vault their human vault owns,
down the chain: an agent's device added to a device vault under their aven takes one prompt.

**Governance** is the vault's settings (threshold, root) and the sharing or revoking of an owner or a device. It needs
the vault's approval plus the newcomer's consent, except that an owner or a device may leave on its own (T2). Devices
never govern: a device of a human vault or of a device vault acts for it and approves nothing. So a change that needs
approval is drafted on a device and signed by the person's passkey in one ceremony (sections 8 and 11).

**Acting through owners.** A coop and an aven have no devices, so a person acts for them from a device of their own
vault. Every edit that acts for a vault names the chain of owners it goes through (`via`): from an owner of the vault
down to the vault the author's device belongs to, each an owner of the one before. The rules check that chain alone
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
itself. An agent's chain shows the same: the passkey that added its device, cosigned by the device, and the aven that
owns its device vault; a studio worker's, its own device vault and the vault whose media it works on, which owns it.
The `history`, `note` and `log` ops carry it as `chain`, and the page shows it under each edit.

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

### Devices

A device is one key in one vault: it signs for that vault, acts with all its rights, and approves nothing (T2). Only
human and device vaults hold devices. A human vault's devices are its person's installs: each browser on maia.city,
the desktop app and each drive (below; device keys in section 11). A device vault's devices are the keys of one
agent's harness, of the server or of a studio worker (below). Whatever acts for a coop or an aven signs on a device of
a human vault, through owners.

**One passkey, one human vault.** A device that founds asks the server first, with the passkey's pass, for the vault
that passkey roots (`Node::rejoin_by_pass`, the same card as linking). If the server knows one, the device joins it
in the same ceremony and founds nothing: a person who sets up avenDB on a second device with the same passkey, as a
Mac and a phone that share it, gets one vault, the one that owns their seed.

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

**A studio worker.** A machine that works on a vault's media for the studio's jobs, rendering a film or making a proxy,
is a device vault of its own, owned by the vault whose media it works on: the person's own vault, or a coop they own or
co-own, such as Maia City (`crates/avendb-device/src/worker.rs`). It has a key of its own and only the shares that vault
gives it, so every task it claims and every entry it makes is signed by its own key, and its acting chain shows which
machine made it, for which vault. It never acts with the Mac's own rights. The desktop app adds one by the flow below
(`addWorker [vault, name, shares]`, section 8), in one ceremony of the passkey at most: a device vault under the vault,
named after the worker, and a new key the app makes added to it; or, where the vault has a worker of that name already,
as on the person's other Mac, the new key added to that one. Then the vault gives it each share, `{name, where, ops}`
as every share is written (section 8): the studio composes its own Worker group, and avenDB has no built-in group for
it. A share over the vault itself the vault issues, resting on none; one over another vault, named by `over` beside it,
rests on a share the vault holds there, by the one rule below, as the worker is a vault it owns; one above what the
vault holds is refused before any ceremony, and a worker shares nothing on. The Mac hosts it as it hosts a drive: its
key is kept on the Mac's shelf wrapped under a key the Mac's device alone derives from its own (`workers/<device>`), so
the Mac opens it silently whenever its own device opens, and it goes with that shelf when the Mac forgets its device;
its node runs beside the Mac's own, on a shelf in a folder beside the app's (`<app folder>-workers/<device>`), a light
copy: it keeps what it makes, and reads every other file from the Mac's store or over the network, as its shares let
it. The studio runs an op as the worker by naming its device (`run [op, node]`), and its own Rust takes the worker's
node (`Host::node_of`) to read a file by range and post its jobs by the worker's rights. A worker is taken out like a
lost phone, its device revoked from its device vault, and the Mac hosts it no more.

### Passing a right on

A share rests on a parent share by one rule (`State::share_parent_ok`, section 5): the parent is a live share its
issuer holds over the same vault; the new share is no stronger, and wide only if the parent is; and either the parent
is an Owner share, whose `share` op lets its holder share on with anyone, or the grantee is a vault the issuer owns
directly. A share that rests on none is issued by the vault it is over. Every case is one of these:

| Case | The share | Why it may |
|---|---|---|
| A coop hires an aven | Maia City gives avenSamuel Editor on its articles | The vault it is over issues it, resting on none |
| A person passes a coop's share on to their aven | Samuel's vault passes on a share Maia City gave it | Samuel's vault owns avenSamuel |
| An aven gives an agent a sub cap | avenSamuel passes Maia City's share on to agentClaude, at Editor or less | avenSamuel owns agentClaude |
| A vault backs up to the server | Each vault gives avenCEO server Backup, or Relay, on the whole of it | The vault it is over issues it, resting on none |
| An Owner of a slice shares it on | Whoever holds Owner on the todos tagged garden shares them with Bob | Its parent is an Owner share |

Why an owner may pass on what it holds: it governs the grantee. It added the grantee's devices and can remove them, so
the right goes to no key it can't take back. Why a passed-on share rests on its parent: whoever may revoke the parent
takes back every share below it with one revocation. So a coop that stops hiring an aven ends the shares of all its
agents at once (Lab scenario 27).

### One flow: adding a device vault

Every child that acts by keys of its own is added in the same three steps (`avendb_net::Place`,
`Node::add_device_vault_with`):

1. **Found the device vault** under its parent, or take the one there already. A parent that doesn't exist yet is
   founded first.
2. **Add the device's key.** The edit is sealed to the device's key, and the device signs it too, as it answers claims
   while it belongs to no vault (`Lab::claim`, `Lab::accept_claim`).
3. **Give it shares.** Its parent passes on shares it holds, each resting on its own by the rule above, or a vault gives
   it a share over itself.

The person's passkey signs steps 1 and 2 in one ceremony, as their human vault owns the parent (Approval, above). Step 3
needs no ceremony, as a share below Owner is no governance.

| Case | Parent | Device | Shares | `Place` |
|---|---|---|---|---|
| A person's first agent | Their aven, founded in the same ceremony | The harness's key, such as Claude Code's on their Mac | Sub caps of the aven's shares | `UnderNew` |
| Another agent | Their aven | The harness's key | Sub caps of the aven's shares | `Under` |
| The same harness on their other Mac | The agent's device vault there already | That Mac's harness key | Those the vault holds already | `Vault` |
| The server | avenCEO GmbH, founded with the seed | The server's key | Each vault's Backup or Relay over itself | `Seed` |
| A studio worker | The vault whose media it works on, the person's or a coop such as Maia City | A key the desktop app makes and hosts | That vault's Worker shares over itself, or resting on those it holds | `Under`, or `Vault` on their other Mac |

Nothing in the flow is particular to an agent or the server: `Place::Under` takes any vault the person's vault owns, so
a studio worker goes under the coop whose media it works on the same way, and a coop's drive could too.

### The seed and the server

The server is the device of avenCEO server, a device vault that avenCEO GmbH owns. A new server belongs to no vault.
The first person to found a human vault through it claims it in the same ceremony, by the flow above at `Place::Seed`,
and founds the seed (`world::SEED`), each vault owned by one vault alone:

| Vault | Kind | Owned by |
|---|---|---|
| Maia Holding GmbH | Coop | The person's human vault |
| avenCEO GmbH | Coop | Maia Holding GmbH |
| avenCEO server | Device vault | avenCEO GmbH; the server is its device |
| Maia City | Coop | avenCEO GmbH; the city's content lives here |

So the server acts for avenCEO server on its own, and every edit it makes traces back through avenCEO GmbH and Maia
Holding GmbH to the person's passkey. **The server is read from the seed** (`world::seeder`): a vault is the server's
only if it is the device vault, with a device, at the end of that chain, owned alone by a coop owned alone by a coop
owned alone by a human vault. No kind and no name makes a vault the server, so a coop's drive or an aven's agent, each a
device vault too, passes for none. `ownsServer` is whether the person's vault owns such a vault; for a vault, avenCEO
server is such a vault that the vault gives relay or more on the whole of it (`world::avenceo`). The claim:

1. The device takes the server's card (`Lab::card`). If it names no device vault the server belongs to, nobody has
   claimed the server, and the device asks it for its key to seal to (`Lab::claim_key`).
2. The person's passkey signs, in one ceremony, their human vault's genesis, the edit that adds the device, the seed's
   four geneses, and the edit that adds the server as avenCEO server's device, sealed to that key (`Lab::drafting`,
   `Lab::claim`). The passkey approves for each coop, as the root of the vault that owns it.
3. The server checks that the edit adds itself and seals to its own key, every signature, and the rules, then signs it
   too and keeps it (`Lab::accept_claim`). Its answer lets the device box the device vault's key for it.

After that, nobody can claim it again: whoever founds a vault later finds avenCEO server on the server's card
(`Lab::server_vault_of`). A device of a vault founded before claims a new server the same way (`Node::claim`); one
whose claim the server didn't take adds it to the avenCEO server that claim founded (`Lab::unclaimed_server`). The
founding device writes each seed vault's profile with its name (`world::SEED_NAMES`) as it settles, before the page
opens; the page names a seed that has none the same way.

### Every vault under a person follows their standing grants

A standing grant is "all my vaults, now and later": a wide share on the whole of the person's own vault, to another
vault, below Owner, that every vault founded under the person later gives too. It is stored as nothing new: a share
like any other whose name, sealed in its slice with its ops, is the reserved `avendb:standing:` and its group's name
(`world::STANDING`; the group a share counts in is read from its ops, so the name is free to mark it). The `share` op
with `"standing": true` makes one, and gives the same share on each vault the person owns now; `world::standing` lists
them, the share of the person's vault to avenCEO server among them, Backup or Relay (section 5), whatever its name.

Every vault founded under the person follows them (`engine::follow_standing`, the one helper): each vault `found`
makes, each vault of the seed and each vault the flow below founds, an aven and an agent's device vault among them,
gives each grantee the same share of the whole of itself, issued by itself and resting on none, unless the grantee is
the vault itself or owns it, holds as much there already, or would read a vault of a one-owner kind (an aven or a
device vault, which shares only what its owner passes on; the server's Backup and Relay read nothing, so they reach
those too). An aven's standing grant to its agent follows the same way: once the person's share to the aven reaches
the new vault, the aven passes its own on to the agent's device vault, resting on it, as the one rule says (section 5);
so a coop the person founds after giving their aven and its agent access gives both, the aven's share first. A share
of one vault only stays where it is. `back_up` changes the server's level for all the vaults at once. Revoking a
standing grant (`revoke {share, standing: true}`) revokes it on every vault it reached, each by the cascade, and no
vault founded after follows it. The person's devices are often away, and the server is the one peer that is always
there: so what an aven or an agent writes, an access request among it, reaches the server, and through it whoever it
is for.

### Your aven and its agents

An aven is a person's one AI identity: an aven vault their human vault alone owns, one per human. Coops hire it by
sharing with it. It holds no devices: the person acts as their aven from their own devices, as for any vault they own,
and its agents work for it with the rights it passes on. Each agent is a device vault the aven owns, named after the
agent, with one agent device in it, a key of its own, never a token: Claude Code as agentClaude, Codex as agentCodex,
and likewise Cursor, Grok and our own native aven.

An agent holds sub caps: shares the aven passes on to it, each resting on one the aven holds, no stronger and no wider
(Passing a right on, above). So no agent ever gets more than its aven, and a coop that revokes its share to the aven
ends every agent's share resting on it. An agent given Suggester over a vault gets a second sub cap there beside it, a
group of its own, "AIP author" (`create` and `set`, on `{"type": ["aip"]}` alone), resting on one the aven holds that
gives as much, so that it opens AIPs over its own proposal lines and promotes them as their author, while the vault
alone reviews them (section 8, "AIPs"); a new entry it proposes is a draft, on a line of its own that the vault's
acceptance lands (section 8, "Drafts"). Each harness signs by its own key with no more than its aven gives it, and one
is taken out by removing its device or revoking its shares, leaving the others. The same harness on the person's second
Mac is a second device of the same agent's device vault. A harness never names or picks an aven: the person's one aven
is the parent, and the agent is added under it, the aven founded with the person's first agent.

`avendb-device agent <harness>` (`crates/avendb-device/src/agent.rs`) runs an agent device as the harness's MCP server
on its stdin and stdout, in a folder beside the desktop app's that the app never clears
(`<app folder>-agents/<device>`). It keeps its secret on its shelf, as the server does (`server::open_agent`), and its
iroh key derives from it. It acts as its device vault, its shares deciding. It keeps no file whole of its own accord and
reads its person's files from their desktop's one store, so nothing is kept twice. It saves a file of the desktop as
every device does (`put_file`, or a `create` with a `file`, the file named by its path beside the op): an Editor share
creates its entry, a Suggester's or a Viewer's doesn't. It seals the file onto its own shelf, and lets go of it once the
desktop app's device, the one whose key is the endpoint of the offer the app leaves it, holds it whole by that device's
holdings (`Node::holds_whole`, `Node::let_go`): a read of it then fetches it from there. Where the desktop keeps a light
copy, the agent's copy is the one. It reads a file back with `get_file`, its own op beside the engine's and the mirror
of `put_file` (the MCP tool `avendb_read_file`): the file named by its entry, or by its vault and name, read as the
page's Library reads it (`read_file`, a window at a time, from its own shelf or else from the desktop's store), only
where its shares let it read the entry, and written to the path beside the op, never over a file there unless
`overwrite` says so; a text file of at most 64 KiB comes back inline too. It captures a spark with `avendb_add_spark`,
its text, title and tags alone (a link or a media file goes in as an artifact of its own): the `create` the page's
Sparks run, run as any change of its, into its person's own vault unless it names another, where its shares let it
create; where they don't, it says which vaults they let it. A reset clears its folder as the app's, and it asks to join
again.

Each session of a harness starts its own `avendb-device agent`, yet one device is one node, one shelf and one iroh
endpoint, never two of the same key at once. So of an agent's sessions on a desktop, one runs its device: the one that
holds its lock file (`<app folder>-agents/<device>.lock`), which answers the others on its Unix socket beside it
(`<device>.sock`); each of the others relays its harness's lines to it, keeping those not answered yet. When it goes
away, one of the others takes the lock and its place, and asks it again whatever was left unanswered. A session's first
line to it says its build (when its program was made): one of a newer build, as after the desktop app was rebuilt,
takes over at once, and the older answers its harness through it from then on. It writes that it runs to a file of its
device's own (`<device-name>.<key>.alive`), so another device of the agent, as an older build's after a reset, never
stands in for it. While it belongs to no vault it asks the desktop's device for what it may hold, so a join it missed,
as one made while it didn't run, still reaches it.

### Asking for access

An access request is a record, not a message of its own, so it needs no fifth primitive: it is a record and two shares.

- **The ask.** The vault that asks writes a record of the built-in `request` schema in its own vault (`ask {to, asks,
  level, why, vaults}`, section 8): the vault asked (`to`), what it asks for (`asks`: a share, `"share"`, at a level,
  Viewer, Suggester or Editor; to co-own the vault asked, `"owner"`; or, an invitation, for the vault asked to co-own
  the one asking, `"invite"`, both at Owner), why, in 500 characters, and the vaults it names, if any. It shares that
  one record with the vault asked, in a group of its own, `Answer` (`world::answering`): read, and set `answer` to
  `"granted"` or `"denied"`, and `part`, on the main line, and nothing else. A write through it that changes anything
  else counts for no reader (C3, Lab scenario 28).
- **Delivery.** Sync carries the record as any other, over avenDB's own ALPN: straight to the devices that act for the
  asked vault, through the relay where it must, or from any peer that keeps the asking vault, as avenCEO server does
  while it backs that vault up. The answer comes back the same way. The server is one such peer, not a mailbox.
- **The answer.** The `requests` op lists the requests a vault the device acts for was asked and hasn't answered
  (`asked`), and those such a vault made (`made`). Approving is the `share` the vault asked gives, then `set
  ["answer"]` to `"granted"`, acting as it; denying is the set alone, to `"denied"`.
- **An owner add.** Adding an owner takes the vault's approval and the newcomer's consent (T2), so two people's
  passkeys sign one edit, one after the other, and the request carries it between them. Granting a request to co-own,
  or accepting an invitation, is a `share` of Owner to the newcomer that names the request (`request`): the passkey of
  the vault asked signs its part of the edit that adds the owner (`Lab::part`), which the device writes into the
  request (`part`, the signed edit's wire bytes in base64url, with the signatures so far) with `"granted"`. Once that
  syncs back, the vault that asked finishes it with the same op: its passkey signs the rest of a part that adds exactly
  the owner the request names and waits on that passkey alone (`Lab::finish`), and the edit is kept. The rules check it
  as every owner add, so a request adds nobody by itself. The `requests` op says of each such request whether it holds
  a part and whether the owner is added (`done`); the consent screen shows the finish as the asker's next step.

An agent device that is no vault's device yet can write no record, so its first request is a file it leaves for the
desktop app (`<device>.request`): who asks, by its device's name and key, a level, why, the vaults it names, if any, and
its offer. Once it is a device of its device vault, its MCP tool `avendb_request_access` asks for more as any vault
does, a request its device vault writes to the aven over it, and leaves no file. So a file from a device the desktop
already sees in a vault was left before its join reached it: the desktop takes it away rather than show it.

The page shows both kinds on its one consent screen, and the person picks all their vaults or only some, a level each,
and approves or denies; "All my vaults, now and later" gives a standing grant (above), to the aven and from the aven
to the agent, so a vault founded later gives both too. If their vault owns no aven yet, they name the one it founds.
The same screen, in the same card, asks a person to approve a request to co-own, to accept an invitation, to finish
an owner add, and, on a new browser opened on a device's link, to let that browser join their vault: its offer stays
how it reaches the vault, and Approve is the passkey's one touch that unlocks it and adds it. Approving an agent's file
(`grant
[name, device, shares, avenName]`) adds the agent by the flow above, in one ceremony at most: the aven, founded and
named if it is new, the agent's device vault under it, named after the agent, founded if it is new, and the edit that
adds the device, which the device signs too; for the same harness on their other Mac, only that edit, to the agent's
device vault there already. Then for each vault picked the aven passes a share at its level on to the agent's device
vault, acting as the aven, with no ceremony: over a vault their vault is or owns, resting on a share that vault gives
the aven first where it holds none at that level; over a coop that hired the aven, on the coop's share, and a share
above it is refused before any ceremony. `grant` needs no file for an agent whose device is in its device vault already;
the page then writes the record's answer acting as the aven. A no to a file is left for the agent (`<device>.denied`),
which asks no more until it asks again; a no to a record is its answer. A share covers one vault: a share of the
person's own vault reaches none of the vaults it owns, so "all my vaults" is a share of each, and "now and later" a
standing grant that each vault founded later follows.

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
on to their aven, and an aven passes its shares on to its agents' device vaults (section 3, Passing a right on; Lab
scenario 27). A chain selects the AND of its selectors, and allows only what every share of it allows (C1), and revoking
a share ends every share resting on it. A share with no parent is issued by the vault it is over, or is a keep share. No
owner share is wide (below), so a wide share rests on none, or on a wide share passed on to a vault its issuer owns.

### Owners and devices are shares

A vault's owners and devices are rows in one list of shares, beside its grants and keep shares (the `shares` op,
section 8). The page shows them under Owners and devices, and on its one Sharing page who has the vault: each vault it
is shared with, and Everyone where it is public. Owners and devices also shows the vaults a vault owns, in one view for
every parent: each vault wholly its own, an aven or a device vault, with its devices and the shares it holds, and the
coops it owns in one line. So the person's vault shows their aven and its agents, an aven its agents, and avenCEO GmbH
its server (`src/lib/avendb/Owned.svelte`).

- An **owner** is "Owner on Everything": a co-owner who approves governance. On the wire it is `Sharing::Owner`.
- A **device** "acts for" the vault. On the wire it is `Sharing::Device`.
- `Revoke` ends any row: `Revoking::Grant`, `Revoking::Owner` or `Revoking::Device`.

Each keeps the rules it needs. An owner needs the vault's approval and the newcomer's consent, and a signer owner of a
human vault brings the key that keys are sealed to, and an aven or a device vault takes no second owner (OneOwner). A
device needs the vault's approval and signs too; coops and avens have none (NoDevices). Owners and devices leave on
their own. Their edits go to the vault log, which carries governance alone.

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
the two with the `back_up` op, for their vault and the vaults it acts for at once (`world::server_level`). Every vault
founded under a person gives avenCEO server the same level as the person's vault has: it is one of the person's
standing grants (`engine::follow_standing`, section 3). Each of these shares is issued by the vault it is over and
rests on none.

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
  knows (T15). So once it has seen a removal, the removed can't open what it writes. No peer checks a write's epoch:
  an audience moves on by edits of other entries too, which a device the entry is shared with later never receives
  (T12), so it takes the epoch the write names. A write under an epoch its audience hasn't reached opens for nobody
  until the audience does.
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
| Draft | A new entry's creation on a line of its own, its main line empty until the vault lands it (section 8) |
| Merge | A write on the target that builds on both lines' heads: the union of both histories (T10g), reading as the three-way merge of both lines from their base (T10h) |
| Accept | A write of the entry's vault on a proposal that builds on its heads and changes nothing: the vault accepts the proposal as it stands (section 8) |
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
allows what it touched; a merge into main through a share, only on top of the vault's accept (section 8, M2); and a
write on main of a draft its vault hasn't landed, only where it is the vault's own (section 8, "Drafts", D1). A
write that doesn't count stays in the log, sealed, and shows on no line, nor does anything built on it. So an app
patched to skip the checks writes nothing anyone reads.

## 8. One API: run(op), op groups and fit

### One entry point

Every read and every change of avenDB is one JSON op, whatever the schema, through one entry point, `run(op)`, the
same on every device. The page keeps no rule: it reads levels, ops and who may do what from the device's answers,
asks `may` before it shows a button, and words what comes back.

- **On a Lab.** `engine::run(lab, me, op)` (`crates/avendb/src/engine.rs`, `engine/vaults.rs`) runs an op on a
  device's state: a read on what the device holds, an ask as a dry run that checks, proves and refuses as a change
  would and makes nothing (`Lab::dry`), and a change as signed edits.
- **On a node.** `Node::run(op, bytes, authenticator)` (`crates/avendb-net/src/run.rs`) runs it on a node, and does
  what a Lab alone can't: `world` adds where each entry and file is synced to, `read_file`, `put_file` and a `create`
  with a `file` (`engine::brings`) carry the file's bytes beside the op, `jobs` tells its background work, a change the
  vault's owners approve has the passkey sign it in a ceremony, every change is told to the device's peers, and `follow`
  asks every peer again at once.

Every caller goes through `Node::run`:

| Caller | How it calls |
|---|---|
| A browser | `PageDevice.run(op, ceremony?, read?)`, WebAssembly (`crates/avendb-browser`). `ceremony(challenge, step)` runs the passkey's prompt; `read(at, n)` hands `put_file`, or a `create` with a `file`, its bytes a megabyte at a time; `read_file`'s bytes come back as `bytes`, a `Uint8Array`. |
| The desktop app | The same device, native, beside the app (`crates/avendb-device`), in lines of JSON: `run [op]`, with `read_file`'s `bytes` in base64; `fileStart [op]`, `fileChunk [n, at, base64]` in order, `fileAgain [n]` for the second pass, `fileEnd [n]` and `fileDrop [n]` for `put_file` and a `create` with a `file`; `agents` (the access requests), `grant [name, device, shares, avenName]`, `deny [name, device]` and `agentCommand [harness?]` for the agent devices on the desktop; `drives`, `joinDrive [path, name]`, `openDrive [path]` and `ejectDrive [path]` for the drives plugged into it; `addWorker [vault, name, shares]` (each share `{name, where, ops}`, and `over` for one over another vault) and `workers` for the studio workers it hosts, and `run [op, node]`, an op run on the worker whose device `node` names, as that worker (section 3). Its ceremonies run in the app's sign-in sheet (section 11). |
| The desktop app, in its own process | The same device hosted in the app's process in place of the sidecar (`avendb_device::host`), on one code path with it: the same calls through `Host::call(call, args)`, each answering `{"ok"}` or `{"error"}` as its line would with no id; each sheet to show on its `Lines`, answered by `Host::answer`; and `Host::node()`, the open device's node, for the app's own Rust to `read_file` by range and post `jobs()` with no JSON or base64; `Host::node_of(device)` the same of a studio worker it hosts, by that worker's own key and shares, never the desktop's. |
| A studio worker on the desktop | Its own node, hosted by the desktop app beside its own (section 3): `run [op, node]` through the app's lines, or `Host::node_of(device)` in its process, each acting for its device vault, whose shares decide. It has no passkey, so a change the owners approve answers `approve`. |
| An agent harness on the desktop | Its agent device, as its MCP server (`avendb-device agent <harness>`, section 3): `avendb_vaults`, `avendb_ask` for a read, `avendb_run` for a change, `put_file` and a `create` with a `file` too with the absolute `path` of a file on the desktop beside the op, and its own `get_file {entry}` or `{vault, name}`, which reads a file back through `read_file` to the `path` beside the op (never over a file there unless `overwrite`), each acting for its device vault, whose shares decide; `avendb_add_spark` for a spark, the page's `create`; `avendb_add_artifact` for an artifact, a link or a file of the desktop saved by `put_file` first, put on a spark's canvas where it names one; and `avendb_read_file` for `get_file`; and `avendb_request_access` for more. It has no passkey, so a change the owners approve answers `approve`. |
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
| `aips` | `vault` | Every AIP the device holds, of `vault` alone if it names one, and every open proposal no AIP names, as a bare idea (below, "AIPs") |
| `aip` | `entry` | One AIP as `aips` lists it, and each line with its `diff`, derived from its entry's schema |
| `requests` | none | The access requests the device knows (section 3): `{asked, made}`, those still unanswered that a vault it acts for is asked, and those a vault it acts for made, each `{entry, from, to, asks, level, why, vaults, answer, part, created}`, `part` whether the vault asked signed its part of an owner add, and for one `done`, whether the owner is added |

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

**Entries.** `create {vault, type, tags, schema, value, draft, file, as}`, where `file` is `{len, name, media}` and
the file's bytes come beside the op, as `put_file`'s do: the entry and its file are one signed edit, its creation's
write brings it (`Lab::create_bringing`), alone, never in a batch, and it answers `{"entry", "root", "size"}`; a schema
or a lens brings none. The record ops `set`, `unset`, `insert`, `remove`,
`move` `{entry, line, schema, path, value, at, to, as}`; `tag {entry, add, remove, as}`; `propose`;
`merge {entry, from, into, take, as}`, `take` the conflicts where the target takes the other line's value, each
`{at: path, what: value | row | order}`, as `note` lists a proposal's `conflicts`; `review {entry, line, verdict,
text, as}`, the vault's answer to a proposal (below, "Merges by policy"); the AIP ops `aip_open {vault, title, note,
proposals, tags, as}`, `aip_promote {entry, as}`, `aip_withdraw {entry, why, as}` and `aip_review {entry, verdict, text,
as}` (below, "AIPs"); `restore`, `undo`, `variant`; and `batch {ops, as}`, whose record ops in a row on one entry's
line make one write. A schema or a lens is created as an entry of its type (section 9).

**Vaults.** Each runs alone, never in a batch, and `may` covers each:

| Op | What it makes | Approval |
|---|---|---|
| `share {over, who, level, what, as}` | `who` is `{"vault": id}`, `"everyone"`, `{"signer": id}` or `{"device": id}`; `level` a built-in group's name, a group of its own `{name, ops}`, a keep level, or `"actsFor"`; `what` is `"everything"` or a `where` of labels. Owner on everything to a vault or a signer adds a co-owner (`Sharing::Owner`), `actsFor` a device (`Sharing::Device`), a keep level a keep share, anything else a grant (`Sharing::Grant`) resting, where the acting vault isn't the vault itself, on a share it holds that the one rule lets it rest on (section 5, `world::parent`): an owner share first, or, to a vault it owns, one at that level or more. `"standing": true` makes a standing grant, all of the acting vault's own vaults now and later (section 3): a grant on everything, below Owner, to a vault, given on each vault it owns now and followed by each founded later. With `request`, Owner on everything to a vault is the owner add that request asks for, signed in part as the vault asked grants it (`{"entry", "part"}`) and finished by the vault that asked (`{"edit"}`), section 3. `{"edit"}` or `{"share"}` | Owners, devices, Owner grants |
| `keep {over, mode, what, device, as}` | A keep share to one of the acting vault's devices, this one unless named; `mode` is `"whole"`, `"opened"` or `"never"`. `{"share"}` | Never |
| `copy {device, full}` | The copy setting of one of the person's devices, this one unless named: a wide keep share their vault issues over itself, Whole when `full`, else Opened; the device's other copy shares are revoked. `{"share"}` | Never |
| `revoke {share, as}`, `{vault, owner}` or `{vault, device}` | `Revoking::Grant`, `Owner` or `Device`. A keep share is revoked acting as its issuer. `{"edit"}`; with `"standing": true`, a standing grant on every vault it reached, `{"edits"}` | Owner shares, owners, devices; not a device leaving |
| `settings {vault, threshold}` or `{vault, root}` | A threshold, or handing the root on. `{"edit"}` | Always |
| `found {vaults: [{kind, name}]}` or `{kind, name}` | New vaults the person's vault founds and owns, in one ceremony, each of a kind by its name in the kind table (coops, one aven, device vaults); then the person's standing grants, avenCEO server's share among them, and a profile on each. `{"vaults"}` | Always |
| `put_file {vault, name, media, tags, len, as}` | The bytes sealed into the store as they come, then an entry of type `file` that brings them (section 13). `{"entry", "root", "size"}`. With `entry` in place of `vault` and `tags`, `put_file {entry, name, media, len, as}` brings them into that entry instead, landed on its main line, by one write there (`Lab::bring_into`), as a new default of a recipe's source. `{"entry", "edit", "root", "size"}` | Never |
| `ask {to, asks, level, why, vaults, as}` | An access request (section 3): a `request` record in the acting vault, asking vault `to` for `level` (Viewer, Suggester or Editor) and why, in 500 characters, and the vault ids in `vaults`, if any; or, `asks` `"owner"`, to co-own `to`, or `"invite"`, for `to` to co-own the acting vault, at Owner, as the kind table lets it; and the `Answer` share of that one record to `to`. `{"entry", "share"}` | Never |
| `back_up {on}` | avenCEO server's share on the person's vault and the vaults it acts for: Backup, or Relay alone. `{"changed"}` | Never |
| `mark {entry}` | The steward's mark of the entry, now. `{"edit"}`, `null` where the marks are right already | Never |
| `card {name}`, `profile {vault, name}` | The device's card in its person's vault; a vault's profile. `{"wrote"}` | Never |
| `follow {vault, on}` | The vaults the device follows (section 12), kept in its shelf's meta. `{"follow"}` | Never |
| `set_limits {depth}` | The most rows and links down the device's queries read, 1 to 256, kept in its shelf's meta. Its `limits` | Never |

**Who may.** `share` and `revoke` through a share need the `share` op in the chain the acting vault holds. `put_file`
and a schema's creation are creations, under the `create` and `set` ops, and a create's file comes with its creation.
`put_file` into an entry is a `set` of its whole record, so a Suggester's empty write, which every reader counts, never
gives an entry a file (`Lab::line_files`). `read_file` needs read reach (T27). `mark`,
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
Op      = {"op": "relay" | "backup" | "read" | "propose" | "share"}
        | {"op": "create", "on": On?}
        | {"op": "set", "path": Pattern, "to": [v]?, "on": On?}
        | {"op": "insert" | "remove" | "move", "path": Pattern?, "on": On?}
        | {"op": "tag", "tags": [tag]?}
        | {"op": "merge", "on": On?, "path": Pattern?}
Pattern = a path whose steps may be "*", at any depth; [] is the whole record
On      = "main" | "proposals"
```

A pattern names places at any depth, as a path does: `["nodes", "*", "kids", "*", "text"]` is the text of any row of
the kids of any node. An op on a row covers everything under it, its fields and its lists of rows at any depth. The
page's Share dialog offers each field of the newest schema at any depth, in words ("the text of any row of the kids of
any row of its nodes"), and each list of records to add, delete or reorder rows of.

**Merges by path.** A merge op may name a path: then it merges a line only where all that line changed since the base
lies under it. A Tuner that may merge `["params", "*", "default"]` into main merges a proposal that only tunes the
defaults of a code entry's params, and not one that also changes its source. Readers read a merge's touches as before,
and also each place the writes it brings in changed since the base (`Touch::Merged`, read off the touches each of
those writes was counted with, the whole record where they couldn't read them); a merge op on the write's line whose
path reaches that place allows it (M1). A merge op with no path merges anything, as before. In a sealed grant a merge
op with no path keeps its bytes, and one with a path is a new kind of op (`encode.rs`), so every grant made before
reads as it did; an app built before reads a grant that names a merge path as one it can't open. The page's Share
dialog offers "may merge changes to one field".

The level is the class of the strongest op (`rules::level_of`): relay, backup, read, write (any op that writes) or
owner (`share`). A keep share has no ops. The built-in groups (`rules::groups`):

| Group | Ops | Level |
|---|---|---|
| Owner | Everything, and share on | Owner |
| Editor | Read, create (on either line, so it drafts too), set, any tag, propose, merge | Write |
| Suggester | Read, create on proposals (drafts alone), set on proposals, propose, merge on proposals | Write |
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

**Proof-carrying writes.** A write through a share carries in its encrypted body a proof (`rules::Proof`): the share it
relies on, and the ops and salt of each share of its chain. Readers check them against each share's commitment and
level. They read the write's **touches** off its Loro ops, imported on the version it builds on
(`doc::Item::footprint`): each place set, row added, removed or moved, the creation, a proposal started, a merge and
each place the line it brings in changed, a tag asked. A chain allows a write when every share of it allows every touch.
A device refuses to make a write its chain doesn't allow (NotAllowed), as its readers wouldn't count it.

- **C1** chains narrow: a chain allows nothing one of its shares forbids.
- **C2** readers agree: whether a write counts reads no selector, type or tag.
- **C3** counted writes do what they may.
- **C4** allowed writes count, and nothing built on an uncounted write does.
- **M1** a counted merge brings in only what its merge ops' paths reach.
- **M2** a merge into main through a share counts only on top of the vault's accept; the vault's own merges count as
  any write of its does.

### Merges by policy: accepts and reviews

Who must accept a proposal before anyone but the vault merges it into main is the vault's policy. avenDB counts by
one, every vault's default: **one of the vault's owners**. So the vault answers for itself, and an aven, an agent or
an Editor merges nothing into main alone, however wide its share.

- **The accept** is a write of the entry's vault on the proposal, acting for itself, that builds on the proposal's
  heads and changes nothing, no field and no tag (`policy::is_accept`). It is in the entry's own log, so every reader
  of the entry reads it, offline, and reaches the same verdict, as C2 asks.
- **A merge into main through a share** counts only where it builds on an accept and on nothing else but accepts and
  writes on main (`policy::passes`). So it brings in exactly what the vault accepted: whatever is written on the
  proposal after the accept needs an accept again. A device refuses to make one that wouldn't count (NotAccepted), and
  one a patched app makes all the same counts for no reader, nor anything built on it (the history says why:
  `policy`). A merge into a proposal needs no accept.
- **The vault's own merges** count as every write of the vault does, by what they build on and whether they fit, with
  no accept: the owner's workflow is as it was.
- **A review** is the record people read: `{kind: "review", entry, line, heads, by, verdict, text, at}`, in the vault,
  the verdict `accepted`, `declined` or `revise`, the version it answers (`heads`), who started the proposal (`by`) and,
  for a revision, the words that go back. The `review` op writes it acting for the entry's vault (NoCap for anyone
  else); for `accepted` it writes the accept first, and the review names the version the accept makes. An AIP's
  review (`aip_review`, below) is the same record, of the same schema bytes, written once over all of its lines.
- **A bundle** links proposals on several entries that belong together, an aven's change of a recipe, its view and its
  logic, with the intent that started them. Each proposal is still accepted and merged as its own. An AIP (below)
  takes a bundle's fields and adds what a person reads and answers.
- **A policy** entry declares a policy (`policy`, section 9). Version 1 holds the default alone, `{"needs": {"of":
  "owners", "count": 1}}`, and counting reads no policy entry yet. A richer policy, n of m owners, named groups,
  vetoes, is a new rule the engine and the Lean model learn first, then a new version of the schema; every reader must
  reach it the way it reaches the accepts, from what it holds.

### AIPs: one proposal standard

An **AIP**, an Aven Improvement Proposal, is how every change is put to a vault, whoever writes it, an aven, an agent,
an Editor or a person, and whatever the entries it changes, notes, logic, recipes, any type
(`crates/avendb/src/engine/aips.rs`). It is a record of the shipped schema "AIP, v1" (section 9) in the vault, which
names proposal lines of that vault's entries, of any types, beside the text a person reads: a title and a note, why
and what changes. AIPs are a layer read off what avenDB already holds, proposals, accepts, merges and reviews: no rule
of the edits is new, nothing new is on the wire, and every write counts as any write does.

- **Stages.** `aip_open {vault, title, note, proposals: [{entry, line}], tags}` writes an **idea**, named by a key of
  eight random letters and digits from the device's own randomness, which names it for good; every line must be a
  proposal of an entry of `vault` (BadOp for another vault's: one vault per AIP, so one policy decides it). Games
  find theirs by entry tags (`game:<id>`). `aip_promote {entry}` makes it **proposed**, and gives it a number where it
  has none (BadOp for one with no lines, or one archived). `aip_withdraw {entry, why}` takes it back. Both are its
  author's or its vault's alone (NoCap for anyone else). **Archived** is never typed: it is derived, below.
- **Numbers count per vault.** Promote gives one more than the highest number of the vault's AIPs the device holds,
  and a revised AIP keeps its own. Two devices that promote while apart may give one number twice; once they sync,
  every reader labels them alike, by where the write that set each number stands in the one order every device
  replays edits in (depth, then edit id): the first is `AIP-n`, the others `AIP-n.2`, `AIP-n.3`. An idea has no label.
- **One review over every line.** `aip_review {entry, verdict, text, heads?}` is the vault's answer to a proposed AIP,
  acting for the vault itself (NoCap for anyone else, so an aven or an agent never reviews; BadOp unless it is
  proposed). `accepted` writes, for each line, the vault's accept at its heads, then its merge into main as the vault,
  taking the proposal's side wherever both lines changed one place, then one review, `line` `""`, whose `heads` are
  every accept; `declined` writes the review alone, its heads every line's heads; `revise` writes it, with the words
  that go back, and the AIP is an idea again, keeping its number. Each line still needs its own accept, so nobody but
  the vault merges any of them before the review. `heads`, every line's heads in one list as `aips` lists them, pins
  the answer to the version the person saw: BadOp where a line moved since, so nothing written after a card was drawn
  is accepted unseen; the page always names them, and an answer without them answers the lines as they stand. The
  writes are the device's own, signed as any write is, so no passkey is asked; they are tried dry first, so a review
  that would be refused makes nothing.
- **The outcome is derived**, the same on every reader: **applied** once every line's heads are on main, **rejected**
  once it is withdrawn or its newest review declined it; either way archived. An AIP merged in part is never applied,
  and its lines show which are merged. Its signatures count against the default policy, one owner: the accepted
  reviews that cover every line as it stands (`{have, need: 1, of: "owners"}`); no policy entry is read.
- **What it changes is derived from the schema** (`crates/avendb/src/aip.rs`): each line's record, read through its
  entry's own schema, against main's as the acceptance would merge it (once merged, against the version it started
  from), as parts `{path, label, kind, old, new}`. Rows are matched by their `id`, added, removed, or changed field by
  field at any depth; lists of plain values gain and lose values; Loro text is one `text` part; anything else is a
  `set`. Labels are the schema's titles, else the field's key made readable. Each line's summary reads
  `<schema title or type>: <first change> (+N more)`, values cut to 40 characters. The diff is computed, never typed.
- **Reading them.** `aips` lists every AIP the device holds, with its label, stage, outcome, lines (`{entry, line,
  type, title, name, heads, merged, new, tags, public}`, the last three for drafts, below), reviews newest first,
  signatures and summary; and every open proposal line no AIP names, as a bare idea (`bare: true`), so nothing
  written before AIPs is left out. `aip {entry}` adds each line's diff. The page's HITL queue asks a person only for
  promoted AIPs of the vault they act for, not its own, with no review that covers them as they stand; a card is a
  summary, and the Proposals app shows the whole AIP at `/app/aips/?aip=<entry>`.

**The honest limit.** Each line's merge still counts on its own. One review accepts every line and merges them in one
go, but a reader that holds only some of those merges reads only those: all or none for every reader would need the
merge writes to name their AIP, a change on the wire left for the next reset.

### Drafts: new entries an AIP proposes

A **draft** is a new entry proposed inside an AIP, by whoever may only suggest (`Lab::create_draft`,
`crates/avendb/tests/drafts.rs`, D1 to D3). It is a creation that starts a line of its own: `create` with `"draft":
true` writes the entry's first write on a proposal, `Proposal::New`, with no deps and no stay, and answers `{entry,
line}`, the line named by that write. Its main line holds nothing until the vault lands it. Nothing new is on the wire
but one kind of grant op: an edit's `New` was already a proposal byte.

- **Who may draft.** `{"op": "create", "on": "proposals"}` creates drafts alone, `"on": "main"` plain creations alone,
  and `create` with no `on`, either, so an Editor drafts too. A Suggester's share names `create` on proposals. In a
  sealed grant, `create` with an `on` is grant op kind 13 (`13, on`: 0 main, 1 proposals), and `create` with none keeps
  kind 3 and its bytes, so every grant made before reads as it did; an app built before reads one that names kind 13 as
  a grant it can't open. A share is judged by its whole chain, so a draft counts only where every share of it lets a
  creation on a proposal through (D2). A relay sees `create` and `New` in the clear and judges a draft as an owner
  would: it refuses a creation with a stay, with deps, or on a proposal that already is (`NotFirst`, T25).
- **Only the vault lands it.** A draft has **landed** once its creation is in its main line's counted history
  (`History::landed`, Lean's `landed`): once a write of the vault itself brings that line into main, in practice the
  merge the vault's `aip_review` accepted writes. Until then a write on its main line counts only where its actor is
  the entry's vault, so no share's merge, even on top of the vault's accept, nor a share's write on main, counts for
  any reader (D1). A device refuses to make one (NotLanded); one a patched app makes all the same counts for no reader,
  and the history says why: `landing`. Every reader reaches the same verdict on its own, from the entry's log. A device
  that opens none of the draft, a Backup's, reads it in the clear: landed once a main write that relies on no share
  holds the creation in what it builds on (`Lab::landed`).
- **Until it lands it is no entry of the vault's main line.** It has no main item: `get`, `set`, `tag` and the other
  record ops on main answer NoEntry; `query`, the world, feeds, cards, requests, profiles and the counts of `database`
  and `shares` leave it out. Its stewards leave every share to everyone out of its semantic audience, so no public key
  opens it (D3); once it lands, they mark it into its whole audience, and the AIP line's `public` says beforehand
  whether a share to everyone picks it then, by its type or its tags. Its line works as any proposal's: it is written
  on, named in an AIP, and accepted. `propose` on an unlanded draft starts from the draft line's heads, and refuses
  (BadOp) a `from` that doesn't hold the creation.
- **In an AIP.** A draft's line is `new`: its diff adds every field, and its summary reads `New <what>: <title> (+N
  fields)`. The HITL card shows a "New" badge with its type, and where it goes public on Accept, with its tags.
  Withdrawn or declined, it stays unlanded for good: hidden from main and from everyone, its log kept, and the AIP
  archived as rejected; whoever proposed it may name the same line in a new AIP. A draft no AIP names shows as a bare
  idea.
- **Schemas and lenses are never drafts.** The `create` op refuses one (BadOp), as the device does a write that
  would make one (NotAView), and a draft schema never joins the lane, even once landed: the lane reads only schema
  and lens entries created on main (T17).
- **Shares made before drafts.** A Suggester's share made before drafts lacks `create` on proposals. It still reads as
  a Suggester's (`world::group_of`), and still allows all it did, but drafts nothing (`drafts: false` in the world and
  in `shares`; the page names it "Suggester (before drafts)"). The Mac's agent grant passes its agents' Suggester
  shares on again in the new form, the aven's own first where it lacks the op, each resting on a share that gives all
  its ops (`agent::pass_on`); standing Suggester grants and the vaults that follow them are given again the same way,
  the later grant of one name standing for the earlier. None of this needs a passkey, as these shares are below Owner.
  The old shares aren't revoked, which would rotate keys: they stay, drafting nothing.

A plain creation, on main, counts exactly as it did before drafts: landing reads only drafts, and counting gains one
conjunct, `!(main && !landed) || actor == entry's vault`, which every plain creation meets.

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
Markdown text, its subtitle and cover its opening lines; the story it is written for, by link, its language, an
excerpt and a quote with whose words they are; a German or a shorter one is a variant of it), a **flow** (stages an item can be in, each with whether it is public and where it goes next), a
**function** (a script that runs when an item enters or leaves a stage of a flow), a **post** (a public post of a
stream, about an entry, with the day it first went out where it is one brought in from before avenDB), a device's **card** and a vault's **profile** (each a title, its name), a **file** (its
name and its media type), a **story** (one content piece from its first spark to every platform it goes out on:
its title and format, the sparks it grew from, its journey's beats and its hook variants as rows, its intro,
description and launch; the story flow's tag says which of its stages it is in), an **artifact** (one source fact
standing on its own: what it looks like, a link, a picture, a clip or a YouTube video, where it is from, whose it is
and when, its language and length, the Library files it shows as links, and a video's chapters and transcript as
rows; a Library file is only bytes, an artifact is what they are), a **spark** (anything that might become something:
a scratchpad, an open canvas whose items are rows, each an artifact or a spark it links to or a free text note, with
where it sits and how big it is, beside a document's title and blocks, so a note's page edits it; a story names the
sparks it grows from, and the artifacts on their canvases are its sources), an **artwork** (a story's title card or
thumbnail of one shape, 16:9, 9:16, 1:1, 4:5 or 5:2, in layers as rows, a picture, a cut-out, words or a badge, each
placed in percent of its canvas, its pictures and the card rendered from them Library files by link, the story it
belongs to and the hook it carries; an A/B card is a variant of another), and an access **request** (the vault
asked, what it asks for, a share, to co-own or an invitation, a level, why, the vaults it names and, once given, its
answer: `"granted"` or `"denied"`, and the part of an owner add the vault asked signed, section 3), a **review**, a
**bundle** and a **policy** (section 8, "Merges by policy"), an **AIP** (section 8, "AIPs": its key, number, title,
note as Loro text, intent by link, proposal rows `{id, entry, line}` of any types, `stage` `idea`, `proposed` or
`withdrawn`, the `why` of a withdrawal, where it `was` before, and links as rows `{id, name, url}`), and the **code
entries** below. A note keeps its type, a document; the page lists notes among the sparks, and the world gives a spark's
record beside its title and text (`world::What::Note`). Every shipped schema starts at v1, and a kind that grew ships
its older versions beside the newest and the lenses between them (`lens::blobs::LENSES`), so what was written under an
older one still counts and opens in the newest app: the spark's v1, a document's fields with a look, a link and a mood
board's sparks, reads as v2 with no items on its canvas (`SPARK_LENS`), and the article's v1, a title, a text and tags,
reads as v2 as it was, with no story yet (`ARTICLE_LENS`); the function's v1 reads as v2 with no engine and no manifest
yet (`FUNCTION_LENS`); and the view's v1 reads as v2, an HTML view with no data, no input and no logic of its own
(`VIEW_LENS`); and the story's v1 reads as v2 with no full text yet (`STORY_LENS`).

**Stories and their posts.** There are only stories and the posts drawn from them (2026-10-17). A story is the single
source of truth, its full written text (`text`) the base; each post is one way it goes out, an entry of type `post`
that links its story (`story`), of a post type of its vault: a schema of the vault's own, "Post: <name>, v1", whose
records are of the kind `post:<name>` and which holds the type's own fields and its template (`x-template`, the
Markdown a writer or an agent fills in from the story). The feed reads a post's story as the entry it is `about`.
The lens engine's worked example, a v0 of documents and todos and the lenses from it to v1 (`lens::example`), lives
only in the tests; nothing ships it, and no record is written under it.

**Code entries.** A **recipe** (a 3D asset's code, and its card), a **view** (a screen's) and a **logic** (a game's
rules) share one base (`lens::blobs::code_entry!`): a title, a note and tags; the source as Loro text, at most 200,000
characters; the engine it runs on, `{host: box | logic | view, version, hash}`; a manifest of the names it uses, lists
of `kit`, `presets`, `controls`, `messages`, `slots`, `events`, `hooks`, `ops` and `libs`; its params as rows, `{id,
name, kind: number | integer | toggle | choice | color, range: {min, max, step, options}, default}`; and a contract,
its `budgets` (`bytes`, `ms`, `memory`, `ops`) and `invariants`. A function of v2 adds the engine and the manifest to
v1. A view of v2 adds what a view of the repo's code carries beside its source (`code/views/`): the `data` it shows
and the `input` it takes (objects, `{}` by default), the `height` its frame starts at, in pixels, its `form`, `html` (by
default) or `a2ui`, A2UI's components as JSON, and its own `logic`'s source, a Loro text bounded as its source is, for
the few views that have one. The built-in name `view` names v2, and v1 still ships, so a view written under it counts
and opens in v2 (`VIEW_LENS`). They are records like any other, of the shipped-schema mechanism as it is, written,
proposed, reviewed and merged through `run(op)`; the server serves those everyone may read (below), and nothing in the
app runs them yet. A merge path reaches into them as into any record, so a Tuner merges the defaults of their params
and nothing else.

**What a schema can say** (`lens::Schema`). An object's `properties` and `required`; each property a `const`, an `enum`,
or a `type`: a string (with `maxLength`, counted in characters), an integer or a number (any finite one, each with
`minimum` and `maximum`), a boolean, an object (its own `properties`, `required` and `additionalProperties: false`,
nested to any depth) or an array. An array of `items` is a list of values (with `minItems` and `maxItems`) or of records
(objects with a required integer `id`); one of `prefixItems` is a tuple of so many values, a position `[x, y, z]`. A
list of records may sit in a row of a list of records, at any depth (section 7). `$ref` names a shape of the schema's
own `$defs`; one that names no shape makes it no schema. A shape may hold a list of rows of its own shape, an outline
whose nodes hold nodes: a `$ref` that goes round through a list of records resolves lazily, one row at a time. One that
goes round through plain objects or values would be a value with no end, and makes it no schema. `"x-loro": "text"`
marks free text, which its `maxLength` bounds too, and `default` what a field reads as when it is absent. `"x-link"`
marks a link (section 8): `true` any link, `"newest"` one that follows its entry's newest version, `"pinned"` one pinned
at a version; a property is one link, or an array of them. A field whose value doesn't fit reads as absent, and a record
that lacks a required one doesn't read. Other keywords change nothing.

**A lens reads rows of rows.** A lens's steps reach into the rows of a list of records (`in`), and into the rows of
their lists in turn (`in` inside `in`), so a shape that changes many lists down reads both ways as one at the top
does. A query translates only what it reads: each list of rows deeper than the query reads is emptied as stored
before the lens translates anything, then taken out of what the app reads (`engine`'s `see_within`).

**avenCEO GmbH holds them.** Every app knows avenDB's own schemas by heart, so each vault reads and writes them
offline. Beside that, avenCEO GmbH holds each as an entry of its own, of the very same bytes and so of the same id,
shared with Everyone: the founder's page adds those it lacks once their seed is there. A vault's lane doesn't reach
into another's, so any other vault's records still read through the copies every app ships.

**A newer version needs nothing of an older vault.** Every app reads a vault's entries through its own shipped schemas
and lenses beside the vault's lane (`Lane::with_built_ins`), so a vault founded before a version shipped, holding only
what shipped then, takes records of it at once: `create` naming `view` writes a view of v2 there, and a view of v1
written before opens in v2 and edits on. No schema entry is made on demand. The founder's page adds the new schema and
its lens to avenCEO GmbH as it adds every built-in one it lacks (its `database` lists the app's own beside those the
vault holds), the schema first, so the lens joins two it holds; the page's HITL queue adds the Review schema to a vault
that answers a proposal the same way, for apps that shipped before it. A device whose app is older than the version
counts no write made under it until it updates, as a write counts once its reader holds its schema (below).

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
entries it opens that are public and not deleted, newest first, each with its vault's name and kind, its entry's tags
and `published`, when its record says it was published (an ISO 8601 date or time, passed on as the record holds it, read
from the stored record where the post's schema doesn't name it, `null` where it says none; the order stays by when the
entry was created), as JSON any page may read; the Maia Universe page takes it in and shows each post under the vault
that published it. A post leaves the feed as its article goes back from Published: its function deletes it and takes its
tag off, so no Public share reaches it.

Beside it, every entry everyone may read (`GET avendb.maia.city/feed/entries`, `world::public_entries`), for a page
nobody signed in to and for the API, which hold no device: each entry a Public share reaches whose record isn't deleted,
of whatever kind, as `{"entries": [{entry, vault, name, seed, type, schema, tags, heads, created, record}]}`, by vault,
then kind, then entry, and `?type=story,article` keeps the kinds a page asks for. The code among them, each recipe,
view, logic, function and config (a record of a vault's own schema whose `kind` is `config`, `world::CODE_KINDS`), is at
`GET avendb.maia.city/feed/code`, as `{"code": [...]}`. A row's `record` is its main line as every reader counts it,
through the newest schema of its kind in its vault's lane (`schema`, in hex), each field it leaves out at its default,
Loro texts as plain text, and `heads` that version's heads, so a loader pins it; its `type` is its record's kind, its
`tags` its entry's tags, its `name` its vault's profile where everyone may read it. An entry whose record names no kind
a schema of its vault reads, a schema's or a lens's, is in none. Each row lists `files`, `[{root, size, len}]` oldest
first: the files its main line brings that every reader counts as the entry's (`Lab::line_files`), those of its
creation and of writes by its vault or by a share that may set its whole record, that the server opens, each its root
in hex, its sealed size and its length. Anyone may found a vault and call it Maia City, so
`seed` names a row's vault only where it stands in the server's seed (`world::seed_of`, `SEED_NAMES`), `null` for every
other, and `?seed=1` keeps Maia City's alone, the coop avenCEO GmbH owns alone, none while the server knows no such
coop: it knows it once Maia City gives avenCEO server backup or relay, as every vault founded under a person does by
their server setting. `?vault=<64 hex>` keeps one vault's and `?bare=1` leaves the records out, a listing for when they
grow big. `GET avendb.maia.city/feed/entry/<vault>/<entry>` serves any one of those rows on its own, and
`{"error": ...}`, not found, for an entry that isn't public, that is deleted or that the server doesn't hold.
`GET avendb.maia.city/feed/entry/<vault>/<entry>/file` serves the newest of a code row's `files` whole, a recipe's
source, say, up to 32 MiB (`LARGEST`), as `text/plain; charset=utf-8` with `X-Content-Type-Options: nosniff`, so no
page runs it as a script; not found, as text, for any other entry, or one that brings no file. The three take the same
`?vault=`, `?seed=1` and `?bare=1`, the file's `?vault=` and `?seed=1`; the server works the whole list out at most
every 5 s and serves each from it. A loader checks what it takes with its own checker before a sandboxed host runs it:
the server vouches for nothing but what everyone may read. Every route of the feed answers any page
(`Access-Control-Allow-Origin: *`), and Caddy forwards all of `/feed/*` to it.

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
| 5 | Claim key | The key to seal to of a device that belongs to no vault yet: an unclaimed server's, or an agent device's |
| 6 | Claim: the edit that adds that device to its device vault (section 3, adding a device vault) | It, signed by the claimed device too |
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
`put_file` op). Shares, sync and deletion work on it as on a note. An entry of any other kind brings one in its
creation's own write (a `create` with a `file`), or by one write on its main line later (`put_file` with `entry`).

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

- `put_file`, and a `create` with a `file`, check the entry they would create or bring into before they read a byte.
  `Node::store_file` reads the file twice: once to derive its key, once to seal it, checking the key again over the
  bytes it seals, so two different files never share a key. It streams each piece onto the shelf, so a file of any size
  passes through a few segments of memory; then the entry and the write that brings it are made.
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
| Studio worker | A folder beside the desktop's, `<app folder>-workers/<device>`, laid out as the desktop's; its key on the desktop's shelf, wrapped | The folder | Memory windows |
| Server | An S3 bucket, every object sealed (`crates/avendb-net/src/bucket.rs`) | The bucket | Its folder |

A browser tab's worker holds the store's lock, so one device never runs in two tabs at once.

**Generations and resets.** A place keeps its shelves side by side, one per generation, `g1`, `g2` and on. The newest
is in use; every older one is put aside, never read again. Forgetting a device starts a new one. A reset of avenDB
raises `shelf::FLOOR`, the generation every place is at least: as a place opens, it clears every shelf older than that
and whatever else an earlier avenDB kept there (`shelf::kept`), and starts empty, the server with a new device key. The
Mac clears its folder (`disk::clear`), a page its OPFS folder, the server its folder as it starts and its bucket while
it runs (`bucket::clear`). `FLOOR` is 13 since the last reset (2026-10-17), as the seed, the asset recipes with it, is written while the account
is set up.

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
| M1 | A counted merge brings in only what its merge ops' paths reach | `M1_merges_within`, with `merged_within` in `Rules.lean` |
| M2 | A merge into main through a share counts only on top of the vault's accept; the vault's own merges count as before | `M2_merges_accepted`, `M2_owner_counts` |
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
