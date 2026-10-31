# avenCAPS

Who may do what: signed grants of ops on Docs from one vault to another, which every reader checks, and Maia City's
register of who joined the network and how it is set up.

## Owns

- [A cap](#a-cap): a signed, immutable grant, named by its body.
- [Lines: ops, targets and bounds](#lines-ops-targets-and-bounds): what a cap allows, built from ops.
- [Conditions and roles](#conditions-and-roles): when and how a cap holds, and named bundles of lines.
- [Holders](#holders): a vault, a group of vaults, or the public, which is the network's members.
- [Device caps and actor hosts](#device-caps-and-actor-hosts): what a device may do for its vault.
- [Authority and issuing](#authority-and-issuing): root caps through quorums, and who signs what.
- [Chains](#chains): grants and attenuations that only narrow.
- [Collections](#collections): a Doc that lists Docs, as a cap's flexible target.
- [Where caps live](#where-caps-live): cap and revoke Records in a Doc, and letters.
- [The envelope's authority](#the-envelopes-authority): `{acks, caps}`, or `{acks, caps, actor}`, in every envelope's
  body.
- [The reader's verdict](#the-readers-verdict): whether an envelope is authorized, judged on its own past, and
  `revoked`.
- [Revocation and acks](#revocation-and-acks): ending a cap, the race, the cascade and expiry.
- [Deletes](#deletes): a Doc's vault ends the Doc.
- [Holdings follow caps](#holdings-follow-caps): a peer holds only what its caps cover.
- [Membership](#membership): tickets, the confirm cap and member caps.
- [Keep caps, offers and placement](#keep-caps-offers-and-placement): who keeps which Docs.
- [The gate's authority half](#the-gates-authority-half): fetch keys, listings, orders, choices, the proof and the
  quota.
- [The register](#the-register): `tree/1`, its setup, its ops, owners k of n, settling and the migration.
- [Attacks and what holds](#attacks-and-what-holds): the caps threat table.

## Uses

- [avenCORE](../core/README.md): Values and the one codec; [signed things](../core/README.md#signed-things), named by
  `[label, body]` with signatures beside them (A30); [envelopes](../core/README.md#envelopes),
  [the past](../core/README.md#the-past) and [counting](../core/README.md#counting), with caps' verdict and `revoked`
  as parameters (A45, A182); [ops and calls](../core/README.md#ops-and-calls) (`OpId.ofPlugin`, `core/1`'s ops,
  `typeParam`, `fieldsParam`); [targets](../core/README.md#targets-and-steps) and bounds (`Target.le`, `Target.covers`,
  `Bound.within`); [built-in type names](../core/README.md#built-in-types).
- [avenID](../id/README.md): [hybrid signatures](../id/README.md#hybrid-signatures) and
  [passkeys](../id/README.md#passkeys-and-the-prf-step); [vaults](../id/README.md#vaults) and their names;
  [owners and governing](../id/README.md#owners-and-governing); [approvals, k of n](../id/README.md#approvals-k-of-n);
  [devices](../id/README.md#devices); [epochs](../id/README.md#epochs), [the keyring](../id/README.md#the-keyring) and
  [the heal](../id/README.md#the-heal), which end a removed reader's reading.
- [avenDOCS](../docs/README.md): [Records](../docs/README.md#records) and a Doc's
  [genesis and root Record](../docs/README.md#a-doc-and-its-genesis), where caps and the register live; its import
  asks for caps' verdict through its `Authorize` trait, which avenPEERS adapts (avenCAPS' code never depends on
  avenDOCS, A169).
- [avenOPS](../ops/README.md): [lowering a call to steps](../ops/README.md#lowering-a-call-to-steps) and
  [footprints](../ops/README.md#footprints-and-the-merge-check), against which a reader checks a change (E1–E3);
  [wants](../ops/README.md#the-want-queue) (served is wants ∩ caps); the dry run.
- [avenPEERS](../peers/README.md): [the door](../peers/README.md#the-door), which admits the devices the register
  settles; [relays](../peers/README.md#relays); [gossip topics](../peers/README.md#gossip-per-group);
  [the fetch gate](../peers/README.md#the-fetch-gate) and its TLS exporter; [keepers](../peers/README.md#keepers),
  their arrivals, covers, bills and admission; and the adapter from caps' verdict to avenDOCS' `Authorize`.
- [avenACTORS](../actors/README.md): the kernel's narrowing per message, and the receiver's router, which checks
  `tell`.
- [avenOS](../os/README.md): shows each grant as it is, never only a role's name, and collects the owners'
  approvals.

## A cap

A cap is a grant from one vault to another: which ops the holder may call, on which Docs, under which conditions. It
grants only what its issuer has: it narrows a parent cap the issuer holds, or rests on the issuer's own authority over
its Docs.

A cap never changes. It is named by the hash of what it says, so what it grants is fixed when it is signed. Who signed
it sits beside it and never changes its name. A cap is its content: it carries no nonce.

**Its body** is a Core Value, keys in the codec's order:

```
{"form": "grant" | "attenuate", "role": role, "grant": [line…], "share": n,
 "holder": holder, "issuer": vault, "parent": cap,
 "conditions": {"own", "uses", "approve", "expires", "history", "branches", "notBefore"}}
line:    {"op": op id, "doc": target, "params": {param: [value…] or null, …}}
holder:  {"vault": vault}  |  {"group": Doc id}  |  "public"
```

| Field | Meaning |
|---|---|
| `form` | `grant` passes its parent on to a holder, or starts a chain; `attenuate` narrows its parent for the same holder |
| `role` | A role by its id, in place of lines ([roles](#conditions-and-roles)); left out when it names none |
| `grant` | Its [lines](#lines-ops-targets-and-bounds) |
| `share` | How many more hops it may be passed on. A grant lowers it by one; an attenuation by none |
| `holder` | Who holds it ([holders](#holders)) |
| `issuer` | The vault that grants |
| `parent` | The cap it narrows; left out for a root cap |
| `conditions` | [Conditions](#conditions-and-roles), applied to every line; `uses` and `expires` left out when unset |

- **Its name** is Core's name of `["avenID cap 1", body]`: 32 bytes. Two grants with the same issuer, holder, lines
  and conditions are one cap with one name, and revoking it revokes that grant. The form is in the body, so a signature
  over an attenuation is never one over a grant.
- **No nulls.** A field that is absent is left out of the body, never written as null, and a reader refuses a null
  ([avenCORE](../core/README.md#values)).
- **Its signatures** sit beside the name: a device acting for the issuer, and for a grant the approval of the issuer's
  owners, k of n. A vault without devices, such as a coop, issues by its owners' approval alone. An attenuation needs
  no approval ([who signs what](#authority-and-issuing)).
- **Approvals** are Core `Sig`s, `[{signer, sig}]`, over the cap's signing bytes: an owner key approves by a valid
  signature, a vault by its quorum ([avenID](../id/README.md#approvals-k-of-n)).
- **Labels are frozen formats.** `avenID cap 1` and every other `avenID …` label stays as it is under avenCAPS.

**Decided:** caps D2, D3, D6, D22; A2, A28, A30, A32, A107, A161, A183, A184, A189  ·  **Lean:** `Aven.ID.CapsCbor` —
`Cap.digest_inj`

## Lines: ops, targets and bounds

A cap is a list of lines. Each line names one op the holder may call, the Docs it may call it on, and bounds on the
op's parameters. What an owner approves is an op's name and definition: exactly what it lets the holder do. An envelope
names the calls it makes, and a reader checks that a line allows each one.

**Ops.** An op is named by the hash of its stored form, `{"op": name, "plugin": plugin}` (Core's `OpId.ofPlugin`), so a
plugin upgrade never widens a grant: a vault adopts a new version of an op as it adopts an actor's (`replaces`).

| Op | What it allows | Checked by |
|---|---|---|
| `core/1`'s `read` | Holding the Doc's keys | Cryptography |
| `core/1`'s `put`, `patch`, `remove`, `edit` | Writes of the types and fields its bounds allow; free editing is `edit` on a type and field | Every reader |
| A stored query | Running it | The kernel or serving peer that holds the key |
| A plugin's op | What its lowering produces | Every reader |
| `core/1`'s `tell` | Sending these messages, by name in the receiver's interface | The receiver's router |
| `core/1`'s `keep` | Keeping and serving sealed bytes, without a key ([keep caps](#keep-caps-offers-and-placement)) | The keeper's gate |
| `core/1`'s `share` | Issuing narrower caps, to a depth | Every reader of where the caps live |

- **Plugins:** `core/1`; `tree/1`, [the register's](#the-register); and `id/1`, whose one op is `keep-offer`
  ([offers](#keep-caps-offers-and-placement)).
- **Footprints come from lowering.** avenOPS lowers each call to steps, and a reader checks the change is exactly what
  they produce. A cap never writes a footprint. `read`, `tell`, `keep` and `share` lower to no step, so a cap of only
  those writes nothing.
- **A want needs no cap,** and grants nothing.

**Targets** are [avenCORE's](../core/README.md) one grammar, the same as a want's: a Doc (with what it spawned or what
it lists, or not), a vault's Docs, or a vault's Docs of one root type, each with or without the vaults below. Whether a
Doc is in a target follows from its birth facts and from a [collection's](#collections) signed listings, never from
content. A cap never names a query as a target: a query's flexibility comes as a collection.

**Bounds.** A line bounds each parameter by enumeration: null for any value, or a list of the values it allows; for a
list-valued parameter, every element must be one of them. A parameter the line doesn't name is free. `core/1`'s writes
take `type`, the type Doc a step writes, and `fields`, the fields it writes. Ranges come only when a real op needs
them.

**Narrower** means the same op, a narrower target (`Target.le`) and every bound at least as tight (`Bound.within`).

**Actors upgrade.** A definition names the one it `replaces`. A cap on an actor follows the upgrade while every message
it names keeps its schema, and only in a vault that adopted the new definition. A new or changed message isn't covered
until it is granted.

**Who enforces what:**

| Granularity | Enforced by | Holds against |
|---|---|---|
| A Doc, a vault's Docs | Cryptography: the key | Anyone without the key, keepers included |
| A type, a field, own Records, an op, a branch | Every reader | Any writer: a write outside the cap doesn't count |
| A query | The kernel or serving peer holding the key | Everyone without the key; a vault holding the key can read the whole Doc |
| A message | The receiver's router | Any sender |
| Delegation | Every reader of where caps live | Any issuer |

**Decided:** A8, A32, A66, A91; caps D16, D22; E1–E3  ·  **Lean:** `Aven.ID.Caps` — `narrow_chain`,
`narrow_ops`, `no_step_without_write`; `Aven.ID.Authorized` — `chain_writes_nothing`

## Conditions and roles

Conditions narrow a cap in time, in count and in place. A role is a named bundle of lines, so many caps can say "Editor"
without repeating it.

**Conditions:**

| Condition | Meaning | Enforced |
|---|---|---|
| `notBefore`, `expires` | When the cap holds, as times | **Writes:** against the envelope's signed time, and for good from the first ack after expiry ([expiry](#revocation-and-acks)). **Reads:** at the first rotation after expiry. **Tells:** by the router's clock |
| `approve` | How many approvals each act under the cap carries beside its name | Every reader, or the router |
| `uses` | How many acts | Only where one router or kernel counts them |
| `own` | `patch` and `remove` only on Records the holder created: the signer of the envelope that made the Record, read from history, never from a field | Every reader |
| `branches` | `any`, `main`, `proposals` (every branch but main) or one branch, `{"branch": name}`. A cap for proposals never writes on main: landing there is someone else's merge, which counts only when the merger's cap covers the whole merge | Every reader |
| `history` | On `read`: `all` or `from-now`, which rotates without a link back (sealing is avenID's) | Cryptography |

A child's conditions are at least as strict as its parent's: no earlier start, no later expiry, no fewer approvals, no
more uses, `own` kept, branches and history within.

**Roles.** A role is `{id, name, grant}`, its id its hash. A cap may name a role in place of lines. Pinned by its id, a
role never changes under its holders. Changing one is one act of its vault: the new role, and every cap naming the old
one revoked and issued again. A name is for people; authority never looks one up.

**Decided:** caps D6; A27; rule 12  ·  **Lean:** `Aven.ID.Caps` — `role_pinned`; `Aven.ID.Authorized` —
`branch_allowed`, `proposals_never_main`, `merge_covered`

## Holders

Only a vault, a group of vaults or the public holds a cap. A key never does: a ticket's one-time key or a fetch key
proves a condition and holds nothing.

- **A vault:** a person, a coop, an agent or a device, since a device is its own vault ([avenID](../id/README.md)). A
  coop holds no devices: its owners act on what it holds through their own devices, with its approvals where needed.
  An agent's caps usually write removals only as proposals, and spend only with an approval.
- **A group of vaults:** a Doc of the built-in type `group`, whose readers are its members. What a group holds,
  everyone in it holds: a team editing the team's Docs, a family reading its photos. A write under a group's cap
  carries the writer's read cap on the group, inside the seal. A cap issued from a group's cap holds only while its
  issuer is in the group. Making a group needs no governance. Its epochs are sealed as any Doc's are
  ([avenID](../id/README.md#epochs)).
- **The public:** every member of the network ([membership](#membership)), and never anyone outside it. A Doc the
  public reads is sealed to the members, so nothing is ever plain. A public cap's writes count only from a member. The
  public never shares, since nobody can delegate for everyone, and granting to it is a grant like any other.

**Decided:** caps D2, D15; A28, A39, A42, A148; rule 15  ·  **Lean:** `Aven.ID.Caps` — `group_typed`, `child_live`,
`public_bounded`, `public_no_share`; `Aven.ID.Network` — `public_member`, `removal_rotates`

## Device caps and actor hosts

A device signs; its vault holds. What a device may do for its vault is its device cap, a cap from the vault to the
device's own vault.

- **The default:** a device a passkey sign-in adds holds everything its vault may do except govern. An agent's devices
  and the Aven Peer hold narrower ones. The sign-in is the device cap's issuance, so removing a device is revoking it.
- **Within it, on either path.** On its vault's own authority a device writes within its device cap. Under a chain,
  each call it makes is allowed both by the chain, for its vault, and by its device cap. A device whose cap is for
  proposals never writes on main, whatever chain it names.
- **A grant a device prepares** counts only with its owners' approval.

**Actor hosts.** Actors hold no keys. A host's kernel signs every write of the actors it hosts with one device of its
own, a narrow device vault, never a member's personal device.
- Its device cap is the union of its hosted actors' standing caps: the outer bound a misbehaving runtime can't exceed.
- It never writes on its vault's own authority, only under the chain the acting actor's message carried, as it came,
  and each envelope it signs names that actor. The actor's narrowing for a write is its call, which the reader checks
  against that chain, never a link added to it.
- The Aven Peer signs with Aven's own device, under a chain the actor's owner issued to Aven's vault for that actor's
  Docs, with that owner's approval.
- A message that crosses to another vault's host carries its chain only as provenance. The receiver acts under its
  own standing caps, unless that vault holds an approved grant to act on the sender's authority, which attenuations can
  follow.
- The narrowing per message inside the kernel is [avenACTORS'](../actors/README.md).

**Decided:** A16, A27, A28, A42, A60; caps D14, D16  ·  **Lean:** `Aven.ID.Authorized` —
`device_within_cap`, `device_and_chain`, `device_proposals_never_main`, `merge_within_device`, `host_chain_only`,
`actor_within_device`, `host_never_beyond`

## Authority and issuing

Authority runs down the tree of vaults, and only through quorums. A vault grants over its own Docs, or over the Docs of
a vault it governs whose quorum it meets alone.

- **A root cap** is issued by the target's vault, or by a vault that governs it and meets its quorum alone. A coop
  whose owners approve k of n with k > 1 has no single owner vault that speaks for it, so it issues as itself,
  approved by k of its owners. Every vault a root grants over approves it by its own quorum.
- **The same relation** decides a write on a vault's own authority and a target that reaches `below` a vault.
- **Approvals bind what others check:** writes, `share` and `tell`. Reading is holding a key, and anyone holding a
  Doc's key can pass it on without an approval; no system stops a reader from leaking.

**Who signs what:**

| Act | Signed by |
|---|---|
| A grant: a root cap, a child cap, a public cap | A device acting for the issuer, and the issuer's owners' approval, k of n. A vault without devices: its owners' approval alone |
| A new vault's default keep cap | Its owner, in the same tap that signs its claim ([keep caps](#keep-caps-offers-and-placement)) |
| A keeper's offer | The keeper's vault's owners, k of n |
| A new device's device cap | The passkey sign-in that adds the device, already an owner's act |
| An attenuation | A device of its holder (the host's, for an actor's message); with none, its holder's owners. No approval |
| A revocation, a keep order | Any device of a vault that may make it: it only takes away |
| Governance | The vault's owners, k of n ([avenID](../id/README.md)) |

Every grant needs its vault's owners' approval. Three things aren't grants and need none: a device's cap at its
sign-in, an attenuation, and a revocation.

**Decided:** caps D14; A28, A100  ·  **Lean:** `Aven.ID.Caps` — `root_authority`, `root_quorum`,
`grant_approved`; `Aven.ID.Authorized` — `own_authorized`, `authorized_vault`

## Chains

A chain is a cap and its parents, up to a root cap, written root first. Each link narrows the one before it. The
verifier computes what the chain allows, so nothing a cap says about itself widens it.

- **A grant** passes its parent on to a new holder, one share hop down, with its issuer's owners' approval.
- **An attenuation** narrows its parent for the same holder, shares no deeper, and is signed by a device of that
  holder. It grants nothing new, so it needs no approval. A cap that travels on in a message narrows per hop this way.
- **Every link** names its parent; its issuer holds the parent; its lines lie within the parent's; its share depth
  drops by its hops; its conditions are at least as strict.
- **A chain starts from authority.** Its root is an approved grant, attenuations follow approved grants, and a cap
  reaches a new holder only by an approved grant.
- **Delegating needs no one online.** The holder signs a child cap and writes it where its target's caps live.
- **A keep cap and a public cap never share** ([keep caps](#keep-caps-offers-and-placement)).

A reader checks the rules root first and names the first one a chain breaks:
- **the root** is a grant with no parent (`notRoot`), and every line lies in its issuer's authority (`authority`);
- **each link** names its parent (`parent`), is issued by a holder of it (`issuer`), keeps its holder if it attenuates
  (`holder`), lies within it (`wider`), shares less (`share`) and is at least as strict (`conditions`);
- **every cap** is issued by its issuer, by a device or its owners (`signer`), is approved if it is a grant
  (`approval`), shares nothing if it is public (`publicShares`) or keeps (`keepShares`), and names a group holder only
  if it is a `group` Doc (`group`);
- **an empty chain** is `empty`.

**Decided:** caps D3, D14; A27, A28  ·  **Lean:** `Aven.ID.Caps` — `narrow_chain`, `narrow_ops`, `chain_short`,
`attenuate_within`, `attenuate_signed`, `new_holder_granted`, `holder_granted`, `chainError_none`

## Collections

A collection is a Doc that lists Docs, like a smart album: "photos tagged beach from 2026". A cap names the collection
and reaches what it lists, for any op: read, keep, write (add to it) and tell. Shared folders and keep scopes are
collections.

- **It is a Doc of the sharing vault,** of the built-in type `collection`. Its vault's devices keep the list by any
  means: hand-picked, a query, a rule over facts, an actor, or an approved suggestion.
- **Each change is an envelope of the collection** a device of its vault signs: it adds a Doc as an entry, or removes
  entries, each named by the envelope that added it.
- **Only its vault's signed listings decide what it lists,** read from the collection Doc's past. An edit to a listed
  Doc, a tag included, changes no coverage, so anyone can check it, keepers too.
- **It stays in its vault's authority:** it lists only Docs of its own vault or of vaults its vault governs.
- **It is bounded:** collections nest at most 8 deep, counting the outer one. A deeper tree is shared by a cap on an
  inner collection.
- **A write is judged on its own past:** a write through a collection counts only if its Doc was listed in the
  write's past, so a list changes by its vault's own acts, never while a reader catches up on others' envelopes.
- **A Doc that leaves the list** leaves its holders' devices at their next sync ([holdings](#holdings-follow-caps)).

**Decided:** A32, A40, A42, A62, A76  ·  **Lean:** `Aven.ID.Collections` — `listed_by_issuer`,
`edit_keeps_coverage`, `content_no_listing`, `stranger_no_listing`, `listed_in_authority`, `listsAt_catch_up`

## Where caps live

Caps live where their checkers read them. A Doc's readers are exactly the ones who check its writes, so a cap on a Doc
is a Record in that Doc.

- **A Doc's caps and revocations** are Records of the built-in types `cap` and `revoke` in the Doc's access map,
  sealed with the Doc (its `epoch` Records are avenID's). Its readers see who else reads and writes it, and nobody else
  does.
- **A Record is its body with its signatures beside it,** under `sigs`: Core's signatures, sorted by signer, one each,
  within Core's limits, over the Record's one name, `[label, body]`. The label is implied by the Record's type and
  never stored. A cap Record's body is the [cap's body](#a-cap); a revoke Record's is the
  [revocation](#revocation-and-acks). Each reads back only from its one form, and caps gives avenDOCS the check for
  each type (`idBuiltinFit`).
- **Built-in Records are write-once:** a cap or revoke Record is never edited; a change is a new Record (A170).
- **A cap on a vault's Docs** lives in the group Doc that opens them.
- **A tell cap** lives with the receiver's vault, where its router checks it.
- **The built-in types caps makes** are `group`, `collection`, `cap` and `revoke`, each named by its label
  (`builtinType "avenID" name`), each a type Doc.

**A cap reaches its holder in a letter:** a Value sealed to the holder's vault key, with the sending device's hybrid
signature over its content and its recipient inside the seal, so no keeper sees who sent it and nobody can pass it on
as sent to someone else. It carries the cap, the ids of the target's Docs or group, and the holder's tag seed. The
first letter between two vaults goes to the recipient's letterbox, which takes a bounded number per sending device per
day; later ones use tags only the pair can compute. A letter only starts the pair's carrier Doc: after it, the two
talk in that Doc. Sealing, tags and letterbox keys are [avenID's](../id/README.md).

**Decided:** A30, A33, A39, A42, A45, A67, A104, A107, A170, A185  ·  **Lean:** `Aven.ID.AccessRecords` —
`CapRecord.ofValue?_value`, `RevokeRecord.ofValue?_value`, `idBuiltinFit_cap`; `Aven.ID.Types` — `builtin_typed`

## The envelope's authority

Every envelope says on what authority it writes and which revocations its writer has seen. That is the one Value caps
reads of an envelope's body. avenDOCS carries the Value whole and never reads inside it, checking only its canonical
form and limits.

```
authority: {"acks": [name…], "caps": [name…]}  |  {"acks": [name…], "caps": [name…], "actor": actor}
  acks:  the revocations its writer acknowledges
  caps:  the caps the envelope rests on, root first; [] on its vault's own authority
  actor: only when an actor host writes it: the actor whose chain it writes under
```

- Exactly one of the two shapes: `actor` is there for an [actor host's](#device-caps-and-actor-hosts) envelope, and
  left out otherwise.
- Keys in the codec's order, `acks` before `caps` before `actor`; no null.
- Each name is 32 bytes: a cap's name or a revocation's.
- The Value has one form: what reads back is written exactly so.
- A reader takes the chain and the acks from it, so the chain every revocation is checked against is the one the
  envelope names, and nothing about a write's authority is stored twice.

**Decided:** A27, A45, A106, A188  ·  **Lean:** `Aven.ID.Authority` — `Authority.ofValue?_value`, `value_ofValue?`,
`ofValue?_names` (in draft #1741; the `actor` shape to come)

## The reader's verdict

Every reader judges every envelope itself. avenCAPS gives one pure verdict over Core's types: the Doc's genesis vault,
the envelope with its signatures, its [authority](#the-envelopes-authority) and a view of its own past. It depends only
on those, so two readers holding that past agree. avenDOCS' import asks for it at two of its steps, through its
`Authorize` trait, which avenPEERS adapts to this verdict. Beside it, avenCAPS gives Core's counting `revoked`, a pure
function of the envelope and the revocations the reader holds ([revocation](#revocation-and-acks)).

- **Step 4, `reaches(genesis, signer)`:** the signer's device acts for a vault that holds some grant on this Doc. A
  stranger's envelope is refused here, before any of its bytes reaches Loro.
- **Step 7, `authorized(genesis, e, body, past)`:** judged on the envelope's own past, which the import holds whole
  before it asks. The signing device acts within its [device cap](#device-caps-and-actor-hosts), and the envelope
  writes on one of two paths:
  - **its vault's own authority:** the signer's vault is the Doc's vault, or governs it
    ([authority](#authority-and-issuing)), and no actor host signed it. `authority.caps` is empty. This is the most
    common write: an owner writing its own Docs.
  - **a chain,** named root first in [`authority.caps`](#the-envelopes-authority), which is:
    - **valid:** it keeps every rule of a [chain](#chains);
    - **held:** its last cap is held by the signer's vault, a group it reads, or the members for the public;
    - **covering:** its branches allow the envelope's branch, and for every call the envelope names, a line lists the
      op, covers the Doc and bounds the parameters. A host's envelope names its acting actor.
- **Revocations the reader holds** aren't part of `authorized`: they judge a write by what the reader holds, not by
  its own past, so they are `revoked`, which Core's counting takes beside `authorized`.
- **A merge into main** is judged on every call it brings onto main, not on the fixing commit's alone.
- **Counting is Core's.** An envelope counts when everything in its past is signed, fresh, authorized and fit, none of
  it is half of a split, and none of it is revoked. avenDOCS supplies fit, caps supplies `authorized` and `revoked`.
- **A count can turn.** A revocation the reader learns later discounts, as a split learned later does: the verdict
  stays, the envelope stops counting, and avenDOCS rebuilds the Doc's state from the envelopes that still count.
- **What the reader brings:** the register's tree (which device acts for which vault, and each vault's owners and
  threshold), the members, each Doc's birth facts, each device's cap, and the steps each call lowers to.

**Decided:** A27, A45, A137, A147, A169, A182  ·  **Lean:** `Aven.ID.Authorized` — `own_authorized`,
`chain_authorized`, `authorized_by`, `authorized_vault`, `chain_signer`, `chain_root`, `counts_iff`, `readers_agree`,
`merge_covered`, `authorizedB_iff`; to come: `revoked` (A182)

## Revocation and acks

A revocation ends a cap and every cap resting on it. It keeps what it names and wins over the rest: once readers hold
it, the revoked holder's writes it hadn't seen stop counting, in any order of arrival.

**A revocation** is a revoke Record, its value `{"cap": name, "kept": [name…], "envelope": name}`, named
`["avenID revoke 1", value]`. `kept` and `envelope` say where it takes effect, below; each is left out when unset,
never null.

| What ends | Who may end it | Its writes stop counting | Its reading ends |
|---|---|---|---|
| A cap | Its issuer, any issuer up its chain, the target's vault, or its holder (renouncing) | From its first ack in each Doc | At each Doc's next write |
| A device | Its vault's owners, by revoking its device cap | From the first ack of the removal in each Doc | Keyring at once; groups and Docs at their next use |
| A member | Maia City's owners, by revoking its member cap | The door closes on its devices at every peer; public caps stop reaching it | The members' key rotates at once |
| A ticket | Maia City's owners, by a withdrawal ([the register](#the-register)) | Nothing to stop before its claim | |

Only the revoker must be online. Rotation, which ends reading, is [avenID's](../id/README.md).

**The race.** A revocation and a write can cross. The race is a discount in Core's counting, as a split is: avenCAPS
supplies `revoked`, a pure function, and an envelope is discounted when the reader holds a counted revocation of a cap
in its chain that has taken effect in that Doc and whose kept past doesn't hold the envelope. A revocation learned
later discounts, as a split learned later does, and there is no settle order. Every reader holding the same envelopes
decides it the same way:
- **No laundering:** a revoked holder's envelope that has the revocation in its own past never counts, whatever anyone
  acknowledges.
- **A Doc cap** is revoked by a Record in that Doc, and only the revocation's own past is kept.
- **A cap whose revocation lives elsewhere** (a vault's Docs, a group, a device's removal) takes effect in each Doc at
  its kept list, when its revoker held the Doc, or at the first envelope of another writer there that acks it. Only
  what those had seen is kept. A writer who vouches this way could have written the same itself.
- **An ack** is a revocation's name in a writer's `authority.acks`: its mark that it has seen the revocation. It
  carries the revocation into Docs where it doesn't live.

Until a Doc has an ack, the revoked holder can still slip writes into it; how fast revocations spread bounds that
window. Honest offline work concurrent with a revocation is cut too: it shows as "didn't count", with the reason, and
someone still holding a cap can apply it again.

**The cascade.** An envelope names its whole chain, so revoking any link reaches it: one Record, no re-minting.

**A wait** names only what the envelope builds on and the reader lacks, by hash, and every wait raises the stall alarm.

**Expiry** is a revocation the clock makes. The first writer whose clock has passed it acks it, and from that ack on,
a write the ack hadn't seen doesn't count, whatever time it claims; nor does one claiming a time at or past it. Until
the first ack, a write is judged by the time it claims: the limit rule 12 accepts.

**Decided:** caps D8; A23, A147, A182, A184; rule 12  ·  **Lean:** `Aven.ID.Revoke` — `seen_never_counts`, `saw_iff`,
`doc_cap_kept`, `elsewhere_kept`, `revocation_wins`, `waits_named`, `Revocation.digest_inj`; `Aven.ID.Expiry` —
`time_acked`, `claimed_late`, `before_ack`; to come: `revoked` for Core's `Counts nm fit authorized revoked`

## Deletes

A Doc's vault can end the Doc for everyone: the right to be forgotten.

- **A delete** is a Record the Doc's vault writes in it, on its own authority. A delete by anyone else is no delete.
- **Once a reader holds it,** an envelope counts only if it is the delete or in its past: nothing written after it or
  beside it counts, whatever cap it writes under. Until then it changes nothing.
- **It depends on the envelopes named,** not on their order, so readers holding the same deletes and the same past of
  each agree.
- **Each device** drops the Doc's keys and bytes, and **each keeper** drops its bytes and serves none, for good
  ([keep orders](#the-gates-authority-half)). What a reader had seen can't be unseen.

**Decided:** A22, A40  ·  **Lean:** `Aven.ID.Revoke` — `delete_ends`, `undeleted_survive`, `deleted_agree`,
`liveWith_iff`; `Aven.ID.Keep` — `deleted_gone`, `deleted_final`

## Holdings follow caps

A device or keeper holds only what its caps cover: served is wants ∩ caps. So whenever its coverage shrinks, an honest
peer drops the bytes and keys at its next sync. One rule covers four cases: a delete, a Doc leaving a collection, a
revoked or narrowed cap, and a withdrawn keep cap. A copy someone deliberately took outside avenOS is beyond any
system's reach.

**Decided:** A40  ·  **Lean:** `Aven.ID.Holdings` — `holds_within_caps`, `keeps_covered`, `withdrawn_not_held`,
`deleted_not_held`, `delete_held`, `unlisted_not_held`

## Membership

Membership is a cap. Maia City's vault grants each member's vault a member cap, and that is what joining is. A member
shows its chain and anyone checks it, so no device needs a roster.

- **A ticket** (an invite) is `tree/1`'s `ticket` op, naming a one-time key, approved by Maia City's owners: a passkey
  tap. It is a cap from Maia City to the vault its claim founds. Its key only signs the claim, and holds nothing. A
  withdrawal is the ticket's revocation.
- **The confirm cap** is Maia City's standing grant to each confirmer vault the [setup](#its-setup) names: Aven's, so
  the Aven Peer confirms on its own. Its owners approve it once, and can revoke it or grant it to more vaults. It has
  one line: `tree/1`'s `confirm` on the tree Doc, any claim. The op itself admits only a standing claim of a ticket
  Maia City issued, not withdrawn and not already used, so a confirmer lets in nobody without a ticket. A device of a
  confirmer vault confirms, within its device cap.
- **The confirm envelope is the issuance.** A member cap is Maia City's act under its confirm cap, not the confirmer's
  own grant: the confirmer's owners approve nothing per member, and there is no second cap object and no signature of
  its own.
- **A member cap's lines,** fixed by `tree/1`'s confirm: `read` the chat Doc; `put` on it, bounded to the chat message
  type; and `tree/1`'s `signIn` on the tree Doc, no parameter bound, since a sign-in adds a device only to its own
  vault. No ticket line: tickets stay Maia City's own.
- **A reader counts a vault as a member** only by an authorized confirm on the tree Doc naming a claim that founded it,
  on its signer's vault's own authority or under a chain whose root allows that confirm.
- **The public is the members.** "Public" means the network's members everywhere, never everyone or the open
  internet.

**Decided:** caps D15; A28, A38, A42, A63, A105, A148; peers 5  ·  **Lean:** `Aven.ID.Member` —
`confirm_only`, `member_by_confirm`, `membersB_sound`, `claimOf?_some`

## Keep caps, offers and placement

Phones and browsers are rarely online at once, so some peers keep a Doc's sealed bytes for its readers: any member's
Peer, or the Aven Peer. Keeping is a role any peer can take, and none is special. Placement has one source, the
owner's vault: it says which keeper keeps which of its Docs, and a keeper says only what it offers.

- **A keep cap** is a grant like any other, from the vault to a keeper's vault, its lines `core/1`'s `keep` on
  targets: every Doc of the vault, of one type, or what a collection lists. The Values a Doc's Records name, a file's
  chunks among them, are kept with it.
- **The owner always decides.** A keep cap may not share, so no keeper passes data on: a chain that keeps has one
  holder, and every link after its root only attenuates. A cap keeps a Doc only as its root does, a grant by a vault
  with authority over it. Neither Maia City nor a keeper can extend it; a new keeper needs a new keep cap from the
  owner.
- **An offer cap** is the keeper's own: its vault grants a vault or a group the op `keep-offer` on the keeper's vault,
  with `quota` in bytes and `rate` in bytes a second, each bounded to one value. The offers Maia City's members hold
  are the list of keepers; there is no other.
- **Keep caps ∩ offers.** A keeper keeps a Doc only where both hold: the owner's keep cap names it, and the keeper's
  own offer, valid and not withdrawn, covers that owner.
- **The default.** A new vault's claim carries one keep cap: issuer the new vault, holder Aven's vault (the Aven Peer
  keeps), `keep` on the vault's own Docs, not below, share 0, no device signer, approved by the owner key from the
  claim's own passkey tap. `Cap.isDefaultKeep` checks a claim's cap says exactly that. It is an ordinary grant: without
  its owner's approval it breaks the chain's `approval` rule. The vault can withdraw it or add others. A vault it
  governs keeps its own default. A member migrated from production approves it at its next sign-in, where avenOS shows
  what it covers and to whom.
- **A keeper learns a Doc's owner from the keep cap's issuer,** never from the Doc, which it can't read.
- **A second keeper** of the vault's choice keeps its Docs fetchable when any one peer is lost, the Aven Peer included.

**Decided:** caps D21, D24; A22, A44; peers 8  ·  **Lean:** `Aven.ID.Keeping` — `keeps_iff`,
`resolve_exact`, `keepers_by_caps`, `holder_keeps`, `keep_one_holder`, `keeper_named_by_owner`, `keepers_by_owner`,
`default_kept`, `default_approved`, `default_needs_owner`, `isDefaultKeep_kept`, `isDefaultKeep_approved`;
`Aven.ID.Keep` — `kept_only_offered`; `Aven.ID.Node` — `kept_fetchable`

## The gate's authority half

A keeper is blind: it holds no Doc key, and reads no caps but the keep caps it holds and its own vault's offers. So it
decides who may upload or fetch by key proofs. avenCAPS gives the gate two answers: whether a proof on this connection
is served for a Doc, and how much a vault may keep. The frames, the arrivals and the bills are
[avenPEERS'](../peers/README.md).

**Fetch keys.** Each Doc epoch has a fetch key: Ed25519, its seed `derive_key("avenDB fetch key 1", the epoch's key)`.
Every reader of the epoch derives it. A forged proof yields only post-quantum-sealed ciphertext; the accepted risk is
that a quantum forger could spend a vault's keeper quota.

**The records,** each Core's signed thing, its signatures beside it, each body exactly its own keys, none null and none
optional, in the codec's order. A Doc id and a name are 32 bytes; a key is an Ed25519 public key, 32 bytes.

| Record | Label | Body | Signed by |
|---|---|---|---|
| Listing | `avenID keep listing 1` | `{"cap": name, "docs": [{"doc": id, "key": fetch key 0}…]}` | A device acting for the keep cap's issuer, or its owners k of n |
| Fetch link | `avenDB fetch link 1` | `{"n": n, "doc": id, "key": fetch key n, "prev": name, "epoch": epoch name}` | Fetch key n − 1 |
| Keep order | `avenID keep order 1` | `{"act": "withdraw", "cap": name}` or `{"act": "delete", "doc": id}`: two exact shapes | As the listing |
| Choice | `avenID keep choice 1` | `{"doc": id, "fork": key, "branch": key}`: the fork point and the branch to follow | A device of the vault that issued the keep cap |
| Proof | `avenDB fetch 1` | `{"doc": id, "exporter": bytes}` | The Doc's current fetch key, or a branch's newest while a fork is unsettled |

- **The listing** is the keep cap's issuer resolving its target to exactly the Doc ids it covers, each with its first
  fetch key, number 0. A keeper can't read a Doc's facts, so it takes the listing as the cap's coverage.
- **A fetch link** n ≥ 1 names key n and is signed by key n − 1; `prev` is the previous link's name, and for link 1
  the listing's. So every key a keeper takes chains back to the listing, and nobody who never held one of the Doc's
  fetch keys can change it.
- **The current key.** A keeper keeps every successor. Where two links follow one key, it takes the one with the
  smaller epoch hash, at each fork from the listing on, as writers do, and flags the fork. Keepers holding the same
  links agree on the current key, whatever order the links came in.
- **A ground fork.** A removed reader still holds its last fetch key, so it can fork from there and grind its epoch
  hash below the writers'. Writers check the rotation's cap and never take it; a keeper can't. So while a fork is
  flagged, the keeper serves a proof by any branch's newest key, and honest readers are never refused. A device of the
  keep cap's issuer, which can check caps, signs a Choice naming the fork point and the branch; the keeper follows it,
  and later forks from that point change nothing.
- **Keep orders** only take away. A withdrawal drops what that keep cap covered and serves it no more; what other keep
  caps cover stays, and a device of another vault can't withdraw it. A delete drops the Doc's bytes for good, whatever
  keep caps and orders come after.
- **The proof** signs the TLS exporter of the connection that serves; the exporter, its length and its label are
  [the fetch gate's](../peers/README.md#the-fetch-gate). A keeper serves a fetch, and takes an upload, only on a proof
  by the current fetch key, or a branch's newest while a fork is unsettled. The five labels differ, so no signature
  over one record reads as another's.
- **Signers are checked against the register's tree:** which device acts for which vault, and each vault's owners.

**What the gate answers,** caps' half of `Gate {serves, quota}`, exactly the fetch-key chain, `Keep.serves`,
`Books.keeps` and `Books.quota`:
- **`serves(doc, proof)`:** the keeper keeps the Doc (a valid keep cap that names the keeper lists it, an offer covers
  its issuer, not withdrawn, not deleted) and the proof is by its current fetch key; the answer names the vault the
  proving device acts for.
- **`quota(vault)`:** the largest quota of the keeper's valid offers that cover the vault.

Bills and admission are the keeper's: what a vault's held items cost, and whether an upload fits its quota
([avenPEERS](../peers/README.md#keepers)). `Aven.Architecture` composes rule 10's quota from `Books.quota` and the
keeper's admission.

**Decided:** caps D21; A22, A44, A141, A142, A153, A161, A163, A167, A173, A185  ·  **Lean:** `Aven.ID.Keep` —
`fetch_chain`, `kept_every`, `current_agrees`, `current_chained`, `fork_flagged`, `served_current`, `fork_served`,
`grind_example`, `grind_settled`, `settled_example`, `kept_only_covered`, `kept_only_by_owner`, `kept_by_owner`,
`withdrawn_dropped`, `withdrawn_not_served`, `others_kept`; `Aven.Architecture` — `rule10_quota`; `Aven.ID.KeepCbor` —
`labels_distinct`, `link_name_inj`, `listing_name_inj` (pending in #1739)

## The register

Maia City's register is the tree: a Doc of type `tree` in Maia City's vault, whose envelopes are calls of `tree/1`'s
ops. It holds the network's setup, its tickets, claims, confirms, sign-ins, passkey records, owners and settings. Every
peer settles it the same way from the same envelopes, whatever order they came in, so no peer is the authority on who
is in.

It is sealed to the members, like every Doc the public reads. A browser reads it only once the door admits it; before
that, the door's answers are all it needs.

Each envelope's calls are `tree/1` calls, `{op, params}`, each op named by the hash of
`{"op": name, "plugin": "tree/1"}`. The register supplies the tree type's fit and its verdict as pure functions, which
avenPEERS hands to avenDOCS, and settles over what counts.

**Decided:** A12, A30, A39, A42, A45, A68, A135, A148, A169  ·  **Lean:** `Aven.ID.TreeDoc` —
`settleDoc_envelopes`; `Aven.ID.Network` — `TreeSays.ofValue_toValue`, `TreeOp.ofId_id`

### Its setup

The tree Doc's genesis is an ordinary Doc genesis. Its setup is the root Record its first envelope writes: a built-in
type, which fit takes whole at birth and refuses to edit. Later changes to a setting are `tree/1` ops, the latest
settling it.

**It names:**
- the RP ID and avenOS's origins;
- the claimant's vault, its passkey record and its first devices;
- Maia City's vault, the admin coop, and the vaults that own it;
- Aven's vault, the agent the coop owns, and the Aven Peer's device key;
- MaiaCityGuardian's vault and its hybrid keys: its key owns that vault, which co-owns each person's vault;
- the confirmer vaults, which hold Maia City's [confirm cap](#membership).

**It founds the network's own vaults:** each gets its genesis here, with fresh nonces in production and fixed ones in
the cast. A person's vault and its claiming browser's device vault are founded in its claim, a device's vault in the
sign-in that adds it, and a later vault in its governing vault's statement. How a genesis names a vault is
[avenID's](../id/README.md).

**It is signed** by the claimant's passkey, whose owner key its PRF gives at the signing, and by MaiaCityGuardian's
hybrid keys. Every member pins the tree Doc, and an envelope belongs to it when its signed `doc` is that Doc, with
avenDOCS' genesis check.

**Decided:** A11, A13, A28, A42, A115, A146, A149, A164  ·  **Lean:** `Aven.ID.Network` — `genesis_pinned`,
`settle_genesis`, `guardian_consented`

### Its ops

| Op | Params, in codec order | Signed by | What it does |
|---|---|---|---|
| `ticket` | `{key}` | Maia City's owners | Issues a ticket for that one-time key |
| `withdraw` | `{ticket}` | Maia City's owners | Revokes a ticket |
| `claim` | `{vault, ticket, devices, passkey, guardian}` | The ticket's one-time key | Founds `vault` with its passkey record and devices, and names the guardian vault it consents to; carries the default [keep cap](#keep-caps-offers-and-placement) |
| `confirm` | `{claim}` | A confirmer vault, by a device or its owners | Makes the claim final and issues its vault's member cap |
| `signIn` | `{device}` | A passkey's ES256 and its owner's hybrid key | Adds the device to that passkey's own vault, with its device cap |
| `ownerEpoch` | `{seal, epoch, owner, credential}` | The passkey's ES256 alone | Adds the owner and seal keys its PRF derives |
| `relayAdd`, `relayRemove` | `{vault}` | Maia City's owners | The relay list, which names vaults |
| `setAvenPeer`, `setOrigins`, `setGuardian` | `{key}`, `{origins}`, `{vault}` | Maia City's owners | Changes what the setup named |
| Owner change | a vault, its owners and its threshold k | The vault's owners in force in its own past | Governance of a vault ([owners](#owners-k-of-n)) |

- **A claim names the guardian vault it consents to:** one the setup or an approved `setGuardian` in its past named.
  The guardian setting names which guardian vault new vaults are founded with; it never changes who owns a vault
  founded before it.
- **Relays** are [avenPEERS'](../peers/README.md); the register only holds Maia City's list.

**Decided:** A13, A28, A38, A42, A43, A44, A68; peers 12  ·  **Lean:** `Aven.ID.Network` —
`config_by_admin`, `admin_by_owners`, `device_not_admin`

### Passkeys and sign-ins

**A passkey record** maps a WebAuthn credential to its vault:

```
{"seal": seal key, "spki": ES256 key, "epoch": owner epoch,
 "owner": {"mlDsa", "ed25519"}, "credential": credential id}
```

The owner's hybrid key and the X-Wing seal key come from the passkey's PRF ([avenID](../id/README.md)). A record lives
in the setup or in a claim, and `ownerEpoch` adds its owner and seal; until then both are left out, never null.

- **A sign-in names only its device.** The credential id travels beside the signature as an unsigned hint, and the
  device joins the vault of the passkey that signed. It needs that passkey's owner beside the ES256: two signatures
  beside one name.
- **A passkey without an owner** signs nothing but `ownerEpoch`, which adds one. Only a record migrated from
  production lacks one.

**Decided:** A42, A43, A103, A184  ·  **Lean:** `Aven.ID.Network` — `signIn_own_vault`,
`ownerless_only_adds_owner`

### Owners, k of n

What changes who is in or who sees whom (tickets, withdrawals, the relay list and the settings) counts only with Maia
City's owners' approval, k of n through the vaults that own it, resting on owner keys: passkeys and MaiaCityGuardian,
never a device's key. A stolen browser can't let anyone in. How owners approve, and each vault's threshold, are
[avenID's](../id/README.md#approvals-k-of-n); the register holds the acts that change them.

- **An owner change** sets a vault's owners and its threshold k. It is approved by the owners in force in its own
  past, and judged on Core's `Counts`, its whole past held (`Closed`). Concurrent owner changes settle as the settings
  do, the latest by the past and ties by the smallest name, the same at every peer.
- **A removal beats the removed owner's concurrent acts:** an owner change that drops a key beats every act that key
  approved outside the change's own past. An act already in its past stays counted.
- **A removal never undoes finality.** It beats only acts no final claim rests on: whatever is in the past of a counted
  confirm stays, as a withdrawal never beats a final claim.

**Decided:** A28, A42, A116, A185, A191; peers 12  ·  **Lean:** `Aven.ID.Network` — `admin_by_owners`,
`device_not_admin`; to come: `setOwners`, `owners_perm` and `removal_beats`

### Settling

`settle` is a pure function from the set of envelopes that passed their own checks to the tree:

1. **Tickets and withdrawals:** a withdrawal of a ticket wins over every claim of it that isn't final and isn't in the
   withdrawal's past. A withdrawal with a claim of its ticket in its past changes nothing: the ticket was used.
2. **Finality:** a claim is final once a confirm names it and has it in its past, and a withdrawal never wins over a
   final claim. A confirmer confirms only the claim that stands in its own view, never a second claim of a ticket that
   already has a final one there.
3. **One claim per ticket:** a final claim wins over the rest; among final claims, or among standing ones when none is
   final, the smallest hash wins. Two final claims of one ticket come only from confirms that never saw each other; the
   ticket then shows as contested.
4. **Lists:** a remove wins over every add of the same vault that hadn't seen it; an add with the remove in its past
   puts the vault back.
5. **Settings and owners:** the latest by the past, ties by the smallest name.
6. **Members:** only a final, standing claim's vault is a member. [The door](../peers/README.md#the-door) admits
   exactly the member vaults' devices, the same at every peer.

A claim waits for its confirm, usually a moment, since the Aven Peer confirms on its own. Until then it can lose to a
withdrawal Maia City signed without seeing it, or to a competing claim with a smaller hash; both need a leaked link or
a double tap.

**Decided:** A12, A38; peers 4, 5, 6  ·  **Lean:** `Aven.ID.Network` — `settle_perm`, `settle_ticket_once`,
`settle_withdrawn`, `settle_final`, `settle_listed`, `settle_door`, `ticket_once`; `Aven.ID.Admit` —
`honest_confirm_once`

### Production's register

Production is never wiped (A186). At the switch its stored statements become tree envelopes after the setup, each naming
the one before it, and every one of them counts.

- **The snapshot.** Production's sign-ins aren't replayed. The claimant's go into the setup's devices, with the
  claiming browser; each member's go into its join's claim, with the join's browser. The ref order keeps only invites,
  withdrawals, joins and confirms. Every device production admits before the switch is admitted after it.
- **Member caps.** Each stored join is confirmed once, under Maia City's approval, when the setup is signed.
- **Passkey records.** The claimant signs the setup in avenOS, so its record has its owner and seal. A migrated join's
  record has its credential and key, and no owner or seal until its first sign-in adds them by `ownerEpoch`. A migrated
  passkey without PRF keeps its vault's devices and adds none until a PRF passkey gives its vault an owner.
- **New names.** The setup is signed with fresh nonces, so production's vaults get new names.
- **The guarantee,** checked on production's own store before anything switches, with the functions Lean exports:
  every stored statement counts and the settled door admits exactly the store's device keys; `isClean` holds; and
  `oldSideAgrees` holds.
- **Two releases, no dual mode.** Release N runs both checks read-only and logs only the verdict and counts. The
  claimant then signs the setup. Release N+1 runs them again and switches; if a check fails, it refuses, the deploy
  fails and says why, and production stays on release N.

**Decided:** A42, A43, A55, A103, A164, A186  ·  **Lean:** `Aven.ID.Restore` — `settle_restore`;
`Aven.ID.RestoreDoor` — `settle_restore_door`

## Attacks and what holds

| Attack | What holds | Lean | Status |
|---|---|---|---|
| Mint caps with a stolen device | Every grant needs its issuer's owners' approval; the heal replaces the vault's keys | `grant_approved` | covered |
| Launder a revoked holder's writes through a late ack | An envelope with the revocation in its own past never counts; under a Doc cap only the revocation's past is kept | `revocation_wins` | covered |
| Name a revocation or key that never comes | A wait names only what is named by hash, and raises the stall alarm | `waits_named` | covered |
| Play with clocks around expiry | Expiry is acked; a write the ack hadn't seen doesn't count | `time_acked` | partial: until the first ack, a write is judged by its claimed time (`before_ack`) |
| Keep a group cap's children alive after their issuer leaves | A child lives only while its issuer is in the group | `child_live` | covered |
| Keep network caps after removal | Public caps reach only members; the members' key rotates at once | `public_member`, `removal_rotates` | covered |
| Pass on a read key without approval | Approvals bind writes, `share` and `tell`; reading is holding a key | — | accepted |
| Spoof a fetch-key change, or upload junk | Fetch keys chain from the listing; only the current key's proof is served; a ground fork is settled by the issuer's Choice | `fetch_chain`, `served_current`, `grind_example` | covered |
| A quantum forger's fetch proof | It yields only post-quantum-sealed bytes and spends a vault's quota | — | accepted |
| Swap the guardian by configuration | The setup names the guardian's vault and keys; every claim names the guardian vault it consents to | `guardian_consented` | covered in Lean |
| Hold the door and the tree | The tree settles the same everywhere from the pinned setup; the door is a function of it | `settle_perm`, `settle_door` | covered in Lean |
| Let someone in from a stolen browser | Admin acts need Maia City's owners, never a device key | `admin_by_owners`, `device_not_admin` | covered in Lean |
| Claim one ticket twice | Finality by confirm; the smallest hash wins | `ticket_once`, `settle_ticket_once` | covered |
| Act with a removed owner's key on an old past | A removal beats every act that key approved outside its past, unless a final claim rests on it | — | decided; pending |
| Make an actor act as a confused deputy | A turn's effects carry the handled message's cap; hosting is the owner's explicit choice | — | accepted; `no_confused_deputy` pending in `Aven.Architecture` |
| Flood a letterbox | The signature inside the seal binds the recipient; letterboxes rate-limit first letters | — | covered |

**Decided:** A13, A16, A22, A23, A28, A161, A191; caps D14, D15

## Status

The Lean is `Aven.ID` in `id/spec`, the Rust the `aven-id` crate in `id/core`, until the split into `caps/spec`
(`Aven.Caps`) and the crate `aven-caps` (A159, A160).

| Part | Lean | Rust | Pending and gaps |
|---|---|---|---|
| Caps, chains, conditions, roles | `Caps`, `CapsCbor` | `caps` module, held to `caps.json`, `issuers.json` (#1702, #1716) | Approvals still use caps' own `Sig {key, digest}` in `Approve`; they become Core's `Sig`s over the cap's signing bytes, with vectors signed for real by the cast's test keys, in one PR of caps' Lean and vectors with minimal caps' Rust (A45, A189); `pluginOp`, `typeParam` and `fieldsParam` repeat Core's (caps' A45 PR, on no branch); vaults are named by text in the cap and the context, and switch to plain 32-byte names in one step now that `Aven.ID.VaultName` is on main (#1738, A162, A164, A190): avenCORE's `claude/aven-core-logs`, then avenID's PR, back to back; a cap writes `role`, `parent`, `uses` and `expires` as null when unset, and leaves them out and refuses a null (A184): `CapsCbor` and `caps.json` to come, free while nothing stored uses them; a parent and a role are text in the cast until R5 |
| The reader's verdict | `Authorized` | `caps::Reader`, held to `authorized.json` and `member.json` (#1702, #1736) | `Reader` doesn't yet take the envelope's `authority` part or a view of its past (A169); avenPEERS' adapter to avenDOCS' `Authorize` isn't written; no `reaches`; `counts_iff` folds liveness (`live`) into the `authorized` it hands Core (`Reader.Admits`), and it becomes Core's third parameter, `revoked` (A182); the per-act `approve`, `own` and `uses` conditions aren't in the verdict, and expiry is modelled apart (`Expiry`) |
| The envelope's authority | `Authority`, in draft #1741 (`claude/avenid-a45`), its own PR after the Keep PR (A173) | — | `authority.json` comes with it; the second shape, `{acks, caps, actor}`, to come in #1741 (A188); avenDOCS' body still carries `acks` and `cap` apart (docs' A45 PR) |
| Revocation, expiry, deletes | `Revoke`, `Expiry` | `caps::revoke`, held to `revocations.json` | `expiry.json` not replayed in Rust; the model's reader holds one Doc; a group cap's writes (`group_holds`) not in Lean; a revocation writes `kept` and `envelope` as null when unset, and leaves them out and refuses a null (A184), with its vectors: to come |
| Collections, holdings | `Collections`, `Holdings` | — | `collections.json` not replayed in Rust |
| Records in a Doc, built-in types | `AccessRecords`, `Types` | `caps::records`, held to `access.json` (#1716) | — |
| Membership | `Member` (#1674, #1717, #1735) | `caps::member`, held to `member.json` (#1736) | No op or Lean yet for revoking a member cap |
| Keep caps, offers, the gate | `Keeping`, `Keep` (#1642, #1695, #1725) | `keep` module, held to `keep.json` (#1734) | The records' bytes and the fetch-key derivation: `KeepCbor` and `keep-bytes.json` pending in #1739, their Rust in #1740; `bill`, `uploader_pays`, `quota_holds` and `admitted_served` leave `Keep` in #1739, after #1722 (A141, A173); the keeper calls the gate as `Gate {serves, quota}` in #1722 |
| The register | `Network`, `TreeDoc`, `Restore`, `RestoreDoor`, `Admit` (#1656, #1671, #1696, #1705, #1718) | The first generation's door in `id/core` (`network.rs`, `members.rs`, `claim.rs`, `invite.rs`) until stage 4 | Stage 4: the setup as the root Record (Lean still has the `genesis` op); stored thresholds (`Vault.threshold`, k ≥ 1 in `WF`, on `claude/aven-peer-k-of-n`, no PR yet), then the owner-change op judged on Core's `Counts` with `Closed` (`setOwners`, `owners_perm`) and `removal_beats` that never undoes a final claim (`settle_final`), in avenPEER's PR 2 (A191); the passkey record writes `owner` and `seal` as null until `ownerEpoch`, and leaves them out and refuses a null (A184), with its vectors; `byAdmin` reads only the setup's tree with k = 1; belonging by the pinned `doc` and Core's `Counts` in place of Network's `counted`; the claim's default keep cap and the sign-in's optional one; the sign-in as the device cap's issuance; `treeType` as `builtinType "tree"`. `settled.json` and `tree-ops.json` not replayed outside Lean. Docstrings still say "admin passkey" (`Network`) and "acks" (`Admit`); `Recover`'s `removals_win` gives way to the owner-change rule |
| Not caps' | `Records`, `Node`, `CatchUp` sit in `Aven.ID` | — | avenPEERS' (A45); they move to `peer/spec` with the wire, `Aven.ID.Records` as `Aven.Peer.History` (A193, A194) |
| Planned elsewhere | — | — | `no_confused_deputy` and `upgrade_no_wider` in `Aven.Architecture` (they need `Aven.Actor`); `want_grants_nothing` and `one_grammar` with Core's targets |

## Open questions

- **A vault-wide cap in a one-Doc reader's hands.** `authority.caps` names a chain by its caps' names. A cap on a
  vault's Docs lives in a group Doc that a reader given one Doc can't open. Where that reader finds the cap's body:
  caps and avenDOCS propose, the architect decides.
