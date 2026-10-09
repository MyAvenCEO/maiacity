import AvenDB.Props
import AvenDB.Lemmas
import AvenDB.CapLemmas
import AvenDB.RelayLemmas
import AvenDB.KeyLemmas
import AvenDB.SyncLemmas

/-!
# The theorems

What must always hold, stated over the executable model. T9 (lenses) and T10 (proposals) are proven in their own files.
The proofs are in `Lemmas.lean` (vaults and writes), `CapLemmas.lean` (caps, cells, removals and replay),
`RelayLemmas.lean` (blind relays), `KeyLemmas.lean` (keys) and `SyncLemmas.lean` (convergence and sync); the
predicates the statements use are in `Props.lean`.

The assumptions are part of the model rather than axioms: an edit's signers are the keys that signed it (signatures
can't be forged); keys are learned only through `Knows` (sealed, wrapped or encrypted data reveals nothing without its
key, and a derived key nothing of what it derives from); ids don't collide (a hypothesis where needed: `Nodup`, or that
an id two peers both hold names one edit); and Loro's laws are fields of `Loro`.
-/

namespace AvenDB

/-! ## Writes -/

/-- T1 (authorized writes only): a step adds a write to an entry that exists only if, just before it, the write's
    author acted for its actor through the owners the write names, and that vault could write the entry: it is the
    entry's vault, or holds a live cap with write or more that reaches the entry's cell. -/
theorem T1_authorized_writes {st st' : State} {edit : Edit} (h : step st edit = some st') {w : Write}
    (hw : w ∈ st'.writes) (hnew : w ∉ st.writes) (hfirst : w.first = false) : authorized st w = true :=
  Core.T1_authorized_writes h hw hnew hfirst

/-- T1, new entries: a step creates an entry only with its first write, whose author acted for its actor, which is the
    entry's vault or created the entry in the intake cell of a live cap with write or more that it held. -/
theorem T1_created_entries {st st' : State} {edit : Edit} (h : step st edit = some st') {en : Entry}
    (hen : en ∈ st'.entries) (hnew : ∀ x ∈ st.entries, x.id ≠ en.id) :
    ∃ w ∈ st'.writes, w.edit = edit.id ∧ w.entry = en.id ∧ w.first = true ∧
      actsVia st w.author w.via w.actor = true ∧ mayCreate st w.actor en.vault en.cell = true :=
  Core.T1_created_entries h hen hnew

/-- T1, second half (revocation wins): an older write that a step takes the authorization from survives only if
    the step is a removal that had seen it: a revocation, a vault losing an owner or a device, or a move that took the
    entry out of a cell the write relied on. -/
theorem T1_revocation_wins {st st' : State} {edit : Edit} (h : step st edit = some st') {w : Write}
    (hw : w ∈ st'.writes) (hold : w ∈ st.writes) (hwas : authorized st w = true)
    (hnow : authorized st' w = false) : ∃ keep, edit.action.keep? = some keep ∧ w.edit ∈ keep :=
  Core.T1_revocation_wins h hw hold hwas hnow

/-! ## Vaults -/

/-- T2 (governance threshold): when a step changes a vault's owners, threshold or devices, the edit carries the
    vault's approval (its threshold of owners, recursively down to signers), or an owner or a device removes
    itself. -/
theorem T2_governance {st st' : State} {edit : Edit} (h : step st edit = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt')
    (hchg : vt.owners ≠ vt'.owners ∨ vt.threshold ≠ vt'.threshold ∨ vt.devices ≠ vt'.devices) :
    approves st edit.sigs (.vault v) = true ∨
    (∃ p, vt'.owners = vt.owners.erase p ∧ approves st edit.sigs p = true) ∨
    (∃ d, vt'.devices = vt.devices.erase d ∧ d ∈ edit.sigs) :=
  Core.T2_governance h h₁ h₂ hchg

/-- T2, consent: an owner or a device is added only with its own signature. -/
theorem T2_consent {st st' : State} {edit : Edit} (h : step st edit = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt') :
    (∀ p ∈ vt'.owners, p ∉ vt.owners → approves st edit.sigs p = true) ∧
    (∀ d ∈ vt'.devices, d ∉ vt.devices → d ∈ edit.sigs) :=
  Core.T2_consent h h₁ h₂

/-- Devices don't govern: signatures that include neither an owner signer nor the root never approve for a human
    vault. -/
theorem device_cannot_govern {st : State} {v : VaultId} {vt : Vault} (h : st.vault? v = some vt)
    (hsig : ∀ p ∈ vt.owners, ∃ s, p = .signer s) (hth : 0 < vt.threshold) (sigs : List SignerId)
    (hnone : ∀ s ∈ sigs, Principal.signer s ∉ vt.owners) (hroot : ∀ r, vt.root = some r → r ∉ sigs) :
    approves st sigs (.vault v) = false :=
  Core.device_cannot_govern h hsig hth sigs hnone hroot

/-- Devices don't govern any vault: signatures by signers that own no vault and are no vault's root approve for no
    vault, as every vault's approval comes down to its root or its owner signers. So a server, a device of avenCEO,
    governs neither avenCEO nor anything else. -/
theorem devices_cannot_govern {st : State} {sigs : List SignerId}
    (hnone : ∀ s ∈ sigs, ∀ v vt, st.vault? v = some vt → Principal.signer s ∉ vt.owners ∧ vt.root ≠ some s)
    (hth : ∀ v vt, st.vault? v = some vt → 0 < vt.threshold) : ∀ n v, approvesN st sigs n (.vault v) = false :=
  Core.devices_cannot_govern hnone hth

/-- T21 (vaults by kind): in every reachable state, signers own human vaults only; coop and aven vaults are owned by
    human and coop vaults; a coop has no devices; and only a human vault has a root. So an edit for a coop always goes
    through a human vault its device or passkey belongs to, and so does an edit for an aven vault that none of its own
    servers signs. -/
theorem T21_vault_kinds {st : State} (hr : Reachable st) : KindsFit st :=
  Core.T21_vault_kinds hr

/-- T3 (no ownership cycles): in every reachable state the vault graph is acyclic, so every chain ends in signers. -/
theorem T3_no_cycles (edits : List Edit) : Acyclic (replay {} edits) :=
  Core.T3_no_cycles edits

/-! ## Caps -/

/-- T4 (caps name vaults): no step adds a cap that names a signer. -/
theorem T4_caps_name_vaults {st st' : State} {edit : Edit} (hinv : CapsNameVaults st) (h : step st edit = some st') :
    CapsNameVaults st' :=
  Core.T4_caps_name_vaults hinv h

/-- T8 (Public is read-only): Public only ever gets read. It can't write or share either, since writes and caps act for
    a vault. -/
theorem T8_public_read_only {st st' : State} {edit : Edit} (hinv : PublicReadOnly st) (h : step st edit = some st') :
    PublicReadOnly st' :=
  Core.T8_public_read_only hinv h

/-- T22 (a cap grants no more than the caps it rests on): in every reachable state a cap that rests on another is over
    the same vault, rests on an owner cap issued to its own issuer, and whatever its slice holds, the slice of the cap it
    rests on holds too; and a wide cap rests only on a wide cap. -/
theorem T22_slices_narrow {st : State} (hr : Reachable st) {c pc : Cap} (hc : c ∈ st.caps) (hp : c.parent = some pc.id)
    (hpc : pc ∈ st.caps) :
    pc.over = c.over ∧ pc.role = .owner ∧ pc.grantee = .principal (.vault c.issuer) ∧
      (∀ a, effSelects st c a = true → effSelects st pc a = true) ∧ (c.wide = true → pc.wide = true) :=
  Caps.T22_slices_narrow hr hc hp hpc

/-- T23 (cells mean what the caps say): where an entry's cell, revoked caps left aside, is its semantic cell, the write
    rule every peer checks without reading a selector, a type or a tag allows exactly the vaults the caps' selectors
    allow. -/
theorem T23_cells_mean_slices {st : State} (hr : Reachable st) (en : Entry) (hcell : liveCell st en = semCell st en)
    (a : VaultId) : mayWrite st a en = semWrite st a en :=
  Caps.T23_cells_mean_slices hr en hcell a

/-- T23, new entries: the rule every peer checks never refuses a creation that stays inside its creator's slice. -/
theorem T23_creations (st : State) (a v : VaultId) (x : Cell) (attrs : Attrs) (h : admits st a v x attrs = true) :
    mayCreate st a v x = true :=
  Caps.T23_creations st a v x attrs h

/-! ## The schema lane -/

/-- T17: only a vault, or a vault holding a wide owner cap over it, publishes its schemas and lenses. A step adds to a
    vault's lane only if it publishes that blob into that vault, and just before it, its author acted for such a vault
    through the owners it names. -/
theorem T17_lane_by_owners {st st' : State} {edit : Edit} (h : step st edit = some st') {x : VaultId × BlobId}
    (hx : x ∈ st'.lane) (hnew : x ∉ st.lane) :
    ∃ actor via, edit.action = .publish x.1 actor x.2 via ∧ actsVia st edit.author via actor = true ∧
      ownsLane st actor x.1 = true :=
  Core.T17_lane_by_owners h hx hnew

/-! ## Causal closure -/

/-- T14 (accepted writes are causally closed): no step accepts a write before what it builds on, and a removal that
    drops a write drops every write that builds on it. -/
theorem T14_causally_closed {st st' : State} {edit : Edit} (hinv : CausallyClosed st) (h : step st edit = some st') :
    CausallyClosed st' :=
  Core.T14_causally_closed hinv h

/-- T14, entries: in every reachable state every accepted write is of an entry that exists, and every entry's first
    write is accepted. -/
theorem T14_entries_whole {st : State} (hr : Reachable st) :
    (∀ w ∈ st.writes, ∃ en ∈ st.entries, en.id = w.entry) ∧
    (∀ en ∈ st.entries, ∃ w ∈ st.writes, w.entry = en.id ∧ w.first = true) :=
  Core.T14_entries_whole hr

/-! ## What a peer knows -/

/-- The view is the replay of the edits that stand in it. -/
theorem view_eq_replay (edits : List Edit) : view edits = replay {} (standing edits) :=
  Caps.view_eq_replay edits

theorem view_reachable (edits : List Edit) : Reachable (view edits) := ⟨_, view_eq_replay edits⟩

/-- Every peer's writes come in an order their dependencies respect, so `Proposals.lean`'s T10f to T10h hold of what
    every peer shows on every line. -/
theorem writes_ordered (edits : List Edit) : Ordered (view edits).writes :=
  Caps.writes_ordered edits

/-! ## Strong removal -/

/-- T16 (strong removal), replaying `edits` with the removals `rem`: an edit stands only if `apply` accepts it on the
    state just before it (the replay of the edits that stood before it) with the facts hidden from it taken away; and
    those facts include everything each removal of `rem` after it takes away, unless that removal had seen it. A move's
    fact is the cell it put the entry in, so a write it hadn't seen stands only if its writer may write there too. -/
theorem T16_strong_removal (edits rem : List Edit) (pre post : List (Edit × Nat)) (x : Edit) (i : Nat)
    (hsplit : edits.zipIdx = pre ++ (x, i) :: post)
    (hstood : (runFrom rem (cuts edits rem) (runFrom rem (cuts edits rem) {} pre).1 [(x, i)]).2 = [x]) :
    (apply (hide (replay {} (runFrom rem (cuts edits rem) {} pre).2) (hiddenAt (cuts edits rem) i x)) x).isSome ∧
    ∀ r j, edits[j]? = some r → rem.any (·.id == r.id) → i < j → x.id ∉ r.action.keep?.getD [] →
      ∀ f ∈ removes edits r, f ∈ hiddenAt (cuts edits rem) i x :=
  Caps.T16_strong_removal edits rem pre post x i hsplit hstood

/-- T16, the removals that stand: every removal `resolve` picks stands in the view. -/
theorem T16_resolved_removals_stand (edits : List Edit) :
    ∀ r ∈ resolve (order edits), (standing edits).any (·.id == r.id) :=
  Caps.T16_resolved_removals_stand edits

/-! ## Once the curves fall -/

/-- T18 (post-quantum writes): a peer that no longer trusts the curves (`checkpointed`) counts a write only if its
    author vouched for it in a checkpoint, which carries the hash-based half of the author's signature: whoever broke
    the curves, and with them a device's classical key, writes nothing such a peer counts. -/
theorem T18_checkpointed_writes (edits : List Edit) {w : Write} (hw : w ∈ (view (checkpointed edits)).writes) :
    ∃ c ∈ edits, c.author = w.author ∧ ∃ e covers, c.action = .checkpoint e covers ∧ w.edit ∈ covers :=
  Caps.T18_checkpointed_writes edits hw

/-! ## Keys -/

/-- T5 (confidentiality): after any history, a holder (a signer, whoever holds a vault's seed, or everyone) opens a key
    of some family, of any epoch, only if over that history it could read the family. -/
theorem T5_confidentiality (edits : List Edit) (h : Holder) (k : KeyFam) (e : Nat)
    (hk : Knows (replay {} edits) (h.start (replay {} edits)) (.scoped k e)) : EverReads (trace {} edits) h k :=
  Keys.T5_confidentiality edits h k e hk

/-- T6 (forward secrecy): in every reachable state a holder opens the current key of a family in use only while it is
    entitled to it, or the family is public. New edits use current keys, so nothing written after a removal reaches
    the removed device, nor a revoked grantee, nor anyone who joins a vault that lost its read. -/
theorem T6_forward_secrecy {st : State} (hr : Reachable st) (h : Holder) {k : KeyFam} (hkf : k ∈ keyFams st)
    (hk : Knows st (h.start st) (st.curKey k)) : MayOpen st h k :=
  Keys.T6_forward_secrecy hr h hkf hk

/-- T7 (blind server): a device that only ever holds, directly or through the vaults it holds, the seeds of vaults that
    read nothing of another vault, such as the server acting for avenCEO with its relay caps, opens no key of a vault
    whose seed it never held, unless that key was public at some point. -/
theorem T7_blind_server (edits : List Edit) (srv : SignerId)
    (hblind : ∀ v, EverReads (trace {} edits) (.signer srv) (.seed v) →
      ∀ st ∈ trace {} edits, ∀ k, readsV st v k = true → k.vault = v)
    {k : KeyFam} (hk : ¬ EverReads (trace {} edits) (.signer srv) (.seed k.vault)) {e : Nat}
    (h : Knows (replay {} edits) [.signer srv] (.scoped k e)) : ∃ st ∈ trace {} edits, publicKey st k = true :=
  Keys.T7_blind_server edits srv hblind hk h

/-- T24 (an entry's key reaches only its cell's readers): in every reachable state, whoever opens the key of an entry
    in its current stay, at its cell's current generation, may open that cell's current key. So neither a move nor a
    link carrying the entry's history to its new cell hands a key to anyone its current cell keeps out. -/
theorem T24_entry_keys {st : State} (hr : Reachable st) (h : Holder) {en : Entry} (hen : en ∈ st.entries)
    (hk : Knows st (h.start st) (entryKey st en)) : MayOpen st h (.cell en.vault en.cell) :=
  Keys.T24_entry_keys hr h hen hk

/-- T24, along the history: a holder opens a key of an entry only if, over the history, it could read some cell the
    entry was in. -/
theorem T24_entry_history (edits : List Edit) (h : Holder) (e : EntryId) (s : Option EditId) (g : Nat)
    (hk : Knows (replay {} edits) (h.start (replay {} edits)) (.entry e s g)) :
    ∃ st ∈ trace {} edits, ∃ en ∈ st.entries, en.id = e ∧
      ∃ x ∈ en.stays.map (·.2), EverReads (trace {} edits) h (.cell en.vault x) :=
  Keys.T24_entry_history edits h e s g hk

/-! ## Rotation follows revocation

A device writes an entry under the key of its current stay at its cell's current generation in what it knows, as the
Lab does, so once a removal stands in what it knows, the removed can't open what it writes. Peers don't check this of
each other: a write builds on its own entry's log, while the removal that rotated its cell's key mostly sits in a cap's
or a vault's log, which the write doesn't name; and a device that had seen the removal could pass the text on anyway. -/

/-- T15 (rotation follows revocation): a holder opens the key a device holding `edits` writes an entry under only if
    what the device knows entitles it to the entry's cell, or the cell is public: not a device or a vault that a
    removal the device has seen took the entry from, nor anyone who joins a vault that lost its read. -/
theorem T15_rotation_follows_revocation (edits : List Edit) (h : Holder) {en : Entry} (hen : en ∈ (view edits).entries)
    (hk : Knows (view edits) (h.start (view edits)) (entryKey (view edits) en)) :
    MayOpen (view edits) h (.cell en.vault en.cell) :=
  T24_entry_keys (view_reachable edits) h hen hk

/-- T15, the generations: a device writes under a generation of a cell no older than any along the history of what it
    knows, so no older than the one each removal that stands in it started. -/
theorem T15_no_older_epoch (edits : List Edit) (k : KeyFam) :
    ∀ st ∈ trace {} (standing edits), st.epochOf k ≤ (view edits).epochOf k :=
  Caps.T15_no_older_epoch edits k

/-! ## Relays -/

/-- T25 (blind relays): a peer that reads no selector, no type and no tag, such as the server, holding the same edits as
    an owner, has every edit stand or fall alike and knows the same of the vaults, caps, cells, writes and keys. -/
theorem T25_blind_relays (edits : List Edit) :
    (view (edits.map Edit.blind)).ops = (view edits).ops ∧
      (standing (edits.map Edit.blind)).map (·.id) = (standing edits).map (·.id) :=
  Relays.T25_blind_relays edits

/-! ## Convergence and sync -/

/-- T11 (convergence): peers holding the same edits, received in any order, end in the same state. Assumes ids don't
    collide: two edits a peer holds have two ids. -/
theorem T11_convergence {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) (hids : (edits₁.map Edit.id).Nodup) :
    view edits₁ = view edits₂ :=
  Syncing.T11_convergence hperm hids

/-- T11, the edits that stand: the same edits in any order, the same edits stand. -/
theorem T11_same_standing {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) (hids : (edits₁.map Edit.id).Nodup) :
    standing edits₁ = standing edits₂ :=
  Syncing.T11_same_standing hperm hids

/-- T12 (sync shares only what caps allow): every edit a peer sends a device is one it holds, and of an entry, a cell or
    a cap that device may receive by the peer's view, or of a vault's log. -/
theorem T12_sync_shares_only_caps (edits : List Edit) (d : SignerId) {o : Edit} (h : o ∈ respond edits d) :
    o ∈ edits ∧ ∃ l, o.log? = some l ∧ (mayReceiveLog (view edits) d l = true ∨ ∃ v, l = .vault v) :=
  Syncing.T12_sync_shares_only_caps edits d h

/-- T12, by frontiers: a device that asks with what it holds of each log is sent part of what `respond` sends, so no
    more than its caps allow, whatever it says it holds. -/
theorem T12_since (edits : List Edit) (d : SignerId) (fr : Ask) {o : Edit} (h : o ∈ respondSince edits d fr) :
    o ∈ edits ∧ ∃ l, o.log? = some l ∧ (mayReceiveLog (view edits) d l = true ∨ ∃ v, l = .vault v) :=
  Syncing.T12_since edits d fr h

/-- T19 (frontier sync loses nothing): a device that asks a peer with its frontier of each log it holds and a few edits
    further back, and the edits it holds outside them (`asks`), is sent every edit of the peer's answer that it lacks.
    Assumes ids don't collide: an id the device and the peer both hold names one edit. -/
theorem T19_frontier_sync (A R : List Edit) (d : SignerId) (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) :
    ∀ o ∈ respond R d, o ∈ A ∨ o ∈ respondSince R d (asks A) :=
  Syncing.T19_frontier_sync A R d hid

/-- T19 by frontiers alone: sending only the frontiers loses nothing either, though a peer that lacks the latest edits
    then sends back what lies below them too. -/
theorem T19_frontiers_alone (A R : List Edit) (d : SignerId) (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) :
    ∀ o ∈ respond R d, o ∈ A ∨ o ∈ respondSince R d ⟨frontiers A, []⟩ :=
  Syncing.T19_frontiers_alone A R d hid

/-- T19, one hash per log: two peers whose frontiers of a log are equal hold the same closed part of it, so comparing
    one hash of each frontier tells whether there is anything to send. The two may place edits in logs differently
    (`lgA`, `lgR`). Assumes ids don't collide. -/
theorem T19_same_frontier (lgA lgR : Edit → Option LogId) (A R : List Edit) (l : LogId)
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) (huA : ∀ a ∈ A, ∀ b ∈ A, a.id = b.id → a = b)
    (huR : ∀ a ∈ R, ∀ b ∈ R, a.id = b.id → a = b) (hf : frontier lgA A l = frontier lgR R l) (x : Edit) :
    x ∈ closedPart lgA A l ↔ x ∈ closedPart lgR R l :=
  Syncing.T19_same_frontier lgA lgR A R l hid huA huR hf x

/-- T13 (sync converges per entry): if each of two devices may receive an entry by the other peer's view, then after
    each asked the other once (`asks`), both hold the same edits of that entry's log: those either held before.
    Assumes ids don't collide. -/
theorem T13_sync_converges (editsP editsQ : List Edit) (dp dq : SignerId) (e : EntryId)
    (hid : ∀ a ∈ editsP, ∀ b ∈ editsQ, a.id = b.id → a = b)
    (hp : mayReceive (view editsQ) dp e = true) (hq : mayReceive (view editsP) dq e = true)
    (o : Edit) (hop : o.log? = some (.entry e)) :
    o ∈ receive editsP (respondSince editsQ dp (asks editsP)) ↔
      o ∈ receive editsQ (respondSince editsP dq (asks editsQ)) :=
  Syncing.T13_sync_converges editsP editsQ dp dq e hid hp hq o hop

/-- T20 (linking hands out vault logs alone): every edit a peer hands a device whose passkey proved itself on their
    connection (`linkCard`) is an edit the peer holds of the log of a vault the passkey owns, or of one that owns such a
    vault, up the chains: never anything of a cap, a cell or an entry. -/
theorem T20_link_shares_only_vault_logs (edits : List Edit) (p : SignerId) {o : Edit} (h : o ∈ linkCard edits p) :
    o ∈ edits ∧ ∃ v, o.log? = some (.vault v) ∧ v ∈ closeVaults (view edits) (view edits).depth (ownedBy (view edits) p) :=
  Syncing.T20_link_shares_only_vault_logs edits p h

/-- T20, for a stranger: a passkey that owns no vault in the peer's view is handed nothing. -/
theorem T20_stranger_gets_nothing (edits : List Edit) (p : SignerId) (h : ownedBy (view edits) p = []) :
    linkCard edits p = [] :=
  Syncing.T20_stranger_gets_nothing edits p h

end AvenDB
