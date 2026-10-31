import Aven.ID.Restore

/-! # Production's door, settled (B3, its first half)

`restore_agrees` checks on every trace that the settled tree of production's migrated store admits the keys
`Members.admits` admits. This proves the settled side for every store: under what `Members.restore` guarantees of a
store it reads back (`Clean`), the settled door admits exactly the store's device keys (`restoredKeys`): the claiming
browser, the Aven Peer, the claimant's signed-in browsers, every joined browser and every member's signed-in browser
(`settle_restore_door`). The second half, that `Members.restore` gives a `Clean` store whose `Members.admits` is the
same list, is stated in `PEERS.md`'s "Open" until it is proved. -/

namespace Aven.ID
namespace Restore

open Settle
open Core.Past (Before)

/-- What `Members.restore` guarantees of the store it reads back, as `settle_restore_door` needs it. -/
structure Clean (r : Members) (c : Claim) : Prop where
  /-- every invite was signed by the claimant's passkey, the one admin passkey before milestone 3 -/
  invites_admin : ∀ i ∈ r.invites, i.passkey = c.passkey
  /-- every join names an invite the store holds -/
  joins_invited : ∀ j ∈ r.joins, ∃ i ∈ r.invites, i.key = j.invite
  /-- no withdrawal names an invite a join used -/
  not_withdrawn : ∀ w ∈ r.withdrawn, ∀ j ∈ r.joins, w.key ≠ j.invite
  /-- every member's sign-in was signed by a joined passkey -/
  signIns_joined : ∀ s ∈ r.signIns, s.member ∈ r.joins
  /-- the old statements are distinct -/
  olds_nodup : (refOrder r).Nodup
  /-- one join per invite -/
  join_once : ∀ j ∈ r.joins, ∀ j' ∈ r.joins, j.invite = j'.invite → j = j'
  /-- each old statement has a name of its own: fewer than 2^256 of them -/
  fits : (refOrder r).length + 2 < 256 ^ 32

/-- The device keys a restored store's door admits. -/
def restoredKeys (r : Members) (c : Claim) : List String :=
  c.deviceKey :: r.founding.peerKey :: r.founding.signIns.map (·.deviceKey) ++ r.joins.map (·.deviceKey) ++
    r.signIns.map (·.signIn.deviceKey)

section

variable {r : Members} {c : Claim} {g : SwitchKeys}

/-- The migrated old statements. -/
abbrev steps (r : Members) (c : Claim) : List TreeStatement := (refOrder r).mapIdx (step r c)

theorem migrate_eq (hc : r.founding.claim = some c) : migrate r g = genesisStatement r c g :: steps r c := by
  simp [migrate, hc]

theorem mem_steps {s : TreeStatement} :
    s ∈ steps r c ↔ ∃ k, ∃ h : k < (refOrder r).length, s = step r c k (refOrder r)[k] := by
  simp only [steps, List.mem_iff_getElem, List.length_mapIdx, List.getElem_mapIdx]
  constructor
  · rintro ⟨k, hk, e⟩; exact ⟨k, hk, e.symm⟩
  · rintro ⟨k, hk, e⟩; exact ⟨k, hk, e.symm⟩

theorem step_mem {k : Nat} (hk : k < (refOrder r).length) (hc : r.founding.claim = some c) :
    step r c k (refOrder r)[k] ∈ migrate r g := by
  rw [migrate_eq hc]
  exact List.mem_cons_of_mem _ (mem_steps.mpr ⟨k, hk, rfl⟩)

/-- Every migrated statement counts. -/
theorem migrate_counted (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (named : Named r) :
    ∀ s ∈ migrate r g, counted genesisName (migrate r g) s = true :=
  fun s ms => (counted_iff genesisName).mpr (migrate_counts r g c hc signed named s ms)

theorem vany (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (named : Named r)
    {p : TreeStatement → Bool} :
    (view genesisName (migrate r g)).any p = true ↔ ∃ s ∈ migrate r g, p s = true := by
  rw [view_any]
  exact ⟨fun ⟨s, m, _, h⟩ => ⟨s, m, h⟩, fun ⟨s, m, h⟩ => ⟨s, m, migrate_counted hc signed named s m, h⟩⟩

theorem vall (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (named : Named r)
    {p : TreeStatement → Bool} :
    (view genesisName (migrate r g)).all p = true ↔ ∀ s ∈ migrate r g, p s = true := by
  rw [view_all_iff]
  exact ⟨fun h s m => h s m (migrate_counted hc signed named s m), fun h s m _ => h s m⟩

theorem vpast (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (named : Named r)
    {a b : TreeStatement} : (view genesisName (migrate r g)).past a b = true ↔
      a ∈ migrate r g ∧ b ∈ migrate r g ∧ Before TreeStatement.name (migrate r g) a b := by
  rw [view_past]
  exact ⟨fun ⟨⟨ma, _⟩, ⟨mb, _⟩, p⟩ => ⟨ma, mb, p⟩,
    fun ⟨ma, mb, p⟩ => ⟨⟨ma, migrate_counted hc signed named a ma⟩, ⟨mb, migrate_counted hc signed named b mb⟩, p⟩⟩

/-- No migrated statement changes owners: production had no owner changes. -/
theorem migrate_no_owners (hc : r.founding.claim = some c) :
    ∀ u ∈ migrate r g, ∀ x os th, u.says ≠ .setOwners x os th := by
  intro u mu x os th
  rw [migrate_eq hc] at mu
  rcases List.mem_cons.mp mu with rfl | mu
  · simp [genesisStatement]
  · obtain ⟨k, hk, rfl⟩ := mem_steps.mp mu
    generalize (refOrder r)[k] = o
    cases o <;> simp [step, Old.says]

/-- No migrated old statement is a genesis: they say what the old statements said. -/
theorem step_not_genesis {k : Nat} {o : Old} {gs : Setup} : (step r c k o).says ≠ .setup gs := by
  cases o <;> simp [step, Old.says]

/-- The pinned genesis is the migrated claim's: what `gen` reads is `genesisOf`. -/
theorem gen_eq (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (named : Named r)
    (P : Setup → Bool) : gen (view genesisName (migrate r g)) P = P (genesisOf r.founding c g) := by
  apply Bool.eq_iff_iff.mpr
  unfold gen
  rw [vany hc signed named]
  constructor
  · rintro ⟨s, ms, h⟩
    rw [migrate_eq hc] at ms
    rcases List.mem_cons.mp ms with e | ms
    · subst e; simp [genesisStatement, signed] at h; exact h.2
    · obtain ⟨k, hk, e⟩ := mem_steps.mp ms
      subst e
      simp only [Bool.and_eq_true, beq_iff_eq] at h
      split at h
      · next gs e' => exact absurd e' step_not_genesis
      · simp at h
  · intro h
    refine ⟨genesisStatement r c g, by rw [migrate_eq hc]; exact List.mem_cons_self .., ?_⟩
    simp [genesisStatement, signed, h, view]

end

/-! ## The old statements and their tickets -/

theorem mem_refOrder {r : Members} {o : Old} : o ∈ refOrder r ↔
    (∃ i ∈ r.invites, o = .invite i) ∨ (∃ w ∈ r.withdrawn, o = .withdrawal w) ∨ (∃ j ∈ r.joins, o = .join j) ∨
      (∃ j ∈ r.joins, o = .confirm j) := by
  simp only [refOrder, List.mem_append, List.mem_map, List.mem_mergeSort]
  constructor
  · rintro (((⟨i, m, e⟩ | ⟨w, m, e⟩) | ⟨j, m, e⟩) | ⟨j, m, e⟩)
    · exact .inl ⟨i, m, e.symm⟩
    · exact .inr (.inl ⟨w, m, e.symm⟩)
    · exact .inr (.inr (.inl ⟨j, m, e.symm⟩))
    · exact .inr (.inr (.inr ⟨j, m, e.symm⟩))
  · rintro (⟨i, m, e⟩ | ⟨w, m, e⟩ | ⟨j, m, e⟩ | ⟨j, m, e⟩)
    · exact .inl (.inl (.inl ⟨i, m, e.symm⟩))
    · exact .inl (.inl (.inr ⟨w, m, e.symm⟩))
    · exact .inl (.inr ⟨j, m, e.symm⟩)
    · exact .inr ⟨j, m, e.symm⟩

theorem indexWhere_some {α : Type} {p : α → Bool} :
    ∀ {l : List α} {k : Nat}, indexWhere p l = some k → ∃ h : k < l.length, p l[k] = true
  | [], _, h => by simp [indexWhere] at h
  | a :: l, k, h => by
    unfold indexWhere at h
    split at h
    · next pa => cases h; exact ⟨by simp, pa⟩
    · cases e : indexWhere p l with
      | none => simp [e] at h
      | some k' =>
        simp only [e, Option.map_some, Option.some.injEq] at h
        subst h
        obtain ⟨hk, pk⟩ := indexWhere_some e
        exact ⟨by simp; omega, by simpa using pk⟩

theorem indexWhere_found {α : Type} {p : α → Bool} :
    ∀ {l : List α} {x : α}, x ∈ l → p x = true → ∃ k, indexWhere p l = some k
  | [], _, m, _ => by simp at m
  | a :: l, x, m, px => by
    unfold indexWhere
    split
    · exact ⟨0, rfl⟩
    · rcases List.mem_cons.mp m with e | m
      · subst e; contradiction
      · obtain ⟨k, hk⟩ := indexWhere_found m px
        exact ⟨k + 1, by simp [hk]⟩

theorem ticketName_eq (olds : List Old) (key : String) :
    ticketName olds key = (match indexWhere (isInvite key) olds with | some k => nameAt k | none => num 0) := by
  rfl

/-- Names under 2^256 are one name each. -/
theorem num_inj {a b : Nat} (ha : a < 256 ^ 32) (hb : b < 256 ^ 32) (h : num a = num b) : a = b := by
  have := congrArg (fun x => Core.beNat x.bytes) h
  simpa [num, Core.beNat_be, Nat.mod_eq_of_lt ha, Nat.mod_eq_of_lt hb] using this

theorem nameAt_ne_zero {k : Nat} (hk : k + 2 < 256 ^ 32) : nameAt k ≠ num 0 := fun h => by
  have := num_inj hk (by decide) h
  omega

/-- A ticket name that names something is the place of an invite with that key. -/
theorem ticketName_spec {olds : List Old} {key : String} {k : Nat} (fits : olds.length + 2 < 256 ^ 32)
    (hk : k + 2 < 256 ^ 32) (h : ticketName olds key = nameAt k) :
    ∃ hk : k < olds.length, ∃ i, olds[k] = .invite i ∧ i.key = key := by
  rw [ticketName_eq] at h
  cases e : indexWhere (isInvite key) olds with
  | none => simp only [e] at h; exact absurd h.symm (nameAt_ne_zero hk)
  | some k' =>
    obtain ⟨hk', p⟩ := indexWhere_some e
    simp only [e] at h
    have := num_inj (by omega) hk h
    obtain rfl : k' = k := by omega
    refine ⟨hk', ?_⟩
    cases e' : olds[k'] with
    | invite i => rw [e'] at p; exact ⟨i, rfl, by simpa [isInvite] using p⟩
    | _ => rw [e'] at p; simp [isInvite] at p

/-- An invite the store holds has a ticket name. -/
theorem ticketName_found {olds : List Old} {i : Invite} (m : Old.invite i ∈ olds) :
    ∃ k, k < olds.length ∧ ticketName olds i.key = nameAt k := by
  obtain ⟨k, hk⟩ := indexWhere_found m (by simp [isInvite] : isInvite i.key (.invite i) = true)
  exact ⟨k, (indexWhere_some hk).1, by rw [ticketName_eq, hk]⟩

/-- Two keys with one ticket name that names something are one key. -/
theorem ticketName_inj {olds : List Old} {a b : String} {k : Nat} (fits : olds.length + 2 < 256 ^ 32)
    (hk : k + 2 < 256 ^ 32) (ha : ticketName olds a = nameAt k) (hb : ticketName olds b = nameAt k) : a = b := by
  obtain ⟨_, i, e, ka⟩ := ticketName_spec fits hk ha
  obtain ⟨_, i', e', kb⟩ := ticketName_spec fits hk hb
  rw [e] at e'
  cases e'
  exact ka.symm.trans kb

/-! ## What each migrated statement says -/

section

variable {r : Members} {c : Claim} {g : SwitchKeys}

theorem step_claim {k : Nat} {o : Old} {t : Core.Hash} {v gu : String} {p : Passkey} {d : List String}
    (h : (step r c k o).says = .claim t v p d gu) :
    ∃ j, o = .join j ∧ t = ticketName (refOrder r) j.invite ∧ v = j.person ∧ p = stored j.passkey ∧
      d = memberDevices r j ∧ (step r c k o).signer = j.invite := by
  cases o <;> simp [step, Old.says] at h ⊢
  next j => exact ⟨h.1.symm, h.2.1.symm, h.2.2.1.symm, h.2.2.2.1.symm⟩

theorem step_withdrawal {k : Nat} {o : Old} {t : Core.Hash} (h : (step r c k o).says = .withdrawal t) :
    ∃ w, o = .withdrawal w ∧ t = ticketName (refOrder r) w.key := by
  cases o <;> simp [step, Old.says] at h ⊢
  next w => exact h.symm

/-- The migration signs no one in: production's sign-ins are in the snapshot (A42). -/
theorem step_not_signIn {k : Nat} {o : Old} {d : String} : (step r c k o).says ≠ .signIn d := by
  cases o <;> simp [step, Old.says]

theorem step_confirm {k : Nat} {o : Old} {n : Core.Hash} (h : (step r c k o).says = .confirm n) :
    ∃ j, o = .confirm j ∧ n = joinName (refOrder r) j.invite := by
  cases o <;> simp [step, Old.says] at h ⊢
  next j => exact h.symm

end

/-! ## Every join's claim stands -/

theorem nodup_getElem_inj {α : Type} : ∀ {l : List α} (_ : l.Nodup) {a b : Nat} (ha : a < l.length)
    (hb : b < l.length), l[a] = l[b] → a = b
  | [], _, _, _, ha, _, _ => by simp at ha
  | x :: l, nd, a, b, ha, hb, h => by
    obtain ⟨nx, nl⟩ := List.nodup_cons.mp nd
    cases a with
    | zero =>
      cases b with
      | zero => rfl
      | succ b =>
        simp only [List.getElem_cons_zero, List.getElem_cons_succ] at h
        exact absurd (h ▸ List.getElem_mem (by simpa using hb)) nx
    | succ a =>
      cases b with
      | zero =>
        simp only [List.getElem_cons_zero, List.getElem_cons_succ] at h
        exact absurd (h ▸ List.getElem_mem (by simpa using ha)) nx
      | succ b =>
        simp only [List.getElem_cons_succ] at h
        exact congrArg (· + 1) (nodup_getElem_inj nl (by simpa using ha) (by simpa using hb) h)

section

variable {r : Members} {c : Claim} {g : SwitchKeys}

theorem invite_mem {o : Old} {i : Invite} (m : o ∈ refOrder r) (e : o = .invite i) : i ∈ r.invites := by
  subst e
  rcases mem_refOrder.mp m with ⟨x, mx, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ <;> cases h
  exact mx

theorem join_mem {o : Old} {j : Join} (m : o ∈ refOrder r) (e : o = .join j) : j ∈ r.joins := by
  subst e
  rcases mem_refOrder.mp m with ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨x, mx, h⟩ | ⟨_, _, h⟩ <;> cases h
  exact mx

theorem withdrawal_mem {o : Old} {w : Withdrawal} (m : o ∈ refOrder r) (e : o = .withdrawal w) : w ∈ r.withdrawn := by
  subst e
  rcases mem_refOrder.mp m with ⟨_, _, h⟩ | ⟨x, mx, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ <;> cases h
  exact mx

/-- A join's ticket: an invite the store holds, with the join's key, at a place of the old statements. -/
theorem join_ticket (cl : Clean r c) {j : Join} (mj : j ∈ r.joins) :
    ∃ t, ∃ ht : t < (refOrder r).length, ∃ i, (refOrder r)[t] = .invite i ∧ i ∈ r.invites ∧ i.key = j.invite ∧
      ticketName (refOrder r) j.invite = nameAt t := by
  obtain ⟨i, mi, ki⟩ := cl.joins_invited j mj
  obtain ⟨t, tl, ht⟩ :=
    ticketName_found (mem_refOrder.mpr (.inl ⟨i, mi, rfl⟩) : Old.invite i ∈ refOrder r)
  obtain ⟨htl, i', et, k'⟩ := ticketName_spec cl.fits (by have := cl.fits; omega) ht
  exact ⟨t, htl, i', et, invite_mem (List.getElem_mem htl) et, k'.trans ki, ki ▸ ht⟩

theorem claimOk_join (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (named : Named r)
    (cl : Clean r c) {k : Nat} (hk : k < (refOrder r).length) {j : Join} (e : (refOrder r)[k] = .join j) :
    claimOk (view genesisName (migrate r g)) (step r c k (.join j)) = true := by
  have mj : j ∈ r.joins := join_mem (List.getElem_mem hk) e
  obtain ⟨t, ht, i, et, mi, ki, tn⟩ := join_ticket cl mj
  have mT : step r c t (.invite i) ∈ migrate r g := et ▸ step_mem ht hc
  have mC : step r c k (.join j) ∈ migrate r g := e ▸ step_mem hk hc
  unfold claimOk
  simp only [step, Old.says, Bool.and_eq_true]
  refine ⟨(vany hc signed named).mpr ⟨_, mT, ?_⟩, by simp [guardianNamed, gen_eq hc signed named, genesisOf]⟩
  simp only [Bool.and_eq_true, beq_iff_eq]
  refine ⟨⟨⟨?_, ?_⟩, ?_⟩, ?_⟩
  · simp [step, tn]
  · rw [byAdmin_plain genesisName (migrate_no_owners hc)]
    simp only [gen_eq hc signed named, approvedIn, TreeStatement.sigs, TreeStatement.keys, step, Old.says,
      cl.invites_admin i mi, List.map_cons, List.map_nil]
    exact Setup.approves_claimant (genesisOf r.founding c g) (by simp [genesisOf]) rfl stmtDigest
  · simp [step, Old.says, ki]
  · refine (vpast hc signed named).mpr ⟨by simpa [step, Old.says] using mC, mT, .tip mT ?_⟩
    simp [step, Old.parents, tn, Core.Past.parents]

/-- A join's claim is named by its join's place: the first join of its invite is that join. -/
theorem joinName_at (cl : Clean r c) {k : Nat} (hk : k < (refOrder r).length) {j : Join}
    (e : (refOrder r)[k] = .join j) : joinName (refOrder r) j.invite = nameAt k := by
  have mj : j ∈ r.joins := join_mem (List.getElem_mem hk) e
  obtain ⟨k', hk'⟩ := indexWhere_found (List.getElem_mem hk) (by rw [e]; simp [isJoin] :
    isJoin j.invite (refOrder r)[k] = true)
  obtain ⟨hl, p⟩ := indexWhere_some hk'
  unfold joinName
  rw [hk']
  show nameAt k' = nameAt k
  congr 1
  cases e' : (refOrder r)[k'] with
  | join j' =>
    rw [e'] at p
    simp only [isJoin, beq_iff_eq] at p
    have mj' : j' ∈ r.joins := join_mem (List.getElem_mem hl) e'
    have jj : j' = j := cl.join_once j' mj' j mj p
    subst jj
    exact nodup_getElem_inj cl.olds_nodup hl hk (e'.trans e.symm)
  | _ => rw [e'] at p; simp [isJoin] at p

/-- **Every join's claim is final:** the migration confirms each with Maia City's approval at the genesis's signing,
issuing its vault's member cap (A38). -/
theorem final_join (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (named : Named r)
    (cl : Clean r c) {k : Nat} (hk : k < (refOrder r).length) {j : Join} (e : (refOrder r)[k] = .join j) :
    final (view genesisName (migrate r g)) (step r c k (.join j)) = true := by
  have mj : j ∈ r.joins := join_mem (List.getElem_mem hk) e
  obtain ⟨kc, hkc, ec⟩ := List.mem_iff_getElem.mp
    (mem_refOrder.mpr (.inr (.inr (.inr ⟨j, mj, rfl⟩))) : Old.confirm j ∈ refOrder r)
  have mC : step r c k (.join j) ∈ migrate r g := e ▸ step_mem hk hc
  have mK : step r c kc (.confirm j) ∈ migrate r g := ec ▸ step_mem hkc hc
  have jn := joinName_at cl hk e
  unfold final
  rw [claimOk_join hc signed named cl hk e, Bool.true_and]
  refine (vany hc signed named).mpr ⟨_, mK, ?_⟩
  simp only [Bool.and_eq_true, beq_iff_eq]
  refine ⟨⟨?_, ?_⟩, ?_⟩
  · unfold confirmer
    simp only [Bool.or_eq_true]
    left; left
    simp only [gen_eq hc signed named, step, Old.says, List.any_eq_true]
    exact ⟨c.person, by simp [genesisOf], Setup.approves_own (genesisOf r.founding c g) stmtDigest⟩
  · simp [step, Old.says, jn]
  · refine (vpast hc signed named).mpr ⟨mK, mC, .tip mC ?_⟩
    simp [step, Old.parents, jn, Core.Past.parents]

/-- **Every join's claim stands** in the settled tree of a clean store. -/
theorem standing_join (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (named : Named r)
    (cl : Clean r c) {k : Nat} (hk : k < (refOrder r).length) {j : Join} (e : (refOrder r)[k] = .join j) :
    standing (view genesisName (migrate r g)) (step r c k (.join j)) = true := by
  have mj : j ∈ r.joins := join_mem (List.getElem_mem hk) e
  obtain ⟨t, tl, _, _, _, _, tn⟩ := join_ticket cl mj
  have cok := claimOk_join hc signed named cl hk e
  have ticket : (step r c k (.join j)).ticketOf = some (ticketName (refOrder r) j.invite) := by
    simp [step, Old.says, TreeStatement.ticketOf]
  unfold standing
  rw [cok, Bool.true_and]
  have mC : step r c k (.join j) ∈ migrate r g := e ▸ step_mem hk hc
  have fC := final_join hc signed named cl hk e
  have anyfinal : (view genesisName (migrate r g)).any
      (fun f => final (view genesisName (migrate r g)) f && sameTicket f (step r c k (.join j))) = true :=
    (vany hc signed named).mpr ⟨_, mC, by simp [fC, sameTicket, ticket]⟩
  simp only [anyfinal, ↓reduceIte, fC, Bool.true_and]
  refine (vall hc signed named).mpr fun d md => ?_
  simp only [Bool.or_eq_true, Bool.not_eq_true', Bool.and_eq_false_iff]
  by_cases df : final (view genesisName (migrate r g)) d = true
  · by_cases ds : sameTicket d (step r c k (.join j)) = true
    · -- another final claim of the join's ticket is the same join's
      right
      have dc := final_claimOk df
      rw [migrate_eq hc] at md
      rcases List.mem_cons.mp md with ed | md
      · subst ed; simp [claimOk, genesisStatement] at dc
      · obtain ⟨kd, hkd, ed⟩ := mem_steps.mp md
        subst ed
        have dt : (step r c kd (refOrder r)[kd]).ticketOf = some (ticketName (refOrder r) j.invite) := by
          simp only [sameTicket, Bool.and_eq_true, beq_iff_eq] at ds
          rw [ds.2, ticket]
        unfold TreeStatement.ticketOf at dt
        split at dt
        · next t' v' p' d' gu' hs =>
          obtain ⟨j', eo, tj, -⟩ := step_claim hs
          simp only [Option.some.injEq] at dt
          have mj' : j' ∈ r.joins := join_mem (List.getElem_mem hkd) eo
          have jj : j' = j := cl.join_once j' mj' j mj (ticketName_inj cl.fits (by have := cl.fits; omega)
            (tj.symm.trans (dt.trans tn)) tn)
          subst jj
          have kk : kd = k := nodup_getElem_inj cl.olds_nodup hkd hk (eo.trans e.symm)
          subst kk
          simp [hashAtMost, eo]
        · cases dt
    · left; right; simpa using ds
  · left; left; simpa using df
end

/-! ## The door -/

section

variable {r : Members} {c : Claim} {g : SwitchKeys}

theorem old_index {o : Old} (m : o ∈ refOrder r) : ∃ k, ∃ hk : k < (refOrder r).length, (refOrder r)[k] = o :=
  List.mem_iff_getElem.mp m

/-- A migrated store changes no setting: its Aven Peer is the genesis's, production's peer key. -/
theorem peerIs_eq (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (named : Named r)
    (key : String) : peerIs (view genesisName (migrate r g)) key = (key == r.founding.peerKey) := by
  have none : (view genesisName (migrate r g)).any (configBy (view genesisName (migrate r g)) isPeerSet) = false := by
    cases e : (view genesisName (migrate r g)).any (configBy (view genesisName (migrate r g)) isPeerSet)
    · rfl
    · exfalso
      obtain ⟨s, ms, h⟩ := (vany hc signed named).mp e
      simp only [configBy, Bool.and_eq_true] at h
      rw [migrate_eq hc] at ms
      rcases List.mem_cons.mp ms with es | ms
      · subst es; simp [genesisStatement, isPeerSet] at h
      · obtain ⟨k, _, es⟩ := mem_steps.mp ms
        subst es
        cases o : (refOrder r)[k] <;> simp [o, step, Old.says, isPeerSet] at h
  unfold peerIs setting
  rw [none]
  simp only [Bool.false_eq_true, ↓reduceIte, gen_eq hc signed named, genesisOf]
  cases e : (key == r.founding.peerKey) <;> cases e' : (r.founding.peerKey == key) <;> simp_all

/-- A clean store's old statements name only what it holds: each join's invite, each confirm's join. -/
theorem Clean.named (cl : Clean r c) : Named r := by
  intro o mo h mh
  rcases mem_refOrder.mp mo with ⟨i, _, rfl⟩ | ⟨w, _, rfl⟩ | ⟨j, mj, rfl⟩ | ⟨j, mj, rfl⟩
  · simp [Old.parents] at mh
  · simp [Old.parents] at mh
  · simp only [Old.parents, List.mem_singleton] at mh
    obtain ⟨t, ht, _, _, _, _, tn⟩ := join_ticket cl mj
    exact ⟨t, ht, mh.trans tn⟩
  · simp only [Old.parents, List.mem_singleton] at mh
    obtain ⟨k, hk, eo⟩ :=
      old_index (mem_refOrder.mpr (.inr (.inr (.inl ⟨j, mj, rfl⟩))) : Old.join j ∈ refOrder r)
    exact ⟨k, hk, mh.trans (joinName_at cl hk eo)⟩

/-- **`settle_restore_door`**, the settled side of `restore_agrees` for every clean store: the settled tree of
production's migrated store admits exactly the store's device keys. -/
theorem settle_restore_door (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (cl : Clean r c) (key : String) :
    (settle genesisName (migrate r g)).admits key = true ↔ key ∈ restoredKeys r c := by
  have named := cl.named
  simp only [settle, settleView]
  unfold admits
  rw [peerIs_eq hc signed named]
  simp only [Bool.or_eq_true, gen_eq hc signed named, genesisOf, List.contains_cons,
    List.contains_iff_mem, beq_iff_eq, restoredKeys, List.mem_cons, List.mem_append, List.mem_map]
  constructor
  · rintro ((g1 | cl1) | si)
    · rcases g1 with (e | ⟨i, mi, e⟩) | e
      · exact .inl (.inl (.inl e))
      · exact .inl (.inl (.inr (.inr ⟨i, mi, e⟩)))
      · exact .inl (.inl (.inr (.inl e)))
    · obtain ⟨s, ms, hs⟩ := (vany hc signed named).mp cl1
      simp only [Bool.and_eq_true] at hs
      rw [migrate_eq hc] at ms
      rcases List.mem_cons.mp ms with es | ms
      · subst es; simp [genesisStatement] at hs
      · obtain ⟨k, hk, es⟩ := mem_steps.mp ms
        subst es
        obtain ⟨_, hd⟩ := hs
        split at hd
        · next t v p d gu h =>
          obtain ⟨j, eo, -, -, -, ed, -⟩ := step_claim h
          have mj : j ∈ r.joins := join_mem (List.getElem_mem hk) eo
          subst ed
          simp only [memberDevices, List.contains_cons, Bool.or_eq_true, beq_iff_eq, List.contains_iff_mem,
            List.mem_map, List.mem_filter] at hd
          rcases hd with e | ⟨x, ⟨mx, _⟩, e⟩
          · exact .inl (.inr ⟨j, mj, e.symm⟩)
          · exact .inr ⟨x, mx, e⟩
        · cases hd
    · obtain ⟨s, ms, hs⟩ := (vany hc signed named).mp si
      rw [migrate_eq hc] at ms
      rcases List.mem_cons.mp ms with es | ms
      · subst es; simp [genesisStatement] at hs
      · obtain ⟨k, hk, es⟩ := mem_steps.mp ms
        subst es
        split at hs
        · next d h => exact absurd h step_not_signIn
        · cases hs
  · rintro (((e | e | ⟨i, mi, e⟩) | ⟨j, mj, e⟩) | ⟨x, mx, e⟩)
    · exact .inl (.inl (.inl (.inl e)))
    · exact .inl (.inl (.inr e))
    · exact .inl (.inl (.inl (.inr ⟨i, mi, e⟩)))
    · obtain ⟨k, hk, eo⟩ :=
        old_index (mem_refOrder.mpr (.inr (.inr (.inl ⟨j, mj, rfl⟩))) : Old.join j ∈ refOrder r)
      refine .inl (.inr ((vany hc signed named).mpr ⟨_, eo ▸ step_mem hk hc, ?_⟩))
      rw [standing_join hc signed named cl hk eo, final_join hc signed named cl hk eo]
      simp [step, Old.says, e, memberDevices]
    · have mj := cl.signIns_joined x mx
      obtain ⟨k, hk, eo⟩ :=
        old_index (mem_refOrder.mpr (.inr (.inr (.inl ⟨x.member, mj, rfl⟩))) : Old.join x.member ∈ refOrder r)
      refine .inl (.inr ((vany hc signed named).mpr ⟨_, eo ▸ step_mem hk hc, ?_⟩))
      rw [standing_join hc signed named cl hk eo, final_join hc signed named cl hk eo]
      simp only [step, Old.says, memberDevices, Bool.true_and, List.contains_cons, Bool.or_eq_true, beq_iff_eq,
        List.contains_iff_mem, List.mem_map, List.mem_filter]
      exact .inr ⟨x, ⟨mx, rfl⟩, e⟩

end

/-! ## The old side, checked

What remains of B3 is the old side: that `Members.restore` reads back a clean store (`isClean`), and that
`Members.admits` admits exactly its `restoredKeys`. Both are checked at every step of every invite trace below, and
stated in `PEERS.md`'s "Open" until they are proved. -/

/-- `Clean`, decided. -/
def isClean (r : Members) (c : Claim) : Bool :=
  r.invites.all (·.passkey == c.passkey) && r.joins.all (fun j => r.invites.any (·.key == j.invite)) &&
    r.withdrawn.all (fun w => r.joins.all (·.invite != w.key)) && r.signIns.all (fun s => r.joins.contains s.member) &&
    decide (refOrder r).Nodup && (r.joins.all fun j => r.joins.all fun j' => j.invite != j'.invite || j == j') &&
    decide ((refOrder r).length + 2 < 256 ^ 32)

theorem clean_of {r : Members} {c : Claim} (h : isClean r c = true) : Clean r c := by
  simp only [isClean, Bool.and_eq_true, List.all_eq_true, List.any_eq_true, beq_iff_eq, bne_iff_ne, ne_eq,
    List.contains_iff_mem, decide_eq_true_eq, Bool.or_eq_true] at h
  obtain ⟨⟨⟨⟨⟨⟨ia, ji⟩, nw⟩, sj⟩, nd⟩, jo⟩, fits⟩ := h
  exact ⟨ia, fun j m => (ji j m), fun w mw j mj e => nw w mw j mj e.symm, sj, nd,
    fun j m j' m' e => ((jo j m j' m').resolve_left (fun n => n e)), fits⟩

/-- A store's old door and its settled door, by `restoredKeys`, on every key the traces ask about. -/
def oldSideAgrees (m : Members) : Bool :=
  match m.founding.claim, m.restore with
  | none, _ => true
  | some c, .ok r => isClean r c && (askedKeys r).all fun k => r.admits k == (restoredKeys r c).contains k
  | some _, .error _ => false

#guard memberExamples.all fun (_, ops, _) => (boxMembers.run ops).all fun (_, m) => oldSideAgrees m
#guard (List.range 40).all fun n => (boxMembers.run (randomMemberTrace n)).all fun (_, m) => oldSideAgrees m

end Restore
end Aven.ID
