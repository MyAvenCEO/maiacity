<!-- The words of maia.city/docs/avendb/ as Markdown, made by scripts/docs-markdown.mjs from the built page. -->

[← Docs](../../docs)

avenDB · architecture · updated 19 October 2026

# avenDB Architecture

A user-owned, local-first database with post-quantum security. Every write happens on your device first and merges with everyone else’s without a server deciding anything. The server relays, stays online for sync and keeps an encrypted backup. It holds no key to your vault: only avenMAIA’s, whose device it is, and so the keys of what a vault lets avenMAIA read.

Guarantees

## What avenDB promises

Most of these promises are theorems with machine-checked proofs in avenDB’s Lean model, and the code is held to the model by shared test vectors. The proofs section names them.

The server

**The server holds your vaults as ciphertext.**

It relays, stays online for sync and keeps an encrypted backup, and never holds your vault’s own key. It is a device of avenMAIA, Maia City’s aven, so it holds avenMAIA’s keys and reads what a vault shares with avenMAIA at Viewer or above, and it reads what is public. It still checks every edit exactly as an owner would, from labels that say who may write, not what is written.

Readers

**Only your vault’s owners and the people you share with can read.**

Owners read everything of the vaults they own, down the chain: your passkeys, a Mac’s Touch ID key, and avenDB’s master recovery key while it is an owner of yours. Each entry’s key reaches only them, the vault’s devices, the vaults whose shares pick it, and anyone where a Public share picks it. A Backup or Relay share, the kind each vault gives avenMAIA, gets no key at all.

Revoking

**Revoking a share is final for what comes next.**

The entries it reached move to a new key the revoked person never gets. What they read before stays read. Nothing new reaches them, and they can’t slip in an edit dated before the revocation.

A lost phone

**A lost or stolen phone opens nothing.**

A browser’s or the desktop app’s keys unlock only with your passkey, or on a Mac with its Touch ID key, at every start. Remove the device from any other one, and your vault’s keys move on without it. An agent keeps its key on your Mac’s disk, readable by your user alone, so with a lost Mac, remove its agents from the aven too.

Agents

**An agent never holds more than its aven.**

Each agent is a device of its COOP’s aven, beside its server, and acts with exactly what the aven holds. It holds no share of its own. Take back the aven’s share, and every agent loses it at once.

Offline

**Every edit counts on your device the moment you make it.**

Online or not. It stays, unless its device, or a share it relied on, was revoked before your other devices saw it. Edits made at the same time on two devices merge the same way everywhere, and no server orders or approves them.

Strangers

**Connecting tells a stranger little.**

A device that acts for no vault and follows none is sent no entry and no share. It may ask the server for its card, the logs of avenMAIA and of the vaults that own it, up to the vault of the person who set the server up; and, by the id an invite’s link names, for that invite’s card, and whether it is an open invite of Maia City. What you share with Everyone syncs to any device that follows your vault, and anyone may read it on the server’s public feed.

Backed up

**Backed up means in the bucket.**

The server says it holds an edit or a file only once its sealed bucket has it. Until then, the device that made it keeps it and offers it again.

Quantum

**Post-quantum wherever avenDB holds both ends.**

Every link between devices and the server, every signature and every sealed key has a post-quantum half. The link to the bucket has none, so all that goes over it is sealed first. A write counts only once a post-quantum signature vouches for it: ML-DSA-65 for every key made since avenDB moved to it, SLH-DSA for every key made before, and every device checks both.

Who sees what

## What the server and the bucket can and cannot see

Your devices, your vault’s owners, and the devices of the vaults you share with read your entries. The server reads none of them, unless you let Everyone or avenMAIA, whose device it is, read them. It sees enough to route edits, check them and back them up.

### The server sees

- Which devices connect, when, and from where
- Vault ids, and each vault’s owners and devices
- Who holds a share, and at which level
- Which shares pick each entry, its size, and when it changes
- Which files each edit brings, by hash and sealed size, and which pieces get read
- That one person brought the same file into two vaults: it seals the same in every vault they act for
- What each device holds, log by log and file by file, and when it last checked
- Who signed each edit, by key
- Schemas, lenses and anything else shared with Everyone
- All that a vault shares with avenMAIA at Viewer or above, as avenMAIA’s device

### It never sees

- Any other content: notes, todos, file bytes
- Other file names, types and tags
- What any other share picks, or which ops it allows beyond its level
- Any key but its own, those avenMAIA holds, and those published for Everyone
- Whether two people hold the same film: each person’s files are keyed by a secret of their own vault

### The bucket sees

- Sealed objects, their sizes, and their names: hashes and counters, and in the bucket of snapshots each vault’s id and when each snapshot was made
- Not even what the server sees: every object is sealed with a 256-bit key the server keeps
- Whoever records the link to it, classical TLS since Hetzner offers nothing else, sees the same noise

With backups off, the server sees only a vault’s owners and devices, to let them through its relay. Two kinds of share are the exceptions by design. A Public share publishes its key, and the server serves what it covers to anyone, on its public feed. A share to avenMAIA at Viewer or above gives its key to avenMAIA’s devices: the server, and every agent of avenMAIA.

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

Sign in on a new one with the passkey that is your vault’s root. The server hands it your vault’s log, the new device adds itself, and your entries come back from the encrypted backup. With backups off the server kept nothing, so what only your devices held is gone with them.

### The server’s disk dies

Its disk is only a cache. A new server starts from the bucket alone, as the same device, and your vaults notice nothing.

### The server is down

Nothing you write waits on it. Each device keeps working, and they catch up as soon as they reach each other or the server again. A browser reaches every peer through the server’s relay, so it catches up only once the server is back.

### Someone breaks elliptic curves

Recorded traffic stays closed: every link between devices and the server has a post-quantum half, what goes to the bucket is sealed first, and every sealed key has a post-quantum half. Every edit counts by its post-quantum signature alone, ML-DSA-65 or SLH-DSA.

Local first

## Your devices hold the data, the server only helps

Every change happens on your device first: it is signed, encrypted, saved, and counts at once, online or not. Devices then sync with each other, directly when they can and through the server when they can’t. The server is one more peer: an always-online device of avenMAIA, Maia City’s aven, that relays, syncs and keeps an encrypted backup, under the same rules as every other device and with no say over them.

| Ideal | How avenDB meets it |
| --- | --- |
| **Fast** | Reads and writes run on the device’s own store. No round trip to a server sits between you and your data, but a light copy, which every browser starts as, fetches the pieces of a file it reads from a peer. |
| **Multi-device** | Your desktop and phone each hold what their keep shares say of your vaults, and keep each other up to date. |
| **Offline** | An edit counts the moment it is saved. Offline, edits pile up and go out when a peer is reachable again. |
| **Collaboration** | Every entry is a CRDT: edits made at the same time merge the same way on every device, with no server to order them. |
| **Longevity** | Your data is a log of signed edits, kept on your devices, in avenDB’s own encoding around open formats (Loro documents, JSON Schema). No service has to stay online for you to read it. |
| **Privacy** | End to end encrypted. The bucket holds ciphertext only, and the server reads only what is public or shared with avenMAIA. Keys stay with a vault’s owners and devices, and with the vaults it shares with. |
| **User control** | Your vault is owned by your passkeys and any Touch ID key you add, and, where the app added it, by avenDB’s master recovery key until you remove it. Every other vault is owned by the vaults above it. Shares say who may do what, and every device checks them, the server too. |

The seven ideals are from Ink & Switch’s essay *Local-first software* (2019).

The shape

## Three parts: Entry, Share, Blob

Everything a vault holds is one of three things. All else is worked out from them and never typed in: whom an entry is shared with, its key, which devices it is synced to, and what a device still has to fetch.

### Entry: what

All data is an entry in a vault: sparks and notes, artifacts, todos, articles, stories, files, a device’s card, a vault’s profile, and the schemas and lenses too. An entry changes only by signed writes.

### Share: who may

Who, at which level, on what. A share goes to a vault, to Everyone or to an invite; one for the server goes to avenMAIA, whose device it is. A device gets only a keep share, which says what it keeps. A vault’s owners and devices are shares too. Revoke ends any of them.

### Blob and holdings: where

Files and packs of edits are kept as blobs named by their BLAKE3 hash, on one shelf per place, beside a few objects named by counters, such as the journal of new edits. Each device tells its peers what it holds for good, and signs it with when it checked. Every “synced to” comes from that.

Identity

## Vaults, owners, devices and shares

Everything belongs to a vault, the way an account belongs to a person. Who may do what is built from four things, and nothing else. Each is defined once, in avenDB’s Lean model. The Rust core keeps the same rules, held to the model by shared test vectors, and the app asks its device. So no screen and no device adds a rule of its own. The server only chooses which devices its relay lets in.

| Primitive | What it is | It answers |
| --- | --- | --- |
| **Vault** | An identity of one kind: a person, a COOP, an aven or a device vault. It owns its entries. | Who |
| **Owns** | A parent vault owns a child vault, and signers, your passkeys among them, own a human vault. The owner approves its changes, acts for it and reads all of it. | Who decides |
| **Device** | A key that signs for one vault. It acts with all its vault’s rights, and approves nothing. | Who signs |
| **Share** | A named group of ops on a slice of a vault, given to a vault, to Everyone, or to an invite that the first vault to claim it takes. It may rest on a share its giver holds. | Who may do what |

Two facts follow from the four, and avenDB works both out. The **acting chain**: a device acts for its vault, and through owners for every vault they own, up to a passkey. An edit that acts for a vault names the owners it acts through, and every edit shows this chain, so you always see whose passkey stands behind it. The **effective right**: what a vault may do through a chain of shares is what every share of the chain allows, and no more; avenDB stores it nowhere. Revoke a share, and every share that rests on it ends too.

### Four kinds of vault, one table

Every vault has a kind. One table says, for each kind, who may own it, how many owners it takes, whether it holds devices, and how many of it one owner may own. Every rule about kinds reads this table, and the app reads the same table from its device. So a kind’s rules live in one place, and nothing else decides them.

| Kind | Owned by | Owners | Holds devices | One owner may own |
| --- | --- | --- | --- | --- |
| **Human** | Signers: your passkeys, a Mac’s Touch ID key, avenDB’s master recovery key | Any, by threshold | Yes: your desktops, phones, browsers and drives | Any number |
| **COOP** | Human and COOP vaults | Any, by threshold | No | Any number |
| **Aven** | One COOP | Exactly one | Yes: its server and its agents | One per COOP, none per person |
| **Device vault** | One human or COOP vault | Exactly one | Yes: the keys of one machine its owner runs | Any number |

### Human vault

Yours. Owned by your passkeys, by a Mac’s Touch ID key where you turn it on, and, while avenDB is young, by its master recovery key: one key of avenDB’s, kept offline, which every human vault the apps found takes as an owner. It is a way back in, and an owner equal to your passkey: it reads all of your vault, and, as every vault the apps found starts at one owner’s approval, it alone approves any change. You remove it like any owner. Its devices, your desktop and phone, act for it, and each one unlocks its keys with your passkey at every start, or on a Mac with a touch of its Touch ID key. Nothing else can unlock them, but a drive opens by the Mac that hosts it.

### COOP vault

A company or a group, owned by human vaults and other COOP vaults. It has no devices of its own: its owners act for it from their devices. Each COOP may have one aven of its own, never two, and may hire another COOP’s by sharing with it.

### Aven vault

A COOP’s one AI identity, Maia City’s avenMAIA. Only its COOP owns it, one aven per COOP and none per person, so only the COOP decides what it passes on. It lives on its server: the server is its device, which acts for it and governs nothing. Its agents are devices of it too, and act with exactly its rights. The server and every agent open its keys, so they read whatever a vault shares with it at Viewer or above.

### Device vault

The keys of one machine its owner runs, owned by exactly one human or COOP vault. Its devices act for it with all its rights and approve nothing. It owns nothing, and holds what its owner gives or passes on to it, and whatever another vault shares with it.

Samuelhuman vault · owned by his keysholds his devices, which sign for itMaia CityCOOP · the city’s contentavenMAIAaven · one per COOP, lives on the serveragentClaudea device of avenMAIA · Claude CodeagentCodexa device of avenMAIA · Codexa share: Maia City shares with its avenits agents: devices of avenMAIA, with its rightsowns: the owner decides for ita shareholds devices, which sign for it

*[Figure 1, drawn live on the page] Samuel’s vaults. A line runs from an owner down to each vault it owns. The dashed line is a share: Maia City shares with avenMAIA, its one aven. avenMAIA lives on the server, its device, and its agents, agentClaude and agentCodex, are devices of it too: each acts as avenMAIA, with exactly what avenMAIA holds. If Maia City takes a share back, every agent loses it with the aven.*

A vault has two settings: how many owners must approve a change, and, for a human vault, its root: at first the passkey that founded it, a key that approves anything on its own and that a new device signs in with. Every vault the apps found starts at one owner’s approval, so every owner is an equal, and the owners hand the root on as any change, the new root signing too. Adding an owner or a device takes the vault’s approval and the newcomer’s signature. Removing one takes the vault’s approval, or the one leaving on its own, and a vault always keeps one owner. Devices approve nothing. An owner that is a vault approves as that vault does, so your passkey approves for every vault your vault owns, down the chain, in one prompt. A new device joins with your vault’s root passkey alone, through a QR code on a device you have or by signing in through the server. Set up avenDB on a second device with the same passkey and it joins the vault whose root that passkey is: one root passkey, one human vault.

### One flow adds a device of its own

Everything that acts with keys of its own, an agent, the server or a machine a vault runs, is added the same way, in three steps. First, the vault it joins is founded, or taken as it is: the aven itself for an agent, the seed’s new aven for the server, a device vault under its parent for a machine. Second, the device’s key is added to it, and the device signs that edit too, so no key joins a vault without its own consent. Third, a machine’s device vault gets what its owner passes on to it, or what a vault gives it over itself; an agent or the server gets nothing of its own, as it acts as the aven. Your passkey, or your Mac’s Touch ID key, signs the first two steps in one prompt. The shares need no prompt, because a share below Owner changes nobody’s control. The apps add agents and the server this way; no screen adds a machine yet.

| Case | Parent | Device | Shares |
| --- | --- | --- | --- |
| **An agent** | Your COOP’s aven itself, avenMAIA: a device of it | The agent harness’s key on your Mac | The aven’s own, no more and no less |
| **The same harness on your other Mac** | The aven again: one more device of it | That Mac’s harness key | The aven’s own, no more and no less |
| **The server** | avenMAIA itself, founded with the seed: the server is its device | The server’s key | Backup or Relay, from each vault over itself |
| **A machine a vault runs** | A device vault under that vault, yours or a COOP’s | The machine’s own key | Whatever that vault gives it later: shares over itself, or passed on from those it holds |

One flow means one set of rules to check and one view to show it. The app lists the vaults each vault owns the same way, each with its devices and the shares it holds: Maia City on your vault, its aven on Maia City, and the aven’s server and agents on avenMAIA.

### The seed and the server

A new server belongs to no vault. The first person to found a vault through it claims it, in the same prompt that founds their vault. That prompt also founds the seed: Maia City, a COOP their vault owns, where the city’s content lives, and avenMAIA, Maia City’s one aven, with the server as its device: an aven lives on its server. Each is named as it is founded. Every device finds the server’s vault by this chain, not by a name: the aven, with a device, of a COOP owned alone by a human vault. The server itself the app reaches by its address, built in. So a drive or a machine in a device vault never passes for the server’s vault, and an agent is a device of that very vault, beside the server, with the same rights. The server refuses to become a device of a human vault, which would open that person’s keys.

Each vault gives avenMAIA a share on the whole of it: Backup, so the server keeps its ciphertext, or Relay, with backups off. Every vault founded under you follows your setting, your COOPs and their avens too: it is one of your standing grants, as “All my vaults, now and later” is, which every vault you found later gives too. Your devices are often away, and the server is always there. So what your aven and its agents write, a request among it, still reaches the people it is for.

### A COOP’s aven and its agents

An aven is a COOP’s one AI identity, one per COOP and none per person: Maia City’s is avenMAIA, founded with the seed. It lives on its server, a device of it, and its COOP’s owners act as it from their own devices. Each agent harness is an agent of its own: a device of the aven, beside its server, with a key of its own. The key is who it is, never a token. Claude Code is agentClaude, Codex is agentCodex, and likewise Cursor, Grok and our own native aven. `avendb-device agent claude` is that device on your desktop, which Claude Code starts as its MCP server. A harness never names or picks an aven: it always joins your COOP’s one aven, once you approve it.

An agent acts as the aven, with exactly what the aven holds, no more and no less: no agent vaults and no sub caps. Maia City decides what avenMAIA holds: give it Suggester, with an AIP author’s share beside it, and an agent proposes and drafts and opens AIPs, and you merge. Give the aven more and every agent has more; take a share back and every agent loses it; remove one agent’s device from the aven and the others stay. An agent saves a file of your desktop, named by its path, where the aven may create, as an Editor may. It keeps a file it saved only until your desktop holds it whole, then lets go of its copy, and it reads your files from your desktop’s one store, so nothing is kept twice. Where your desktop keeps a light copy, the agent’s copy is the one copy.

A Claude Code session in Anthropic’s cloud has no desktop, so it runs agentCloud. Your desktop app makes its key (Settings, Owners & devices, Agents on this Mac, Add a cloud agent), adds it to the aven in one passkey or Touch ID approval, and shows it once; you put it in the cloud environment’s secrets. Every cloud session that holds the key is that one device, with the aven’s rights and no more, and reaches the server alone, on its relay. The relay lets in the devices the server knows and, for ten minutes, a new device that shows a passkey’s pass: of a passkey that roots a vault the server knows, or, while sign-up is open, as it is by default, of any. A cloud session shows no pass, so a key no Mac added gets nowhere. Two sessions running it at once knock each other off the relay, and it closes after a while with no call. It asks the server for nothing on its own: before each call it brings only the vaults the call touches, the vault or the entries it names, else the coop, one pull at a time. So a new session never pulls everything the aven may hold, such as the encrypted backups its server keeps of each person’s vault. Remove agentCloud from the aven and every such session loses it.

### Asking for access

An access request is a record, not a new kind of message. The vault that asks writes a record of avenDB’s request schema in its own vault: the vault it asks, what it asks for, and why. That is a share at a level (Viewer, Suggester or Editor), to co-own the vault it asks, or, from a COOP, an invitation to co-own it. It shares that one record with the vault it asks, in a group of its own, Answer: read the record, set its answer to granted or denied, and write its part of an owner add, and nothing else. Sync carries the record like any other, over avenDB’s own protocol: straight to the devices that act for the vault asked, or through any peer that keeps it, as the server does while it backs up the vault that asks. The server is one more peer, not a mailbox. So a request needs no new rule: it is a record and two edits, the share that carries it and the share or owner add that grants it.

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

An agent that belongs to no vault yet can write no record, so its first request is a file it leaves on your Mac, shown on the same screen. Approve while the agent runs, and one prompt of your passkey, or a touch of your Mac’s Touch ID key, adds the agent’s key to your COOP’s aven as a device, beside its server, and the agent’s own device signs too. It gets no share of its own: it acts as the aven, with what the aven holds. From then on the agent asks with a record, as any vault asks.

A new owner takes two passkeys: the vault’s approval, and the newcomer’s consent. So a request to co-own, or an invitation, carries the edit between the two people. The one asked approves, or accepts, with their passkey, which signs their part of the edit, and writes it into the record with granted. The one who asked finishes it with theirs, a next step on their consent screen. Neither adds anyone alone. And a new browser, opened on the link one of your devices shows, asks to join your vault on the same screen: its Approve is the one touch of your passkey that unlocks it and adds it.

Keys

## Your passkey is you, a device key is one install

Three kinds of key act for a human vault: your passkeys, a Touch ID key on a Mac where you turn it on, and each install’s device key. Your passkey is the same on every device it syncs to, and the one you set up with is your vault’s root, unless its owners hand that on. Each install of avenDB, a browser on maia.city or the desktop app, has a device key of its own, which signs what that install writes. avenDB’s master recovery key, kept offline, owns your vault too where the app added it.

| Key | Stands for | Lives | Lasts |
| --- | --- | --- | --- |
| **Your passkey** | You | In your phone’s or computer’s passkey store, synced by it (iCloud Keychain, for one) | The same everywhere: its keys come from its PRF output the same way each time, in either signature suite. It owns your vault. |
| **A Touch ID key** | You, on one Mac | In that Mac’s Secure Enclave, which never lets it out | Made when you turn Touch ID on, forgotten on that Mac when you turn it off. An ML-DSA-65 key that signs only after a touch, and an owner of your vault beside your passkey. |
| **A device key** | One install: a browser on maia.city, or the desktop app | Masked on that install’s own shelf | Made once from the install’s own randomness, kept until its storage is wiped, never made again. |
| **The unlock** | One session | In memory only | One passkey prompt, or on a Mac a touch of its Touch ID key, as the device starts. The key is wiped as the device closes. |

### Random, not derived

A device key is 32 random bytes the install draws when it is made, not something derived from your passkey. So it exists before the first prompt, and that one prompt both unlocks the device and vouches for it by its id: setting up takes two prompts, three if it makes your passkey, and signing in on a new device one, where a derived key would need one more each. A device key holds no data, so nothing is lost with it. A wiped or new install joins with your passkey and syncs from your other devices and the server, and you revoke the old one. Making an old key again would do harm: the copy would sign edits that don’t build on the old device’s own, which sync flags as a fork, as for a stolen key, and a revoked device would come back.

### How long it lasts

As long as the install’s storage. Closing a tab, the browser or the app keeps everything: the next start takes one prompt, opens with all the device had, and syncs only what changed, log by log. Only wiped storage makes a new device: cleared site data, a private window, an uninstall, a new phone. Browsers may clear a site’s storage on their own (Safari after a week unused), so every browser starts as a light copy and the desktop app as a full one.

### Where it lives, and how it is kept

A browser keeps its device in maia.city’s private storage (OPFS); the desktop app in its folder, `~/avenDB/mac/`. Beside the signed, sealed edits, public keys and file pieces, the device keeps one small record that opens it again: its name, its id, its relay, the 32 bytes of its salt, the passkey’s credential and public key, the vaults it follows, how deep its queries read, on a Mac its Touch ID key’s record, and its secret XORed with your passkey’s PRF output on that salt. Nothing a browser or the desktop app keeps on disk is a secret: whoever copies it gets only noise, as unmasking the secret takes that PRF output, which only your authenticator gives, after Face ID, Touch ID or your PIN, and only to maia.city, or a touch of the Mac’s Touch ID key, which only its Secure Enclave answers. While the device is open its key is in memory only, and wiped as it closes. What a disk can’t protect against: malware on a machine while the device is open, and the site’s own scripts, which may ask your passkey for a prompt as any page of maia.city may. Two kinds of device keep their secret on disk, as nobody is there to unlock them: the server, sealed in its bucket, and each agent on your Mac, a `device.key` file in its own folder in `~/avenDB/mac-agents/`, readable by your user alone. agentCloud’s key is in your cloud environment’s secrets.

### A drive is a device too

An external drive you use for avenDB is a device of your vault of its own, as a phone is, on the same sync, shares, copy setting and holdings. One prompt of your passkey adds it, in Owners and devices on the desktop app, and it keeps a full copy unless you make it light. It holds only ciphertext, in `.avendb` on the drive, and its key never in plain: masked by your passkey, as the desktop app’s, and wrapped by each Mac that hosts it under that Mac’s own device key, so plugging it in again asks for nothing. While it is plugged in, the Mac’s device runs it as a second node; unplugged, its last signed statement of what it holds shows when it checked. Eject it in the page, which stops its node before macOS ejects it, so nothing on it is in use. A lost drive is removed like a lost phone.

Edits and logs

## Eight kinds of signed edit, one log each

Every change in avenDB is an edit: signed, named by the BLAKE3 hash of its bytes, and kept for good. There are eight kinds. Each edit belongs to one log, a vault’s, a share’s, an audience’s or an entry’s, and its kind alone says which, so a peer that can read nothing of it can still route it.

| Kind | What it does | Its log |
| --- | --- | --- |
| **Genesis** | A new vault: its kind, owners, threshold and root | Its vault |
| **Settings** | How many owners must approve, or a human vault’s root: the passkey that approves alone, set or cleared by the vault’s approval | The vault |
| **Share** | A share, an owner or a device | Its own log, or the vault’s for owners and devices |
| **Revoke** | Ends any of them | The same log as what it ends |
| **Write** | An encrypted change of one entry, and the files it brings | The entry |
| **Mark** | Which shares pick an entry, and which keep shares want it | The entry |
| **Keys** | Boxes of one key, sealed or wrapped for exactly who may open it; a key Everyone may read goes in the clear | The key’s family: its vault’s, share’s, audience’s or entry’s |
| **Claim** | A newcomer’s vault takes an invite share, signed with the invite’s key | The share’s log |

Each edit names its log’s latest edits, the frontier, as its parents, so every log is a small graph of hashes: changing an edit changes its hash, so the edits after it no longer name it. An edit whose parents a device lacks waits until they arrive, and two edits one device signed on the same past are flagged as a fork. Every device replays the edits it holds in one order, so concurrent edits settle the same way everywhere. A removal, such as a revocation, names the edits it had seen. An edit it hadn’t seen that relied on what it took away is cut, so nobody can backdate an edit around it.

Entries and the CRDT

## Every entry merges

An entry is one record of any type: a note, a todo, an article, a story, a spark, a post, a file, a card, a profile, a schema or any other. Its type and tags travel encrypted inside its writes. Each entry is a Loro document, a CRDT: any device changes its own copy at any time, and two devices that hold the same writes read the same entry, whatever order the writes arrived in.

A record holds records: a row of a list may hold lists of rows in turn, at any depth, an outline’s nodes under nodes or a thread’s replies under replies. A place is named from the top by its chain of rows, `["nodes", {"id": 1}, "kids", {"id": 11}, "text"]`, and every walk over a record is a loop, so a deep one can’t overflow a stack. No write reaches deeper than 256 rows: a deeper one fits no schema, so no reader counts it, the same on every device.

| Changed at the same time | How it merges |
| --- | --- |
| Text (a field its schema marks as text: a block’s text, a todo’s notes) | Character by character: both insertions stay, in the same order on every device. |
| A list of records (a note’s blocks, a checklist) | Rows are matched by their id: rows added on two devices both stay, and a row moved or removed is that row and no other. |
| Rows inside rows (an outline’s nodes, a thread’s replies) | The same at any depth: each list is a container of its own in the row that holds it. A row moved within its list keeps an edit made to it meanwhile; a row moved to another list is deleted and added anew, so such an edit is lost. |
| One row id added on two devices | Both rows stay, each with the rows under it, and apps show the first. |
| A list of values (a record’s tags) | Item by item: what either device inserts or deletes holds on both. |
| Any other field, a title or a number | One value wins, and it is the same one on every device. |

e1 · on bothBuy milke2 · desktopinserts “oat ”: Buy oat milke3 · phone, offlineappends “ and bread”e4 · its parents: e2 and e3Buy oat milk and breadthe phone comes back online:both hold e2 and e3

*[Figure 4, drawn live on the page] The desktop and the phone change the same note at the same time. Once each holds both writes, both read “Buy oat milk and bread”, whichever came first. The next write, on either device, names both as its parents.*

History

## Main, proposals and variants

Nothing is overwritten: every write extends a line. Main is what everyone reads. A proposal is a line of its own that starts from any version, so a change can be tried and reviewed without touching main. A variant is a line that stays beside main and follows it, as breeds of one animal do: each merge into main comes into it, and it keeps its own where both changed one place. A draft is a new entry on a proposal of its own: main holds nothing of it until its vault merges it, and only the vault can. A copy is a new entry made from what a line shows now; a copy of a document, a spark or an article keeps its link to this history, and the original lists its copies.

Each proposal merged into main makes main’s next version: the create is v1, the first merge v2, and so on. The numbers come from the history alone, so every device reads the same ones, and they never change. Two merges made apart share a number, and the next counts past both. A version between two merges reads as "v3 + 2 edits". Each variant counts its own: "Silkie v3". A link to one version stores only hashes, the entry’s id and the version’s edits, and is labelled from avenDB: "Crawler excavator v4 · 01627d33…", with the line’s name after the number where it isn’t main: "Chicken v4 · Silkie · 01627d33…".

An asset is one entry with this history. Its first version is created together with its file. Each later version is a proposal whose one write holds both the new record and its file, and the merge makes it main’s next version. Each variant, a goat breed say, is a line beside main: after main moves on, the variant writes its own record and file. Readers find every version by the write that brought its file.

mainPropose from herea proposal: its own line, from any versionMerge into main:nothing is lostRestore and Undo are new writes tooa variant: a line besidemain that follows it

*[Figure 5, drawn live on the page]*

| Action | What it does |
| --- | --- |
| **Propose from here** | Starts a proposal from the version you are looking at, main or an older one. |
| **Merge into main** | As a pull request merges: what only the proposal changed lands, and nothing main changed is lost. Where both changed the same place, you pick which value main keeps. Rows inside a row join by id at any depth; a clash anywhere inside makes that row the place you pick, and the page says where under it both changed it. |
| **Accept** | One of the vault’s owners accepts a proposal as it stands, with a review: accepted, declined, or sent back to revise with a few words. Anyone else merges a proposal into main only once the vault accepted it, and only the version it accepted; the vault’s own merges need no review. |
| **Put it in an AIP** | Every change is put to a vault the same way, whatever entries it touches: an AIP, an Aven Improvement Proposal, names proposals on the vault’s entries, of any types, with a title and a note on why. Promoted, it takes the vault’s next number as the device counts them, AIP-1, AIP-2; two promoted apart on one number read as AIP-3 and AIP-3.2. One owner’s review answers every proposal in it at once, and a review that names the versions it saw is refused if any moved since: accepted merges them all into main, declined or withdrawn merges nothing, and revise sends it back as an idea that keeps its number. What it changes is read off its proposals through each entry’s schema, never typed. Each merge still counts on its own, so a device that holds only some of them shows only those. |
| **Update from main** | The same merge the other way: brings what main gained since into the proposal. |
| **Restore** | Puts back any older version, as a new write. |
| **Undo** | Takes out one older edit by a three-way merge, keeping every change made after it, at any depth. Undoing a merge takes out only what the merge itself wrote, so both lines’ changes stay; restore the version before it to take back the merge. |
| **Start a variant** | A line of its own that stays beside main, as breeds of one animal do. Each merge into main comes into it in the same step, and where both changed one place, the variant keeps its own. It has its own numbers, Silkie v1, v2, and says which version of main it holds. |
| **Make a copy** | A new entry, in this vault or another, with what the line shows now and its tags. A copy of a document, a spark or an article names this entry and that version in its first edit, by the hashes of its edits, so its history goes on into this one’s. |

None of them asks for the passkey: the device’s own keys, unlocked at start, sign them.

Shares

## A share says who may do what, on which entries

Every permission in avenDB is a share: **who**, at which **level**, on **what**. People, COOPs, avens, the machines a vault runs, Everyone, an invite and each of your own devices are given shares. The server and an aven’s agents hold none of their own: each is a device of an aven, the server of avenMAIA, and acts by that aven’s shares. On the wire, a vault’s owners and its devices are shares too, so the device lists them with every other share, and Revoke ends any of them. Every device checks every write against the shares its author relies on, so a write no share allows counts for no one.

| Who | How it works |
| --- | --- |
| **A vault: a person, a COOP, an aven or a machine’s device vault** | It reaches every device that acts for that vault, so a new phone needs no new share. |
| **Everyone** | Read only. Its key is published in the clear, and it goes only to devices with a reason to ask. |
| **One of your own devices** | Only as a keep share: what that device syncs. It grants nothing. |
| **An invite key** | A one-time key: the newcomer’s vault claims the share once at sign-up, with no owner tap. |

**What** is everything in the vault, or a selector over an entry’s labels: its type, the vault that created it, its id, when it was created, and its tags. Tags change, so a share reaches every entry tagged so, now and later. A share is also a group of JSON ops, and its **level** is the class of its strongest op. It carries its own ops, or names a cap group the vault defines. In the app, one Share form makes a share wherever a page offers to share; an invite, a stage made public, the answer to an access request and each device’s copy setting are made where they happen. A vault’s Sharing page is the one place that says who has it.

```
{ "name": "Tick work",
  "where": { "all": [{ "type": ["todo"] }, { "tag": "work" }] },
  "ops": [{ "op": "read" },
          { "op": "set", "path": ["status"], "to": ["doing", "done"] }] }
```

*[Figure 6, drawn live on the page] Bob may read the todos tagged work, and set their status to doing or done.*

An op names its place at any depth, and `"*"` stands for any row or any field: `["nodes", "*", "kids", "*", "text"]` is the text of any row under any node. An op on a row covers everything under it. The Share form offers every field of the schema at any depth, in words, and each list of rows to add to, delete from or reorder. A merge op may name a place too: a tuner that may merge `["params", "*", "default"]` into main merges, once the vault has accepted it, a proposal that only changes the defaults of the params, and not one that also changes its source. Any merge into main through a share counts only on top of the vault’s accept, and brings in only what was accepted.

| Group | Level | May | Typical for |
| --- | --- | --- | --- |
| **Owner** | Owner | Everything, and share on | Co-owners, on the whole vault; anyone, on a slice |
| **Editor** | Write | Read, create, set, tag, propose, merge | Someone who works on the entries |
| **Suggester** | Write | Read, propose and draft new entries; set and merge on proposals | Someone who proposes: main changes only once one of the vault’s owners accepts |
| **Viewer** | Read | Read | A reader |
| **Public** | Read | Read, for Everyone | Anything published: its key goes out in the clear |
| **Backup** | Backup | Keep the ciphertext, read nothing | The server, by default |
| **Relay** | Relay | Find the vault’s devices, keep nothing | The server, with backups off |

The selector, the name and the ops travel sealed, to the vault, the holder if it may read, and whoever gave the share; a share to Everyone or to an invite carries them in the clear. In the clear a share shows the vault it is over, who holds it, its level, whether it covers the whole vault, the share it rests on, who gave it and the cap group it names, so the server learns nothing of what a sealed share picks or allows. A share may rest on another, and a chain of shares allows only what every share of it allows.

### Cap groups

A cap is one op over one slice. A cap group is an entry of its vault with a name, its caps, and the groups it includes. A share of a cap group names the group and holds no copy of its ops, so a new version of the group reaches every share naming it at once. Every share over a vault picks its cap groups, so whoever reads anything of it judges each write alike. Revoke ends one share. To narrow what many hold, change the group. Owner, Editor, Suggester and Viewer are fixed in the engine. Maia City defines Traveler (read its games, asset recipes, views, logic and configs), Citizen (Traveler, and read every entry of MaiaCity V1; V1’s moves still run on maiaCITY’s API, so none of them is a cap yet) and Admin (Citizen, and read all of Maia City). A group share’s level is what its caps need, and it never grants an op above that level, whatever a later version of the group says.

### Invites, and who the server takes

A device that acts for Maia City gives a Traveler group share to a one-time invite key, with no passkey prompt, and the invite link carries the share and the key after its `#`. At sign-up the newcomer’s new vault claims it, signed with that key, and the share is theirs: no owner taps anything. A claimed invite can’t be claimed again. maiaCITY’s API signs the newcomer up on the same link: it asks avenDB’s server whether that invite is still open, and takes each one once. The server’s gate is off unless it is started with it. With its gate on, the server takes a new human vault only once it holds a share of Maia City, as the invite it claims gives it, or owns Maia City; a new COOP or aven only where an admin owns it: Maia City, an owner of it, or a holder of its Admin cap group; and a machine’s device vault always. Anyone may still make a vault on their own devices, but the server keeps none it hasn’t taken.

### Passing a share on

A share may rest on a share its giver holds over the same vault, one still live and not a keep share. It must be no stronger than that share, and cover the whole vault only if that share does. And one of two things must be true: the share it rests on is an Owner share, which lets its holder share on with anyone; or the new share goes to a vault its giver owns directly. This one rule covers every case. The second part is safe because an owner added every key of the vault it owns and can remove each one, so what it passes on goes nowhere it can’t take back.

| Case | The share | Why it may |
| --- | --- | --- |
| **A COOP shares with its aven** | Maia City gives avenMAIA Suggester | Maia City gives a share over itself, resting on none |
| **A COOP passes a share on to a machine it runs** | Maia City passes a share on to its render machine | Maia City owns the machine’s device vault |
| **A COOP passes a share on to its aven** | Maia City passes on a share another COOP gave it | Maia City owns avenMAIA |
| **An Owner of a slice shares it on** | Whoever holds Owner on the todos tagged garden shares them with Bob | It rests on an Owner share |

Some shares are never made: one from a vault to itself, one to Everyone beyond Read, Owner to an invite, and Owner on a whole vault, which is a co-owner and comes only with the vault’s approval and the newcomer’s consent. Giving or ending an Owner share on a slice takes the approval of the vault that does it, and a vault’s last owner can’t be removed.

### Owners and devices

An owner is “Owner on Everything”: a co-owner who approves changes to the vault. Only signers own a human vault: its person’s passkeys, a Mac’s Touch ID key, and the master recovery key it is founded with. Its root, the passkey it is founded with, approves any change alone. The vault’s approval, with the new root signing too, sets another root, or none, and in a clash between owners the root ranks as any owner. An aven and a device vault take exactly one owner. An Owner share on a slice, one todo or one tag, is something else: its holder may share that slice on. A device “acts for” its vault: it writes as the vault and approves nothing.

### Keep shares: what each of your devices syncs

A keep share goes from your vault to one of your own devices, by the same selector as any share, over your vault, or over another your vault holds a share of at Backup or more. It grants nothing: it says what that device syncs, and whether it keeps files whole.

| Keep | What it does | Typical for |
| --- | --- | --- |
| **Keep whole** | Syncs the entries it picks, and keeps their files whole | Your desktop, for the originals |
| **Keep when opened** | Syncs them, and fetches a file’s pieces as they play | Your phone |
| **Never keep** | Doesn’t sync what it picks | An archive the phone never needs |

Each device also has one copy setting, a keep share over its whole vault that also stands for every other vault it syncs and has no keep share over: a full copy keeps every entry and file whole, a light copy syncs every entry and fetches a file only when it is opened. You pick it when the device joins, the desktop app full and any browser light by default, and change it in Owners and devices; the app makes no other keep share yet. With neither, the server keeps every file whole and any other device fetches pieces as it reads them. A keep share that syncs anything always brings the vault’s schemas, lenses and cap groups along. Only the vault that made it can end it, so nobody else can force your phone to sync more.

### All your vaults, now and later

A standing grant gives another vault a built-in group below Owner on the whole of your own vault. Every vault yours owns gives it the same, and so does each vault founded under you later; an aven or a device vault gives none that reads, as each serves its one owner alone. Revoking it ends it in every vault it reached, and no vault founded after follows it.

### The server: Backup or Relay

Each vault gives avenMAIA, the aven the server is a device of, a Backup share on everything when it is founded: the server keeps the ciphertext of every entry, and opens none. With backups off it gives Relay instead: the server learns the vault’s devices, to let them through its relay, and keeps nothing of its entries. Every vault founded under you follows your setting, and one switch changes it for all of them.

### Revoking

Revoke ends a share and every share resting on it. An agent holds no share of its own, so a COOP that revokes its share to its aven takes it from every agent at once. Whoever gave a share may revoke it, so may the vault it is over, and its holder may give it up. The entries it reached move to a new key, sealed only to the shares still live. What was read stays read.

Audiences and keys

## One key for what the same shares pick

Entries are not encrypted with one key each, nor with one key for the whole vault. Each entry carries, in the clear, its audience: the shares that pick it by their selectors. A share over the whole vault reaches every audience of it without being named, and a keep share is never in one. An audience has one key per epoch, and each entry’s key is derived from it. Share the todos tagged garden with Bob as an Editor, and every todo tagged garden has the audience “that share”. Bob gets its key once. An entry created through a share starts in that share’s own audience, so its maker reads what it made, until a device of the vault’s own marks it into the audience its labels call for.

Tag another todo garden and a device of the vault’s own marks it into that audience, with a link that lets its readers read its whole history. Revoke Bob’s share and the audience moves to a new epoch, with a key only the remaining shares get: what Bob read before stays his, and nothing new reaches him.

The audience is in the clear for a reason. The server reads no selector, type or tag, yet it checks every write: the mark on each entry tells it which shares may write there. The marks provably mean what the shares say, so the server lets through and keeps exactly the edits an owner would. Whether a write’s content fits its ops and its schema, only its readers judge.

| When | What gets new keys |
| --- | --- |
| A share is given, a vault gains a device | A few boxes: the share’s key to its holder, the vault’s seed to the device |
| A share is revoked | Each audience it reached moves to a new epoch, boxed to the shares still live |
| A vault loses a device or an owner | Its seed moves on, and with it the keys in use under it |
| An entry’s tags change, a new share picks it | One mark, with a link to its earlier keys |

Keys are derived inside the vault. Where the sealer already holds the key a box goes to, it wraps the key under it, with no public key at all; every other box, as one to a person or a device, is sealed with X-Wing and Classic McEliece together. A key Everyone may read goes in the clear. Backup and Relay shares get no key at all.

Schemas and lenses

## Change the shape, migrate nothing

Every record has a schema: a JSON Schema, named by its hash. When a schema changes, a lens says how a record of one version reads as the other, both ways. No record is ever migrated: an edit stays in the version it was written in, each app reads through the lens in its own version, and its edits go back as only what changed. So an old app and a new one edit the same todo side by side. An app follows one lens: an entry written under its own version and at most one other, with a lens between them, opens to edit, and anything else opens read-only.

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
- **avenDB’s own schemas ship with every app**: documents, todos, articles, stories, sparks, artifacts, artworks, flows, functions, posts, reviews, bundles of proposals, policies, AIPs, access requests, cap groups, the code entries (recipes, views and logic: their source, a recipe’s in the file it brings, the engine they run on, a manifest of the names they say they use, their params and a contract; a recipe also its asset’s card; a view also its data, its input, its height, its form, HTML or A2UI, and its own logic), and a device’s card, a vault’s profile and a file, each starting at version 1. A kind that grew ships its older versions too, with the lenses between them, so a spark written as version 1 opens on version 2’s canvas, an article written as version 1 opens as it was, ready to be linked to its story, and a view of version 1 opens as version 2’s HTML view. A vault founded before a version shipped takes it at once, as every app reads through its own copies. An artifact is one source standing on its own, a link, a picture, a clip or a YouTube video with its chapters and words; a spark is a canvas of artifacts, sparks and free notes; an artwork is a story’s card of one shape, in layers, rendered into the Library. Every vault reads and writes them offline, and Maia City holds each as an entry of its own, with the same bytes and so the same id. The todo’s version 0 above is the lens engine’s worked example, which lives only in its tests.
- **Flows are stages an entry of the types a flow names can be in.** A post goes from idea to draft to published; a story from its idea through its hook, thumbnail, journey, writing, movie, derivatives and schedule to published, every stage of it private. The app ships no flow for articles. A stage is a tag, so a move is one tag change, and a public stage is one Public share on that tag. Functions react to a move: each runs in QuickJS on the device that moves the entry and asks for changes, which its vault’s shares still decide. A function may ask for a new entry in its vault, for a set, unset, insert, remove, move or tag on the entry moved, its posts and its pictures, and for a Public share of those or of an entry it made. The functions that run are the entry’s vault’s own, Maia City’s where the person’s vault owns it, and the app’s. Publishing a post moves it to Published: a Public share on that stage’s tag makes it public, and one on its vault’s profile makes that public too; the app’s Publish function then tags the private pictures it shows, so they go public with it, and the server’s feed serves them to the Maia Universe stream (`/feed/posts`). A story’s posts are made and published in its Derivatives tab.
- **Public entries and code, for every page and the API.** The same feed serves every entry everyone may read, of the kinds a page asks for, with its record, its schema and the version every reader agrees on (`/feed/entries?type=story,article`), the views, logic, recipes, functions and configs among them (`/feed/code`), any one of them whole (`/feed/entry/<vault>/<entry>`), and the files a code entry brings, as plain text no page runs as a script (`/feed/entry/<vault>/<entry>/file`). `vault=` keeps one vault’s, and `bare=1` leaves the records out. It also proves a vault’s code: the signed edits that make some of its code entries, or all of one kind (`/feed/proof?vault=<vault>&type=recipe&entry=…`), which a device checks itself. Beside them it serves the public posts (`/feed/posts`), the pictures they show (`/feed/files`), the site’s media (`/feed/media`), and whether an invite is open (`/feed/invite/<share>`). Anyone can call a vault Maia City, so the feed names Maia City only where it stands in the server’s seed, and `?seed=1` keeps its entries alone. Every page, signed in or not, and the API, every minute, read code and configs from it by Maia City’s vault id, run only what its proof proves, and check them again as they load (Code in a box).

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
{ "ok": { "rows": [{ "entry": "…", "vault": "…", "type": "todo", "tags": ["garden"],
                    "created": …, "author": "…", "schema": "…", "readOnly": false,
                    "record": { "title": "Water the figs", "status": "doing" },
                    "cut": false }],
          "count": 1, "plan": …, "depth": 16 } }

{ "refused": "NotAllowed",
  "why": "the ops of the shares the vault acts through don't allow what it does" }

{ "approve": { "challenge": "…", "signers": ["…"], "draft": "…" } }
```

*[Figure 11, drawn live on the page] What comes back: what it found, a refusal and why, or what your passkey must approve*

A query reads each record 16 rows down unless it asks for another depth, and never deeper than the most your device allows, which you set in Settings, from 1 to 256. A list of rows deeper than that isn’t read, and the answer says so for that entry (`"cut": true`). A query also follows the links at the places it names, a level at a time: each hop opens only what your device may read there, and a hop that opens nothing says why. Every row and every hop is one level, so a long chain of links, or a cycle, ends at the query’s depth. Your device holds what it reads, so a query pages over it there: `offset` skips so many rows, `limit` takes at most so many, and `count` says how many matched. A query may also keep one `vault`, read through a `schema` it names, or as stored, and `select` only some fields; the answer says which schema read each row, whether it may be changed through it, and the `plan` the labels picked entries by. `get` opens one entry on a line, at a version or at a release number, and `history` lists its lines, their releases and every write the device holds, and why one isn’t counted.

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

Before it shows a button, the page asks `may`: would this device be allowed to make the op, on what it holds now? So a button you see is a change you may make. The page keeps no rule of its own: it reads levels, ops and who may do what from the device’s answers. A `batch` runs several changes of entries in order, each run of record ops on one entry making one write. At the first one refused it stops, and says which and what ran before it, which stands. A create that brings a file never goes in a batch.

Most changes need nothing but the device. A change the vault’s owners must approve, such as a co-owner, a new device, a threshold or new vaults, is drafted on the device and signed by your passkey, or on a Mac by its Touch ID key, in one prompt however many edits it makes. With no passkey at hand, as for an agent, the answer is `approve`: what to sign and by whom, and nothing is made until it is signed.

An agent speaks the same ops through its MCP tools. It acts as its aven, so the aven’s shares decide what each op may do, and it asks for more with the `ask` op, as any vault asks. It may not make `follow` or `set_limits`, a device’s own settings, and it has one op of its own, `get_file`, which reads a file of a vault back to a path it names. Its tools are `avendb_vaults`, `avendb_ask` for reads, `avendb_run` for changes, `avendb_request_access`, `avendb_add_spark`, `avendb_add_artifact` and `avendb_read_file`.

Code in a box

## Code from a vault runs in a box

A vault holds code as well as data: a recipe builds an asset, a view draws a screen, a function reacts to a move, and a config sets a game’s numbers. Each is an entry like any other, with versions, proposals and shares, and none of it is trusted. A page runs it only in a box: a frame with no origin, running an engine of ours that never changes, so the code reaches neither the network, nor storage, nor the page around it. A config runs nothing: our own code reads it as data.

Every box is a frame allowed only to run scripts. It has no origin, so it holds no cookie, no storage and no passkey of ours, and it can’t reach into the page. Its policy lets in no connection, no frame, no form and no plugin, and every device feature is off, from the camera to the clipboard and full screen. The code runs in a worker inside it, never in a window, and before it starts, fetch, sockets, storage, caches, channels and new workers are taken off the worker’s global scope. In the asset box each recipe gets a worker of its own, which no other recipe’s code ever ran in; the frame marks every answer with the worker it came from, and the page takes an answer only from the worker it asked, so one recipe can neither hear another’s builds nor answer for them.

The page around the boxes has a wall of its own. Every page of the site carries a script policy: only our own scripts, the two box frames’ scripts by their hashes, and WebAssembly run, never an inline script, an inline handler or `eval`. The OS, the Mac app, sets the same script policy and allows connections only to itself, its own protocols and our servers.

The engine that runs the code is a file we froze, one per version, served from our own site. The page checks its BLAKE3 hash before it starts it, and nothing comes from a CDN. A new engine is a new version beside the old ones, and pages run the latest of each kind. A build or a call that runs past its time, 20 seconds in the asset box and 10 in the logic box, ends with the frame and its worker removed.

Code hands back plain data, never code, and the page checks it again. The asset box sends a model as numbers and named materials; the page builds it with its own materials, within a budget of nodes, triangles, pictures, lights and bones, and holds the card that comes with it to the recipe asked for. Logic sends JSON. A view sends HTML, which our engine cleans again before it draws it, and messages of the MCP Apps protocol, of which the page answers eight; it can’t call a tool, read a resource or open a link.

| Box | It runs | Where | It may reach | It never reaches |
| --- | --- | --- | --- | --- |
| **Asset box** | A recipe: an asset’s file, from a vault | A worker of its own, one per recipe, in a hidden frame with no origin | Three.js and four of its add-ons, its file and params; 20 seconds a build | The network, storage, cookies, the page, avenDB |
| **Logic** | A flow’s functions; a view’s logic, which no view shown has yet | QuickJS, in a worker in a hidden frame with no origin | The JSON it is handed; 8 MB and a set amount of work a call | Anything else: it is given no function of the host |
| **View frame** | Our view engine alone, drawing a view’s cleaned HTML | A frame with no origin, in its place on the page | Its own DOM, the maia-* components, pictures from data: and blob:, its port to the page | The network, storage, cookies, the page, popups, forms |
| **View worker** | A view’s own script | A worker the view engine starts in the frame | A stand-in DOM, up to eight canvases, Three.js, d3, the MCP Apps client, and eight MCP Apps messages to the page | The network, storage, the frame’s real DOM, the page, tools, resources, links |

### Logic, in QuickJS

Logic runs in QuickJS, a JavaScript engine built to WebAssembly, in a box of its own. It is given no function of the host: a JSON text goes in and a JSON text comes out, with no typed arrays, no timers and no I/O. It has 8 MB, a 256 KB stack and a set amount of work for each call, and its random numbers and its clock come from what it is handed, so the same input gives the same answer. Today only functions run there. A function’s answer is ops, which the device bounds before it makes them: a new entry in its vault, a change to the entry it moves, its posts or its pictures, or a Public share of those entries or of one it made. One op outside that, or a wider share, and the function makes nothing; its vault’s shares still decide each op. A view’s logic would run there too, but no view shown today has any.

### A view

A view is HTML, or A2UI turned into HTML with our maia-* components: cards, metrics, badges, progress bars, charts, tables and lists. Its frame runs our view engine alone, the only script that ever writes its DOM, from the view’s HTML cleaned of scripts, handlers, links and outside pictures, and it cleans again each value the view’s template fills into an attribute. A view’s own script runs in a worker the engine starts, against a stand-in DOM it can’t see past; the engine cleans each picture the worker sends before it draws it, and lends it at most eight canvases. The worker gets Three.js, d3 and the MCP Apps client from frozen files of ours, and nothing else. One that doesn’t answer for four seconds is stopped, and so is a view whose frame loads a second page. A view is handed only the data its page passes it, and a page never puts one where a person decides: the page’s own buttons stay outside it, and its own panel is one tap away.

MCP Apps here is the protocol a view speaks with the page that shows it. It is not an agent’s MCP tools, which speak avenDB’s JSON ops (JSON ops).

### Checked as it loads

One checker knows every kind of code and says what can’t work in a box: a view, a game’s screen, logic, and a config, which it holds to the shape of the repo’s own, so a config from a vault changes a game’s numbers, never what the game finds where. Nothing checks code on its way into a vault, so a page and the API check each view, logic and config as they load it, and MaiaCity V1 checks each screen a proposal brings. A recipe loads only if it was made for the newest box engine, its file hashes to the name its card gives, and its last line names the version its card says; a build this device kept is held to its card again when read back. A function is checked before it runs: it imports nothing and hands back its `run`, or it doesn’t run. Safety never rests on the checker: the box holds whatever it misses.

The kernel, which is the boxes, the engines, the checker, the render core and the Markdown engine, changes only with its tests green. A gate runs them on every pull request and before every deploy, and the deploy stops if they fail. It also runs two probes in headless Chromium: code made to do harm tries every way out of the asset box and of a view, through the network, storage, the page, its links and its markup, aiming at a canary server that hears anything that gets out, and code that never stops or eats its memory must be stopped.

### Where it runs today

Most code that runs from a vault is Maia City’s, read from the feed by its vault id: the recipes of every 3D world, MaiaCity V1’s default screen, and the configs the games read. avenDB’s Assets page builds the recipes of any vault the person reads, and the recipes an AIP proposes build in a box too, before anyone accepts them. Functions come from the entry’s vault, from Maia City where the person’s vault owns it, and from the app. The OS, the Mac app, runs the same pages and boxes in macOS’s WebKit.

### The games are not boxes

The game sandboxes and MaiaCity V1 are our own trusted code, not boxes. From a vault they read only data and recipes: the sandboxes read their configs, of biomes, a garden, rules and specs, and the recipes they take from it build in the asset box. No game runs a vault’s logic in QuickJS yet. V1’s rules are one module the API and the page share, and a new game takes its settings from a config, each value outside the game’s limits replaced by the seed’s. V1’s default screen comes from the vault, but the game, its moves and the screens its proposals add live in maiaCITY’s Postgres, outside avenDB’s shares, history and proposals. Each screen still shows in a view frame, and its events change nothing.

### Proven to be Maia City’s

A page and the API run only the code Maia City’s own signed edits prove, checked on the device that runs it. Maia City’s vault id is written in the repo, not set by a server or a deploy. Beside its list of code, the feed hands out a proof: the signed edits that made the code, with the shares and devices that let its signers write it, and nothing private. The device takes them as any device takes a sync: avenDB’s WebAssembly checks every signature, replays the vault’s rules, and reads back the code of that one vault, by its id, never by its name. A row the server made up or changed, or a write the vault never signed or its shares don’t allow, is in none of it, and doesn’t run.

Views, logic and configs come in one small proof. A world’s recipes come in one proof for the whole page, of the recipes it builds and no others, asked for once, never one at a time. A recipe builds only once its proof checks out and holds the same hash under the same name as the list says. A device keeps the code it proved, not the proof, and on its next visit only asks whether the proof changed. Until the vault id is set, pages and the API run the repo’s own views, logic and configs, and the 3D worlds build nothing and say why.

### Not protected yet

- **Scripts from blob: addresses.** The page’s script policy still lets in scripts from `blob:` addresses, which the box frames start their workers from, until each box is a document of its own. The OS lets pictures and media come from any https address, as people’s own files do.
- **Our own code.** The kernel’s tests and both probes gate every pull request and every deploy, but the pages, the game sandboxes and V1 are our own code and are trusted, and the probes run only in Chromium, not yet in WebKit, which The OS and Safari use.
- **The newest of Maia City’s code.** A device checks that the code it runs is Maia City’s, not that it is all of it or the newest: the server can leave an entry out, or serve an older version Maia City signed.
- **One recipe’s crash.** A recipe that crashes or runs out of time still takes down its whole box, so the other builds in it start again: a delay, never another recipe’s model.
- **Memory and time.** Only QuickJS has a memory cap, and a view’s script is stopped only once it stops answering.
- **What code declares.** An entry’s manifest and contract aren’t enforced, and its engine version isn’t pinned: a view or logic runs on the latest engine of its kind.
- **What a function makes.** A function may make entries of any type in its vault, flows and functions among them. Only the functions of the entry’s own vault, Maia City’s and the app’s run, so only those vaults can.
- **PDFs in the Library.** Chromium shows a PDF only in a frame with no sandbox, so the Library’s PDF frame holds a policy instead: no script runs in it and it loads nothing. A link inside a PDF still opens in the avenDB tab, and WebKit, in The OS, ignores that policy.

The whole system

## Desktop, phone and server: one protocol stack

Every device is a full avenDB node with its own shelf: a folder on a desktop, the page’s private storage on a phone or in a browser. The server is the same kind of node, and its shelf is a sealed bucket. A desktop and the server talk to other devices directly whenever the network allows it, and through the relay when it does not. A phone, a browser or an agent in a cloud session always goes through the relay. So as it sets up or signs in, a browser first waits up to 20 seconds for the relay to let it in, then reaches the server: a dial sent sooner would be lost, and tried again ever later.

DesktopavenDB device, native, beside the appone shelf, a folder:edits in packs,files as sealed blobskeeps what its keep shares sayPhone or browseravenDB device, in the pageone shelf in OPFS,laid out as on a desktopstreams files as they play,keeps what its keep shares sayavenDB server · Hetznerrelay: lets your devices meetsync peer: always onlinebackup: ciphertext of your vaultssnapshots: every vault, every nightits shelf is the bucket;its disk, a cache it can lose:parts read lately, blobs in transita device of avenMAIAObject storagemaiacity-avendb, hel1g<n>/journal/g<n>/heads/g<n>/blobs/g<n>/outboards/g<n>/stated/g<n>/device.keysealed, locked 7 daysthe server's truthQUIC end to end,through the relayuppartsedits, holdings and control (avendb/sync/1)file bytes and McEliece keys (iroh-blobs, BLAKE3 verified)through the relay: phones and browsers always, others when no direct path

*[Figure 14, drawn live on the page] Every arrow is encrypted, and so is every body inside it: the server checks who signed what under which share, and opens only what is public or shared with avenMAIA, the vault it is a device of. Keys never leave the devices of the people a vault shares with, and the server seals every object again before it goes to the bucket. Each night it also snapshots every vault into a second bucket, `maiacity-avendb-snapshots`, sealed and locked the same way.*

Inside one node

## The layering n0 intends, and what avenDB adds

iroh’s own guidance: an endpoint, a router that hands each connection to a protocol by its ALPN, the app’s own protocol for app logic, and iroh-blobs for bytes. avenDB has all four. Its sync protocol decides what moves and carries the edits; iroh-blobs carries McEliece keys and file pieces, verified as they arrive.

Lab: vaults, shares, audiences, keys, Loro entries, JSON opsdecides what counts, opens what this device may read, keeps marks and keys up to dateShelf store: iroh-blobs over one shelfa folder on a desktop, OPFS on a phone or in a browserOn the server, the shelf is the bucketevery object sealed, its disk only a cacheavendb/sync/1hellos, frontiers per log, holdings, asks/iroh-bytes/4 (iroh-blobs)one pool, verified ranges, resume, GetManyEndpoint and router (iroh 1.3)one id per device · QUIC · TLS 1.3 with X25519MLKEM768 only · hole punching where it has UDPTransportUDP when direct, avenDB's own relay otherwise (WebSocket for browsers)avenDB's own coden0's crates

*[Figure 15, drawn live on the page] The sync protocol carries edits and decisions: what changed, who holds what. iroh-blobs carries bytes, and lets a device in only beside a sync connection whose hello proved it. Both share one endpoint, one identity and one post-quantum TLS setup.*

Sync

## Devices say what they hold, and ask only for what differs

Each connection opens with a hello each way: the device’s post-quantum signature over the TLS session, so both ends know which device they speak to. Then each tells the other its holdings: for every log it may share with that peer, its frontier, and for every file, whether it holds it whole or in pieces. After that it sends only what changed. A device that hears of a head it lacks asks for that log alone, and gets only what it lacks, in pages of about 4 MiB. Order never matters, so any device can sync with any other, in any order, any number of times.

### Shares: what a device may get

A peer sends a device only the entries its vaults may receive, the logs needed to check them, and nothing else. A relay share gets the vault’s devices and no entry.

### Keep shares: what it wants

Whole, when opened or never, by the same selector a share uses. Your phone fetches pieces as it plays. Your desktop keeps whole what you set it to keep, and every file you add on it. The server keeps all.

### Holdings: who has what

Only what a device holds for good, on its shelf. Announced, they count only from the device itself, said on its own connection, and choose whom to fetch from; signed, they pass from node to node and only show. Both fill in “Synced to”. They never grant anything.

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
| **Card** | A request for the contact card of a server or an agent | The logs of the vaults it acts for, avenMAIA for the server, and of every vault that owns them |
| **Claim key, Claim** | Asks a device that belongs to no vault yet, an unclaimed server or a new agent, for its key, then adds it to its device vault | The key; the claim, signed by the claimed device too |
| **Invite** | The id of an invite a link names | The invite’s card, while no vault has claimed it |
| **Sign up** | A newcomer’s vault logs and its claims of invites, at once | Nothing, once the server took every new human vault in it; refused otherwise |

Every message is a stream of its own on the one avenDB protocol, with exactly one encoding for every value. Announcements go straight to one proven device, never by gossip, and no node announces another device’s holdings: what it passes on is only that device’s own signed statement.

### Signed holdings: “checked 2 h ago”

An announcement counts only from its own device, said on that device’s own connection: no node can pass it on. So each device also signs what it tells a peer it holds, with when it checked: a statement, signed with its post-quantum key like an edit and good for nothing else. It hands a peer one as they connect, a new one once its holdings change, at most every 10 seconds, and again every 15 minutes while they stay the same, and reuses one it signed less than 15 minutes ago for the same holdings. It hands them only to the peers it is connected to. Every node, the server no less than your desktop, keeps the newest statement of each device it knows, whoever brought it, passes it on to each connected peer that may know all it says, and keeps it on its shelf, so it outlives the device’s connection and the node’s restarts. A node also keeps what a device it knows last announced after that device disconnects. “Synced to” lists a device connected now by what it announced, and any other by its newest statement, with when it checked, so the phone in your drawer shows as “checked 2 h ago”; a device of which no statement reached the node, by what it last announced. Statements only show: a node asks and fetches by what devices announced, connected ones first, and no statement lets anyone fetch anything.

Files

## An edit is a small record, a file is a list of big blobs

| Thing | What it is | Typical size | Where a device keeps it |
| --- | --- | --- | --- |
| An edit (a write, a share, a mark) | A record, not a blob of its own: its bytes and each signer’s signature, ML-DSA-65, or SLH-DSA from a signer made before ML-DSA-65 came in; a write’s body is encrypted | about 5 or 17 KiB per signer, then its body | In a journal entry, then a pack |
| A pack of edits | One blob of many edits, named by a head | 64 saves, or the whole log | On the shelf |
| A McEliece public key | One blob, named by its hash in the edits that use it | about 1 MiB | On the shelf |
| A photo, a document | One sealed blob | up to 1 GiB | On the shelf, with its outboard |
| A film or a camera card | A HashSeq of sealed 1 GiB pieces | 1 GiB to many TB | Whole, or fetched as it plays |

Every edit and every blob has one name, the BLAKE3 hash of its bytes, an edit’s before its signatures, which sign that name. A blob’s name is also the name iroh stores and moves it by. Edits are kept in a journal, then in packs, and travel in sync’s replies; files are kept in pieces. Packs and pieces are blobs. The write that brings a file names the file’s root hash and sealed size in the clear, because the server and other devices need them to back the file up and to know who may fetch it. The file’s key sits inside the write’s encrypted body. Whoever may fetch the write may fetch its files, and nobody else.

Every vault has a Library that lists its files by kind: films, images, SVGs, PDFs, audio and other files. A file is an ordinary entry of type `file`, a document named after the file whose first write brings it, so shares, sync and deletion work on it as on a note. A film plays as it streams: the player asks for byte ranges, and the device fetches only the 64 KiB segments those ranges need, verified by iroh-blobs, and opens them. The database lists files too, as a table like any other, with each file’s root, size, sealed size and pieces.

1 · The file, in plaintext…65,520 B65,520 B65,520 B65,520 Bkey K derived from the file, keyed by your vault’s current seedChaCha20-Poly1305, nonce = segment number + last flag2 · Sealed segments, each exactly 64 KiB…64 KiB64 KiB64 KiB64 KiB16 KiB16 KiB16 KiB16 KiBfour iroh chunk groups: each verified on its own,so a seek fetches whole segments and nothing more3 · Pieces of 16,384 segmentspiece 0 · 1 GiBpiece 1 · 1 GiBpiece n · restover 1 GiB: HashSeq root = piece hashes4 · The write that brings itin the clear: root hash, sealed sizeencrypted: key K and length, with the entry’s name and typethe write is signed and synced like any edit;the pieces follow, from whoever holds them

*[Figure 16, drawn live on the page] This format is called sealed blob v2. The tag adds 0.024 %. Pieces cannot be swapped or reordered, because every nonce counts segments across the whole file. Whoever holds the key verifies by decrypting; everyone else verifies the ciphertext with BLAKE3. A file that seals to 1 GiB or less is one piece, whose hash is its root. A file’s key is derived from what it holds, keyed by a secret of the current seed of the person’s vault: the same film added again by any of their devices seals to the same blobs, kept once, until that seed changes, while another person’s copy seals to unrelated ones.*

Roundtrips

## Six journeys through the system

Swipe a diagram sideways to see all of it.

### 1 · You write a note

YouDesktopavenDB serverBucketPhone1type in the note2sign the edit, encrypt its body, save it on the shelfit counts now, online or not3holdings: this note has a new head4ask for that log alone5the edit, ciphertext6check signatures and shares, keep it7seal it into the journal8held, locked for 7 days9holdings: the server holds itSynced to: the server10holdings: that note changed11ask for that log12the edit13open it, merge it into the note

*[Figure 17, drawn live on the page] If the desktop and the phone reach each other, they sync directly too, and the server only catches up. The server says it holds an edit only once the bucket does, so its holdings are the receipt: until then the desktop sees the server lacks it, and the server keeps trying to save it. Only logs that changed are named, so a quiet vault costs nothing.*

### 2 · You add a 2 TB film on your desktop

loop[every 1 GiB piece, as it is read again]loop[each piece]YouDesktopavenDB serverBucket1drop the film into a vault2read the whole film once, to derive its key3seal 64 KiB segments, hash with BLAKE3, shelve it4write the HashSeq root, sign one write that brings it5sync the write (small, at once)it keeps every file whole6get the root, then piece after piece7bytes, verified every 16 KiB8sealed parts of 8 MiB9its outboard, lasta dropped link resumes at the next missing range10holdings: the film, wholeSynced to: the server

*[Figure 18, drawn live on the page] Your uplink sets the pace: at 54 Mbit/s a terabyte takes about 41 hours, at 1 Gbit/s about 2.2 hours. The desktop keeps working the whole time. The film is in your vault once the desktop has read it twice, once for its key and once to seal it, and the upload starts then. A piece counts on the server once its outboard is in the bucket, written after every part.*

### 3 · You play it on the phone and jump to minute 93

alt[the desktop holds that piece and is reachable][only the server]YouPhoneDesktopavenDB serverBucket1play, then seek to minute 932byte offset to segment, piece and range3get piece 1,412, a 4 MiB range4verified bytes from its shelf5get the same range6the 8 MiB part that holds it, unless cached7a sealed part8bytes, verified against the outboard9open the segments, hand them to the player

*[Figure 19, drawn live on the page] Holdings tell the phone which devices hold the piece, so it asks them first. The server reads whole 8 MiB parts and caches them, never single segments and never whole files, so seeking stays fast on a 50 GB file and the bucket’s 750 requests a second are never the limit.*

### 4 · Your devices keep each other in sync

DesktopPhoneBrowseravenDB serversame café wifi1hello, proven by a post-quantum signature2hello3holdings: each log’s frontier4holdings, and ask the logs that differ5what it lacks, nothing moreoffline: you keep writing6edits pile up, each one countsback online, only the server is reachable7hello, then holdings8ask the logs that changed9the phone’s edits10ask what the desktop wrote meanwhile11those edits12holdings: these logs changed13ask those logs alone14through the relay, the same exchange

*[Figure 20, drawn live on the page] Every pair of devices runs the same exchange. Each log has its own frontier, so a device asks only for the logs that changed, never the whole vault. Order never matters: Loro merges concurrent edits to the same note the same way everywhere. File pieces are not copied by sync: each device fetches them as its keep shares say, or as it plays them.*

### 5 · A new phone signs in with your passkey alone

YouNew phoneavenDB server1sign in with your passkey2wait for the relay to let it in, up to 20 s3through the relay: show the pass your passkey signed4the link card: your vault’s log5check every edit, open the keys your passkey unlocks6join: the edit that adds this phone7ask for every log it may receive8pages of historynotes and todos are there9pieces of a file as you open it, or whole by your copy setting

*[Figure 21, drawn live on the page] The link card holds the logs of the vaults your passkey owns and nothing of an entry, so the pass alone reads nothing. History then comes in pages of about 4 MiB, each edit after its past, so a vault of any size arrives a page at a time, never one round trip per edit. With every other device lost, this is how a vault comes back. Signing in on a second device with the same passkey takes this same path, and founds nothing new.*

### 6 · The server is lost and rebuilt

New serverBucketAny of your devices1get its device secret2sealed3open it with the seal key: the same device again4the newest head, and the journal after it5a head and up to 63 entries, sealed6the packs and McEliece keys they name7up to 64 sealed packs, and the keys8open each, check every edit againits holdings name only what the bucket holds9hello and holdings, as usualanything newer comes back from your devices

*[Figure 22, drawn live on the page] The bucket holds every edit and key the server took, and the server’s own device secret, all sealed. Only the seal key sits apart, in the deploy’s secrets. So a new server on an empty disk is the same device again, and nothing changes for your vaults. File parts come back from the bucket as they are read. Were the bucket itself lost, the nightly snapshots in the second bucket bring the server back: a restore puts every vault into a new, empty folder with the server’s device secret, and a server started there is the same device.*

Where the bytes live

## One shelf per place

Each place keeps what lasts on one shelf, laid out the same everywhere but in the bucket, which keeps each blob in 8 MiB parts. A shelf says it has something only once its place’s source of truth holds it, so “synced to” never means “on its way”. Pieces a device reads but doesn’t keep stay in memory, 64 MiB at most.

| Place | Its shelf | What it keeps |
| --- | --- | --- |
| **Desktop** | A folder of the app’s own | What its keep shares want; files whole where they say so, and every file it adds |
| **Phone or browser** | The page’s private storage (OPFS), in a worker | The same; pieces read but not kept stay in memory |
| **Drive** | A folder on the drive, hosted by the Mac it is plugged into | The same as a desktop |
| **Server** | The sealed bucket; its disk is only a cache | Every file whole, by default |

```
g18/                one generation, 18 or later, for good: avenDB is never reset; starting fresh makes g19
  meta/<n>          what opens the device again, its follow list and query limit too (browser, desktop)
  journal/<n>       what one save added: new edits, and the McEliece keys they brought
  heads/<n>         after every 64 saves: the packs that hold the log so far
  blobs/<hash>      edit packs, McEliece keys, HashSeqs and file pieces (in the bucket, in 8 MiB parts)
  outboards/<hash>  each blob's BLAKE3 outboard, written last
  stated/<device>/  each device's signed holdings, named by when it checked, at most one an hour each,
                    or one a day while they stay the same
  drives/<device>   a drive's key, wrapped under the desktop's own (desktop)
  device.key        the server's own secret, sealed (server)
  new/              what is still being written
```

*[Figure 23, drawn live on the page] One generation of a shelf. A node starts from its newest head, the packs it names and the journal after it: at most 64 packs and 63 journal entries, however long the log, with the McEliece keys they name.*

Packing is what makes object storage work for a database. Hetzner bills every object as at least 64 KB and allows 750 requests a second per bucket. A million edits stored one per object would take 22 minutes of a fully busy bucket to write or restore. Packed, a node reads one head, at most 64 packs and 63 journal entries to start, and its McEliece keys.

- **Put aside, never cleared.** Forgetting an account, or starting fresh, makes a new generation beside the old one, which is never read again and never deleted. avenDB is never reset: the lowest generation stays at 18, the edit format at version 11, and no place deletes a shelf, nor anything on it but a blob it never finished and a file an agent lets go of once its person’s Mac holds it whole.
- **Nothing counts until the bucket has it.** The server’s shelf answers only once the bucket holds the object, so its holdings name an edit or a file only then.
- **Sealed and in parts.** Every object in the bucket is sealed and bound to its name. A blob is stored in 8 MiB parts, and counts once its outboard, written last, is there.
- **Its disk is a cache.** The server caches parts it read lately, 8 GiB by default. Its own device secret is in the bucket too, sealed, so a server whose disk is lost comes back from the bucket alone.
- **Locked.** Every object version is kept for 7 days in compliance mode, so for those 7 days not even a compromised server can wipe it.
- **A snapshot of every vault, every night.** At 03:00 UTC the server backs up every vault it knows into a second bucket, `maiacity-avendb-snapshots`, a folder for each vault, sealed under a key of its own: what changed since the vault’s newest snapshot, each blob once. It keeps its own device secret there too, and every snapshot of the last 48 hours, the newest of each day for 30 days, of each week for 26 weeks and of each month for good, and lets go of the rest; that bucket is locked for 7 days the same way. Then it checks every folder without restoring it: the listing and the newest snapshot’s edits every day, and each blob of the files on one day in 30. A restore puts each vault back as of any day kept, into a new, empty folder with the server’s device secret, and a server started there is the same device.

Post-quantum

## Quantum-proof, everywhere

Every link between nodes is post-quantum only: X25519MLKEM768 is the only key exchange either end offers. No curve makes an edit count: each of its signers signs it with ML-DSA-65 or SLH-DSA. Where a classical algorithm still appears in a key exchange or a sealed box, a post-quantum one stands beside it, so it stays closed while either holds. The one link that may be classical is the server’s to its buckets, and it carries only objects the server sealed again under a 256-bit key.

| Where | How |
| --- | --- |
| **Connections** | TLS 1.3 with X25519MLKEM768 as the only key exchange, on every link between nodes and on the HTTPS in front of the relay. |
| **Signatures** | ML-DSA-65 (FIPS 204), the suite of every new signer: the passkey of a new vault, a device, a Touch ID key, an invite, a server, an agent. A signer made before ML-DSA-65 came in keeps signing with SLH-DSA-SHA2-128f (FIPS 205) as itself, and every device checks both. A signer’s id hashes its suite and its keys, so each suite names signers of its own. An ML-DSA-65 signature is 3,309 bytes and brings its 1,952-byte key; an SLH-DSA one is 17,088 bytes. A passkey adds its WebAuthn assertion beside it, which only shows a person was there. |
| **Touch ID** | A Mac’s Touch ID key, an owner beside the passkey, signs with ML-DSA-65 inside its Secure Enclave, which never lets the key out and signs only once Touch ID passes. That signature counts. A Touch ID key made before ML-DSA-65 came in also signs with SLH-DSA beside it. |
| **Hellos** | Each connection opens with a post-quantum signature each way over its TLS session, in the device’s suite, so both ends know which device they speak to even once the curves fall. |
| **Passes** | A new device shows its passkey’s pass, a WebAuthn assertion and a post-quantum signature over the device and the time, to the server’s relay and to the peer it links through. Both take a pass in either suite. |
| **Keys sent to devices** | Sealed boxes of X-Wing (ML-KEM-768 with X25519) and Classic McEliece 6688128f together: closed while either holds. A passkey’s ceremony coming back from the Mac app’s sign-in sheet is sealed once to X-Wing alone, to a key made for that crossing. |
| **Edits and files** | XChaCha20-Poly1305 for edits and keys, ChaCha20-Poly1305 per 64 KiB segment for files, all with 256-bit keys. |
| **Hashes** | BLAKE3 for every hash of avenDB’s own: a blob’s id is the plain hash of its bytes, the name iroh gives it, and an edit’s the plain hash of its bytes before its signatures. Every other hash, a signer’s id among them, derives its own key for its purpose. An entry’s id is the hash of its vault, the signer that created it and a nonce its creation carries, which every peer checks. |
| **The buckets** | Every object sealed again with a 256-bit key derived from the server’s seal, each vault’s snapshots under a key of their own, since the link to them may be classical: the server’s TLS to its buckets offers X25519MLKEM768 first and X25519 after it. |

Proofs

## What the Lean model proves

avenDB’s rules are written twice: in Lean 4, where each guarantee below is a theorem with a machine-checked proof, and in Rust. Shared test vectors hold the two to the same answers, edit by edit. The proofs assume that signatures can’t be forged, that sealed data reveals nothing without its key, that ids don’t collide and that Loro converges. Verifpal models cover the hello, linking and the sealed box against an attacker who breaks the curves. No CI job builds the Lean model or runs the Verifpal models.

| Guarantee | Theorem |
| --- | --- |
| Only edits by someone allowed stand, and a revocation wins over what it hadn’t seen | T1 |
| Changing a vault’s owners, threshold or devices needs the vault’s approval, unless an owner or a device takes itself out, and whoever is added approves too | T2 |
| A key opens only for whoever may read what it protects | T5, T24 |
| After a removal, the current keys open only for those still entitled, and new writes use them | T6, T15 |
| A server whose vaults read nothing of another vault opens no key of a vault whose seed it never held, unless that key was public | T7 |
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
| Every reader agrees whether a write counts, and a write that breaks its schema counts for no one | C2 (counts_seen), S3 |
| A record that fits its schema stays so, and no write reaches deeper than 256 rows | S2 |
| A query shows through links only what its reader opened, says why where it opened nothing, and a cycle of links ends at its depth | L1, L2, L3 |
| Merging a proposal loses nothing: what main changed stays, and what only the proposal changed lands | T10 |
| A merge through a share brings in only the places its merge op names, and into main only what the vault accepted | M1, M2 |
| Only its vault lands a draft, a draft by anyone else counts only through a share that lets it create one, and a draft that hasn’t landed is in no public audience, unless its vault shares all of itself with Everyone | D1, D2, D3 |
| A share of a cap group never grants an op above its level, whatever version of the group is in force | CG1 |
| An invite is claimed once, and from then on its share names the vault that claimed it | G1 |
| A gated server takes a new human vault only with a share of the vault it serves, such as the invite it claims, or as an owner of that vault, and a new COOP or aven only owned by an admin of it | G2 |
| A backup restores exactly the vault’s snapshot, and later backups and pruning leave every kept snapshot restoring as before | B1, B4 |
| A backup built on a snapshot stores only the edits beyond its frontiers, and each file once, and asking by frontiers loses nothing | B2, B7 |
| A snapshot holds only edits the server holds, of entries only its vault’s, and every file it names is there | B3, B6 |
| Retention keeps the newest snapshot, and one of every day, week and month with one, in its window | B5 |
| A restore reads at most 64 packs, and checks itself log by log against its manifest | B8, B9 |

Not covered by the proofs: the Rust and Loro code itself, which the vectors and tests check; timing and traffic analysis; a file’s exact length, which its sealed size shows; and a device compromised while it is unlocked.

Sources: Ink & Switch’s *Local-first software* (2019), Loro 1.16, iroh 1.3, iroh-blobs 0.103.1 and bao-tree 0.16.1 source, n0’s blog and docs, Hetzner Object Storage documentation, and avenDB’s code and Lean model for edit format 11, as of 19 October 2026. The full reference is `avendb/docs/ARCHITECTURE.md`.
