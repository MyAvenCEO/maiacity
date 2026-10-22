import AvenDB.StoredView
import AvenDB.RelayLemmas

/-!
# Removals read the trust records alone

The proof of V2, the removal rule of M2 of the master plan: which revocations stand, and which roots handed on, turns on
the edits that say who may do what alone (`Action.isTrust`: a vault made, an owner, a device or a grant given or taken,
a setting, an invite claimed), never on writes, marks, boxes, checkpoints, wraps or snapshots. So a device tries each
of them by a replay of those edits alone (`runTrust`), a few hundred where its log holds a hundred thousand writes, and
chooses the removals `resolve` chooses (`resolveTrust`), each at the cost of that short replay rather than a replay of
every edit.

A simulation, as for blind relays (`RelayLemmas.lean`). Every check of an edit that says who may do what reads only the
vaults, the shares and the revocations (`State.trust`), and changes nothing else that such a check reads (`apply_trust`);
every other edit leaves them alone (`apply_keeps_trust`). So a replay of those edits alone, each at its place, ends with
the same trust records and has the same of them stand (`runFrom_trust`), and a removal's priority reads the same
(`priority_congr`). Removals are tried in priority order, every revocation and root handed on before any mark that takes
an entry to another audience, so while one of them is tried every removal chosen before it says who may do what too;
with every edit's id its own, an edit of that replay stands exactly when it stands in the replay of every edit.
-/

namespace AvenDB

/-- A state's trust records: its vaults, its shares and its revocations, and nothing else. -/
def State.trust (st : State) : State := { vaults := st.vaults, shares := st.shares, revoked := st.revoked }

namespace Trusted

open Stored

/-! ## The trust records -/

theorem trust_vaults (st : State) : st.trust.vaults = st.vaults := rfl
theorem trust_shares (st : State) : st.trust.shares = st.shares := rfl
theorem trust_revoked (st : State) : st.trust.revoked = st.revoked := rfl

/-- Two states with the same vaults, shares and revocations have the same trust records. -/
theorem trust_ext {a b : State} (hv : a.vaults = b.vaults) (hs : a.shares = b.shares) (hr : a.revoked = b.revoked) :
    a.trust = b.trust := by
  simp only [State.trust, hv, hs, hr]

theorem trust_trust (st : State) : st.trust.trust = st.trust := rfl

/-! ## What reads only the trust records -/

theorem vault?_trust (st : State) : st.trust.vault? = st.vault? := by cases st; rfl
theorem depth_trust (st : State) : st.trust.depth = st.depth := by cases st; rfl
theorem share?_trust (st : State) : st.trust.share? = st.share? := by cases st; rfl
theorem live_trust (st : State) : st.trust.live = st.live := by cases st; rfl
theorem ownerOf_trust (st : State) : ownerOf st.trust = ownerOf st := by cases st; rfl
theorem isDevice_trust (st : State) : isDevice st.trust = isDevice st := by cases st; rfl
theorem roomFor_trust (st : State) : roomFor st.trust = roomFor st := by cases st; rfl
theorem ownerFits_trust (st : State) : ownerFits st.trust = ownerFits st := by
  funext k p; cases k <;> cases p <;> rfl

theorem actsVia_trust (st : State) : actsVia st.trust = actsVia st := by
  funext s via
  induction via with
  | nil => cases st; rfl
  | cons o via ih => funext v; simp only [actsVia, ih, ownerOf_trust]

theorem approvesN_trust (st : State) : approvesN st.trust = approvesN st := by
  funext sigs n
  induction n with
  | zero => funext p; cases p <;> rfl
  | succ n ih => funext p; cases p <;> simp only [approvesN, ih, vault?_trust]

theorem approves_trust (st : State) : approves st.trust = approves st := by
  funext sigs p; simp only [approves, approvesN_trust, depth_trust]

theorem ownsN_trust (st : State) : ownsN st.trust = ownsN st := by
  funext a n
  induction n with
  | zero => rfl
  | succ n ih => funext x; simp only [ownsN, ih, vault?_trust]

theorem owns_trust (st : State) : owns st.trust = owns st := by
  funext a x; simp only [owns, ownsN_trust, depth_trust]

theorem restsOnN_trust (st : State) : restsOnN st.trust = restsOnN st := by
  funext c n
  induction n with
  | zero => rfl
  | succ n ih => funext x; simp only [restsOnN, ih, share?_trust]

theorem restsOn_trust (st : State) : restsOn st.trust = restsOn st := by
  funext c x; simp only [restsOn, restsOnN_trust, trust_shares]

theorem holdsShare_trust (st : State) : holdsShare st.trust = holdsShare st := by
  funext a c r; simp only [holdsShare, live_trust]

theorem mayHold_trust (st : State) : mayHold st.trust = mayHold st := by
  funext a v; simp only [mayHold, trust_shares, holdsShare_trust]

theorem shareParentOk_trust (st : State) : shareParentOk st.trust = shareParentOk st := by
  funext c; simp only [shareParentOk, share?_trust, live_trust, toOwn, ownerOf_trust]

theorem restsOk_trust (st : State) : restsOk st.trust = restsOk st := by
  funext c; simp only [restsOk, mayHold_trust, shareParentOk_trust]

theorem mayRevokeN_trust (st : State) (a : VaultId) : mayRevokeN st.trust a = mayRevokeN st a := by
  funext n
  induction n with
  | zero => rfl
  | succ n ih => funext c; simp only [mayRevokeN, ih, share?_trust]

theorem mayRevoke_trust (st : State) : mayRevoke st.trust = mayRevoke st := by
  funext a c; simp only [mayRevoke, mayRevokeN_trust, trust_shares]

/-! ## Changes of the trust records -/

theorem setVault_trust (st : State) (vt : Vault) : (setVault st vt).trust = (setVault st.trust vt).trust := by
  cases st; rfl

theorem claimShare_trust (st : State) (c : ShareId) (v : VaultId) :
    (st.claimShare c v).trust = (st.trust.claimShare c v).trust := by
  cases st; rfl

/-- Dropping the writes a removal hadn't seen leaves the trust records alone. -/
theorem dropUnseen_trust (pre post : State) (keep : List EditId) : (dropUnseen pre post keep).trust = post.trust := rfl

/-- Hiding facts changes the trust records by the facts alone. -/
theorem hide_trust (st : State) (fs : List Fact) : (hide st fs).trust = (hide st.trust fs).trust := by
  unfold hide
  split <;> cases st <;> rfl

/-- Settling keys leaves the trust records alone. -/
theorem settle_trust (pre post : State) : (settle pre post).trust = post.trust :=
  trust_ext (Core.settle_vaults pre post) (Core.settle_shares pre post) (Core.settle_revoked pre post)

/-! ## Checking an edit -/

/-- Taking the trust records of a refusal is a refusal. -/
theorem map_ite_none {α β : Type} (f : α → β) (c : Prop) [Decidable c] (x : Option α) :
    Option.map f (if c then none else x) = if c then none else Option.map f x := by
  split <;> rfl

/-- An edit that says who may do what is accepted on a state's trust records exactly when it is accepted on the state,
    and the two results have the same trust records. -/
theorem apply_trust (st : State) (edit : Edit) (ht : edit.action.isTrust = true) :
    (apply st.trust edit).map State.trust = (apply st edit).map State.trust := by
  rcases edit with ⟨id, depth, author, cosigners, action, parents, files⟩
  cases action with
  | genesis v kind owners threshold root =>
    simp only [apply, Relays.sigs_mk, vault?_trust, ownerFits_trust, roomFor_trust, approves_trust]
    simp only [map_ite_none, Option.map_some]
    rfl
  | settings v s =>
    cases s with
    | threshold n =>
      simp only [apply, Relays.sigs_mk, vault?_trust, approves_trust]
      cases st.vault? v with
      | none => rfl
      | some vt => simp only [map_ite_none, Option.map_some, setVault_trust, trust_trust]
    | root r keep =>
      simp only [apply, Relays.sigs_mk, vault?_trust, approves_trust]
      cases st.vault? v with
      | none => rfl
      | some vt => simp only [map_ite_none, Option.map_some, setVault_trust, trust_trust]
  | share s =>
    cases s with
    | grant c via =>
      simp only [apply, Relays.sigs_mk, vault?_trust, share?_trust, actsVia_trust, isDevice_trust, restsOk_trust,
        approves_trust]
      simp only [map_ite_none, Option.map_some]
      rfl
    | owner v p =>
      simp only [apply, Relays.sigs_mk, vault?_trust, ownerFits_trust, roomFor_trust, approves_trust, owns_trust]
      cases st.vault? v with
      | none => rfl
      | some vt => simp only [map_ite_none, Option.map_some, setVault_trust, trust_trust]
    | device v d =>
      simp only [apply, Relays.sigs_mk, vault?_trust, approves_trust]
      cases st.vault? v with
      | none => rfl
      | some vt => simp only [map_ite_none, Option.map_some, setVault_trust, trust_trust]
  | revoke r =>
    cases r with
    | grant cid actor keep via =>
      simp only [apply, Relays.sigs_mk, share?_trust, live_trust, actsVia_trust, approves_trust, mayRevoke_trust]
      cases st.share? cid with
      | none => rfl
      | some c =>
        simp only [map_ite_none, Option.map_some, dropUnseen_trust, trust_shares, trust_revoked, restsOn_trust]
        rfl
    | owner v p keep =>
      simp only [apply, Relays.sigs_mk, vault?_trust, approves_trust]
      cases st.vault? v with
      | none => rfl
      | some vt => simp only [map_ite_none, Option.map_some, dropUnseen_trust, setVault_trust, trust_trust]
    | device v d keep =>
      simp only [apply, Relays.sigs_mk, vault?_trust, approves_trust]
      cases st.vault? v with
      | none => rfl
      | some vt => simp only [map_ite_none, Option.map_some, dropUnseen_trust, setVault_trust, trust_trust]
  | claim c v via =>
    simp only [apply, Relays.sigs_mk]
    unfold applyClaim
    simp only [share?_trust, live_trust, actsVia_trust, vault?_trust]
    cases st.share? c with
    | none => rfl
    | some x =>
      simp only
      cases x.who with
      | invite k => simp only [map_ite_none, Option.map_some, claimShare_trust, trust_trust]
      | _ => rfl
  | _ => simp [Action.isTrust] at ht

/-- An edit that says nothing of who may do what leaves the trust records alone. -/
theorem apply_keeps_trust {st post : State} {edit : Edit} (ht : edit.action.isTrust = false)
    (h : apply st edit = some post) : post.trust = st.trust := by
  rcases edit with ⟨id, depth, author, cosigners, action, parents, files⟩
  cases action with
  | write v e actor stay epoch deps proposal via create tags proof touches fits defines adds =>
    unfold apply at h
    dsimp only at h
    repeat' split at h
    all_goals first
      | (simp at h; done)
      | (obtain rfl := Option.some.inj h; split <;> rfl)
      | (obtain rfl := Option.some.inj h; rfl)
  | mark v e caps wants keep via =>
    unfold apply at h
    dsimp only at h
    repeat' split at h
    all_goals first
      | (simp at h; done)
      | (obtain rfl := Option.some.inj h; rfl)
  | keys secret to pub =>
    unfold apply at h
    dsimp only at h
    repeat' split at h
    all_goals first
      | (simp at h; done)
      | (obtain rfl := Option.some.inj h; rfl)
  | checkpoint v covers =>
    unfold apply at h
    dsimp only at h
    split at h
    · obtain rfl := Option.some.inj h; rfl
    · simp at h
  | wraps e ws =>
    unfold apply at h
    dsimp only at h
    split at h
    · obtain rfl := Option.some.inj h; rfl
    · simp at h
  | snapshot v states =>
    unfold apply at h
    dsimp only at h
    split at h
    · obtain rfl := Option.some.inj h; rfl
    · simp at h
  | _ => simp [Action.isTrust] at ht

/-- On states with the same trust records, an edit that says who may do what is accepted alike, and the results have the
    same trust records. -/
theorem apply_sim {a b : State} (h : a.trust = b.trust) {edit : Edit} (ht : edit.action.isTrust = true) :
    (apply a edit).map State.trust = (apply b edit).map State.trust := by
  rw [← apply_trust a edit ht, h, apply_trust b edit ht]

/-- The same of a step, which also settles keys. -/
theorem step_sim {a b : State} (h : a.trust = b.trust) {edit : Edit} (ht : edit.action.isTrust = true) :
    (step a edit).map State.trust = (step b edit).map State.trust := by
  have hs : ∀ s : State, State.trust ∘ settle s = State.trust := fun s => funext fun p => settle_trust s p
  simp only [step, Option.map_map, hs]
  exact apply_sim h ht

/-- A step of an edit that says nothing of who may do what leaves the trust records alone. -/
theorem step_keeps_trust {st st' : State} {edit : Edit} (ht : edit.action.isTrust = false)
    (h : step st edit = some st') : st'.trust = st.trust := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_trust]
  exact apply_keeps_trust ht hpost

/-- Hiding the same facts keeps the trust records equal. -/
theorem hide_sim {a b : State} (h : a.trust = b.trust) (fs : List Fact) : (hide a fs).trust = (hide b fs).trust := by
  rw [hide_trust, h, ← hide_trust]

/-! ## A replay of the trust edits alone -/

/-- Replaying only the edits that say who may do what, each at its place, from a state with the same trust records,
    ends with the same trust records, and the same of those edits stand. -/
theorem runFrom_trust (rem : List Edit) (cs : List (Nat × List EditId × List Fact)) :
    ∀ (l : List (Edit × Nat)) (st st' : State), st.trust = st'.trust →
    (runFrom rem cs st' (l.filter (·.1.action.isTrust))).1.trust = (runFrom rem cs st l).1.trust ∧
    (runFrom rem cs st' (l.filter (·.1.action.isTrust))).2 = (runFrom rem cs st l).2.filter (·.action.isTrust)
  | [], _, _, h => ⟨h.symm, rfl⟩
  | (edit, i) :: rest, st, st', h => by
    by_cases ht : edit.action.isTrust = true
    · rw [List.filter_cons_of_pos (by simpa using ht)]
      have ha := apply_sim (hide_sim h (hiddenAt cs i edit)) ht
      have hs := step_sim h ht
      simp only [runFrom]
      split
      · exact runFrom_trust rem cs rest st st' h
      · -- the check with the hidden facts, and the step, go alike on both sides
        cases h1 : apply (hide st (hiddenAt cs i edit)) edit with
        | none =>
          rw [h1] at ha
          cases h1' : apply (hide st' (hiddenAt cs i edit)) edit with
          | none => simp only; exact runFrom_trust rem cs rest st st' h
          | some _ => rw [h1'] at ha; exact absurd ha (by simp)
        | some x =>
          rw [h1] at ha
          cases h1' : apply (hide st' (hiddenAt cs i edit)) edit with
          | none => rw [h1'] at ha; exact absurd ha (by simp)
          | some x' =>
            cases h2 : step st edit with
            | none =>
              rw [h2] at hs
              cases h2' : step st' edit with
              | none => simp only; exact runFrom_trust rem cs rest st st' h
              | some _ => rw [h2'] at hs; exact absurd hs (by simp)
            | some y =>
              rw [h2] at hs
              cases h2' : step st' edit with
              | none => rw [h2'] at hs; exact absurd hs (by simp)
              | some y' =>
                rw [h2'] at hs
                have ih := runFrom_trust rem cs rest y y' (Option.some.inj hs)
                simp only [List.filter_cons, ht, ite_true]
                exact ⟨ih.1, by rw [ih.2]⟩
    · have hf : edit.action.isTrust = false := by simpa using ht
      rw [List.filter_cons_of_neg (by simpa using ht)]
      simp only [runFrom]
      split
      · exact runFrom_trust rem cs rest st st' h
      · cases h1 : apply (hide st (hiddenAt cs i edit)) edit with
        | none => simp only; exact runFrom_trust rem cs rest st st' h
        | some _ =>
          cases h2 : step st edit with
          | none => simp only; exact runFrom_trust rem cs rest st st' h
          | some y =>
            have ih := runFrom_trust rem cs rest y st' ((step_keeps_trust hf h2).trans h)
            simp only [List.filter_cons, hf]
            exact ⟨ih.1, by rw [ih.2]; rfl⟩

/-- `runTrust` ends with the trust records of `runWith`, and of the edits that say who may do what, the same stand. -/
theorem runTrust_eq (edits rem : List Edit) :
    (runTrust edits rem).1.trust = (runWith edits rem).1.trust ∧
    (runTrust edits rem).2 = (runWith edits rem).2.filter (·.action.isTrust) :=
  runFrom_trust rem (cuts edits rem) edits.zipIdx {} {} rfl

/-! ## The removals tried in priority order -/

/-- Priorities compare place by place, a total order. -/
theorem prioLe_total : ∀ a b : List Nat, prioLe a b || prioLe b a
  | [], _ => by simp [prioLe]
  | _ :: _, [] => by simp [prioLe]
  | x :: xs, y :: ys => by
    simp only [prioLe]
    rcases Nat.lt_trichotomy x y with hxy | rfl | hxy
    · simp [hxy]
    · simpa using prioLe_total xs ys
    · simp [hxy]

theorem prioLe_trans : ∀ a b c : List Nat, prioLe a b → prioLe b c → prioLe a c
  | [], _, _, _, _ => by simp [prioLe]
  | _ :: _, [], _, h, _ => by simp [prioLe] at h
  | _ :: _, _ :: _, [], _, h => by simp [prioLe] at h
  | x :: xs, y :: ys, z :: zs, h1, h2 => by
    simp only [prioLe, Bool.or_eq_true, decide_eq_true_eq, Bool.and_eq_true, beq_iff_eq] at h1 h2 ⊢
    rcases h1 with h1 | ⟨rfl, h1⟩ <;> rcases h2 with h2 | ⟨rfl, h2⟩
    · exact .inl (Nat.lt_trans h1 h2)
    · exact .inl h1
    · exact .inl h2
    · exact .inr ⟨rfl, prioLe_trans xs ys zs h1 h2⟩

/-- A removal that says who may do what ranks first among the vaults' removals or among the revoked grants. -/
theorem priority_trust_head (base : State) {a : Edit} (ha : a.isRemoval = true) (hat : a.action.isTrust = true) :
    (priority base a).head? = some 0 ∨ (priority base a).head? = some 1 := by
  rcases a with ⟨_, _, _, _, aa, _, _⟩
  cases aa with
  | revoke r =>
    cases r with
    | grant c actor keep via => exact .inr rfl
    | owner v p keep => unfold priority; simp only; repeat' split
                        all_goals exact .inl rfl
    | device v d keep => unfold priority; simp only; repeat' split
                         all_goals exact .inl rfl
  | settings v s =>
    cases s with
    | threshold n => simp [Edit.isRemoval, Action.keep?] at ha
    | root r k => unfold priority; simp only; repeat' split
                  all_goals exact .inl rfl
  | _ => simp_all [Edit.isRemoval, Action.keep?, Action.isTrust]

/-- A removal that says nothing of who may do what is a mark that takes an entry to another audience, which ranks after
    every removal that does. -/
theorem prioLe_mark_trust (base : State) {x a : Edit} (hx : x.isRemoval = true) (hxt : x.action.isTrust = false)
    (ha : a.isRemoval = true) (hat : a.action.isTrust = true) :
    prioLe (priority base x) (priority base a) = false := by
  have hpx : priority base x = [2, 0, 0, 0] := by
    rcases x with ⟨_, _, _, _, xa, _, _⟩
    cases xa with
    | mark v e caps wants keep via =>
      cases caps with
      | none => simp [Edit.isRemoval, Action.keep?] at hx
      | some to => rfl
    | _ => simp_all [Edit.isRemoval, Action.keep?, Action.isTrust]
  rw [hpx]
  rcases priority_trust_head base ha hat with h | h <;>
  · cases hp : priority base a with
    | nil => rw [hp] at h; simp at h
    | cons k t => rw [hp] at h; simp only [List.head?_cons, Option.some.injEq] at h; subst h; rfl

/-- Two edits with one id among edits whose ids are each their own are one edit. -/
theorem eq_of_id_eq : ∀ {l : List Edit}, (l.map Edit.id).Nodup → ∀ {x y : Edit}, x ∈ l → y ∈ l → x.id = y.id → x = y
  | [], _, _, _, hx, _, _ => absurd hx List.not_mem_nil
  | a :: l, h, x, y, hx, hy, he => by
    rw [List.map_cons, List.nodup_cons] at h
    rcases List.mem_cons.1 hx with hxa | hxl <;> rcases List.mem_cons.1 hy with hya | hyl
    · rw [hxa, hya]
    · rw [hxa] at he; exact (h.1 (by rw [he]; exact List.mem_map_of_mem hyl)).elim
    · rw [hya] at he; exact (h.1 (by rw [← he]; exact List.mem_map_of_mem hxl)).elim
    · exact eq_of_id_eq h.2 hxl hyl he

/-- A fold over a list sorted by `R`, whose two step functions agree wherever every member of the accumulator comes
    before the next, gives one result. -/
theorem foldl_congr_sorted {α : Type} (R : α → α → Prop) (S : α → Prop) (f g : List α → α → List α)
    (hfg : ∀ b a, (∀ x ∈ b, S x ∧ R x a) → S a → f b a = g b a) (hf : ∀ b a, f b a = b ++ [a] ∨ f b a = b) :
    ∀ (l b : List α), l.Pairwise R → (∀ a ∈ l, S a) → (∀ x ∈ b, S x ∧ ∀ y ∈ l, R x y) →
    l.foldl f b = l.foldl g b
  | [], _, _, _, _ => rfl
  | a :: l, b, hp, hs, hb => by
    rw [List.pairwise_cons] at hp
    simp only [List.foldl_cons]
    have hsa := hs a List.mem_cons_self
    rw [← hfg b a (fun x hx => ⟨(hb x hx).1, (hb x hx).2 a List.mem_cons_self⟩) hsa]
    refine foldl_congr_sorted R S f g hfg hf l (f b a) hp.2 (fun y hy => hs y (List.mem_cons_of_mem _ hy)) ?_
    intro x hx
    rcases hf b a with he | he <;> rw [he] at hx
    · rcases List.mem_append.1 hx with hx | hx
      · exact ⟨(hb x hx).1, fun y hy => (hb x hx).2 y (List.mem_cons_of_mem _ hy)⟩
      · rw [List.mem_singleton] at hx; subst hx; exact ⟨hsa, hp.1⟩
    · exact ⟨(hb x hx).1, fun y hy => (hb x hx).2 y (List.mem_cons_of_mem _ hy)⟩

/-- Of edits whose ids are each their own, an edit that says who may do what stands in the replay of every edit exactly
    when it stands in the replay of the trust edits alone. -/
theorem stands_trust {edits rem : List Edit} (hids : (edits.map Edit.id).Nodup) {x : Edit} (hx : x ∈ edits)
    (hxt : x.action.isTrust = true) :
    (runTrust edits rem).2.any (·.id == x.id) = (runWith edits rem).2.any (·.id == x.id) := by
  rw [(runTrust_eq edits rem).2]
  apply Bool.eq_iff_iff.2
  constructor
  · intro h
    obtain ⟨y, hy, he⟩ := List.any_eq_true.1 h
    exact List.any_eq_true.2 ⟨y, (List.mem_filter.1 hy).1, he⟩
  · intro h
    obtain ⟨y, hy, he⟩ := List.any_eq_true.1 h
    have hye : y ∈ edits := by
      have := Shares.runFrom_snd_mem rem (cuts edits rem) {} edits.zipIdx y hy
      rwa [List.zipIdx_map_fst] at this
    have : y = x := eq_of_id_eq hids hye hx (by simpa using he)
    subst this
    exact List.any_eq_true.2 ⟨y, List.mem_filter.2 ⟨hy, by simpa using hxt⟩, he⟩

/-- Of edits whose ids are each their own, trying each removal that says who may do what on the trust edits alone
    chooses the removals `resolve` chooses. -/
theorem resolveTrust_eq (edits : List Edit) (hids : (edits.map Edit.id).Nodup) : resolveTrust edits = resolve edits := by
  -- the replays without removals have the same trust records, so every removal the same priority
  have hbase := (runTrust_eq edits []).1
  have hv : (runTrust edits []).1.vaults = (runWith edits []).1.vaults := by
    have := congrArg State.vaults hbase; exact this
  have hc : (runTrust edits []).1.shares = (runWith edits []).1.shares := by
    have := congrArg State.shares hbase; exact this
  have hprio : priority (runTrust edits []).1 = priority (runWith edits []).1 := priority_congr hv hc
  unfold resolveTrust resolve
  dsimp only
  rw [hprio]
  -- the candidates are sorted, so every one tried before a trust edit is a trust edit
  let base := (runWith edits []).1
  let R := fun a b : Edit => prioLe (priority base a) (priority base b) = true
  have hsorted := List.pairwise_mergeSort (le := fun a b => prioLe (priority base a) (priority base b))
    (fun a b c h1 h2 => prioLe_trans _ _ _ h1 h2) (fun a b => prioLe_total _ _) (edits.filter Edit.isRemoval)
  symm
  refine foldl_congr_sorted R (fun x => x ∈ edits ∧ x.isRemoval = true) _ _ (fun rem r hrem hr => ?_)
    (fun rem r => by split <;> simp) _ [] hsorted
    (fun r hr => List.mem_filter.1 (List.mem_mergeSort.1 hr)) (by simp)
  by_cases hrt : r.action.isTrust = true
  · -- every removal chosen before it says who may do what, and so is it: each stands alike in both replays
    have hremt : ∀ x ∈ rem, x.action.isTrust = true := fun x hx => by
      cases hxt : x.action.isTrust with
      | true => rfl
      | false =>
        have := prioLe_mark_trust base (hrem x hx).1.2 hxt hr.2 hrt
        have h2 := (hrem x hx).2
        simp only [R, this] at h2
        exact absurd h2 (by simp)
    simp only [hrt, ↓reduceIte]
    have hall : ((r :: rem).all fun x => (runTrust edits (rem ++ [r])).2.any (·.id == x.id)) =
        ((r :: rem).all fun x => (runWith edits (rem ++ [r])).2.any (·.id == x.id)) := by
      refine all_congr_mem fun x hx => ?_
      rcases List.mem_cons.1 hx with rfl | hx
      · exact stands_trust hids hr.1 hrt
      · exact stands_trust hids (hrem x hx).1.1 (hremt x hx)
    rw [hall]
  · simp only [Bool.not_eq_true] at hrt
    simp only [hrt, Bool.false_eq_true, ↓reduceIte]

end Trusted

end AvenDB
