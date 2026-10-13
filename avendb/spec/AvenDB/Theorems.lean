import AvenDB.Props
import AvenDB.Lemmas
import AvenDB.CapLemmas
import AvenDB.RelayLemmas
import AvenDB.KeyLemmas
import AvenDB.SyncLemmas
import AvenDB.RuleLemmas
import AvenDB.Schemas

/-!
# The theorems

What must always hold, stated over the executable model. T9 (lenses) and T10 (proposals) are proven in their own files.
The proofs are in `Lemmas.lean` (vaults and writes), `CapLemmas.lean` (shares, audiences, keep shares, removals and
replay), `RuleLemmas.lean` (shares that name ops), `Schemas.lean` (writes that fit their schemas), `RelayLemmas.lean`
(blind relays), `KeyLemmas.lean` (keys) and `SyncLemmas.lean` (convergence and sync); the predicates the statements use
are in `Props.lean`.

The assumptions are part of the model rather than axioms: an edit's signers are the keys that signed it (signatures
can't be forged); keys are learned only through `Knows` (sealed, wrapped or encrypted data reveals nothing without its
key, and a derived key nothing of what it derives from); ids don't collide (a hypothesis where needed: `Nodup`, or that
an id two peers both hold names one edit); and Loro's laws are fields of `Loro`.
-/

namespace AvenDB

/-! ## Writes -/

/-- T1 (authorized writes only): a step adds a write to an entry that exists only if, just before it, the write's
    author acted for its actor through the owners the write names, and that vault could write the entry: it is the
    entry's vault, or holds a live share with write or more that reaches the entry's audience. -/
theorem T1_authorized_writes {st st' : State} {edit : Edit} (h : step st edit = some st') {w : Write}
    (hw : w ∈ st'.writes) (hnew : w ∉ st.writes) (hfirst : w.first = false) : authorized st w = true :=
  Core.T1_authorized_writes h hw hnew hfirst

/-- T1, new entries: a step creates an entry only with its first write, whose author acted for its actor, which is the
    entry's vault or created the entry in the intake audience of a live share with write or more that it held. -/
theorem T1_created_entries {st st' : State} {edit : Edit} (h : step st edit = some st') {en : Entry}
    (hen : en ∈ st'.entries) (hnew : ∀ x ∈ st.entries, x.id ≠ en.id) :
    ∃ w ∈ st'.writes, w.edit = edit.id ∧ w.entry = en.id ∧ w.first = true ∧
      actsVia st w.author w.via w.actor = true ∧ mayCreate st w.actor en.vault en.audience = true :=
  Core.T1_created_entries h hen hnew

/-- T1, second half (revocation wins): an older write that a step takes the authorization from survives only if
    the step is a removal that had seen it: a revocation, a vault losing an owner or a device, or a mark that took the
    entry out of an audience the write relied on. -/
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

/-! ## Shares -/

/-- T4 (shares name a vault or everyone; a share names a device only as a keep share of a device of its issuer): no
    step adds a share that names a device unless it is a keep share, nor a keep share that names anything but a device,
    and the device a new keep share names is one of its issuer's then. -/
theorem T4_shares_name_vaults {st st' : State} {edit : Edit} (hinv : SharesNameVaults st)
    (h : step st edit = some st') :
    SharesNameVaults st' ∧
      ∀ c ∈ st'.shares, c ∉ st.shares → ∀ d, c.who = .device d → isDevice st d c.issuer = true :=
  Core.T4_shares_name_vaults hinv h

/-- T8 (Everyone only reads): everyone only ever gets read. It can't write or share either, since writes and shares act
    for a vault. -/
theorem T8_everyone_read_only {st st' : State} {edit : Edit} (hinv : EveryoneReadOnly st)
    (h : step st edit = some st') : EveryoneReadOnly st' :=
  Core.T8_everyone_read_only hinv h

/-- T22 (a share grants no more than the shares it rests on): in every reachable state a share that rests on another is
    over the same vault, rests on an owner share issued to its own issuer, and whatever its slice holds, the slice of
    the share it rests on holds too; and a wide share rests only on a wide share. No owner share is wide
    (`T22_wide_shares`), so the last clause holds only vacuously: a wide share rests on none. -/
theorem T22_slices_narrow {st : State} (hr : Reachable st) {c pc : Share} (hc : c ∈ st.shares)
    (hp : c.parent = some pc.id) (hpc : pc ∈ st.shares) :
    pc.over = c.over ∧ pc.level = .owner ∧ pc.who = .vault c.issuer ∧
      (∀ a, effSelects st c a = true → effSelects st pc a = true) ∧ (c.wide = true → pc.wide = true) :=
  Shares.T22_slices_narrow hr hc hp hpc

/-- T22, wide shares: in every reachable state no owner share is wide, since owner of a whole vault is an owner of it,
    which only an owner edit makes, with the vault's approval and the newcomer's consent (T2), and never a share
    (WideOwner). So a wide share rests on no share, and the vault it is over issued it, unless it is a keep share, which
    grants nothing. -/
theorem T22_wide_shares {st : State} (hr : Reachable st) {c : Share} (hc : c ∈ st.shares) :
    (c.level = .owner → c.wide = false) ∧
      (c.wide = true → c.parent = none ∧ (c.level.isKeep = false → c.issuer = c.over)) :=
  Shares.T22_wide_shares hr c hc

/-- T23 (marks mean what the shares say): where an entry's marks, what isn't live left aside, are what its vault's
    stewards mark it with (`desiredMark`), the rules every peer checks without reading a selector, a type or a tag mean
    what the selectors say. Its audience: where it is the entry's semantic audience, the write rule allows exactly the
    vaults the shares' selectors allow. Its wants: where they are the keep shares that pick the entry (`semWants`), a
    device wants it, and keeps its files whole, exactly as its keep shares over the entry's vault say (`wantsWith`,
    `keepsWith`) when each of them picks the entry where it is wide or its selector picks it, a whole or opened share
    picking every schema and lens entry too and a never share none (`keepPicks`). So a relay, which reads only the
    marks, writes and sends as the selectors say. -/
theorem T23_marks_mean_shares {st : State} (hr : Reachable st) (en : Entry) :
    (liveAudience st en = semAudience st en → ∀ a, mayWrite st a en = semWrite st a en) ∧
    (liveWants st en = semWants st en → ∀ d,
      wants st d en = wantsWith (keepsOf st d en.vault) (fun k => k.wide || keepPicks k en.attrs) ∧
      keeps st d en = keepsWith (keepsOf st d en.vault) (fun k => k.wide || keepPicks k en.attrs)) :=
  Shares.T23_marks_mean_shares hr en

/-- T23, new entries: the rule every peer checks never refuses a creation that stays inside its creator's slice. -/
theorem T23_creations (st : State) (a v : VaultId) (x : Audience) (attrs : Attrs) {proof : Option ShareId}
    (h : admits st a v x attrs proof = true) :
    mayCreate st a v x = true :=
  Shares.T23_creations st a v x attrs h

/-! ## Shares that name ops

C1 to C4 (`avendb/docs/OPS.md`): a share is a name and the ops its grantee may make, its level the class of its
strongest op, and every reader of an entry counts a write by anyone but the entry's vault only where the share the
write's proof names reaches the entry and every share of its chain is the class of its ops and allows what the write
touches. The half of C3 about a write's changes, `changes_allowed`, is proven in `Rules.lean`. -/

/-- C1 (chains narrow): a chain allows no write that one of its shares forbids, and lets nothing through a share whose
    level isn't the class of its ops. -/
theorem chain_narrows {st : State} {cp c : Share} {main : Bool} {ts : List Touch}
    (h : chainAllows st cp main ts = true) (hc : c ∈ chain st cp) :
    c.level = levelOf c.ops ∧ allowsAll c.ops main ts = true :=
  Ruling.chain_narrows h hc

/-- C1, a share and the share it rests on: in every reachable state a share's chain allows no write the chain of the
    share it rests on doesn't allow (T22's twin for ops). -/
theorem child_narrows {st : State} (hr : Reachable st) {c pc : Share} (hc : c ∈ st.shares) (hp : c.parent = some pc.id)
    (hpc : pc ∈ st.shares) : ∀ main ts, chainAllows st c main ts = true → chainAllows st pc main ts = true :=
  Ruling.child_narrows hr hc hp hpc

/-- C2 (readers agree): whether the readers of an entry count a write reads no selector, type or tag, and no ops but
    those of the chain the write's proof names, so every reader of the entry, whatever shares it opened, counts the same
    writes. -/
theorem counts_seen (st : State) (a : VaultId) (en : Entry) (attrs : Attrs) (deps : List EditId)
    (proof : Option ShareId) (main : Bool) (ts : List Touch) (fits : Bool) :
    counts (st.seen (proofShares st proof)) a { en with attrs } deps proof main ts fits =
      counts st a en deps proof main ts fits :=
  Ruling.counts_seen st a en attrs deps proof main ts fits

/-- C2, creations: whether the readers of an entry count its creation reads no selector and no ops but those of the
    chain the creation's proof names. -/
theorem creates_seen (st : State) (a v : VaultId) (x : Audience) (proof : Option ShareId) (fits : Bool) :
    creates (st.seen (proofShares st proof)) a v x proof fits = creates st a v x proof fits :=
  Ruling.creates_seen st a v x proof fits

/-- C3 (counted writes do what they may): a counted write whose actor isn't the entry's vault relies on the share its
    proof names, which its actor holds with write or more and which reaches the entry, and every share of that share's
    chain is the class of its ops and allows every touch of it. -/
theorem counted_allowed {st : State} {a : VaultId} {en : Entry} {deps : List EditId} {proof : Option ShareId}
    {main : Bool} {ts : List Touch} {fits : Bool} (hc : counts st a en deps proof main ts fits = true)
    (hv : a ≠ en.vault) :
    ∃ cp ∈ st.shares, proof = some cp.id ∧ holdsShare st a cp .write = true ∧ inAudience st cp en = true ∧
      ∀ c ∈ chain st cp, c.level = levelOf c.ops ∧ allowsAll c.ops main ts = true :=
  Ruling.counted_allowed hc hv

/-- C3, by class: each touch of such a write is allowed, in every share of the chain, by an op that writes; a read,
    relay, backup or share op lets nothing through. -/
theorem counted_writes {st : State} {a : VaultId} {en : Entry} {deps : List EditId} {proof : Option ShareId}
    {main : Bool} {ts : List Touch} {fits : Bool} (hc : counts st a en deps proof main ts fits = true)
    (hv : a ≠ en.vault) :
    ∃ cp ∈ st.shares, proof = some cp.id ∧ ∀ c ∈ chain st cp, ∀ t ∈ ts, ∃ o ∈ c.ops, o.allows main t = true ∧
      o.level = .write :=
  Ruling.counted_writes hc hv

/-- C4 (allowed writes count): a write that fits, builds on writes its readers count, whose proof names a share its
    actor holds with write or more that reaches the entry, and whose chain allows every touch of it, counts. -/
theorem allowed_counts {st : State} {a : VaultId} {en : Entry} {deps : List EditId} {main : Bool} {ts : List Touch}
    {cp : Share} (hd : ∀ d ∈ deps, d ∉ st.uncounted) (hcp : cp ∈ st.shares) (hh : holdsShare st a cp .write = true)
    (hi : inAudience st cp en = true) (ha : chainAllows st cp main ts = true) :
    counts st a en deps (some cp.id) main ts true = true :=
  Ruling.allowed_counts hd hcp hh hi ha

/-- C4, creations: a creation that fits, in the intake audience of a share over the vault that its actor holds with
    write or more, whose proof names that share and whose chain allows `create`, counts. -/
theorem allowed_creates {st : State} {a v : VaultId} {cp : Share} (hcp : cp ∈ st.shares) (hv : cp.over = v)
    (hh : holdsShare st a cp .write = true) (ha : chainAllows st cp true [.create] = true) :
    creates st a v (intake st cp) (some cp.id) true = true :=
  Ruling.allowed_creates hcp hv hh ha

/-- C4, what builds on writes that don't count: in every reachable state the readers of an entry count no write that
    builds on one they don't count, so a line's history of counted writes is whole, and no record shows a write they
    don't count or anything built on it. -/
theorem uncounted_closed {st : State} (hr : Reachable st) : CountsClosed st :=
  Ruling.uncounted_closed hr

/-! ## Writes that fit their schemas

S1 to S4 (`avendb/docs/OPS.md`): every reader of an entry counts a write only where what it makes of the record fits
the schemas the entry was written under, so every device keeps the last record that fit, whatever a patched app
writes. S1 and S2, about records, are proven in `Schemas.lean`. -/

/-- S1 (a write is judged by what it changed): the write from `r` to `s` fits exactly when each change of what it
    changed does, on the record or row around it: a value it didn't change, which two devices' writes at once may
    have left behind, holds it back nowhere else. -/
theorem S1_judged_by_changes {V : Type} [DecidableEq V] {fit : Ops.Fit V} {ps : List Ops.Path} {fs : List String}
    {r s : Ops.Record V} (h : Ops.Reaches ps fs r s) :
    fit.fits ps fs r s = true ↔
      (∀ p, r.leaf p ≠ s.leaf p → fit.change r s (.set p (s.leaf p)) = true) ∧
      (∀ f, r.rows f ≠ s.rows f → fit.change r s (.order f (s.rows f)) = true) :=
  Ops.fits_iff h

/-- S2 (records that fit stay so): a record that fits keeps fitting through a write that fits. -/
theorem S2_clean_stays_clean {V : Type} [DecidableEq V] {fit : Ops.Fit V} {ps : List Ops.Path} {fs : List String}
    {r s : Ops.Record V} (h : Ops.Reaches ps fs r s) (hr : fit.Clean r) (hw : fit.fits ps fs r s = true) :
    fit.Clean s :=
  Ops.fits_clean h hr hw

/-- S2, the first write: the first write of an entry, if it fits, makes a record that fits of nothing. -/
theorem S2_first_write {V : Type} [DecidableEq V] {fit : Ops.Fit V} {ps : List Ops.Path} {fs : List String}
    {s : Ops.Record V} (h : Ops.Reaches ps fs Ops.Record.empty s) (hs : s.Formed) (hne : s ≠ Ops.Record.empty)
    (hw : fit.fits ps fs Ops.Record.empty s = true) : fit.Clean s :=
  Ops.fits_new h hs hne hw

/-- S3 (writes that don't fit count for no reader): readers count no write and no creation whose result doesn't fit,
    whatever its shares and their ops, and so (C4) nothing built on it. -/
theorem S3_unfit_uncounted (st : State) (a v : VaultId) (en : Entry) (deps : List EditId) (proof : Option ShareId)
    (main : Bool) (ts : List Touch) (x : Audience) :
    counts st a en deps proof main ts false = false ∧ creates st a v x proof false = false := by
  simp [counts, creates]

/-- S3, a step: a write accepted whose result doesn't fit is one its readers don't count. -/
theorem S3_step {st st' : State} {edit : Edit} (h : step st edit = some st')
    {v e actor stay epoch deps proposal via create tags proof touches}
    (ha : edit.action = .write v e actor stay epoch deps proposal via create tags proof touches false) :
    edit.id ∈ st'.uncounted :=
  Ruling.step_unfit h ha

/-- S4 (relays don't judge records): whether a write fits, which only its readers can tell, changes nothing but which
    writes they count: the write is accepted or refused alike, and leaves the same operational part of the state. -/
theorem S4_fit_unread (st : State) (edit : Edit) {v e a s g deps p via create tags proof ts} {f : Bool}
    (ha : edit.action = .write v e a s g deps p via create tags proof ts f) (f' : Bool) :
    (apply st { edit with action := .write v e a s g deps p via create tags proof ts f' }).map State.ops =
      (apply st edit).map State.ops := by
  have hb : ({ edit with action := .write v e a s g deps p via create tags proof ts f' } : Edit).blind =
      edit.blind := by
    simp only [Edit.blind, Action.blind, ha]
  rw [← Relays.apply_sim (st := st) (st' := st) rfl edit, ← Relays.apply_sim (st := st) (st' := st) rfl, hb]

/-! ## The schema lane -/

/-- T17: only a vault, or a vault holding a wide owner share over it, publishes its schemas and lenses. A step adds to a
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
  Shares.view_eq_replay edits

theorem view_reachable (edits : List Edit) : Reachable (view edits) := ⟨_, view_eq_replay edits⟩

/-- Every peer's writes come in an order their dependencies respect, so `Proposals.lean`'s T10f to T10h hold of what
    every peer shows on every line. -/
theorem writes_ordered (edits : List Edit) : Ordered (view edits).writes :=
  Shares.writes_ordered edits

/-! ## Strong removal -/

/-- T16 (strong removal), replaying `edits` with the removals `rem`: an edit stands only if `apply` accepts it on the
    state just before it (the replay of the edits that stood before it) with the facts hidden from it taken away; and
    those facts include everything each removal of `rem` after it takes away, unless that removal had seen it. A mark's
    fact is the audience it put the entry in, so a write it hadn't seen stands only if its writer may write there too; a
    mark of the wants alone takes nothing away. -/
theorem T16_strong_removal (edits rem : List Edit) (pre post : List (Edit × Nat)) (x : Edit) (i : Nat)
    (hsplit : edits.zipIdx = pre ++ (x, i) :: post)
    (hstood : (runFrom rem (cuts edits rem) (runFrom rem (cuts edits rem) {} pre).1 [(x, i)]).2 = [x]) :
    (apply (hide (replay {} (runFrom rem (cuts edits rem) {} pre).2) (hiddenAt (cuts edits rem) i x)) x).isSome ∧
    ∀ r j, edits[j]? = some r → rem.any (·.id == r.id) → i < j → x.id ∉ r.action.keep?.getD [] →
      ∀ f ∈ removes edits r, f ∈ hiddenAt (cuts edits rem) i x :=
  Shares.T16_strong_removal edits rem pre post x i hsplit hstood

/-- T16, the removals that stand: every removal `resolve` picks stands in the view. -/
theorem T16_resolved_removals_stand (edits : List Edit) :
    ∀ r ∈ resolve (order edits), (standing edits).any (·.id == r.id) :=
  Shares.T16_resolved_removals_stand edits

/-- K1 (a keep share's revocation cuts nothing, design 14.5): in every reachable state an accepted revocation of a keep
    share only marks it revoked. No share falls with it and no write or entry is dropped: nothing rests on a keep share,
    no audience holds one, and no write relies on one, as a keep share allows nothing. -/
theorem K1_keep_revocation_cuts_nothing {st post : State} (hr : Reachable st) {edit : Edit} {c : ShareId}
    {a : VaultId} {keep : List EditId} {via : List VaultId} (ha : edit.action = .revoke (.grant c a keep via))
    {k : Share} (hk : st.share? c = some k) (hkeep : k.level.isKeep = true) (h : apply st edit = some post) :
    post = { st with revoked := st.revoked ++ [c] } :=
  Shares.keep_revocation_cuts_nothing hr (Core.T14_entries_whole hr).1 (Core.T14_entries_whole hr).2 ha hk hkeep h

/-- K1, strong removal: nor does a keep share's revocation hide anything from the edits it hadn't seen. Among edits
    that issue share `c` only as a keep share, revoking it takes nothing away (`removes`), so no edit falls by it. -/
theorem K1_keep_revocation_hides_nothing (edits : List Edit) {r : Edit} {c : ShareId} {a : VaultId}
    {keep : List EditId} {via : List VaultId} (hr : r.action = .revoke (.grant c a keep via))
    (hk : ∀ x ∈ sharesIn edits, x.id = c → x.level.isKeep = true) (hex : ∃ x ∈ sharesIn edits, x.id = c) :
    removes edits r = [] :=
  Shares.keep_revocation_hides_nothing edits hr hk hex

/-! ## Once the curves fall -/

/-- T18 (post-quantum writes): a peer that no longer trusts the curves (`checkpointed`) counts a write only if its
    author vouched for it in a checkpoint, which carries the hash-based half of the author's signature: whoever broke
    the curves, and with them a device's classical key, writes nothing such a peer counts. -/
theorem T18_checkpointed_writes (edits : List Edit) {w : Write} (hw : w ∈ (view (checkpointed edits)).writes) :
    ∃ c ∈ edits, c.author = w.author ∧ ∃ e covers, c.action = .checkpoint e covers ∧ w.edit ∈ covers :=
  Shares.T18_checkpointed_writes edits hw

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
    read nothing of another vault, such as the server acting for avenCEO with its relay shares, opens no key of a vault
    whose seed it never held, unless that key was public at some point. -/
theorem T7_blind_server (edits : List Edit) (srv : SignerId)
    (hblind : ∀ v, EverReads (trace {} edits) (.signer srv) (.seed v) →
      ∀ st ∈ trace {} edits, ∀ k, readsV st v k = true → k.vault = v)
    {k : KeyFam} (hk : ¬ EverReads (trace {} edits) (.signer srv) (.seed k.vault)) {e : Nat}
    (h : Knows (replay {} edits) [.signer srv] (.scoped k e)) : ∃ st ∈ trace {} edits, publicKey st k = true :=
  Keys.T7_blind_server edits srv hblind hk h

/-- T24 (an entry's key reaches only its audience's readers): in every reachable state, whoever opens the key of an
    entry in its current stay, at its audience's current epoch, may open that audience's current key. So neither a mark
    nor a link carrying the entry's history to its new audience hands a key to anyone its current audience keeps out. -/
theorem T24_entry_keys {st : State} (hr : Reachable st) (h : Holder) {en : Entry} (hen : en ∈ st.entries)
    (hk : Knows st (h.start st) (entryKey st en)) : MayOpen st h (.audience en.vault en.audience) :=
  Keys.T24_entry_keys hr h hen hk

/-- T24, along the history: a holder opens a key of an entry only if, over the history, it could read some audience the
    entry was in. -/
theorem T24_entry_history (edits : List Edit) (h : Holder) (e : EntryId) (s : Option EditId) (g : Nat)
    (hk : Knows (replay {} edits) (h.start (replay {} edits)) (.entry e s g)) :
    ∃ st ∈ trace {} edits, ∃ en ∈ st.entries, en.id = e ∧
      ∃ x ∈ en.stays.map (·.2), EverReads (trace {} edits) h (.audience en.vault x) :=
  Keys.T24_entry_history edits h e s g hk

/-! ## Rotation follows revocation

A device writes an entry under the key of its current stay at its audience's current epoch in what it knows, as the
Lab does, so once a removal stands in what it knows, the removed can't open what it writes. Peers don't check this of
each other: a write builds on its own entry's log, while the removal that rotated its audience's key mostly sits in a
share's or a vault's log, which the write doesn't name; and a device that had seen the removal could pass the text on
anyway. -/

/-- T15 (rotation follows revocation): a holder opens the key a device holding `edits` writes an entry under only if
    what the device knows entitles it to the entry's audience, or the audience is public: not a device or a vault that a
    removal the device has seen took the entry from, nor anyone who joins a vault that lost its read. -/
theorem T15_rotation_follows_revocation (edits : List Edit) (h : Holder) {en : Entry} (hen : en ∈ (view edits).entries)
    (hk : Knows (view edits) (h.start (view edits)) (entryKey (view edits) en)) :
    MayOpen (view edits) h (.audience en.vault en.audience) :=
  T24_entry_keys (view_reachable edits) h hen hk

/-- T15, the epochs: a device writes under an epoch of an audience no older than any along the history of what it
    knows, so no older than the one each removal that stands in it started. -/
theorem T15_no_older_epoch (edits : List Edit) (k : KeyFam) :
    ∀ st ∈ trace {} (standing edits), st.epochOf k ≤ (view edits).epochOf k :=
  Shares.T15_no_older_epoch edits k

/-! ## Relays -/

/-- T25 (blind relays): a peer that reads no selector, no type and no tag, such as the server, holding the same edits as
    an owner, has every edit stand or fall alike and knows the same of the vaults, shares, audiences, writes and
    keys. -/
theorem T25_blind_relays (edits : List Edit) :
    (view (edits.map Edit.blind)).ops = (view edits).ops ∧
      (standing (edits.map Edit.blind)).map (·.id) = (standing edits).map (·.id) :=
  Relays.T25_blind_relays edits

/-- T26 (relay alone): a device that acts for no vault an entry's audience belongs to, and holds over that vault nothing
    but relay shares, receives none of the audience's edits: relay lets a server know a vault's devices, from its log,
    and keep nothing of its entries. Backup is what keeps them. -/
theorem T26_relay_keeps_nothing (st : State) (d : SignerId) (v : VaultId) (x : Audience) (hact : actsFor st d v = false)
    (hrelay : ∀ cp ∈ st.shares, cp.over = v → cp.level = .relay) : mayReceiveAudience st d v x = false := by
  unfold mayReceiveAudience
  simp only [hact, Bool.false_or, List.any_eq_false]
  intro cp hcp
  by_cases hov : cp.over = v
  · simp [hrelay cp hcp hov, Level.allows, Level.rank]
  · simp [hov]

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

/-- T12 (sync shares only what shares allow): every edit a peer sends a device is one it holds, and of an entry, an
    audience or a share that device may receive by the peer's view, or of a vault's log. -/
theorem T12_sync_sends_only_what_shares_reach (edits : List Edit) (d : SignerId) {o : Edit} (h : o ∈ respond edits d) :
    o ∈ edits ∧ ∃ l, o.log? = some l ∧ (mayReceiveLog (view edits) d l = true ∨ ∃ v, l = .vault v) :=
  Syncing.T12_sync_sends_only_what_shares_reach edits d h

/-- T12, by frontiers: a device that asks with what it holds of each log is sent part of what `respond` sends, so no
    more than its shares allow, whatever it says it holds. -/
theorem T12_since (edits : List Edit) (d : SignerId) (fr : Ask) {o : Edit} (h : o ∈ respondSince edits d fr) :
    o ∈ edits ∧ ∃ l, o.log? = some l ∧ (mayReceiveLog (view edits) d l = true ∨ ∃ v, l = .vault v) :=
  Syncing.T12_since edits d fr h

/-- T27 (files follow their edits): a peer hands a device a file only if it holds a write that brings it, of an entry
    that device may receive by the peer's view. So a device acting through relay alone fetches no file of an audience
    (T26), backup fetches them as ciphertext, and a file named nowhere a device may look is never handed to it. -/
theorem T27_files_follow_their_edits (edits : List Edit) (d : SignerId) (f : FileId) (h : mayFetch edits d f = true) :
    ∃ o ∈ edits, f ∈ o.filesOf ∧ ∃ e, o.log? = some (.entry e) ∧ mayReceive (view edits) d e = true := by
  unfold mayFetch at h
  obtain ⟨o, hsent, hf⟩ := List.any_eq_true.mp h
  have hf : f ∈ o.filesOf := by simpa using hf
  have hlog : ∃ e, o.log? = some (.entry e) := by
    cases ha : o.action <;> simp [Edit.filesOf, Edit.log?, ha] at hf ⊢
  obtain ⟨e, he⟩ := hlog
  obtain ⟨hin, l, hl, hmay⟩ := T12_sync_sends_only_what_shares_reach edits d hsent
  rw [he] at hl
  cases hl
  refine ⟨o, hin, hf, e, he, ?_⟩
  rcases hmay with hmay | ⟨v, hv⟩
  · simpa [mayReceiveLog] using hmay
  · cases hv

/-- T28 (a device syncs what it may and its keep shares want): every edit of an entry a peer sends a device is of an
    entry the device may receive by the peer's view and that its keep shares want (`wants`). A keep share only narrows:
    it hands nobody anything. -/
theorem T28_sync_follows_keeps (edits : List Edit) (d : SignerId) {o : Edit} (h : o ∈ respond edits d) {e : EntryId}
    (hl : o.log? = some (.entry e)) :
    ∃ en, (view edits).entry? e = some en ∧ mayReceiveAudience (view edits) d en.vault en.audience = true ∧
      wants (view edits) d en = true :=
  Syncing.T28_sync_follows_keeps edits d h hl

/-- T28, the modes: a device with no keep share over a vault wants all of it. The keep shares it syncs by are live
    keep shares naming it over the entry's vault, issued by a vault it is still a device of, so a device that leaves its
    vault drops them with no revocation. A never share that picks an entry (it is wide or among the entry's wants)
    keeps the entry out; a whole or opened share that picks it brings it in, unless a never share picks it too; and the
    device keeps its files whole exactly when a whole share picks it. -/
theorem T28_keep_modes (st : State) (d : SignerId) (en : Entry) :
    (keepsOf st d en.vault = [] → wants st d en = true) ∧
    (∀ k ∈ keepsOf st d en.vault, k.level.isKeep = true ∧ k.who = .device d ∧ k.over = en.vault ∧
      st.live k.id = true ∧ isDevice st d k.issuer = true) ∧
    (∀ k ∈ keepsOf st d en.vault, k.never = true → marked st en k = true → wants st d en = false) ∧
    (∀ k ∈ keepsOf st d en.vault, k.never = false → marked st en k = true →
      (∀ k' ∈ keepsOf st d en.vault, k'.never = true → marked st en k' = false) → wants st d en = true) ∧
    (keeps st d en = true ↔ ∃ k ∈ keepsOf st d en.vault, k.level = .keep .whole ∧ marked st en k = true) :=
  Syncing.T28_keep_modes st d en

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

/-- T13 (sync converges per entry): if each of two devices syncs an entry by the other peer's view (it may receive it,
    and its keep shares want it), then after each asked the other once (`asks`), both hold the same edits of that
    entry's log: those either held before. Assumes ids don't collide. -/
theorem T13_sync_converges (editsP editsQ : List Edit) (dp dq : SignerId) (e : EntryId)
    (hid : ∀ a ∈ editsP, ∀ b ∈ editsQ, a.id = b.id → a = b)
    (hp : syncs (view editsQ) dp e = true) (hq : syncs (view editsP) dq e = true)
    (o : Edit) (hop : o.log? = some (.entry e)) :
    o ∈ receive editsP (respondSince editsQ dp (asks editsP)) ↔
      o ∈ receive editsQ (respondSince editsP dq (asks editsQ)) :=
  Syncing.T13_sync_converges editsP editsQ dp dq e hid hp hq o hop

/-- T20 (linking hands out vault logs alone): every edit a peer hands a device whose passkey proved itself on their
    connection (`linkCard`) is an edit the peer holds of the log of a vault the passkey owns, or of one that owns such a
    vault, up the chains: never anything of a share, an audience or an entry. -/
theorem T20_link_shares_only_vault_logs (edits : List Edit) (p : SignerId) {o : Edit} (h : o ∈ linkCard edits p) :
    o ∈ edits ∧ ∃ v, o.log? = some (.vault v) ∧ v ∈ closeVaults (view edits) (view edits).depth (ownedBy (view edits) p) :=
  Syncing.T20_link_shares_only_vault_logs edits p h

/-- T20, for a stranger: a passkey that owns no vault in the peer's view is handed nothing. -/
theorem T20_stranger_gets_nothing (edits : List Edit) (p : SignerId) (h : ownedBy (view edits) p = []) :
    linkCard edits p = [] :=
  Syncing.T20_stranger_gets_nothing edits p h

end AvenDB
