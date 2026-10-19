<!-- The words of maia.city/docs/avendb/ as Markdown, made by scripts/docs-markdown.mjs from the built page. -->

[← Docs](../../docs)

avenDB · architecture · updated 19 October 2026

# avenDB Architecture

A user-owned, local-first database with post-quantum security. Every write happens on your device first and merges with everyone else’s without a server deciding anything. The server relays, stays online for sync and keeps an encrypted backup, without ever holding a key.

Guarantees

## What avenDB promises

Most of these promises are theorems with machine-checked proofs in avenDB’s Lean model, and the code is held to the model by shared test vectors. The proofs section names them.

The server

**The server holds ciphertext only.**

It relays, stays online for sync and keeps an encrypted backup, and never holds a key to your vaults. It still checks every edit exactly as an owner would, from labels that say who may write, not what is written.

Readers

**Only the people you share with can read.**

Each entry’s key reaches only the people whose shares pick it. A Backup or Relay share, the kind the server holds, gets no key at all.

Revoking

**Revoking a share is final for what comes next.**

The entries it reached move to a new key the revoked person never gets. What they read before stays read. Nothing new reaches them, and they can’t slip in an edit dated before the revocation.

A lost phone

**A lost or stolen device opens nothing.**

Your passkey is the root: a device’s keys unlock only with it, at every start. Remove the device from any other one, and your vault’s keys move on without it.

Agents

**An agent never holds more than its aven.**

Each agent is a device of its COOP’s aven, beside its server, and acts with exactly what the aven holds. It holds no share of its own. Take back the aven’s share, and every agent loses it at once.

Offline

**Every edit counts the moment you make it.**

Online or not. Edits made at the same time on two devices merge the same way everywhere, and no server orders or approves them.

Strangers

**Connecting tells a stranger nothing.**

A device that acts for no vault and follows none is sent nothing at all. Even what you share with Everyone goes only to devices with a reason to ask for it.

Backed up

**Backed up means in the bucket.**

The server says it holds an edit or a file only once its sealed bucket has it. Until then, the device that made it keeps it and offers it again.

Quantum

**Post-quantum everywhere.**

Every connection, signature and sealed key has a post-quantum half, and a write counts only once a hash-based signature vouches for it.

Who sees what

## What the server and the bucket can and cannot see

Your devices, and the devices of the people you share with, read your entries. The server reads none of them. It sees enough to route edits and check them, and no more.

### The server sees

- Which devices connect, when, and from where
- Vault ids, and each vault’s owners and devices
- Who holds a share, and at which level
- Which shares pick each entry, its size, and when it changes
- Which files each edit brings, by hash and sealed size, and which pieces get read
- What each device holds, log by log and file by file, and when it last checked
- Schemas, lenses and anything else shared with Everyone

### It never sees

- Any content: notes, todos, file bytes
- File names, types and tags
- What a share picks, or what it allows
- Any key, except those published for Everyone
- Whether two people hold the same film: each person’s files are keyed by a secret of their own vault

### The bucket sees

- Sealed objects, their sizes, and names that are hashes
- Not even what the server sees: every object is sealed with a 256-bit key the server keeps
- Whoever records the link to it, classical TLS since Hetzner offers nothing else, sees the same noise

With backups off, the server sees only a vault’s owners and devices, to let them through its relay. A Public share is the exception by design: it publishes its key so that anyone with a reason to ask can read what it covers.

When something goes wrong

## Lost devices, revoked shares, a dead disk

### You lose your phone

Locked, it opens nothing: its keys unlock only with your passkey. Remove it from your desktop. Your vault’s keys move on, so it reads nothing written after, and whatever it signed that your other devices hadn’t seen by then is cut.

### You revoke someone’s share

Every entry it reached moves to a new key that only the shares still live get. What they read before stays read. Nothing new reaches them, and their edits your devices hadn’t seen when you revoked are cut.

### Your phone is offline for a month

It keeps working on what it holds, and your desktop still shows what it holds, as of when it last checked. Back online, each side sends only what the other lacks, log by log, and both end in the same state.

### An agent goes wrong

Remove its device from the aven. The other agents keep working. It acts only as the aven, so it never held more than the aven, and a COOP that takes a share back from its aven takes it from every agent at once.

### Two devices change the same note at once

Both changes stay. Text merges character by character, list rows by their id, and any other field takes one value, the same on every device.

### You lose every device

Sign in on a new one with your passkey. The server hands it your vault’s log, the new device adds itself, and your entries come back from the encrypted backup. With backups off the server kept nothing, so what only your devices held is gone with them.

### The server’s disk dies

Its disk is only a cache. A new server starts from the bucket alone, as the same device, and your vaults notice nothing.

### The server is down

Nothing you write waits on it. Each device keeps working, and they catch up as soon as they reach each other or the server again.

### Someone breaks elliptic curves

Recorded traffic stays closed, since every link and every sealed key has a post-quantum half, and every edit counts by its hash-based signature alone.

Local first

## Your devices hold the data, the server only helps

Every change happens on your device first: it is signed, encrypted, saved, and counts at once, online or not. Devices then sync with each other, directly when they can and through the server when they can’t. The server is one more peer: an always-online device of avenMAIA, a device vault, that relays, syncs and keeps an encrypted backup, under the same rules as every other device and with no say over them.

| Ideal | How avenDB meets it |
| --- | --- |
| **Fast** | Reads and writes run on the device’s own store. No round trip to a server sits between you and your data. |
| **Multi-device** | Your desktop and phone each hold what their keep shares say of your vaults, and keep each other up to date. |
| **Offline** | An edit counts the moment it is saved. Offline, edits pile up and go out when a peer is reachable again. |
| **Collaboration** | Every entry is a CRDT: edits made at the same time merge the same way on every device, with no server to order them. |
| **Longevity** | Your data is a log of signed edits in open formats (Loro documents, JSON Schema), kept on your devices. No service has to stay online for you to read it. |
| **Privacy** | End to end encrypted. The server and the bucket hold ciphertext only; keys stay on the devices of the people a vault shares with. |
| **User control** | A vault is owned by its passkeys. Shares say who may do what, and every device checks them, the server too. |

The seven ideals are from Ink & Switch’s essay *Local-first software* (2019).

The shape

## Three parts: Entry, Share, Blob

Everything in avenDB is one of three things. All else is worked out from them and never typed in: whom an entry is shared with, its key, which devices it is synced to, and what a device still has to fetch.

### Entry: what

All data is an entry in a vault: sparks and notes, artifacts, todos, articles, stories, files, a device’s card, a vault’s profile, and the schemas and lenses too. An entry changes only by signed writes.

### Share: who may

Who, at which level, on what. People, Everyone, the server and each of your devices are given shares, and a vault’s owners and devices are shares too. Revoke ends any of them.

### Blob and holdings: where

All bytes are blobs named by their BLAKE3 hash, on one shelf per place. Each device tells its peers what it holds for good, and signs it with when it checked. Every “synced to” comes from that.

Identity

## Vaults, owners, devices and shares

Everything belongs to a vault, the way an account belongs to a person. Who may do what is built from four things, and nothing else. Each is defined once, in avenDB’s Lean model, and the code and the app read that one definition. So no screen and no device adds a rule of its own.

| Primitive | What it is | It answers |
| --- | --- | --- |
| **Vault** | An identity of one kind: a person, a COOP, an aven or a device vault. It owns its entries. | Who |
| **Owns** | A parent vault owns a child vault. The owner approves the child’s changes and acts for it. | Who decides |
| **Device** | A key that signs for one vault. It acts with all its vault’s rights, and approves nothing. | Who signs |
| **Share** | A named group of ops on a slice of a vault, given to a vault. It may rest on a share its giver holds. | Who may do what |

Two facts follow from the four, and avenDB stores neither. The **acting chain**: a device acts for its vault, and through owners for every vault they own, up to a passkey. Every edit shows this chain, so you always see whose passkey stands behind it. The **effective right**: what a vault may do through a chain of shares is what every share of the chain allows, and no more. Revoke a share, and every share that rests on it ends too.

### Four kinds of vault, one table

Every vault has a kind. One table says, for each kind, who may own it, how many owners it takes, whether it holds devices, and how many of it one owner may own. Every rule about kinds reads this table, and the app reads the same table from its device. So a kind’s rules live in one place, and nothing else decides them.

| Kind | Owned by | Owners | Holds devices | One owner may own |
| --- | --- | --- | --- | --- |
| **Human** | Your passkeys and the master recovery key | Any, by threshold | Yes: your desktops, phones, browsers and drives | Any number |
| **COOP** | Human and COOP vaults | Any, by threshold | No | Any number |
| **Aven** | One COOP | Exactly one | Yes: its server and its agents | One per COOP, none per person |
| **Device vault** | One human or COOP vault | Exactly one | Yes: the keys of one studio worker | Any number |

### Human vault

Yours. Owned by your passkeys, and by the master recovery key, a way back in kept offline that you remove like any owner. Its devices, your desktop and phone, act for it, and each one unlocks its keys with your passkey at every start. Nothing else can unlock them.

### COOP vault

A company or a group, owned by human vaults and other COOP vaults. It has no devices of its own: its owners act for it from their devices. Each COOP has one aven of its own, and may hire another COOP’s by sharing with it.

### Aven vault

A COOP’s one AI identity, Maia City’s avenMAIA. Only its COOP owns it, one aven per COOP and none per person, so only the COOP decides what it passes on. It lives on its server: the server is its device, which acts for it and governs nothing. Its agents are devices of it too, and act with exactly its rights.

### Device vault

The keys of one studio worker, owned by exactly one human or COOP vault. Its devices act for it with all its rights and approve nothing. It owns nothing, and holds only what its owner gives it or passes on to it.

Samuelhuman vault · owned by his passkeysdevices: Mac, phone, browsersMaia CityCOOP · the city’s contentavenMAIAaven · one per COOP, lives on the serveragentClaudea device of avenMAIA · Claude CodeagentCodexa device of avenMAIA · CodexEditor: Maia City shares with its avenits agents: devices of avenMAIA, with its rightsowns: the owner decides for ita share, and a share passed on from itholds devices, which sign for it

*[Figure 1, drawn live on the page] Samuel’s vaults. A line runs from an owner down to each vault it owns. The dashed line is a share: Maia City shares with avenMAIA, its one aven. avenMAIA lives on the server, its device, and its agents, agentClaude and agentCodex, are devices of it too: each acts as avenMAIA, with exactly what avenMAIA holds. If Maia City takes a share back, every agent loses it with the aven.*

A vault has two settings: how many owners must approve a change, and its root passkey, which approves anything on its own. Adding or removing an owner or a device takes the vault’s approval and the newcomer’s consent; devices approve nothing. An owner that is a vault approves as that vault does, so your passkey approves for every vault your vault owns, down the chain, in one prompt. A new device joins with your passkey alone, through a QR code on a device you have or by signing in through the server. Set up avenDB on a second device with the same passkey and it joins the vault that passkey already has: one passkey, one human vault.

### One flow adds a device vault

Everything that acts with keys of its own, an agent, the server or a studio worker, is added the same way, in three steps. First, a device vault is founded under its parent, or the one there already is taken. Second, the device’s key is added to it, and the device signs that edit too, so no key joins a vault without its own consent. Third, the device vault gets its shares: its parent passes on shares it holds, or a vault gives it a share over itself. Your passkey signs the first two steps in one prompt. The shares need no prompt, because a share below Owner changes nobody’s control.

| Case | Parent | Device | Shares |
| --- | --- | --- | --- |
| **An agent** | Your COOP’s aven itself, avenMAIA: a device of it | The agent harness’s key on your Mac | The aven’s own, no more and no less |
| **The same harness on your other Mac** | The aven again: one more device of it | That Mac’s harness key | The aven’s own, no more and no less |
| **The server** | avenMAIA itself, founded with the seed: the server is its device | The server’s key | Backup or Relay, from each vault over itself |
| **A studio worker** | A device vault under the vault whose media it works on, yours or a COOP’s | A key the desktop app makes and hosts | That vault’s shares over itself, or passed on from those it holds |

One flow means one set of rules to check and one view to show it. The app lists the vaults each vault owns the same way, each with its devices and the shares it holds: Maia City on your vault, its aven on Maia City, and the aven’s server and agents on avenMAIA.

### The seed and the server

A new server belongs to no vault. The first person to found a vault through it claims it, in the same prompt that founds their vault. That prompt also founds the seed: Maia City, a COOP their vault owns, where the city’s content lives, and avenMAIA, Maia City’s one aven, with the server as its device: an aven lives on its server. Each is named as it is founded. Every device finds the server by this chain, not by a name: it is the aven, with a device, of a COOP owned alone by a human vault. So an agent, a drive or a worker in a device vault never passes for the server.

Each vault gives avenMAIA a share on the whole of it: Backup, so the server keeps its ciphertext, or Relay, with backups off. Every vault founded under you follows your setting, your COOPs and their avens too: it is one of your standing grants, as “All my vaults, now and later” is, which every vault you found later gives too. Your devices are often away, and the server is always there. So what your aven and its agents write, a request among it, still reaches the people it is for.

### A COOP’s aven and its agents

An aven is a COOP’s one AI identity, one per COOP and none per person: Maia City’s is avenMAIA, founded with the seed. It lives on its server, a device of it, and its COOP’s owners act as it from their own devices. Each agent harness is an agent of its own: a device of the aven, beside its server, with a key of its own. The key is who it is, never a token. Claude Code is agentClaude, Codex is agentCodex, and likewise Cursor, Grok and our own native aven. `avendb-device agent claude` is that device on your desktop, which Claude Code starts as its MCP server. A harness never names or picks an aven: it always joins your COOP’s one aven, once you approve it.

An agent acts as the aven, with exactly what the aven holds, no more and no less: no agent vaults and no sub caps. By default avenMAIA is a Suggester on Maia City and may open AIPs there, so an agent proposes and drafts and you merge. Give the aven more and every agent has more; take a share back and every agent loses it; remove one agent’s device from the aven and the others stay. An agent saves a file of your desktop, named by its path, where the aven may create, as an Editor may. It keeps no file of its own: once your desktop holds a file it saved whole, it lets go of its copy, and it reads your files from your desktop’s one store, so nothing is kept twice.

### Asking for access

An access request is a record, not a new kind of message. The vault that asks writes a record of avenDB’s request schema in its own vault: the vault it asks, what it asks for, and why. That is a share at a level (Viewer, Suggester or Editor), to co-own the vault it asks, or, from a COOP, an invitation to co-own it. It shares that one record with the vault it asks, in a group of its own, Answer: read the record, set its answer to granted or denied, and write its part of an owner add, and nothing else. Sync carries the record like any other, over avenDB’s own protocol: straight to the devices that act for the vault asked, or through any peer that keeps it, as the server does while it backs up the vault that asks. The server is one more peer, not a mailbox. So a request needs no new rule: it is a record and two shares, the one that carries it and the one that grants it.

```
{ "op": "ask", "as": "…", "to": "…",
  "level": "Editor",
  "why": "To draft the city's articles" }
```

*[Figure 2, drawn live on the page] avenMAIA asks Maia City for Editor*

```
{ "kind": "request", "to": "…",
  "asks": "share", "level": "Editor",
  "why": "To draft the city's articles",
  "vaults": [], "answer": "granted" }
```

*[Figure 3, drawn live on the page] The record it writes in its own vault, once Maia City has answered*

Every request your vaults were asked shows on one consent screen, one at a time: who asks, which vaults, the level and why. You may give less than it asks, a level for each vault, never more than the vault asked holds. Approve, and the vault asked gives the share and writes granted into the record. Deny, and it writes denied. The asker sees the answer when the record syncs back.

An agent that belongs to no vault yet can write no record, so its first request is a file it leaves on your Mac, shown on the same screen. Approve, and one prompt of your passkey adds the agent’s key to your COOP’s aven as a device, beside its server, and the agent’s own device signs too. It gets no share of its own: it acts as the aven, with what the aven holds. From then on the agent asks with a record, as any vault asks.

A new owner takes two passkeys: the vault’s approval, and the newcomer’s consent. So a request to co-own, or an invitation, carries the edit between the two people. The one asked approves, or accepts, with their passkey, which signs their part of the edit, and writes it into the record with granted. The one who asked finishes it with theirs, a next step on their consent screen. Neither adds anyone alone. And a new browser, opened on the link one of your devices shows, asks to join your vault on the same screen: its Approve is the one touch of your passkey that unlocks it and adds it.

Keys

## Your passkey is you, a device key is one install

Two kinds of key act for a human vault. Your passkey is the root, and the same on every device it syncs to. Each install of avenDB, a browser on maia.city or the desktop app, has a device key of its own, which signs what that install writes.

| Key | Stands for | Lives | Lasts |
| --- | --- | --- | --- |
| **Your passkey** | You | In your phone’s or computer’s passkey store, synced by it (iCloud Keychain, for one) | The same everywhere: its keys come from its PRF output the same way each time. It owns your vault. |
| **A device key** | One install: a browser on maia.city, or the desktop app | Masked on that install’s own shelf | Made once from the install’s own randomness, kept until its storage is wiped, never made again. |
| **The unlock** | One session | In memory only | One passkey prompt as the device starts. The key is wiped as the device closes. |

### Random, not derived

A device key is 32 random bytes the install draws when it is made, not something derived from your passkey. So it exists before the first prompt, and that one prompt both unlocks the device and vouches for it by its id: two prompts to set up or sign in, where a derived key would need a third. A device key holds no data, so nothing is lost with it. A wiped or new install joins with your passkey and syncs from your other devices and the server, and you revoke the old one. Making an old key again would do harm: the copy would sign edits that don’t build on the old device’s own, which sync flags as a fork, as for a stolen key, and a revoked device would come back.

### How long it lasts

As long as the install’s storage. Closing a tab, the browser or the app keeps everything: the next start takes one prompt, opens with all the device had, and syncs only what changed, log by log. Only wiped storage makes a new device: cleared site data, a private window, an uninstall, a new phone. Browsers may clear a site’s storage on their own (Safari after a week unused), so every browser starts as a light copy and the desktop app as a full one.

### Where it lives, and how it is kept

A browser keeps its device in maia.city’s private storage (OPFS); the desktop app in its folder, `~/avenDB/mac/`. Beside the signed, sealed edits, public keys and file pieces, the device keeps one small record that opens it again: its name, its id, its relay, the 32 bytes of its salt, the passkey’s credential and public key, the vaults it follows, and its secret XORed with your passkey’s PRF output on that salt. Nothing on disk is a secret: whoever copies it gets only noise, as unmasking the secret takes that PRF output, which only your authenticator gives, after Face ID, Touch ID or your PIN, and only to maia.city. While the device is open its key is in memory only, and wiped as it closes. What a disk can’t protect against: malware on a machine while the device is open, and the site’s own scripts, which may ask your passkey for a prompt as any page of maia.city may. The server is the one device whose secret is on disk, sealed in its bucket, as nobody is there to unlock it.

### A drive is a device too

An external drive you use for avenDB is a device of your vault of its own, as a phone is, on the same sync, shares, copy setting and holdings. One prompt of your passkey adds it, in Owners and devices on the desktop app, and it keeps a full copy unless you make it light. It holds only ciphertext, in `.avendb` on the drive, and its key never in plain: masked by your passkey, as every device’s, and wrapped by each Mac that hosts it under that Mac’s own device key, so plugging it in again asks for nothing. While it is plugged in, the Mac’s device runs it as a second node; unplugged, its last signed statement of what it holds shows when it checked. Eject it in the page, which stops its node before macOS ejects it, so nothing on it is in use. A lost drive is removed like a lost phone.

Edits and logs

## Eight kinds of signed edit, one log each

Every change in avenDB is an edit: signed, named by the BLAKE3 hash of its bytes, and kept for good. There are eight kinds. Each edit belongs to one log, a vault’s, a share’s, an audience’s or an entry’s, and its kind alone says which, so a peer that can read nothing of it can still route it.

| Kind | What it does | Its log |
| --- | --- | --- |
| **Genesis** | A new vault: its kind, owners, threshold and root | Its vault |
| **Settings** | How many owners must approve, or handing the root passkey on | The vault |
| **Share** | A share, an owner or a device | Its own log, or the vault’s for owners and devices |
| **Revoke** | Ends any of them | The same log as what it ends |
| **Write** | An encrypted change of one entry, and the files it brings | The entry |
| **Mark** | Which shares pick an entry, and which keep shares want it | The entry |
| **Keys** | Sealed boxes of one key, for exactly who may open it | The key’s family |
| **Claim** | A newcomer’s vault takes an invite share, signed with the invite’s key | The share’s log |

Each edit names its log’s latest edits, the frontier, as its parents, so every log is a small graph of hashes: no edit can be changed, dropped or put in another order without every device noticing. Every device replays the edits it holds in one order, so concurrent edits settle the same way everywhere. A removal, such as a revocation, names the edits it had seen. An edit it hadn’t seen that relied on what it took away is cut, so nobody can backdate an edit around it.

Entries and the CRDT

## Every entry merges

An entry is one note, todo, article, file, card or profile. Its type and tags travel encrypted inside its writes. Each entry is a Loro document, a CRDT: any device changes its own copy at any time, and two devices that hold the same writes read the same entry, whatever order the writes arrived in.

A record holds records: a row of a list may hold lists of rows in turn, at any depth, an outline’s nodes under nodes or a thread’s replies under replies. A place is named from the top by its chain of rows, `["nodes", {"id": 1}, "kids", {"id": 11}, "text"]`, and every walk over a record is a loop, so a deep one can’t overflow a stack. No write reaches deeper than 256 rows: a deeper one fits no schema, so no reader counts it, the same on every device.

| Changed at the same time | How it merges |
| --- | --- |
| Text | Character by character: both insertions stay, in the same order on every device. |
| A list of records (a note’s blocks, a checklist) | Rows are matched by their id: rows added on two devices both stay, and a row moved or removed is that row and no other. |
| Rows inside rows (an outline’s nodes, a thread’s replies) | The same at any depth: each list is a container of its own in the row that holds it. A row moved within its list keeps an edit made to it meanwhile; a row moved to another list is deleted and added anew, so such an edit is lost. |
| One row id added on two devices | Both rows stay, each with the rows under it, and apps show the first. |
| Any other field | One value wins, and it is the same one on every device. |

e1 · on bothBuy milke2 · desktopinserts “oat ”: Buy oat milke3 · phone, offlineappends “ and bread”e4 · its parents: e2 and e3Buy oat milk and breadthe phone comes back online:both hold e2 and e3

*[Figure 4, drawn live on the page] The desktop and the phone change the same note at the same time. Once each holds both writes, both read “Buy oat milk and bread”, whichever came first. The next write, on either device, names both as its parents.*

History

## Main, proposals and variants

Nothing is overwritten: every write extends a line. Main is what everyone reads. A proposal is a line of its own that starts from any version, so a change can be tried and reviewed without touching main. A variant is a line that stays beside main and follows it, as breeds of one animal do: each merge into main comes into it, and it keeps its own where both changed one place. A draft is a new entry on a proposal of its own: main holds nothing of it until its vault merges it, and only the vault can. A copy is a new note made from any version; it keeps its link to this history, and the original lists its copies.

Each proposal merged into main makes main's next version: the create is v1, the first merge v2, and so on. The numbers come from the history alone, so every device reads the same ones, and they never change. A version between two merges reads as "v3 + 2 edits". Each variant counts its own: "Silkie v3". A link to one version stores only hashes, the entry's id and the version's edits, and is labelled from avenDB: "Crawler excavator v4 · 01627d33…".

An asset is one entry with this history. Its first version is created together with its file. Each later version is a proposal whose one write holds both the new record and its file, and the merge makes it main's next version. Each variant, a goat breed say, is a line beside main: after main moves on, the variant writes its own record and file. Readers find every version by the write that brought its file.

mainPropose from herea proposal: its own line, from any versionMerge into main:nothing is lostRestore and Undo are new writes tooa variant: a line besidemain that follows it

*[Figure 5, drawn live on the page]*

| Action | What it does |
| --- | --- |
| **Propose from here** | Starts a proposal from the version you are looking at, main or an older one. |
| **Merge into main** | As a pull request merges: what only the proposal changed lands, and nothing main changed is lost. Where both changed the same place, you pick which value main keeps. Rows inside a row join by id at any depth; a clash anywhere inside makes that row the place you pick, and the page says where under it both changed it. |
| **Accept** | One of the vault’s owners accepts a proposal as it stands, with a review: accepted, declined, or sent back to revise with a few words. Anyone else merges a proposal into main only once the vault accepted it, and only the version it accepted; the vault’s own merges need no review. |
| **Put it in an AIP** | Every change is put to a vault the same way, whatever entries it touches: an AIP, an Aven Improvement Proposal, names proposals on the vault’s entries, of any types, with a title and a note on why. Promoted, it takes the vault’s next number, AIP-1, AIP-2, and one owner’s review answers every proposal in it at once: accepted merges them all into main, declined or withdrawn merges nothing, and revise sends it back as an idea that keeps its number. What it changes is read off its proposals through each entry’s schema, never typed. Each merge still counts on its own, so a device that holds only some of them shows only those. |
| **Update from main** | The same merge the other way: brings what main gained since into the proposal. |
| **Restore** | Puts back any older version, as a new write. |
| **Undo** | Takes out one older edit by a three-way merge, keeping every change made after it, at any depth. Undoing a merge takes out only what the merge itself wrote, so both lines’ changes stay; restore the version before it to take back the merge. |
| **Start a variant** | A line of its own that stays beside main, as breeds of one animal do. Each merge into main comes into it in the same step, and where both changed one place, the variant keeps its own. It has its own numbers, Silkie v1, v2, and says which version of main it holds. |
| **Make a copy** | A new note, in this vault or another, with the line’s content and tags. Its first edit names this note and the version it came from by the hashes of its edits, so its history goes on into this one’s. |

None of them asks for the passkey: the device’s own keys, unlocked at start, sign them.

Shares

## A share says who may do what, on which entries

Every permission in avenDB is a share: **who**, at which **level**, on **what**. People, COOPs, avens and their agents, Everyone, the server and each of your own devices are given shares. On the wire, a vault’s owners and its devices are shares too, so the device lists them with every other share, and Revoke ends any of them. Every device checks every write against the shares its author relies on, so a write no share allows counts for no one.

| Who | How it works |
| --- | --- |
| **A vault: a person, a COOP, an aven or an agent** | It reaches every device that acts for that vault, so a new phone needs no new share. |
| **Everyone** | Read only. Its key is published in the clear, and it goes only to devices with a reason to ask. |
| **One of your own devices** | Only as a keep share: what that device syncs. It grants nothing. |
| **An invite key** | A one-time key: the newcomer’s vault claims the share once at sign-up, with no owner tap. |

**What** is everything in the vault, or a selector over an entry’s labels: its type, the vault that created it, its id, when it was created, and its tags. Tags change, so a share reaches every entry tagged so, now and later. A share is also a group of JSON ops, and its **level** is the class of its strongest op. It carries its own ops, or names a cap group the vault defines. In the app, one Share form makes every share, wherever a page offers to share, and a vault’s Sharing page is the one place that says who has it.

```
{ "name": "Tick work",
  "where": { "all": [{ "type": ["todo"] }, { "tag": "work" }] },
  "ops": [{ "op": "read" },
          { "op": "set", "path": ["status"], "to": ["doing", "done"] }] }
```

*[Figure 6, drawn live on the page] Bob may read the todos tagged work, and set their status to doing or done.*

An op names its place at any depth, and `"*"` stands for any row or any field: `["nodes", "*", "kids", "*", "text"]` is the text of any row under any node. An op on a row covers everything under it. The Share form offers every field of the schema at any depth, in words, and each list of rows to add to, delete from or reorder. A merge op may name a place too: a tuner that may merge `["params", "*", "default"]` into main merges a proposal that only changes the defaults of the params, and not one that also changes the code.

| Group | Level | May | Typical for |
| --- | --- | --- | --- |
| **Owner** | Owner | Everything, and share on | Co-owners, on the whole vault; anyone, on a slice |
| **Editor** | Write | Read, create, set, tag, propose, merge | Someone who works on the entries |
| **Suggester** | Write | Read, propose and draft new entries; set and merge on proposals | A reviewer: main changes only when an editor merges |
| **Viewer** | Read | Read | A reader |
| **Public** | Read | Read, for Everyone | Anything published: its key goes out in the clear |
| **Backup** | Backup | Keep the ciphertext, read nothing | The server, by default |
| **Relay** | Relay | Find the vault’s devices, keep nothing | The server, with backups off |

The selector, the name and the ops travel sealed, to the vault, the holder and whoever gave the share. In the clear a share shows only who holds it and at which level, so the server learns nothing of what it picks or allows. A share may rest on another, and a chain of shares allows only what every share of it allows.

### Cap groups

A cap is one op over one slice. A cap group is an entry of its vault with a name, its caps, and the groups it includes. A share of a cap group names the group and holds no copy of its ops, so a new version of the group reaches every share naming it at once. Revoke ends one share. To narrow what many hold, change the group. Owner, Editor, Suggester and Viewer are fixed in the engine. Maia City defines Traveler (read the games, worlds and asset recipes), Citizen (Traveler and the MaiaCity V1 moves) and Admin. A group share’s level is what its caps need, and it never grants an op above that level, whatever a later version of the group says.

### Invites, and who the server takes

An owner of Maia City signs a group share to a one-time invite key, and the invite link carries the share and the key. At sign-up the newcomer’s new vault claims it, signed with that key, and the share is theirs: no owner taps anything. A claimed invite can’t be claimed again. With its gate on, the server takes a new human vault only together with the invite it claims, and a new COOP or aven only where an admin owns it: Maia City, an owner of it, or a holder of its Admin cap group. Anyone may still make a vault on their own devices, but the server keeps none it hasn’t taken.

### Passing a share on

A share may rest on a share its giver holds over the same vault. It must be no stronger than that share, and cover the whole vault only if that share does. And one of two things must be true: the share it rests on is an Owner share, which lets its holder share on with anyone; or the new share goes to a vault its giver owns. This one rule covers every case. The second part is safe because an owner added every key of the vault it owns and can remove each one, so what it passes on goes nowhere it can’t take back.

| Case | The share | Why it may |
| --- | --- | --- |
| **A COOP shares with its aven** | Maia City gives avenMAIA Editor | Maia City gives a share over itself, resting on none |
| **A COOP passes a share on to its worker** | Maia City passes a share on to its Render Mac | Maia City owns the worker’s device vault |
| **A COOP passes a share on to its aven** | Maia City passes on a share another COOP gave it | Maia City owns avenMAIA |
| **An Owner of a slice shares it on** | Whoever holds Owner on the todos tagged garden shares them with Bob | It rests on an Owner share |

### Owners and devices

An owner is “Owner on Everything”: a co-owner who approves changes to the vault. Only signers own a human vault: its person’s passkeys, and the master recovery key it is founded with. An aven and a device vault take exactly one owner. An Owner share on a slice, one todo or one tag, is something else: its holder may share that slice on. A device “acts for” its vault: it writes as the vault and approves nothing.

### Keep shares: what each of your devices syncs

A keep share goes from your vault to one of your own devices, by the same selector as any share. It grants nothing: it says what that device syncs, and whether it keeps files whole.

| Keep | What it does | Typical for |
| --- | --- | --- |
| **Keep whole** | Syncs the entries it picks, and keeps their files whole | Your desktop, for the originals |
| **Keep when opened** | Syncs them, and fetches a file’s pieces as they play | Your phone |
| **Never keep** | Doesn’t sync what it picks | An archive the phone never needs |

Each device also has one copy setting, a keep share over everything it may read: a full copy keeps every entry and file whole, a light copy syncs every entry and fetches a file only when it is opened. You pick it when the device joins, the desktop app full and any browser light by default, and change it in Owners and devices. With neither, the server keeps every file whole and any other device fetches pieces as it reads them. A keep share always brings the vault’s schemas along. Only the vault that made it can end it, so nobody else can force your phone to sync more.

### The server: Backup or Relay

Each vault gives avenMAIA, the aven the server is a device of, a Backup share on everything when it is founded: the server keeps the ciphertext of every entry, and opens none. With backups off it gives Relay instead: the server learns the vault’s devices, to let them through its relay, and keeps nothing of its entries. Every vault founded under you follows your setting, and one switch changes it for all of them.

### Revoking

Revoke ends a share and every share resting on it. An agent holds no share of its own, so a COOP that revokes its share to its aven takes it from every agent at once. Whoever gave a share may revoke it, so may the vault it is over, and its holder may give it up. The entries it reached move to a new key, sealed only to the shares still live. What was read stays read.

Audiences and keys

## One key for what the same shares pick

Entries are not encrypted with one key each, nor with one key for the whole vault. Each entry carries, in the clear, its audience: the list of shares that pick it. An audience has one key per epoch, and each entry’s key is derived from it. Share the todos tagged garden with Bob as an Editor, and every todo tagged garden has the audience “that share”. Bob gets its key once.

Tag another todo garden and a device of the vault’s own marks it into that audience, with a link that lets its readers read its whole history. Revoke Bob’s share and the audience moves to a new epoch, with a key only the remaining shares get: what Bob read before stays his, and nothing new reaches him.

The audience is in the clear for a reason. The server reads no selector, type or tag, yet it checks every write: the mark on each entry tells it which shares may write there. The marks provably mean what the shares say, so the server decides every edit exactly as an owner would.

| When | What gets new keys |
| --- | --- |
| A share is given, a vault gains a device | A few boxes: the share’s key to its holder, the vault’s seed to the device |
| A share is revoked | Each audience it reached moves to a new epoch, boxed to the shares still live |
| A vault loses a device or an owner | Its seed moves on, and with it the keys in use under it |
| An entry’s tags change, a new share picks it | One mark, with a link to its earlier keys |

Keys are derived inside the vault and wrapped only across a trust boundary. Every key sent to a person or a device is sealed with X-Wing and Classic McEliece together. Backup and Relay shares get no key at all.

Schemas and lenses

## Change the shape, migrate nothing

Every record has a schema: a JSON Schema, named by its hash. When a schema changes, a lens says how a record of one version reads as the other, both ways. No record is ever migrated: an edit stays in the version it was written in, each app reads through the lens in its own version, and its edits go back as only what changed. So an old app and a new one edit the same todo side by side.

```
{ "title": "Water the figs",
  "done": false }
```

*[Figure 7, drawn live on the page] Todo, version 0, as an old app reads it*

```
{ "title": "Water the figs",
  "status": "doing" }
```

*[Figure 8, drawn live on the page] The same todo in version 1*

```
{ "lens": "Todo, v0 to v1",
  "from": "40de6c0e…", "to": "0d785ad3…",
  "steps": [{ "convert": {
    "from": ["done"], "to": ["status"],
    "forward": [[{ "done": true },  { "status": "done" }],
                [{ "done": false }, { "status": "open" }]],
    "backward": [[{ "status": "done" },  { "done": true }],
                 [{ "status": "open" },  { "done": false }],
                 [{ "status": "doing" }, { "done": false }]]
  } }] }
```

*[Figure 9, drawn live on the page] The lens between them: “doing” has no word in version 0, so it reads as not done there.*

- **Schemas and lenses are entries** of two built-in types. A vault shares them with Everyone, by a Public share named “Schemas and lenses” that it makes with its first schema or lens, so every device that reads anything of the vault reads its schemas too.
- **Only the vault itself adds them.** A schema entry counts only if the vault created it, so no one with a share can change what its entries mean.
- **Readers count only writes that fit.** A write whose result breaks its schema stays in the log and changes nothing anyone sees, so a patched app can’t slip in a value its schema forbids. Each change is judged on the row around it, however deep.
- **Rows hold rows, and a shape may hold its own.** A list of records may sit inside a row, at any depth. An outline’s node holds nodes: a shape that holds rows of its own shape is read one row at a time. A shape that holds itself through plain fields would have no end, and is no schema. A lens reaches into rows of rows too, and translates only what a query reads.
- **A field holds rows, or a link.** What lives and dies with its record is inline, as its rows. What has a life of its own, with its own shares and keys, is linked: `"x-link"` marks a field that points at another entry, or a row of one, at its newest or at the version it is pinned at.
- **avenDB’s own schemas ship with every app**: documents, todos, articles, stories, sparks, artifacts, artworks, flows, functions, posts, reviews, bundles of proposals, policies, AIPs, access requests, cap groups, the code entries (recipes, views and logic: their source, the engine they run on, a manifest of the names they use, their params and a contract; a view also its data, its input, its height, its form, HTML or A2UI, and its own logic), and a device’s card, a vault’s profile and a file, each starting at version 1. A kind that grew ships its older versions too, with the lenses between them, so a spark written as version 1 opens on version 2’s canvas, an article written as version 1 opens as it was, ready to be linked to its story, and a view of version 1 opens as version 2’s HTML view. A vault founded before a version shipped takes it at once, as every app reads through its own copies. An artifact is one source standing on its own, a link, a picture, a clip or a YouTube video with its chapters and words; a spark is a canvas of artifacts, sparks and free notes; an artwork is a story’s card of one shape, in layers, rendered into the Library. Every vault reads and writes them offline, and Maia City holds each as an entry of its own, with the same bytes and so the same id. The todo’s version 0 above is the lens engine’s worked example, which lives only in its tests.
- **Flows are stages any entry can be in.** An article goes from idea to draft to published. A stage is a tag, so a move is one tag change, and a public stage is one Public share on that tag. Functions react to a move: each runs in QuickJS on the device that moves the entry and asks for changes, which its vault’s shares still decide. Publishing an article makes a public post about it, which the server’s feed serves to the Maia Universe stream, and asks whether the pictures it shows go public too, so the stream shows them.
- **Public entries and code, for pages nobody signed in to.** The same feed serves every entry everyone may read, of the kinds a page asks for, with its record, its schema and the version every reader agrees on (`/feed/entries?type=story,article`), the views, logic, recipes, functions and configs among them (`/feed/code`), and any one of them whole (`/feed/entry/<vault>/<entry>`). Anyone can call a vault Maia City, so the feed names Maia City only where it stands in the server’s seed, and `?seed=1` keeps its entries alone. Whoever loads code checks it again before a sandbox runs it.

JSON ops

## One JSON op for every read and change

Every read and every change, of an entry or of a vault, is one JSON op through one entry point, `run(op)`, the same on a desktop, a phone and in a browser. The page, the desktop app and agents all speak it. The device runs the op and answers with what it read or did, or with why it refused. A query picks entries by the same selector shares use, then by their values.

```
{ "op": "query",
  "where": { "all": [{ "type": ["todo"] }, { "tag": "garden" },
                     { "path": ["status"], "ne": "done" }] },
  "order": [["created", "desc"]], "limit": 20 }
```

*[Figure 10, drawn live on the page] The open todos tagged garden, newest first*

```
{ "ok": { "rows": [{ "entry": "…", "type": "todo", "tags": ["garden"],
                    "record": { "title": "Water the figs", "status": "doing" } }],
          "count": 1 } }

{ "refused": "NotAllowed",
  "why": "the ops of the shares the vault acts through don't allow what it does" }

{ "approve": { "challenge": "…", "signers": ["…"], "draft": "…" } }
```

*[Figure 11, drawn live on the page] What comes back: what it found, a refusal and why, or what your passkey must approve*

A query reads each record 16 rows down unless it asks for another depth, and never deeper than the most your device allows, which you set in Settings, from 1 to 256. A list of rows deeper than that isn’t read, and the answer says so for that entry (`"cut": true`). A query also follows the links at the places it names, a level at a time: each hop opens only what your device may read there, and a hop that opens nothing says why. Every row and every hop is one level, so a long chain of links, or a cycle, ends at the query’s depth. There is no paging: your device holds what it reads.

```
{ "op": "query",
  "where": { "path": ["name"], "eq": "Ada" },
  "follow": [["friend"], ["notes"]], "depth": 1 }
```

*[Figure 12, drawn live on the page] Ada, her friend one link away, and her notes*

```
{ "name": "Ada",
  "friend": { "vault": "…", "entry": "…",
              "to": { "name": "Bo",
                      "friend": { "vault": "…", "entry": "…",
                                  "empty": "Deep", "why": "…" } } },
  "notes": [{ "vault": "…", "entry": "…",
              "empty": "NoEntry", "why": "…" }] }
```

*[Figure 13, drawn live on the page] Ada’s record as it comes back: Bo’s record where the link leads, Bo’s own friend one level too deep, and a note this device can’t open*

Reads `query``get``pin``history``schemas``groups``cap_groups``kinds``world``jobs``database``note``log``read_file``creatable``taggable``limits``requests``aips``aip`

Asks `may``shares`

Entries `create``set``unset``insert``remove``move``tag``propose``merge``review``aip_open``aip_promote``aip_withdraw``aip_review``variant``restore``undo``fork``batch`

Vaults `share``keep``copy``revoke``settings``found``put_file``ask``back_up``mark``card``profile``follow``set_limits``define_group``redefine_group``share_group`

Before it shows a button, the page asks `may`: would this device be allowed to make the op, on what it holds now? So a button you see is a change you may make. The page keeps no rule of its own: it reads levels, ops and who may do what from the device’s answers. A `batch` runs several changes of entries as one.

Most changes need nothing but the device. A change the vault’s owners must approve, such as a co-owner, a new device, a threshold or new vaults, is drafted on the device and signed by your passkey, in one prompt however many edits it makes. With no passkey at hand, as for an agent, the answer is `approve`: what to sign and by whom, and nothing is made until it is signed.

An agent speaks the same ops through its MCP tools. It acts as its aven, so the aven’s shares decide what each op may do, and it asks for more with the `ask` op, as any vault asks.

The whole system

## Desktop, phone and server: one protocol stack

Every device is a full avenDB node with its own shelf: a folder on a desktop, the page’s private storage on a phone or in a browser. The server is the same kind of node, and its shelf is a sealed bucket. Devices talk to each other directly whenever the network allows it, and through the relay when it does not. A phone or a browser always goes through the relay. So as it sets up or signs in, a browser first waits up to 20 seconds for the relay to let it in, then reaches the server: a dial sent sooner would be lost, and tried again ever later.

DesktopavenDB device, native, beside the appone shelf, a folder:edits in packs,files as sealed blobskeeps what its keep shares sayPhone or browseravenDB device, in the pageone shelf in OPFS,laid out as on a desktopstreams files as they play,keeps what its keep shares sayavenDB server · Hetznerrelay: lets your devices meetsync peer: always onlinebackup: ciphertext only, no keysits shelf is the bucket;its disk, a cache it can lose:parts read lately, blobs in transita device of avenMAIAObject storagemaiacity-avendb, hel1g<n>/journal/g<n>/heads/g<n>/blobs/g<n>/outboards/sealed, locked 7 daysthe server's truthQUIC end to end,through the relayuppartsedits, holdings and control (avendb/sync/1)file bytes and McEliece keys (iroh-blobs, BLAKE3 verified)through the relay: phones and browsers always, others when no direct path

*[Figure 14, drawn live on the page] Every arrow carries ciphertext only. Keys never leave the devices of the people a vault shares with, and the server seals every object again before it goes to the bucket.*

Inside one node

## The layering n0 intends, and what avenDB adds

iroh’s own guidance: an endpoint, a router that hands each connection to a protocol by its ALPN, the app’s own protocol for app logic, and iroh-blobs for bytes. avenDB has all four. Its sync protocol decides what moves and carries the edits; iroh-blobs carries McEliece keys and file pieces, verified as they arrive.

Lab: vaults, shares, audiences, keys, Loro entries, JSON opsdecides what counts, opens what this device may read, keeps marks and keys up to dateShelf store: iroh-blobs over one shelfa folder on a desktop, OPFS on a phone or in a browserOn the server, the shelf is the bucketevery object sealed, its disk only a cacheavendb/sync/1hellos, frontiers per log, holdings, asks/iroh-bytes/4 (iroh-blobs)one pool, verified ranges, resume, GetManyEndpoint and router (iroh 1.3)one id per device · QUIC · TLS 1.3 with X25519MLKEM768 only · hole punchingTransportUDP when direct, avenDB's own relay otherwise (WebSocket for browsers)avenDB's own coden0's crates

*[Figure 15, drawn live on the page] The sync protocol carries edits and decisions: what changed, who holds what. iroh-blobs carries bytes, and lets a device in only beside a sync connection whose hello proved it. Both share one endpoint, one identity and one post-quantum TLS setup.*

Sync

## Devices say what they hold, and ask only for what differs

Each connection opens with a hello each way: an SLH-DSA signature over the TLS session, so both ends know which device they speak to. Then each tells the other its holdings: for every log it may share with that peer, its frontier, and for every file, whether it holds it whole or in pieces. After that it sends only what changed. A device that hears of a head it lacks asks for that log alone, and gets only what it lacks, in pages of about 4 MiB. Order never matters, so any device can sync with any other, in any order, any number of times.

### Shares: what a device may get

A peer sends a device only the entries its vaults may receive, the logs needed to check them, and nothing else. A relay share gets the vault’s devices and no entry.

### Keep shares: what it wants

Whole, when opened or never, by the same selector a share uses. Your phone fetches pieces as it plays, your desktop keeps originals whole, the server keeps all.

### Holdings: who has what

Only what a device holds for good, on its shelf. Announced, they count only from the device itself on its own connection, and choose whom to fetch from; signed, they outlive it and only show. Both fill in “Synced to”. They never grant anything.

### Interest and follow

What a vault shares with Everyone goes only to devices with an interest in it, or that follow it by name. A device keeps its follow list across restarts. One that acts for no vault and follows none is sent nothing.

| Message | What it carries | The answer |
| --- | --- | --- |
| **Request** | The frontier of each log it holds, its loose edits, the keys it lacks, the vaults it follows | A page of edits |
| **Announce** | Its holdings: in full once, then only what changed | Nothing |
| **State** | A device’s signed statement of its holdings, with when it checked: its own, or another’s passed on | Nothing, once kept or found older |
| **Ask logs** | A request for some logs alone, those whose heads it lacks | A page of edits |
| **Link** | A passkey’s pass, for a new device | The vault logs of that passkey |
| **Join** | The edit that adds the new device | Nothing, once taken |
| **Card** | A request for the server’s contact card | The vault logs of avenMAIA and every vault that owns it |
| **Claim key, Claim** | Asks a device that belongs to no vault yet, an unclaimed server or a new agent, for its key, then adds it to its device vault | The key; the claim, signed by the claimed device too |
| **Invite** | The id of an invite a link names | The invite’s card, while no vault has claimed it |
| **Sign up** | A newcomer’s vault logs and its claims of invites, at once | Nothing, once the server took every new human vault in it; refused otherwise |

Every message is a stream of its own on the one avenDB protocol, with exactly one encoding for every value. Announcements go straight to one proven device, never by gossip, and no node announces another device’s holdings: what it passes on is only that device’s own signed statement.

### Signed holdings: “checked 2 h ago”

An announcement counts only while its device is connected. So each device also signs what it tells a peer it holds, with when it checked: a statement, signed with SLH-DSA like an edit and good for nothing else. It signs a new one on each connection and once its holdings change, at most every 10 seconds, and again every 15 minutes while they stay the same, and hands it only to the peers it is connected to. Every node, the server no less than your desktop, keeps the newest statement of each device it knows, whoever brought it, passes it on to each connected peer that may know all it says, and keeps it on its shelf, so it outlives the device’s connection and the node’s restarts. “Synced to” lists a device connected now by what it announced, and any other by its newest statement, with when it checked: the phone in your drawer shows as “checked 2 h ago”. Statements only show: a node asks and fetches by what its connected peers announce, and no statement lets anyone fetch anything.

Files

## An edit is a small blob, a file is a list of big ones

| Thing | As a blob | Typical size | Where a device keeps it |
| --- | --- | --- | --- |
| An edit (a write, a share, a mark) | Its signed bytes; a write’s body is encrypted | about 17 KiB of SLH-DSA signature, then its body | In a journal entry, then a pack |
| A pack of edits | One blob of many edits, named by a head | up to 64 saves | On the shelf |
| A McEliece public key | One blob, named by its hash in the edits that use it | about 1 MiB | On the shelf |
| A photo, a document | One sealed blob | up to 1 GiB | On the shelf, with its outboard |
| A film or a camera card | A HashSeq of sealed 1 GiB pieces | 1 GiB to many TB | Whole, or fetched as it plays |

Every edit and every blob has one name, the BLAKE3 hash of its bytes, which is also the name iroh stores and moves those bytes by. An edit’s signatures sign that name. Edits are kept in packs and files in pieces, each a blob. The write that brings a file names the file’s root hash and sealed size in the clear, because the server and other devices need them to back the file up and to know who may fetch it. The file’s key sits inside the write’s encrypted body. Whoever may fetch the write may fetch its files, and nobody else.

Every vault has a Library that lists its files by kind: films, images, SVGs, PDFs and audio. A file is an ordinary entry of type `file`, a document named after the file whose first write brings it, so shares, sync and deletion work on it as on a note. A film plays as it streams: the player asks for byte ranges, and the device fetches only the 64 KiB segments those ranges need, verified by iroh-blobs, and opens them. The database lists files too, as a table like any other, with each file’s root, size, sealed size and pieces.

1 · The file, in plaintext…65,520 B65,520 B65,520 B65,520 Bkey K derived from the file, keyed by the vaultChaCha20-Poly1305, nonce = segment number + last flag2 · Sealed segments, each exactly 64 KiB…64 KiB64 KiB64 KiB64 KiB16 KiB16 KiB16 KiB16 KiBfour iroh chunk groups: each verified on its own,so a seek fetches whole segments and nothing more3 · Pieces of 16,384 segmentspiece 0 · 1 GiBpiece 1 · 1 GiBpiece n · restHashSeq root = list of piece hashes4 · The write that brings itin the clear: root hash, sealed sizeencrypted: key K and length, with the entry’s name and typethe write is signed and synced like any edit;the pieces follow, from whoever holds them

*[Figure 16, drawn live on the page] This format is called sealed blob v2. The tag adds 0.024 %. Pieces cannot be swapped or reordered, because every nonce counts segments across the whole file. Whoever holds the key verifies by decrypting; everyone else verifies the ciphertext with BLAKE3. A file’s key is derived from what it holds, keyed by a secret of the person’s vault: the same film added again by any of their devices seals to the same blobs, kept once, while another person’s copy seals to unrelated ones.*

Roundtrips

## Six journeys through the system

Swipe a diagram sideways to see all of it.

### 1 · You write a note

YouDesktopavenDB serverBucketPhone1type in the note2sign the edit, encrypt its body, save it on the shelfit counts now, online or not3holdings: this note has a new head4ask for that log alone5the edit, ciphertext6check signatures and shares, keep it7seal it into the journal8held, locked for 7 days9holdings: the server holds itSynced to: the server10holdings: that note changed11ask for that log12the edit13open it, merge it into the note

*[Figure 17, drawn live on the page] If the desktop and the phone reach each other, they sync directly too, and the server only catches up. The server says it holds an edit only once the bucket does, so its holdings are the receipt: until then the desktop sees the server lacks it, keeps it and offers it again. Only logs that changed are named, so a quiet vault costs nothing.*

### 2 · You add a 2 TB film on your desktop

loop[every 1 GiB piece, as it is read]loop[each piece]YouDesktopavenDB serverBucket1drop the film into a vault2seal 64 KiB segments, hash with BLAKE3, shelve it3write the HashSeq root, sign one write that brings it4sync the write (small, at once)it keeps every file whole5get the root, then piece after piece6bytes, verified every 16 KiB7sealed parts of 8 MiB8its outboard, lasta dropped link resumes at the next missing range9holdings: the film, wholeSynced to: the server

*[Figure 18, drawn live on the page] Your uplink sets the pace: at 54 Mbit/s a terabyte takes about 41 hours, at 1 Gbit/s about 2.2 hours. The desktop keeps working the whole time, and the film plays on it from the first second. A piece counts on the server once its outboard is in the bucket, written after every part.*

### 3 · You play it on the phone and jump to minute 93

alt[the desktop holds that piece and is reachable][only the server]YouPhoneDesktopavenDB serverBucket1play, then seek to minute 932byte offset to segment, piece and range3get piece 1,412, a 4 MiB range4verified bytes from its shelf5get the same range6the 8 MiB part that holds it, unless cached7a sealed part8bytes, verified against the outboard9open the segments, hand them to the playerplayback starts after one window

*[Figure 19, drawn live on the page] Holdings tell the phone which devices hold the piece, so it asks them first. The server reads whole 8 MiB parts and caches them, never single segments and never whole files, so seeking stays fast on a 50 GB file and the bucket’s 750 requests a second are never the limit.*

### 4 · Your devices keep each other in sync

DesktopPhoneBrowseravenDB serversame café wifi1hello, proven by a hash-based signature2hello3holdings: each log’s frontier4holdings, and ask the logs that differ5what it lacks, nothing moreoffline: you keep writing6edits pile up, each one countsback online, only the server is reachable7hello, then holdings8ask the logs that changed9the phone’s edits10ask what the desktop wrote meanwhile11those edits12holdings: these logs changed13ask those logs alone14through the relay, the same exchange

*[Figure 20, drawn live on the page] Every pair of devices runs the same exchange. Each log has its own frontier, so a device asks only for the logs that changed, never the whole vault. Order never matters: Loro merges concurrent edits to the same note the same way everywhere. File pieces are not copied by sync: each device fetches them as its keep shares say, or as it plays them.*

### 5 · A new phone signs in with your passkey alone

YouNew phoneavenDB server1sign in with your passkey2wait for the relay to let it in, up to 20 s3through the relay: show the pass your passkey signed4the link card: your vault’s log5check every edit, open the keys your passkey unlocks6join: the edit that adds this phone7ask for every log it may receive8pages of historynotes and todos are there9pieces of a file, only when you open it

*[Figure 21, drawn live on the page] The link card holds the logs of the vaults your passkey owns and nothing of an entry, so the pass alone reads nothing. History then comes in pages of about 4 MiB, each edit after its past, so a vault of any size arrives a page at a time, never one round trip per edit. With every other device lost, this is how a vault comes back. Setting up on a second device with the same passkey takes this same path, and founds nothing new.*

### 6 · The server is lost and rebuilt

New serverBucketAny of your devices1get its device secret2sealed3open it with the seal key: the same device again4the newest head, and the journal after it5a few dozen sealed objects6the packs they name7sealed packs8open each, check every edit againits holdings name only what the bucket holds9hello and holdings, as usualanything newer comes back from your devices

*[Figure 22, drawn live on the page] The bucket holds every edit and key the server took, and the server's own device secret, all sealed. Only the seal key sits apart, in the deploy's secrets with a copy kept offline. So a new server on an empty disk is the same device again, and nothing changes for your vaults. File parts come back from the bucket as they are read.*

Where the bytes live

## One shelf per place

Each place keeps what lasts on one shelf, laid out the same everywhere. A shelf says it has something only once its place’s source of truth holds it, so “synced to” never means “on its way”. Pieces a device reads but doesn’t keep stay in memory, 64 MiB at most.

| Place | Its shelf | What it keeps |
| --- | --- | --- |
| **Desktop** | A folder of the app’s own | What its keep shares want; files whole where they say so |
| **Phone or browser** | The page’s private storage (OPFS), in a worker | The same; pieces read but not kept stay in memory |
| **Drive** | A folder on the drive, hosted by the Mac it is plugged into | The same as a desktop |
| **Studio worker** | A folder beside the desktop app’s, hosted by that Mac | What it makes; other files it reads from the Mac’s store |
| **Server** | The sealed bucket; its disk is only a cache | Every file whole, by default |

```
g18/                one generation, 18 or later since the last reset; starting fresh makes g19
  meta/<n>          what opens the device again, its follow list and query limit too (browser, desktop)
  journal/<n>       what one save added: new edits, and the McEliece keys they brought
  heads/<n>         after every 64 saves: the packs that hold the log so far
  blobs/<hash>      edit packs, McEliece keys, HashSeqs and file pieces
  outboards/<hash>  each blob's BLAKE3 outboard, written last
  stated/<device>/  each device's signed holdings, named by when it checked, at most one an hour each
  drives/<device>   a drive's key, wrapped under the desktop's own (desktop)
  workers/<device>  a studio worker's key, wrapped the same way (desktop)
  new/              what is still being written
```

*[Figure 23, drawn live on the page] One generation of a shelf. A node starts from its newest head and the journal after it: a few dozen objects, however long the log.*

Packing is what makes object storage work for a database. Hetzner bills every object as at least 64 KB and allows 750 requests a second per bucket. A million edits stored one per object would take 22 minutes of a fully busy bucket to write or restore. Packed, a node reads a few dozen objects to start.

- **Put aside, clear at a reset.** Forgetting an account, or starting fresh, makes a new generation beside the old one, which is never read again. A reset raises the lowest generation, now 18. As each place opens, it deletes every older one: the desktop its folder, a browser its private storage, the server its folder and its bucket.
- **Nothing counts until the bucket has it.** The server’s shelf answers only once the bucket holds the object, so its holdings name an edit or a file only then.
- **Sealed and in parts.** Every object in the bucket is sealed and bound to its name. A blob is stored in 8 MiB parts, and counts once its outboard, written last, is there.
- **Its disk is a cache.** The server caches parts it read lately, 8 GiB by default. Its own device secret is in the bucket too, sealed, so a server whose disk is lost comes back from the bucket alone.
- **Locked.** Every object version is kept for 7 days in compliance mode, so not even a compromised server can wipe the backup. What a reset deletes stays there 7 more days, then goes.

Post-quantum

## Quantum-proof, everywhere

Every node runs in post-quantum-only mode: no classical-only path is left. Every edit counts by its SLH-DSA signature alone, and where a classical algorithm still appears, in a key exchange or a sealed box, a post-quantum one stands beside it, so it stays closed while either holds.

| Where | How |
| --- | --- |
| **Connections** | TLS 1.3 with X25519MLKEM768 as the only key exchange, on every link between nodes. |
| **Hellos** | Each connection opens with an SLH-DSA signature each way over its TLS session, so both ends know which device they speak to even once the curves fall. |
| **Signatures** | SLH-DSA-SHA2-128f on every edit, the only signature that counts. A passkey adds its WebAuthn assertion beside it, which only shows a person was there. |
| **Keys sent to devices** | Sealed boxes of X-Wing (ML-KEM-768 with X25519) and Classic McEliece 6688128f together: closed while either holds. |
| **Edits and files** | XChaCha20-Poly1305 for edits and keys, ChaCha20-Poly1305 per 64 KiB segment for files, all with 256-bit keys. |
| **Hashes** | BLAKE3 for every hash of avenDB’s own: an edit’s or a blob’s id is the plain hash of its bytes, the name iroh gives them, and every other hash, a signer’s id among them, derives its own key for its purpose. An entry’s id is the hash of its vault, the signer that created it and a nonce its creation carries, which every peer checks. |
| **The bucket** | Every object sealed again with a 256-bit key of the server’s, since the link to it is classical. |

Proofs

## What the Lean model proves

avenDB’s rules are written twice: in Lean 4, where each guarantee below is a theorem with a machine-checked proof, and in Rust. Shared test vectors hold the two to the same answers, edit by edit. The proofs assume that signatures can’t be forged, that sealed data reveals nothing without its key, that ids don’t collide and that Loro converges. Verifpal models cover the hello, linking and the sealed box against an attacker who breaks the curves.

| Guarantee | Theorem |
| --- | --- |
| Only edits by someone allowed stand, and a revocation wins over what it hadn’t seen | T1 |
| Changing owners, devices or settings needs the vault’s approval and the newcomer’s consent | T2 |
| A key opens only for whoever may read what it protects | T5, T24 |
| After a removal, the current keys open only for those still entitled, and new writes use them | T6, T15 |
| The server holds no key of a vault, except what is public | T7 |
| Everyone can only read | T8 |
| The same edits in any order give the same state | T11 |
| Sync sends only what shares reach, and strangers get nothing | T12 |
| Frontier sync loses nothing, and two devices that synced once hold the same edits | T13, T19 |
| An edit backdated past a removal that relied on what it took is cut | T16 |
| Every vault keeps to its row of the kind table: an aven has one owner, a COOP, and a COOP owns one aven at most | T21 |
| A share never grants more than what it rests on, and rests on another only by one rule | T22 |
| The marks on each entry mean exactly what the shares say | T23 |
| The server decides every edit as an owner does, without reading a selector | T25 |
| A relay share receives no entry, and files go only with the edits that bring them | T26, T27 |
| Each device syncs what its keep shares say, and revoking one cuts nothing | T28, K1 |
| What a device announces it holds counts only from that device, on its own connection, and no node announces it for another | H1 |
| A signed statement of holdings counts only as the word of its device, the newest wins, and it is passed on only to peers that may know all of it | H2 |
| What any device says or signs it holds never gets anyone a file the rules refuse | T27 |
| Every reader agrees whether a write counts, and a write that breaks its schema counts for no one | C2, S3 |
| A record that fits its schema stays so, and no write reaches deeper than 256 rows | S2 |
| A query shows through links only what its reader opened, says why where it opened nothing, and a cycle of links ends at its depth | L1, L2, L3 |
| Merging a proposal loses nothing: what main changed stays, and what only the proposal changed lands | T10 |
| A merge through a share brings in only the places its merge op names, and into main only what the vault accepted | M1, M2 |
| Only its vault lands a draft, and a draft that hasn’t landed is in no public audience | D1, D2, D3 |
| A share of a cap group never grants an op above its level, whatever version of the group is in force | CG1 |
| An invite is claimed once, and from then on its share names the vault that claimed it | G1 |
| A gated server takes a new human vault only with its invite, and a new COOP or aven only from Maia City’s Admins | G2 |

Not covered by the proofs: the Rust and Loro code itself, which the vectors and tests check; timing and traffic analysis; a file’s exact length, which its sealed size shows; and a device compromised while it is unlocked.

Sources: Ink & Switch’s *Local-first software* (2019), Loro 1.16, iroh 1.3, iroh-blobs 0.103.1 and bao-tree 0.16.1 source, n0’s blog and docs, Hetzner Object Storage documentation, and avenDB’s code and Lean model for edit format 11, as of 19 October 2026. The full reference is `avendb/docs/ARCHITECTURE.md`.
