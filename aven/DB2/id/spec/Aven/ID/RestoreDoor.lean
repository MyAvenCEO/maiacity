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

/-- The device keys a restored store's door admits. -/
def restoredKeys (r : Members) (c : Claim) : List String :=
  c.deviceKey :: r.founding.peerKey :: r.founding.signIns.map (·.deviceKey) ++ r.joins.map (·.deviceKey) ++
    r.signIns.map (·.signIn.deviceKey)

section

variable {r : Members} {c : Claim} {g : GuardianKeys}

/-- The migrated old statements. -/
abbrev steps (r : Members) (c : Claim) (g : GuardianKeys) : List TreeStatement := (refOrder r).mapIdx (step r c g)

theorem migrate_eq (hc : r.founding.claim = some c) : migrate r g = genesisStatement r c g :: steps r c g := by
  simp [migrate, hc]

theorem mem_steps {s : TreeStatement} :
    s ∈ steps r c g ↔ ∃ k, ∃ h : k < (refOrder r).length, s = step r c g k (refOrder r)[k] := by
  simp only [steps, List.mem_iff_getElem, List.length_mapIdx, List.getElem_mapIdx]
  constructor
  · rintro ⟨k, hk, e⟩; exact ⟨k, hk, e.symm⟩
  · rintro ⟨k, hk, e⟩; exact ⟨k, hk, e.symm⟩

theorem step_mem {k : Nat} (hk : k < (refOrder r).length) (hc : r.founding.claim = some c) :
    step r c g k (refOrder r)[k] ∈ migrate r g := by
  rw [migrate_eq hc]
  exact List.mem_cons_of_mem _ (mem_steps.mpr ⟨k, hk, rfl⟩)

/-- Every migrated statement counts. -/
theorem migrate_counted (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true) :
    ∀ s ∈ migrate r g, counted restored 1 (migrate r g) s = true := by
  intro s ms
  have hg : pinnedGenesis restored 1 (genesisStatement r c g) = true := by
    simp [pinnedGenesis, restored, genesisStatement, signed]
  have mg : genesisStatement r c g ∈ migrate r g := by rw [migrate_eq hc]; exact List.mem_cons_self ..
  refine (counted_iff restored 1).mpr ⟨rfl, ?_⟩
  have ms' := ms
  simp only [migrate, hc, List.mem_cons] at ms'
  rcases ms' with e | ms'
  · subst e; exact .inl hg
  · obtain ⟨k, hk, e⟩ := List.mem_iff_getElem.mp ms'
    subst e
    exact .inr ⟨_, mg, hg, migrate_past r g c hc k hk⟩

theorem vany (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    {p : TreeStatement → Bool} : (view restored 1 (migrate r g)).any p = true ↔ ∃ s ∈ migrate r g, p s = true := by
  rw [view_any]
  exact ⟨fun ⟨s, m, _, h⟩ => ⟨s, m, h⟩, fun ⟨s, m, h⟩ => ⟨s, m, migrate_counted hc signed s m, h⟩⟩

theorem vall (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    {p : TreeStatement → Bool} : (view restored 1 (migrate r g)).all p = true ↔ ∀ s ∈ migrate r g, p s = true := by
  rw [view_all_iff]
  exact ⟨fun h s m => h s m (migrate_counted hc signed s m), fun h s m _ => h s m⟩

theorem vpast (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    {a b : TreeStatement} : (view restored 1 (migrate r g)).past a b = true ↔
      a ∈ migrate r g ∧ b ∈ migrate r g ∧ InPast (migrate r g) a b := by
  rw [view_past]
  exact ⟨fun ⟨⟨ma, _⟩, ⟨mb, _⟩, p⟩ => ⟨ma, mb, p⟩,
    fun ⟨ma, mb, p⟩ => ⟨⟨ma, migrate_counted hc signed a ma⟩, ⟨mb, migrate_counted hc signed b mb⟩, p⟩⟩

/-- No migrated old statement is a genesis: they say what the old statements said. -/
theorem step_not_genesis {k : Nat} {o : Old} {gs : Genesis} : (step r c g k o).says ≠ .genesis gs := by
  cases o <;> simp [step, Old.says]

/-- The pinned genesis is the migrated claim's: what `gen` reads is `genesisOf`. -/
theorem gen_eq (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (P : Genesis → Bool) : gen (view restored 1 (migrate r g)) P = P (genesisOf r.founding c g) := by
  apply Bool.eq_iff_iff.mpr
  unfold gen
  rw [vany hc signed]
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
    (∃ i ∈ r.founding.signIns, o = .signIn i) ∨ (∃ i ∈ r.invites, o = .invite i) ∨
      (∃ w ∈ r.withdrawn, o = .withdrawal w) ∨ (∃ j ∈ r.joins, o = .join j) ∨
        (∃ s ∈ r.signIns, o = .memberSignIn s) ∨ (∃ j ∈ r.joins, o = .confirm j) := by
  simp only [refOrder, List.mem_append, List.mem_map, List.mem_mergeSort]
  constructor
  · rintro (((((⟨i, m, e⟩ | ⟨i, m, e⟩) | ⟨w, m, e⟩) | ⟨j, m, e⟩) | ⟨x, m, e⟩) | ⟨j, m, e⟩)
    · exact .inl ⟨i, m, e.symm⟩
    · exact .inr (.inl ⟨i, m, e.symm⟩)
    · exact .inr (.inr (.inl ⟨w, m, e.symm⟩))
    · exact .inr (.inr (.inr (.inl ⟨j, m, e.symm⟩)))
    · exact .inr (.inr (.inr (.inr (.inl ⟨x, m, e.symm⟩))))
    · exact .inr (.inr (.inr (.inr (.inr ⟨j, m, e.symm⟩))))
  · rintro (⟨i, m, e⟩ | ⟨i, m, e⟩ | ⟨w, m, e⟩ | ⟨j, m, e⟩ | ⟨x, m, e⟩ | ⟨j, m, e⟩)
    · exact .inl (.inl (.inl (.inl (.inl ⟨i, m, e.symm⟩))))
    · exact .inl (.inl (.inl (.inl (.inr ⟨i, m, e.symm⟩))))
    · exact .inl (.inl (.inl (.inr ⟨w, m, e.symm⟩)))
    · exact .inl (.inl (.inr ⟨j, m, e.symm⟩))
    · exact .inl (.inr ⟨x, m, e.symm⟩)
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
    ticketName olds key = (match indexWhere (isInvite key) olds with | some k => nameAt k | none => 0) := by
  rfl

/-- A ticket name that names something is the place of an invite with that key. -/
theorem ticketName_spec {olds : List Old} {key : String} {k : Nat} (h : ticketName olds key = nameAt k) :
    ∃ hk : k < olds.length, ∃ i, olds[k] = .invite i ∧ i.key = key := by
  rw [ticketName_eq] at h
  cases e : indexWhere (isInvite key) olds with
  | none => simp [e, nameAt] at h
  | some k' =>
    simp only [e, nameAt, Nat.add_right_cancel_iff] at h
    subst h
    obtain ⟨hk, p⟩ := indexWhere_some e
    refine ⟨hk, ?_⟩
    cases e' : olds[k'] with
    | invite i => rw [e'] at p; exact ⟨i, rfl, by simpa [isInvite] using p⟩
    | _ => rw [e'] at p; simp [isInvite] at p

/-- An invite the store holds has a ticket name. -/
theorem ticketName_found {olds : List Old} {i : Invite} (m : Old.invite i ∈ olds) :
    ∃ k, ticketName olds i.key = nameAt k := by
  obtain ⟨k, hk⟩ := indexWhere_found m (by simp [isInvite] : isInvite i.key (.invite i) = true)
  exact ⟨k, by rw [ticketName_eq, hk]⟩

theorem nameAt_ne_zero (k : Nat) : nameAt k ≠ 0 := by simp [nameAt]

/-- Two keys with one ticket name that names something are one key. -/
theorem ticketName_inj {olds : List Old} {a b : String} {k : Nat} (ha : ticketName olds a = nameAt k)
    (hb : ticketName olds b = nameAt k) : a = b := by
  obtain ⟨hk, i, e, ka⟩ := ticketName_spec ha
  obtain ⟨_, i', e', kb⟩ := ticketName_spec hb
  rw [e] at e'
  cases e'
  exact ka.symm.trans kb

/-! ## What each migrated statement says -/

section

variable {r : Members} {c : Claim} {g : GuardianKeys}

theorem step_claim {k : Nat} {o : Old} {t : Nat} {v p d : String} {gu : GuardianKeys}
    (h : (step r c g k o).says = .claim t v p d gu) :
    ∃ j, o = .join j ∧ t = ticketName (refOrder r) j.invite ∧ v = j.person ∧ p = j.passkey ∧ d = j.deviceKey ∧
      (step r c g k o).signer = j.invite := by
  cases o <;> simp [step, Old.says] at h ⊢
  next j => exact ⟨h.1.symm, h.2.1.symm, h.2.2.1.symm, h.2.2.2.1.symm⟩

theorem step_withdrawal {k : Nat} {o : Old} {t : Nat} (h : (step r c g k o).says = .withdrawal t) :
    ∃ w, o = .withdrawal w ∧ t = ticketName (refOrder r) w.key := by
  cases o <;> simp [step, Old.says] at h ⊢
  next w => exact h.symm

theorem step_signIn {k : Nat} {o : Old} {v d : String} (h : (step r c g k o).says = .signIn v d) :
    (∃ i, o = .signIn i ∧ v = c.person ∧ d = i.deviceKey) ∨
      (∃ s, o = .memberSignIn s ∧ v = s.member.person ∧ d = s.signIn.deviceKey ∧
        (step r c g k o).signer = s.member.passkey) := by
  cases o <;> simp [step, Old.says] at h ⊢
  next i => exact ⟨h.1.symm, h.2.symm⟩
  next s => exact ⟨h.1.symm, h.2.symm⟩

theorem step_confirm {k : Nat} {o : Old} {n : Nat} (h : (step r c g k o).says = .confirm n) :
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

variable {r : Members} {c : Claim} {g : GuardianKeys}

theorem invite_mem {o : Old} {i : Invite} (m : o ∈ refOrder r) (e : o = .invite i) : i ∈ r.invites := by
  subst e
  rcases mem_refOrder.mp m with ⟨_, _, h⟩ | ⟨x, mx, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ <;> cases h
  exact mx

theorem join_mem {o : Old} {j : Join} (m : o ∈ refOrder r) (e : o = .join j) : j ∈ r.joins := by
  subst e
  rcases mem_refOrder.mp m with ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨x, mx, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ <;> cases h
  exact mx

theorem withdrawal_mem {o : Old} {w : Withdrawal} (m : o ∈ refOrder r) (e : o = .withdrawal w) : w ∈ r.withdrawn := by
  subst e
  rcases mem_refOrder.mp m with ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨x, mx, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ <;> cases h
  exact mx

theorem memberSignIn_mem {o : Old} {s : MemberSignIn} (m : o ∈ refOrder r) (e : o = .memberSignIn s) :
    s ∈ r.signIns := by
  subst e
  rcases mem_refOrder.mp m with ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨x, mx, h⟩ | ⟨_, _, h⟩ <;> cases h
  exact mx

theorem signIn_mem {o : Old} {i : SignIn} (m : o ∈ refOrder r) (e : o = .signIn i) : i ∈ r.founding.signIns := by
  subst e
  rcases mem_refOrder.mp m with ⟨x, mx, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ | ⟨_, _, h⟩ <;> cases h
  exact mx

/-- A join's ticket: an invite the store holds, with the join's key, at a place of the old statements. -/
theorem join_ticket (cl : Clean r c) {j : Join} (mj : j ∈ r.joins) :
    ∃ t, ∃ ht : t < (refOrder r).length, ∃ i, (refOrder r)[t] = .invite i ∧ i ∈ r.invites ∧ i.key = j.invite ∧
      ticketName (refOrder r) j.invite = nameAt t := by
  obtain ⟨i, mi, ki⟩ := cl.joins_invited j mj
  obtain ⟨t, ht⟩ := ticketName_found (mem_refOrder.mpr (.inr (.inl ⟨i, mi, rfl⟩)) : Old.invite i ∈ refOrder r)
  obtain ⟨htl, i', et, k'⟩ := ticketName_spec ht
  exact ⟨t, htl, i', et, invite_mem (List.getElem_mem htl) et, k'.trans ki, ki ▸ ht⟩

theorem claimOk_join (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (cl : Clean r c) {k : Nat} (hk : k < (refOrder r).length) {j : Join} (e : (refOrder r)[k] = .join j) :
    claimOk (view restored 1 (migrate r g)) (step r c g k (.join j)) = true := by
  have mj : j ∈ r.joins := join_mem (List.getElem_mem hk) e
  obtain ⟨t, ht, i, et, mi, ki, tn⟩ := join_ticket cl mj
  have mT : step r c g t (.invite i) ∈ migrate r g := et ▸ step_mem ht hc
  have mC : step r c g k (.join j) ∈ migrate r g := e ▸ step_mem hk hc
  unfold claimOk
  simp only [step, Old.says, Bool.and_eq_true]
  refine ⟨(vany hc signed).mpr ⟨_, mT, ?_⟩, by rw [gen_eq hc signed]; simp [genesisOf]⟩
  simp only [Bool.and_eq_true, beq_iff_eq]
  refine ⟨⟨⟨?_, ?_⟩, ?_⟩, ?_⟩
  · simp [step, tn]
  · simp only [byAdmin, gen_eq hc signed, step, Old.says, cl.invites_admin i mi]
    exact Genesis.approves_claimant (genesisOf r.founding c g) (by simp [genesisOf]) stmtDigest
  · simp [step, Old.says, ki]
  · refine (vpast hc signed).mpr ⟨by simpa [step, Old.says] using mC, mT, .tip mT ?_⟩
    simp [step, Old.tips, tn]

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
    (cl : Clean r c) {k : Nat} (hk : k < (refOrder r).length) {j : Join} (e : (refOrder r)[k] = .join j) :
    final (view restored 1 (migrate r g)) (step r c g k (.join j)) = true := by
  have mj : j ∈ r.joins := join_mem (List.getElem_mem hk) e
  obtain ⟨kc, hkc, ec⟩ := List.mem_iff_getElem.mp
    (mem_refOrder.mpr (.inr (.inr (.inr (.inr (.inr ⟨j, mj, rfl⟩))))) : Old.confirm j ∈ refOrder r)
  have mC : step r c g k (.join j) ∈ migrate r g := e ▸ step_mem hk hc
  have mK : step r c g kc (.confirm j) ∈ migrate r g := ec ▸ step_mem hkc hc
  have jn := joinName_at cl hk e
  unfold final
  rw [claimOk_join hc signed cl hk e, Bool.true_and]
  refine (vany hc signed).mpr ⟨_, mK, ?_⟩
  simp only [Bool.and_eq_true, beq_iff_eq]
  refine ⟨⟨?_, ?_⟩, ?_⟩
  · unfold confirmer
    simp only [Bool.or_eq_true]
    left; left
    simp only [byAdmin, gen_eq hc signed, step, Old.says]
    exact Genesis.approves_claimant (genesisOf r.founding c g) (by simp [genesisOf]) stmtDigest
  · simp [step, Old.says, jn]
  · refine (vpast hc signed).mpr ⟨mK, mC, .tip mC ?_⟩
    simp [step, Old.tips, jn]

/-- **Every join's claim stands** in the settled tree of a clean store. -/
theorem standing_join (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (cl : Clean r c) {k : Nat} (hk : k < (refOrder r).length) {j : Join} (e : (refOrder r)[k] = .join j) :
    standing (view restored 1 (migrate r g)) (step r c g k (.join j)) = true := by
  have mj : j ∈ r.joins := join_mem (List.getElem_mem hk) e
  obtain ⟨t, _, _, _, _, _, tn⟩ := join_ticket cl mj
  have cok := claimOk_join hc signed cl hk e
  have ticket : (step r c g k (.join j)).ticketOf = some (ticketName (refOrder r) j.invite) := by
    simp [step, Old.says, TreeStatement.ticketOf]
  unfold standing
  rw [cok, Bool.true_and]
  have mC : step r c g k (.join j) ∈ migrate r g := e ▸ step_mem hk hc
  have fC := final_join hc signed cl hk e
  have anyfinal : (view restored 1 (migrate r g)).any
      (fun f => final (view restored 1 (migrate r g)) f && sameTicket f (step r c g k (.join j))) = true :=
    (vany hc signed).mpr ⟨_, mC, by simp [fC, sameTicket, ticket]⟩
  simp only [anyfinal, ↓reduceIte, fC, Bool.true_and]
  refine (vall hc signed).mpr fun d md => ?_
  simp only [Bool.or_eq_true, Bool.not_eq_true', Bool.and_eq_false_iff, decide_eq_true_eq]
  by_cases df : final (view restored 1 (migrate r g)) d = true
  · by_cases ds : sameTicket d (step r c g k (.join j)) = true
    · -- another final claim of the join's ticket is the same join's
      right
      have dc := final_claimOk df
      rw [migrate_eq hc] at md
      rcases List.mem_cons.mp md with ed | md
      · subst ed; simp [claimOk, genesisStatement] at dc
      · obtain ⟨kd, hkd, ed⟩ := mem_steps.mp md
        subst ed
        have dt : (step r c g kd (refOrder r)[kd]).ticketOf = some (ticketName (refOrder r) j.invite) := by
          simp only [sameTicket, Bool.and_eq_true, beq_iff_eq] at ds
          rw [ds.2, ticket]
        unfold TreeStatement.ticketOf at dt
        split at dt
        · next t' v' p' d' gu' hs =>
          obtain ⟨j', eo, tj, -⟩ := step_claim hs
          simp only [Option.some.injEq] at dt
          have mj' : j' ∈ r.joins := join_mem (List.getElem_mem hkd) eo
          have jj : j' = j := cl.join_once j' mj' j mj (ticketName_inj (tj.symm.trans (dt.trans tn)) tn)
          subst jj
          have kk : kd = k := nodup_getElem_inj cl.olds_nodup hkd hk (eo.trans e.symm)
          subst kk
          exact Nat.le_refl _
        · cases dt
    · left; right; simpa using ds
  · left; left; simpa using df
end

/-! ## The door -/

section

variable {r : Members} {c : Claim} {g : GuardianKeys}

theorem old_index {o : Old} (m : o ∈ refOrder r) : ∃ k, ∃ hk : k < (refOrder r).length, (refOrder r)[k] = o :=
  List.mem_iff_getElem.mp m

/-- A member's passkey: the passkey of every joined vault is its passkey in the settled tree. -/
theorem ownerKeyOf_join (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (cl : Clean r c) {j : Join} (mj : j ∈ r.joins) :
    ownerKeyOf (view restored 1 (migrate r g)) j.person j.passkey = true := by
  obtain ⟨k, hk, e⟩ := old_index (mem_refOrder.mpr (.inr (.inr (.inr (.inl ⟨j, mj, rfl⟩)))) : Old.join j ∈ refOrder r)
  unfold ownerKeyOf
  simp only [Bool.or_eq_true]
  refine .inr ((vany hc signed).mpr ⟨_, e ▸ step_mem hk hc, ?_⟩)
  rw [standing_join hc signed cl hk e, final_join hc signed cl hk e]
  simp [step, Old.says]

/-- A migrated store changes no setting: its Aven Peer is the genesis's, production's peer key. -/
theorem peerIs_eq (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (key : String) : peerIs (view restored 1 (migrate r g)) key = (key == r.founding.peerKey) := by
  have none : (view restored 1 (migrate r g)).any (configBy (view restored 1 (migrate r g)) isPeerSet) = false := by
    cases e : (view restored 1 (migrate r g)).any (configBy (view restored 1 (migrate r g)) isPeerSet)
    · rfl
    · exfalso
      obtain ⟨s, ms, h⟩ := (vany hc signed).mp e
      simp only [configBy, Bool.and_eq_true] at h
      rw [migrate_eq hc] at ms
      rcases List.mem_cons.mp ms with es | ms
      · subst es; simp [genesisStatement, isPeerSet] at h
      · obtain ⟨k, _, es⟩ := mem_steps.mp ms
        subst es
        cases o : (refOrder r)[k] <;> simp [o, step, Old.says, isPeerSet] at h
  unfold peerIs setting
  rw [none]
  simp only [Bool.false_eq_true, ↓reduceIte, gen_eq hc signed, genesisOf]
  cases e : (key == r.founding.peerKey) <;> cases e' : (r.founding.peerKey == key) <;> simp_all

/-- **`settle_restore_door`**, the settled side of `restore_agrees` for every clean store: the settled tree of
production's migrated store admits exactly the store's device keys. -/
theorem settle_restore_door (hc : r.founding.claim = some c) (signed : (genesisOf r.founding c g).consented = true)
    (cl : Clean r c) (key : String) :
    (settle restored 1 (migrate r g)).admits key = true ↔ key ∈ restoredKeys r c := by
  simp only [settle, settleView]
  unfold admits
  rw [peerIs_eq hc signed]
  simp only [Bool.or_eq_true, gen_eq hc signed, genesisOf, List.contains_cons, List.contains_nil, Bool.or_false,
    beq_iff_eq, restoredKeys, List.mem_cons, List.mem_append, List.mem_map]
  constructor
  · rintro ((g1 | cl1) | si)
    · rcases g1 with e | e
      · exact .inl (.inl (.inl e))
      · exact .inl (.inl (.inr (.inl e)))
    · obtain ⟨s, ms, hs⟩ := (vany hc signed).mp cl1
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
          simp only [beq_iff_eq] at hd
          exact .inl (.inr ⟨j, mj, ed ▸ hd⟩)
        · cases hd
    · obtain ⟨s, ms, hs⟩ := (vany hc signed).mp si
      rw [migrate_eq hc] at ms
      rcases List.mem_cons.mp ms with es | ms
      · subst es; simp [genesisStatement] at hs
      · obtain ⟨k, hk, es⟩ := mem_steps.mp ms
        subst es
        split at hs
        · next v d h =>
          simp only [Bool.and_eq_true, beq_iff_eq] at hs
          rcases step_signIn h with ⟨i, eo, -, ed⟩ | ⟨x, eo, -, ed, -⟩
          · exact .inl (.inl (.inr (.inr ⟨i, signIn_mem (List.getElem_mem hk) eo, (ed ▸ hs.1)⟩)))
          · exact .inr ⟨x, memberSignIn_mem (List.getElem_mem hk) eo, (ed ▸ hs.1)⟩
        · cases hs
  · rintro (((e | e | ⟨i, mi, e⟩) | ⟨j, mj, e⟩) | ⟨x, mx, e⟩)
    · exact .inl (.inl (.inl e))
    · exact .inl (.inl (.inr e))
    · obtain ⟨k, hk, eo⟩ := old_index (mem_refOrder.mpr (.inl ⟨i, mi, rfl⟩) : Old.signIn i ∈ refOrder r)
      refine .inr ((vany hc signed).mpr ⟨_, eo ▸ step_mem hk hc, ?_⟩)
      simp [step, Old.says, e, ownerKeyOf, gen_eq hc signed, genesisOf]
    · obtain ⟨k, hk, eo⟩ :=
        old_index (mem_refOrder.mpr (.inr (.inr (.inr (.inl ⟨j, mj, rfl⟩)))) : Old.join j ∈ refOrder r)
      refine .inl (.inr ((vany hc signed).mpr ⟨_, eo ▸ step_mem hk hc, ?_⟩))
      rw [standing_join hc signed cl hk eo, final_join hc signed cl hk eo]
      simp [step, Old.says, e]
    · obtain ⟨k, hk, eo⟩ :=
        old_index (mem_refOrder.mpr (.inr (.inr (.inr (.inr (.inl ⟨x, mx, rfl⟩))))) : Old.memberSignIn x ∈ refOrder r)
      refine .inr ((vany hc signed).mpr ⟨_, eo ▸ step_mem hk hc, ?_⟩)
      simp [step, Old.says, e, ownerKeyOf_join hc signed cl (cl.signIns_joined x mx)]

end

/-! ## The old side, checked

What remains of B3 is the old side: that `Members.restore` reads back a clean store (`isClean`), and that
`Members.admits` admits exactly its `restoredKeys`. Both are checked at every step of every invite trace below, and
stated in `PEERS.md`'s "Open" until they are proved. -/

/-- `Clean`, decided. -/
def isClean (r : Members) (c : Claim) : Bool :=
  r.invites.all (·.passkey == c.passkey) && r.joins.all (fun j => r.invites.any (·.key == j.invite)) &&
    r.withdrawn.all (fun w => r.joins.all (·.invite != w.key)) && r.signIns.all (fun s => r.joins.contains s.member) &&
    decide (refOrder r).Nodup && r.joins.all fun j => r.joins.all fun j' => j.invite != j'.invite || j == j'

theorem clean_of {r : Members} {c : Claim} (h : isClean r c = true) : Clean r c := by
  simp only [isClean, Bool.and_eq_true, List.all_eq_true, List.any_eq_true, beq_iff_eq, bne_iff_ne, ne_eq,
    List.contains_iff_mem, decide_eq_true_eq, Bool.or_eq_true] at h
  obtain ⟨⟨⟨⟨⟨ia, ji⟩, nw⟩, sj⟩, nd⟩, jo⟩ := h
  exact ⟨ia, fun j m => (ji j m), fun w mw j mj e => nw w mw j mj e.symm, sj, nd,
    fun j m j' m' e => ((jo j m j' m').resolve_left (fun n => n e))⟩

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
