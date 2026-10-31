# Global architectural contradictions (31 Oct 2026)

Read-only audit for Samuel's goal: "an audit of global architectural contradictions, and resolve them".

**Anchor: origin/main `bea34b5e`** ("avenBRAIN: the glossary's verdicts are decided (A1) (#1672)"). Main moved twice
while this audit ran (`c7b50743` → `7e57b63f` → `bea34b5e`: A30 in Core #1666, A38 decided #1665, A28's lists and
genesis settings in Lean #1671, caps' Docs typed #1669, A41, the glossary's verdicts decided #1670/#1672). Every
finding below was re-checked on `bea34b5e`, and every `file:line` points into it. Paths are under `aven/DB2/` unless
they start with `aven/actor` or `aven/runtimes`.

The 31 Oct audits (`audits/terms.md`, `principles.md`, `vaults.md`) were read first. What they hold is not repeated;
the section "Known items" at the end says where each stands now. Everything in "Findings" is new, or is a contradiction
those audits left unresolved and which newer text or Lean now contradicts again.

Classes: **(a)** already decided elsewhere, only text or Lean to fix; **(b)** the architect can resolve it under
existing rules; **(c)** needs Samuel, with the plain question.

---

## Findings, ranked by impact on correctness and security

### 1. MaiaCityGuardian approves Maia City's admin acts on its own (security, c)

**Statements**
- `id/spec/Aven/ID/Network.lean:167-171`: the claimant's vault is owned by its passkey and MaiaCityGuardian's vault,
  which its one key owns; `:527-528` `byAdmin` checks `g.tree.approves (fun _ => 1) g.coop …` with one signature;
  `:1155-1158` `admin_by_owners` concludes `k = gs.passkey ∨ k = gs.guardian.ed25519`. So the guardian's key alone
  issues tickets, withdraws them, sets the relay and keeper lists, and (new in #1671) changes the Aven Peer's key,
  avenOS's origins and the guardian setting (`:598` `latest`, `configBy`).
- `Network.lean:583-591` `ownerKeyOf`: the guardian's key signs devices into the claimant's vault and every vault a claim
  founds, with no delay; a device it signs into Samuel's vault is an `acker` (`:530-540`) and finalizes claims.
- Against: `PRODUCTION.md:36` "The master recovery key … the way back in beside the passkeys"; `README.md:200-201`
  recovery is "guardian vaults that can replace a vault's owners, after a delay in which the owners can cancel";
  `id/caps/README.md:224` rule 30 (the guardian is the one-key exception to *recovery*); `:907` the end state (recovery
  owners act after a delay); `ARCHITECTURE.md:661-664` (A12) and `PEERS.md:80-81` (decision 12's reason: admin acts
  are "a tap each time" of the admin's passkey, so nothing else lets anyone in).
- Consistent with it: `id/caps/README.md:1180` D12 "a full owner", `:889-890` "any one owner is enough",
  `PEERS.md:76-77` "Owner keys are passkeys and MaiaCityGuardian".

**Why both can't hold.** D12 makes the guardian a full owner at k = 1, and the tree's approval recursion turns that into
the network's admin. Every statement of its role says recovery. In running code it is one classical Ed25519 key
(`vaults.md` V1), so "a tap of the admin's passkey each time" is not the only way in.

**Resolution.** One primitive the specs already define: a **recovery owner**, an owner whose approval counts only after
a delay in which the other owners can cancel (`id/caps/README.md:907`, `README.md:200-201`). MaiaCityGuardian becomes
the first recovery owner of each person's vault. `Tree.approves` skips recovery owners inside their delay, so it never
approves an admin act or a sign-in at once, and recovery keeps working.

**Class (c).** Question for Samuel: *During evaluation, should MaiaCityGuardian be able to approve Maia City's admin
acts and add devices to any vault at once (D12's "full owner"), or only recover a vault after a delay its owners can
cancel?* Owner: caps (D12, `Approve`), avenPEER (Thread A, `Network`).

### 2. The owner key can be derived outside the safe (security, c)

**Statements**
- `ARCHITECTURE.md:132-133` rule 13: "Keys live only in the safe … Pages, actors and files never hold them, and no
  origin that serves files or other code is the safe's origin."
- `id/caps/README.md:923-927`: the PRF input is guessable, "any origin the passkey's RP ID covers could ask for the same
  output", and the owner key (`avenID owner 1`) is derived from that output.
- `ARCHITECTURE.md:667-670` A14 "Decided: no", which dropped both the dedicated RP ID and the salt the vault holds.
  `ARCHITECTURE.md:256` still lists the attack as "open". `ARCHITECTURE.md:671-676` A15: three origins, all served for
  `maia.city`.

**Why both can't hold.** WebAuthn hands the PRF output to whichever origin under the RP ID asks. With a guessable input,
a script on avenOS's app origin or on the files origin gets the output after one tap and derives the hybrid owner key
itself. Samuel's owner key governs Maia City, and so the network. Origin separation protects device keys only.

**Resolution.** Two options. Either the PRF input mixes in a secret only the safe holds (A14's salt, without the new RP
ID), so the owner key can only be derived in the safe. Or rule 13 says it covers device keys only, and attack 2 is
accepted in so many words.

**Class (c).** Question: *With A14 declined, may the safe mix a secret into the PRF input (A14's second half, no new RP
ID), or does rule 13 exclude owner keys?* Owner: caps.

### 3. Three Docs must be readable outside their members, and rule 9 allows one (security and privacy, c)

**Statements**
- `ARCHITECTURE.md:70` an envelope is "always sealed to its readers; a public one to the network's members";
  `:124-125` rule 9: "The city-dome's plain history … is the one exception"; `id/caps/README.md:228-229` rule 33 and
  `:1195-1197` D15: "nothing is ever plain".
- **The tree** is a Doc (A12, A34 "the first Doc"), yet `id/caps/README.md:1052` says keepers *and their storage
  (Hetzner)* see "the tree: vaults, owners, devices, network members and public keys, because the door needs them". A
  newcomer's claim is a write to it before it can hold its key, against `id/caps/README.md:164` rule 8 ("Write needs
  read").
- **Release records** are envelopes in the release vault's Doc (`ARCHITECTURE.md:752-755`, A36). Every Service Worker
  checks them before code activates (`:673`, A15; `PEERS.md:336`), including a fresh browser that holds only an invite
  link (`PEERS.md:115`) or a returning member's new browser before its passkey sign-in.

**Why both can't hold.** If those Docs are sealed to members, the browser that is joining or signing in, which is
exactly where the passkey and its PRF are used, runs code it cannot check, and the door cannot read the tree without
being a reader. If they are plain, rule 9 has three exceptions, not one.

**Resolution.** Add one primitive, the **plain Doc**: signed and typed, not sealed, readable by anyone who holds its
id. Rule 9 then names its members exactly: the city-dome's old history, the network tree and the release vault's Doc.
The invite link already carries the tree's tips and the genesis hash (`PEERS.md:115`); it also carries the current
release record.

**Class (c).** Question: *Are the network tree and the release records plain (signed, unsealed) Docs, making them rule
9's second and third exceptions?* Owner: architect (rule 9), caps (D15), avenPEER, thread E.

### 4. A tree statement has one signer, so k of n and governance can't be expressed (security, b)

**Statements**
- `Network.lean:245-250` `TreeStatement` has one `signer`. `:527-528` `byAdmin` approves with `[⟨k, stmtDigest⟩]` at
  threshold `fun _ => 1` over `g.tree`, the genesis's fixed tree. `TreeSays` (`:214-241`) has no statement that adds or
  removes an owner, sets a threshold or removes a device. `Caps.lean:291` and `Keep.lean:585` default every threshold
  to 1.
- Against: `PEERS.md:73-79` decision 12: "k of n through the vaults that own it … A second admin, an owner change or
  recovery is ordinary governance of the vault, with no new genesis"; `ARCHITECTURE.md:687-688` the same;
  `ARCHITECTURE.md:702` "each vault stores its own threshold k"; `id/caps/README.md:150` rule 2 (owners change owners,
  devices, thresholds, k of n).

**Why both can't hold.** With one signature per statement, k > 1 never approves, and owners are read from the genesis
alone. So a second admin, an owner change or recovery all need a new genesis, which decision 12 says they never do.
`vaults.md` (root causes 1 and 3) found the missing governance; #1656 and #1671 then wrote text claiming it is there.

**Resolution.** One primitive. A30's "signatures beside" a signed thing are D14's approvals. Every tree statement is a
Core envelope carrying a list of signatures over its name. `byAdmin` becomes `approves (k stored in the vault) coop
name sigs` over the *settled* tree: the genesis plus governance envelopes (owner added or removed, threshold, device
added or removed), each approved by that vault's current owners. Sign-ins, settings and owner changes are then one kind
of statement: a vault's governance act.

**Class (b).** Owner: avenPEER (Thread A) with caps (`Approve`, `Tree`).

### 5. Who confirms a claim: four answers (a, plus one part b)

**Statements**
- Decided: `ARCHITECTURE.md:758-761` A38: "The confirm op Aven holds under Maia City's cap issues the member cap".
  `:697` A28: "a claim is final by a vault's grant, not an admin device's ack".
- Still the other way:
  - `Network.lean:530-540` `acker` (any device of a vault that owns Maia City, by position), `:555` `final`, and the
    header `:26-27`;
  - `PEERS.md:47` (decision 5), `:78-79` (decision 12), `:209-213` (settle rules 3-4), `:221` (the door from the
    roster), `:273` ("a later grant … stays a decision for later"), `:375` (Thread B) and `:429` (Open);
  - `ARCHITECTURE.md:656, 661-662` (A12), and `id/caps/README.md:473`;
  - `brain/GLOSSARY.md:404`, which calls the admin device "a device of the admin's vault", against `Tree.lean:4-5` and
    `id/caps/README.md:427` ("a coop holds no devices").
- (b) part: under A38, membership is the member cap the confirm issues, yet `PEERS.md:266-268` says a new member "works
  fully" before the confirm.

**Why both can't hold.** Acting for Maia City because a device belongs to a vault that owns it is privilege by
position, against rules 7 and 15. A38 names Aven's cap as the one way. Before the confirm there is no member cap, so a
claimant can't be admitted as a member until then.

**Resolution.**
- A38 wins. A confirm is a write in the tree Doc under the cap Maia City granted Aven's vault. `acker` and the admin
  device go.
- For the gap before the confirm, A28's decided ticket is the primitive: the ticket is a cap from Maia City to the vault
  its claim founds, so the claim makes the claimant hold it and be admitted provisionally, and the confirm makes the
  membership final (issuing the member cap). A withdrawal still wins over a claim that isn't confirmed.

**Class (a)** for the text and the Lean; **(b)** for the provisional membership. Owner: avenPEER (Threads A and B),
caps, avenBRAIN (glossary).

### 6. MaiaCityGuardian is both a vault and a key, and `setGuardian` reaches up into person vaults (security, b; new in #1671)

**Statements**
- `Network.lean:156, 167-171`: the genesis names `guardianVault`, which owns the claimant's vault.
- But `:544-548` `claimOk` still requires every claim to name the genesis's guardian *keys*, whatever the setting
  says; `:583-591` `ownerKeyOf` makes the guardian's Ed25519 key a direct owner key of the claimant's vault and of every
  vault a claim founds; and `:171` gives the guardian's vault the kind `.agent`, against `brain/GLOSSARY.md:50`
  ("agent: … software principals … Only this meaning").
- `PEERS.md:190-196`: Maia City's owners change "MaiaCityGuardian's vault", "which owns each person's vault".
- Against: `id/caps/README.md:150` rule 2 (only a vault's own owners change its owners); `:896` (the exit is "one act
  per vault"); `README.md:106` ("Authority runs only down"); A13 (each person consents to the guardian their own claim
  names).

**Why both can't hold.** If `setGuardian` changes the vault that owns each person's vault, Maia City governs vaults it
doesn't own. If it only changes which guardian new claims must name, `claimOk` ignores it. Meanwhile the key is still an
owner beside the vault, against rule 15.

**Resolution.**
- The guardian is a vault everywhere. Claims name the guardian's vault and its owner set's fingerprint, as `vaults.md`
  V1 proposed.
- `setGuardian` changes only which guardian new claims must name: `claimOk` reads the setting, not the genesis.
- An existing vault drops or replaces its guardian by its own owners' act (D12's exit).
- The guardian's vault takes a kind that isn't `agent`.

**Class (b).** Owner: avenPEER (Thread A), caps.

### 7. Release records follow three models (security and availability, b)

**Statements**
- `id/spec/Aven/ID/Records.lean`:
  - `:65-70` a release is taken if signed by any key in `releasers`;
  - `:19-22` (A31) it is history in "its signer's own log", but `:82-91` keys that log by release line, not by signer;
  - `:172` `split_final`: two records at one counter freeze the line forever (example `:223-232`).
- `ARCHITECTURE.md:709-711` A31: "the newest the latest" in its signer's log.
- `ARCHITECTURE.md:752-755` A36: one record per package, *ordered by its dated version*, an envelope in the release
  vault's Doc, approved by its owners.
- `PEERS.md:315` and `:333-336`: one record per *release*, naming avenOS's build *and* the Peer's binaries, signed by
  "the release signers".
- `SANDBOX.md:413-417` and `README.md:152`: per package, version `26.10.29`, `26.10.29v2`, restarting each day.
- `ARCHITECTURE.md:130-131` rule 12: time is never used for order.

**Why both can't hold.**
- Per release and per package disagree.
- A dated version is a time claim used as the order, against rule 12.
- Two signers at one counter, or one stolen release key, split the line, and under `split_final` no release ever counts
  again for any reader, so security fixes can't ship.
- A single releaser key is what A36 replaced with owners' approval.

**Resolution.**
- One release record per package, an envelope in the release vault's typed Doc, with its owners' approvals beside it
  (A30, D14).
- Its order is its place in that Doc's history (rule 2). The dated version is a label whose fit rule requires it to grow
  within the package.
- Each record names the wire version it speaks and the hashes of what it loads (avenOS naming the Peer-Light).
- The `.release` record kind leaves `Aven.ID.Records`.

**Class (b).** Owner: thread E, avenPEER (Thread A, `Records`), architect (A36's text).

### 8. Is a device a vault or a signer? (security, c)

**Device vaults**
- `id/caps/README.md:1150` D2: "A device is a vault, so 'a narrower cap for one device' is a cap its device vault holds";
  `:427-436` (the Holders section, and the actor host "a narrow device vault").
- `Caps.lean:222` "(devices are vaults)"; `Tree.lean:9-20` `Kind.device`; `Authorized.lean:64-65` (the device cap is "a
  cap from that vault to the device's own vault").
- `ARCHITECTURE.md:82, 268, 788`; `README.md:103-104, 191-193`; `SANDBOX.md:71`.
- The slides: `brain/id/slides/acts-for.md:3` ("A device has a vault of its own … Its device key signs for it") and
  `vault.md:6-7` (four kinds).
- `brain/GLOSSARY.md:21, 391`, decided under A1 since #1670.

**Signers**
- `ARCHITECTURE.md:136-139` rule 15 (a key "signs for a vault … as its device within its device cap; caps delegate
  between vaults, never between signers").
- `id/caps/README.md:93` and `:148-149` rule 1 ("A device signs for the vault it serves").
- `brain/GLOSSARY.md:14`.
- `Authorized.lean` `Reader.vaultOf`: the vault the device serves.

**Why both can't hold.** The slide has the device key sign for its own device vault, while rule 1 and the Lean have it
sign for the vault it serves. A cap held by a device vault is a cap held by one signer. A27's host signs as "a device
vault of its own" (`ARCHITECTURE.md:788`), yet `ByChain` needs the chain's last cap held by the signer's vault, which is
Aven's (`:792`).

**Resolution.** A device is a signer of exactly one vault. Its device cap is that vault's signer scope, set by its
owners at sign-in, and it never holds a cap. A device that must read less than its vault (attack 14, an actor host)
becomes an agent vault owned by its person's vault, with a device of its own, as the Aven Peer already is for Aven.
`Kind.device` goes.

**Class (c)**, because D2 and A1's glossary verdict are Samuel's. Question: *Is a device a vault (D2), or only a signer
of the vault it serves (rule 15)? Recommended: a signer, with a narrow device becoming an agent vault.* Owner: caps,
actors (A27), avenBRAIN (slides, glossary).

### 9. A directory entry "in the same commit" spans two Docs (correctness, b)

**Statements**
- `db/docs/README.md:732-735` and `ARCHITECTURE.md:428-429`: whoever creates a Doc or changes a field an index sorts by
  adds its entry to the directory "in the same commit". `db/spec/Aven/DB/Docs/Directory.lean:7-9` and `Dir.commit`
  model it so; `listed_now` and `same_entries` rest on it.
- Against: `db/docs/README.md:52, 58` and `:202` rule 6 ("One envelope is one commit: one device, one Doc");
  `db/engine/README.md:124` rule 11 and `:545` D11 ("A promise across documents would need coordination the network
  doesn't have"); `ARCHITECTURE.md:439-441` (A26: "a missing entry … only someone who may write the directory could
  cause it").

**Why both can't hold.** The write to Doc X and the entry in directory D are two envelopes. A writer whose cap covers
X's sorted field but not D can change the field without marking it, so `listed_now` fails, `complete` overstates, and
A26's bound on the harm is wrong.

**Resolution.** Two envelopes, made safe by caps:
- The footprint of a write that creates a Doc or changes a sorted field includes the directory's `entry` Record, so
  only someone who may write the directory can make it, as A26 says.
- A fold names each Doc at the version it read, so a missing entry shows as unfolded to any device holding that Doc.
- `Directory.lean` models two commits.

**Class (b).** Owner: docs, engine.

### 10. Runtime floors against pinned hashes (correctness, b)

**Statements**
- `aven/runtimes/README.md:111-113` and `aven/actor/ARCHITECTURE.md:177-178`: a part naming a version older than the
  floor "runs on the floor"; `aven/runtimes/spec/Aven/Runtime/Contract.lean:129-130` `resolve = max floor named`.
- Against: `ARCHITECTURE.md:216` K7 ("a lowering is pinned by its hash and every reader re-lowers alike");
  `ARCHITECTURE.md:815-816` A18; `id/caps/README.md:564` step 9 ("a named operation is re-lowered, and the change must
  be what it produces"); rule 4's `readers_agree`.

**Why both can't hold.** Floors rise with releases. A reader whose floor rose re-lowers an older envelope on a newer
version and can get other steps, so two readers holding the same past disagree. If readers use the named hash instead,
the floor protects against nothing that others write.

**Resolution.** Floors become A7's pins. A runtime version is a version of a type (K5, K7), and a hole is closed by
withdrawing the pin by the owners' act, in history. A verdict re-lowers with exactly the hash the envelope names and
judges the pin at the envelope's past. A floor then binds only what a device runs for itself (renders and caches).

**Class (b).** Owner: runtimes, engine, docs.

### 11. Collections (A32) against the target grammar, rule 6 and revocation (correctness, b)

**Statements**
- `ARCHITECTURE.md:716-725`: targets are over birth facts; "a Doc (with what it … lists)"; "the vault's devices run the
  query … and sign each change to the list"; coverage changes "never because someone edited a tag".
- `core/spec/Aven/Core/Target.lean:20-24` `Facts` (id, vault and type only), `:39-44` `covers` reads `Facts` alone.
- `README.md:40` rule 6 ("Catching up only reads. Only a person's or an agent's act writes"); `db/engine/README.md:131`.
- `id/caps/README.md:176` rule 14 (a revocation wins over what it hadn't seen); `ARCHITECTURE.md:763-766` A40.

**Why both can't hold.**
- Whether a collection lists a Doc is not a birth fact, so `covers` can't decide it.
- Devices that update the list as they sync others' tag edits write while catching up, and coverage changes because
  someone edited a tag.
- When a Doc leaves the list, which writes under the cap still count is unspecified.

**Resolution.**
- An actor of the sharing vault maintains the list, under a standing cap its owners approved, so each change is an act.
- The list's entries are Records of the collection Doc. `covers` takes `listed` as a parameter, as it takes `spawned`,
  resolved at the envelope's past.
- An entry's removal is a revocation for that Doc (rule 14, kept list and acks).
- A32's sentence becomes "only by a signed act of the issuer's vault".

**Class (b).** Owner: architect (A32), caps, Core (`Target`), engine.

### 12. Address records with no generation: one split pins a device's address forever (availability, b)

**Statements**
- `Records.lean:19-22` and `:55-63`: an address is history keyed by the device. `:172` `split_final`; the example
  `:216-229` leaves Alice's address at place 1 forever.
- `PEERS.md:107-110`; `PEERS.md:85-88` and `Node.lean` `relayEndpoints`: a vault's relay URL comes from the newest
  address record.
- Against: `ARCHITECTURE.md:106-108` rule 3 ("a device that lost its log starts a new one"); `db/docs/README.md:170,
  222, 491` (a generation after a split); `ARCHITECTURE.md:71` (a log is in "one Doc and branch").

**Why both can't hold.** A device that loses its state but keeps its key (rule 13) restarts at counter 1. Its records are
then never newest, or they collide at a place and split, which is final. Its address, and its vault's relay endpoint,
freeze, and there is no generation to move to. The address log also lives in no Doc.

**Resolution.** Address records are envelopes in the tree Doc (A34's first Doc), one log per device and generation, as
every Doc has. A split ends a generation (docs rule 14).

**Class (b).** Owner: avenPEER (Threads A and C).

### 13. Log tips count as beats, yet they decide whom to trust (correctness, b)

**Statements**
- `ARCHITECTURE.md:709-711` A31: beats "decide nothing".
- `Records.lean:22` ("Presence and tips are beats … the latest counter is all that matters") and `:77-79` (at one
  counter, the smaller body wins).
- `id/spec/Aven/ID/CatchUp.lean:3-11`: a source whose copy falls short of the signed tip, or differs from it, is
  `caught`.

**Why both can't hold.** The tip decides which source is honest. Two tips at one number are a split of the log itself,
which A4 makes final, but as a beat the smaller body wins and the source that holds the other side is branded a
forger.

**Resolution.** A log tip is not a record. It is the name of the log's newest envelope (A30) at its place, and two at one
place are the log's split. Only presence stays a beat.

**Class (b).** Owner: avenPEER (Thread C).

### 14. The presence counter is the clock step (b)

**Statements**
- `CatchUp.lean:14-15` (a beat's "counter [is] the clock step"), `:86-87` (`present` holds while `now ≤ counter +
  window`).
- `ARCHITECTURE.md:749-751` A35 ("ordered by its counter, its time a claim").
- `PEERS.md:118`: a counter *and* a clock step.
- `PEERS.md:167`: a keeper "leaves" after 7 days without a beat.

**Why both can't hold.** One beat dated far ahead stays newest and "present" forever and hides every later beat. A keeper
that sends one never leaves. If leaving changes anything, a beat decides something, against A31.

**Resolution.** A beat carries its counter and its claimed step apart. Presence is how long ago this peer received the
newest beat, by its own clock, never an input to any verdict. `PEERS.md:167` only shows a notice.

**Class (b).** Owner: avenPEER (Thread C).

### 15. A39 has no base case, and several Docs have no stated type (b)

**Statements**
- `ARCHITECTURE.md:736-739` and `id/caps/README.md:128-135`: `keyring`, `safe`, `group`, `cap`, `revoke` and `epoch`
  are type Docs, and "a type Doc's own type is the type of types".
- `db/docs/README.md:594-595`: built-in types by bare name. `:175-176`: a type id is `<type Doc>/<schema hash>`, "the
  one way a version is named anywhere". `core/spec/Aven/Core/Names.lean:43`: a Doc is named by the hash of its
  genesis.
- No root type is stated for the network tree (PEERS §5), the carrier Doc (A33), the release vault's Doc (A36), the
  directory Doc (`db/docs/README.md:731`), a collection (A32) or the vocabulary and profile (`:262`).
- An actor's Doc has two answers: one schema `(def, state, journal)` (`aven/actor/ARCHITECTURE.md:497`) against "its
  root type is the definition's type Doc" (`Target.lean:35-36`).
- A39 lists "a catalogue" (`ARCHITECTURE.md:738`, `brain/GLOSSARY.md:367`), a word the vocabulary replaced
  (`GLOSSARY.md:184, 354, 494`).

**Why both can't hold.** The type of types' genesis would have to name its own id, the hash of that same genesis: a fixed
point that can't exist. The bare built-in names aren't type ids.

**Resolution.** `Facts.type` becomes a type reference with one reserved id per built-in type (fixed bytes, such as the
hash of its label, never a genesis hash), the type of types among them. One table in A39 names every Doc kind's root
type, and each spec owner fills its row.

**Class (b).** Owner: docs and Core, then each part's owner.

### 16. The carrier Doc: one vault or two, its birth, its topic, and caps' letters (b)

**Statements**
- `ARCHITECTURE.md:740-744` A33: "the carrier Doc of its two vaults … born with the first letter through the
  letterbox … live by the pair's gossip".
- `aven/actor/ARCHITECTURE.md:627`: one Doc per pair, "written only by the sending vault's home device".
- `id/caps/README.md:457-458` and `aven/actor/ARCHITECTURE.md:502`: the inbox A→B "belongs to A's vault … comes into
  being when B's vault grants A a tell cap".
- Against: `db/docs/README.md:151, 260` (a genesis fixes one vault); `ARCHITECTURE.md:220` K11 and `:361-362` ("Gossip
  per group, not per Doc"); `id/caps/README.md:173, 527-535` (later letters by pairwise tags).

**Why both can't hold.** A Doc has one vault. It is born at two different events. A topic per pair is neither per group
nor allowed per Doc. And after A33, caps' later letters still run beside the carrier as a second channel between the
same two vaults (`principles.md` item 13 merged only actors' messages).

**Resolution.**
- The carrier A→B is a Doc of A's vault, of the type `carrier`, read by B and born with A's first message. Its key
  reaches B in the one first-contact letter, through B's letterbox.
- Every later letter (caps, keys) is an envelope in it, and pairwise tags go.
- Its two readers make a group of two, so its topic is a group's.

**Class (b).** Owner: actors, caps.

### 17. Rule 15 has no place for groups or bearer proofs (b)

**Statements**
- `ARCHITECTURE.md:136-139`: "Every cap is issued by a vault and held by a vault".
- `id/caps/README.md:148-149` rule 1 (a vault, a group, a ticket or the public holds a cap), `:174` rule 13, `:1195`
  D15; `Caps.lean:222` `Holder`.
- `ARCHITECTURE.md:640` A10 (the network *is* the members group); `:700` A28 (a ticket's key is "only authorizing the
  claim").
- `id/caps/README.md:141` (D21: each fetch key is signed by the one before, a key that authorizes a key with no vault),
  and A31's "two kinds" of signed thing.

**Resolution.**
- Rule 15 reads "held by a vault or a group of vaults". By A10 `public` is the members group, so `Holder` has two forms.
- One category stands beside history and beats: **bearer proofs** (a ticket's one-time key, fetch keys). They authorize
  only the one act a blind checker can verify, and a rule or the issuing vault settles their conflicts (A12, A22).

**Class (b).** Owner: architect, caps.

### 18. The wire still falls back (a)

**Statements**
- `db/core/src/wire.rs:31-56`: `#[serde(default)]` on `Network.statements` ("absent reads as none"), `Heads.more` and
  `CatchUp.only`, each so a frame from an older peer still reads.
- `db/core/src/chat.rs:48-52`: `text` and `sig` default to empty.
- `wire.rs:17`: `Hello` carries no version.
- Against: `README.md:44-45` rule 9 ("no fallbacks for older peers"); `PEERS.md:69-72` decision 11.
- `ARCHITECTURE.md:754` A36 cites "#1649" as if it had landed. #1649 is an open draft PR.

**Resolution.** With #1649's version in the hello and A29's CBOR frames, a frame missing a field is refused. A36 marks
#1649 as planned.

**Class (a).** Owner: thread E (#1649), thread C.

### 19. The status tables claim more than holds (b)

**Statements**
- `architecture/README.md:3` ("fourteen rules"); its table and `architecture/spec/Aven/Architecture/Gaps.lean` (and
  `rules.json`) have no rules 15 or 16, against `ARCHITECTURE.md:148-149`, which makes that file the one place where
  each rule stands.
- "Missing: —" for rule 3 (findings 12 and 13), rule 7 (finding 5's `acker`; `vaults.md` V10) and rule 12 (finding 14).
- `id/caps/README.md:41` ("Nothing in this spec is still a proposal") and `:1377` ("Open questions: None"), while
  finding 8 is open.

**Resolution.** Gaps.lean gains rules 15 and 16, and the gaps above go into `missing`.

**Class (b).** Owner: architect.

### 20. Formats from before the genesis against rule 1 (b, low)

**Statements**
- `PEERS.md:345-346` (stored formats are read forever) and `:276-283` (`settle_restore` keeps the old text statements in
  the tree's past).
- Against: `ARCHITECTURE.md:101-103` rule 1 ("bytes that don't encode back to themselves are refused"). Rule 9 names its
  one exception (`:124-125`); rule 1 names none.

**Resolution.** Rule 1 names its one exception: what was stored before the genesis is read in its frozen formats, and
nothing after the genesis is. Alternatively, the genesis covers those statements by hash as a checkpoint.

**Class (b).** Owner: architect, avenPEER.

### 21. The vocabulary is looked up in itself (b, low)

**Statements.** `db/docs/README.md:262-265`: a vault's singletons, "its profile, its vocabulary", are "found by name in
the vault's vocabulary", and "the vocabulary's one key picks" between two.

**Resolution.** The keyring, the one Doc every vault has (now typed `keyring`), names the vocabulary.

**Class (b).** Owner: docs.

---

## Old text after the 31 Oct decisions (all class a)

Each line below is contradicted by a decision that is already made. Its owner fixes it.

- **ARCHITECTURE (architect).**
  - `:9` "A1 to A25";
  - `:82, 84, 87` (device vaults; caps held by groups, public and tickets; the ticket as a key);
  - `:115` "A peer holds only the caps", where rule 15 has vaults hold caps;
  - `:647-652` (A11: the Aven Peer's *key*, the guardian's *keys*);
  - `:656, 661-662` (A12: device acks; "the admin's passkey signed it");
  - `:665` (A13: guardian keys, not its vault);
  - `:844` ("their targets may be queries", against A32).
- **PEERS (avenPEER).**
  - `:47, 78-79, 209-213, 273, 375, 429` (device acks, against A28 and A38);
  - `:66, 349, 443` (A14 "until Samuel takes it up", though A14 is declined);
  - `:144` (keep targets as queries, against A32);
  - `:187-188` (the genesis names "the Aven Peer's key and the guardian's keys", against its own `:195-196`);
  - `:311` (lists signed by "admin passkeys"), `:315` and `:333-336` (release signers, per release; A36);
  - `:353` (the guardian's exit "Samuel's later decision", though D12 fixed when it happens).
- **caps README (caps).**
  - `:114` (a ticket is "a one-time key that holds a cap", against A28);
  - `:148-149` (a ticket and the public as holders);
  - `:332` (a type named `b3:…`, though a type id is `d:…`);
  - `:466-478` (the tree block: genesis keys, an admin device's ack).
- **GLOSSARY (avenBRAIN).**
  - `:31-32` (genesis with keys), `:35` (an invite is "an admin passkey's assertion"), `:40` ("admin key"), `:63`
    (ticket), `:44` (the guardian as a key);
  - `:391` (device cap), `:394` (address and release records as "newest-wins notices", against A31), `:404` (admin
    device), `:367` (catalogue).
  - A1 made the verdicts decided, so these are now decided text that contradicts A28, A31, A36 and A38.
- **avenBRAIN slides.** `brain/id/slides/cap.md:3` ("which operations").
- **Engine.** `db/engine/README.md:241` (an operation named by the hash of its "canonical JSON", against A2, A29 and
  A32's "rule 1's name of its stored form"; `principles.md` item 3 said it would be fixed with A29).
- **Actors.**
  - `aven/actor/ARCHITECTURE.md:189` (state-runtime's set, merge, append and remove, against A37);
  - `:500-501` ("no gossip for messages", `message` and `ack` frames, against A33);
  - `:653` ("A17, awaiting Samuel", though A17 is decided).
- **README.**
  - `README.md:103-104, 191-193` (device vaults);
  - `:115-119` (a Doc "like IPNS", a ref as "a Doc's head");
  - `:200-201` (it states the end state of recovery as today's).
- **Core.** `core/src/names.rs:2, 14`, `core/spec/Aven/Core/Names.lean:9, 43` and `db/docs/README.md:126, 255-260, 825`
  name a Doc by "the hash of its signed genesis", and the genesis JSON carries `sig`. Since A30 (#1666) a name hashes
  `[label, body]`, so these should say "the name of its genesis envelope".

## The A-numbering

- `ARCHITECTURE.md:9` still says "A1 to A25". The proposals now run to A41.
- They are out of order: A39 (`:736`) sits between A32 and A33; A40 and A41 follow A38. No number is missing or used
  twice.
- `audits/README.md:21` and `audits/principles.md:4` say "A28 to A38", but A39 to A41 come from the same day.
- Marked "for Samuel" but decided elsewhere:
  - A38 was decided in #1665.
  - `aven/actor/ARCHITECTURE.md:653` still waits on A17, which is decided (`ARCHITECTURE.md:776-786`).
  - `PEERS.md:66, 349, 443` still wait on A14, which is declined.
  - A36's "who owns the release vault is for Samuel" is genuinely open. A28 already decided that such a vault exists,
    so only its owner is left.
- "#1649" is cited as done in A36 (`:754`), but it is an open draft.
- Decision labels: PEERS Thread D's D1 to D5 against caps' D1 to D21 (`terms.md`) is still open; for example
  `Keep.lean`'s "(D1)" to "(D3)".

## Known items: recorded, and where each stands

| Known | Recorded in | Text or Lean still against it |
|---|---|---|
| A2 vs actors' JSON frames | A29 | `db/engine/README.md:241`; `wire.rs` stays JSON until the wire version changes (allowed by rule 16) |
| A22 query targets vs caps rule 6 | A32 | `ARCHITECTURE.md:844`, `PEERS.md:144` |
| CSS slides vs the face-runtime | `principles.md` item 10 | being moved; face-runtime landed (#1643) |
| K11 vs actors' point-to-point delivery | A33 | `aven/actor/ARCHITECTURE.md:500-501`; the carrier's own contradictions are finding 16 |
| docs' "no interim fix" vs catch-up on the chat's chains | A34, rule 16 | none found |
| A4 vs Records' tie-break | A31; `Records.lean` applies it to history | the fix brings findings 7, 12 and 13; `GLOSSARY.md:394` |
| caps' no roster vs the tree as one Doc | A38, decided in #1665 | finding 5: the door is still built from the roster (`PEERS.md:221`, `Network.lean:629`) |

## Leads checked with nothing new beyond the above

- **Rule 12 and wall clocks.**
  - Expiry is consistent (`Expiry.lean`'s `time_acked` and `before_ack` state the accepted limit).
  - Rotation batching, heals on a schedule, ask timeouts and letterbox rate limits are local schedules, not order.
  - The chat's `here`, `bye` and the 30 s timeout are A35's.
  - `chat.rs:155` (refuse at ≤ last) and `chain.rs:477` (show lines by time) are old structure, left as they are by A34
    and rule 16. The chat as a Doc must not take them over (docs rule 9).
- **Rule 7 in running code.** The door, the only relay, keeping by rule and the configured `aven_key` in
  `peer/light/src/lib.rs:128` are `vaults.md` V4 and V10 and ARCHITECTURE's table of privileges. Nothing new beyond
  finding 19's status claim.
- **A30 against the vectors.** Applied in Core on main (#1666): `Signed.lean:7-9`, `Log.lean:46-54` and the
  regenerated vectors. What's left is the Doc-id wording in the "Core" item of the old-text list.
