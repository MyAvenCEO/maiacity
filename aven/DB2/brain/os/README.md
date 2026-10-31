# avenOS

The shell people use: a page that runs this device's Peer-Light and shows its apps on a dashboard, as the vault you
act as, and the brain beside them.

## Owns

- [The page and its workers](#the-page-and-its-workers): the Peer-Light's worker holds the keys, the docs worker runs
  the judge, the runtimes worker runs the modules (avenRUNTIME's browser host).
- [Hosts, accounts and the dashboard](#hosts-accounts-and-the-dashboard): whom a host may act as, the account
  switcher, addresses and the apps.
- [Sign-up and sign-in](#sign-up-and-sign-in): the passkey's ceremonies on the page, the PRF step and its refusal.
- [The chat](#the-chat): the screen over the chat Doc, built on avenOPS's queries.
- [The Service Worker](#the-service-worker): files from the Peer-Light, the shell kept offline, and the switch to a
  newer release.
- [Brain](#brain): the screen over avenBRAIN.

## Uses

- [avenPEERS](../peers/README.md): the Peer-Light it runs in its worker, the wire's `update` refusal, and the door.
- [avenID](../id/README.md): the passkey's PRF step and the keys derived from it, the device key, and the vaults the
  views are about.
- [avenCAPS](../caps/README.md): the register's acts a person signs (claim, join, sign-in), tickets, and the default
  keep cap a person approves.
- [avenDOCS](../docs/README.md): the judge, run in the docs worker; a commit as prepare, sign and finish.
- [avenOPS](../ops/README.md): queries and their live answers, and the ops every write is.
- [avenSTORE](../store/README.md): the opfs driver, of which the Peer-Light's worker is the one writer.
- [avenRUNTIME](../runtime/README.md): the runtime host, the frozen modules and the file registry.
- [avenBRAIN](../README.md): the files Brain shows.

## The page and its workers

The page draws and holds nothing secret. Everything else runs in workers: the one that holds the keys, the one that
judges Docs, and the one that runs untrusted modules. A fault in a worker stops only that worker.

**The Peer-Light's worker** runs avenPEERS's Peer-Light, the page's one WebAssembly module of its own.

- One per origin and name. The tab that holds the Web Lock `aven-peer-light:<name>` starts it as a dedicated worker,
  the only place every engine has OPFS's sync access handles, so it is the one writer of the browser's store
  ([avenSTORE](../store/README.md)). Two Peer-Lights with one key would take the relay from each other, so there is
  never a second.
- Every tab, the leader's too, speaks to it over the BroadcastChannel of the same name. When the leader's tab closes,
  the next tab waiting for the lock starts it again; it says so, and every tab says hello and sends its start and its
  unanswered asks again. Frames are tabs.
- It holds the device key, made in the browser and kept in its store. The owner key exists in it only during a
  ceremony: derived from the passkey's PRF output, used to sign, and dropped. It opens seals, signs, and closes and
  seals segments.
- It wakes its link at once when the page comes back online or into view.

**The docs worker** runs avenDOCS's judge ([avenDOCS](../docs/README.md)): a second instance of the Peer-Light's
wasm, with Loro and no key.

- One docs worker for every open Doc, not one per Doc, since every wasm instance costs memory.
- The Peer-Light opens seals and checks limits, then hands it plaintext envelope pages to import.
- A commit is three steps: the docs worker prepares the unsigned envelope, the Peer-Light signs it, and the docs worker
  finishes it, which it refuses if the Doc moved since it prepared. The device key never enters the Loro worker.
- Loro can panic, and wasm aborts on a panic. When the docs worker crashes it restarts and reopens the open Docs from
  the store. To find the culprit it retries the crashed page envelope by envelope in a fresh worker, and marks an
  envelope unfit only when it crashes again alone, so a passing fault such as running out of memory never marks a valid
  envelope unfit. The unfit set is local and never travels: the Peer-Light keeps it as the ref `docs-unfit` in its
  store, of which it is the one writer.

**The runtimes worker** runs avenRUNTIME's host, holding no key and reaching no store; how it loads and runs modules is
avenRUNTIME's ([the browser host](../runtime/README.md#the-browser-host)).

**One origin, for now.** The workers, the Service Worker and the page share avenOS's origin until A15's three origins
(the app, the safe and files) exist. Until then the walls between them are workers, modules that import nothing, and
fuel.

**Decided:** rule 13; A15; A45 (a runtime runs in a worker of its own, apart from the device key); P1; P3; ledger
10:48 (one docs worker; how it finds an unfit envelope); A169 (the Peer-Light opens seals, the docs worker sees only
plaintext; the unfit set is the ref `docs-unfit`); README rule 1 · **Lean:** not in Lean (the workers are mechanics);
avenDOCS's `Doc::prepare` and `Doc::finish` are tested in Rust

## Hosts, accounts and the dashboard

You always act as a person's vault, never as a network or a device. The host you open avenOS on decides whom you may
act as, and every view is pushed by the Peer-Light, never asked for again.

- **A host decides whom you may act as:**

  | Host | Who it is |
  |---|---|
  | a Peer-Light's origin in the box's cast (`alice.localhost`) | that device: it acts as the person its vault serves |
  | `localhost`, the box's own view | every test key: it may act as any person of the cast |
  | a host whose `/aven.json` names an Aven Peer | that network's: sign up, sign in, or invite only |
  | any other host | a visitor's: "avenOS · coming soon", its apps closed |

- **The dashboard** is a greeting, the network's card, a row of apps and, on a device, the device itself: the vault it
  serves, its key, its store and its status line with its phase and how many peers are present.
- **The apps:** **Vault** (the vault you act as, its owners, and everything it governs as a tree; any vault in that tree
  opens here, managed as yourself), **Control Room** (every peer the vault you act as governs, side by side, and one
  timeline of their events), **Invite** (for Maia City's owners: a ticket's link and QR code, shown once, the open
  tickets, and withdrawing one), and **Chat** ([below](#the-chat)).
- **The account switcher,** a pill at the top right, picks the person you act as.
- **An address names the person, the app and what it shows:** `#/<vault>/<app>/<target>`, such as
  `#/alice/vault/aven`. An address naming anyone you may not act as, Aven included, lands on your own dashboard.
- **The views** (whom this host may act as, each vault's name, kind, owners, what it governs and sees, whom it acts for
  and through) are one snapshot the Peer-Light pushes, stamped with the head it is correct at, and pushed again whenever
  the tree changes. Who may act for whom is avenID's, computed inside the Peer-Light; the page only looks answers up.
- **Offline first.** A returning browser opens at once on what its Peer-Light keeps, before any link; a browser that
  can't reach the network says so plainly, the reason kept in the timeline. A browser that keeps no storage for the
  host (site data blocked, always private) runs no Peer-Light, and is told why.

**Decided:** README rules 3 and 8; A28 (an admin act counts with Maia City's owners' approval); SANDBOX.md's
decisions, **avenOS reads the tree through aven-id's wasm** · **Lean:** `Aven.ID.OS` — `opens_governed`,
`hostAccounts_people`, `accounts_examples`, `vault_examples`; vectors `id/spec/vectors/avenos.json`

## Sign-up and sign-in

A person signs up with a name and a passkey, and signs in on any other browser with that passkey. The passkey's PRF
opens the vault's owner and seal keys; a passkey without PRF can't, so it never makes a vault, and the page says why.
The ceremonies run on the page, since a worker has no `navigator.credentials`; what they sign, and every key derived,
is computed in the Peer-Light.

- **Sign-up** asks the person's name, then makes a passkey: ES256, a resident key, user verification required, no
  attestation, `user.id` 16 random bytes that mean nothing, and the PRF asked for its first owner epoch.
  - Where the platform answers the PRF at `create()`, the owner and seal keys come from it, the claim is built, and one
    `get()` signs it: two taps.
  - Where it only says the PRF is enabled, a `get()` asks the PRF first, then another signs the claim: three taps, at
    sign-up only.
  - The owner and seal keys exist before the claim's assertion, which signs their public halves.
- **No PRF, no vault.** A passkey without PRF stops sign-up before anything is signed, sent or kept, with this message:

  > This passkey provider can't open your vault on another device. Use a passkey provider that can, such as iCloud
  > Keychain or Google Password Manager.

  Whether a passkey has PRF is read from `create()`'s `prf.enabled`, or from a missing PRF output on the first `get()`,
  never from the user agent. The browser then tells the passkey manager it can drop that passkey
  (`PublicKeyCredential.signalUnknownCredential`, where the browser has it; no fallback).
- **A new browser signs in with one tap:** one discoverable `get()`, its challenge the sign-in's name, with the PRF
  evaluated for the epoch the browser expects (1 when it knows nothing). The sign-in names no vault: it is the vault of
  the passkey that signed it ([avenCAPS](../caps/README.md)). If that passkey's owner epoch has moved on, the browser
  reads the right epoch from the register and asks once more.
- **An act that needs the owner** asks the passkey again: the owner key is derived for that ceremony and dropped after,
  never stored.
- **The PRF output** goes straight into the Peer-Light, which derives the keys and keeps only their public halves; the
  page's copy is wiped at once ([avenID](../id/README.md)).
- **A passkey from before the owner keys** that has no PRF still signs in, but can't add an owner and seal key, so it
  can do nothing that needs the owner. The page says what the sign-up refusal says: add a passkey from a provider that
  can.
- **The default keep cap:** a member who never approved one (migrated from the first generation) approves it at their
  next sign-in, where avenOS shows what it covers and to whom ([avenCAPS](../caps/README.md)).
- **Offline:** sign-in shows while connecting too. The ceremony is local; what it signs waits in the Peer-Light's store
  until the network takes it, so the person taps once and the browser joins by itself when it is back.
- **Sign out** ends the Peer-Light's worker, then clears the origin's storage, where the device key lives, so the
  browser acts for nobody. The device stays in the register until it is removed.
- **Join:** a ticket's link (`#/join/…`) asks a name, makes a passkey the same way, and claims the ticket; the link
  works once.

**Decided:** A42 (the owner key from the PRF, never stored); A77 (the PRF output straight into the Peer-Light; the
owner key derived per ceremony and dropped); A43 (no passkey without PRF makes a vault; the PRF input
is the epoch; one tap on a new browser); ledger 08:58 (Samuel: refuse and explain; detect from `create()` or the first
`get()`); ledger 09:04 (the taps); ledger 09:34 (`signalUnknownCredential`); ledger 09:49 (a migrated passkey without
PRF); A44 and ledger 10:45 (the default keep cap at the next sign-in) · **Lean:** not in Lean (the ceremonies); the
derivations are avenID's; `sandbox/claim.mjs` checks the refusal with a virtual authenticator without PRF

## The chat

The chat is an app over the chat Doc. The screen reads it through avenOPS's queries and changes it only through ops,
like any app over any Doc.

- **Reading:** a query over the chat Doc's `post` Records, whose live answer is pushed as deltas: added, changed and
  removed rows. The screen never queries again (README rule 8).
- **Writing:** a post is a `put` of a `post` Record, committed by this device. It shows at once as a pending write,
  saying it is still on its way, until it is committed or refused ([avenOPS](../ops/README.md)).
- **Files:** dropping a file puts its chunks into the store and a file Record that names it. Each shows from
  `/files/<hash>`, as the file registry decides from its bytes: an image, audio, a movie or a PDF inline, anything else
  as a download link. A movie plays from any point, its chunks fetched as the player asks for ranges.
- **Deleting** a post or a file is for everyone; the holders drop it at their next sync (A40). It shows in its place as
  "Message deleted".
- **Who said it:** a post is named by the vault it was said for, from any of that vault's devices; yours are the ones
  said for the vault you act as.
- **The draft,** the line being written, is kept in this origin's OPFS (`/drafts/chat`) by the Peer-Light's worker as
  it changes, so a reload, an update's above all, finds it again.
- **The history from before the chat Doc** is named by the chat Doc's root Record, and shown read-only as avenDOCS
  reads it ([avenDOCS](../docs/README.md)).

**Decided:** README rule 8; A34 and P22 (the chat as the second Doc, a fresh one, with no interim fix); P23 (the old
chains in its root Record); A22 (a file is Values a file Record names); A40 · **Lean:** not in Lean (the screen); its
queries are avenOPS's

## The Service Worker

One Service Worker per origin does three jobs: it answers a file's bytes from the Peer-Light, it keeps avenOS's shell
so the page opens without its host, and it brings a newer release when the network refuses an older one.

**Files.** `<img>`, `<video>` and a PDF's frame point at `/files/<hash>`, a file's chunk list, and the browser asks for
ranges.

- The Service Worker asks the Peer-Light's leader over its BroadcastChannel, at most 1 MiB a read, again every 2 s
  while unanswered, since a new leader may have taken over, and gives up after 60 s.
- It answers a range with `206 Partial Content`, streamed a chunk at a time as the player takes it, the file's true
  length known from the first answer; a request without a range gets the whole file, streamed (`200`). "not found" is a
  `404`, anything else a `502`. Nothing of `/files/` is cached: the store is the cache.
- **Every answer treats the bytes as hostile,** since this origin holds the device key: `X-Content-Type-Options:
  nosniff`, `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self'; media-src 'self'; object-src
  'self'`, and `Cross-Origin-Resource-Policy: same-origin`. A document opened from it has an opaque origin of its own
  and runs no script.
- **Inline only what the registry decided from the bytes:** a native image (SVG excepted), audio, video or a PDF.
  Everything else, SVG and HTML among them, is `application/octet-stream` and an attachment. The Peer-Light's worker
  decides once per file, from its first 64 KiB, its size and its sender's claim; the Service Worker keeps no list of
  types.

**The shell.** The page (`/`, which every path of the release build is) network first, the cached copy only when the
network doesn't answer; the build's hashed files (`/assets/`) cache first, by their names, which change with their
bytes; the Peer-Light's own JS and wasm network first. Installing caches the page and what it names. Activating removes
every older shell cache (`aven-shell-1` is the current one).

**The switch to a newer release.** A peer of another wire version refuses this tab's Peer-Light with `update`, and
only the side that is behind follows ([avenPEERS](../peers/README.md)).

- A tab that is behind shows "Updating…" and nothing else, keeps its draft first, and reloads; the network-first page
  brings the newer release.
- A host that still serves the older release refuses the reloaded tab again, so it waits a minute before the next
  reload and never reloads in a loop.
- A tab ahead of the peer that refused it waits for that peer.

**Decided:** README rule 3; A15 (three origins; signed releases checked before new code activates, later); A42 (release
signing by a vault comes later); A29 (the frozen greeting); A86 (a file's bytes decide its type); the store README's
"What a file may run" (the security audit, 30 Oct: every file served as hostile; not in the log yet) · **Lean:**
`Aven.DB.Wire` — `follows_newer`, `follows_one`, `meet_refuses` (avenPEERS's); the Service Worker is held by the box
(`sandbox/inline.mjs`, `sandbox/upgrade.mjs`)

## Brain

Brain is avenOS's screen over avenBRAIN ([avenBRAIN](../README.md)): the architecture, the decisions, the glossary and
every package's page, readable on every host by anyone, signed in or not, as the repository is.

- **Its route is `#/brain`,** taken before any vault's route, so no vault is ever named `brain`. `#/brain` is the
  dashboard, one card per item of `packages.json`; `#/brain/<id>` an item's page and its slides; `#/brain/glossary`
  the glossary, and `#/brain/glossary/<word>` one term in it, marked.
- **It shows the brain's own files,** bundled from the repository at build time, never copies of them. Nothing in them
  is parsed as HTML on the page.
- **Markdown becomes a checked node tree,** its links rewritten: a term (`glossary:vault`) to the glossary, a page of
  the brain to its route, any other file of the repository to GitHub, anything else only if the allowlist takes it.
- **A slide is a face:** its part goes through the frozen face-runtime in the runtimes worker, and the drawer draws the
  answer into a shadow root of its own. A part face-runtime refuses draws nothing, and the slide says why. How the
  brain is drawn is avenBRAIN's ([avenBRAIN](../README.md)).

**Decided:** A41 (the documentation is Brain); L9 (Brain renders the brain's files themselves); P20 ("public" means the
members, so Brain is called readable by anyone, never public) · **Lean:** not in Lean (the screen); the node tree and
the faces are avenRUNTIME's (`Aven.Runtime.Tree`, `Aven.Runtime.Face`)

## Status

| What | Built | Pending |
|---|---|---|
| The Peer-Light's worker, the leader and the BroadcastChannel | built (`os/web/peer`) | |
| The docs worker | not built | stage 3, Docs in the Peers (#1727) |
| The runtimes worker | built (`os/web/runtimes`) | |
| A15's three origins | not built | until then the workers share avenOS's origin with the files |
| Hosts, accounts, the dashboard, Vault, Control Room, Invite | built | Invite signs today's register statements with a passkey; it moves to `tree/1`'s ops with the register (stage 4) |
| Sign-up with the PRF step and its refusal; one-tap sign-in | built (`os/web/network.svelte.js`) | the owner epoch is 1 until `tree/1` carries it (stage 4) |
| The default keep cap at sign-in | not built | stage 4 |
| The chat over the chat Doc | not built: Chat runs on the first generation's chains | stage 6, the chat as a fresh second Doc (P22) |
| The Service Worker: files and the shell | built (`os/web/public/files-sw.js`) | |
| The switch on `update` | built (`os/web/update.svelte.js`) | release records, and their checks before new code activates (A15, A36), later (A42) |
| Brain | built (`os/web/brain`) | Markdown through markdown-runtime (pending in claude/runtimes-markdown2) |

## Open questions

1. **Where the Service Worker lives** once A15's safe has an origin of its own: on the safe's origin, with avenOS's
   media elements pointing there, or on avenOS's, relaying through the page. The architect decides.
2. **Thumbnails and posters:** a small second Value the sender makes, named beside the file, so the chat paints before
   a movie's first chunk arrives. The architect decides.
