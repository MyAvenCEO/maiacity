# Vaults own; signers only sign (31 Oct 2026)

At main `f5a6fd3d`. What follows is fixed Lean-first, before its code ([`ARCHITECTURE.md`](https://github.com/MyAvenCEO/maiacity/blob/dd5bfebad2f41ef4dff535b6c446953c55769a9d/aven/DB2/ARCHITECTURE.md), rule 15, A28).

The rules applied:
- caps rule 1: "Keys sign; vaults hold"; rule 2: "Governing is ownership, never a cap";
- Samuel (31 Oct): "a tree admin should always be a VAULT, never an individual signer";
- Samuel's two rules of the same day: (1) "Only vaults can own things and be admins; signers are just signers authorized
  to act for a vault"; (2) "All caps always delegate between vaults, never between signers".

All paths are under `aven/DB2/` unless they start with `aven/` or `.github/`. Files were read from `origin/main`.

Verdicts:
- **VIOLATION:** a key or signer is the authority, or holds or issues the grant.
- **OK:** a key signs for a vault as its owner or its device, under the vault's rules; or a device speaks only about
  itself.
- **UNCLEAR:** it depends on a modelling choice that is still open.

## The root cause, found first

1. **The settled tree (`Aven.ID.Network`) has no owners and no thresholds.** `Genesis` names `coop` and `agent` only as
   strings (`id/spec/Aven/ID/Network.lean:140-151`). `TreeSays` has no governance statement: genesis, signIn, ticket,
   withdrawal, claim, ack and the four list statements only (`:158-174`). So the tree can't compute "Maia City's
   owners approve". `admin` and `adminPasskey` fall back to a fixed key from the genesis (`:451-462`). The previous model
   (`Invite.lean:183` `adminKey`, Rust `members.rs:234`) derived the admin from the tree's ownership. Network.lean took
   that away.
2. **In caps, a coop can't sign anything.** `capRules` requires `actsFor c.signer == some c.issuer`
   (`id/spec/Aven/ID/Caps.lean:335`), and a coop has no devices (`Cast.lean`, `actsThrough "maia-city" = []`). The cast
   explicitly refuses a Maia City keep cap signed by Alice's device: `CapsExamples.lean:275-277` (`keep-city`, "three it
   must not take").
   - So coop authority can only be exercised by a vault that governs the coop, acting alone:
     `authorityOverVault` (`Caps.lean:294`) gives any governing vault root authority over the coop's Docs, approved by
     that vault's own quorum, not by the coop's.
   - `Authorized.Own` does the same for writes (`Authorized.lean`, `Reader.Own`).
   - Once Maia City has several owners with k > 1, any one owner vault bypasses the coop's threshold. That is
     **VIOLATION** (structural, Lean).
3. **The threshold k is not part of a vault.** `Vault` has no threshold (`Tree.lean`). k is a reader parameter,
   `Ctx.threshold := fun _ => 1` (`Caps.lean:270`, `Keep.lean:585`). That is **UNCLEAR**: an approval is correct today
   (1 of n), but the "k" that owners govern is nowhere in the tree.
4. **"Devices are vaults"** (caps D2, `Kind.device`) lets examples hand caps to device ids as if they were vaults (see
   V9). This conflicts with new rule (1): a signer is not a vault.

## Violations, ranked by risk (most severe first)

### V1. MaiaCityGuardian: one bare key that owns every person's vault

Spec, Lean, Rust, JS and CI all have it.

**Where:**
- `sandbox/guardian.mjs:1-12`: one Ed25519 key; "it owns every person's vault founded with it".
- `PRODUCTION.md:40-42`: "Whoever holds it owns every person's vault that has it".
- Rust `id/core/src/network.rs:60` (`GUARDIAN`), `:129` (its public half comes from config), `:185-188`
  (`founders` adds `Owner::Key(GUARDIAN)`).
- Lean `Network.lean:131-135` (`GuardianKeys`), `:154` (the genesis must carry its signature), `:466-470` (a claim
  counts only if it names exactly the genesis's guardian).
- caps README rule 30 (`:219`) and D12 (`:1163`).
- Deploy: `.github/workflows/avendeploy.yml:258,270-273,289-295`, `deploy/compose.yml:43`,
  `deploy/server/peer.sh:9-10,65`.

**Authority:** owner of every person's vault, and "any one owner is enough". That includes Samuel's vault, which governs
Maia City, which governs Aven and the Aven Peer. Through Approve's recursion, its key alone approves any grant those
vaults can make. It is also recovery for every vault, and a co-signer of the genesis.

**Holder:** one Ed25519 key in running code; a hybrid key triple in Lean.

**Risk:**
- A leak is total compromise.
- A loss leaves no recovery for anyone.
- Rotating it:
  - Lean can't rotate it without a new genesis: claims must name the genesis guardian forever (`:470`), even after the
    D12 exit.
  - Running code swaps it silently, for every existing vault. The tree is recomputed at every start from the stored
    claim plus `--guardian`, so a change to the deploy's configuration changes the owner key of every vault, with no
    act any person signs.
  - "No deploy without the guardian" (`:270-273`, `peer.sh:10`) checks only that the value is 64 hex digits. It does
    not check it against anything signed.

**Code vs Lean:** they disagree. Rust reads one Ed25519 key from config and applies it retroactively. Lean pins a hybrid
triple in a signed genesis.

**Replacement:** a **MaiaCityGuardian vault**.
- Its owners are three offline keys at threshold 2, which is the README's own "2-of-3 pieces" advice. Its X-Wing seal
  key lives in its keyring.
- Every person's vault lists `vault:maia-city-guardian` instead of `key:…`.
- Claims and the genesis name the guardian *vault*, plus a fingerprint of its owner set for A13's consent.
- It rotates by an act of the guardian vault's own owners (k of n), with no change to any person's vault and no new
  genesis.
- Its exit (D12) removes `vault:maia-city-guardian` from each vault. `claimOk` must stop requiring it once it has left
  (name it through the coop's current policy, not the immutable genesis).
- Running code must take the guardian only from signed statements, never from `--guardian`.

### V2. The network's admin is the claimant's passkey (`adminPasskey`)

Lean, spec (PEERS) and ARCHITECTURE A12 have it.

**Where:**
- `Network.lean:459-462` `adminPasskey`, used by `claimOk` `:466-470` (tickets), `beats` `:481-483` (withdrawals) and
  `listed` `:544-546` (relay and keeper lists).
- `PEERS.md:73-76` (decision 12), `:197`, `:299`; `ARCHITECTURE.md:646-649`.

**Authority:** to admit (issue tickets), to withdraw, and to choose relays (who sees members' IP addresses) and keepers.

**Holder:** the genesis's `passkey` alone: one ES256 credential, synced through iCloud or Google.

**Risk:**
- A stolen passkey, or its synced copy, lets anyone in, withdraws every pending invite, and routes members through a
  logging relay.
- A lost passkey means no one can ever issue a ticket or change a list again. There is no statement that changes the
  admin, and re-founding is a new network.
- The coop's other owners can never act.

**Spec vs code:** the spec contradicts itself.
- `README.md:107,195`, `SANDBOX.md:74` and `PRODUCTION.md:161`: "Maia City is the admin, not Alice's key". `PRODUCTION.md:161` adds: "its
  owners' passkeys sign what the admin does".
- The caps README's "Who signs what" (`id/caps/README.md:485`) says a ticket is signed by "the granting vault's owners,
  k of n".
- `ARCHITECTURE.md:281,291` says "The admin coop lists them" and "changes are the admin's signed acts | The admin coop".

**Lean vs running code:** they disagree.
- Rust `members.rs:234-243` `admin_key`, `Invite.lean:183` `adminKey` and `os/web/invites.js:36-40`: any passkey that
  owns a vault governing the coop. That is derived from the tree, so it rotates with ownership.
- Even that is still a single key acting alone. The invite statement `{network, invite, passkey}` (`invites.js:47`)
  names no coop and carries no approval of the coop. It is closer, but still a **VIOLATION**.

**Replacement:** the admin is **the Maia City vault**.
- Every admin statement (ticket, withdrawal, list add or remove, config change) carries `approvals`. It counts when
  `Tree.approves th "maia-city" digest sigs` holds in the settled view (D14, `Approve.lean` `approves`).
- The settled tree must gain governance statements (an owner added or removed, a threshold, a passkey added to a person's
  vault), each approved by that vault's current owners.
- This keeps decision 12's property for free: devices are never owners, so a stolen browser can't approve. Approvals
  bottom out in owner passkeys.
- Rotation: Samuel adds a new passkey to his own vault. Recovery: his vault's recovery owners or kit. Neither touches the
  coop or the genesis.

### V3. The genesis fixes authority-bearing configuration that nobody can change

Lean and spec have it.

**Where:**
- `Network.lean:140-155`: the genesis is signed by the claimant's passkey and the guardian. It holds `rpId`, `origins`,
  `claimant`, `passkey`, `devices`, `coop`, `agent`, `avenPeer`, `guardian` and `signedBy`.
- No `TreeSays` changes any field.
- `PEERS.md:180-182,340`: "Re-founding a network is a new genesis, by its owners". The genesis's "owners" are two keys.

**Who may change each field later:**

| Field | Who may change it |
|---|---|
| `rpId` | Nobody. Fine: it binds passkeys (A14 declined), not authority. **OK** |
| `origins` | Nobody, though `ARCHITECTURE.md:291` says "admin coop". **VIOLATION** |
| `avenPeer` | Nobody. `PRODUCTION.md:108` says "Rotating it is one run of the job … replaced by the admin", which is impossible here. **VIOLATION** |
| `passkey`, `devices` | Only through sign-ins by that passkey; the passkey itself never changes. **VIOLATION** (see V2) |
| `guardian` | Never (V1) |
| `coop`, `agent` | Names only; no owners modelled |

**Risk:** a compromised Aven Peer key or a stale origin can't be fixed without re-founding the network.

**Replacement:**
- The genesis founds vaults: Samuel's (owners `key:passkey` and `vault:guardian`), Maia City (owner `vault:samuel`,
  k = 1) and Aven (owner `vault:maia-city`). It names Maia City as the admin.
- It is signed as Maia City's founding approval, plus the guardian's consent.
- `origins` and the Aven Peer's device change by coop-approved statements. The Aven Peer's device change is a `signIn`
  into Aven's vault approved by Aven's owners, which is Maia City.
- The pinned hash stays the root.

### V4. Running code: the first signup is the admin, and infrastructure secrets decide it

Rust, peer and CI have it.

**Where:**
- `id/core/src/network.rs:243-246` (`submit_claim`: the first signup wins) and `:73` (the coop's id and name are
  "configuration, read at every start, never signed").
- `peer/native/src/door.rs:13`: "A wiped store is an unclaimed network".
- `peer/native/src/main.rs:36-43,213-228`: `--rp-id`, `--origin`, `--guardian` and `--admin-coop` are unsigned flags.
- `deploy/compose.yml:41-43`.
- Clients pin nothing: there is no genesis or claim pinning in `os/web` or `peer/light`.

**Authority:** who becomes the admin; who the guardian is; what the coop is called; which origins count.

**Holder:** whoever holds the S3 keys (`HETZNER_S3_*` in the GitHub `production` environment and on the server), the
server, or the GitHub env and dispatch rights. A store without a claim is unclaimed (`door.rs:13`), and its first signup becomes the admin.

**Verdict:** VIOLATION in running code. Lean's A11 genesis (pinned by members) is the planned fix: the code disagrees
with Lean by design until milestone 2b.

**Replacement:**
- Members pin the genesis hash.
- The claim becomes the genesis of V3: Maia City's vault, approved by its founding owners.
- No flag the genesis names is read (PEERS §6 already requires this).

### V5. Admin devices' acks make claims final

Lean and spec have it.

**Where:**
- `Network.lean:451-457` `admin`: the claimant's passkey, the genesis `devices`, or any device the claimant's passkey
  signed in to the *claimant's person vault*.
- `:476-478` `final`.
- Examples: `:1102,1114-1115` (`alice-peer`, an always-on native Peer, and `alice-peer-light` ack).
- The policy "ack only what stands in its own view" is honest-device policy only (`Admit.lean`, B1). `final` doesn't
  check it.
- Spec: `PEERS.md:47,198-205`; `ARCHITECTURE.md:641`.

**Authority:** finalising a membership, after which no withdrawal wins (`settle_final`). An ack can also make a second
claim of a ticket final, so the smallest hash ousts the first (`contested`).

**Holder:** device keys of Samuel's personal vault, which is not the coop. `alice-peer` is a server-resident key.

**Risk:** a stolen browser or a compromised Peer acks a leaked link's claim before Samuel's withdrawal. The intruder
becomes irrevocable, since there is no member removal yet, or a legitimate join is contested. This partly undoes
decision 12's goal ("a stolen browser can't let anyone in").

**Code vs Lean:** there is no ack in code yet (Rust orders by compare-and-set).

**Replacement:** finality is a **cap from the Maia City vault**, approved by its owners (D14), to a vault: Samuel's, or
Aven's as PEERS `:260-262` already proposes ("a cap Maia City's owners give it").
- An ack counts when its signer is a device of the holder vault, within that device's cap, and the cap is live.
- A stolen device is cut off by removing that device, or by revoking the cap.

### V6. Release signers: a free set of keys

Lean and spec have it. Thread E is about to build the record.

**Where:**
- `id/spec/Aven/ID/Records.lean:62-64` (`takes … | .release => releasers r.signer`), `:108`, `:153` (one key,
  `"release-signer"`); vectors `id/spec/vectors/records.json` (12 rows signed by `release-signer`).
- `PEERS.md:303,321-323` ("the signers (A15)"); `ARCHITECTURE.md:288` ("Granted by: Release signers"), `:656-661`.

**Authority:** which code every browser's Service Worker and every native Peer runs. That code holds the safe, so this is
total.

**Holder:** an unspecified set of signer keys, today one key.

**Today:**
- No release record is in code (`db/core`, `peer` and `os/web` have none).
- Releases are GitHub Releases made by `GITHUB_TOKEN` on a push to `production` (`.github/workflows/avensandbox.yml:113-160`).
- The deploy is hand-dispatched with "starting the run is the decision" (`avendeploy.yml:2-3`).
- So a GitHub write or dispatch permission is the release authority (infrastructure acting as protocol authority).

**Replacement:** a **release vault**: Aven's, or a "Maia City releases" vault owned by Maia City.
- Its owners, k of n (for example Samuel's passkey plus 2 of 3 offline keys), approve the record's digest.
- `takes` checks `tree.approves th releaseVault digest sigs` in the settled tree, not `releasers signer`.
- The record carries `vault` and `approvals`, not a signer list.
- Rotation is that vault's governance, not a new genesis or a new app build.
- **Tell thread E before piece 2 lands.**

### V7. Coop authority collapses to one governing vault in caps

Lean has it (see root cause 2).

**Where:** `Caps.lean:294` (`authorityOverVault`), `:335` (signer must be a device of the issuer), and
`CapsExamples.lean:275-277` (`keep-city` refused).

**Authority:** root caps over the coop's Docs (the city-dome's read, write, keep and share).

**Holder:** any vault that governs the coop, with its *own* approval.

**Risk:** today none (one owner). Once Maia City has 2-of-3 owners, one owner issues caps over everything of Maia City's.

**Replacement:**
- A cap issued *by* a coop: the signer is a device of any vault that owns or governs the issuer, and the approval is
  `approves th issuer` (the coop's own quorum, recursive).
- Root authority over vault v's Docs requires v's approval, not only a governing vault's. Owners act *as* the coop
  through `approves`.

### V8. Tickets: a key holds a cap, and the coop doesn't issue it

Lean has it. This is a violation under the new rule (2).

**Where:**
- `Caps.lean:203-208` `Holder.ticket (key)`; `:324-329` `holds … .ticket _ => false`; `Authorized.lean:108`.
- Vectors `caps.json` (`"holder":{"ticket":"t-1"}`).
- `Network.lean:163,466-470`: a ticket is issued by `adminPasskey`, and the claim is signed by the ticket key.
- caps README `:143,454`.

**Authority:** admission, a bearer cap.

**Holder:** a one-time key, which is a signer. Its issuer is a passkey (V2).

**Risk:** low on its own: one use, the smallest hash wins, and it can be withdrawn. It is a type-level exception to
"vaults hold".

**Replacement:**
- The ticket is a cap **from Maia City** (approved, D14) whose holder is **the vault its claim founds**:
  `Holder.claimant (ticket)`, which resolves to `.vault founded` through the standing claim.
- The one-time key only authorizes the claim statement, as a bearer proof (a condition, not a holder).
- The claim is co-signed by the new vault's passkey and device, as Rust's join already is
  (`members.rs` `accept_join`: the one-time key plus the passkey assertion).

### V9. Relay and keeper lists name device keys; keep-cap examples name devices as keepers

Lean, spec and vectors have it.

**Where:**
- `Network.lean:171-174` (`relayAdd (device)`, `keeperAdd (device)`), signed by `adminPasskey` (`:544-546`); examples
  `:1116-1121`.
- `Node.lean:267-269` (`keepChat` holder `.vault "bob-peer"`) and `:278-281` (`defaultKeep "bob" "aven-peer"`).
- `FailJson.lean:34-36`, exported as `failures.json` (`"keepers":["aven-peer","bob-peer"]`).

These contradict `CapsExamples.lean:106` (keeper `"aven"`, Aven's vault), `Keep.lean`'s books (`keeper := "aven"`,
which would refuse those caps), and PEERS decision 8 ("the Aven Peer, acting for Aven").

**Authority:** the right to relay (to see members' IPs), to be offered as a keeper, and to keep a vault's Docs.

**Holder:** device or peer ids.

**Risk:** low. They are examples and a directory, and Keep.lean would refuse such caps. But the vectors teach the wrong
holder.

**Replacement:**
- List entries are caps from Maia City (approved) to a **vault** (the member's vault, or Aven's), with the device it
  serves from as data.
- Keep caps in `Node.lean` and `FailJson.lean` go to `aven` and `bob`.
- Add a rule that refuses `Kind.device` as a cap holder or issuer, so device vaults can't hold caps by accident.

### V10. The Aven Peer's identity is a key by position

Running code; Lean partly.

**Where:**
- Rust `network.rs:150-155`: the Aven Peer device vault takes `peer_key` from config.
- `peer.sh:17-27`: the key is made on the server.
- `peer.sh:58`: `/aven.json` is unsigned.
- `PRODUCTION.md:108`.
- Lean genesis `avenPeer` (V3).

**Authority as a device:** it signs for Aven, keeps what keep caps grant (A22), hosts actors under hosting caps (A16).
That is **OK** as Aven's device.

**Authority by position (running code):**
- the door;
- the only relay;
- claim ordering by compare-and-set;
- keeping every file "by a rule in its code" (`peer/native/src/main.rs:371-374`; ARCHITECTURE "Privilege today" table
  `:277-291`).

All of that is **VIOLATION** today, and planned away.

**Holder:** whoever holds `/opt/aven/secret` on the server.

**Replacement:** a device of Aven's vault, added and removed by statements approved by Aven's owners (Maia City). Its
privileges become caps to *Aven's vault*: relay-list entry, keep caps, finality cap (V5).

## OK, or OK with a note

- **D14 approvals.**
  - Where: `Approve.lean` `approvesF` / `ownerApproves`.
  - A key approves only if it is in `ownerKeys` of the vault being asked; a vault approves by its own owners,
    recursively.
  - There is no fixed key anywhere, so the recursion ends in each vault's own owner list.
  - **OK.** Note: k is not in the vault (root cause 3).
- **Sign-in statements.**
  - Where: `Network.lean` `signIn`, `deviceOf`, `passkeyOf`; Rust `members.rs` `accept_sign_in`.
  - A vault's own passkey adds a device to *its own* vault: an owner governing their own vault, 1 of n.
  - **OK.** The exception is that sign-ins to the claimant's vault confer coop admin (V5).
- **Device caps.**
  - Where: `Authorized.lean:67-73,97`; caps README `:420`.
  - The issuer is the vault, through the owner's sign-in. The holder is a "device vault". Lean keeps it as a reader
    oracle keyed by signing-key bytes, with no issuer or approvals.
  - **UNCLEAR** under the new rule (1): a device is a signer, so a device cap is really the vault's *signer scope*, set
    by its owners.
  - Recommendation: model it as part of the vault's governance (signers plus scope), not as a vault-to-vault cap, and
    drop "devices are vaults" as a cap holder.
- **Actor hosts (A27).**
  - Where: `Authorized.lean` `HostSigned`/`ByChain`; `aven/actor/spec/Aven/Actor/Signing.lean`; `Hosting.lean:43-45`.
  - The host device signs only under the carried chain, and the chain's last cap must be held by `vaultOf signer`, a
    vault. The device cap is an outer bound.
  - **OK.** The hosting cap holder `.vault host` is OK when `host` is the host's vault (Aven's, or the member's). It is
    **UNCLEAR** if `host` means a device vault; same note as device caps.
- **Keep caps.**
  - Where: `Placement.lean:62-66` (`Cap.keeper` is `.vault` only) and `Keep.lean:593-597`.
  - The holder is the keeper's vault, and the cap is approved by the issuer's owners.
  - **OK.** The examples in V9 are the exception.
- **Keep withdraw, delete and fork choice; revocations; checkpoints; segments; index roots; a Doc's genesis.**
  - Where: `Keep.lean:600`; caps README `:487`; docs README `:212-216,252`.
  - A device signs for its own vault under `actsFor`.
  - **OK.** Note: a single stolen device can permanently delete a vault's Docs at a keeper (`deleted_gone`). That is
    within the rule, but irreversible.
- **The public (rule 33, D15).**
  - The holder is the network's members, who are vaults through the coop's membership (`Authorized.lean` `.public =>
    r.member v`).
  - **OK.** Better expressed as the coop's members group (`.group`), so there is one mechanism.
- **Groups (rule 13).**
  - A group is a Doc whose readers are vaults. A new reader is a grant approved by the granting vault (`:485`).
  - **OK.** A group is not a vault, but its members are, and every way in is vault-to-vault.
- **The recovery kit.** It is the person's own owner key, "a passkey without a device", so it is a signer of its own
  vault. **OK.**
- **`rpId`.** A WebAuthn binding, not an authority. It stays fixed (A14 declined). **OK.**
- **CI and deploy secrets.**
  - `DEPLOY_SSH_KEY`, `HETZNER_API_KEY`, `HETZNER_DNS_TOKEN` and `GITHUB_TOKEN` are infrastructure: **OK** as such.
  - Three of them reach protocol authority today:
    - `AVEN_PEER_GUARDIAN` (V1);
    - the S3 keys, through wipe and reclaim (V4);
    - the GitHub release and dispatch rights (V6).
  - No CI step signs anything with a protocol key.

## Where running code and Lean disagree

| Topic | Rust / JS today | Lean |
|---|---|---|
| Admin | A passkey that owns a vault governing the coop | The claimant's passkey (plus devices for acks) |
| Guardian | One Ed25519 key from config, applied retroactively | A hybrid triple pinned in the genesis |
| Network root | The first signup (compare-and-set) | A signed, pinned genesis |
| Coop id and name | Unsigned config | A genesis field |
| Ack and release record | Not built | Device acks; a free key set |
| Keepers | Rule-in-code (Aven Peer) | Keep caps, with device-holder slips in vectors |
