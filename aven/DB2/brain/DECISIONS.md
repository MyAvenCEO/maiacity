# avenDB decisions

The audit trail of every avenDB decision, as it was made. It only grows: an entry is never edited or deleted, and a
change of mind is a new entry that names the one it supersedes (checked by `aven/ops/devx/decisions.mjs`). The
current truth is [ARCHITECTURE.md](ARCHITECTURE.md) and its chapters, with the Lean; this is their history. The
architect is its only writer: threads send their decisions to the architect ([CLAUDE.md](../CLAUDE.md)).

Ids: `A<n>` is avenDB's one sequence. Entries imported from a package's own list keep that list's id (`caps D14`,
`docs 13`, `peers 8`, …), so old references still resolve.

## Imported on 31 Oct 2026

Before this log, avenDB's decisions lived in lists inside its documents. Each list below is copied verbatim from main at
commit `f7e1775b`, with its own ids, wording and markdown; its links point at the files as they stood at that commit,
and each entry's status is as it stood then. The lists are: ARCHITECTURE.md's "Proposals for Samuel" (A1 to A45, with
their group headings) and its rules 7, 15 and 16, which name Samuel's decisions; the caps README's "Decisions"
(`caps D1` to `caps D24`, and `caps E1` to `caps E3`, agreed with the engine thread); the "Decisions" of the docs,
engine and runtimes READMEs (`docs 1` to `docs 24`, `engine 1` to `engine 13`, `runtimes 1` to `runtimes 12`) and of
PEERS.md (`peers 1` to `peers 12`); the store README, which has no list, by its two sections marked "(decided)" and its
one decision in line; the unnumbered "Decisions" of MILESTONE2.md and SANDBOX.md, cited by their bold words, with
SANDBOX.md's decisions outside its list and its settled open questions, and the store README's "What a file may run" and
"Next: pack files"; and section 15, "Decisions", of the actors' `aven/actor/ARCHITECTURE.md`, cited as `actors §15`.
PRODUCTION.md has no decision list, so nothing of it is imported, and ARCHITECTURE.md's table "Caps, bulletproof" marks
rows decided only by citing A-numbers, which are here already.

### From ARCHITECTURE.md

**Before any docs or engine code**
- **A1. One vocabulary:** this document and [`GLOSSARY.md`](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/brain/GLOSSARY.md) are the single source for shared words and
  cross-part rules, and every spec uses them in this sense. *Decided: yes (Samuel, 30 Oct 2026).* **Its verdicts are
  decided too** (Samuel, 31 Oct 2026: "yes for all the glossary"), with two of them corrected by the terminology audit:
  `Gate` → `Admission` (a `Door` type exists) and the engine's part → level (caps has a share depth). They apply in
  specs and Lean now, each by the thread that owns the file, and in code only when that code is rewritten anyway
  (rule 16). Stored formats keep their names: the `claim` ref, the chat's frozen lines and the `network` field.
- **A2. One codec and signing rule** for everything signed (K1, rule 1). It started with the chat's lines in the
  security fixes (#1493). Samuel asked for "the best-practice encoding possible", shared by avenDB and the actors
  (30 Oct 2026). The recommendation is **deterministic CBOR**, RFC 8949's core deterministic encoding, in a strict
  profile:
  - native byte strings and integers; no floats (integers only, as decided for actors' version 1);
  - text keys, sorted bytewise; shortest forms; definite lengths;
  - no tags but those the profile names;
  - a hash is its 32 bytes.

  A decoder refuses anything that doesn't encode back to itself, and Lean proves it. JSON stays the readable form,
  with bytes as `b3:` or base64url text. It is standard and widely implemented (COSE, WebAuthn, DAG-CBOR), and it
  answers the runtimes plan's question 6, a bytes leaf. Canonical JSON (RFC 8785) can't tell bytes from text and is
  weak on large integers. What a person approves is shown decoded from the exact bytes the passkey signs, never from a
  separate copy, and Lean's vectors include that rendering, so what is shown and what is signed can't drift (from the
  caps thread). *Decided: yes, "CBOR is good" (Samuel, 30 Oct 2026).*
- **A3. Envelopes name what they build on by hash** (rule 2). *Decided: yes (Samuel, 30 Oct 2026).*
- **A4. Splits are final,** with no settlement that revives a side, and "fork" means only a copy into a new Doc. The
  store's and Lean's fork becomes split. *Decided: yes (Samuel, 30 Oct 2026).*
- **A5. Checkpoints travel:** sealed and hybrid-signed, naming the segments they cover. A new device starts from one
  and checks it in the background, from milestone 4, whose catch-up target needs it. *Decided: yes (Samuel, 30 Oct
  2026).* Who may sign one a reader takes: a device whose vault may write the Doc at the version the checkpoint names,
  as only writers publish a sealed index's root (A26). A reader still checks it by replay in the background, and
  ignores a checkpoint from anyone else. *The architect's answer to docs' open question 6, which Lean exposed (30 Oct
  2026).*
- **A6. Collections that grow without end are chains of period Docs.** *Decided: yes (Samuel, 30 Oct 2026), rather
  than shallow snapshots, which refuse older branches.*
- **A7. A Doc pins the type versions it accepts,** at birth or by its owners' act, and a listing can be withdrawn.
  *Decided: yes (Samuel, 30 Oct 2026).* Since lenses became universal (K5), pins cover them too. A lens inside one type
  Doc comes from whoever may write that Doc. A lens between two type Docs is a Value anyone may write, and it counts
  for a Doc or vault only once its owners pin it, after the checker has held it to the lens laws. A reader uses only
  the lenses pinned where it reads (for a message, the receiving vault's), and a pin that would make a second path
  between two versions is refused there. No peer sees every lens, so there is no global forest. *The architect's
  answer to the actors thread (30 Oct 2026).*
- **A8. One target grammar** for caps, wants and query scope. A query without a target is refused; `complete` means
  every Doc of the target is held, checked against its directory; the implicit want takes the query's tier and lasts
  while the query is live. *Decided: yes (Samuel, 30 Oct 2026: "do as you believe"); the engine thread agrees.*

**The network and trust**
- **A10. The network is a group:**
  - membership is the members group (D15, #1492);
  - the door admits its members' devices;
  - invites are tickets;
  - removal ends network caps.

  *Decided: yes (Samuel, 30 Oct 2026: "do as you believe").*
- **A11. A signed genesis:**
  - the claimant's passkey and MaiaCityGuardian sign the network's first statement;
  - it names the RP ID, origins, coop, agent, the Aven Peer's key and the guardian's hybrid keys;
  - every member pins its hash.

  *Decided: yes (Samuel, 30 Oct 2026: "do as you believe"), before sealing.*
- **A12. The tree is a Doc of signed statements:**
  - ordered by what each statement names, not by ref names;
  - a ticket claimed once, by the smallest hash;
  - a withdrawal wins over every join not in its past, and a join is final once an admin device has acked it, as a
    revocation wins over what it hadn't seen (refined with the PEERS thread);
  - members gossip signed tips.

  *Decided: yes (Samuel, 30 Oct 2026: "do as you believe").* What changes who is in or who sees whom (tickets,
  withdrawals, and the relay and keeper lists) counts only when the admin's passkey signed it, a tap each time; an admin
  device's key only acks claims. A stolen or compromised browser can't let anyone in, or route members through a relay
  that logs their addresses. *Decided (Samuel, 31 Oct 2026: "choose the more secure way"; PEERS decision 12,
  `adminPasskey`, #1618),* invites included: *"passkey taps for invites yes" (Samuel, 31 Oct 2026).*
- **A13. The guardian is named, with hybrid keys, in every claim and join text** people sign, until it leaves before
  the network opens beyond the founding circle (caps D12). *Decided: yes (Samuel, 30 Oct 2026: "do as you believe").*
- **A14. A dedicated passkey RP ID for avenOS,** for example `aven.maia.city`, before more passkeys exist; today's few
  members register once more. A salt the keeper serves per credential goes into the PRF input: secret from other
  origins, not from the keeper. *Decided: no (Samuel, 31 Oct 2026: "dont do a14").* avenOS's passkeys stay bound to
  `maia.city`, and the genesis (A11, PEERS) names it; moving to another RP ID later means a new genesis.
- **A15. Three origins:** avenOS (the app), the safe (D17: keys, the Peer-Light) and files (no keys, sandboxed).
  Releases are signed:
  - in the browser, a Service Worker on the safe's origin checks a release's signature before new code activates,
    and release hashes go into an append-only signed list that members' other devices check. A browser always
    re-checks a worker's script against the server, so this raises the bar without making the deploy unable to
    replace it;
  - the trusted path is the Mac app (Tauri), which checks signatures before it runs new code.

  *Decided: yes, as the architect recommends (Samuel, 30 Oct 2026: "do as you believe").*
- **A16. Hosting an actor on the Aven Peer is an explicit read cap** per actor and per load target, shown to its
  owner; a member's own Peer is the default home. *Decided: yes (Samuel, 30 Oct 2026).*
- **A28. Vaults own; signers only sign** (rule 15). *Decided: yes (Samuel, 31 Oct 2026: "only vaults can own things
  and be admins; signers are just signers authorized to act for a vault"; "all caps always delegate between vaults,
  never between signers"; vaults are like smart accounts).*
  - **The network tree's admin is Maia City's vault,** not the claimant's passkey. An admin act counts when Maia
    City's owners approve it (D14): tickets, withdrawals, the relay and keeper lists. Only passkeys sign as owners, so
    "the more secure way" (31 Oct) holds. Today that is one tap of Samuel's passkey, since his vault owns Maia City. A
    second admin, an owner change and recovery are ordinary governance of the vault, with no new genesis.
  - **Release keys and the guardian** become vaults' signers, named by the genesis as vaults and changed by their
    owners' approval. avenPEER's `settle` takes the admin's approval from each statement's own past, so settling stays
    order-free.
  - **Every place a key still holds authority** is in [`audits/vaults.md`](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/audits/vaults.md), each fixed Lean-first
    before its code:
    - the guardian, one key owning every person's vault, becomes the guardian's vault, its key that vault's owner;
    - the genesis's `origins`, `avenPeer` and guardian become Maia City's to change, by its owners' approval;
    - the running code's first signup and unsigned flags give way to the pinned genesis (A11);
    - a claim is final by a vault's grant, not an admin device's ack;
    - release signers become the release vault (A36);
    - a root cap over a coop's Docs needs the coop's own owners, k of n, not one governing vault alone;
    - a ticket is a cap from Maia City to the vault its claim founds, the one-time key only authorizing the claim;
    - the relay and keeper lists name vaults, not devices;
    - each vault stores its own threshold k.
- **A29. Frames in CBOR.** The wire's frames move from JSON lines to Core's canonical CBOR, the one codec (rule 1),
  replacing actors' "frames as JSON lines". It ships as a wire-version bump (PEERS §7), which updates open tabs by
  itself. *Decided: yes (Samuel, 31 Oct 2026).* The hello and `update` stay JSON lines in every version, frozen like
  the ALPN's name, so any version can read another's hello and refuse it; a peer sends nothing after its hello until
  the other's has arrived. Every other frame is a Core Value with exactly its keys, nothing optional or defaulted.
- **A30. One name for a signed thing:** the hash of `[label, body]`, its signatures beside it, so signing one act
  twice never makes two names. A split is two different bodies at one place (A4). The tree's statements become Core
  envelopes on Core's past. *Decided (the architect, 31 Oct 2026): it follows from rule 1 and A4.*
  - **Many signatures beside one name** (the architect, 31 Oct 2026). A signed thing or an envelope carries a set of
    signatures that only grows: adding one never renames it and is never a split. In an envelope, its log writer's
    signature places it in the log, and the others are approvals over the same name: k of a vault's owners (D14,
    caps' approvals), or a passkey's ES256 beside its owner's hybrid at a sign-in (caps rule 21).
  - **What counts has its whole past held** (rule 11). An envelope built on a parent the reader doesn't hold waits;
    it counts only once every parent its `prev` and `deps` name is held, recursively. So counting is monotone, and
    an approval that depends on the owners in its past is judged on that whole past.
- **A31. Two kinds of signed thing:** history (envelopes in a log, where a split is final) and beats, which decide
  nothing. An address or release record is history: an envelope in its signer's own log, the newest the latest there,
  so the "smaller body wins" tie-break goes. *Decided (the architect, 31 Oct 2026): it follows from A4.*
- **A32. Caps are built from ops.** *Decided: yes (Samuel, 31 Oct 2026: "caps should be built from their ops").*
  *In Lean (#1681), with A39's types, A40's holdings and A42's collections clause.*
  A cap line names an operation by its hash (rule 1's name of its stored form) and bounds on its parameters, and nothing
  else.
  - **The core verbs are ops:** read, put, patch, remove, edit, tell, keep and share are the core plugin's (`core/1`).
    Free editing is `edit` on a type and field. Reading is still the key (rule 5): `read`'s check is holding it.
  - **The Doc an op acts on is a parameter,** bounded by a target over the Doc's birth facts (its id, vault, type and
    the actor that spawned it), never by a query over content, so what a cap covers can't drift with the data (caps
    rule 6, A8). A keep cap's target is resolved to Doc ids by its issuer's devices for a blind keeper (#1642). The
    targets are three forms: a Doc (with what it spawned or lists, or not), a vault's Docs and a vault's Docs of one
    type, each with the vaults below or not.
  - **A query's flexibility comes as a collection** (Samuel, 31 Oct 2026: "photos tagged beach from 2026"): a Doc of
    the sharing vault that lists Docs, like a smart album. The vault's devices run the query, an op, and sign each
    change to the list; a cap names the collection and what it lists. So what a cap covers changes only by its
    issuer's signed act, never because someone edited a tag, and anyone can check it, keepers too. A Doc that leaves
    the list is dropped by the holder's devices at their next sync (A40).
  - **Footprints are computed from an op's lowering** (E1 to E3), never written in a cap, so what an owner approves is
    the op's name and definition, exactly what it lets the holder do. An envelope names the op it ran; a reader checks
    the cap lists it and the steps are what it produces.
  - **Narrowing is a subset:** fewer ops, or tighter bounds. An op is pinned by its hash, and a vault adopts a new
    version as it adopts an actor's (`replaces`), so a grant never changes behaviour by itself.
  - **One list of what can be done:** an actor's `describe`, an app's actions and the record of who did what are the
    ops a caller's caps allow.
  - Lean first, before any caps code: Core's `Verb` and `Grant`, caps' `Line` and the engine's op declaration become
    one.
- **A39. Every Doc has a type, always** (Samuel, 31 Oct 2026: "no doc can be without type ever"). A Doc's genesis
  fixes its root type with its vault (docs D11), and Core's `Facts.type` is never empty. That holds for every kind of
  Doc: the network tree, a carrier Doc, the release vault's Doc, an actor's Doc, a catalogue, a period Doc. A type Doc's
  own type is the one built-in type of types. *Decided: yes.*
- **A33. An actor's message is an envelope** in the carrier Doc of its two vaults (A17), born with the first letter
  through the letterbox, and delivered as any Doc's envelopes are (K11): live by the pair's gossip, caught up by
  reconciliation; a direct connection is a faster path for the same sync. The receiver's turn names the message by hash
  (rule 2), which is its receipt; the delivery `ack` frame goes. *Decided (the architect, 31 Oct 2026): it follows
  from A17 and K11; for milestone 3.*
- **A34. Catch-up on Doc logs only.** Thread C's catch-up is written for Core's log, never for the chat's chains. The
  tree is the first Doc (A12, A30), the chat the second, moving onto a Doc with no interim fix and its history read as
  it is; members catch up the chat from each other once it is a Doc, and the chat's wants, sync and queries are then
  every Doc's. *Decided: yes (Samuel, 31 Oct 2026: "don't do weird patching, only clean architecture, always").*
- **A35. One presence:** a signed beat per device, ordered by its counter, its time a claim (rule 12). The hub's
  connection count, the chat's `here` and `bye`, and the wire's `Beat` frame go, with thread C. *Decided (the
  architect, 31 Oct 2026).*
- **A36. Releases** (the release vault comes later, A42): one release record per package, ordered by its dated version (`@aven/os@26.10.31`), an envelope
  in the release vault's Doc, which the genesis names and whose owners approve each record. The ALPN `aven/db/1` is a
  frozen name; the hello's number is the only wire version (#1649); a format's label is its version. *Decided (the
  architect, 31 Oct 2026); who owns the release vault is for Samuel, with thread E's signer proposal.*
- **A37. state-runtime returns K8's steps** (put, patch, remove, edit at a path), which are the turn's commit and the
  footprint caps check, never a whole new state. *Decided (the architect, 31 Oct 2026): it follows from A19.*
- **A38. Membership is a cap:** Maia City's vault grants each member's vault a member cap, which is what a join is. A
  member shows its chain and anyone checks it (rule 4), so no device needs the roster; the tree keeps Maia City's
  governance and its withdrawals. The confirm op Aven holds under Maia City's cap issues the member cap, for a claim of
  a ticket Maia City issued. *Decided: yes (Samuel, 31 Oct 2026).*

- **A40. Holdings follow caps** (Samuel, 31 Oct 2026). A device or keeper holds only what its caps cover (rule 6:
  wants ∩ caps), so whenever coverage shrinks, honest peers drop the bytes and keys at their next sync: a delete (for
  everyone), a Doc leaving a collection, a revoked or narrowed cap, a withdrawn keep cap. One rule instead of four. Its
  limit is honest: a copy someone deliberately took outside avenOS can't be reached by any system. *Decided: yes.*

- **A41. avenOS's documentation is "Brain"** (the tab and `#/brain`), so "Docs" means only avenDB's Docs. *Decided:
  yes (Samuel, 31 Oct 2026).*

- **A42. The contradictions of 31 Oct** ([`audits/contradictions.md`](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/audits/contradictions.md)). Samuel decided four
  (31 Oct 2026):
  - **MaiaCityGuardian stays a super admin for now:** a full owner of every person's vault, as caps D12 has it. Specs
    that call it recovery say so: recovery only comes later.
  - **The owner key is derived from the passkey's PRF and never stored,** the more secure way. Its boundary is every
    origin under `maia.city`, since the passkey answers any of them, so every such origin serves only our signed
    releases (A15). Rule 13 holds within that.
  - **Maia City's tree is its public register:** the genesis, governance, tickets, withdrawals, the relay and keeper
    lists and the settings, in a public Doc whose readers are everyone (rule 9 holds: it is sealed to its readers).
    Who joined is in the members' own caps (A38), not in the register.
  - **Release signing by a vault comes later.** Until then a release is the dated release from `production`; A36's
    release vault is for then.

  The rest are resolved under the rules above; each thread fixes its own files, Lean first:
  - **k of n:** a statement's signatures beside its `[label, body]` (A30) are D14's approvals, and each vault stores
    its threshold; an owner change is a governance statement, never a new genesis (avenPEER, caps).
  - **Who confirms a claim:** A38's confirm op, which Aven and the genesis's confirmers hold under Maia City's cap;
    every older answer (owners' devices, the admin's device) goes (avenPEER, glossary).
  - **The guardian's setting** names which guardian vault new vaults are founded with; it never changes who owns an
    existing vault (caps rule 2). A claim names the guardian vault, not its keys (avenPEER).
  - **Releases:** one model, history in the release vault's log (A31), ordered by the log, never by its dated version
    (rule 12); a split ends that log and the vault's owners start a new one (thread E).
  - **A device is its own vault** (rule 15's wording; caps D2, slide 7).
  - **Collections:** coverage through a list is decided by the listing envelopes in the reader's past, signed by the
    collection's vault; a write counts if its Doc was listed in its past; lists change by their vault's own acts, not
    while catching up others (caps).
  - **Address records** carry a generation, so a split ends one generation, not the device (avenPEER).
  - **Log tips are history,** never beats, and a log's split is final; a presence beat's counter orders only, and each
    peer ages what it heard by its own clock, so no beat dated ahead stays present (avenPEER).
  - **A39's base case:** the type of types is a fixed, built-in id, and every Doc kind names its root type: tree,
    carrier, release, directory, collection, vocabulary (docs, caps).
  - **A carrier Doc** belongs to the vault that opened contact; the other holds read and tell on it; its readers are
    its group, so its gossip is the group's; caps' letters only start it (actors, caps).
  - **A directory entry** is its own envelope in the directory's Doc, never written in another Doc's commit (docs).
  - **Runtime floors** become A7's pin withdrawals, so readers never disagree on an envelope (runtimes).
  - **The wire** keeps no default for an older peer; the hello's version 0 is read only to answer `update` (thread E).
  - **Status tables** say what is open: rules 3, 7, 12, 15 and 16 (docs, caps).
- **A43. The Doc foundation comes first** (Samuel, 31 Oct 2026: "do it"). Envelopes and logs in aven-core, avenID's
  keys (the passkey's PRF step, owner and seal keys, the keyring, Doc keys), the minimal caps (Own, device caps,
  member caps), the docs layer and the ops engine; then the tree as the first Doc and the chat as the second, a fresh
  Doc (the old chains stay stored, never wiped); then catch-up, keepers and the failures. Thread E's wire runs beside.
  *Decided: yes.* The keys' browser half, decided 31 Oct 2026:
  - **No passkey without PRF makes a vault** (Samuel: "refuse, explain"). Sign-up stops with a plain message, so
    there is one kind of vault: post-quantum, and it opens on any device. There is no ES256-only owner.
  - **The PRF input is only the epoch** (`["avenID prf 1", {epoch}]`): a passkey's PRF secret is already its own,
    and a passkey belongs to one vault. So sign-up evaluates the PRF at create and signs the claim, owner and seal
    halves included, with one more tap. A new browser signs in with one tap. The epoch stays, so a leaked output
    never opens a later epoch.
  - **The register maps a credential id to its passkey record:** its vault, ES256 key, owner and seal public halves
    and epoch, parameters of `tree/1`'s claim and join. A sign-in names no vault: it is the vault of the passkey that
    signed. Caps rule 21's two proofs are two signatures beside the one name (A30): the passkey's ES256 and the
    owner's hybrid. The old text statements gain nothing.
  - **A device's hybrid key comes from its own seed, and counts only once its owner binds it** (the architect, 31 Oct
    2026). Its ML-DSA-65 seed is `derive_key("avenID device ml-dsa 1", the device's Ed25519 seed)`, in the process
    that holds the seed, wiped after use, never from a passkey. A quantum attacker recovers the Ed25519 scalar, never
    the seed it was hashed from, so the ML-DSA half stays out of reach (as X-Wing derives both its halves from one
    seed). It rotates with the device key, and needs no second secret and no migration. Its public half counts only
    where the vault owner's hybrid signature binds it: in the sign-in that admits the device, or for a migrated device
    at its owner's `ownerEpoch` or next sign-in. A binding signed only by the device's own Ed25519 never counts
    (`device_hybrid_bound`).

- **A44. Placement has one source: the owner's vault** (Samuel, 31 Oct 2026: "we can't have two sources of truth
  for who keeps what; it's always co-located with the owner's data and vaults"). A vault's keep caps say which keeper
  holds which of its Docs and Values, issued and kept by the owner's vault beside its data (A22). A keeper decides only
  about its own resources: its vault issues **offer caps** to a vault or a group, how much may be stored there and how
  fast (quota, rate limits). A keeper keeps a Doc only where both hold: the owner's keep cap names it, and the
  keeper's offer covers that owner (keep caps ∩ offers, as wants ∩ caps). The admin's keeper list goes: the offers
  Maia City's members hold are the list. The relay list stays Maia City's: it is about who sees members' connections,
  not about data. *Decided: yes.* What follows from it (the architect, 31 Oct 2026, for the clean-slate cutover):
  - **The default keep cap is the owner's own act at join.** The claim carries it: everything to Maia City's keeper,
    the Aven Peer acting for Aven (`default_kept`; the tree's claim statement, in caps' keep-cap form). A member
    migrated from production never approved one, so the migration doesn't invent it: they approve it at their next
    sign-in, where avenOS shows what it covers and to whom.
  - **A keeper learns a Doc's owner from the keep cap's issuer,** never from the Doc, which it can't read. It reads
    no other caps, and serves and takes only on a fetch proof (`Aven.ID.Keep`).
  - **What a keeper drops is the uploader's own word, about its own uploads.** A segment upload names the loose items
    it covers by their sealed hashes; the keeper takes only that device off those items' uploaders, and drops an item
    once no uploader is left. A lie costs only the liar, no reader can make a keeper drop another device's envelopes,
    and a writer that never comes back loses nothing (scenario 16). Lean: `Aven.Peer.Keeper`.
  - **One fetch gate, on the Peers' own frames.** A fetch proof signs the TLS exporter of the connection that serves,
    so sealed Doc values travel on that same connection: `prove`, then `fetch` and `items` frames on aven/db/1, each
    item checked against its hash before it is stored. Readers and keepers use the one gate. iroh-blobs stays for files.
  - **Keepers' caps are caps' code.** Keep caps, offer caps, quotas and the gate's fetch-key chain and proof check are
    avenID's, in aven-id, replaying `keep.json`. The keeper's own crate (`aven-peer-keeper`) holds only arrivals,
    covers and pages.

- **A45. One concept, one owner** (Samuel, 31 Oct 2026). Every concept is defined once, in the spec that owns it,
  with its vectors beside it; the others reuse it and add only what is theirs, as parameters. Core defines the
  primitives (Values, names, signed things, envelopes, logs, the past, splits, counting, limits, ops, calls, targets,
  steps, built-in type names); avenID supplies *authorized*, docs supplies *fit* and writer ids, the engine lowers
  calls to steps. The duplicates found on 31 Oct 2026 go:
  - **Counting** is Core's `Counts`, with fit and authorized as parameters: docs' own `Verdicts` and counting, avenID's
    record counting and the tree's own past go (A30, A31) (core, docs, caps, avenPEER).
  - **Signatures** are Core's `Sig {signer, sig}` beside a name: caps' approvals count k of n over them, and the
    keeper's `Signed` becomes `KeepOrder` (core, caps).
  - **An envelope's `cap` and `acks`** are caps' authority part of the body; docs carries it without reading it (caps,
    docs).
  - **Writer ids** are docs': Core takes `writes` as a parameter, and caps never derives one (docs, core).
  - **"Op" means only an op.** Loro's op id is a `LoroId`, and the body's counter range is `loro {from, to}` (docs).
  - **Built-in type names** come from one `builtinType` in Core; each spec lists its own types (core, caps, docs).
  - **Vectors** have one owner each: db's copies of `envelopes.json`, `logs.json` and `counts.json` go (docs).
  - **Runtimes live with their publisher's vault:** a module is a blob, and its manifest a typed Doc, owned by the
    vault that publishes it (Aven's for the built-ins), kept where its keep caps say (A44). Git holds the frozen bytes
    only until Docs run. A runtime runs on the reader's device, in a worker of its own, apart from the device key.
  - **Owners are packages, not threads.** The tree (Maia City's register and membership) and the seal are avenID's,
    whichever thread writes them; the wire and its frames are the Peers', with their Lean (today `Aven.DB.Wire`).
  - **The first generation splits up.** `aven-db-core` holds four jobs today; each goes to its owner as Docs arrive:
    the wire and presence to the Peers, the chat to a Doc, files to the Store and the registry.

  - **The wire moves first** (the architect, 31 Oct 2026). Before any Doc frame is added, the wire and presence leave
    the first generation for the Peers: the Rust into `peer/wire` (`aven-peer-wire`), the Lean into the Peers' own
    package `peer/spec` (`Aven.Peer`), wire v2 byte for byte. The Doc frames (`Aven.Peer.DocSync`) and the keeper's
    (`Aven.Peer.Keeper`) land there, in one step to wire v3.

  *Decided: yes.*

**The engine and actors**
- **A9. The want queue** as in [Massive data](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/ARCHITECTURE.md#massive-data-wants-decide-what-moves). Its laws go into Lean before
  any code: tiers only order, each key once at its highest tier, prerequisites inherit priority, every round moves,
  `now` is never evicted. Older periods are reached by a bounded `follow` of the link to the period before. *Decided:
  yes (Samuel, 30 Oct 2026: "do as you believe"); its laws are proven in Lean (#1530).*
- **A17. Actors fold into docs.** Samuel, 30 Oct 2026:
  - an address names a vault-scoped id with an incarnation counter, never a device, and the home only routes:
    *decided, yes*;
  - a message is stored once, by hash: *decided, yes*;
  - an actor's history is its Doc's Loro history, a turn is one commit, and Loro snapshots are its checkpoints:
    *decided, yes*;
  - every actor keeps its own inbox (queue, read position, order of handling). Between devices one carrier Doc per
    pair of vaults, written by the sending vault's home device; none within one home: *decided, yes*;
  - loads are journaled as versions, not as data: *decided, yes* ("do as you believe");
  - a definition is a version of an actor type, `replaces` names the version before, and a lens carries the state:
    *decided, yes*.
- **A27. An actor host writes only under its actors' chains** (caps and avenACTORS, 30 Oct 2026):
  - one device key per host, in a narrow device vault of its own, never a member's personal device. Its device cap is
    the union of its hosted actors' standing caps: an outer bound a misbehaving runtime can't exceed;
  - a host device never writes on its vault's own authority, only under a chain. Each envelope names the acting actor
    and the chain its message acts under (narrowed per hop, D16), so each actor is bounded by its own chain;
  - the Aven Peer signs with Aven's own device, under a chain the owner issued to Aven's vault for that actor's Docs and
    the owners approved (D14), never as a device of the owner's vault. Its writes stay attributable to the host and
    revocable as one cap, beside A16's read caps.

  *Decided: yes (Samuel, 31 Oct 2026: "do it").* A host gets only the caps its owners give it. In Lean, avenACTORS
  proves the kernel's half (`Aven.Actor.Signing`, #1617: `signs_by_chain`, `write_names_actor`, `write_keeps_chain`,
  `actor_within_chain`, `actor_calls_within`), and caps the reader's (`host_chain_only`, `actor_within_device`,
  `host_never_beyond`). Version 1 (no caps, in memory) is unaffected.

  Lean showed where per-hop narrowing (D16) lives. *The architect's answer (31 Oct 2026):*
  - **A write** carries its message's chain as it came. The actor's narrowing for that write is its footprint, which
    the reader checks against the chain; it is never appended as a link, which would need the owners' approval (D14).
  - **A cap that travels on in a message** narrows by an attenuation link. It needs no approval, since it grants
    nothing new. It is valid only within its parent, keeps its parent's holder, is signed by a device of that holder,
    and only follows an approved grant (#1626: `attenuate_within`, `attenuate_signed`, `holder_granted`).
  - **A message that crosses to an actor on another vault's host** (caps and avenACTORS agreed, under D14 and D16):
    - by default, authority doesn't cross vaults. B acts under its own standing caps, and A's chain travels only as
      provenance;
    - acting with A's authority needs a standing grant to B's vault that A's side approved, which attenuations may
      follow. A holder changes only by an approved grant (`new_holder_granted`).
  - **Who checks what.** A reader checks the owner-approved bound: every grant and every attenuation within its parent.
    The kernel holds the per-message narrowing within that bound, since after a standing delegation a reader can check
    an attenuation only against the delegation; avenACTORS proves it (`attenuation_within_message`).
- **A18. Plugins are runtimes.** A lowering is pinned by its runtime's hash, and an envelope carries the lowered hash.
  *Decided: yes (Samuel, 30 Oct 2026: "do as you believe").*
- **A19. One update grammar:** put, patch, remove and a new `edit` for text, lists and trees, each with a verb and a
  footprint. *Decided: yes (Samuel, 30 Oct 2026: "do as you believe").*
- **A20. Facts for relations, Records for documents.** *Decided: yes (Samuel, 30 Oct 2026: "do as you believe").*
- **A21. Search is local first,** as [above](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/ARCHITECTURE.md#search-local-first): a device searches what it holds, and its wants sync
  what it wants to search. *Decided (Samuel, 30 Oct 2026).*
- **A26. Sealed indexes,** as [above](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/ARCHITECTURE.md#a-handful-among-millions-sealed-indexes): directories and indexes are one
  structure of sealed Values; the engine derives an index from each query's shape; a lookup reads a few Values, then
  only the Docs they point to, and the query runs on the device. *Decided: yes (Samuel, 30 Oct 2026: "A26 is what we
  want").* The docs model has the tree (#1540, a Prolly tree: a lookup finds exactly the entries in range, and every
  node stays within 64 KiB).

**Caps**
- **A22. A peer that keeps sealed data for others checks who may add or fetch it, without reading it.** Phones and
  browsers are rarely online at the same time, so some peers keep a Doc's sealed bytes for its readers: any member's
  own Peer, or the Aven Peer, under a keep cap. Such a peer can't read caps, so it checks key proofs instead. Fetch keys
  chain from the Doc's genesis, each signed by the one before; it keeps every successor, takes the smaller epoch hash
  as current as writers do, and flags a fork; the uploading vault pays. Peer to peer: any peer may keep, and none is
  special. *Decided: yes (Samuel, 30 Oct 2026),* and proven in Lean (#1543). Its proof exposed a grind: a removed
  reader still holds its last fetch key, so it can fork from it and grind its epoch hash below the writers', and a
  keeper, which can't check caps, would refuse honest readers until the fork settles. Availability only: writers never
  seal to the removed reader. So while a fork is flagged, the keeper serves proofs by either branch's newest key, and a
  device of the vault that issued the keep cap signs which branch to follow, naming the fork point. The keeper checks
  that signature against the tree and ignores later forks from that point. *The architect's answer to the caps
  thread's open question 1 (30 Oct 2026).*

  **Who keeps what is each vault's own decision, by the keep caps it issues** (Samuel, 31 Oct 2026):
  - a keeper's offer caps say whom it offers to keep for (A44; the admin's keeper list went);
  - a vault's keep caps say which keeper holds which of its Docs and Values; their targets may be queries (A8);
  - by default, a new vault issues a keep cap for everything to Maia City's keeper, the Aven Peer acting for Aven, and
    each vault can change it;
  - **the vault's owner always decides where its data is shared to** (Samuel, 31 Oct 2026). The default keep cap is the
    owner's own, approved as part of what the owner signs to join (D14), and it names its keeper. No one else can extend
    it: not Maia City adding servers, not a keeper passing data on. A new keeper needs a new keep cap from the owner.

  Keepers stay blind (rule 9). A file is no special case: its chunks and chunk list are Values that a file Record in a
  Doc names, kept and read as that Doc is.

  **So a vault decides who keeps its data and who sees it, by its caps:** keep caps for keepers, keys and read caps for
  readers. This is what data privacy and the right to be forgotten rest on (Samuel, 31 Oct 2026):
  - withdrawing a keep cap makes the keeper drop what it covered and stop serving it;
  - a delete spreads to every peer, and keepers drop the bytes (live in the chat since #1583);
  - rotating a Doc's key shuts removed readers out of everything after it;
  - once every key holder drops a Doc's keys, any copy left anywhere is unreadable.

  What a reader has already seen can't be unseen; no system can. The Lean for all of this, and for the rest
  of PEERS threads B to F, comes before their code (Samuel, 31 Oct 2026: "do all lean for these things first").
- **A23. Acks can't launder:** a revoked holder's envelope never counts if the revocation is in its past. *Done in
  caps (#1499), as what D8 meant.*

**Housekeeping**
- **A24. The layers** as drawn [above](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/ARCHITECTURE.md#the-whole-on-one-page). *Decided: yes (Samuel, 30 Oct 2026).*
- **A25. Publish the six audits** under [`audits/`](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/audits/README.md) now that the security fixes are live. *Decided:
  yes (Samuel, 30 Oct 2026), done.*

#### Rules 7, 15 and 16, which name Samuel's decisions

7. **No privilege by position.** A peer holds only the caps its owners granted:
   - keep caps, which keep bytes blind;
   - hosting, which is an explicit read cap per actor, shown to the owner;
   - relaying, which moves sealed bytes.

   No peer is a sequencer, an arbiter, a custodian or the only source (Samuel, 30 Oct 2026).

15. **Vaults own; signers only sign** (Samuel, 31 Oct 2026). Only a vault owns things, holds caps and is an admin,
    as a smart account does. A key (a passkey, a device key, a release or guardian key) never holds authority itself:
    it signs only as an owner of a vault, k of n (D14). A device has its own vault, which its key owns and which the
    vault it serves owns; what it may do for that vault is its device cap. Every cap is issued by a vault and held by a
    vault, a group of vaults or the public (everyone); caps delegate between vaults, never between signers (**A28**).
    A bearer key, such as a ticket's one-time key or a fetch key, proves a condition of a cap and never holds one.
16. **Clean architecture only, never a patch** (Samuel, 31 Oct 2026: "don't do weird patching, only clean
    architecture, always"). A fix goes where the primitive is, once, for every use of it. Nothing is built for a
    structure that is about to go, such as the chat's chains before the chat is a Doc; until the clean form exists, the
    old one stays as it is.

### From the caps README

1. **This folder is the one caps spec** (Samuel, 30 Oct 2026). It lives beside `id/spec` and `id/core`. avenACTOR's
   discovery document folds in: its rules learned and first principles became the rules and the model here, and its
   survey moved whole to [`research.md`](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/id/caps/research.md). Its old path becomes a pointer on its branch.
2. **Vaults issue and hold caps** (Samuel, 30 Oct 2026). A device is a vault, so "a narrower cap for one device" is a
   cap its device vault holds. Actors hold no keys. (A ticket held one until a vault claimed it; since A42 a bearer key
   only proves a condition, and a ticket's key proves its claim.)
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

22. **Caps are built from ops** (A32, Samuel, 31 Oct 2026: "caps should be built from their ops"). A line is an op by
    its hash, a target and bounds on its parameters; footprints come only from an op's lowering, so what an owner
    approves is exactly what the holder may do. `core/1`'s verbs are ops with fixed ids, a query is a stored op, and
    bounds are enumerations. This replaces decisions 4 and 5's operations and footprint grants. A query's flexibility
    comes as a collection, whose list its issuer signs.
23. **Holdings follow caps** (A40, Samuel, 31 Oct 2026). A device or keeper holds only what its caps cover, so when
    coverage shrinks, by a delete, a Doc leaving a collection, a revoked or narrowed cap or a withdrawn keep cap, honest
    peers drop the bytes and keys at their next sync.
24. **Placement has one source, the owner's vault** (A44, Samuel, 31 Oct 2026). A vault's keep caps say which keeper
    holds which of its Docs; a keeper's vault only offers its resources, quota and rate, to a vault or a group, and
    keeps a Doc only where both hold.

Agreed with the engine thread (30 Oct 2026):

- **E1.** Footprints carry verbs, fields and constraints, computed once from the lowering.
- **E2.** `where` is checked only on fields that never change.
- **E3.** Caps name an op by its hash, and an envelope carries its op's hash and params (A32).

### From the docs README

1. **Value and Doc are the primitives,** and a Record is a map container named by id (Samuel, 30 Oct 2026). Only a
   Doc's head moves, and "ref" stays the store's word.
2. **One envelope is one Loro commit** (Samuel, 30 Oct 2026). One signature, one footprint, one fit verdict.
3. **Each writer closes its own segments** (Samuel, 30 Oct 2026), so segments are the same bytes everywhere and a split
   shows as two runs after one envelope. When they close is the docs thread's (Samuel left it to the thread): count,
   size, epoch, quiet, page, tuned by the catch-up target.
4. **Snapshots stay local; checkpoints travel** (Samuel, 30 Oct 2026, A5). Trusting derived state is a signed,
   checkable statement, never an owner's word.
5. **Records flat by id in one root map** (Samuel, 30 Oct 2026). Addresses never move, and every change maps to a
   Record.
6. **A writer id is worked out from the avenID device** (Samuel, 30 Oct 2026): one identity, one function, one check.
7. **History names its past by hash** (Samuel, 30 Oct 2026, A3). Op ids alone can't show a split.
8. **Splits are final** (Samuel, 30 Oct 2026, A4, replacing a settlement that picked a side). Every reader agrees, and
   no edit counts twice.
9. **Fit depends only on what the envelope names,** and is judged per Record (Samuel, 30 Oct 2026). Every reader
   agrees, so it is computed once.
10. **A schema says only what survives a merge** (Samuel, 30 Oct 2026). Then fit needs only the ops, and every merge of
    fit envelopes fits.
11. **A Doc pins the versions it accepts** (Samuel, 30 Oct 2026, A7, replacing "ever listed by its type"). A type's
    writers can't decide fit for every Doc for good.
12. **An unfit envelope leaves its log stuck,** and the device starts its next generation (Samuel, 30 Oct 2026).
13. **A Doc's id is the hash of its signed genesis, with a nonce** (Samuel, 30 Oct 2026). Owner and type are sealed
    into the name.
14. **Branches inside one Doc; a fork is a new Doc** (Samuel, 30 Oct 2026). A fork carries state and a link to its
    origin, not its history, so its caps and key are its own.
15. **A tree of lenses per type, and pinned lenses across types, as one forest** (Samuel, 30 Oct 2026). Paths are
    unique, so two paths can't disagree; a lens between two types counts only where owners pin it.
16. **Named versions are Records** (Samuel, 30 Oct 2026). A name is a person's act, and syncs.
17. **Revert by Loro's `revert_to`; back out by a three-way merge** (Samuel, 30 Oct 2026). Loro 1.17.1 made both all
    or nothing, so avenDB-old's revert-by-merge goes.
18. **Streams are chains of period Docs** (Samuel, 30 Oct 2026, A6).
19. **Today's chat chains are read as they are** (Samuel, 30 Oct 2026). No re-signing; nothing wiped.
20. **One vocabulary** (Samuel, 30 Oct 2026, items 1 to 13): the terms above, matching the glossary.
21. **Text never conflicts in a merge** (the docs thread). Loro's character merge is what people expect; overlapping
    edits are shown for review.
22. **A crate of its own, `aven-db-docs` in `db/docs`,** a pure core (README, rule 2), with Loro pinned at exactly
    1.17.1, the version its source was checked at (the architect, 30 Oct 2026).
23. **Directories and indexes are Prolly trees of sealed Values** (A26, Samuel, 30 Oct 2026; the Prolly tree is the
    docs thread's choice): the same entries give the same root, every node stays under the size limit, recent entries
    stay in the directory Doc until a fold.
24. **The formats follow A28–A44** (the architect, 31 Oct 2026): an unsigned genesis named by A30 and carried by the
    first envelope; a body with `calls` and half-open `ops`; built-in types named by their labels and never pinned;
    one seal for loose envelopes, segments and checkpoints (`Aven.ID.Seal`).

### From the engine README

1. **Plugins are built-in Rust,** versioned with the engine (Samuel, 30 Oct 2026). Untrusted code stays in actors, which
   write operations. Run-time plugins can come later behind the same interface.
2. **Values and Docs underneath; the Record is the engine's one primitive** (Samuel, 30 Oct 2026). Values are
   immutable and named by hash, Docs mutable and named by id; a Doc holds Records, every one under a schema and named by
   its own id, with no paths. A Doc is a root Record, and a type says which of its Records are roots. Facts, lines, pages and files' entries are Records of different types: one model of data
   in avenDB, not one per layer or plugin.
3. **Sync and load are one want** (Samuel, 30 Oct 2026): durable keeps, mounted opens, one scheduler orders both.
   avenDB-old had wants, keep shares, copy settings and follow lists for one job.
4. **A want's target is the caps' target grammar,** plus demand-only fields (Samuel, 30 Oct 2026). Served is want
   intersected with caps; authority is never demand.
5. **Actors declare, devices decide how deep** (Samuel, 30 Oct 2026). One actor definition everywhere; the device's
   profile picks which tiers it keeps.
6. **One evaluator; plugins lower to it** (Samuel, 30 Oct 2026). avenOS's grammar already was an algebra over x1–x5 rows. With
   Records as the primitive, the algebra belongs to the core, a plugin is a grammar with checks and a lowering, and
   bounds, footprints, caps and deltas are worked out and proven once.
7. **Operations are named by their hash,** avenDB's native id (Samuel, 30 Oct 2026); catalogues name them for people.
8. **A kind stays inside one plugin** for now (Samuel, 30 Oct 2026).
9. **The docs layer checks envelopes; the engine checks operations** (Samuel, 30 Oct 2026). Each checks what it can
   understand.
10. **Indexes in a later iteration** (Samuel, 30 Oct 2026), then **sealed indexes** (A26, Samuel, 30 Oct 2026): an
    index from a query's shape, kept by acts and readable only with the key, and search local first (A21). Queries scan
    within their bound where no index serves them.
11. **Mutations atomic per document.** A promise across documents would need coordination the network doesn't have.
12. **Sync by version, not by budget,** and **iroh before our own:** gossip for live changes and heads, iroh-blobs for
    bytes, irpc for our messages.
13. **avenACTORS' engine notes are research,** moved to [`../research/E1-avendb-old-engine.md`](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/db/research/E1-avendb-old-engine.md)
    with nothing cut, so avenDB has one engine spec (Samuel, 30 Oct 2026).

### From the runtimes README

Samuel answered the plan's twelve questions on 30 Oct 2026. Where he left one to us ("do what's best"), the choice is
the safer one, and it is marked so.

1. **One home.** Every runtime (actors', plugins', files') lives in `aven/runtimes`, its own workspace, with one
   contract, one host and one manifest. *Yes.*
2. **Names.** File runtimes are named after their format (`svg-runtime`), actors' after their job (`state-runtime`,
   `js-runtime`, `face-runtime`), plugins' after their plugin, all in one
   namespace. *Yes;* the glossary and the actor spec use these names.
3. **No file runtime before the files origin** (A15). The registry ships first, with `native`, `frame` and `download`
   only. *Yes.*
4. **One implementation of the registry.** The registry is one Rust crate, also built to wasm, which the Service
   Worker and the chat load, so the same code decides everywhere, instead of a Rust reader and a JS reader that could
   drift apart. *Ours: the wasm.* The generated JSON stays as the data and the vectors.
5. **wasmi everywhere.** *Ours, the more secure:* an interpreter has no JIT to attack, and its fuel is the same on
   every device. A runtime too slow there is made to do less first; a faster engine is a decision of its own later.
6. **Byte strings in Values.** *Decided by A2* ("CBOR is good"): the one codec is deterministic CBOR, whose byte strings
   carry file bytes, pixels and buffers in Values.
7. **Plugins as runtimes, built twice:** native in the engine, frozen as wasm whose hash names the lowering, with
   the check proving them equal. *Yes;* it reconciles D1 (built-in Rust) with A18.
8. **The actors' runtimes are born here,** in `aven/runtimes/actor/*`, with avenACTORS still owning what they do.
   *Yes;* avenACTORS agrees.
9. **One node-tree allowlist and one applier,** here, used by faces and files alike. *Ours: yes,* since a second
   allowlist would be the two-lists problem again.
10. **The PDF renderer:** *the most beautiful one.* A spike renders a corpus of real PDFs (text, fonts, vector
    drawings, images, forms) with each candidate that runs in wasm (PDFium, pdf.js's renderer, a pure-Rust one) and
    picks the one closest to the reference, within the runtime's limits.
11. **Frozen modules are rebuilt, not committed.** *Ours:* the repository holds the source and the manifest's hashes,
    the box rebuilds each module the same way every time and the check compares hashes, and releases carry the bytes,
    so no unreviewable binary sits in the repository.
12. **Nothing outside the network in a render:** no remote image, font or stylesheet, ever; links only by a click.
    *Yes,* a law of the registry.

### From the store README

#### Big files are hash sequences (decided)

The drafts differed: the store draft added writing in parts, outboards and partial blobs to the contract; the engine
proposal kept the contract and split big files. **We split** (the architect, 30 Oct 2026):

- **A file is a hash sequence of chunk blobs.** Each chunk is at most 1 MiB, stored as one ordinary blob. The file's **index** is a blob listing its chunks' hashes in order (iroh-blobs' `HashSeq`), and the
  file is named by the index's hash.
- **The contract stays as it is:** `put` is whole or absent, refs are compare-and-set, nothing appends. No outboards,
  no partial blobs, no writers in parts; `Aven.DB.Store` needs no new state. A movie of several GB never sits in memory:
  the sender puts it a chunk at a time.
- **Seeking fetches chunks:** minute 40 is the chunks minute 40 lies in, each checked whole against its hash when it
  arrives. What a peer holds of a file is which of its chunks it has, which the store already answers.
- **Outboards are made, not kept:** iroh-blobs builds a chunk's bao tree when it serves or checks it (1 MiB is 64
  groups of 16 KiB, about 4 KiB of tree). A blob the store reads from S3 is checked whole against its name, as `get`
  does today. SANDBOX.md's "ranges aren't hash-checked yet" is closed by reading a chunk whole.
- **The cost:** a 1 GB movie is about a thousand objects in S3, and a thousand GETs to fetch it all. Acceptable; the
  spike measures it.
- **Limits** (the security audit, 30 Oct 2026; `Aven.DB.Files`): the largest blob a peer fetches is **1 MiB + 64 KiB**
  (`maxBlob`, a chunk and room for framing), checked before anything is allocated, since the size a holder states
  is its word until bao has checked the last chunk (iroh-blobs 0.104.0 hands it to the store's `import_bao` at once).
  The largest file is **32 GiB** (`maxFile`), whose index, 32 KiB hashes, still fits in one chunk (`index_fits`); a
  `file` line past it is refused as `badFile`.
- **A file is cut as it must be** (`Aven.DB.Files.fits`): every chunk but the last is exactly 1 MiB, the last 1 byte to
  1 MiB. A receiver checks it on fetch (the Aven Peer fetches the index first, refuses one listing more or fewer
  chunks than the line's size needs, then checks every chunk) and on every read; a malformed file is
  `KeepError::Malformed` or `Corrupt`, never a panic, and the Aven Peer doesn't fetch it again.

#### What the store asks of the opfs driver, item 4

4. **Lean and the suite.** `Aven.DB.Store` keeps its state (blobs whole or absent, refs compare-and-set) and gains a
   crash between the temporary file and the move: what was moved is whole, the rest is swept. A change of leader is
   a change of the one writer, under the lock: modelled as one writer at a time. The suite runs in a dedicated worker
   only (the page run goes), in all three engines. The first gate, 200 writes of 4 KiB under 250 ms, came from
   in-place writes; one file per blob can't meet it (opening a sync access handle costs 1.7 to 23 ms). **Decided (the
   architect, 30 Oct 2026): this upgrade ships one file per blob**, and the gate is the real workload, per engine
   (`store/opfs/run.mjs`): a chat line (one blob and one ref) and a 1 MiB chunk put, medians of 50, and catch-up of
   500 lines. Writes run in the background (local first), and catch-up shows lines as they land.

   | | chat line | 1 MiB chunk | catch-up of 500 lines |
   |---|---|---|---|
   | gate: Chromium and WebKit | 60 ms | 30 ms | 10 s |
   | gate: Firefox | 150 ms | 100 ms | 30 s |
   | measured, Chromium 156 | 20 ms | 21 ms | 4.2 s |
   | measured, WebKit 27.2 | 13 ms | 24 ms | 2.2 s |
   | measured, Firefox 157 | 78 ms | 42 ms | 14.7 s |

   Refs and temporary files are read through `getFile()`, retried when a move replaces the file, since a reader's sync
   handle would block that move. Lines stay one blob each until Loro's segments (milestone 4): a line's hash is its
   name and is what's signed.

#### iroh-blobs on the store (decided)

**The spike decided** (the architect, 30 Oct 2026): iroh-blobs on our store, through one adapter
([`src/blobs`](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/store/src/blobs)), over `bao-tree` directly with our own range requests. Both were measured in the box on one
task: a 1 GiB file of 1024 chunks moving from Alice Peer's endpoint to a relay-only endpoint with Bob's Peer-Light's
key, through the Aven Peer's relay and nothing else, then a seek to its middle. Our crates at the box's dev profile.

| | (a) iroh-blobs + adapter | (b) bao-tree directly |
|---|---|---|
| 1 GiB through the relay, Alice on a folder | **201 MB/s** | 188 MB/s, 4 requests in flight |
| 1 GiB through the relay, from the box's S3 | 139 MB/s | 152 MB/s |
| Seek to the middle, cold (index and chunk), folder / S3 | **10.6 / 11.5 ms**, one request | 14.0 / 18.4 ms, two requests |
| Seek, warm (index held), folder / S3 | 8.3 / 12.9 ms | 6.6 / 10.3 ms |
| S3 GETs: the whole file / a cold seek / a warm one | 1058 / 3 / 2 | 1025 / 2 / 1 |
| Lines, without comments | 215 | 113 |
| wasm added, release after wasm-bindgen (gzip) | +1.09 MB (+314 KB) | +0.40 MB (+134 KB) |

(b) would have had to grow what (a) has: resume and fetching only what is missing, several holders at once, the
downloader, provider events for the gate, and one request for an index and any of its chunks, which saves a round trip
on every cold seek. Since the spike, the adapter keeps the last indexes it read and reads a file's next chunk ahead
while its chunks go out in order: 1025 / 2 / 1 GETs, as (b) (`tests/blobs.rs` holds it).

**How the adapter works:** an actor answering 6 of the 23 requests of iroh-blobs' store API (observe and status by
`size`, the exports of bao and of plain ranges, the import of bao, listing); tags, temp tags' protection and deletes
answer "unsupported" or nothing, since refs and reachability keep blobs. A fetched blob is buffered until every byte has
arrived, checked by iroh-blobs, then put once: whole or absent. In a browser the store is neither `Send` nor `Sync` and
iroh's protocol handlers must be, so the store lives in the actor's own task and only channels cross.

**The risk we take:** iroh-blobs has no public constructor for a store of someone else's (`api::Store::from_sender` is
crate-private). The adapter builds one with `RefCast` from the `irpc::Client` the type wraps, which it derives publicly.
A 0.x release may take that away: iroh-blobs stays pinned at exactly 0.104.0, and `tests/blobs.rs`'s
`iroh_blobs_runs_on_our_store` fails at once if it stops working.

### From PEERS.md

The architect decided these on 30 Oct 2026, by Samuel's delegation for A10 to A13 ("do as you believe"), each on this
thread's recommendation. Samuel may overrule any.

1. **Relays are on the admin's relay list.** An admin statement adds a member's Peer, with its relay's URL, to the
   network's relay list, and another statement removes it. Reason: a relay sees the IP addresses and timing of everyone
   it carries, and the relay path is what hides a member's IP from other members, so the admin chooses who sees that.
   Later the list is a cap that the network's owners grant: a grant, not a position.
2. **A browser bootstraps from what it already holds.** The signed relay list, the members' address records and the
   tree's tips are cached in the Peer-Light's OPFS, and are carried in every invite link. `/aven.json` stays as one
   source among several. Reason: a returning browser, and a new invitee, need no single host to find the network.
3. **Addresses are signed address records,** gossiped in the room, kept by every peer and fed into iroh's
   `MemoryLookup`. No DNS, no pkarr, no n0. Reason: it stays private, and relays don't talk to each other, so a dialer
   must learn a peer's home relay from somewhere it can verify.
4. **Two claims of one ticket: the smallest statement hash wins** (A12, `ticket_once`). Only someone holding the link's
   secret can make a second claim, so this happens only with a leaked link or a double tap.
5. **A withdrawal wins over every claim not in its past, and a claim is final once it is confirmed** (A12, A38).
   This is how a revocation wins over what it hadn't seen in caps. A withdrawal is the ticket's revocation. Reason: if a
   concurrent claim won instead, a withdrawal could never stop someone with a leaked link, who need only say they
   hadn't seen it.
6. **An undone claim is hidden everywhere, and kept.** The door closes on its devices at every peer at once, because
   every peer settles the same statements the same way. Its posts stay in the store, marked, and are no longer shown.
   Nothing is wiped.
7. **Catch-up comes from whoever holds the Doc's log** (A34, Samuel, 31 Oct 2026). Every native Peer, the Aven Peer
   included, answers catch-up of a Doc's log from its own store. A peer links to up to 3 members and asks whichever
   announced the newer tip. This is the want queue's order of sources (engine): your own devices, then other readers,
   then keepers. It is written once, for Doc logs: the tree is the first Doc, the chat the second once it moves onto a
   Doc. Nothing is built for the chat's chains. It answers engine open question 1.
8. **Each vault chooses its keepers, by keep caps** (Samuel, 31 Oct 2026; A22, A44). Placement has one source, the
   owner's vault: there is no keeper list. A keeper's vault issues offer caps (quota, rate) to a vault or a group, and
   the offers Maia City's members hold say who offers to keep. A vault's keep caps say which keeper holds which of its
   Docs and Values, and a keeper keeps a Doc only where the owner's keep cap and its own offer both hold. A new vault starts with one
   keep cap for everything to Maia City's keeper (the Aven Peer, acting for Aven), approved by its owner with their
   join, and only its owner changes it or adds others (Samuel, 31 Oct 2026). Keepers stay blind. Files are no special
   case: a file's chunks are Values that a file Record in its Doc names, kept as that Doc is. Every native Peer also
   keeps the chat's logs it hears. Any peer may keep, and none is special.
9. **What stays special is named, signed or on its way out** ([8](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/PEERS.md#8-what-stays-special)). The claim becomes the
   signed genesis that every member pins (A11). The guardian is named in what people sign (A13). The `maia.city` origin
   stays special until Samuel takes up A14.
10. **Milestone 2b, Lean first,** after milestone 2 and the store upgrade. The tree's Lean lives in `Aven.ID`'s
    `Network` module, built with the caps thread, on `Aven.Core`. There is one model of the tree, not two.
11. **Upgrades are a clean refusal.** Every connection's first frame carries a wire version, separate from the release
    and changed rarely. A peer refuses any other wire version with "update to join", and never falls back (README rule
    9). The Service Worker and native Peers read one signed release record. Stored formats stay readable forever,
    tested against frozen vectors, because production is never wiped ([7](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/PEERS.md#7-upgrades)).
12. **Maia City's vault is the admin; its owners approve what changes who is in or who sees whom** (rule 15, A28;
    Samuel, 31 Oct 2026: "a tree admin should always be a VAULT, never an individual signer"). Tickets, withdrawals, and
    the relay list count only with the approval of Maia City's owners, k of n through the vaults that own it
    (`byAdmin`, `Tree.approves`, `admin_by_owners`). Owner keys are passkeys and MaiaCityGuardian, never a device's key
    (`device_not_admin`), so "the more secure way" (31 Oct) holds: today one tap of Samuel's passkey, since his vault
    owns Maia City. A second admin, an owner change or recovery is ordinary governance of the vault, with no new
    genesis. Reason: a stolen or compromised browser can't let anyone in, or route members through a relay that logs
    their addresses.

### From MILESTONE2.md

- **Only the admin invites** (Samuel, 30 Oct 2026): the admin coop, Maia City by default
  ([`PRODUCTION.md`](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/PRODUCTION.md#part-c-maia-city-the-admin-coop)). An invite is an owner's act on Aven, so it is
  signed as the claim is: by the passkey of a person whose vault owns the admin coop, a WebAuthn assertion over the
  invite's statement. No member invites anyone. Lean and the code define the admin as the owner of the network's
  vault, whatever its kind, so the rule holds before and after the coop lands.
- **An invite is used at most once.** It names a one-time key; its link carries that key's secret. Joining is a
  statement signed by the one-time key and by the joiner's new passkey. The Aven Peer stores it under the ref
  `joined-<invite>`, set from nothing by compare-and-set, as the claim is. An invite can be withdrawn by the admin
  until it is used.
- **Members are vaults, the door checks devices.** A member is a person's vault admitted by an invite, and belongs
  to the admin coop (Samuel, 30 Oct 2026; #1457). The door lets in
  the devices of member vaults, the Aven Peer and the devices of the people who own the admin: nothing else.
- **The door is checked twice** (README, "Invite-only, end to end"): the relay admits only members' device keys, and
  every peer's `after_handshake` refuses any other. Each peer learns who is a member from the network's tree, which the
  Aven Peer tells its members, signed statements and all, so each peer checks them itself.
- **Members-only gossip:** one iroh-gossip topic per network, derived from the network's id. Peers join it only
  through members, and drop any message whose sender is not a member's device. Each message is signed by its device.
- **The chat is in memory:** messages live in each peer's memory and nowhere else. No store, no Loro, no history.
  The store upgrade that follows gives it its history and files ([`store`](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/store/README.md)).
- **The Aven Peer is in the room:** it joins the topic, keeps it alive for the Peer-Lights, and says once who joined.
- **No new protocol of our own:** invites, joins and the tree travel on `aven/db/1`; the chat is iroh-gossip beside it
  on the same `Router` (README rule 9).

### From SANDBOX.md

Made in milestone 1's threads and its integration (29–30 Oct 2026).

**avenID**
- **No cycles is defined by a rank:** every owner has a strictly lower height than what it owns. That keeps `WF`
  decidable, so the running model checks a tree itself, and gives the bound that proves `governs` and `chain` complete.
- **The device rules are part of `WF`** (Samuel, 29 Oct): a device's vault has exactly one owner, the vault it serves;
  it owns nothing; it has its own key, the key with its id, which owns nothing either. So `actsFor` is a function.
- **Person and agent vaults may have any known owners,** keys or vaults: room for k of n in milestone 3.
- **`governs` is depth first,** in the tree's order: the Vault app's tree reads the same way.
- **`sees` keeps its name** (the architect, 30 Oct): the devices a vault governs, for its Control Room. avenOS's
  `peersOf` goes. Once caps come, reading data will be wider than governing; the name is to be looked at again then.
- **avenOS reads the tree through aven-id's wasm** (Samuel, 29 Oct): a Vite alias `aven-id` points at
  `target/wasm/aven-id/`, which `bun run up` and `bun run build` build with `id/core/wasm/build.sh`. Nothing is copied
  into `os/web`. `os/web/id.js` keeps only how the page names things.

**The store**
- **Ref names are flat,** so every backend lays them out the same.
- **The suite is a public module,** so later backends and the peers can run it.
- **The OPFS suite runs in Playwright's Chromium, WebKit and Firefox,** served by a small node server: the box has
  no chromedriver for `wasm-bindgen-test-runner`. It runs in a dedicated worker, where the Peer-Light's leader runs.
- **OpenDAL's OPFS service was forked** so it ran in a worker; our own opfs driver replaced it (30 Oct 2026), and the
  fork and its `[patch.crates-io]` are gone.
- **versitygw is the box's S3:** its conditional writes are atomic. s3s-fs passed the suite only because our lock
  serialises compare-and-set; it checks `If-Match` before writing, not with it, and ignores it on DELETE.

**The Peers**
- **One core, two builds:** `aven-peer` is a library and a binary; the Peer-Light depends on it without `native`.
- **Configuration only:** keys, members, relay, addresses and the store come by flag or environment.
- **The builder is a `docker run` from `up.mjs`,** not a compose service: a cloud session's proxy needs host networking
  and its CA, which compose can't add only when they exist.
- **Presence counts the Aven Peer itself,** which gives "4 peers" and "4 connected".
- **The Peer-Light runs in a SharedWorker per origin,** since two Peer-Lights with one key would take the relay from
  each other.
- **The members-only door stays milestone 2's:** the relay admits everyone; the hub refuses keys outside its members.
- **Traces are JSON lines** through `Lean.Data.Json`, all in one process call; the Rust side uses a seeded xorshift, so
  a failure names its seed.

**Rule 10** (30 Oct 2026)
- **Examples are data beside their definitions:** a list of inputs and hand-written answers, one theorem (`decide`)
  or `#guard` over it, and the same list exported. Exported answers are the model's, which the theorem holds equal to
  the hand-written ones.
- **Why a tree is not well formed is the model's:** `Tree.check` names the first rule broken in aven-id's order, and
  `check_iff` proves it names nothing exactly for well-formed trees. A cycle names no vault; which one aven-id finds
  is its own.
- **The store's model is parametric in its hash;** its theorems hold for any. Its examples and traces run it with
  BLAKE3, written in core Lean like SHA-256, SHA-512 and Ed25519's public key: so blob names and the cast's keys come
  from the model too, checked against each specification's known answers.
- **Statements take the signature as sound:** it verifies for exactly what its key signed. Ed25519 itself is
  mechanics.
- **A timeline field never takes the place of `t`, `peer` or `event`** (the model's rule; the Rust used to let it).
- **The vectors are JSON, one vector per line,** keys sorted as Lean writes them, compared as values.
  `sandbox/vectors.sh` writes them; with `--check`, which `up --check` runs, it writes them elsewhere and fails on a
  difference. It builds and checks the specs outside aven/DB2 too, `aven/runtimes/spec` and `aven/actor/spec`, which
  `bun run box` mounts beside aven/DB2 at `/aven/DB2`, so their path to `Aven.Core` resolves: aven/runtimes whole at
  `/aven/runtimes`, since its Cargo workspace builds there too (`cd /aven/runtimes && cargo test`, its build folder a
  volume), and `aven/actor/spec` at `/aven/actor/spec`. Nothing else of the repository enters the box.

**The integration**
- **The peers keep their record through the store** as configuration: `--store s3` for the Aven Peer, `--store fs`
  for Alice Peer, OPFS for the Peer-Lights.
- **The check's Chromium keeps its profile in a volume,** so a Peer-Light's OPFS outlives a check, and a wipe empties
  it with everything else.
- **`Cargo.lock` was settled by cargo,** never by hand: each merge took the lock as it was and let `cargo metadata`
  add the other branch's packages. Every version the branches resolved is kept.
- **Tests compare JSON as values, never as text.** aven-id turns on serde_json's `preserve_order`, and Cargo unifies
  features across the workspace, so after the merge every crate's maps keep insertion order. One test of
  `aven-db-core` had compared a line's text with sorted keys.
- **rustfmt's default width (100)** stays for Rust; the prose wraps at 120. No `rustfmt.toml`.

#### SANDBOX.md's decisions outside its list

- **Only the checkout's own box runs** (Samuel, 30 Oct 2026): no fallback to another box, not even one with the same
  tools. A change that moves the tag, a new dependency included, is pushed to its branch first; until GitHub has
  published that box, `bun run up` stops and says so.

**v1's three workflows are parked** in [`.github/workflows-v1/`](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/.github/workflows-v1/README.md) (Samuel, 29
Oct 2026): moved, not deleted, so `main` runs no CI and deploys nothing. v1's site, API and peer keep running as they
were last deployed; nothing redeploys them, checks that they are up, or rolls them back. Its README says how to
switch one back on.

Every dependency and tool is pinned exactly, so every build can be reproduced. **Pins move only by hand** (Samuel, 30
Oct 2026): a person runs `bun run bump` when they choose. No scheduled workflow and no bot updates anything.

#### SANDBOX.md's open questions, those settled

1. **Precompiled crates in the image** (settled 30 Oct 2026). The image compiles the third-party crates cargo-chef
   style, Docker copies them into a session's empty build folder on first mount, and the tag hashes every file the
   build reads ([The third-party crates, precompiled](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/SANDBOX.md#the-third-party-crates-precompiled)). A new session's first
   build fell from 137–183 s to 28 s, all four peers live 35–54 s after `up --check` starts. The image grew by
   0.79 GB compressed (amd64: 2.44 to 3.23 GB; arm64 0.75 GB), 3.1 GB on disk, and a new session copies another
   2.9 GB into its volumes. Left open: the store's own checks (`cargo test -p aven-db-store`, the OPFS wasm in
   release) resolve features of their own and still compile some crates on their first run; GitHub rebuilds the
   crates' layer whole on any dependency change.
2. **`opt-level` for dependencies** (settled 30 Oct 2026): `[profile.dev.package."*"]` with `opt-level = 1` and
   `debug = "line-tables-only"`, our crates unchanged. Measured in the box, warm:

   | | opt-level 0, full debug | opt-level 1 | opt-level 1, line tables |
   |---|---|---|---|
   | the Peer-Light's wasm, before and after wasm-bindgen | 148 MB, 21.5 MB | 170 MB, 8.1 MB | 71 MB, 8.1 MB |
   | wasm-bindgen | 2.5–2.9 s | 1.1–1.3 s | 1.1 s |
   | a change in `aven-peer`, both builds | 4.5 s | 3.5 s | 2.7 s |
   | `cargo test --workspace` (without the store), warm | 15.6 s | 3.0 s | 3.2 s |
   | the crates, compiled in the image (4 vCPU) | 3 min, 4.1 GB | 7.6 min, 4.8 GB | 5.8 min, 2.6 GB |

7. **Our own OPFS backend, or OpenDAL's with sync access handles.** OpenDAL's is slow for small writes and ranges and
   refuses reads that race a commit. Sync access handles in the Peer-Light's worker fix both; they exist only in
   workers, which the fork now reaches. Also: offer the fork's fix upstream, so the fork can go.
   **Decided (Samuel, 30 Oct 2026): our own,** `opfs-sync` in `store`, after the agent rename. Measured that day,
   200 × 4 KiB writes: Chromium 14 ms (OpenDAL 2,066), WebKit 4–10 ms (712–869), Firefox 24–45 ms (4,070). Sync access
   handles exist in a dedicated worker in all three engines, but in a SharedWorker only in WebKit, so the Peer-Light
   moves to a dedicated worker run by the one tab that holds a Web Lock; other tabs reach it through a BroadcastChannel,
   and the next tab takes over when it closes. The contract, the Lean model and the conformance suite stay; the
   opendal-opfs fork goes; iOS 15.2–25 may work too (to confirm on a real iOS 18).
8. **Rule 10's vectors:** done (30 Oct 2026), [Tests in milestone 1](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/SANDBOX.md#tests-in-milestone-1).

#### The store README's "What a file may run" (the security audit) and "Next: pack files" (the architect)

## What a file may run

A file's type is what its sender claims, and avenOS's origin holds the device's secret in OPFS, so the Service Worker
([`files-sw.js`](https://github.com/MyAvenCEO/maiacity/blob/f7e1775bc687f8ac00ba23f475475b0a616c23ce/aven/DB2/os/web/public/files-sw.js)) serves `/files/<hash>` as if the bytes were hostile (the security
audit, 30 Oct 2026):

- **Every answer** carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src
  'none'` (with `img-src`, `media-src` and `object-src` only from the origin itself): a document opened from it has an
  opaque origin of its own and runs no script, whatever its bytes.
- **Inline only for passive types:** images but SVG (PNG, JPEG, GIF, WebP, AVIF, BMP), audio, video and PDF. Every
  other type, SVG, HTML and XHTML among them, is served as `application/octet-stream` with `Content-Disposition:
  attachment`: opening it downloads it.
- **The chat shows files only as `<img>`, `<video>` or a PDF's frame,** for those same types; anything else is a
  download link.
- `bun run up --check` holds it in all three engines (`sandbox/inline.mjs`: an HTML page and an SVG, each with a
  script, opened in a tab, framed, embedded and as an image, run nothing on the origin; a control served as HTML by
  the test's own server does), and in the city-dome's chat (`sandbox/dome.mjs`).
- **A PDF previews only where the engine renders one in a sandboxed document;** opening it still works, as a download
  at worst. That is the price of the sandbox, until files move.
- **Files should later move to an origin of their own** (the security fix's recommendation, 30 Oct 2026). The headers
  are defence in depth: one mistake in the allow-list, or an engine's bug in sandboxing, would still run a sender's
  bytes beside the device's secret. A separate origin that holds no secret (as open question 3 asks, the Service
  Worker on the Peer-Light's origin or a files-only one) makes that mistake harmless; until then these headers hold.


## Next: pack files

The next store step, on this upgrade's evidence (the architect, 30 Oct 2026): Firefox pays about 23 ms for every
`createSyncAccessHandle()`, twice per chat line, and the same engines write 200 × 4 KiB into one open file in 10 to
102 ms. Packs keep a few files open and append to them, so a write costs a write, not a file. Not built in this
upgrade; the contract, the suite and the gates stay, and the opfs driver changes underneath.

- **Blobs in packs.** A blob is appended to the open pack as one record: a header (its hash, its length, a checksum of
  the header) and its bytes. A pack closes at a size (64 MiB, to measure) and a new one opens. Big chunks may stay one
  file each: a 1 MiB chunk already costs one handle per MiB, which is cheap; the line is measured, not guessed.
- **Refs in a log.** Every `set_ref` and `delete_ref` appends a record (name, old, new or none, checksum) to the refs
  log; the newest record of a name is its value. Compare-and-set still runs under the one writer's lock.
- **The index is rebuilt on open,** by reading every pack's headers and the refs log, and kept in memory: hash →
  (pack, offset, length), name → hash. Reads are ranges of an open pack's handle.
- **A torn tail is cut by checksum:** a crash leaves at most the last record of a pack or of the log partly written;
  opening finds the first record whose header or checksum fails and truncates there. A blob's bytes are also checked
  against its hash on read, as now.
- **Deletes are tombstones** (a record naming the hash); `list` and `has` skip them. **Compaction comes later:** a pack
  mostly tombstoned is rewritten to a new one, then the old one removed, the index switched under the lock.
- **Lean first:** a model of the log (records appended, a torn tail) beside `Aven.DB.Store`, with the theorem that
  replaying any prefix of the bytes written, cut at its first bad record, gives the store before or after the last
  call, the same shape as `crash_atomic`; then Rust's crash tests (every byte offset a crash point), then the driver.
- **Gates:** the same workload, every engine held to 60 ms, 30 ms and 10 s, Firefox included.

### From the actors' ARCHITECTURE.md

Decided (Samuel, 30 Oct 2026):

- Its own package, `aven/actor`, in Rust only, compiled to WebAssembly, with its own Cargo workspace: the actor is
  universal and depends on no storage backend, avenDB included (section 13).
- Actors are mostly JSON, with JavaScript where code is needed, run by on-demand runtimes such as QuickJS.
- The runtimes are rewritten from scratch and named `<job>-runtime` after what their part does (every part is JSON, so `json-runtime` named nothing; the declarative turn runs on `state-runtime`, code on `js-runtime`, and a face, its markup and its style, on
  one `face-runtime`, which never takes CSS and only gives it; "view" keeps the engine's sense). They run untrusted parts securely and never
  reach the host.
- Version 1 is a standalone, in-memory todo app: no network, no avenDB, no capabilities.
- Frames in Core's canonical CBOR when the network comes, the one codec (Samuel, 31 Oct 2026, replacing "JSON lines";
  ARCHITECTURE A29); ids derived from definition, spawner and count; only definitions from the repository are spawned.
- Everything about an actor lives in its own Doc, shaped for Loro, and everything is kept.

Decided here, on those grounds:

- Order is per pair of actors, and the receiver's journal fixes the order of handling (section 4).
- Inboxes are documents of their own, one per sender and receiver, each written only by the sender, so every document
  keeps one writer and one key; the actor's journal keeps each handled message whole (section 3). Taken from the
  avenDB engine thread's review of this design.
- Asks default to 30 s, at most 10 minutes. Machines are in version 1. One person actor per device. The first app is
  the todo app (section 9).
- Runtimes run inside the kernel in a pure-Rust WebAssembly interpreter with fuel. If one proves too slow there, it
  moves to the host's own WebAssembly engine, with fuel counters added when it is frozen.
- The in-memory Doc is plain Rust behind the Doc interface, simple to model in Lean. Loro comes with
  avenDB's documents.
- Faces render into shadow roots through the applier. Opaque frames are for runtimes that run scripts in the page,
  which version 1 has none of.

- A component is a definition, its class; every placed component is a face actor, with a mounted lifetime
  (Samuel, 30 Oct 2026). Faces follow the rules of aven-brands' component library and avenVIBES (section 5).

- The caps seam (section 11), agreed with avenID's caps thread: actors hold no keys and the kernel holds them; a
  `cap` beside `run` that only narrows per hop, never mixed with an actor's standing cap; tell caps on message names;
  the inbox Doc A→B in A's vault; a definition names the one it `replaces` (Samuel, 30 Oct 2026; caps D16).

- Every address carries an incarnation; `seq` counts per pair of actors; only an ask gets a `fail`, and every refusal
  and error is journaled; a journal entry pins the definition, the runtime that ran and the fuel schedule (sections 4,
  6 and 7). From the first-principles audit (`aven/DB2/ARCHITECTURE.md`).

- Hosting an actor on the Aven Peer is an explicit read cap per actor, shown to its owner; a member's own Peer is the
  default home (avenDB A16). Modelled in `Aven.Actor.Hosting`, a hosting cap being one of avenID's caps
  (issuer the owner, holder the host, `read` on the actor or its loads): a host reads exactly what its hosting caps,
  shown to the actor's owner, reach (`hosting_explicit`), nothing without one (`no_hosting_without_cap`), and one
  load's cap reads only that load (`per_target`). Every runtime lives in `aven/runtimes` (section 13). (Samuel, 30 Oct 2026.)

- avenDB's A17, parts 1, 2 and 4 (Samuel, 30 Oct 2026): an address names a vault-scoped id and an incarnation, never
  a device, and the home is only where to route; a message is stored once and referenced by its hash; an actor's
  history is its Doc's own Loro history, each turn one commit of Loro operations, with Loro's snapshots as its
  checkpoints, and loads journaled as (Doc, version, query hash). Version 1 keeps the same shape in memory: an
  operation log and snapshots behind the Doc interface.
- avenDB's A17, part 3 (Samuel, 30 Oct 2026): every actor keeps its own inbox, its own queue, read position and order
  of handling. Between devices, messages are carried in one Doc per pair of vaults, written only by the sending
  vault's home device, holding the messages of all its actors, each addressed to one actor; within one home, none.
  The order from one actor to another stays the order sent (section 4). In version 1, in memory, the carrier is not
  modelled: each pair of actors is one inbox log.
- avenDB's A17, part 5 (Samuel, 30 Oct 2026): a definition is a version of an actor type; `replaces` names the
  version before it, and a lens carries the actor's state from the old version's shape into the new one's (K5).
- Machines are data, merged with the interface; no Prolog runtime; their checker proven in Lean, and deeper
  properties of a definition proven in Lean in the repository (section 6).
- Every actor answers a built-in `describe` ask with its tool specs; definitions declare `sends`, enforced by the
  kernel; edges between actors are derived by type id, never by name or prose (section 6; Samuel, 30 Oct 2026).
- Lenses, universally: one concept joining versions of one type and of different type Docs, kept a forest so paths
  stay unique; actors' messages cross types through them, and they replace Abject's negotiator and self-healing
  adapters (section 6; Samuel, 30 Oct 2026).
- Values are integers only in version 1, in avenDB's one codec (section 2): deterministic CBOR (Samuel, 30 Oct 2026).

- How a host signs its actors' writes (Samuel, 31 Oct 2026): one device per host, whose device cap is the union of
  the hosted actors' standing caps and only the outer bound. A host device writes only by chain, never as its
  vault's own; every envelope names the acting actor and carries the chain its handled message carried, as it
  came. The Aven Peer signs as Aven's device under a chain the owner issued and approved, not as a device of the
  owner's vault. For a write, an actor's narrowing is never a link (it is no grant): it is the write's footprint,
  checked against the chain. The actor half is `Aven.Actor.Signing` (`signs_by_chain`, `write_names_actor`,
  `write_keeps_chain`, `actor_within_chain`, `actor_calls_within`); the reader's half (`Aven.ID.host_chain_only`,
  `actor_within_device`, `host_never_beyond`) is avenID's. A cap that travels on in a message narrows instead by
  caps' attenuation link (no approval, within its parent, the same holder, only after an approved grant): the
  chain a message carries is its handled message's chain plus at most one attenuation (avenDB ARCHITECTURE.md).

Open, none of it blocking version 1 (the audit's findings, mostly avenDB's proposal A17, awaiting Samuel):

- **The kernel's authority:** click caps scoped to what the placer wired; who may spawn, and a bound on placement depth; a budget per run, and backpressure.
- **Performance gates** for wasm inside wasm, fuel across engines, and a shadow root per face.

## 31 Oct 2026

The decisions of 31 Oct 2026 that the imported lists don't already hold, in the order they were made. Times are UTC,
from the day's ledger of messages; a later time in brackets is when the same decision was made more precise, not
changed. A refinement names what it refines; a change of mind names what it supersedes.

### A46 · Computing an envelope's past is Core's
- **Decided by:** the architect, with avenID caps and the avenDB docs spec thread (00:07)
- **Decision:** `Aven.ID.Past` moves into Core as `Aven.Core.Past`, beside `Reaches`. Caps imports it from Core and
  keeps its theorems on it, the equality with `Reaches` lives in Core, and revocation and expiry keep using it. `past`,
  `inPast` and `inPast_iff` decide `Reaches` from Core alone.
- **Why:** the docs layer needs the same decider for its logs and counts traces, and `db/spec` should require only Core
  for it, not a second copy.
- **Supersedes:** —
- **Lean or code then:** #1612 (merged 00:12, `1bfd7ce`): only the namespace changed, every theorem the same.

### A47 · A writer id's exact layout
- **Decided by:** the architect with the avenDB docs spec thread (00:07)
- **Decision:** a writer id is BLAKE3 `derive_key` under `avenDB writer 1` over the device key, the Doc id, the branch
  and the generation, as a CBOR array, skipping Loro's reserved value: the first 8 bytes of the output little-endian,
  and the next 8 when the first are `u64::MAX`. The docs README's "Writer ids" section states that exact layout. Lean's
  `Blake3.deriveKey` is held to the `blake3` crate's official `derive_key` test vectors, not only to the crate's output
  on our inputs (checked against the reference implementation at 00:17 and 00:22: the empty input and 1, 1024, 1025 and
  3073 bytes).
- **Why:** the new `writers.json` vectors need one exact form; Core's change stays additive.
- **Supersedes:** — (refines docs 6)
- **Lean or code then:** `writers.json`, `Blake3.deriveKey` (#1613, merged 00:17; #1614, merged 00:22).

### A48 · A writer id is never Loro's reserved value
- **Decided by:** the architect with the avenDB docs spec thread (00:17, landed 00:24)
- **Decision:** the writer id is the first of the four 8-byte windows of the 32-byte output that isn't the reserved
  value (2⁶⁴−1), and 0 when all four are (a 2⁻²⁵⁶ chance). `writer_ne_reserved` proves a writer id is never
  `reservedPeer`.
- **Why:** with two windows, the docstring's "no writer id is it" was only vanishingly unlikely (both windows 2⁶⁴−1, a
  2⁻¹²⁸ chance), not true.
- **Supersedes:** A47 (in part: "the next 8 when the first are `u64::MAX`")
- **Lean or code then:** `writer_ne_reserved` (#1615, merged 00:24, `abaf9bc`).

### A49 · avenBRAIN holds the documentation: a visual wiki, one concept per slide
- **Decided by:** Samuel (05:57): "create a visual "Documentation / Präsentation Wiki" that explain the whole
  arhciehcietere."; "always only explain one concept per slide"; "explain the concepts simple from the i first
  princieopes up."; "a lside ist basically just html / css (reuing already  our future face-runtime, and
  markdown-runtime to render in our UI)"; "called avenBRAIN, that holds all the docmeunationt and viaualzation graphs
  acacornigly"; "the docs dashbaord is a grid of "differn doc items" each package has its own grid item"
- **Decision:** a new package, avenBRAIN (`aven/DB2/brain`), holds avenDB's documentation, its visualisations and the
  global glossary (`GLOSSARY.md`) of every term so far. It is a wiki of pages and slides that builds the story up from
  first principles, one concept after another and one concept per slide, so a slide can later become motion graphics. A
  slide is HTML and CSS, to be rendered through face-runtime and markdown-runtime. avenOS gets a main nav item for it
  (the tab is "Brain" since A41), whose dashboard is a grid with one item per package, starting with avenID. Its style
  and language are developed in a thread of its own.
- **Why:** Samuel: "Like osmeone reading it that has zero background knoelge about the system."
- **Supersedes:** —
- **Lean or code then:** #1630 (the first version, merged 06:40), released in #1641.

### A50 · The docs are in English
- **Decided by:** Samuel (06:14): "docs english"
- **Decision:** avenBRAIN's documentation is written in English, recorded in its `VOICE.md`.
- **Why:** the sources don't say.
- **Supersedes:** —
- **Lean or code then:** `brain/VOICE.md`.

### A51 · Core's Rust crate lives beside its Lean; the runtimes keep their own workspace
- **Decided by:** the architect with the runtimes thread (06:18)
- **Decision:** Core's codec is written once, in its final home: the crate `aven-core` at `aven/DB2/core`, beside its
  Lean spec and a member of the `aven/DB2` workspace. It starts with Values to and from Core's canonical CBOR profile,
  held to `core/spec/vectors/cbor.json`, and names (BLAKE3, `names.json`); the Peers and the other Rust threads extend
  it later (envelopes, logs). `aven/runtimes` is a workspace of its own, which the root excludes; it depends on
  `aven-core` by path (`../DB2/core`), the box mounts the whole folder with its own target volume, and `face/` sits at
  its top level. No codec goes into `aven/runtimes/value/`, and the crate stays free of everything in `aven/db`.
- **Why:** no Rust Core crate existed, and a second home would mean a later move and a risk of two codecs.
- **Supersedes:** —
- **Lean or code then:** #1631 (the node tree, merged 06:27); `aven-core` in #1634 (merged 07:24).

### A52 · Core's CBOR nests at most 512 deep
- **Decided by:** the architect with the runtimes thread (06:29)
- **Decision:** `Aven.Core.Cbor` limits nesting to 512 for allowed Values (`Canon`) and for `decodeAll`'s fuel. The
  round-trip and canonical laws are restated for allowed Values, which then can't be deeper, and the vectors read depth
  512 back and refuse 513, both ways. The Rust decoder matches Lean: 511 arrays around a scalar read, 512 don't, and
  capacity is bounded by the bytes left.
- **Why:** rule 10, every input has a limit, and Lean says so first.
- **Supersedes:** —
- **Lean or code then:** #1651 (merged 07:21: `maxDepth`, `Shape`, `encode_inj_shape`); the Rust in #1634.

### A53 · Node trees hold at most 20,000 nodes; markdown-runtime's first rules
- **Decided by:** the architect with the runtimes thread (06:38)
- **Decision:** the node tree's `treeLimits` allow 20,000 nodes, "fine for now"; a real document that needs more raises
  it Lean-first. markdown-runtime pins pulldown-cmark, keeps raw HTML as text, takes images only by `/files/<hash>`, and
  is held to a hostile corpus.
- **Why:** rule 10; the sources give no reason for the number itself.
- **Supersedes:** —
- **Lean or code then:** `Tree.lean` (`treeLimits`); markdown-runtime in #1639 (1.5 ms for 200 KiB).

### A54 · face-runtime's contrast check
- **Decided by:** the architect, accepting the runtimes thread's proposal (06:49, 06:50)
- **Decision:** text is checked against every colour its ancestors paint, with every stop of a gradient and alpha
  composited, and against sibling layers that cover their whole parent (`inset: 0`). A layer placed over only part of
  the parent, under a text, isn't seen, and the spec says so in one sentence. Slides keep text off partly placed shapes,
  or make the shape a full-bleed layer, so what the runtime checks is what a reader sees.
- **Why:** what's at stake is legibility, not safety.
- **Supersedes:** —
- **Lean or code then:** `Face.lean`, `contrast.json`; face-runtime in #1643 (merged 07:52).

### A55 · Production's migration is checked on its real store, with no dual mode
- **Decided by:** the architect with avenPEER (06:52; the plan approved 06:53)
- **Decision:** the migration of production's tree checks the one real store: `isClean` and `oldSideAgrees`, run with
  the functions Lean exports and held to aven-id's vectors. Its guarantee is `settle_restore_door` plus `isClean` plus
  `oldSideAgrees`. If either check fails, the migration refuses, the deploy fails loudly and says why, and production
  stays on the release before it. No code path keeps the old door running beside the settled one: no dual mode. The same
  check runs read-only on production as a pre-flight, in a release before the one that switches (release N the
  pre-flight, N+1 the switch). Production's data never leaves the server; only the verdict and counts are logged. A
  general proof of the translation for any store becomes a nice-to-have.
- **Why:** checking the one real migration is the first-principles answer; proving the general translator would cover
  stores that will never exist.
- **Supersedes:** —
- **Lean or code then:** `settle_restore_door` (#1644, merged 06:57), `isClean`, `oldSideAgrees`; PEERS.md's migration
  section.

### A56 · Only a write line allows a step
- **Decided by:** the architect, from his own audit of the caps Lean (07:06)
- **Decision:** `Grant.allows` requires the line's verb to be a write verb and the step's verb to fit it. A footprint
  appears only on a write line (a rule in `capRules`, or a well-formed line), with a vector where a read line with a
  footprint fails, and a theorem: a cap whose lines are all non-write allows no step. A32's ops model keeps its meaning
  as `no_step_without_write`: no op steps without a write op (07:35).
- **Why:** a line `{verb: read, footprint: [put-new …]}` allowed writes. Footprints narrow, so it was no escalation
  beyond the issuer, but an owner would approve a cap that says "read" and its holder could write, against A2's
  what-you-see-is-what-you-sign.
- **Supersedes:** —
- **Lean or code then:** `Grant.allows` in `Caps.lean`; #1653 (merged 07:21).

### A57 · The wire version lives in the hello and in the room's name
- **Decided by:** the architect with thread E (07:07)
- **Decision:** the wire version is in the hello. `meet` answers `update` with no fallback, and `follows` sends only the
  older side forward: a tab behind keeps its draft in OPFS, shows only "Updating…" and reloads, and a native Peer behind
  shows `update` in the Control Room. The room's topic name carries the version (`topicName`), so two versions never
  share a room. The ALPN `aven/db/1` stays frozen as a name, and the hello's number is the only wire version, as PEERS
  §7 says.
- **Why:** an upgrade is a clean refusal, never a fallback (peers 11).
- **Supersedes:** —
- **Lean or code then:** `meet`, `follows`, `topicName`, `upgrades.json` in #1649 (merged 09:24; its release was "the
  last manual reload").

### A58 · Slides render through face-runtime
- **Decided by:** Samuel, as the architect relays it (07:07: "Samuel wants slides rendered by the face-runtime"), after
  his "a lside ist basically just html / css (reuing already  our future face-runtime, and markdown-runtime to render in
  our UI)" (05:57); the architect for how
- **Decision:** slides are drawn by face-runtime, which never takes CSS text. A slide's CSS is compiled at build time
  into face-runtime's typed rules (Style), which the runtimes thread grows for the brain's needs, and new slide CSS is
  written only in the subset agreed with that thread: no `url()`, no custom properties. Link rewriting (`glossary:`
  terms, package pages, repository files) is a pass over a tree's `a` nodes, so it works on any tree, markdown-runtime's
  included. Until the runtimes' tree drawer replaces it, avenBRAIN's JS allowlist mirror replays
  `aven/runtimes/spec/vectors/tree.json` (and `face.json` and `contrast.json` where they apply) and has `Tree.lean`'s
  limits.
- **Why:** face-runtime never takes CSS text; and the JS mirror wrote its own expected values and had no depth, node or
  text limits (README rule 10).
- **Supersedes:** —
- **Lean or code then:** Style in `Face.lean` (#1673); `brain/render/tree.js`, `tree.test.js`.

### A59 · A delete on the vault's own authority ends a Doc for every reader
- **Decided by:** the architect with avenID caps and the avenDB docs spec thread (07:09)
- **Decision:** a delete counts on the vault's own authority and ends the Doc for every reader (`delete_ends`); what
  wasn't deleted survives (`undeleted_survive`); readers agree (`deleted_agree`). `liveWith` is wired into
  `Aven.Architecture.Rules` in the same PR, so rule 4's verdict covers deletes.
- **Why:** "one PR that closes the loop is simpler than two".
- **Supersedes:** —
- **Lean or code then:** #1652 (merged 07:21), #1655 (merged 07:25).

### A60 · A sign-in is a device cap
- **Decided by:** the architect, applying rule 15 and A28 to the tree for avenPEER (07:21)
- **Decision:** a sign-in is caps' device cap from the vault to the device's vault, so removing a device is that cap's
  revocation. The tree's `TreeSays.signIn` stops modelling it separately.
- **Why:** rule 15: a signer only signs for a vault, as one of its owners or as its device within a device cap.
- **Supersedes:** —
- **Lean or code then:** `Network.lean` (`TreeSays.signIn`).

### A61 · One list of file types
- **Decided by:** the architect, from the first-principles audit (`audits/principles.md`), for the runtimes thread
  (07:35)
- **Decision:** the runtimes' file registry is the one list of file types. It replaces `files-sw.js`'s `passive` and the
  chat's `kind()`, and takes in `peer/native/src/keep.rs`'s extension-based `mime`, so the native Peer records the
  sniffed type.
- **Why:** the sources don't say; runtimes 9 calls a second list "the two-lists problem".
- **Supersedes:** —
- **Lean or code then:** the registry's Lean in `aven/runtimes/spec`.

### A62 · A collection is one target for every op
- **Decided by:** the architect (07:36), answering Samuel (07:35): "but shold nthe flexiibltiy also be psosible a cap
  liek that -> ts. “Photos tagged beach from 2026” is a query, a"
- **Decision:** beyond what A32 holds about collections: the vault's devices keep a collection's list with any op
  (hand-picked, a query, a rule over facts, an actor, or an approved suggestion), each change a signed envelope of that
  vault. A Doc that leaves the list gets no new key for the holder. "What it lists" is bounded in depth (rule 10):
  collections listing collections go at most N levels, N for caps to propose. The same target works for every op: read,
  keep, write (add to the collection) and tell. Directories (A26), shared folders and keep scopes become collections.
  Lean proves that coverage through a collection is decided by the listing envelopes in the collection Doc's past
  (`listed_by_issuer`), and that an edit to a listed Doc's content never changes coverage.
- **Why:** what a cap covers changes only by its issuer's signed act, never because content was edited.
- **Supersedes:** — (refines A32)
- **Lean or code then:** ARCHITECTURE.md A32 (#1660); the Lean in A32's PR, #1681.

### A63 · Confirming a claim is a standing cap held by Aven's vault
- **Decided by:** the architect, answering avenPEER's finality question (07:38; again 07:41, 07:53)
- **Decision:** the tap is the ticket: an invite's ticket keeps its passkey tap ("passkey taps for invites yes"), which
  is Maia City's owners approving that one person may join. A claim of a valid ticket is a consequence, not a new
  decision, so confirming it is an op Maia City delegates once: a standing cap from Maia City's vault to Aven's vault
  (the agent Maia City owns) for the confirm op on Maia City's tree, approved once by Maia City's owners (D14) and
  revocable. Aven's device, the Aven Peer, signs the confirmation within its device cap; a coop owner's device could
  hold the same cap if Maia City grants it. The confirm op is bounded by its declaration: only for a claim of a ticket
  Maia City issued, not withdrawn and not already used, so a confirmer can't let in anyone without a ticket. Today's
  `acker` (owners' devices ack) generalises to "a device of a vault holding the confirm cap", and "confirm" is modelled
  as an op held under a cap, so A38 only changes what it produces.
- **Why:** a claim of a valid ticket decides nothing new, so confirming it is automatic and vault to vault.
- **Supersedes:** A12 (in part: "a join is final once an admin device has acked it")
- **Lean or code then:** `Network.lean` (`acker`); the tree's A28 branch, #1674.

### A64 · Production's members get member caps at the switch
- **Decided by:** the architect with avenPEER, after Samuel's yes to A38 (07:43; 08:04)
- **Decision:** at the switch, each joined passkey's vault gets a member cap, issued by the migration under Maia City's
  approval at genesis signing. Member caps come only from final standing claims, and the migration confirms the stored
  joins (08:04). PEERS §5 says how.
- **Why:** A38: membership is a cap.
- **Supersedes:** —
- **Lean or code then:** `settle_restore_door`; #1674 (A28 and A38 in the tree, merged 08:28).

### A65 · A signed thing's name leaves its signer out
- **Decided by:** the architect, on caps' A30 in Core (07:44)
- **Decision:** `Signed.name` excludes the signer, so a statement's body must carry whatever makes the act its own, as
  an envelope's signed bytes already do.
- **Why:** A30: a name is the hash of `[label, body]`, its signatures beside it, so signing one act twice never makes
  two names.
- **Supersedes:** — (refines A30)
- **Lean or code then:** #1666.

### A66 · A cap line is `{op, doc, params}`; bounds are enumerations
- **Decided by:** the architect with avenID caps (07:46: "A32 design: go, as one PR")
- **Decision:** A32 lands as one PR across Core's `Target` and `Grant`, caps, and the engine's, actors' and
  Architecture's Lean: ops by hash with `core/1`'s fixed ids; `query` as a stored op; three target forms;
  `Line := {op, doc, params}` with bounds; footprints only from lowering; every theorem's meaning kept. The first target
  form is `doc d (spawned | lists | none)`. Bounds start as enumerated values, and the caps README says ranges come only
  if a real op needs them. Core's target forms change: `actor a b` becomes `doc a b`, `vaultDef v d` becomes
  `vaultType v d false`, and `allows` becomes `lists` over ops.
- **Why:** the change is atomic, and splitting it would leave main unbuildable in between; enumerated bounds are the
  simple start.
- **Supersedes:** — (refines A32)
- **Lean or code then:** #1681 (merged 09:11).

### A67 · avenID's built-in root types, and the type of types
- **Decided by:** the architect with avenID caps (07:46)
- **Decision:** the keyring, safe and group Docs' root types are avenID's built-ins `keyring`, `safe` and `group`. A
  type Doc's type is the type of types: a built-in `TypeId` in Core, the root type of every type Doc and of itself.
  `Holder.group` becomes a group Doc with `Facts`, so A39 holds in Lean, not only in prose.
- **Why:** A39: no Doc is ever without a type.
- **Supersedes:** — (refines A39)
- **Lean or code then:** #1681 (`typeOfTypes`, `builtinType`).

### A68 · The tree's statements are op calls of `tree/1`
- **Decided by:** the architect with avenPEER (08:06: "Option 1, the full rewrite")
- **Decision:** the tree is rewritten whole, with no bridge. A tree statement's body is an op call, `{op, params}`, not
  a bare `TreeSays`. The tree's ops (genesis, ticket, claim, confirm, withdraw, the three settings, and sign-in as a
  device cap) are ops of the tree type, `tree/1`, each with a fixed id, as `core/1`'s are. `TreeSays.toValue`/`ofValue`
  becomes the op and its params, and `settle` is the tree type's fold over op calls. The tree Doc's root type is `tree`
  (A39). The op ids' shape is agreed with caps' A32.
- **Why:** a bridge would be a patch (rule 16), and A32 says an envelope names the op it ran, with its params.
- **Supersedes:** —
- **Lean or code then:** none yet; `TreeDoc` came in #1686, `tree/1` in #1705 and #1718.

### A69 · Slide text is at least 2.6cqw
- **Decided by:** the architect with the runtimes thread and avenBRAIN (08:07)
- **Decision:** face-runtime's `styled_size` floor is avenBRAIN's: no slide text under 2.6cqw, stated as "≥ 9 px at a
  356 px slide", so the Lean and the box agree, with `style.json` regenerated. The box fails a slide whose text is under
  9 px at a 390 px viewport.
- **Why:** the two floors disagreed, and Firefox measured 2.5cqw at 8.9 px.
- **Supersedes:** —
- **Lean or code then:** `styled_size` in #1673 (merged 08:22); `sandbox/brain.mjs`.

### A70 · Core's past is generic over named things
- **Decided by:** the architect with avenPEER (08:08)
- **Decision:** `Core.Past` is generic over any α with `name : α → Hash` and its parents, and envelopes instantiate it
  as before, so no theorem changes meaning. The glossary's `Past.tips` → `parents` rename (A1) goes in the same PR. The
  tree's named envelopes, `{name, env}` with `ok` checking `name = nm env`, are stored by name.
- **Why:** Core's past over a list of envelopes recomputed names on every round, O(n³) `nm` calls per settle, too slow
  to evaluate with real BLAKE3 names in Lean; a peer holds envelopes by name, and Network's own `InPast`, `fresh` and
  `pastNames` go.
- **Supersedes:** — (refines A46)
- **Lean or code then:** #1675 (merged by 08:22).

### A71 · One file-type registry crate, shared by the Peer and the browser
- **Decided by:** the architect with the runtimes thread (08:17: "(a), one crate")
- **Decision:** the file registry is one Rust crate, `aven-runtimes-registry`. The box mounts `aven/runtimes` at a fixed
  path (`/runtimes`), and `peer/native` takes the crate by that path. The avenPEER image's Dockerfile copies
  `aven/runtimes/registry` (and what it needs) beside `aven/DB2`; GitHub builds the image, never a local machine. The
  Service Worker and the chat use it through the Peer-Light's wasm. QuickTime is added in Lean first.
- **Why:** (c) would mean two sniffers, the very duplication being removed, and (b) would split the registry from its
  Lean home.
- **Supersedes:** runtimes 4 (in part: "which the Service Worker and the chat load")
- **Lean or code then:** #1678 (merged 08:24); the wiring in #1689 (merged 09:17).

### A72 · avenID's key formats
- **Decided by:** the architect with the avenID keys thread (08:25)
- **Decision:** Lean comes first for every format (rule 14), in two steps, Lean then Rust:
  - Core's BLAKE3 gains keyed and `derive_key` modes, with XOF output (`aven/DB2/core/spec/Aven/Core/Blake3.lean`).
  - The hybrid signature's encoding, with its suite: Ed25519 plus ML-DSA-65 over the same bytes, both of which must
    verify (A2), a Value with exactly its keys beside `Signed` in Core.
  - A new module, `Aven.ID.KeyFormats`. Structured inputs are Core CBOR in the `[label, body]` form, never hand-packed
    bytes. The PRF input is `encode(["avenID prf 1", {vault, epoch}])`, and the WebAuthn salt is
    `SHA-256("WebAuthn PRF\0" ‖ that)`. A stanza's AAD is CBOR too: `{scope, id, epoch, recipient}`. The owner seeds are
    64 bytes of XOF from `derive_key("avenID owner 1", the PRF output)`: the Ed25519 seed, then ML-DSA-65's ξ. The seal
    seed is `derive_key("avenID seal 1", the PRF output)`. Commit, back and tag as the keys thread proposed, labels and
    all: commit is BLAKE3 keyed by the epoch key over `"avenID commit 1"`, back is the AEAD under
    `derive_key("avenID back 1", new key)`, and a tag is BLAKE3 keyed by the tag seed over `id ‖ n`.
  - Stanzas are key-committing: separate enc and commit keys are derived from X-Wing's shared secret by `derive_key`
    labels, and the stanza carries a commitment tag the reader checks before decrypting. Nonce 0 is fine with one key
    per stanza.
  - `derivations.json` and `stanzas.json` carry the BLAKE3, SHA, CBOR and layout parts computed in Lean, and X-Wing and
    AEAD outputs as KAT-shaped fixtures the Rust round-trips. The primitives (X-Wing, ML-DSA-65, Ed25519,
    XChaCha20-Poly1305) stay outside Lean, held to their standards' known answers and Wycheproof. Every crate is pinned
    at its newest stable release, with `zeroize` and `subtle`, and hybrid signing and verifying for owner and device
    keys implements aven-core's `Verify`.
- **Why:** one codec for everything signed (rule 1), and the caps README's key-committing AEAD.
- **Supersedes:** —
- **Lean or code then:** #1680 (merged 08:51): `Aven.ID.KeyFormats`, `Aven.Core.Hybrid`, `Blake3.lean`.

### A73 · Core's limits
- **Decided by:** the architect with aven-core (08:33; at most 16 signatures, 09:35)
- **Decision:** a new module, `Aven.Core.Limits`: 1 MiB per envelope, 256 deps, a 256-byte branch and label, a 4 KiB
  signer and a 16 KiB signature, each checked by the envelope's acceptance, with vectors at each edge (exactly at the
  limit, and one over); Rust's `limits.rs` reads the same numbers. A signed thing carries at most 16 signatures
  (`maxSigs`). A core model exe, as id has `aven-id-model`, answers the property tests from the running Lean rather than
  a transcription, with past and counts vectors and vectors for `Signed` and for envelopes with deps.
- **Why:** rule 10, every input has a limit; property tests compare against the running Lean.
- **Supersedes:** —
- **Lean or code then:** #1688 (merged 09:17).

### A74 · An epoch is named without its stanzas
- **Decided by:** the architect with the avenID keys thread (08:41: "Confirmed")
- **Decision:** an epoch is named by its blob without its stanzas, so resealing it to a new device never renames it.
- **Why:** A30's principle: a thing is named by what it says, not by who it's sealed to.
- **Supersedes:** —
- **Lean or code then:** `KeyFormats` (`name_ignores_stanzas`), #1680.

### A75 · Op ids, and one call form
- **Decided by:** the architect, passing avenID caps' A32 design to avenPEER (08:47; one body form confirmed 08:55)
- **Decision:** `OpId := Hash`, the name of an op's stored form. `core/1`'s ops each have a fixed id, the hash of
  `{plugin: "core/1", op: "<name>"}` in Core's CBOR. An envelope's body names `{op: OpId, params: {…}}`. The tree's ops
  are `{plugin: "tree/1", op: "ticket" | "claim" | "confirm" | …}` under the same fixed-id rule. Every plugin's calls
  have one body form, `{op, params}` (`Call.value`).
- **Why:** the tree had to build on the op ids' shape, and the two had to land compatible.
- **Supersedes:** —
- **Lean or code then:** `Aven.Core.Op` in #1681.

### A76 · Collections nest at most 8 deep; `CapForm`
- **Decided by:** the architect with avenID caps (08:49: "N = 8 and `CapForm` are both accepted")
- **Decision:** collections listing collections go at most 8 levels (N = 8). Caps' `CapKind` (grant | attenuate) is
  `CapForm`, since "kind" is only a vault's (A1); safe.json's `"kind"` is renamed in a later caps PR.
- **Why:** rule 10, and A1's verdict that "kind" is only a vault's.
- **Supersedes:** — (refines A62)
- **Lean or code then:** #1681.

### A77 · The PRF step's browser half
- **Decided by:** the architect with the avenID keys thread (08:51; 10:17)
- **Decision:** `create()` asks for `prf`, followed at once by a `get()` when the platform only says it's enabled, so
  avenOS learns at sign-up whether PRF answered, never by guessing. `get()` with the PRF input returns the assertion and
  the output. The output goes straight into the Peer-Light's wasm (aven-id), and only the derived public halves leave it
  (rule 13); the owner key is derived per ceremony and dropped (10:17). The box's sign-up and sign-in steps check it
  with a virtual authenticator that supports PRF.
- **Why:** rule 13: keys live only in the safe.
- **Supersedes:** —
- **Lean or code then:** `os/web`, `peer/light`; #1700 (merged 10:38).

### A78 · `user.id` names the vault
- **Decided by:** the architect with the avenID keys thread (08:53)
- **Decision:** `user.id` is set to the person's vault id. A new browser does a `get()` for discovery, reads the vault's
  owner epoch from the public register (A42), then a `get()` with `allowCredentials` and the PRF input: two taps, only
  on a brand-new browser. The vault and epoch stay in the PRF input, so the owner key rotates without a new passkey.
- **Why:** two taps, only on a brand-new browser, and "nothing leaks".
- **Supersedes:** —
- **Lean or code then:** none yet.

### A79 · How a missing PRF is detected
- **Decided by:** the architect (08:58), carrying out Samuel's answer to the keys thread's third question, "refuse and
  explain" (recorded in A43)
- **Decision:** a passkey without PRF is detected from the create response's `prf.enabled`, or from a missing PRF output
  on the first `get()`, never from the user agent. The rule goes into the caps README's "Passkeys and the PRF step" with
  Samuel's attribution, and a box check: a virtual authenticator without PRF gets the message, and nothing is written to
  the store.
- **Why:** avenOS learns at sign-up whether PRF answered, never by guessing (A77).
- **Supersedes:** — (refines A43)
- **Lean or code then:** #1700.

### A80 · The passkey record and the sign-in, exactly
- **Decided by:** the architect, settled with the avenID keys thread and given to avenPEER (09:04)
- **Decision:** `user.id` stays 16 random bytes, as today, and means nothing; there is no handle. Claim and join carry
  the passkey record `{credential, spki, owner, seal, epoch}`: `credential` is the WebAuthn credential id (rawId),
  `spki` the ES256 key, `owner` the hybrid public key `{ed25519, mlDsa}` per Core's `Hybrid`, `seal` the X-Wing public
  key, and `epoch` starts at 1 (formats in `Aven.ID.KeyFormats`). The register maps each credential id to its record,
  and through it to its vault. A sign-in's body is `{network, device: {id, key}}` and doesn't name the vault: the vault
  is the vault of the passkey that signed. Beside the name (A30) sit the passkey's assertion
  `{credential, clientData, authData, signature}`, whose `credential` is an unsigned hint that only fails if it's wrong,
  and the owner's hybrid signature. The check: the credential's record verifies the ES256, and its `owner` verifies the
  hybrid.
  - Sign-up: `create()` asks `prf: {eval: {first: <epoch 1 input>}}`. Where the platform returns results at create, it
    takes two taps; where it only says `enabled`, a `get()` for the PRF comes first, three taps, at sign-up only.
  - A new browser: one discoverable `get()` with no `allowCredentials`, its challenge the sign-in op's name, evaluating
    the PRF for the epoch it expects (1 when it knows nothing). If the register says the owner epoch has moved on, the
    browser reads the right epoch and asks once more: two taps, only after a rotation.
  - `ownerEpoch(vault)` becomes `ownerEpoch(credential)`, returning 1 until `tree/1` carries it; an owner-epoch change
    is its own op later.
- **Why:** the claim's assertion must sign the owner and seal halves, or anyone could pair a captured assertion with
  their own owner key, so the PRF output must exist before the `get()` that signs the claim; with the vault in the PRF
  input, sign-up always needed three taps. Without it, a new browser signs in with one tap.
- **Supersedes:** A78
- **Lean or code then:** `Aven.ID.KeyFormats` (#1680); `tree/1`'s claim, join and sign-in (#1718).

### A81 · The docs formats
- **Decided by:** the architect with the avenDB docs layer thread (09:04; again 09:10, 09:16)
- **Decision:** where the docs README disagrees, these win, and its sections "Its genesis", "What one holds", "Closing a
  segment" and "The head" are rewritten to match. No provisional formats in code: the Lean comes first, then the Rust
  replays it.
  - **The genesis** is a Core Value `{nonce, pins, type, vault}`, exact keys and no defaults. The Doc id is its name per
    A30, the hash of `["avenDB genesis 1", body]`. There is no `genesis: 1` (the label is the version), no `by` and no
    `sig`: the genesis carries no signature of its own. The Doc's first envelope carries it, and that envelope's
    signature and cap authorize it, as a `core/1` `put` of the root Record on `vaultType(vault, type)` (A32). Pins list
    only non-built-in types.
  - **The body** inside Core's `body` is `{acks, at, calls, cap, changes, generation, ops, records}`. `calls` is a list
    of `Call.value` (`{op, params}`), replacing `call` and `params`. There is no `envelope` key, and no `signer` or
    `sig`, which Core's envelope has. `ops` is half-open, `{from, to}` with `to` the writer's next counter, as Loro's
    spans are, so in one log an envelope's `from` is the one before's `to` (proved in Lean). The commit message is the
    lowercase hex of BLAKE3 over the canonical CBOR of `records`.
  - **The segment's body** is `{branch, envelopes, from, generation, prev, to, writer}`, inside Core's `Signed` under
    `avenDB segment 1`, hybrid-signed. `covers` goes: the envelopes' hashes are their names.
  - **The head** keeps `records` as the root map's key.
  - **Built-in types** are named as caps' `builtinType` is, by the hash of the label `avenDB <name> 1`, for `branch`,
    `closed`, `version` and `split`. Their shape is their Lean structure: no schema Doc, no schema hash, never pinned. A
    schema language comes later, with user types; step 1 needs only the built-ins and one toy type.
  - **Rule 7** is a Lean function from the commit's Loro deps and the envelope's `prev` and `deps` to a verdict, with a
    vector for the case where the writer's own previous op is dominated.
  - **The crate** is `aven-db-docs` in `db/docs`, as docs 22 says.
- **Why:** the db/docs README predates A28–A44.
- **Supersedes:** — (docs 24 holds its outline)
- **Lean or code then:** `Aven.DB.Docs.Genesis`, `.Body`, `.Segment`, `.Head` in #1694 (merged 09:59).

### A82 · One seal for envelopes, segments and checkpoints
- **Decided by:** the architect with the avenDB docs layer thread, the avenID keys thread reviewing (09:04; the AEAD's
  tests 09:19)
- **Decision:** `Aven.ID.Seal`, a new file in `id/spec` following KeyFormats' stanza pattern, is the one construction
  for loose envelopes, segments and checkpoints:
  - the cipher key is `derive_key("avenDB <kind> 1", epoch key)`, where kind is `envelope`, `segment` or `snapshot`;
  - the commit key is `derive_key("avenDB <kind> commit 1", epoch key)`;
  - the nonce is 24 random bytes (XChaCha20-Poly1305);
  - the AAD is `encode({doc, epoch, kind})`;
  - `commit` is the commit key's keyed BLAKE3 over `encode({aad, nonce})`, checked in constant time before decrypting;
  - the plaintext is padded to Padmé's length (PURBs; defined in Lean with its ≤ 12 % bound proved) before sealing;
  - outside are `{commit, ct, doc, epoch, nonce}` and nothing else (D13).

  The AEAD stays a parameter in Lean, as in KeyFormats: the Lean vectors fix the subkeys, AAD, commit, padded plaintext
  and outside form, and the Rust adds draft-irtf-cfrg-xchacha's known-answer test and Wycheproof's XChaCha cases
  (09:19).
- **Why:** caps D13: outside a segment are only its Doc, its key epoch and its padded length.
- **Supersedes:** —
- **Lean or code then:** `Aven.ID.Seal` in #1694.

### A83 · A Record's type never changes
- **Decided by:** the architect with the avenDB docs spec thread (09:04: "Refuse it")
- **Decision:** a retype is refused under any footprint: `typesKept` joins `verdictFootprint`, the type clause leaves
  `changeOf`, `changesFrom_edited_names` is proved, and `typesKept` is carried through `diff_footprint`,
  `honest_footprint` and `merge_steps`. Afterwards caps strengthens `rule4_reading_writes_nothing` to
  `changesFrom … = []`.
- **Why:** a Record's type is fixed at birth, and fit's inputs include each touched Record's type, which never changes;
  so a type change is refused, not read as the old Record gone and a new one put, since the id is the Record's address
  and would come back under another type.
- **Supersedes:** —
- **Lean or code then:** #1712 (merged 10:14).

### A84 · A face never draws outside its host
- **Decided by:** the architect, reviewing the runtimes thread's #1691 (09:05)
- **Decision:** the drawer, which is trusted, keeps every face inside its host:
  `:host{display:block;position:relative;overflow:hidden;contain:layout paint style;isolation:isolate}`. Paint
  containment makes the host the containing block for absolute and fixed descendants and clips them to its box, and
  `isolation` keeps z-index inside it. A box test in `sandbox/drawer.mjs`, in all three engines, draws a face with
  `position:absolute; inset:0`, a large translate and a large size into a small host beside a button, and checks that
  the button still gets the click and that no drawn node's client rect leaves the host. The README's drawer paragraph
  says "a face never draws outside its host".
- **Why:** Style allows `position: absolute` with `inset: 0` and `transform: translate…`, and the host was neither a
  containing block nor a clip, so a face could cover avenOS's own UI, "a fake "Sign in with your passkey", over the real
  buttons"; runtimes are untrusted code.
- **Supersedes:** —
- **Lean or code then:** `os/web/runtimes/draw.js`; #1691 (merged 09:15).

### A85 · A slide's style has one source
- **Decided by:** the architect with avenBRAIN (09:07)
- **Decision:** `.style.json` is the one source of a slide's style: each sheet is converted once and its hand-written
  CSS deleted. Wherever the HTML renderer still needs a sheet, the CSS is written from the data by `ruleCss`, the
  drawer's writer (`os/web/runtimes/draw.js`), after `ruleOk`, so a rule outside Style can't be written at all. The CSS
  reader is used only for the one-time conversion and doesn't stay in `brain/render`.
- **Why:** a CSS sheet plus a `.style.json` derived from it by a reader kept in the code would be two checked-in sources
  for one style, the kind of bridge rule 16 forbids.
- **Supersedes:** —
- **Lean or code then:** #1692 (merged 09:48).

### A86 · A file's bytes decide its type
- **Decided by:** the architect, reviewing the runtimes thread's #1689 (09:11)
- **Decision:** the bytes decide, and the claim only labels. The decision is cached per file, from the content-addressed
  head, so it's authentic. No head means an attachment, the safe default. The Service Worker keeps no list.
- **Why:** the sources give the rule, not its reason.
- **Supersedes:** —
- **Lean or code then:** `Registry.lean`; #1689 (merged 09:17).

### A87 · Strangers never reach Loro
- **Decided by:** the architect with the avenDB docs layer thread (09:16: "What I decide"; 09:41)
- **Decision:** Loro is a hole until proven otherwise:
  - (a) before any byte reaches Loro, the reader checks the signature, the envelope's place in its writer's log, and
    that the signer's chain reaches this Doc at all, so strangers never reach Loro;
  - (b) natively, `catch_unwind`, with `panic = "unwind"` in the profile the Peer uses;
  - (c) in the browser, the judge runs in a wasm instance of its own, a worker; if it dies, that envelope is unfit,
    recorded by its name so it's never judged again, and the judge restarts;
  - (d) a cargo-fuzz target on import.

  A commit goes through `live.fork()`, all or nothing, and imports are judged a page at a time on one scratch fork,
  never one fork per envelope, with a target of 500 envelopes of one Doc in under 1 s in every engine (76 ms measured,
  09:41). (a) to (c) are written into the docs README's "Importing" section.
- **Why:** wasm32 builds with `panic = abort`, so `catch_unwind` does nothing in the Peer-Light, and one hostile
  member's envelope would kill the worker, and kill it again on every catch-up. A fork is a full copy.
- **Supersedes:** —
- **Lean or code then:** `aven-db-docs` (#1694); the fuzzer in a follow-up PR.

### A88 · A call is canonical or isn't a call
- **Decided by:** the architect with aven-core (09:17)
- **Decision:** `Target.ofValue?` takes a Doc or type id only when it is 32 bytes, as `hashOf?` does, and
  `ofValue_value` assumes `Hash.ok`; `target-bytes.json` refuses a 31-byte and a 33-byte case. A call is canonical or
  isn't a call: Rust's encoder can't write a non-canonical one, Core's decoder refuses non-canonical bytes, and a vector
  whose params come out of order is refused on read. The model test generates only canonical calls.
- **Why:** Rust's encoder can't write a non-canonical call and Core's decoder refuses non-canonical bytes, so Lean
  matches them on canonical calls.
- **Supersedes:** —
- **Lean or code then:** `TargetCbor.lean`; #1699 (merged 09:26).

### A89 · Runtimes load by hash: the manifest and the host
- **Decided by:** the architect with the runtimes thread (09:18; 09:50, 09:57)
- **Decision:** the manifest has no `floor`, since A42 and #1683 made runtime floors A7's pin withdrawals: an entry is
  name, version, hash, limits and users, and a withdrawal is its own appended entry, never an edit. The manifest is
  append-only (09:57). `admit` is deterministic: no threads and no relaxed SIMD, set explicitly in wasmi's config, and
  it refuses float instructions (Style's numbers are hundredths); the README says why. The ABI is written down (`alloc`,
  `run`, the result header and the bounds checks on reading it, `badOutput`) in the runtimes README and in Contract's
  doc comment, with no theorem, since the Values crossing it are already Lean's. Fuel and memory are limited, with a
  trap on grow, and no imports link (09:50). The reproducible rebuild check stays, and wasmi is pinned exactly.
- **Why:** refusing floats is "the simplest way to make two hosts always agree", so two readers never disagree on an
  envelope.
- **Supersedes:** —
- **Lean or code then:** `Contract.lean`; #1704 (merged 09:57).

### A90 · `core/1`'s lowering is the engine's
- **Decided by:** the architect with the ops engine thread (09:20; to avenID minimal caps 09:21)
- **Decision:**
  - a new `Aven.DB.Engine.Lower` with `lowerCore : Call → Option (List Step)`, where Core's `Step` is
    `{type, verb, fields}`;
  - `core/1`'s write params are exactly `{type, fields}`, the type Doc a step writes and the fields it writes, with no
    defaults and `type` 32 bytes, as #1681's `patchCall` vector has them;
  - read, tell, keep and share lower to `[]`;
  - a call's values aren't params: they are in the envelope's `changes`, which must fit the lowered steps
    (`verdictFootprint`);
  - put-new against put-replace is decided in Lean, with its reason;
  - the committer's path from a typed mutation to the call it names is `Op.call`, with
    `lowerCore (Op.call o) = some [o.step]`;
  - the vectors are `lower.json`, `changes.json` (exported from Lean) and `merge-check.json`; `merges.json` stays docs'
    three-way merge;
  - caps' reader takes `lower` as a parameter, in Lean and in Rust, so aven-id never depends on the engine's internals
    and never writes a lowering of its own;
  - `RecordChange` lives in the pure engine crate, and docs depends on the engine, not the other way;
  - a removed field counts as written: it is in the change's fields and must be in the footprint like any write.
- **Why:** these are the engine's own spec; removing a field is a real Loro op, a map delete.
- **Supersedes:** —
- **Lean or code then:** #1697 (open at `f7e1775b`).

### A91 · `id/1` is avenID's plugin
- **Decided by:** the architect with avenID caps (09:33: "`id/1` is confirmed")
- **Decision:** `id/1` is the plugin name for avenID's own ops, beside `core/1` and `tree/1`; `keep-offer` is one of
  them.
- **Why:** the sources don't say beyond A32's ops by plugin.
- **Supersedes:** —
- **Lean or code then:** `Keeping.lean` (`idOp`), #1695.

### A92 · A refused sign-up drops its orphan passkey; older vaults without PRF still sign in
- **Decided by:** the architect with the avenID keys thread (09:34)
- **Decision:** when sign-up refuses a passkey without PRF, `create()` has already made a passkey that will never own
  anything, so avenOS calls `PublicKeyCredential.signalUnknownCredential?.({rpId, credentialId})` right before throwing
  `NO_PRF_MESSAGE`, feature-detected and with no fallback, and the box checks it where Chromium supports it. Sign-in
  without PRF still signs in, so nobody already in production is locked out: existing vaults predate the owner key, and
  their move to owner keys, and what a no-PRF passkey does then, is decided when the tree becomes the first Doc.
- **Why:** the password manager drops a passkey that will never own anything; no member of production is locked out.
- **Supersedes:** —
- **Lean or code then:** #1700.

### A93 · One Padmé
- **Decided by:** the architect with the avenDB docs layer and avenID keys threads (09:34; 09:43)
- **Decision:** there is one Padmé, a standalone Lean definition, `Aven.ID.Padme`, which the docs layer defines with its
  ≤ 12 % proof. The seal pads with it, and the keys thread pads stanza lists with it (D18), importing it rather than
  defining its own.
- **Why:** two threads needed it at once; one definition, which both import.
- **Supersedes:** —
- **Lean or code then:** `Aven.ID.Padme` (#1694).

### A94 · Many signatures beside one name, exactly
- **Decided by:** the architect with aven-core (09:35), for avenPEER's k of n and minimal caps' verdicts
- **Decision:**
  - `Sig {signer, sig}` is the one signature type: a set kept sorted by signer, one per signer, that only grows
    (`addSig`), at most 16 (`maxSigs`);
  - the writer's binding is a parameter, as `Verify` is: `writes : Bytes → Envelope → Bool` ("this key writes this
    envelope's log"), which docs supplies from its writer-id derivation and caps checks against the device cap;
  - `placed`: some sig whose signer `writes` e verifies over e's signing bytes; every other sig is an approval over the
    same bytes. An envelope with no valid writer sig is nothing: refused, never in S, never a split;
  - the suite is opaque, inside `sig` (Hybrid's `{ed25519, mlDsa, suite}` Value);
  - `Counts' := Closed ∧ Counts`, with `split_final`, `counts_past` and the Authorized and Node uses restated over
    closed sets, and `closed_mono`. "Counts stays counted" isn't monotone, by design (A4: a later split discounts), and
    the doc comment says so;
  - the mechanical edits in `id/` and `db/` land in the same PR, so main never breaks. No peer sends Core envelopes on
    the wire yet and none are stored in production, so this isn't a frozen form (rule 1); thread E's frames carry the
    new shape.
- **Why:** A30's many signatures beside one name, and rule 11's whole past; a writer id is docs' concept, so Core takes
  it as a parameter.
- **Supersedes:** — (refines A30)
- **Lean or code then:** #1710 (as built: unsorted or duplicate sets are refused on read).

### A95 · A log's first envelope carries the genesis; built-ins are fit by their definer
- **Decided by:** the architect with the avenDB docs layer thread (09:41)
- **Decision:** the genesis sits in the body exactly when the envelope is its log's first (seq 1, no prev, no deps) and
  is absent otherwise, and the reader refuses either mismatch (`genesis_iff_first`, with a vector each way), so the
  shape stays exact with no optional key. Built-in versions are `[type Doc]`, and `to` is half-open. Whoever defines a
  built-in type checks its shape: docs' fit takes the checks as a parameter,
  `builtinFit : DocId → Option (Value → Bool)`; docs supplies its own four (branch, closed, version, split), aven-id
  supplies cap, revoke and epoch (from minimal caps' `Cap::from_bytes` and its siblings), and the Lean takes the same
  parameter. Until aven-id's are wired in, docs refuses those types as unfit.
- **Why:** "not as an optional key"; a built-in's shape belongs to whoever defines it.
- **Supersedes:** — (refines A81)
- **Lean or code then:** #1694.

### A96 · A Record's id as a Loro key; one `Version`
- **Decided by:** the architect, with the avenDB docs layer and ops engine threads (09:43)
- **Decision:** a Record's id is bytes; its Loro map key is the lowercase hex of those bytes, written once in Lean, with
  injectivity proved so two ids never meet on one key. Every readable form (`d:…`) is display only. `RecordChange.type`
  takes docs' `Version {type, schema?}`, one Version type everywhere: `schema` is absent exactly for built-in types, and
  the reader refuses a built-in type with a schema or a user type without one (`schema_none_iff_builtin`, kept by docs
  beside its set of built-ins). It replaces the bare `TypeId`, so built-in types fit. The ops engine owns
  `RecordChange`.
- **Why:** one encoding of an id, in Lean; built-in types fit like any other.
- **Supersedes:** —
- **Lean or code then:** #1697 (`idKey`, `idKey_inj`).

### A97 · A migrated passkey gets its owner by the owner-epoch op
- **Decided by:** the architect with avenPEER (09:49: "(a) for the migration")
- **Decision:** migrated claims and joins carry a partial passkey record: `spki` and `credential` from what's stored,
  `owner` and `seal` absent. The member's first sign-in after the switch adds owner and seal with the owner-epoch op,
  signed by that passkey's ES256 alone. `owner` is required for every act except the one that adds it, so no member is
  locked out and there's no dual mode. A migrated passkey without PRF still signs in, but can't add owner and seal, so
  it can't do anything that needs the owner; the page says what the sign-up refusal says, to add a passkey from a
  provider that can, and its vault keeps its other owners and devices.
- **Why:** no member is locked out, and no dual mode (A55).
- **Supersedes:** A92 (in part: what a no-PRF passkey does once the tree is a Doc, left open there)
- **Lean or code then:** `ownerless_only_adds_owner` (#1718); PEERS.md's migration section.

### A98 · The codec is its own crate, `aven-codec`
- **Decided by:** the architect, with aven-core and the runtimes thread (09:57; 10:07, 10:39)
- **Decision:** Core's codec (Value, encode, decode and the depth limit) is a small crate of its own that changes
  rarely, `aven-codec`, and aven-core re-exports it, so nobody's imports change. The runtimes' modules depend only on
  the codec, never on all of aven-core. It is a Rust crate boundary only: the Lean stays `Aven.Core.Cbor`. The split
  lands inside #1710 (10:07), so the frozen modules' hashes move once. As built (10:39), `aven/DB2/codec` holds Value,
  encode, decode, the depth limit and the names (Hash, blake3, name_of).
- **Why:** the runtimes' frozen wasm modules compile aven-core, so every unrelated core change moved their hashes.
- **Supersedes:** —
- **Lean or code then:** #1710; the runtimes on aven-codec in #1729.

### A99 · Every face draws border-box
- **Decided by:** the architect, on avenBRAIN's point, for the runtimes thread (09:57)
- **Decision:** the drawer's base sheet sets `*,*::before,*::after{box-sizing:border-box}` inside every face's shadow
  root, beside the `:host` rule, so every face draws as avenOS does. Style doesn't gain `box-sizing`. A drawer box check
  holds a 100 %-wide bordered face to its host exactly.
- **Why:** the slides fit their hosts exactly without patching their data.
- **Supersedes:** —
- **Lean or code then:** #1709.

### A100 · Authority runs down through quorums; a cap's issuer is a vault
- **Decided by:** the architect with avenID caps (09:57)
- **Decision:** authority runs down only through vaults whose quorum the issuer meets alone, so a coop with k > 1 issues
  as itself, approved by k of its owners. A cap has no single `signer`: its issuer is the vault, proven by k valid owner
  signatures, or by a device sig under that vault's device cap (approvals are signatures beside the cap's one name,
  A30). A ticket is a grant from Maia City to the founded vault, its one-time key only a condition (rule 15). The
  threshold k lives on the tree's vault record, which is avenPEER's, set by `tree/1`'s owner-change op, and caps reads
  it as `Ctx.thresholds`.
- **Why:** rule 15 and A28: only vaults hold authority, k of n.
- **Supersedes:** — (refines A28)
- **Lean or code then:** #1717 (merged 10:34: `Tree.alone`, `root_quorum`, `alone_approves`, `Tree.issued`).

### A101 · `put` mints a new Record
- **Decided by:** the architect, accepting the ops engine thread's finding (10:00; 10:14)
- **Decision:** a "new" Record must not have existed before (`diffWithin`). Honest commits carry `Fresh` (A18: ids are
  made, not drawn), and a commit that reuses a counter fails `check`, since that's a split anyway. `put` lowers to
  put-new (`lowerCore_no_replace`). The engine README's "Mutations" states the `Fresh` hypothesis with one sentence on
  why. There is one freshness hypothesis, the engine's `Fresh`, since the engine mints ids, and the docs spec's
  `FreshCounter` goes into it (10:14).
- **Why:** a reused counter is a split anyway; one concept, one owner (A45).
- **Supersedes:** —
- **Lean or code then:** #1697.

### A102 · Frozen runtime bytes are committed
- **Decided by:** the architect, approving the runtimes thread's browser-host plan (10:01)
- **Decision:** the frozen bytes are committed, `aven/runtimes/frozen/<hex>.wasm`. A frozen module is content-addressed,
  and its bytes must stay loadable by hash after its source moves. Git is the honest store for that until runtimes
  become blobs in avenDB, fetched by hash and kept by keepers, and the README says that end state. `freeze.sh --check`
  holds the newest build to its committed bytes, the release serves the folder, and nothing else is committed beside the
  bytes: no sourcemaps, no debug builds. markdown-runtime is held to the same vectors as brain/render's tree, links
  included, and then brain/render's JS renderer goes.
- **Why:** a frozen module must stay loadable by its hash after its source has moved on.
- **Supersedes:** runtimes 11 ("Frozen modules are rebuilt, not committed")
- **Lean or code then:** `aven/runtimes/frozen/`, `freeze.sh`.

### A103 · Sign-ins go into the migration snapshot
- **Decided by:** the architect with avenPEER (10:01; again 10:12)
- **Decision:** the genesis's `devices` takes the claimant's browser plus every claimant sign-in. Each migrated claim
  carries `devices: List` with its partial passkey record. `refOrder` keeps only invites, withdrawals, joins and
  confirms. No ownerless passkey signs anything but the owner-epoch op, so there's no exception and no dual mode, and
  every device production admits today is still admitted. After the switch, a sign-in needs an owner: caps rule 21's
  hybrid beside the ES256. A migrated non-PRF passkey keeps its existing devices but can't add a new one until a PRF
  passkey gives its vault an owner, and the page says so plainly.
- **Why:** every device admitted today stays admitted, with no exception and no dual mode.
- **Supersedes:** —
- **Lean or code then:** `settle_restore_door` and `oldSideAgrees` adapted to the snapshot (#1718).

### A104 · avenID's built-in Records inside a Doc
- **Decided by:** the architect, on the avenDB docs layer thread's catch, for the avenID minimal caps thread (10:01)
- **Decision:** a cap Record is the cap's signed form as a Value: its body's fields as a map, plus
  `sigs: [{signer, sig}]` beside it (A30's many signatures). The label is implied by the type, so it isn't stored. A
  revoke Record and an epoch Record follow the same pattern; the epoch is the key blob's Value with its stanzas, as
  KeyFormats writes it, and `Revocation` gets an encoding. `idBuiltinFit : DocId → Option (Value → Bool)` is keyed by
  `capType`, `revokeType` and `epochType`, with fit and unfit vectors, and aven-id decodes them in Rust; the docs layer
  joins them as `IdBuiltins`.
- **Why:** nothing in id/spec said what these Records look like in a Doc's access map, and `Revocation` had no encoding,
  while docs' `BuiltinFit` needs them.
- **Supersedes:** —
- **Lean or code then:** AccessRecords in #1716.

### A105 · The confirm envelope is the issuance
- **Decided by:** the architect with avenID caps (10:10)
- **Decision:** a member cap is Maia City's act, carried out under Maia City's confirm cap. It isn't Aven's own grant,
  so D14 doesn't ask Aven's owners for each member, and there's no second cap object to keep in step. `memberCap v` gets
  its lines from `tree/1` confirm's definition, which avenPEER fixes. Coop roots through `Tree.alone`, `governs` as the
  same quorum relation, and optional signers becoming `sigs` once Core's `Sig` lands are right.
- **Why:** as stated: no per-member approval by Aven's owners, and no second object to keep in step.
- **Supersedes:** — (refines A38)
- **Lean or code then:** `Member.lean` (#1717).

### A106 · An envelope's authority is one Value, `{acks, caps}`
- **Decided by:** the architect, with avenID caps, avenID minimal caps and both docs threads (10:10; 10:43)
- **Decision:** an envelope's authority names caps' Records and never copies them: `caps` is the chain's cap Record
  names, root first, and `acks` is a list of names, exactly what `Reads.caps` and `Reads.acks` read. Caps owns the
  definition, `Aven.ID.Authority` (10:43): the body has one key, `authority`, holding `{acks, caps}`, with `caps` empty
  on the vault's own authority, and round-trip lemmas. Docs carries it without reading it.
- **Why:** nothing is stored twice, and the authority part is caps' concept (A45).
- **Supersedes:** A81 (in part: the body's separate `acks` and `cap` keys)
- **Lean or code then:** `Aven.ID.Authority` (branch `claude/avenid-a45`).

### A107 · The member cap's lines; caps and revocations named by A30
- **Decided by:** the architect with avenID caps and avenPEER (10:17; the revocation's name 10:34)
- **Decision:** approved together: the member lines, the threshold plan and the cap's A30 name. A member cap's lines
  are: read the chat; put on the chat, bounded to the chat message type; and `tree/1` signIn on the tree Doc, with no
  params bound (avenPEER's `signIn_own_vault` bounds it). There is no ticket line. `confirmCap` has one line: `tree/1`
  confirm on the tree Doc, with the claim free. Thresholds: avenPEER adds `Vault.threshold : Nat := 1`, with k ≥ 1 in
  WF, in its k-of-n PR together with the owner-change op; until then caps' contexts carry `"thresholds"` per vault. A
  cap's name is `Signed.name` of `[avenID cap 1, body]` (`[capLabel, body]`), and a revocation's is `Signed.name` of
  `[avenID revoke 1, value]` (10:34).
- **Why:** the sources record the approval, not a reason.
- **Supersedes:** — (refines A38)
- **Lean or code then:** `Member.lean` (`memberLines`, `confirmCap`, #1717); the names in #1716.

### A108 · "core" means only Core: the first generation is `aven-gen1`
- **Decided by:** Samuel, as the architect gave it to thread E (10:20: "a new task (Samuel, 31 Oct 2026)"), after Samuel
  asked (10:02) "And shall we rename core to kernel?" and (10:03) "Ah core/kernel defineies the primitives that he other
  s reuse right?"
- **Decision:** the first-generation crate `aven-db-core` becomes `aven-gen1`, and its folder `aven/DB2/db/core` becomes
  `aven/DB2/gen1`, so "core" means only Core (`aven-core`), which keeps its name. It is one mechanical PR: the crate and
  its folder, every `aven_db_core` import, the workspace members, the box, the Peer image, the workflows' paths and
  every mention in the READMEs, PEERS.md, SANDBOX.md and ARCHITECTURE.md. Its Lean (`aven/DB2/db/spec`, `Aven.DB.*`)
  stays where it is until the split moves it. No behaviour changes.
- **Why:** so "core" means only Core, which defines the primitives the others reuse (Samuel, 10:03).
- **Supersedes:** —
- **Lean or code then:** #1720 (open at `f7e1775b`).

### A109 · Core names every plugin's ops and every built-in type
- **Decided by:** the architect, with aven-core, avenID caps and avenPEER (10:34; 10:43)
- **Decision:** `OpId.ofPlugin plugin name`, in Core's `Op.lean`, is any plugin's op id: the name of
  `{"op": name, "plugin": plugin}`. `CoreOp.id` is `ofPlugin "core/1"`, and caps' `pluginOp`/`idOp` and avenPEER's
  `TreeOp.id` use it rather than computing it three times. `core/1`'s write param names, `typeParam` (`"type"`) and
  `fieldsParam` (`"fields"`), sit in Core beside `CoreOp`; caps bounds them and the engine lowers with them. `ops.json`
  gains one plugin op (`tree/1` `claim`) and the two names. Core's `builtinType H ns name` names the label
  `<ns> <name> 1` (10:43): avenID's types use `"avenID"`, docs' use `"avenDB"`, `typeOfTypes` is
  `builtinType "avenDB" "type of types"`, and every type id stays as it is.
- **Why:** one concept, one owner (A45): the same names were defined in three places.
- **Supersedes:** — (refines A75)
- **Lean or code then:** #1710.

### A110 · A Markdown link is resolved inside markdown-runtime
- **Decided by:** the architect with the runtimes thread (10:39; 10:43)
- **Decision:** markdown-runtime emits " " for a soft break, so the trees are equal outright. It resolves `base` itself,
  lexically only, with no fetch and no lookup: RFC 3986's remove_dot_segments, with `..` clamped at the root. An href
  with a scheme is never resolved against `base`; only the allowlist judges it. A query and a fragment are kept. A
  fragment-only href (`#heading`) gets `idPrefix`, so in-page links still reach the prefixed heading ids, and the
  vectors say so. `base` and the prefix rules are params whose values the brain owns (its package list, the GitHub URL);
  the runtime knows no repository and no GitHub. markdown v2 is appended to the manifest, and v1 stays.
- **Why:** what a link in a Markdown document points to is markdown's concept (A45), and rewriting links before the run
  would mean a second Markdown parser in JS; a check that normalised whitespace would hide real differences.
- **Supersedes:** —
- **Lean or code then:** `Markdown.lean` (`resolve`, `removeDots`, `linkTo`) on `claude/runtimes-markdown2`.

### A111 · One node-tree allowlist, the runtimes'
- **Decided by:** the architect with the runtimes thread and avenBRAIN (10:39; 10:49, 10:59)
- **Decision:** the allowlist is the markdown runtime's concept, so `brain/render/tree.js`'s allowlist check goes and
  its tests move to the runtimes' vectors: "One allowlist, one owner." tree.js's parsing of slide HTML at build time may
  stay avenBRAIN's tooling if they want it (10:49). In avenOS, the drawer's `checkTree` is the one check, for Markdown
  too (#1723, 10:59).
- **Why:** one allowlist, one owner (A45).
- **Supersedes:** A58 (in part: the interim JS allowlist mirror); runtimes 9 (in part: the applier lives with the
  drawer, in `draw.js`)
- **Lean or code then:** `tree.json`; #1723 (merged 10:59).

### A112 · The clean-slate cutover, in seven stages
- **Decided by:** Samuel (10:40): "Go", after asking (10:22) "How far are we away from a clean slate upgrade to the new
  implementation?"
- **Decision:** the cutover goes in seven stages: 1, the Doc foundation; 2, authority in Lean; 3, Docs in the Peers; 4,
  the tree as the first Doc; 5, catch-up and keepers; 6, the chat as a fresh second Doc; 7, rehearsal and cutover, then
  aven-gen1 is deleted. Stages 3 and 5 start as threads of their own beside avenPEER's stage 4, against the same
  interfaces, and the tree's code builds on stage 3's Doc interface, not on storage or gossip of its own.
- **Why:** the sources don't record the case the architect put to Samuel.
- **Supersedes:** A43 (in part: its order, which put catch-up and keepers after the chat)
- **Lean or code then:** none yet.

### A113 · Readers sync by version; keepers serve by arrival number
- **Decided by:** the architect, with Docs in the Peers and catch-up and keepers (10:42; 10:45, 10:48)
- **Decision:** two paths stay apart: reader-to-reader sync by version, by tips (Docs in the Peers, stage 3), and
  catch-up by arrival number from keepers (catch-up and keepers, stage 5). Both are the Peers': stage 3's
  `Aven.Peer.DocSync` and stage 5's keeper ("keeping is a Peers' job", 10:45). A Peer-Light answers the readers it meets
  on a Doc's topic, by version, and never keeps or serves by arrival number for others (PEERS §3, 10:48). The two
  threads agree their frames' names.
- **Why:** the sources give the split, not a reason.
- **Supersedes:** —
- **Lean or code then:** none yet; `Aven.Peer.DocSync` came in #1727.

### A114 · k of n on the tree; a passkey without an owner counts only for adding one
- **Decided by:** the architect with avenPEER (10:44; 10:45)
- **Decision:** the tree's k of n takes `Vault.threshold := 1` with WF k ≥ 1 (`trees.json`); a statement's `approvals`
  are the keys of its valid `sigs`, and `byAdmin` is `Tree.approves` with `Vault.threshold`. The ownerless rule is one
  theorem across all acts: a passkey without an owner, and without its own `ownerEpoch`, has no act counted except that
  `ownerEpoch`. (#1718's checks as approved: `passkeyOf` stops sign-ins (`ownerless_only_adds_owner`); tickets and
  withdrawals need `byAdmin`, the coop's owners, whose genesis passkey must have an owner; a passkey's confirm needs
  `ownerAdded`.)
- **Why:** one theorem, so the property doesn't rest on three separate checks.
- **Supersedes:** —
- **Lean or code then:** #1718; k of n to come.

### A115 · The tree counts with Core
- **Decided by:** the architect with avenPEER (10:45: "(1)")
- **Decision:** Core counts envelopes, the tree supplies `fit` and `authorized`, and there is no second past. Network's
  `counted` ("descends from the pinned genesis") goes rather than staying on top: Core's `Envelope` carries a signed
  `doc : DocId`, and docs' genesis rule has every log's first envelope carry the genesis its DocId names, so with
  `Closed`, belonging to the tree is `e.doc = pinned` plus docs' genesis check. The reader pins the tree's DocId as a
  parameter. If docs' Lean doesn't yet state that a log's first envelope carries the genesis that names its `doc`, the
  docs thread adds it, and the tree keeps no copy. The replacement keeps today's results on the vectors:
  `restore_agrees`, `oldSideAgrees`, and `settled.json` unchanged except for names.
- **Why:** Core owns the past and the counting (A45).
- **Supersedes:** —
- **Lean or code then:** docs' `genesisOk`, `genesis_names_doc`, `root_carries_genesis`; `closed_reaches_genesis` waits
  for Core's `Closed`.

### A116 · Owner changes: one winner everywhere, and a removal beats the removed
- **Decided by:** the architect with avenPEER (10:45)
- **Decision:** two `setOwners` statements, each approved by the owners in force in its own past and neither in the
  other's past, settle as the tree settles its other lists: the latest by the past, ties by the smallest hash, and every
  peer settles the same owners in any order of arrival (proved). A `setOwners` that drops key k beats every act approved
  by k that isn't in the removal's own past (`removal_beats`), as a withdrawal beats a claim; an act already in the
  removal's past stays counted.
- **Why:** "approved by the owners in force in its own past" alone lets a removed owner's key, possibly the stolen one,
  sign on an old past that lacks its removal, and still count.
- **Supersedes:** — (refines A42's k of n)
- **Lean or code then:** none yet (stage 4).

### A117 · The keeper's store and crate
- **Decided by:** the architect, approving catch-up and keepers' plan (10:45; the namespace 10:49, 10:58)
- **Decision:** the keeper's store makes one compare-and-set per upload frame, keeps full pages immutable, and never
  reuses an arrival number. `dropped_listed` is added: a dropped loose item's envelopes stay fetchable through a segment
  the keeper holds, numbered after the item was, so a reader who resumes from any n still reaches every envelope; it
  holds only while the uploader is honest about what its segment holds, and its doc says so. The keeper's crate,
  `aven-peer-keeper`, is a pure crate under `peer/` that depends only on Core (keeping is a Peers' job), and its Lean is
  `Aven.Peer.Keeper`, with no db-only imports (10:49, 10:58). Frames: iroh-blobs with the per-request intercept is
  preferred, and `items` frames only if the current release's hook can't refuse by Doc. `default_kept` isn't the
  keeper's: the owner approves it as part of joining, in the tree's claim statement, and the keeper only reads the keep
  caps it is handed; in the box before stage 4, it is handed keep caps signed by the cast's vault owners, and no path
  skips the keep cap.
- **Why:** the plan was approved as proposed; covers by the uploader's own word are A44's.
- **Supersedes:** —
- **Lean or code then:** `Aven.Peer.Keeper` and `aven-peer-keeper` (#1722, open at `f7e1775b`).

### A118 · Docs in the Peers: a topic per Doc, blind gossip, frames named by topic
- **Decided by:** the architect, approving Docs in the Peers' plan (10:48)
- **Decision:**
  - **Topic:** a topic per Doc epoch, `derive_key("avenDB topic 1", the Doc's epoch key)`; a reader joins the newest
    epoch's topic and the one before it, so a rotation loses nothing in flight. Doc topics don't depend on the wire
    version, since they carry sealed Docs data, not frames.
  - **Gossip** forwards sealed bytes blind, and every reader judges for itself. A reader serves what it holds, both
    halves of a split included. An envelope recorded unfit is never forwarded or served. Oversize envelopes go out as
    hash-then-fetch, and a Doc's sealed values are fetched over iroh-blobs through stage 5's fetch gate (`prove` with
    the Doc's current fetch key, the per-request intercept): one gate for readers and keepers, built with stage 5.
  - **Frames:** `doc_tips` and `doc_have`, named by the topic and never by the Doc's id, so a link peer that isn't a
    reader can't tell which Doc it is; tips go only to a peer met on that topic. `Aven.Peer.DocSync` proves
    `beyond_union`, the paging laws and `sync_moves`. One wire bump to v3, shared with stage 5; thread E agrees the
    version step.
  - **Local first needs no native Peer:** with Alice Peer stopped, a commit at Alice's Peer-Light still reaches Bob's
    Peer-Light over the relay, a box case. Alice Peer bridges as a reader, and the Aven Peer joins a topic only as a
    blind forwarder, once stage 5 hands keepers the topic.
- **Why:** iroh-gossip forwards before the app sees a message and a blind peer can't judge anyway, and a split's both
  halves must spread.
- **Supersedes:** —
- **Lean or code then:** none yet; `Aven.Peer.DocSync` came in #1727.

### A119 · One docs worker judges every open Doc
- **Decided by:** the architect with Docs in the Peers (10:48)
- **Decision:** in the browser, one docs worker for all open Docs, not one per Doc. On a crash it restarts and reopens
  the open Docs from the store. To find the culprit, it retries the crashed page envelope by envelope in a fresh worker
  and records an envelope unfit only when it crashes again alone, so a transient fault (out of memory, say) never marks
  a valid envelope unfit. The unfit record is local and never travels. The keys and the Closer stay in the Peer-Light,
  Loro runs only in the docs worker, and a commit goes prepare → sign → finish; the docs API gains that split and an
  index from envelope name to the held sealed Value.
- **Why:** every wasm instance costs memory, and the device key never enters the worker that runs Loro (rule 13).
- **Supersedes:** A87 (in part: (c), a worker per judge and an envelope unfit as soon as it dies)
- **Lean or code then:** none yet.

### A120 · A device's ML-DSA key is generated, and counts only once its owner binds it
- **Decided by:** the architect, with Docs in the Peers, the avenID keys thread and avenPEER (10:48; 10:49, 10:50)
- **Decision:** the keys thread generates the device's ML-DSA-65 key beside `device-key`, at device creation, never
  derived from a passkey; existing devices generate theirs on their first run after the upgrade. Both seeds live in one
  Value under `device-key`, written in one write, so a crash never leaves a device with one half; an existing device's
  upgrade replaces the Value by compare-and-set, keeping its Ed25519 seed, so its identity and every sign-in stay valid.
  It has the Ed25519 seed's protections: never logged, never leaving the Peer-Light's or the Peer's process, zeroized
  after use, constant-time where compared. A device's ML-DSA public key counts only when its vault owner's hybrid
  signature binds it: in the sign-in that admits the device, which names the device's hybrid public key under the
  owner's approval, or for a migrated device at its owner's `ownerEpoch` or next sign-in; never by the device's own
  Ed25519 (`device_hybrid_bound`). Until then, segments are signed only by devices whose hybrid key is bound.
- **Why:** a binding signed by the device's own Ed25519 would let a quantum forger bind its own key, and the hybrid
  would protect nothing.
- **Supersedes:** —
- **Lean or code then:** none yet.

### A121 · The keyring is a vault's own Doc
- **Decided by:** the architect, with Docs in the Peers and the avenID keys thread (10:48; 10:49)
- **Decision:** the keyring needs no tree. It is a vault's own Doc of avenID's built-in `keyring` type, the only Doc
  sealed to devices: its epochs are sealed to the vault's devices and to each passkey's PRF seal key. It is the first
  Doc stage 3 holds: Alice's Peer-Light makes it at sign-up, and her other devices sync it like any Doc. Its Records and
  its first epoch at sign-up are settled with the keys thread.
- **Why:** a Doc's keys open through its vault's keyring, which needed a home before the tree is a Doc.
- **Supersedes:** —
- **Lean or code then:** none yet.

### A122 · The fetch gate's frames and bounds
- **Decided by:** the architect, with catch-up and keepers and Docs in the Peers (10:58)
- **Decision:** readers and keepers alike fetch through stage 5's frames on aven/db/1 (A44): `prove {doc, key, sig}` →
  `proven`, then `fetch {doc, hashes}` → `items`, each item at most 64 KiB and larger ones split by offset. The receiver
  checks each reassembled item's BLAKE3 against the hash it asked for before storing it; an item that doesn't match is
  dropped and its sender noted, never stored. Hashes per `fetch`, bytes in flight per connection and the offset split
  are each a named limit, in the Lean and the vectors. A `fetch` of a hash the keeper doesn't hold for that proven Doc
  is refused per hash, never served from another Doc (the hash→doc map). `doc_have` answers with hashes the asker
  fetches through that path, and oversize live envelopes on gossip go out as their hash, fetched the same way.
- **Why:** a proof must sign the exporter of the connection that serves (`served_current`); binding a second ALPN's
  connection would mean wrapping the store's blobs code, and the Peer-Light has no iroh-blobs.
- **Supersedes:** A117 (in part: iroh-blobs for sealed values); A118 (in part: the same)
- **Lean or code then:** `Aven.Peer.Fetch` (#1722).

### A123 · Stanza lists are padded, and tag seeds come from the epoch before
- **Decided by:** the architect, merging the avenID keys thread's D18 PR (11:02), Padmé agreed with the avenDB docs
  layer thread
- **Decision:** an epoch's stanza list is padded to `padded n = padme (max n 4)` (`padded_ge`, `padded_min`,
  `padded_le`) with random dummy stanzas, and a reseal re-pads. A tag seed is
  `keyed_hash(derive_key("avenID tag seed 1", previous epoch's key), BLAKE3(reader's X-Wing pk))`; first epochs and
  resealed readers are untagged. The readers for the access Records live in KeyFormats with the named lengths (`ctLen`,
  `commitLen`, `sealedLen`, `tagLen`, `nameLen`), proved by `Epoch.ofValue_value`, and minimal caps imports them.
- **Why:** the floor of 4 hides a lone reader (caps D18: everything is padded).
- **Supersedes:** — (refines caps D18)
- **Lean or code then:** #1724 (merged 11:02): `aven_id::padme`, `open_tagged`.

### A124 · The fetch gate names a Doc by its id, and proves only to holders
- **Decided by:** the architect, settling the open point between Docs in the Peers and catch-up and keepers (11:05)
- **Decision:** the fetch gate (`prove`, `fetch`, `items`) names a Doc by its id, while gossip and `doc_tips` name it by
  its topic. A peer sends `prove {doc}` only to a peer it already knows holds that Doc, a keeper its vault's keep caps
  name or a reader it met on the Doc's topic, so no non-holder learns the id. The gate's Lean states it as a condition
  on the sender (`prove_only_to_holders`).
- **Why:** a keeper keeps by id and can't derive topics, and the fetch proof signs the id.
- **Supersedes:** —
- **Lean or code then:** `Aven.Peer.Fetch` (#1722).

### A125 · ARCHITECTURE.md and the Lean are avenDB's single source of truth
- **Decided by:** Samuel (11:06): "The architecture doc should be our SSOT together with our lean implementations of
  what should be the decisions that we made." and "Also write a memory / agent rule. That needs to always document all
  decisions in this centralize architecture doc. Right?"
- **Decision:** the rule in `aven/DB2/CLAUDE.md`: ARCHITECTURE.md and the Lean specs are avenDB's single source of
  truth, and a decision that isn't there isn't decided. Every decision, Samuel's, the architect's, or agreed between
  threads in messages or a PR body, is recorded before anything builds on it: folded into the section that owns the
  concept or added as an A-number, by the architect, or by the thread in the same PR that first relies on it. A decision
  that lives only in a message, a PR body or a spec README is drift. Specs cite and don't decide: where a spec and
  ARCHITECTURE.md disagree, ARCHITECTURE.md wins, and the spec is fixed in its owner's next PR. A later decision
  rewrites the text it changes, never added below the old text, and the old text's history stays in git. A decision is
  done when ARCHITECTURE.md states it, the Lean names it cites exist on main, and the code follows. Before starting, a
  thread reads the A-numbers its package's README cites.
- **Why:** Samuel: "I believe we have a drift regarding many decision across all our running threads .. Dan that be?"
- **Supersedes:** —
- **Lean or code then:** #1728 (merged 11:10).

### A126 · All architecture moves into one document and its chapters
- **Decided by:** Samuel (11:06: "Anything that contradicts itself is out dated or legacy please update and consodialite
  again."), as the architect told every avenDB thread once #1728 was on main ("Two things from Samuel (31 Oct 2026)")
- **Decision:** ARCHITECTURE.md is the entry, with each concept stated once and its Lean module named, in chapters under
  `aven/DB2/architecture/`. The package READMEs (caps, docs, engine, store, runtimes, core) and PEERS.md keep only what
  the package is, a link to its chapter, how to build and test it, and its file map. Until the consolidation lands, no
  design prose is added or rewritten in package READMEs, PEERS.md, SANDBOX.md or GLOSSARY.md: it goes in the PR body,
  and the decision to the architect. A thread that settles something with the architect or another thread tells the
  architect, so it gets recorded. Code, Lean, vectors and tests carry on, and a branch that edited README design prose
  moves that edit into the matching chapter.
- **Why:** each concept stated once, in one place.
- **Supersedes:** —
- **Lean or code then:** none yet.

### A127 · A commit is prepare, sign, finish
- **Decided by:** the architect, as Docs in the Peers settled it with the avenDB docs layer thread (11:10)
- **Decision:** `Doc::prepare` (unsigned, taking the signer's public key) → `Prepared::signing()` →
  `Doc::finish(prepared, sig)`. `finish` refuses (`Moved`) if the Doc moved on since `prepare`. `commit(&Device)` is all
  three.
- **Why:** the device key never enters the worker that runs Loro (A119).
- **Supersedes:** — (refines A119)
- **Lean or code then:** `aven-db-docs` on `claude/aven-docs`.

### A128 · A Held page reopens a Doc
- **Decided by:** the architect, as Docs in the Peers settled it with the avenDB docs layer thread (11:10)
- **Decision:** a Held page (`Docs/Head.lean`), `{doc, envelopes: [[name, hash of the envelope's own bytes]]}` in held
  order, is stored beside the head and replaced by compare-and-set; reopening a Doc is `open` then `import_page`. A peer
  stores envelopes' own bytes and seals only what leaves the device.
- **Why:** the head lists only tips, so without it a Doc couldn't reopen from the store.
- **Supersedes:** — (refines A119)
- **Lean or code then:** `Docs.Held` in `Head.lean` (`held.json`).

### A129 · Held envelopes by name; the unfit set is local
- **Decided by:** the architect, as Docs in the Peers settled it with the avenDB docs layer thread (11:10)
- **Decision:** `Doc::held()` yields `(name, &Envelope)`, the name computed once at import. `Doc::mark_unfit(name)`
  takes effect before or after the envelope is held. The unfit set is the docs worker's: local, never stored by docs,
  and it never travels.
- **Why:** the unfit record is local and never travels (A119).
- **Supersedes:** — (refines A119)
- **Lean or code then:** `aven-db-docs` on `claude/aven-docs`.

### A130 · A device's ML-DSA ξ exists only while a segment closes
- **Decided by:** the architect, as Docs in the Peers settled it with the avenID keys thread (11:10)
- **Decision:** the device's ML-DSA ξ is derived per segment close and dropped after it. Segments close only once
  `device_hybrid_bound` holds.
- **Why:** the derived key lives no longer than its use (A43: wiped after use).
- **Supersedes:** — (refines A43)
- **Lean or code then:** `HybridKey::from_device_seed` in aven-id.

### A131 · The keyring's Records
- **Decided by:** the architect, as Docs in the Peers settled it with the avenID keys thread (11:10)
- **Decision:** the keyring Doc's Records are minimal caps' EpochRecords (`Epoch.value` plus sigs), one per keyring
  epoch, named by `Epoch.name`. A reseal rewrites the same Record; a rotation writes a new Record naming the old one.
  The vault's Peer-Light makes the keyring Doc at sign-up.
- **Why:** the sources don't say.
- **Supersedes:** — (refines A121)
- **Lean or code then:** EpochRecord (#1716).

### A132 · A device's seal seed comes from its own seed
- **Decided by:** the architect, approving the avenID keys thread's proposal (11:10)
- **Decision:** a device's X-Wing seal seed is `derive_key("avenID device seal 1", its Ed25519 seed)`, as its ML-DSA
  seed is (A43): nothing stored, and it rotates with the device key. The alternative, a stored X-Wing seed beside
  `device-key`, is not taken.
- **Why:** the keyring is sealed to devices, which had no seal key; X-Wing's ML-KEM half is out of reach because the
  seed is.
- **Supersedes:** —
- **Lean or code then:** none yet.

### A133 · The fetch gate's frames, exactly
- **Decided by:** the architect, as catch-up and keepers settled them with Docs in the Peers and thread E (11:10)
- **Decision:** `prove {doc, key, sig}` → `proven` | `prove_refused {doc, why}`; `fetch {doc, hashes}`, at most 128
  hashes, → `items {doc, hash, at, total, bytes}`, parts at most 48 KiB, | `missing`. Items are exactly the stored
  sealed bytes, BLAKE3-checked before storing. The gate and the `keep_*` frames name Docs by id; gossip, `doc_tips` and
  `doc_have` by topic. Keeper frames are prefixed `keep_`. One shared bump to wire 3.
- **Why:** one fetch gate for readers and keepers, with every bound named.
- **Supersedes:** A122 (in part: items at most 64 KiB)
- **Lean or code then:** `Aven.Peer.Fetch` (#1722: `answer_bounded` with fetchHashes 128, partBytes 48 KiB, inFlight 1
  MiB).

### A134 · The wire moves to `aven-peer-wire`; `doc_tips`' keys
- **Decided by:** the architect, as thread E settled it with Docs in the Peers and catch-up and keepers (11:10)
- **Decision:** thread E moves the wire to `aven-peer-wire` and its Lean into `peer/spec` (branch
  `claude/peers-wire-split`). `doc_tips`' tip map keys are, in codec order, `seq`, `name`, `writer`. The frames are
  `doc_tips {more, tips, frame, topic}` and `doc_have {more, frame, topic, values}`.
- **Why:** the wire is the Peers' (A45), and every frame is a Value with exactly its keys (A29).
- **Supersedes:** —
- **Lean or code then:** `claude/peers-wire-split` (`6211e41f5`).

### A135 · The tree on the Doc host
- **Decided by:** the architect, as Docs in the Peers settled it with avenPEER (11:10)
- **Decision:** the tree supplies a `BuiltinFit` for `tree` and an `Authorize`. It settles on each Feed entry over
  `counted()`, and its topic joins first at start.
- **Why:** the tree is the first shared Doc on stage 3's interface (A112).
- **Supersedes:** —
- **Lean or code then:** none yet.

### A136 · Tips are log heads
- **Decided by:** the architect, approving Docs in the Peers' refinement (11:10)
- **Decision:** a tip is a log head, `{writer, seq, name}`, not a bare version tip. An envelope is left out when the
  tips tell: by name (Core's past), or by place (the one head of its log is further on, and the reader holds no split in
  that log). A held split sends its log whole by name, and a head at a place where the reader holds another envelope
  shows the split (`split_shows`).
- **Why:** with names only, a reader that doesn't know the other's newest tip (an offline commit) can't tell anything,
  so it would resend all of history.
- **Supersedes:** —
- **Lean or code then:** `Aven.Peer.DocSync` (#1727: `beyond_complete`, `sync_union`, `split_sent`, `split_shows`,
  `beyond_new`, `sync_moves`).

### A137 · Authorize judges an envelope on its own counted past
- **Decided by:** the architect (11:13), between the avenDB docs layer, avenID caps and avenPEER
- **Decision:** `Authorize::authorized` judges an envelope on its own counted past. As docs' `Authorize` has it (11:15):
  `authorized(genesis, e, body, past: &Past)`, where `Past` is every held envelope e reaches through prev and deps,
  which the import holds whole before asking (`Closed`); `reauthorize` passes the same past; rules about concurrent
  envelopes stay in the reader's settle.
- **Why:** an approval that depends on the owners in its past is judged on that whole past (A30), so two orders of
  import give one verdict.
- **Supersedes:** —
- **Lean or code then:** `aven-db-docs` on `claude/aven-docs` (`e7dd0910`).

### A138 · The decision log is append-only
- **Decided by:** Samuel (about 11:12: "Let's do it like that. Have a decision audit trial log markdown that just keeps
  the history trace immutable + plus a mutable architecture doc that is always update to its latest truth"), with the
  architect as the log's only writer (11:15, the check)
- **Decision:** `aven/DB2/DECISIONS.md` is avenDB's decision audit trail, beside a mutable architecture document: the
  log keeps the history immutable, and ARCHITECTURE.md with its chapters and the Lean is always the latest truth. The
  log only grows: no entry is edited or deleted, and a change of mind is a new entry that names the one it supersedes.
  `aven/ops/devx/decisions.mjs` checks it: the log at a branch's merge base must be an exact prefix of the log now, and
  `check.mjs` runs it whenever the log changes. The architect is its only writer; threads send their decisions to the
  architect.
- **Why:** the check's own words: "DECISIONS.md keeps the history trace immutable, and ARCHITECTURE.md is the mutable,
  latest truth."
- **Supersedes:** — (refines A125: the log has one writer)
- **Lean or code then:** `aven/ops/devx/decisions.mjs` and its test (`5fc77eba`, in #1730).

### A139 · Held and spent in caps' Keep
- **Decided by:** the architect (11:17)
- **Decision:** caps' `Keep` splits a vault's bill into what it holds and what it has spent. The sources keep only its
  name, "the 11:17 held/spent split in Keep", and the question it answered: catch-up and keepers asked at 11:15 whether
  a bill goes down when an item drops, since `Keep.lean`'s `spent` never decreases.
- **Why:** that question.
- **Supersedes:** —
- **Lean or code then:** `Keep.lean` (`spent`, `admit`).

### A140 · The Peer image takes its crates from one list
- **Decided by:** the architect, in the Peer image's hotfix (#1730)
- **Decision:** `deploy/tag.mjs` reads the workspace members from `Cargo.toml` and refuses a member the build context
  leaves out: the deploy has one list of crates.
- **Why:** main's Peer image broke when a new workspace member, aven-codec, was missing from its build context.
- **Supersedes:** —
- **Lean or code then:** #1730 (merged as `f7e1775b`).

### A141 · The keeper owns its bill and admission
- **Decided by:** the architect (11:25–11:40)
- **Decision:** the bill and admission are the keeper's (`Aven.Peer.Serve`). bill(v) is the bytes of held items whose
  earliest remaining uploader acts for v; admission is bill(v) + fresh ≤ quota(v); a moved bill only refuses new
  uploads. The gate is `Gate<D> { serves, quota }`: caps answers who may fetch or upload, and the quota from offers.
  A22's "the uploading vault pays" becomes "the vault of the item's earliest remaining uploader pays". Caps removes
  `bill`, `uploader_pays`, `spent`, `admit`, `quota_holds` and `admitted_served` from `Keep` after #1722 lands, so no
  concept is left without an owner in between.
- **Why:** the sources give none beyond A44: a keeper decides only about its own resources.
- **Supersedes:** A139; A22 (in part: "the uploading vault pays"); caps D21 (in part: "The uploading vault pays.")
- **Lean or code then:** `Aven.Peer.Serve` (#1722).

### A142 · The fetch proof's TLS exporter
- **Decided by:** the architect (11:25–11:40)
- **Decision:** the exporter is 32 bytes, with the label `EXPORTER-avenDB-fetch-1` and an empty context. The fetch proof
  signs `["avenDB fetch 1", {doc, exporter}]`.
- **Why:** a fetch proof signs the TLS exporter of the connection that serves (A44); its exact bytes were the keepers'
  open question.
- **Supersedes:** —
- **Lean or code then:** `served_current` in `Aven.ID.Keep`.

### A143 · Gossip per group, not per Doc
- **Decided by:** the architect (11:25–11:40)
- **Decision:** gossip runs per group, not per Doc (A9 item 13 stands), and the 10:48 approval of a per-Doc topic is
  withdrawn. A group's topic is `derive_key("avenDB topic 1", the group's epoch key)`, with the wire version mixed in.
  The cutover's groups: Maia City's members are the network member room (the tree, the chat), and each vault's own
  devices share the keyring's topic. `doc_tips {doc, tips, more}` and `doc_have {doc, values, more}` name their Doc.
- **Why:** A9's item 13 and K11 already decided one gossip topic per group, whose Docs' tips are announced there.
- **Supersedes:** A118 (the topic per Doc, independent of the wire version, and frames named by topic); A133 and A124
  (in part: `doc_tips` and `doc_have` named by topic); A134 (in part: the frames' keys)
- **Lean or code then:** none yet.

### A144 · After the cutover, a file's chunks are Doc Values behind the one gate
- **Decided by:** the architect (11:25–11:40)
- **Decision:** iroh-blobs serves only the first generation's chat files, until the cutover. After it, file chunks are
  Doc Values behind the one fetch gate (A22). Open for stage 6: serving large values over iroh-blobs with the proof
  bound to the authenticated endpoint id, measured on video.
- **Why:** a file is no special case: its chunks and chunk list are Values a file Record in a Doc names, kept and read
  as that Doc is (A22).
- **Supersedes:** A44 (in part: "iroh-blobs stays for files")
- **Lean or code then:** none yet.

### A145 · A limit follows its primitive's owner
- **Decided by:** the architect (11:25–11:40)
- **Decision:** a Call's params count and a Bound's values count are Core's limits; limits only caps uses are caps'.
  There is one `Hash.ofValue?`, and `Writes` is a named Rust trait.
- **Why:** one concept, one owner (A45).
- **Supersedes:** — (refines A73)
- **Lean or code then:** `Aven.Core.Limits`.

### A146 · The tree's setup is its root Record
- **Decided by:** the architect, confirming the avenDB docs layer's reading for avenPEER (11:25–11:40)
- **Decision:** the tree's setup (RP ID, coop, guardian, confirmers…) is its root Record, written by its first envelope:
  a built-in type whose fit takes it whole at birth and refuses edits. A change of a setting is a later `tree/1` op,
  settled by latest.
- **Why:** a genesis has exact keys (A81), so the setup isn't a genesis field.
- **Supersedes:** A11 (in part: the setup is no longer a field of the signed genesis statement); refines A68
- **Lean or code then:** none yet.

### A147 · Authorize is a function of the envelope and its counted past
- **Decided by:** the architect (11:25–11:40)
- **Decision:** Authorize = f(envelope, its counted past): docs' `authorized(genesis, e, body, past)`. Concurrency rules
  live only in the tree's settle; caps has no concurrency rule (A23).
- **Why:** the sources don't say.
- **Supersedes:** — (refines A137)
- **Lean or code then:** `aven-db-docs` on `claude/aven-docs`.

### A148 · "Public" means the network's members
- **Decided by:** the architect (11:45), from the ARCHITECTURE audit
- **Decision:** "public" means the network's members everywhere (caps D15), never everyone or the open internet. Rule
  15's "the public (everyone)" and A42's register, "readers are everyone", read as the members. A browser reads the
  register only once the door admits it; before that, the door's answers are all it needs.
- **Why:** caps D15 (Samuel, 30 Oct 2026): "There is no open, IPFS-style public: nothing is ever plain to the Aven
  Peer."
- **Supersedes:** A42 (in part: "a public Doc whose readers are everyone"); rule 15 (in part: "the public (everyone)")
- **Lean or code then:** none yet.

### A149 · A genesis stays exact; what a Doc refers to at birth is in its root Record
- **Decided by:** the architect (11:50), from the docs audit
- **Decision:** a genesis stays exactly `{nonce, pins, type, vault}`. What a Doc refers to at birth (a fork's origin, a
  period Doc's predecessor, the chat Doc's old chains) is in its root Record, written by its first envelope and fixed at
  birth, as the tree's setup is (A146).
- **Why:** exact keys and no defaults (A81).
- **Supersedes:** — (refines A81)
- **Lean or code then:** none yet.

### A150 · Checkpoints come after the cutover
- **Decided by:** the architect (11:50)
- **Decision:** checkpoints come after the cutover. When they come, a keeper, which can't tell a checkpoint from a
  segment, learns an item's kind and what it covers from the upload: the uploader's word, as covers are. Readers check
  every checkpoint by replay (A5). A checkpoint's form follows A30: `Signed` over `["avenDB checkpoint 1", body]` with
  sigs beside it, and no `by` or `sig` fields.
- **Why:** a blind keeper sees only `{commit, ct, doc, epoch, nonce}` (caps D13), and the seal's kind is only inside the
  AAD.
- **Supersedes:** — (refines A5)
- **Lean or code then:** none yet.

### A151 · A peer's Doc shelf
- **Decided by:** the architect with Docs in the Peers (11:29)
- **Decision:** a peer keeps a Doc's envelope bytes as blobs by hash, and two refs per Doc, each a Value's blob moved by
  compare-and-set: `doc-<id hex>-held` (the docs layer's held page) and `doc-<id hex>` (the head). The held page moves
  first, since the head is what it reopens to. A ref moved by a second writer is refused, never retried over.
- **Why:** one writer per ref, and a crash between the two moves leaves a Doc that still reopens.
- **Supersedes:** — (refines A128)
- **Lean or code then:** `docs::Shelf`, tests/doc_shelf.rs (#1727).

### A152 · A live gossip message
- **Decided by:** the architect with Docs in the Peers (11:29)
- **Decision:** a live gossip message is `{sealed: bytes}`, or `{hash: 32 bytes}` when the sealed envelope doesn't fit a
  gossip message (4096 bytes, iroh-gossip's default; up to 4085 sealed bytes go whole), read from exactly its one key.
- **Why:** an oversize envelope is fetched through the one gate instead.
- **Supersedes:** —
- **Lean or code then:** `Live.ofValue_value`, `Live.of_fits`, live.json, `docs::Live` (#1727).

### A153 · A keeper takes an upload when the bill doesn't grow
- **Decided by:** the architect with the keepers thread (11:31)
- **Decision:** a keeper takes an upload when the vault's bill after it is no more than its quota, or no larger than
  before. A vault pushed over its quota by a moved bill can always shed bytes (a covering segment) and never grow. The
  keeper computes the bill after the upload on a copy before committing.
- **Why:** with admission only on bill + new bytes ≤ quota, a vault over its quota could never upload the segment that
  shrinks its bill.
- **Supersedes:** — (refines A141)
- **Lean or code then:** `Aven.Peer.Serve`: `admitted_within`, `over_quota_sheds`; serve.json (#1722).

### A154 · Group topics, and what a group's topic carries
- **Decided by:** the architect with Docs in the Peers (11:33)
- **Decision:** a group's topic is `groupTopic wire key` = the BLAKE3 of the codec's `{key, wire}`, where `key` =
  `derive_key("avenDB topic 1", the group's epoch key)`. A group's topic carries `Live`, each read from exactly its
  keys: `{sealed}`, a loose envelope; `{doc, hash}`, an oversize envelope fetched through the one gate;
  `{doc, version}`, the BLAKE3 of the sender's tips sorted by their encodings. A member whose version differs runs
  `doc_tips {doc, tips, more}` and `doc_have {doc, values, more}` over aven/db/1, paged; no heads go on gossip. At the
  cutover the groups are Maia City's members, whose topic is `groupTopic(wire, the tree Doc's epoch key)` (the register
  is sealed to the members), and each vault's devices, with `groupTopic(wire, its keyring epoch key)`. When caps' groups
  exist, the members' group key replaces the tree's epoch key. A device joins the newest and the previous epoch's
  topics. The first generation's JSON room carries no Docs traffic.
- **Why:** one topic per group scales (A9's "Massive data" item 13), and mixing the new traffic into the first
  generation's room would tie the new path to the old.
- **Supersedes:** A152 (in part: `Live`'s form); refines A143
- **Lean or code then:** `group_topic`, `Live`, `version`, `GroupTopic`; topics.json (#1727).

### A155 · A sealed live message names its Doc once
- **Decided by:** the architect with Docs in the Peers (11:33)
- **Decision:** `{sealed}` carries no separate `doc`: the seal's outside names the Doc, and the docs layer refuses a
  seal whose `doc` isn't the Doc's (`Refused::Doc`). `{doc, hash}` and `{doc, version}` carry `doc`, because nothing
  else names it there.
- **Why:** a second `doc` beside the seal's would be a second source that could disagree.
- **Supersedes:** — (refines A154)
- **Lean or code then:** #1727.

### A156 · A device's keys, as built
- **Decided by:** the keys thread, merged by the architect (#1731, 11:33)
- **Decision:** a device's ML-DSA-65 ξ is `derive_key("avenID device ml-dsa 1", its Ed25519 seed)`, and its X-Wing seed
  is `derive_key("avenID device seal 1", its Ed25519 seed)`. Both are made in the device's own process, wiped after use
  and never exported, and nothing else is derived from the seed. They rotate together with the device key (D19), and a
  rotation reseals the keyring. Nothing trusts them until `device_hybrid_bound` holds.
- **Why:** a quantum attacker recovers the Ed25519 scalar, never the seed it was hashed from.
- **Supersedes:** A120 (the ML-DSA key generated); refines A130 and A132
- **Lean or code then:** `deviceMlDsaSeed`, `deviceSealSeed`, derivations.json; `HybridKey::from_device_seed`,
  `device_ml_dsa_seed`, `device_seal_key`; the Peer-Light's `deviceHybrid()`/`deviceSeal()`, the Peer's
  `keys::hybrid_public`/`seal_public` (#1731).

### A157 · Package names
- **Decided by:** Samuel (11:36: "regarding naming convention call them all like that avenDB, avenOS, avenSTORE,
  avenPEERS, avenOPS, aevnID, avenRUNTIME, avenDOCS etc ... avenACTORS")
- **Decision:** a package is named "aven" plus its name in capitals, in docs, in the brain and in talk. avenDB is the
  umbrella (`aven/DB2`); avenCORE (`core`, `codec`); avenID (`id`); avenCAPS (A160); avenDOCS (`db/docs`); avenOPS
  (`db/engine`); avenSTORE (`store`); avenPEERS (`peer`: Peer, Peer-Light, wire, gossip, keepers); avenRUNTIME
  (`aven/runtimes`); avenACTORS (`aven/actor`); avenOS (`os`); avenBRAIN (`brain`); avenSANDBOX (`sandbox`). Crate and
  folder names stay. The first generation (`aven-gen1`) gets no brand name; it goes at the cutover. Release artifacts
  keep their names (avenOS, the avenPEER image, avenSANDBOX).
- **Why:** one naming for every package.
- **Supersedes:** —
- **Lean or code then:** none.

### A158 · avenBRAIN is the architecture's one location
- **Decided by:** Samuel (11:36: "visualize all the architecture docs incl. the decisions logs into our brain in the UI
  as well. so BRAIN becomes the SSOT location where everything comes together")
- **Decision:** the architecture lives in `aven/DB2/brain/`, in the repo and in the UI (avenOS's Brain):
  `ARCHITECTURE.md` (the index: the whole on one page, the rules, packages and owners, the decision index with status),
  `DECISIONS.md` (this log), `GLOSSARY.md` (the one vocabulary), and one page per package, `<package>/README.md` (its
  story with slides, then its architecture, each concept once, with its decisions and its Lean). The brain renders these
  files themselves, never copies. The Lean stays with its packages, and every page names it.
- **Why:** one place to read everything, so nothing drifts into a second copy.
- **Supersedes:** A126 (in part: the chapters' location and the paths `aven/DB2/ARCHITECTURE.md` and
  `aven/DB2/DECISIONS.md`)
- **Lean or code then:** none yet.

### A159 · avenCAPS is its own package
- **Decided by:** Samuel (11:38: "also pull out avenCAPS from avenID as its own package ... CAPS should use the crypto
  signing primitives from avenID, but are standalone elsewise right?"), with the architect's reading
- **Decision:** avenID owns who is who: keys and signatures (hybrid, passkeys and the PRF, device keys), sealing
  (X-Wing, the seal, Padmé, epochs, the keyring), and vaults with their owners (k of n, governs). avenCAPS owns who may
  do what: the cap's form over ops and targets, chains and narrowing, revocation, collections, device, member, keep and
  offer caps, the gate's authority half, and the reader's `authorized`. avenCAPS uses avenID's signatures, vaults and
  owners' approval, and avenCORE's ops, targets and calls; nothing in avenID uses caps. The code split (`caps/spec`,
  `Aven.Caps`, crate `aven-caps`) comes later.
- **Why:** caps stand alone on identity's primitives.
- **Supersedes:** A45 (in part: "the tree … is avenID's")
- **Lean or code then:** none yet; the split is planned by the caps threads.

### A160 · The register is avenCAPS's
- **Decided by:** Samuel (11:40: "into avenCAPS, since almost every register act is a cap act")
- **Decision:** the register (`tree/1`: tickets, claims, confirms, sign-ins, settings) is part of avenCAPS.
- **Why:** almost every register act is a cap act (a ticket is a cap, a confirm issues a member cap, a claim carries a
  keep cap), and in avenID it would make avenID and avenCAPS depend on each other.
- **Supersedes:** — (completes A159)
- **Lean or code then:** today in `id/spec` (Network, TreeDoc, Restore, Admit); it moves with the split.

### A161 · Keepers' fetch keys and records
- **Decided by:** the architect, for minimal caps' keep module (11:42)
- **Decision:** fetch keys are Ed25519, with seed `derive_key("avenDB fetch key 1", the Doc epoch's key)`, so every
  reader of the epoch derives it. A forged proof yields only ciphertext sealed post-quantum; the risk that a quantum
  forger spends a vault's keeper quota is accepted. The proof's form, `["avenDB fetch 1", {doc, exporter}]`, is caps'
  (`fetchLabel`, `proofBody`), and `Aven.Peer.Fetch` cites it. Labels are frozen format strings, not package names, so
  caps' keep their "avenID …" prefix under avenCAPS. In Rust, aven-id's keep module is generic over the key and the
  verifier, and the `Gate` trait and its adapter live in aven-peer-keeper.
- **Why:** a keeper reads no caps, so it checks key proofs alone (A22).
- **Supersedes:** —
- **Lean or code then:** `aven_id::keep` (#1734), generic.

### A162 · A vault is named by 32 bytes
- **Decided by:** the architect, from Core's report (11:42)
- **Decision:** a vault is named by 32 bytes in every format, never by text: "v:alice" is a Lean example's convenience
  that leaked into Target, Facts and TargetCbor. avenID defines how a vault's name is made, and then Core, avenCAPS and
  the register switch in one step.
- **Why:** a name is a hash (A30).
- **Supersedes:** —
- **Lean or code then:** none yet.

### A163 · Who signs the keeper's records, and their exact shapes
- **Decided by:** the architect with caps Lean (11:41–11:42)
- **Decision:** the listing names each Doc's first fetch key, number 0. It is signed by a device acting for the keep
  cap's issuer vault, or by its owners k of n. A fetch link n ≥ 1 is
  `["avenDB fetch link 1", {doc, epoch, key, n, prev}]`: it names key n and is signed by key n−1; `epoch` is the epoch's
  name, and `prev` is the previous link's name, or for link 1 the listing's name, so the chain starts at the listing and
  holds no null. Caps' records are Signed things beside their sigs:
  - the listing: `["avenID keep listing 1", {cap, docs: [{doc, key}]}]`;
  - an order: `["avenID keep order 1", {act: "withdraw", cap}]` or `{act: "delete", doc}`, two exact shapes, by the same
    signers as the listing;
  - a choice: `["avenID keep choice 1", {branch, doc, fork}]`, by a device of the vault that issued the keep cap (A22).
  The proof is signed by the Doc's current fetch key. No record has a null or an optional key (A42).
- **Why:** exact forms with no optional keys.
- **Supersedes:** — (refines A161)
- **Lean or code then:** to come in caps' Keep PR, with keep-bytes.json.

### A164 · A vault's name comes from its own genesis
- **Decided by:** the architect with the keys thread (11:43)
- **Decision:** a vault's name is the A30 name of `["avenID vault 1", {kind, nonce}]`: 32 bytes, with a 32-byte random
  nonce. Its kind is exactly one of person, coop, agent or device; the guardian's vault is an agent; an unknown kind is
  refused. Nothing that changes is in it (owners, keys, epochs, the founding statement), so a vault's name never
  changes. Where each genesis is born:
  - the network's own vaults (Maia City's coop, Aven's vault, the guardian's vault): in the tree's root Record, with
    fresh nonces in production and fixed nonces in the cast;
  - a person's vault and their claiming browser's device vault: in their claim;
  - a device's own vault: in the sign-in that adds it;
  - a later vault: in its governing vault's statement.
  At the cutover, production's claimant signs the setup with fresh nonces. Display names stay a separate field.
- **Why:** one Value per vault, named by what it says; a statement that founds several vaults can't name them all.
- **Supersedes:** — (settles A162)
- **Lean or code then:** `Aven.ID.VaultName` (`vaultName_inj`, `vaultName_len`, `name_ignores_owners`), vaults.json;
  `aven_id::VaultGenesis` (#1738).

### A165 · The Claude Doc is superseded
- **Decided by:** Samuel (11:46: "this should be replaced by the new brain SSOT, right?")
- **Decision:** the Claude Doc "avenDB Full-Stack Architecture" (claude.ai/artifact/78u53Ds5HxnbRtr2Yqktmc) is
  superseded by avenBRAIN. It is frozen with a banner at its top, no longer updated, and deleted, with Samuel's OK, once
  Brain shows the architecture.
- **Why:** one source of truth (A158).
- **Supersedes:** —
- **Lean or code then:** none.

### A166 · A reader finds a keeper's item's kind by commitment
- **Decided by:** the architect with the keepers thread (11:47)
- **Decision:** a reader learns whether a keeper's sealed item is a loose envelope or a segment (the kind is in the AAD,
  D13) by commitment: the docs layer computes the commitment for each kind over `{aad, nonce}` in constant time, takes
  the one that matches, and refuses one matching none, all before decrypting. A keeper never carries a kind.
- **Why:** a keeper's word would be a second source the reader must check anyway.
- **Supersedes:** —
- **Lean or code then:** `Aven.ID.Seal`: `Distinct`, `kind_by_commit`, `kindOf_complete`, `kindOf_seal`; seals.json;
  `seal::kind_of`; `import_sealed_page` takes bare sealed bytes (claude/aven-docs).

### A167 · Rule 10 stays composed
- **Decided by:** the architect with caps Lean (11:47)
- **Decision:** Aven.Architecture's `rule10_quota` is restated over caps' `Books.quota` and the keeper's
  `admitted_within` and `over_quota_sheds`, and Gaps' rule 10 rests on them. When `Aven.Peer.*` moves into peer/spec,
  the architecture spec requires peer/spec. A composed rule never becomes uncomposed in a move.
- **Why:** the rules stay proven across the packages.
- **Supersedes:** —
- **Lean or code then:** in caps' Keep PR.

### A168 · Box checks run the real path
- **Decided by:** the architect (11:51)
- **Decision:** a box check never takes keys from cast config, and product code has no fixture path. Stage 3's box check
  signs Alice up with the box's PRF passkey stand-in (#1700) and makes her keyring Doc. It seals the test Doc (in
  Alice's vault, typed by a user type the cast defines) to Alice's and Bob's vaults through their keyrings, and carries
  it on the members' group topic from the tree Doc's epoch key. So it waits for the keyring Doc and the tree Doc.
- **Why:** a check that skips the real path proves nothing about it.
- **Supersedes:** —
- **Lean or code then:** none yet.

### A169 · Who implements Authorize
- **Decided by:** the architect with Docs in the Peers (11:54)
- **Decision:** avenDOCS defines the `Authorize` trait, `authorized(genesis, e, body, past)`. avenCAPS exposes one pure
  verdict over Core types (the genesis vault, the envelope with its sigs, its authority part `{acks, caps}`, the past
  view), held to authorized.json and member.json, and never implements docs' trait. avenPEERS writes the thin
  `impl Authorize` adapter in aven-peer. avenDOCS adds a minimal schema reader and `open_sealed_page`, the opening half
  of `import_sealed_page`, so the Peer-Light opens seals beside the keys and the docs worker sees only plaintext. The
  docs worker's unfit set is the ref `docs-unfit` in the Peer-Light's store, local only; the Peer-Light's store is the
  one writer.
- **Why:** if caps implemented docs' trait, avenCAPS would depend on avenDOCS, inverting the layers.
- **Supersedes:** —
- **Lean or code then:** none yet.

### A170 · The keyring's Records are write-once
- **Decided by:** the architect with the keys thread (11:56)
- **Decision:** built-in Records are write-once. The keyring Doc (`builtinType "avenID" "keyring"`) holds caps' built-in
  `epoch` Records. A rotation writes epoch n+1, with `prev` naming the old Record. A reseal, for a new device or
  passkey, writes another `epoch` Record of the same epoch, carrying only the new reader's stanza and padded to 4, with
  the same header and so the same `Epoch.name`. Opening an epoch tries every Record sharing its name. Adding a Record
  never removes an opening, and Records sharing a name share a header. The current epoch is the highest n reachable by
  `prev`, with the smaller name at a fork. Removing a reader is a rotation, never an edit. At sign-up, the Peer-Light
  computes the first `epoch` Record (n = 1, a fresh vault key, sealed to the device's derived seal key and the passkey's
  PRF seal key), and stage 3's Doc writer makes the keyring Doc.
- **Why:** a built-in Record can't be edited (`Aven.DB.Docs.Builtins`).
- **Supersedes:** A131 (in part: "a reseal rewrites the same Record")
- **Lean or code then:** to come: `Aven.ID.Keyring`, aven-id `keyring`.

### A171 · Threads never add A-numbers
- **Decided by:** the architect (11:58)
- **Decision:** a thread never adds an A-number or architecture prose. It sends its decision to the architect, who
  records it in this log and on its brain page.
- **Why:** the log has one writer (A138).
- **Supersedes:** —
- **Lean or code then:** none.

### A172 · A pinned schema lives in its type Doc's version Record
- **Decided by:** the architect with the docs thread (11:59)
- **Decision:** a type Doc's version Record is exactly `{at, name, schema}`, with `schema` = `Schema.value()` whole,
  passing `Schema.ofValue?`. A pin `(type Doc, h)` resolves to the version Record whose `blake3(encode(schema))` is `h`.
  Version Records are write-once built-ins, so a pinned schema never changes, and two version Records with one schema
  hash are one version. `Doc::open` keeps the version Records a pin names, and refuses a pin that resolves to nothing,
  by name.
- **Why:** a type Doc's Records are its versions, named by their schema's hash (A39).
- **Supersedes:** —
- **Lean or code then:** to come: `Aven/DB/Docs/Schema.lean`, `pin_resolves_one`, schemas.json.

### A173 · The keeper's byte forms, as built
- **Decided by:** caps Lean, recorded by the architect (12:01)
- **Decision:** the forms of A163, built as Core signed things (A30) with frozen labels. The byte vectors are in
  `id/spec/vectors/keep-bytes.json`, and keep.json keeps the model cases. Caps' half of the gate is exactly the
  fetch-key chain, `Keep.serves`/`served_current`, `Books.keeps` and `Books.quota`. Who pays, and admission, are the
  keeper's (`Aven.Peer.Serve`), and caps' bill, `spent` and admission leave Keep.
- **Why:** one owner per concept (A45).
- **Supersedes:** — (realizes A161 and A163)
- **Lean or code then:** caps' Keep PR, stacked on #1722.

### A174 · Bytes in JSON are `{"bytes": hex}`, as built
- **Decided by:** the architect, from avenCORE's Lean and vectors (12:11)
- **Decision:** JSON, the readable form, writes a byte string as `{"bytes": "<hex>"}`, lowercase, as `Aven.Core.Json`
  and every vector file already do. A hash is such a byte string of 32 bytes.
- **Why:** A2's `b3:` or base64url text was never built, and the vectors are the contract every implementation is held
  to.
- **Supersedes:** A2 (in part: "bytes as `b3:` or base64url text")
- **Lean or code then:** `Aven.Core.Json`, done.

### A175 · Versions are avenCORE's
- **Decided by:** the architect, for the avenCORE page (12:11)
- **Decision:** a version, a set of envelopes with everything they build on, named by its tips, is avenCORE's primitive
  beside logs and the past: `Version` and `Version.holds` in `Aven.Core`. avenDOCS uses it as a Doc's version. Snapshots
  and checkpoints stay avenDOCS'.
- **Why:** one concept, one owner (A45): a version is made of logs, which are Core's, and its Lean is already Core's.
- **Supersedes:** A1 (in part: the glossary gave "version" to docs)
- **Lean or code then:** `Aven.Core` `Version`, done.

### A176 · One padding for every sealed byte
- **Decided by:** the architect, holding caps D18 (Samuel, 30 Oct 2026: everything is padded) (12:12)
- **Decision:** one function pads every sealed thing a device sends, before sealing: up to 4 KiB, the next of 256 B, 1
  KiB and 4 KiB; above that, Padmé. The seal pads with it, so a live message, which carries a sealed envelope, needs no
  padding of its own. avenID defines it once, beside `Aven.ID.Padme`, and every user imports it.
- **Why:** D18 is Samuel's, and Padmé alone hides almost nothing in small messages; the seal, built with Padmé only,
  drifted from it. One function used once is rule 16.
- **Supersedes:** — (refines caps D18 and A93)
- **Lean or code then:** to come: avenID's `pad`, the seal's Rust and `seals.json`. Free while nothing stored is sealed.

### A177 · The seal names what it seals, and a checkpoint is a checkpoint
- **Decided by:** the architect, for the avenID page (12:12)
- **Decision:** the seal's field `kind` is renamed `seals`, with the values `envelope`, `segment` and `checkpoint`. The
  AAD is `encode({doc, seals, epoch})`, and the keys are `derive_key("avenDB <seals> 1")` and
  `derive_key("avenDB <seals> commit 1")`, so a checkpoint's labels are `avenDB checkpoint 1` and
  `avenDB checkpoint commit 1`.
- **Why:** "kind" is only a vault's, and what travels is a checkpoint, never a snapshot (A1). Renaming is free while
  nothing stored is sealed.
- **Supersedes:** — (applies A1 to the seal)
- **Lean or code then:** to come: `Aven.ID.Seal`, the seal's Rust, `seals.json`, with A176's change.

### A178 · A device's vault: its key signs, the vault it serves owns
- **Decided by:** the architect, from the 08:22 briefs and the Lean (12:12)
- **Decision:** a device has its own vault. Its key signs for that vault and governs nothing. The vault it serves is its
  one owner, the only one that may change or end it. What the device may do for that vault is its device cap.
- **Why:** rule 15's wording said the device's key also owns its vault, while the 08:22 briefs and the Lean (`WF`,
  `device_key_governs_nothing`) have one owner. A key that owned its own vault could keep it alive against the vault it
  serves.
- **Supersedes:** rule 15 (in part: "which its key owns")
- **Lean or code then:** `device_key_governs_nothing`, done.

### A179 · Threads keep their page's Status table current
- **Decided by:** the architect, writing avenBRAIN's working rule (12:13)
- **Decision:** a thread whose PR builds what a row of its package page's Status table lists updates that row in the
  same PR. Everything else on a page, and every log entry, stays the architect's (A171).
- **Why:** a page is the latest truth only if what is built shows the moment it lands; a row changed by the PR that
  builds it can't drift from the code.
- **Supersedes:** — (refines A171)
- **Lean or code then:** none; the rule is in `aven/DB2/CLAUDE.md`.

### A180 · Runtimes have no release of their own
- **Decided by:** the architect, for the avenRUNTIME page (12:14)
- **Decision:** a runtime ships inside what loads it: its frozen bytes are committed (A102) and go out in `@aven/os` and
  in the avenPEER image, each named by its hash. `aven/runtimes` gets no dated release of its own, and the manifest is
  its version list.
- **Why:** a module is named by its hash, so a separate release would add a second name for the same bytes;
  `avensandbox.yml` never made one.
- **Supersedes:** — (refines A36 for runtimes)
- **Lean or code then:** none; the runtimes README and `avensandbox.yml` already agree.

### A181 · A checkpoint carries a state, sealed as a checkpoint
- **Decided by:** the architect, for the avenDOCS page (12:14)
- **Decision:** a checkpoint's body names its Loro export under the key `state`, not `snapshot`, and that export is
  sealed as `checkpoint`, under the same Doc and epoch as the checkpoint that names it.
- **Why:** what travels is a checkpoint, never a snapshot (A1), and one seal for a checkpoint and its state leaves a
  keeper nothing to tell them apart by.
- **Supersedes:** — (applies A1 and A177 to checkpoints)
- **Lean or code then:** to come with checkpoints: `Aven.DB.Docs` checkpoint body, its vectors.

### A182 · A revocation discounts, as a split does
- **Decided by:** the architect, for the avenCAPS and avenCORE pages (12:16)
- **Decision:** Core's one counting rule takes a third parameter from avenCAPS, `revoked`: an envelope is discounted
  when the reader holds a counted revocation of a cap in its chain that has taken effect in that Doc (in the Doc itself,
  at its kept list, or at another writer's first ack, caps D8) and whose kept past doesn't hold the envelope.
  `authorized` stays a function of the envelope and its own past (A147). Like a split learned later, a revocation
  learned later discounts; every reader holding the same envelopes counts the same, and there is no settle order.
- **Why:** caps D8's race judges a write by what the reader holds, not by the write's own past, so it can't live in
  `authorized`; counting is Core's, and Core already discounts on what arrives later (`split_final`).
- **Supersedes:** — (places caps D8 within A147 and A23)
- **Lean or code then:** to come: `Counts nm fit authorized revoked` in `Aven.Core.Log`, `Aven.ID.Revoke` supplying
  `revoked`, `rule4_one_verdict` over the three.

### A183 · A cap is its content
- **Decided by:** the architect, for the avenCAPS page (12:16)
- **Decision:** a cap's body carries no nonce. Two grants with the same issuer, holder, lines and conditions are one cap
  with one name (A30), and revoking it revokes that grant.
- **Why:** an issuer that grants the same thing twice has granted it once; a nonce would let two names mean one grant,
  and a revocation of one leave the other standing.
- **Supersedes:** —
- **Lean or code then:** `Aven.ID.Caps`, as built.

### A184 · Built-in bodies carry no nulls
- **Decided by:** the architect, for the avenCAPS page (12:16)
- **Decision:** every built-in body (caps, revocations, passkey records, keeper records and the rest) leaves an absent
  field out of its map instead of writing null, and its decoder refuses a null. A user's Values may still hold null.
- **Why:** one byte form per meaning (A2): a field that is null or absent is two encodings of one thing, and the
  keeper's records (A173) already have exact shapes.
- **Supersedes:** —
- **Lean or code then:** to come: caps' cap, revoke and passkey-record formats and their vectors, free while nothing
  stored uses them.

### A185 · One owner for each of the pages' shared parts
- **Decided by:** the architect, settling the brain pages' overlaps (12:16)
- **Decision:** the shelf (`docs::Shelf`), the head and the held page, the judge and its crash mark are avenDOCS'. The
  Doc host, sifting (`Aven.Peer.Judge`), the docs worker's place in the browser and the fetch gate with its exporter are
  avenPEERS'. The tab's `update` switch and the list of the page's workers are avenOS'. Owners, thresholds and approvals
  are avenID's, and the register's owner-change op with its settling (`removal_beats`) is avenCAPS'. The `epoch` Records
  are avenID's. Each other page names these in a line and links.
- **Why:** one concept, one owner (A45): each goes where its code and Lean are.
- **Supersedes:** A170 (in part: "caps' built-in `epoch` Records")
- **Lean or code then:** none.

### A186 · No wiping in production
- **Decided by:** Samuel (30 Oct 2026, before the admin's sign-up), recorded by the architect (12:17)
- **Decision:** production has no way to empty its store. The deploy has no `wipe` input, and nothing else deletes the
  bucket's objects. From the first sign-up on, what production stores is kept: a change to a stored format reads the old
  one too, or migrates it in the peer, tested against the old format's vectors, and never asks for a reset. The box
  keeps its own wipe, since its data is test data.
- **Why:** people's vaults and history live there.
- **Supersedes:** —
- **Lean or code then:** the deploy workflow, as built; the cutover replays production's snapshot in the box (stage 7).

### A187 · The keyring Doc travels unsealed
- **Decided by:** the architect, on the keys and stage 3 threads' question (12:25)
- **Decision:** the keyring Doc's envelopes and segments are not sealed: its Records are already ciphertext (X-Wing
  stanzas, commitments, and the vault key sealed under the epoch key, all padded). A keeper sees the keyring's signers,
  writer ids, epoch numbers, counts and times, and nothing that opens anything. Every other Doc stays sealed. A new
  browser fetches the keyring's Records through the fetch gate by Doc id, opens its stanza with its PRF seal key, and
  only then joins its vault's group topic. avenDOCS gives this one built-in type a plain path beside the sealed one.
- **Why:** a new browser holds only its passkey's PRF output, so it must read the keyring before it has any key from it;
  a key from the keyring would be circular, and a per-reader segment key would repeat the stanzas for no secret they
  don't already keep.
- **Supersedes:** — (refines rule 9 and caps D13 for the keyring alone)
- **Lean or code then:** to come: the docs plain path (`Item::Plain`), the keyring's vectors; draft #1743 holds the
  keyring Doc.

### A188 · An actor host's envelope names its actor in its authority
- **Decided by:** the architect, on the caps and minimal caps threads' question (12:25)
- **Decision:** an envelope's `authority` is exactly `{acks, caps}`, or `{acks, caps, actor}` when an actor host writes
  it, naming the actor whose chain it writes under (A27). avenDOCS carries the Value whole and never reads inside it.
- **Why:** a reader must know which actor's chain to judge a host's write under, and A184's exact shapes leave an absent
  field out rather than null.
- **Supersedes:** — (refines A27)
- **Lean or code then:** `Aven.ID.Authority` in draft #1741, with the second shape added; caps' `reaches` follows as its
  own PR.

### A189 · Approvals are Core signatures, and Lean's vectors sign for real
- **Decided by:** the architect, on the caps and minimal caps threads' question (12:25)
- **Decision:** a cap's approvals are Core `Sig`s, `[{signer, sig}]`, over the cap's signing bytes (A30); an owner key
  approves by a valid sig, a vault by its quorum. Lean's vectors carry real Ed25519 signatures (RFC 8032, deterministic,
  pinned by its test vector 7.1 test 1), made only with the cast's published test keys; Rust verifies them and re-signs
  byte for byte. `verify` is a parameter of every theorem, and production verifies hybrid signatures (A43).
- **Why:** a stand-in can't catch a wrong message, label or key in the Rust, and a real signature does; the test keys
  are public, so Lean still holds no secret.
- **Supersedes:** —
- **Lean or code then:** to come in one PR, caps' Lean and vectors with minimal caps' Rust.

### A190 · Core names vaults by plain 32 bytes
- **Decided by:** the architect, on the core and keys threads' report (12:25)
- **Decision:** a vault in any format is its 32-byte name, never text. Core's vectors use plain 32-byte names (32 zero
  bytes is the type of types' vault); how a name is made (A164) appears only in avenID's vectors. The switch is one
  step: Core's PR, carrying the mechanical edits to every Lean it breaks (the engine's `Query.lean` included), and
  avenID's PR for caps and id, merged back to back.
- **Why:** one name per vault everywhere (A162), and a build that is never left broken between the two.
- **Supersedes:** — (refines A162)
- **Lean or code then:** `claude/aven-core-logs` (a6eb2282), then avenID's PR A.

### A191 · A removal never undoes finality
- **Decided by:** the architect, on avenPEER's question (12:25)
- **Decision:** an owner removal beats only acts that no final claim rests on: whatever is in the past of a counted
  confirm stays, as a withdrawal never beats a final claim. Owner changes are judged on Core's `Counts` with `Closed`,
  so `setOwners`, `owners_perm` and `removal_beats` come with that, after k of n by stored thresholds.
- **Why:** a removal racing a ticket must not reopen a member's join, and "the owners in force in its own past" is
  monotone only once a statement's whole past is held.
- **Supersedes:** — (refines A116)
- **Lean or code then:** to come: avenPEER's PR 2 (`removal_beats`, `settle_final`).

### A192 · markdown-runtime v3: links resolve against their document
- **Decided by:** the architect with the runtimes thread (#1737)
- **Decision:** a link in a Markdown document resolves inside the runtime, lexically (RFC 3986's `remove_dot_segments`,
  `..` clamped at the root); an href with a scheme is never resolved; a query and a fragment are kept; a fragment-only
  href gets the document's `idPrefix`. The document's owner supplies `base`, `idPrefix` and the prefix `links` rules,
  and the runtime knows no repository. A soft break is `" "`, a table's header cell carries `scope="col"`, heading ids
  carry `idPrefix`, and old frozen versions stay loadable and answer as they always did.
- **Why:** what a link in a Markdown document points to belongs to Markdown (A45), and one renderer for every page.
- **Supersedes:** —
- **Lean or code then:** `Aven.Runtime.Markdown` (`removeDots_no_dots`, `linkTo_link`), markdown-runtime v3, in draft
  #1737.

### A193 · Peer records are avenPEERS'
- **Decided by:** the architect, on the caps thread's question (12:25)
- **Decision:** address, log-tip and release entries, their split rule and their Lean are avenPEERS'. `Aven.ID.Records`
  moves to `peer/spec` as `Aven.Peer.Records`, each entry a Core log entry of its signer, counted by Core's `Counts`.
- **Why:** one concept, one owner (A45): the Peers made them and use them, and Core already counts logs.
- **Supersedes:** —
- **Lean or code then:** to come: thread E, after the wire split (#1745).
