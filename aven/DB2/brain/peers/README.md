# avenPEERS

avenPEERS runs avenDB on real devices and real networks: the Peer and the Peer-Light, the wire between them, and how
every Doc's sealed bytes move from peer to peer, with no peer above the others.

## Owns

- [The Peer and the Peer-Light](#the-peer-and-the-peer-light): the two builds of one core, and the Aven Peer as a Peer.
- [Relays](#relays): who carries bytes between peers that can't reach each other, and how a peer picks one.
- [Addresses and entry](#addresses-and-entry): history (address and release entries), bootstrap through
  any member, the links a peer keeps.
- [The door](#the-door): which devices may connect at all, checked at every connection.
- [The wire](#the-wire): `aven/db/1`, its frozen greeting, frames in Core's codec, wire versions, the frames' rules.
- [The Doc host](#the-doc-host): a Doc as a peer holds it, on avenDOCS' shelf; the docs
  worker's place in the browser, and sifting a page that crashed it.
- [Gossip per group](#gossip-per-group): group topics, the members' and the keyring's, and the `Live` messages on them.
- [The fetch gate](#the-fetch-gate): the one way sealed values leave a peer: `prove`, `fetch` and `items`.
- [Keepers](#keepers): arrivals, covers, bills, admission and the keeper's store.
- [Catch-up](#catch-up): [by version between readers](#by-version-between-readers) and
  [by arrival number from keepers](#by-arrival-number-from-keepers).
- [Presence](#presence): signed beats, aged by each hearer's clock.
- [Upgrades](#upgrades): refusal by wire version, the side that follows, stored formats read forever.
- [The Aven Peer is just a peer](#the-aven-peer-is-just-a-peer): what it does by grant, and what stays special.
- [Deploy](#deploy): the slim image, its tag, and the Aven Peer on its server.

## Uses

- [avenCORE](../core/README.md#envelopes): the one codec, envelopes and their names, logs, splits, the past,
  [counting](../core/README.md#counting), signatures beside a name, and the [limits](../core/README.md#limits) every
  input has.
- [avenID](../id/README.md#devices): device keys and the hybrid and seal keys derived from them,
  [the seal](../id/README.md#the-seal) and its outside, [the keyring](../id/README.md#the-keyring), epochs, and
  [the safe](../id/README.md#the-safe) that keeps keys.
- [avenCAPS](../caps/README.md#membership): membership by the member cap,
  [the register](../caps/README.md#the-register) (Maia City's tree, with the relay list) and its settle,
  [keep caps and offers](../caps/README.md#keep-caps-offers-and-placement), and
  [the gate's authority half](../caps/README.md#the-gates-authority-half): fetch keys, the proof, `serves` and the
  quota.
- [avenDOCS](../docs/README.md#a-doc-and-its-genesis): the Doc, [a commit](../docs/README.md#a-commit),
  [importing](../docs/README.md#importing-three-verdicts), [the judge](../docs/README.md#the-judge) and its crash mark,
  [segments](../docs/README.md#segments), [sealed pages](../docs/README.md#sealing-and-sealed-pages) and the keyring's
  plain path, [the head, the held page and the shelf](../docs/README.md#the-head-the-held-page-and-the-shelf), and the
  `Authorize` trait.
- [avenOPS](../ops/README.md#the-want-queue): the want queue, which decides what to fetch, how urgently, from which
  kind of source first, and that uploads go before pulls.
- [avenSTORE](../store/README.md#blobs-and-refs): blobs and refs, [compare-and-set](../store/README.md#compare-and-set)
  and [the backends](../store/README.md#the-backends).
- [avenOS](../os/README.md#the-page-and-its-workers): the browser's workers the Peer-Light and the docs worker run in,
  and [the tab's switch](../os/README.md#the-service-worker) to a newer release.
- [avenSANDBOX](../sandbox/README.md#the-check): the box, where every check here runs, and
  [how a package is released](../sandbox/README.md#checks-before-production).

## The Peer and the Peer-Light

Every device runs the same core. The **Peer** is the native node, one Rust binary, `aven-peer`, the same in the box
and in production. The **Peer-Light** is the same core compiled to WebAssembly and run in a browser's worker. The
**Aven Peer** is a Peer of the agent Aven, on a server, with its relay on.

avenPEERS is the edge: it does all the I/O (iroh, the clock, storage) and runs avenDB's pure cores, and nothing in the
cores depends on it. A peer is configured, never built for a place: everything that differs between the box and the
world is a flag, or its `AVEN_PEER_<FLAG>` environment variable.

- **The Peer** keeps its data through avenSTORE in the backend `--store` names: S3, a folder, or memory for a test.
  It holds the Docs it reads, and may relay (`--relay`) and keep for others (`--keep`).
- **The Peer-Light** reaches anyone only through a relay: there is no direct path between browsers. It keeps its
  data in its origin's OPFS, in the worker avenOS starts for it ([avenOS](../os/README.md#the-page-and-its-workers)),
  and its keys never leave that worker.
- **A Peer-Light serves only as a reader:** it answers the readers it meets on a group's topic, by version, and never
  keeps or serves by arrival number for others.
- **Local first needs no native Peer.** A device writes on its own log alone, offline too (`write_fits`), and a commit
  at one Peer-Light reaches another over a relay with no native Peer online.
- **Status names its phase** (connecting, catching up with what is left, live, offline, stalled) from all of a
  peer's links together, and a page is pushed deltas, never re-queried.

**Decided:** A24, A45, A113, A118, A157 · **Lean:** `Aven.ID.Node` — `write_fits`, `write_chain`

## Relays

A relay carries bytes between peers that can't reach each other directly, and it is the only way a browser reaches
anyone. It sees the IP addresses and timing of everyone it carries, and the relay path is what hides a member's IP
from other members. So Maia City's owners choose which members' Peers relay: the relay list.

- **The relay list is in the register** ([avenCAPS](../caps/README.md#the-register)): `relayAdd` and `relayRemove`
  name a member's vault, never a device, and count only with Maia City's owners' approval. A peer uses the list as the
  register settles it.
- **A listed vault runs its relay on one of its devices,** whose newest address entry names the relay's HTTPS URL
  (`relayEndpoints`).
- **Any member's Peer can relay** with `--relay`. The flag doesn't make a Peer the Aven Peer.
- **Only a relay every member can use is listed:** one with a public HTTPS name and a certificate, since browsers reach
  relays only over HTTPS. A member's Mac behind NAT isn't listed; native Peers reach it directly. With two listed
  relays, losing any one peer leaves every member reachable (`no_only_relay`); with one, that relay is an only source
  (`one_relay_only_source`).
- **A relay admits exactly the door's devices** ([the door](#the-door)) and carries only sealed bytes (`relay_blind`).
- **iroh does the routing.** Every Peer and Peer-Light builds its `RelayMap` from the whole list. iroh homes on the
  fastest relay, dials a peer homed elsewhere through that peer's relay, which its address entry names, and re-homes
  when its relay goes. A relay removed from the list leaves the map at the next settle.
- **QUIC address discovery:** a relay with a certificate also answers QAD on UDP 7842, so a member behind NAT learns
  its public address and can hole-punch to another.
- **How a Peer starts:** from `--relays` (one or more URLs) or what it has cached, until the register reaches it. A
  Peer's own relay is known from the register, never from a flag.
- **Fully private:** no n0 services, no public DNS, no pkarr.

**Decided:** peers 1, peers 12, A12, A28, A44 · **Lean:** `Aven.ID.Node` — `no_only_relay`, `one_relay_only_source`,
`relay_blind`

## Addresses and entry

A peer finds another by an address entry the other signed: how to reach it. Any member a peer holds an entry for can
let it into gossip, so no host is the way in.

- **Address entries** are history: each is an envelope in the device's own log, naming its key, its home relay's URL
  and its direct addresses. The newest is the latest in the latest generation. Two entries at one place are a split,
  which ends that generation; the device's next generation counts again (`split_final`, `split_spares_next`), so a
  device that split re-homes in a new one (`rehome_new_generation`).
- **History is avenPEERS':** a peer's address entries and release entries. Each is a Core envelope in its signer's own
  history log, whose writer id comes from (signer, generation); `seq` counts and `prev` chains. Its body is a map with
  exactly one key naming what it is, `{"address": …}` or `{"release": …}`, never a `kind` field. There are no log-tip
  entries: a reader learns a Doc's tips from `doc_tips`, and gen1's log tips go with it (A197). It counts by Core's
  `Counts`, with fit as the entry's shape and `authorized` as who may sign it: a device about itself, admitted by the
  door, or a release signer for a release. The newest entry about one thing is the counting one with the greatest
  (generation, seq), and splits are Core's. Every entry names the one at the place before it in its own log, places
  from 1 (`chained`), so nothing after a split skips past it. Its Lean is `Aven.Peer.History`.
- **Every peer keeps the newest entry per device** and feeds it into iroh's `MemoryLookup`. Which entry is newest
  depends only on the set held, never on the order or on who passed it on (`newest_set`, `newest_signed`,
  `newest_agree`, `newest_grows`). An entry from a device the door doesn't admit is dropped. A re-homed device's new
  entry is the newest (`rehome_newest`).
- **Bootstrap:** a peer joins gossip through up to 3 members it holds an entry for, the ones it last heard from first;
  the Aven Peer is one candidate among them. A first start with an empty store takes `--bootstrap KEY@ADDR`
  (repeatable).
- **Links:** a peer keeps up to 3 links on `aven/db/1` to members chosen from its entries, and replaces one that
  stalls.
- **A fresh browser** has a ticket link, which carries the relay list, a few members' address entries, the register's
  Doc id and its tips, all signed, so it can join through any listed relay. A returning browser has all of it in OPFS.
  `/aven.json` is one more source.

**Decided:** A197, peers 2, peers 3, A31, A42, A193, A194 · **Lean:** `Aven.Peer.History` — `newest_set`,
`newest_signed`, `newest_agree`, `newest_grows`, `split_final`, `split_spares_next`, `rehome_newest`,
`rehome_new_generation`

## The door

The door decides which devices may connect at all: the network's members' devices, and no one else. Every peer keeps
it and checks every connection itself, so no peer lets in what another wouldn't.

- **Who:** exactly the devices the register's settled tree admits. Membership is a cap
  ([avenCAPS](../caps/README.md#membership)), and anyone checks a member's chain from what it carries. The door is a
  function of the settled register alone, the same at every peer (`settle_door`).
- **Where, three checks of one rule:** the relay's admission, every connection's `after_handshake` on every ALPN, and
  iroh-blobs' provider, which asks again whom it serves.
- **One exception, the newcomer:** a device whose relay token is an envelope the register would take from it now (a
  claim of an open ticket, a sign-in by a member's passkey) is let in to bring that envelope on `aven/db/1`, and
  nothing else (`Aven.ID.Admit`'s `newcomer` and `pending`). That is how a claim reaches a confirmer. Gossip never lets
  a newcomer in. No secret travels in the token: the relay's handshake proves the key it is for.
- **The door admits a connection, nothing more.** What a connection may fetch is [the fetch gate](#the-fetch-gate)'s.
  The connection's device is the door's device, and a keeper bills by it.

**Decided:** K12, A10, A28, A38, MILESTONE2 (the door is checked twice) · **Lean:** `Aven.ID.Network` — `settle_door`

## The wire

Peers speak one protocol of their own, `aven/db/1`, beside iroh's gossip and blobs on one `Router`. A connection opens
with a greeting that never changes, so a peer of any version can read another's and refuse it. Every frame after it
is a Value in Core's one codec.

- **ALPN `aven/db/1`,** a frozen name, one stream each way. The hello's number is the only wire version: a new version
  never bumps the ALPN.
- **The greeting** is a JSON line, the one exception to the one codec, frozen in every version:
  `{"frame":"hello","peer":…,"wire":…}`, or `{"frame":"update","wire":…}` in its place. It is read from exactly those
  keys. A peer sends nothing after its hello until the other's has come, and reads the greeting alone first. A line
  longer than `maxFrame` without its newline is refused.
- **Every frame after it** is a Core Value: a map with text keys in the codec's order, as its canonical encoding
  behind a 4-byte big-endian length. A length above `maxFrame`, 64 KiB, is refused as soon as its 4 bytes are in; a
  length of 0 is no frame. One form per frame (`frameOf_value`) and one encoding (`frameValue_canon`,
  `decodeAll_frame`).
- **Every frame's rules:**
  - its name, the key `frame`, is unique, since a reader dispatches on it;
  - it is read from exactly its keys, none optional and none defaulted;
  - its keys are written in the codec's order;
  - bytes are CBOR bytes, never hex text;
  - a list goes in pages of at most `pageSize`, 128, and a page of the longest entries fits `maxFrame`; every page but
    the last says `more`, and only the last says it's done, so the receiver hears the telling end. No page is empty, so
    each moves its receiver (`pages_ne_nil`), except that a telling with nothing in it is one page with no entries and
    `more` false (A215);
  - its examples and refusals are vectors (`frames.json`).
- **A Doc is named by its id,** 32 bytes, in every frame.
- **Its home** is avenPEERS's own: the Lean in `peer/spec` (namespace `Aven.Peer`), the Rust in `peer/wire`
  (`aven-peer-wire`). The wire moves there from the first generation byte for byte, before any Docs frame is added.

**Wire 3** adds the Docs frames in one shared bump: sync between readers, the fetch gate and keepers. Whichever lands
first sets the version to 3, and the other adds its frames under 3 if no release went out in between. Each frame below
also carries `frame`, in its place in the codec's order.

| Frame | Keys | Answered by | Job |
|---|---|---|---|
| `doc_tips` | `doc`, `more`, `tips` | the other's `doc_tips`, then `doc_have` | a reader's log heads, paged ([catch-up](#by-version-between-readers)) |
| `doc_have` | `doc`, `more`, `values` | `fetch` | the sealed values beyond the other's tips, by hash |
| `prove` | `doc`, `key`, `sig` | `proven {doc}` or `prove_refused {doc, why}` | proves the Doc's current fetch key on this connection ([the gate](#the-fetch-gate)) |
| `fetch` | `doc`, `hashes` | `items` for each held, `missing {doc, hashes}`, then `fetched {doc, later}`; or `fetch_refused {doc, why}` | sealed values by hash, at most 128; `fetched` closes each answer |
| `items` | `at`, `doc`, `hash`, `bytes`, `total` | — | a part of one item, at most 48 KiB |
| `keep_put` | `doc`, `hash`, `bytes`, `total`, `covers` | — | an upload's item, its first part, with its covers ([keepers](#keepers)) |
| `keep_part` | `at`, `doc`, `hash`, `bytes`, `total` | — | a later part of that item |
| `keep_end` | `doc` | `keep_took {doc, numbers}` or `keep_refused {doc, why}` | ends the upload; `numbers` gives each new item's `{n, hash}` |
| `keep_after` | `n`, `doc` | `keep_arrived {doc, more, entries}` | the items held above `n`, each `{n, hash}`, paged ([catch-up](#by-arrival-number-from-keepers)) |

Every `why` is at most 64 bytes (`whyMax`). An upload is at most 128 items (`putsPerUpload`), and an item's covers at
most 256 (`coversMax`). `keep_cap`, `keep_order`, `keep_choice` and `keep_link`, which carry a keeper's Books, come
after these.

**Decided:** rule 1, rule 14, A29, A42, A45, A118, A133, A134, A143, A215 · **Lean:** `Aven.Peer.Wire` — `pages_ne_nil`,
`headsPages_heads`, `answer_pages`; `Aven.Peer.WireCbor` — `frameOf_value`, `frameValue_canon`, `decodeAll_frame`,
`push_tooLong`; wire 3's gate and keeper frames in stage 5's PR 1 (#1765)

## The Doc host

A peer holds each Doc it reads in a host: avenDOCS's Doc, its bytes on avenDOCS' shelf in the peer's store, committed
to by the device, and fed from gossip and fetches. In a browser the Doc runs in a docs worker, away from the keys,
because Loro can crash on bytes it should have refused.

- **Open:** the Doc's genesis and schemas come from the caller (the pinned genesis, never the network). It reopens
  from the shelf as avenDOCS says, and envelopes this device recorded unfit are marked first.
- **Commit:** avenDOCS's three steps ([a commit](../docs/README.md#a-commit)), with the device's signature between
  them. The envelope goes on the shelf, and is sealed under the newest epoch and gossiped (`Live.of`).
- **Take:** a sealed envelope or segment from gossip or a fetch is opened beside the keys, under the epoch its outside
  names, what it seals found by commitment ([avenDOCS](../docs/README.md#sealing-and-sealed-pages)); a seal whose
  `doc` isn't this Doc's is refused. The plaintext is imported, and what it made held goes on the shelf.
- **Authorize:** avenDOCS defines the trait and avenCAPS gives one pure verdict; aven-peer's thin adapter joins them,
  so neither of those packages depends on the other.
- **The shelf** is avenDOCS'
  ([the head, the held page and the shelf](../docs/README.md#the-head-the-held-page-and-the-shelf)): its blobs and refs
  live in the peer's store, and a peer seals only what leaves the device.
- **Segments** close as avenDOCS says ([segments](../docs/README.md#segments)); in the browser the Closer and segment
  sealing run in the Peer-Light's worker, beside the keys.
- **Natively,** the Peer runs the Doc in its own process, and [the judge](../docs/README.md#the-judge) catches Loro's
  panics.
- **In the browser, one docs worker for all open Docs.** The Peer-Light opens seals, checks limits and hands the docs
  worker plaintext only. When the worker dies on a page, it restarts and reopens the open Docs, as
  [the judge](../docs/README.md#the-judge) says, and the Peer-Light **sifts** the page: a fresh worker takes its
  envelopes again one at a time, each after those that went through. An envelope is marked unfit only when it crashed
  the worker alone (`sift_alone`), so a passing fault (out of memory, a killed tab) never marks a valid one
  (`sift_fine`), and only the page's own envelopes are marked, each once (`sift_sub`, `sift_nodup`). The Peer-Light
  keeps the unfit set, avenDOCS' crash marks, as the ref `docs-unfit` in its store: this device's own, never
  travelling. Other readers judge for themselves.
- **The first Docs:** a device's first Doc is its vault's keyring ([avenID](../id/README.md#the-keyring)); at sign-up
  the Peer-Light computes its first Record and the Doc host makes the Doc and writes it, and the vault's other devices
  sync it like any Doc. The keyring travels unsealed, since its Records are already ciphertext: a new browser fetches
  them through [the fetch gate](#the-fetch-gate) by Doc id alone, with no fetch proof (a fetch key would come from the
  keyring itself), opens its stanza with its PRF seal key, and only then joins its vault's group topic. There a keyring
  change is announced as `{doc, version}` and fetched, never sent whole (A195). Every other Doc is sealed. The register
  is the first shared Doc, and its group's topic is joined first at start.

**Decided:** A195, A119, A121, A127, A128, A129, A135, A151, A155, A166, A169, A170, A185, A187 · **Lean:**
`Aven.Peer.Judge` — `sift_alone`, `sift_fine`, `sift_sub`, `sift_nodup` (pending in #1727)

## Gossip per group

Live envelopes travel on iroh-gossip, one topic per group a device reads, never one per Doc, so a hundred thousand
Docs don't cost a hundred thousand topics. Gossip forwards sealed bytes blind, and every reader judges each envelope
itself.

- **A group's topic** in one epoch, on wire version `wire`: `groupTopic wire key`, the BLAKE3 of the codec's
  `{key, wire}`, where `key` is `derive_key("avenDB topic 1", the group's epoch key)`. Only the group's members can
  find it, and a peer of another wire version is in another room. `topics.json` holds examples per wire version.
- **On a rotation** a device joins the newest epoch's topic and the one before, so nothing in flight is lost.
- **The groups at the cutover:**
  - Maia City's members: `groupTopic(wire, the register Doc's epoch key)`, since the register is sealed to the
    members; caps' members group key takes its place once groups exist;
  - a vault's own devices: `groupTopic(wire, its keyring's epoch key)`.

  A carrier Doc's readers are its group, so its gossip is the group's.
- **What a topic carries** (`Live`), each message read from exactly its keys:
  - `{sealed}`: a loose envelope, sealed as `envelope`. The seal pads it with the one padding
    ([avenID](../id/README.md#padding)), so a live message has no padding of its own, and the seal's outside names its
    Doc, the one source for it;
  - `{doc, hash}`: a sealed envelope too large for one gossip message, fetched through
    [the fetch gate](#the-fetch-gate). A message is at most 4096 bytes, iroh-gossip's default, so up to 4085 sealed
    bytes go whole (`Live.of_fits`);
  - `{doc, version}`: the BLAKE3 of the sender's tips, sorted by their encodings. A member whose version of that Doc
    differs syncs with the sender ([catch-up](#by-version-between-readers)). Tips and heads never go on gossip.
- **Forwarding is blind,** at iroh-gossip's layer. A reader serves what it holds, both halves of a split included; an
  envelope recorded unfit is never forwarded or served.
- **Who is on a topic:** only devices the door admits, since gossip's connections go through the door. A peer joins
  through the group's members it knows, and dials again every second while it has no neighbour. A keeper joins a
  group's topic only as a blind forwarder, when its keep caps hand it the topic.
- **What a neighbour learns:** that some endpoints share an opaque topic, their timing and padded sizes, and each
  sealed envelope's outside ([avenID](../id/README.md#the-seal)).

**Decided:** K11, A9 (13), A42, A118, A143, A152, A154, A155, A176, A177 · **Lean:** `Aven.Peer.DocSync` —
`groupTopic`, `Live.ofValue_value`, `Live.of_fits` (pending in #1727)

## The fetch gate

Every sealed value a peer hands out for a Doc, whether it is a reader or a keeper, goes through one gate. The asker
first proves, on this very connection, that it holds the Doc's current fetch key; then it asks for values by hash.

- **On `aven/db/1`, never on iroh-blobs:** a proof signs the TLS exporter of the connection that serves, and iroh
  opens one connection per ALPN.
- **The exporter:** 32 bytes under the label `EXPORTER-avenDB-fetch-1`, with an empty context. Both ends of one
  connection compute it, and no other connection shares it.
- **The proof** is avenCAPS's: its form, the fetch keys it is signed with, and whether it serves the Doc
  ([the gate's authority half](../caps/README.md#the-gates-authority-half), `served_current`).
- **`prove {doc, key, sig}`** is answered `proven {doc}` or `prove_refused {doc, why}`. The gate keeps the Docs proven
  on the connection.
- **A device proves a Doc only to a holder:** a keeper its vault's keep caps name for the Doc, or a reader met on the
  group's topic (`prove_only_to_holders`). So naming the Doc by its id tells a link peer nothing it didn't know.
- **`fetch {doc, hashes}`,** at most 128 hashes (`fetchHashes`):
  - a hash is served only if it is held for that Doc, by the peer's map from hash to Doc; a hash held for another Doc
    is missing, never served across Docs (`served_held`);
  - a Doc not proven on the connection gets nothing (`unproven_nothing`);
  - the bytes served beyond the first item stay within `inFlight`, 1 MiB, and from the first item that doesn't fit,
    the rest held wait for a later ask, in the order asked (`answer_bounded`);
  - every hash asked is answered exactly once: served, missing or later (`answer_partition`).
- **`items {at, doc, hash, bytes, total}`:** each item in parts of at most `partBytes`, 48 KiB, at consecutive
  offsets, which together are its bytes (`parts_join`, `parts_bounded`). An item is exactly the stored sealed bytes.
- **The receiver checks** each reassembled item's BLAKE3 against the hash it asked for before storing it. One that
  doesn't match is dropped and its sender noted, never stored (`stored_checked`, `honest_stored`).
- **Files** are no special case: a file's chunks are Values a file Record names, fetched through this gate like any
  sealed value. iroh-blobs carries only the first generation's chat files, until the cutover.

**Decided:** K12, A22, A44, A122, A124, A133, A142, A144, A161, A173, A185 · **Lean:** `Aven.Peer.Fetch` —
`prove_only_to_holders`, `unproven_nothing`, `served_held`, `answer_bounded`, `answer_partition`, `parts_join`,
`parts_bounded`, `stored_checked`, `honest_stored` (pending in #1722); `Aven.ID.Keep` — `served_current`

## Keepers

A keeper is any peer that keeps a Doc's sealed bytes for its readers, so they can catch up while the writers are
offline. It reads none of them. It keeps a Doc only where the owner's keep cap names it and its own offer covers that
owner ([avenCAPS](../caps/README.md#keep-caps-offers-and-placement)); it decides only about its own resources.

- **What it sees:** each sealed thing's outside and size ([avenID](../id/README.md#the-seal)), and the device of each
  connection. It learns a Doc's owner vault from the keep cap's issuer, never from the Doc.
- **The keyring travels unsealed:** its Records are already ciphertext, so a keeper carries its plain envelopes and
  segments by Doc id as it carries any Doc's items, and serves them to a device the door admits that names the Doc, with
  no fetch proof (A195). It knows a keyring by the Doc's own genesis, in its first envelope: the built-in type `keyring`
  and a vault it keeps for; any other Doc needs a proof (A209). It sees its signers, writer ids, epoch numbers, counts
  and times, nothing that opens anything. Every other Doc is sealed.
- **Arrivals:** each sealed thing it takes, a segment or a loose envelope, is an item named by the BLAKE3 of its sealed
  bytes. A new item gets the Doc's next arrival number, from 1, never reused; the same bytes again get no new number,
  only another uploader (`numbers_fresh`).
- **Covers, the uploader's own word:** a segment's upload names, in the clear, the sealed hashes of the loose
  envelopes it holds. A cover takes only the uploading device off those items' uploaders, and an item no uploader is
  left on is dropped. Covers are upload metadata, never part of the seal.
  - every item dropped was covered, by each device that uploaded it, by an item still held (`dropped_covered`);
  - a device's upload never takes another device off any item (`cover_own`), so a reader can't make a keeper drop
    someone else's envelopes, and a lie costs only the liar;
  - a writer that never comes back covers nothing, so what it uploaded stays (`gone_writer_kept`);
  - the item uploaded is held after its upload (`put_held`);
  - a dropped item stays reachable through the segment that covered it, which came after it (`dropped_listed`), while
    the uploader is honest about what its segment holds.

  A withdrawn keep cap or a deleted Doc drops every item at once, whoever uploaded it
  ([avenCAPS](../caps/README.md#the-gates-authority-half)).
- **Bills:** a vault's bill is the bytes of the items held whose earliest remaining uploader acts for it
  (`bill_follows`). When that uploader covers an item, the bill moves to the next uploader in upload order; when the
  item drops, it is freed. The quota is the keeper's offer to that vault (avenCAPS); a rate limit, apart, counts bytes
  taken per window.
- **Admission:** an upload is taken whole, in one write, when the vault's bill after it is within its quota or no
  larger than before (`admitted_within`). A vault pushed over its quota by a moved bill can always shed bytes and
  never grow (`over_quota_sheds`). A refused upload takes nothing, and no ask drops an item another device uploaded
  (`moved_bill_keeps`). Rule 10's quota is composed from these and caps' quota.
- **Per connection:** for a Doc not proven on the connection, every ask but `prove` is refused and changes nothing
  (`unproven_refused`), so a Doc no keep cap names is never kept or served (`kept_only_proven`).
- **One gate, two halves:** `Gate { serves, quota }`. avenCAPS answers whether a proof serves the Doc and the quota;
  the keeper computes bills and admits. The keeper's crate, `aven-peer-keeper`, holds only arrivals, covers, pages,
  the fetch gate and serving, behind that trait.
- **The keeper's store:** each item a blob by its sealed hash; per Doc the ref `keep-<doc>`, a head Value (the next
  number, full pages, the tail), with full pages immutable and one compare-and-set per upload frame; the ref
  `keep-books`, the keeper's Books.
- **A keeper never tells a reader what an item seals:** the reader finds it by commitment. Checkpoints come after the
  cutover; then a keeper learns which items are checkpoints, and what they cover, from the upload, the uploader's word
  as covers are, and readers check each checkpoint by replay. A checkpoint's `state`, its Loro export, is sealed as
  `checkpoint` too, under the checkpoint's Doc and epoch, so a keeper can't tell the two apart.
- **Which keepers:** those its vault's keep caps name, by default Maia City's keeper, the Aven Peer acting for Aven. A
  Doc is held by its writers' devices and those keepers; with two keepers named, losing any one peer leaves it
  fetchable (`no_only_holder`, `kept_fetchable`). Keepers stay blind (`keeper_blind`).

**Decided:** A195, rule 10, A22, A40, A44, A117, A141, A150, A153, A166, A173, A177, A181, A187 · **Lean:**
`Aven.Peer.Keeper` — `numbers_fresh`, `dropped_covered`, `cover_own`, `gone_writer_kept`, `put_held`, `dropped_listed`;
`Aven.Peer.Serve` — `bill_follows`, `admitted_within`, `over_quota_sheds`, `moved_bill_keeps`, `unproven_refused`,
`kept_only_proven` (pending in #1722); `Aven.ID.Node` — `no_only_holder`, `kept_fetchable`, `keeper_blind`

## Catch-up

A device that was away catches up two ways, kept apart: from other readers by version, and from keepers by arrival
number. Both fetch through [the fetch gate](#the-fetch-gate). Which source is asked first, and that a device's own
unsent envelopes go out before any pull, is the want queue's ([avenOPS](../ops/README.md#the-want-queue)). Several
sources serve at once, a chunk each, and one that stalls drops out for the round. Who served never matters, only that
it verifies.

### By version, between readers

Two readers of a Doc compare what they hold by their logs' heads, and each sends what the other lacks.

- **A tip** is a log's head: `{seq, name, writer}`, keys in the codec's order, one per log a reader holds. A Doc's
  version is the BLAKE3 of its tips sorted by their encodings (`version`).
- **The exchange:** a reader that hears a version other than its own tells its tips, `doc_tips`, in pages. Each side
  answers the other's whole telling with what lies beyond it, `doc_have`: the sealed values by hash. The other fetches
  those through the gate. Tips go only to a peer met on the group's topic.
- **An envelope is left out only when the tips tell that the other holds it:**
  - by name: a tip names it, or something it is before (Core's past);
  - by place: a tip names the one head of its log further on, and this reader holds no split in that log.

  Without a split between them, whatever one holds the other holds or is sent (`beyond_complete`), and after one
  exchange both hold everything either held (`sync_union`). Nothing a tip names is sent (`beyond_new`).
- **Splits spread.** A tip naming something this reader doesn't hold, at a place where it holds another envelope,
  shows a split, and that envelope is never left out (`split_shows`). A log with a split held is answered whole, by
  name (`split_sent`), so both halves reach every reader they meet (`split_spreads`).
- **A reader tells only what it holds,** and holds only a version: what waits for its past isn't held.
- **Every page moves, or the exchange stops** (`sync_moves`): a page that brings no name its receiver didn't hold ends
  it.

**Decided:** A3, A9 (7), A34, A113, A118, A134, A136, A154 · **Lean:** `Aven.Peer.DocSync` —
`version`, `beyond_complete`, `sync_union`, `beyond_new`, `split_shows`, `split_sent`, `sync_moves` (pending in #1727);
`Aven.ID.Node` — `split_spreads`

### By arrival number, from keepers

A device asks a keeper "what came after your number n?" and gets hashes in the order they arrived. It fetches the ones
it lacks. The keeper needs to know nothing about writers.

- **`keep_after {n, doc}`** is answered with exactly the items held above `n`, by number and hash, oldest first
  (`after_complete`, `after_sorted`), in pages of at most `pageSize`, none empty (`after_pages`), each with `more`.
- **The device fetches** the hashes it lacks, lands each page in one write (one Value and one ref move), imports it as
  a sealed page ([avenDOCS](../docs/README.md#sealing-and-sealed-pages)), and then stands at the page's largest number
  (`land_progress`). Caught up, it holds every item the keeper held (`caught_up_holds`, `caught_up_done`).
- **Numbers dropped leave holes.** A device that held a dropped loose envelope has it; one that didn't gets the
  segment that covered it, which came after it and so has a higher number.
- **Only keepers serve by arrival number.** A Peer-Light never does for others.
- **A keeper can withhold, never forge:** every item is checked against its hash and judged by its reader, and a
  version heard on the group's topic that the device doesn't reach is synced from the reader who announced it.
- **Checkpoints, once they come,** let a keeper serve a Doc's newest checkpoint first, then what came after it; older
  history is fetched only when someone scrolls to it.

**Decided:** A9 (11), A34, A44, A113, A117, A150 · **Lean:** `Aven.Peer.Keeper` — `after_complete`,
`after_sorted`, `after_pages`, `land_progress`, `caught_up_holds`, `caught_up_done` (pending in #1722)

## Presence

Who is here is told by each device itself: a signed beat on gossip, which every peer ages by its own clock. No hub
counts connections.

- **A beat** is signed by the device present and carries a counter. The counter only orders a device's beats; its
  time is a claim, never a clock. A beat is not history: it decides nothing. Presence is the only beat: the
  register's tips are no beat and no entry, and travel by `doc_tips` as any Doc's do; the first generation keeps its
  own until the cutover.
- **A device is present** while its newest beat was heard at most a window ago, by the clock of the peer that heard
  it, so a beat dated ahead stays present no longer than any other (`present_heard`, `present_ages`). Only a device's
  own beats count, and only for a device the door admits (`present_signed`). Who is present depends only on the beats
  a peer holds and when it heard them (`present_set`).
- **"Who joined"** is the first beat after a claim settles, and each peer says it itself.

**Decided:** rule 12, A31, A35, A42, A194 · **Lean:** `Aven.Peer.CatchUp` — `present_set`, `present_signed`,
`present_heard`, `present_ages`

## Upgrades

Peers of different wire versions never talk: the newer one answers `update`, and the older one follows. There is no
fallback, so the wire version changes rarely, and only when a frame's meaning changes. What a peer stored is read by
every later release, forever.

- **The wire version** is a number in the hello, mixed into every group topic. It is apart from the release, and an
  ordinary release never changes it.
- **Meeting:** a hello of the same version carries on; any other is answered with `update` and this peer's version,
  and the connection closes (`meet_speaks`, `meet_refuses`). No default is kept for an older peer: a hello with no
  version is read only to answer `update`.
- **Following:** of two versions that differ, exactly one is behind, and only that one updates (`follows_one`,
  `follows_newer`, `follows_same`). A peer ahead never goes back.
- **A tab behind** switches to the newer release at once, keeping its draft
  ([avenOS](../os/README.md#the-service-worker)).
- **A native Peer behind** says `update` on its timeline and in avenOS's Control Room, on the Peer's card, until its
  owner upgrades it. A Peer never upgrades itself; the Aven Peer's deploy upgrades it.
- **Order:** a new wire version reaches production's Aven Peer and the browsers first, then members' Peers. A Peer not
  yet upgraded is cut off until it is: the cost of no fallback.
- **Stored formats are read forever.** Every release reads what every older release stored, tested against frozen
  vectors of each format; a format change reads the old one too, or migrates it in the peer, and never asks for a
  reset. Only the wire refuses an older peer; the store never does. Production is never wiped: its deploy has no
  `wipe` input, and nothing else deletes its bucket's objects. The box keeps its own wipe, since its data is test data.
- **A release** is the dated release from `production` ([avenSANDBOX](../sandbox/README.md#checks-before-production)).
  Signed release entries in a release vault's log, and who owns that vault, are parked for later (A206).
- **The box rehearses it:** `--wire-version` (`AVEN_PEER_WIRE_VERSION`) makes a Peer say another version, for that
  check alone.

**Decided:** README rule 9, A29, A36, A42, A186, A206, peers 11 · **Lean:**
`Aven.Peer.Wire` — `meet_speaks`, `meet_refuses`, `follows_newer`, `follows_one`, `follows_same`

## The Aven Peer is just a peer

The Aven Peer is Aven's device: a Peer that runs on a server and is always on. It holds only the caps its owners
grant, as any Peer would, and everything it does, a member's Peer can do too. The network keeps working when it is
down.

- **Its jobs are grants:** it relays because Aven's vault is on the relay list, keeps because members' keep caps name
  it and Aven's vault offers, and confirms claims because Aven holds the confirm cap under Maia City's
  ([avenCAPS](../caps/README.md#membership)). It answers sync and serves as every Peer does.
- **No configuration stands in for a signature.** Nothing is read from flags that the register's setup names; a Peer
  whose flags disagree with the setup refuses to start, and says which flag.
- **Being reachable at `aven.maia.city` gives it nothing more.** Hosting an actor on it is an explicit read cap shown
  to the actor's owner ([avenACTORS](../actors/README.md#hosting-is-an-explicit-read-cap)).

What stays special, and why:

| What | Why it stays | How it goes, or why it may stay |
|---|---|---|
| The register's setup | The root: every member pins the register's Doc, and its first envelope writes the setup | Stays: people sign it, no server holds it. Founding again is a new register, by its owners |
| MaiaCityGuardian | A full owner of every person's vault, for now | Named in what people sign; its exit is a later decision ([avenID](../id/README.md#maiacityguardian)) |
| The `maia.city` origin and its DNS | avenOS's passkeys are bound to the RP ID `maia.city`, and the register's setup names it | Stays; moving to another RP ID means a new register |
| A listed relay's name and certificate | Browsers reach a relay only over HTTPS | Stays for each listed relay; any member with a server can run one |
| A ticket link's first contact | A new invitee knows only what the link carries | The link carries several relays and members, so it needs none of them |
| The Aven Peer's uptime | It is the one Peer always on, so often the first to relay, keep and answer | A convenience, not a privilege: the box checks the network without it |

**Decided:** rule 7, A11, A14, A16, A42, A44, A146, peers 9 · **Lean:** `Aven.ID.Node` — `no_only_relay`,
`no_only_holder`, `kept_fetchable`, `no_plain_to_nonreader`

## Deploy

What ships is the node, never the box: one slim image, the same in production and in the box, so what is tested is
what runs.

- **The image,** `ghcr.io/myavenceo/aven/peer`: the `aven-peer` binary, built in the box's own image (by digest, so the
  compiler and crates are exactly those every box peer is tested with) and copied onto a minimal distroless base, for
  amd64 and arm64. It is built only on GitHub.
- **Its tag** is the first 16 hex digits of a SHA-256 over the box's tag and every file its build reads:
  `peer.Dockerfile`, its `.dockerignore`, `tag.mjs`, `Cargo.toml`, `Cargo.lock`, every workspace member's sources
  and aven/runtimes' file registry. The same inputs give the same tag, so an unchanged Peer is never built again, and a
  release sees it didn't change.
- **One list:** the tag reads the workspace's members from `Cargo.toml`, and refuses, by name, a member the build
  context's `.dockerignore` leaves out, before Docker runs.
- **The Aven Peer's key** is made on the server at its first deploy, in a file only the peer reads (`--secret-file`),
  and never copied anywhere; the deploy prints only its public half.
- **Its store** is S3 on Hetzner's Object Storage, with `--s3-conditions create`: creating a ref is conditional
  (`If-None-Match: *`), and replacing one leans on the one committer, since that host refuses a correct `If-Match`.
- **QAD's certificate** is Caddy's own for `aven.maia.city`, copied out at each deploy and daily
  (`deploy/server/qad.sh`); the peer restarts when Caddy has renewed it.
- **The deploy** is a workflow run by hand, in the environment `production`; starting the run is the decision.
  Nothing secret goes into a log. Its steps are the runbook in [`PRODUCTION.md`](../../PRODUCTION.md).

**Decided:** A140, A157 · **Lean:** not in Lean

## Status

| Part | Lean | Rust | In the browser | Pending |
|---|---|---|---|---|
| The wire, version 2 | `Aven.Peer.Wire`, `Aven.Peer.WireCbor`, `Aven.Peer.Presence` in `peer/spec` (#1745) | `aven-peer-wire` in `peer/wire` (#1745); `aven-gen1` re-exports it until the cutover | the Peer-Light speaks it | the first generation's own imports of `aven_gen1::wire`, until the cutover |
| Wire 3's frames | `doc_tips`, `doc_have` in `Aven.Peer.Wire` and `Aven.Peer.WireCbor` (`docTipsPages_tips`, `docHavePages_values`, `docTipsPages_last`; `wireVersion` 3); the fetch gate's and keepers' frames, reviewed by thread E (`keep_put` and `keep_part`, reasons of at most 64 bytes): after #1722 | `doc_tips`, `doc_have` in `aven-peer-wire`, held to `frames.json`; the gate's and keepers' the same, after #1722 | the Peer-Light speaks wire 3 | sync over the gate (stage 3's next PR); stage 5's frames after #1722 |
| Group topics, `Live`, sync by version | `Aven.Peer.DocSync`, #1727 | `aven-peer`'s `docs`, #1727 | not started | #1727 |
| The Doc host and sifting | `Aven.Peer.Judge`, #1727 | the native host and sifting's state machine, #1727; the `Authorize` adapter: not started | the docs worker, and a new browser reading its keyring first (A187): not started | #1727; the keyring's plain path, avenDOCS' (A187) |
| The fetch gate | `Aven.Peer.Fetch`, #1722 | `aven-peer-keeper`'s `fetch`, #1722; caps' half in aven-id's `keep` (#1734) | not started | #1722 |
| Keepers and catch-up from them | `Aven.Peer.Keeper`, `Aven.Peer.Serve` in `peer/spec`, #1722, #1745 | `aven-peer-keeper`, #1722, with catch-up end to end natively over avenDOCS' sealed pages (`tests/catchup.rs`: 500 envelopes, about 0.5 s in a debug build); the `Gate` adapter over aven-id's `keep`, and the native keeper (`--keep`, the keeper's store): not started | the catch-up client: not started | #1722 |
| The door | `settle_door` | the first generation's door, from stored refs | the same | the door from the register, with stage 4 |
| Relays, address entries, bootstrap, links | `Aven.ID.Node`, `Aven.Peer.History` (#1755) | not started: one relay in the Aven Peer, `--aven`, `--aven-key` | one relay URL | history entries in Rust; the rest: no stage named yet |
| Presence by signed beats | `Aven.Peer.CatchUp` (#1755) | not started: the hub counts connections | — | no stage named yet |
| Upgrades | `meet`, `follows` (#1649, #1714) | done | the tab follows `update` | signed release entries, later |
| Deploy | — | the slim image and its tag (#1730) | — | — |

Known gaps, code and Lean:
- `Aven.Peer.CatchUp`'s catch-up from members by signed log tips retires in favour of `Aven.Peer.DocSync` and
  `Aven.Peer.Keeper`.
- `Aven.Peer.Presence` models the hub's count, and retires with the first generation.
- `rule10_quota` is still to be composed over `Aven.Peer.Serve`'s `admitted_within` and `over_quota_sheds` with caps'
  quota, once #1722 lands; caps' `Keep` still holds a bill of its own (`uploader_pays`, `quota_holds`), which leaves it
  then.
- `history.json`, `catchup.json`, `failures.json` and `node.json` are read only by Lean: no Rust or JavaScript replays
  them yet.
- The Peer-Light serves its store's blobs to members over iroh-blobs, the first generation's files, until the cutover.
- Across an `update` reload only the chat's draft survives: a file half put isn't resumed, other screens' drafts are
  lost, and there is one draft per origin, not per tab.
- The first generation's frames (`presence`, `beat`, `claim`, `sign_in`, `invite`, `withdraw`, `join`, `network`,
  `refused`, `heads`, `catch_up`, `lines`, `kept`), the hub, the chat's chains, its JSON room and `keep.rs`'s rule that
  keeps every file go at the cutover.

## Open questions

- **Many Docs at a reconnect.** Sync runs per Doc. Reconciling many Docs' versions with a source in one round
  (A9, item 6) has no frame yet. avenMAIA decides.
- **Large values over iroh-blobs.** Whether large values, video first, go over iroh-blobs with the proof bound to the
  authenticated endpoint id, measured (A144). avenMAIA decides, at stage 6.
- **Who builds relays, address entries, bootstrap and signed presence.** No cutover stage names them yet. avenMAIA
  decides.
- **A keeper that goes quiet.** Whether a keeper that hasn't beaten for 7 days counts as gone, so avenOS tells the
  vault's owners their keep caps name a keeper that isn't there. Nothing decides it and no Lean holds it. avenMAIA
  decides.
- **Presence at scale.** A beat per device per step on one topic suits Maia City, not millions. avenMAIA
  decides.
