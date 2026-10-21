import AvenDB.Claims

/-!
# Convergence and sync

The proofs of convergence (T11), of sync (T12, T13, T19, T20) and of holdings (H1, T27 extended), stated as in
`Theorems.lean`.

The replay order is a total preorder whose ties are edits with the same id, so sorting any arrangement of the same
edits, with distinct ids, gives one list (`order_perm`). A peer's answer is made of two filters of its edits: the edits
of the entry, audience and share logs the device may receive, and the edits of the vault logs it gathers
(`mem_respond`). What everyone may receive goes only to a device with an interest in its vault or that follows it, so a
device that acts for no vault and follows none is sent nothing (`T12_interest`, `T12_stranger_gets_nothing`). The
closed part of a log holds the whole past of each of its edits, so everything a responder finds below an asker's
frontier is something the asker holds (`reaches_held`). A peer's answer is a union of whole logs
(`respond_whole_logs`), so the files of the logs a device may know of are files it may fetch (`reachFiles_fetch`). A
node keeps of a device only what announcements on connections that proved it said (`record_sound`), and a frontier a
device states of its shelf covers a log only if its shelf holds every edit of it the node holds (`covered_held`).
-/

namespace AvenDB.Syncing

/-! ## One order -/

/-- `Edit.before` compares depth, then rank, then id: the order of triples of numbers (`omega` sees through numbers,
    not through the names `EditId` gives them). -/
private def lexLe (d₁ r₁ i₁ d₂ r₂ i₂ : Nat) : Prop := d₁ < d₂ ∨ d₁ = d₂ ∧ (r₁ < r₂ ∨ r₁ = r₂ ∧ i₁ ≤ i₂)

/-- `a` comes no later than `b` in the replay order exactly when its triple is no larger. -/
private theorem before_iff (a b : Edit) : a.before b = true ↔ lexLe a.depth a.rank a.id b.depth b.rank b.id := by
  simp only [Edit.before, Bool.or_eq_true, Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq, lexLe]

/-- Of two edits, one comes no later than the other. -/
theorem before_total (a b : Edit) : (a.before b || b.before a) = true := by
  rw [Bool.or_eq_true, before_iff, before_iff]
  have : ∀ d₁ r₁ i₁ d₂ r₂ i₂, lexLe d₁ r₁ i₁ d₂ r₂ i₂ ∨ lexLe d₂ r₂ i₂ d₁ r₁ i₁ := by intros; simp only [lexLe]; omega
  exact this ..

/-- The replay order is transitive. -/
theorem before_trans (a b c : Edit) (h₁ : a.before b = true) (h₂ : b.before c = true) : a.before c = true := by
  rw [before_iff] at *
  have : ∀ d₁ r₁ i₁ d₂ r₂ i₂ d₃ r₃ i₃, lexLe d₁ r₁ i₁ d₂ r₂ i₂ → lexLe d₂ r₂ i₂ d₃ r₃ i₃ → lexLe d₁ r₁ i₁ d₃ r₃ i₃ := by
    intros; simp only [lexLe] at *; omega
  exact this _ _ _ _ _ _ _ _ _ h₁ h₂

/-- Two edits that each come no later than the other have the same id. -/
theorem before_antisymm {a b : Edit} (h₁ : a.before b = true) (h₂ : b.before a = true) : a.id = b.id := by
  rw [before_iff] at *
  have : ∀ d₁ r₁ i₁ d₂ r₂ i₂ : Nat, lexLe d₁ r₁ i₁ d₂ r₂ i₂ → lexLe d₂ r₂ i₂ d₁ r₁ i₁ → i₁ = i₂ := by
    intros; simp only [lexLe] at *; omega
  exact this _ _ _ _ _ _ h₁ h₂

/-- Among edits with distinct ids, an id names one edit. -/
theorem eq_of_id_eq {edits : List Edit} (h : (edits.map Edit.id).Nodup) {a b : Edit} (ha : a ∈ edits) (hb : b ∈ edits)
    (hid : a.id = b.id) : a = b := by
  have hp : edits.Pairwise (fun x y => x.id ≠ y.id) := List.pairwise_map.mp h
  exact List.Pairwise.forall_of_forall_of_flip (R := fun x y => x.id = y.id → x = y) (fun _ _ _ => rfl)
    (hp.imp fun hne heq => absurd heq hne) (hp.imp fun hne heq => absurd heq.symm hne) ha hb hid

/-- Sorting two arrangements of the same edits with distinct ids by `Edit.before` gives the same list. -/
theorem mergeSort_before_perm {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂)
    (hids : (edits₁.map Edit.id).Nodup) : edits₁.mergeSort Edit.before = edits₂.mergeSort Edit.before := by
  apply List.Perm.eq_of_pairwise (le := fun a b => Edit.before a b = true)
  · intro a b ha hb hab hba
    exact eq_of_id_eq hids (List.mem_mergeSort.mp ha) (hperm.mem_iff.mpr (List.mem_mergeSort.mp hb))
      (before_antisymm hab hba)
  · exact List.pairwise_mergeSort before_trans before_total _
  · exact List.pairwise_mergeSort before_trans before_total _
  · exact (List.mergeSort_perm _ _).trans (hperm.trans (List.mergeSort_perm _ _).symm)

/-- Whether an edit is malformed depends only on which edits are held, not on their arrangement. -/
theorem wellFormed_perm {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) :
    wellFormed edits₁ = wellFormed edits₂ := by
  funext edit
  simp only [wellFormed]
  congr 1
  funext p
  exact Bool.eq_iff_iff.mpr (by simp only [List.all_eq_true]; exact ⟨fun h q hq => h q (hperm.mem_iff.mpr hq),
    fun h q hq => h q (hperm.mem_iff.mp hq)⟩)

/-- The same edits with distinct ids, in any arrangement, are replayed in one order. -/
theorem order_perm {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) (hids : (edits₁.map Edit.id).Nodup) :
    order edits₁ = order edits₂ := by
  unfold order
  rw [wellFormed_perm hperm]
  exact mergeSort_before_perm (hperm.filter _) (hids.sublist ((List.filter_sublist).map _))

theorem T11_convergence {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) (hids : (edits₁.map Edit.id).Nodup) :
    view edits₁ = view edits₂ := by
  unfold view
  rw [order_perm hperm hids]

theorem T11_same_standing {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) (hids : (edits₁.map Edit.id).Nodup) :
    standing edits₁ = standing edits₂ := by
  unfold standing
  rw [order_perm hperm hids]

/-! ## What a peer sends -/

/-- A device syncs an entry only if it may receive it. -/
theorem syncs_may {st : State} {d : SignerId} {e : EntryId} {fl : List VaultId} (h : syncs st d e fl = true) :
    mayReceive st d e fl = true := by
  unfold syncs at h
  unfold mayReceive
  cases hen : st.entry? e with
  | none => rw [hen] at h; cases h
  | some en => rw [hen] at h; simp only [Bool.and_eq_true] at h; exact h.1

/-- A device syncs a log only if it may receive it. -/
theorem syncsLog_may {st : State} {d : SignerId} {l : LogId} {fl : List VaultId} (h : syncsLog st d l fl = true) :
    mayReceiveLog st d l fl = true := by
  cases l with
  | entry e => exact syncs_may h
  | _ => exact h

/-- An edit a peer sends a device is one it holds, of an entry log the device syncs or an audience or a share log it may
    receive, or of a vault's log. -/
theorem mem_respond_syncs {edits : List Edit} {d : SignerId} {fl : List VaultId} {o : Edit}
    (h : o ∈ respond edits d fl) :
    o ∈ edits ∧ ((∃ l, o.log? = some l ∧ syncsLog (view edits) d l fl = true) ∨ ∃ v, o.log? = some (.vault v)) := by
  simp only [respond, List.mem_append, List.mem_filter] at h
  rcases h with ⟨hm, hl⟩ | ⟨hm, hv⟩
  · refine ⟨hm, .inl ?_⟩
    split at hl
    · next l hl' => exact ⟨l, hl', hl⟩
    · simp at hl
  · refine ⟨hm, .inr ?_⟩
    split at hv
    · next v hv' => exact ⟨v, hv'⟩
    · simp at hv

/-- An edit a peer sends a device is one it holds, of an entry, an audience or a share log the device may receive, or of
    a vault's log. -/
theorem mem_respond {edits : List Edit} {d : SignerId} {fl : List VaultId} {o : Edit} (h : o ∈ respond edits d fl) :
    o ∈ edits ∧
      ((∃ l, o.log? = some l ∧ mayReceiveLog (view edits) d l fl = true) ∨ ∃ v, o.log? = some (.vault v)) := by
  obtain ⟨hm, ⟨l, hl, hs⟩ | hv⟩ := mem_respond_syncs h
  · exact ⟨hm, .inl ⟨l, hl, syncsLog_may hs⟩⟩
  · exact ⟨hm, .inr hv⟩

/-- An edit a peer sends is one it holds. -/
theorem respond_sub {edits : List Edit} {d : SignerId} {fl : List VaultId} {o : Edit} (h : o ∈ respond edits d fl) :
    o ∈ edits :=
  (mem_respond h).1

/-- What a peer sends by frontiers is part of what it would send in full. -/
theorem respondSince_sub {edits : List Edit} {d : SignerId} {fr : Ask} {o : Edit}
    (h : o ∈ respondSince edits d fr) : o ∈ respond edits d fr.follow :=
  (List.mem_filter.mp h).1

/-- A peer sends every edit it holds of an entry the device syncs. -/
theorem entry_in_respond {edits : List Edit} {d : SignerId} {fl : List VaultId} {o : Edit} {e : EntryId}
    (hm : o ∈ edits) (hl : o.log? = some (.entry e)) (hr : syncs (view edits) d e fl = true) :
    o ∈ respond edits d fl := by
  simp only [respond, List.mem_append, List.mem_filter]
  -- an entry's log is one `syncsLog` allows exactly when `syncs` allows the entry
  exact .inl ⟨hm, by rw [hl]; exact hr⟩

theorem T12_sync_sends_only_what_shares_reach (edits : List Edit) (d : SignerId) (fl : List VaultId) {o : Edit}
    (h : o ∈ respond edits d fl) :
    o ∈ edits ∧ ∃ l, o.log? = some l ∧ (mayReceiveLog (view edits) d l fl = true ∨ ∃ v, l = .vault v) := by
  obtain ⟨hm, ⟨l, hl, hr⟩ | ⟨v, hv⟩⟩ := mem_respond h
  · exact ⟨hm, l, hl, .inl hr⟩
  · exact ⟨hm, .vault v, hv, .inr ⟨v, rfl⟩⟩

theorem T28_sync_follows_keeps (edits : List Edit) (d : SignerId) (fl : List VaultId) {o : Edit}
    (h : o ∈ respond edits d fl) {e : EntryId} (hl : o.log? = some (.entry e)) :
    ∃ en, (view edits).entry? e = some en ∧ mayReceiveAudience (view edits) d en.vault en.audience fl = true ∧
      wants (view edits) d en = true := by
  obtain ⟨-, ⟨l, hl', hs⟩ | ⟨v, hv⟩⟩ := mem_respond_syncs h
  · rw [hl] at hl'
    cases hl'
    simp only [syncsLog, syncs] at hs
    cases hen : (view edits).entry? e with
    | none => rw [hen] at hs; cases hs
    | some en =>
      rw [hen] at hs
      simp only [Bool.and_eq_true] at hs
      exact ⟨en, rfl, hs.1, hs.2⟩
  · rw [hl] at hv
    cases hv

/-- The keep shares a device syncs a vault by are its own over the vault, else its copy setting. -/
theorem keepsFor_eq (st : State) (d : SignerId) (v : VaultId) :
    keepsFor st d v = if keepsOf st d v = [] then copyOf st d else keepsOf st d v := by
  unfold keepsFor
  split <;> simp_all

/-- Each keep share a device syncs a vault by is a live keep share naming it, issued by a vault it is still a device
    of: over the vault, or, its copy setting, wide over the vault that issued it. -/
theorem mem_keepsFor {st : State} {d : SignerId} {v : VaultId} {k : Share} (hk : k ∈ keepsFor st d v) :
    k.level.isKeep = true ∧ k.who = .device d ∧ (k.over = v ∨ k.wide = true ∧ k.over = k.issuer) ∧
      st.live k.id = true ∧ isDevice st d k.issuer = true := by
  rw [keepsFor_eq] at hk
  split at hk
  · have h := (List.mem_filter.1 hk).2
    simp only [Bool.and_eq_true, beq_iff_eq] at h
    exact ⟨h.1.1.1.1.1, h.1.1.1.1.2, .inr ⟨h.1.1.1.2, h.1.1.2⟩, h.1.2, h.2⟩
  · have h := (List.mem_filter.1 hk).2
    simp only [Bool.and_eq_true, beq_iff_eq] at h
    exact ⟨h.1.1.1.1, h.1.1.1.2, .inl h.1.1.2, h.1.2, h.2⟩

theorem T28_keep_modes (st : State) (d : SignerId) (en : Entry) :
    (keepsFor st d en.vault = if keepsOf st d en.vault = [] then copyOf st d else keepsOf st d en.vault) ∧
    (keepsFor st d en.vault = [] → wants st d en = true) ∧
    (∀ k ∈ keepsFor st d en.vault, k.level.isKeep = true ∧ k.who = .device d ∧
      (k.over = en.vault ∨ k.wide = true ∧ k.over = k.issuer) ∧ st.live k.id = true ∧ isDevice st d k.issuer = true) ∧
    (∀ k ∈ keepsFor st d en.vault, k.never = true → marked st en k = true → wants st d en = false) ∧
    (∀ k ∈ keepsFor st d en.vault, k.never = false → marked st en k = true →
      (∀ k' ∈ keepsFor st d en.vault, k'.never = true → marked st en k' = false) → wants st d en = true) ∧
    (keeps st d en = true ↔ ∃ k ∈ keepsFor st d en.vault, k.level = .keep .whole ∧ marked st en k = true) := by
  refine ⟨keepsFor_eq st d en.vault, fun h => by simp [wants, wantsWith, h], fun k hk => mem_keepsFor hk,
    fun k hk hn hm => ?_, fun k hk hn hm hno => ?_, by simp [keeps, keepsWith]⟩
  · -- a never share that picks the entry keeps it out
    have h : ((keepsFor st d en.vault).any fun k => k.never && marked st en k) = true :=
      List.any_eq_true.2 ⟨k, hk, by simp [hn, hm]⟩
    simp [wants, wantsWith, h]
  · -- a whole or opened share picks it, and no never share does
    have h1 : ((keepsFor st d en.vault).any fun k => !k.never && marked st en k) = true :=
      List.any_eq_true.2 ⟨k, hk, by simp [hn, hm]⟩
    have h2 : ((keepsFor st d en.vault).any fun k => k.never && marked st en k) = false := by
      rw [Bool.eq_false_iff, ne_eq, List.any_eq_true]
      rintro ⟨k', hk', h'⟩
      simp only [Bool.and_eq_true] at h'
      rw [hno k' hk' h'.1] at h'
      cases h'.2
    simp [wants, wantsWith, h1, h2]

theorem T12_since (edits : List Edit) (d : SignerId) (fr : Ask) {o : Edit} (h : o ∈ respondSince edits d fr) :
    o ∈ edits ∧ ∃ l, o.log? = some l ∧ (mayReceiveLog (view edits) d l fr.follow = true ∨ ∃ v, l = .vault v) :=
  T12_sync_sends_only_what_shares_reach edits d fr.follow (respondSince_sub h)

theorem T12_interest (st : State) (d : SignerId) (v : VaultId) (x : Audience) (fl : List VaultId)
    (h : mayReceiveAudience st d v x fl = true) :
    (interested st d v = true ∨ v ∈ fl) ∧
    (mayReceiveAudience st d v x = true ∨ v ∈ fl ∧ ∃ cp ∈ st.shares, cp.over = v ∧ st.live cp.id = true ∧
      (cp.wide = true ∨ cp.id ∈ x) ∧ cp.who = .everyone) := by
  unfold mayReceiveAudience at h
  simp only [Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at h
  rcases h with ha | ⟨cp, hcp, ⟨⟨⟨hov, hlive⟩, hin⟩, hlev⟩, hwho⟩
  · exact ⟨.inl (by simp [interested, ha]), .inl (by simp [mayReceiveAudience, ha])⟩
  -- through a live share over the vault: a vault's, which it acts for, or everyone's
  cases hw : cp.who with
  | vault g =>
    simp only [hw] at hwho
    refine ⟨.inl ?_, .inl ?_⟩
    · simp only [interested, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true, beq_iff_eq]
      exact .inr ⟨cp, hcp, ⟨hov, hlive⟩, by simp [hw, hwho]⟩
    · simp only [mayReceiveAudience, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true, beq_iff_eq]
      exact .inr ⟨cp, hcp, ⟨⟨⟨hov, hlive⟩, hin⟩, hlev⟩, by simp [hw, hwho]⟩
  | everyone =>
    simp only [hw, Bool.or_eq_true, List.contains_eq_mem, decide_eq_true_eq] at hwho
    rcases hwho with hf | hi
    · exact ⟨.inr hf, .inr ⟨hf, cp, hcp, hov, hlive, by simpa using hin, hw⟩⟩
    · refine ⟨.inl hi, .inl ?_⟩
      simp only [mayReceiveAudience, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true, beq_iff_eq]
      exact .inr ⟨cp, hcp, ⟨⟨⟨hov, hlive⟩, hin⟩, hlev⟩, by simp [hw, hi]⟩
  | device _ => simp [hw] at hwho
  | invite _ => simp [hw] at hwho

/-- A device that acts for no vault has an interest in none. -/
theorem interested_stranger {st : State} {d : SignerId} (h : ∀ v, actsFor st d v = false) (v : VaultId) :
    interested st d v = false := by
  rw [Bool.eq_false_iff, ne_eq, interested, h, Bool.false_or, List.any_eq_true]
  rintro ⟨cp, -, hc⟩
  cases hw : cp.who <;> simp [hw, h] at hc

/-- A device that acts for no vault and follows none may receive no audience. -/
theorem mayReceiveAudience_stranger {st : State} {d : SignerId} (h : ∀ v, actsFor st d v = false) (v : VaultId)
    (x : Audience) : mayReceiveAudience st d v x = false := by
  cases hm : mayReceiveAudience st d v x
  · rfl
  · rcases (T12_interest st d v x [] hm).1 with hi | hi
    · rw [interested_stranger h] at hi
      cases hi
    · cases hi

/-- `closeVaults` of no vault is no vault. -/
theorem closeVaults_nil (st : State) : ∀ n, closeVaults st n [] = []
  | 0 => rfl
  | n + 1 => by simp [closeVaults, closeVaults_nil st n]

theorem T12_stranger_gets_nothing (edits : List Edit) (d : SignerId) (h : ∀ v, actsFor (view edits) d v = false) :
    respond edits d = [] := by
  -- it may receive no entry, no audience and no share
  have hrec : ∀ e, mayReceive (view edits) d e = false := by
    intro e
    unfold mayReceive
    split
    · exact mayReceiveAudience_stranger h _ _
    · rfl
  have hsee : ∀ cp, seesShare (view edits) d cp = false := by
    intro cp
    cases hw : cp.who <;> simp [seesShare, hw, h, hrec]
  have hlog : ∀ l, syncsLog (view edits) d l = false := by
    intro l
    cases l with
    | entry e =>
      simp only [syncsLog, syncs]
      split
      · simp [mayReceiveAudience_stranger h]
      · rfl
    | audience v x => exact mayReceiveAudience_stranger h v x
    | share c => simp [syncsLog, mayReceiveLog, reachesShare, hsee]
    | vault v => rfl
  -- so it is sent no edit of an entry, an audience or a share, and gathers no vault
  rw [List.eq_nil_iff_forall_not_mem]
  intro o ho
  simp only [respond, List.mem_append, List.mem_filter] at ho
  rcases ho with ⟨-, hl⟩ | ⟨-, hv⟩
  · split at hl
    · rw [hlog] at hl
      cases hl
    · cases hl
  · split at hv
    · rename_i v _
      have key : ∀ vs : List VaultId, (∀ y, y ∉ vs) →
          (closeVaults (view edits) (view edits).depth vs).contains v = false := by
        intro vs hvs
        rw [List.eq_nil_iff_forall_not_mem.2 hvs, closeVaults_nil]
        rfl
      rw [key _ fun y hy => ?_] at hv
      · cases hv
      simp only [List.mem_append, List.mem_filterMap, List.mem_flatMap, List.mem_filter] at hy
      rcases hy with ⟨x, -, hx⟩ | ⟨o', ⟨-, hm⟩, -⟩
      · simp [h] at hx
      · split at hm
        · rw [hlog] at hm
          cases hm
        · cases hm
    · cases hv

/-! ## Frontiers -/

section
variable (lg : Edit → Option LogId)

/-- Id `i` is in `F`, or a parent of an edit of `os` whose id is reached: what `ancestorsN` collects. -/
inductive Reaches (os : List Edit) (F : List EditId) : EditId → Prop where
  | base {i : EditId} : i ∈ F → Reaches os F i
  | step {y : Edit} {p : EditId} : y ∈ os → Reaches os F y.id → p ∈ y.parents → Reaches os F p

/-- What one more round back from `F` reaches, `F` reaches. -/
theorem reaches_step {os : List Edit} {F : List EditId} {i : EditId} (h : Reaches os (ancestorsStep os F) i) :
    Reaches os F i := by
  induction h with
  | base hi =>
    simp only [ancestorsStep, List.mem_append, List.mem_filter, List.mem_flatMap] at hi
    rcases hi with hi | ⟨⟨y, ⟨hy, hyF⟩, hp⟩, _⟩
    · exact .base hi
    · exact .step hy (.base (List.contains_iff_mem.mp hyF)) hp
  | step hy _ hp ih => exact .step hy ih hp

/-- Every id `ancestorsN` collects from `F` is reached from `F`. -/
theorem reaches_of_ancestorsN {os : List Edit} : ∀ (n : Nat) {F : List EditId} {i : EditId},
    i ∈ ancestorsN os n F → Reaches os F i
  | 0, _, _, h => .base h
  | n + 1, _, _, h => reaches_step (reaches_of_ancestorsN n h)

/-- Each id `closedIds` admits is that of an edit of `os` whose parents were all admitted. -/
def ClosedIds (os : List Edit) (ids : List EditId) : Prop :=
  ∀ i ∈ ids, ∃ o ∈ os, o.id = i ∧ ∀ p ∈ o.parents, p ∈ ids

/-- `closedIds` admits only edits whose parents it admitted. -/
theorem closedIds_inv {os : List Edit} : ∀ (n : Nat) {ids : List EditId}, ClosedIds os ids →
    ClosedIds os (closedIds os n ids)
  | 0, _, h => h
  | n + 1, ids, h => closedIds_inv n (by
    intro i hi
    simp only [closeStep, List.mem_append, List.mem_map, List.mem_filter, Bool.and_eq_true, List.all_eq_true,
      List.contains_iff_mem] at hi
    rcases hi with hi | ⟨o, ⟨ho, _, hps⟩, rfl⟩
    · obtain ⟨o, ho, hid, hps⟩ := h i hi
      exact ⟨o, ho, hid, fun p hp => List.mem_append_left _ (hps p hp)⟩
    · exact ⟨o, ho, rfl, fun p hp => List.mem_append_left _ (hps p hp)⟩)

/-- An edit of a log's closed part is one of the edits, in that log. -/
theorem closedPart_sub {edits : List Edit} {l : LogId} {a : Edit} (h : a ∈ closedPart lg edits l) :
    a ∈ edits ∧ lg a = some l := by
  simp only [closedPart, inLog, List.mem_filter, beq_iff_eq] at h
  exact ⟨h.1.1, h.1.2⟩

/-- The closed part holds the whole past of each of its edits. -/
theorem closedPart_closed {edits : List Edit} {l : LogId} {a : Edit} (h : a ∈ closedPart lg edits l) :
    ∀ p ∈ a.parents, ∃ b ∈ closedPart lg edits l, b.id = p := by
  intro p hp
  have inv := closedIds_inv (os := inLog lg edits l) (inLog lg edits l).length (ids := []) (by simp [ClosedIds])
  simp only [closedPart, List.mem_filter, Bool.and_eq_true, List.all_eq_true, List.contains_iff_mem] at h ⊢
  obtain ⟨o, ho, hid, hps⟩ := inv p (h.2.2 p hp)
  exact ⟨o, ⟨ho, by rw [hid]; exact h.2.2 p hp, hps⟩, hid⟩

/-- `closedIds` admits an id only after the parents of the edit it names: the order edits were admitted in. -/
def AdmitOrder (os : List Edit) (ids : List EditId) : Prop :=
  ∀ o ∈ os, o.id ∈ ids → ∀ p ∈ o.parents, p ∈ ids ∧ ids.idxOf p < ids.idxOf o.id

/-- One round of `closeStep` keeps every edit admitted after its parents. -/
theorem closeStep_order {os : List Edit} (hu : ∀ a ∈ os, ∀ b ∈ os, a.id = b.id → a = b) {ids : List EditId}
    (h : AdmitOrder os ids) : AdmitOrder os (closeStep os ids) := by
  intro o ho hin p hp
  by_cases hold : o.id ∈ ids
  · obtain ⟨hpi, hlt⟩ := h o ho hold p hp
    refine ⟨List.mem_append_left _ hpi, ?_⟩
    rw [closeStep, List.idxOf_append, List.idxOf_append, ite_eq_left hpi, ite_eq_left hold]
    exact hlt
  · -- admitted in this round: the edit with its id, which is `o`, had its parents in
    simp only [closeStep, List.mem_append, List.mem_map, List.mem_filter, Bool.and_eq_true, List.all_eq_true,
      List.contains_iff_mem] at hin
    rcases hin with hin | ⟨o', ⟨ho', _, hps⟩, hid⟩
    · exact absurd hin hold
    · obtain rfl := hu o' ho' o ho hid
      have hpi := hps p hp
      refine ⟨List.mem_append_left _ hpi, ?_⟩
      rw [closeStep, List.idxOf_append, List.idxOf_append, ite_eq_left hpi, ite_eq_right hold]
      exact Nat.lt_of_lt_of_le (List.idxOf_lt_length_of_mem hpi) (Nat.le_add_left _ _)

/-- Every round of `closedIds` keeps every edit admitted after its parents. -/
theorem closedIds_order {os : List Edit} (hu : ∀ a ∈ os, ∀ b ∈ os, a.id = b.id → a = b) :
    ∀ (n : Nat) {ids : List EditId}, AdmitOrder os ids → AdmitOrder os (closedIds os n ids)
  | 0, _, h => h
  | n + 1, _, h => closedIds_order hu n (closeStep_order hu h)

/-- Every edit of a log's closed part is at or below its frontier, when no two edits of the log share an id. -/
theorem closed_reaches_frontier {edits : List Edit} {l : LogId}
    (hu : ∀ a ∈ edits, ∀ b ∈ edits, a.id = b.id → a = b) {x : Edit} (hx : x ∈ closedPart lg edits l) :
    Reaches (inLog lg edits l) (frontier lg edits l) x.id := by
  let os := inLog lg edits l
  let ids := closedIds os os.length []
  have hu' : ∀ a ∈ os, ∀ b ∈ os, a.id = b.id → a = b :=
    fun a ha b hb => hu a (List.mem_filter.mp ha).1 b (List.mem_filter.mp hb).1
  have hord : AdmitOrder os ids := closedIds_order hu' _ (by simp [AdmitOrder])
  have hin : ∀ y ∈ closedPart lg edits l, y ∈ os ∧ y.id ∈ ids := by
    intro y hy
    simp only [closedPart, List.mem_filter, Bool.and_eq_true, List.contains_iff_mem] at hy
    exact ⟨hy.1, hy.2.1⟩
  -- from each edit, up to an edit that builds on it, until one that nothing builds on: one of the frontier
  suffices H : ∀ n, ∀ x ∈ closedPart lg edits l, ids.length - ids.idxOf x.id ≤ n →
      Reaches os (frontier lg edits l) x.id from H _ x hx (Nat.le_refl _)
  intro n
  induction n with
  | zero =>
    intro x hx hn
    have := List.idxOf_lt_length_of_mem (hin x hx).2
    omega
  | succ n ih =>
    intro x hx hn
    by_cases hc : (closedPart lg edits l).any (·.parents.contains x.id) = true
    · obtain ⟨y, hy, hyp⟩ := List.any_eq_true.mp hc
      have hyp := List.contains_iff_mem.mp hyp
      have hlt := (hord y (hin y hy).1 (hin y hy).2 x.id hyp).2
      have hyl := List.idxOf_lt_length_of_mem (hin y hy).2
      exact .step (hin y hy).1 (ih y hy (by omega)) hyp
    · refine .base ?_
      simp only [frontier, List.mem_mergeSort, List.mem_map, List.mem_filter]
      exact ⟨x, ⟨hx, by simpa using hc⟩, rfl⟩

/-- Every id of a log's frontier is that of an edit of its closed part. -/
theorem frontier_mem {edits : List Edit} {l : LogId} {i : EditId} (h : i ∈ frontier lg edits l) :
    ∃ a ∈ closedPart lg edits l, a.id = i := by
  simp only [frontier, List.mem_mergeSort, List.mem_map, List.mem_filter] at h
  obtain ⟨a, ⟨ha, _⟩, rfl⟩ := h
  exact ⟨a, ha, rfl⟩

/-- Every id of a level back from `lv` among `os` is one of `lv` or that of an edit of `os`. -/
theorem levels_mem {os : List Edit} : ∀ (n : Nat) {seen lv x : List EditId}, x ∈ levels os n seen lv →
    ∀ i ∈ x, i ∈ lv ∨ ∃ o ∈ os, o.id = i
  | 0, _, _, _, h => by simp [levels] at h
  | n + 1, seen, lv, x, h => by
    intro i hi
    simp only [levels] at h
    split at h
    · simp at h
    · rcases List.mem_cons.mp h with rfl | h
      · exact .inl hi
      · rcases levels_mem n h i hi with hs | ho
        · simp only [stepBack, List.mem_map, List.mem_filter] at hs
          obtain ⟨o, ⟨ho, _⟩, rfl⟩ := hs
          exact .inr ⟨o, ho, rfl⟩
        · exact .inr ho

/-- Every id `pick` picks is in one of the levels it picks from. -/
theorem pick_mem : ∀ (k : Nat) {ls : List (List EditId)} {i : EditId}, i ∈ pick k ls → ∃ lv ∈ ls, i ∈ lv
  | _, [], _, h => by simp [pick] at h
  | _, [lv], _, h => ⟨lv, List.mem_singleton_self _, h⟩
  | k, lv :: lv' :: rest, i, h => by
    simp only [pick, List.mem_append] at h
    rcases h with h | h
    · split at h
      · exact ⟨lv, List.mem_cons_self .., h⟩
      · simp at h
    · obtain ⟨x, hx, hix⟩ := pick_mem (k + 1) h
      exact ⟨x, List.mem_cons_of_mem _ hx, hix⟩

/-- Every edit a device sends of a log when it asks is one of its closed part. -/
theorem haves_mem {edits : List Edit} {l : LogId} {i : EditId} (h : i ∈ haves lg edits l) :
    ∃ a ∈ closedPart lg edits l, a.id = i := by
  simp only [haves, List.mem_mergeSort, List.mem_eraseDups] at h
  obtain ⟨lv, hlv, hi⟩ := pick_mem 0 h
  rcases levels_mem _ hlv i hi with hf | ho
  · exact frontier_mem lg hf
  · exact ho

end

/-- Whatever a responder holding `R` reaches from the edits `F` an asker sent of a log, all of the asker's closed part,
    walking its own copy of the log, is an edit of the asker's closed part: an id both hold names one edit, and the
    closed part holds the past of each of its edits. -/
theorem reaches_held (lgA lgR : Edit → Option LogId) {A R : List Edit} {l : LogId}
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) {F : List EditId}
    (hF : ∀ i ∈ F, ∃ a ∈ closedPart lgA A l, a.id = i) {i : EditId}
    (h : Reaches (inLog lgR R l) F i) : ∃ a ∈ closedPart lgA A l, a.id = i := by
  induction h with
  | base hi => exact hF _ hi
  | step hy _ hp ih =>
    obtain ⟨a, ha, haid⟩ := ih
    have := hid a (closedPart_sub lgA ha).1 _ (List.mem_filter.mp hy).1 haid
    subst this
    exact closedPart_closed lgA ha _ hp

/-- Frontier sync loses nothing, log by log: every edit of the responder's copy of log `l` is one the asker holds, or
    lies beyond the edits `F` the asker sent, all of its closed part. The asker and the responder may place edits in
    logs differently (`lgA`, `lgR`). -/
theorem frontier_sync (lgA lgR : Edit → Option LogId) {A R : List Edit} {l : LogId}
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) {F : List EditId}
    (hF : ∀ i ∈ F, ∃ a ∈ closedPart lgA A l, a.id = i) {x : Edit} (hx : x ∈ inLog lgR R l) :
    x ∈ A ∨ x ∈ missing lgR R l F := by
  by_cases hc : (ancestors lgR R l F).contains x.id = true
  · left
    have hr : Reaches (inLog lgR R l) F x.id := reaches_of_ancestorsN _ (List.contains_iff_mem.mp hc)
    obtain ⟨a, ha, haid⟩ := reaches_held lgA lgR hid hF hr
    have := hid a (closedPart_sub lgA ha).1 x (List.mem_filter.mp hx).1 haid
    exact this ▸ (closedPart_sub lgA ha).1
  · right
    simp only [missing, List.mem_filter]
    exact ⟨hx, by simpa using hc⟩

/-- Every loose edit a device names is one it holds. -/
theorem loose_mem {edits : List Edit} {i : EditId} (h : i ∈ loose edits) : ∃ a ∈ edits, a.id = i := by
  simp only [loose, List.mem_mergeSort, List.mem_eraseDups, List.mem_map, List.mem_filter] at h
  obtain ⟨a, ⟨ha, _⟩, rfl⟩ := h
  exact ⟨a, ha, rfl⟩

/-- What a device sends when it asks is so of the edits `A` it holds: each edit it names of a log is one of the log's
    closed part, and each loose edit one it holds. -/
def Truthful (A : List Edit) (a : Ask) : Prop :=
  (∀ l, ∀ i ∈ a.haves l, ∃ x ∈ closedPart Edit.log? A l, x.id = i) ∧ ∀ i ∈ a.loose, ∃ x ∈ A, x.id = i

/-- A device that asks with `asks` says only what is so. -/
theorem asks_truthful (A : List Edit) (fl : List VaultId) : Truthful A (asks A fl) :=
  ⟨fun _ _ hi => haves_mem _ hi, fun _ hi => loose_mem hi⟩

/-- A device that asks with its frontiers alone says only what is so. -/
theorem frontiers_truthful (A : List Edit) (fl : List VaultId) : Truthful A ⟨frontiers A, [], fl⟩ :=
  ⟨fun _ _ hi => frontier_mem _ hi, fun _ hi => nomatch hi⟩

/-- What a device holding `A` is sent when it asks truthfully covers whatever of the full answer it lacks. -/
theorem respondSince_complete {A R : List Edit} {d : SignerId} (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b)
    {a : Ask} (ha : Truthful A a) {o : Edit} (h : o ∈ respond R d a.follow) : o ∈ A ∨ o ∈ respondSince R d a := by
  by_cases hw : a.loose.contains o.id = true
  · -- a loose edit the device names is one it holds, and an id both hold names one edit
    left
    obtain ⟨x, hx, hxid⟩ := ha.2 _ (List.contains_iff_mem.mp hw)
    exact (hid x hx o (respond_sub h) hxid) ▸ hx
  · have hn : o.id ∉ a.loose := fun hm => hw (List.contains_iff_mem.mpr hm)
    cases hl : o.log? with
    | none =>
      right
      simp only [respondSince, List.mem_filter, hl]
      exact ⟨h, by simpa using hn⟩
    | some l =>
      -- at or below what the device named of the log, so it holds it; or beyond, so the peer sends it
      have hx : o ∈ inLog Edit.log? R l := List.mem_filter.mpr ⟨respond_sub h, by simp [hl]⟩
      rcases frontier_sync Edit.log? Edit.log? hid (ha.1 l) hx with hA | hm
      · exact .inl hA
      · right
        simp only [respondSince, List.mem_filter, hl]
        exact ⟨h, by simpa [missing, hn] using (List.mem_filter.mp hm).2⟩

/-- One hash per log is enough: a device whose frontier of a log is the peer's holds the peer's whole closed part of
    it, in its own closed part. -/
theorem same_frontier_held (lgA lgR : Edit → Option LogId) {A R : List Edit} {l : LogId}
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) (hu : ∀ a ∈ R, ∀ b ∈ R, a.id = b.id → a = b)
    (hf : frontier lgA A l = frontier lgR R l) {x : Edit} (hx : x ∈ closedPart lgR R l) :
    x ∈ closedPart lgA A l := by
  have hr := closed_reaches_frontier lgR hu hx
  rw [← hf] at hr
  obtain ⟨a, ha, haid⟩ := reaches_held lgA lgR hid (fun _ hi => frontier_mem lgA hi) hr
  obtain rfl := hid a (closedPart_sub lgA ha).1 x (closedPart_sub lgR hx).1 haid
  exact ha

theorem T19_frontier_sync (A R : List Edit) (d : SignerId) (fl : List VaultId)
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) :
    ∀ o ∈ respond R d fl, o ∈ A ∨ o ∈ respondSince R d (asks A fl) :=
  fun _ h => respondSince_complete hid (asks_truthful A fl) h

theorem T19_frontiers_alone (A R : List Edit) (d : SignerId) (fl : List VaultId)
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) :
    ∀ o ∈ respond R d fl, o ∈ A ∨ o ∈ respondSince R d ⟨frontiers A, [], fl⟩ :=
  fun _ h => respondSince_complete hid (frontiers_truthful A fl) h

theorem T19_same_frontier (lgA lgR : Edit → Option LogId) (A R : List Edit) (l : LogId)
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) (huA : ∀ a ∈ A, ∀ b ∈ A, a.id = b.id → a = b)
    (huR : ∀ a ∈ R, ∀ b ∈ R, a.id = b.id → a = b) (hf : frontier lgA A l = frontier lgR R l) (x : Edit) :
    x ∈ closedPart lgA A l ↔ x ∈ closedPart lgR R l :=
  ⟨same_frontier_held lgR lgA (fun a ha b hb h => (hid b hb a ha h.symm).symm) huA hf.symm,
   same_frontier_held lgA lgR hid huR hf⟩

/-! ## Convergence per entry -/

/-- A peer that received `incoming` holds what it held and what it received. -/
theorem mem_receive {edits incoming : List Edit} {o : Edit} :
    o ∈ receive edits incoming ↔ o ∈ edits ∨ o ∈ incoming := by
  simp only [receive, List.mem_append, List.mem_filter]
  constructor
  · rintro (h | ⟨h, _⟩)
    · exact .inl h
    · exact .inr h
  · rintro (h | h)
    · exact .inl h
    · by_cases h' : o ∈ edits
      · exact .inl h'
      · exact .inr ⟨h, by simpa using h'⟩

/-- After a device holding `A` and following the vaults `fl` asked a peer holding `R` (`asks`), it holds an edit of an
    entry it syncs by the peer's view exactly when one of them held it. -/
theorem entry_after_sync {A R : List Edit} {d : SignerId} {fl : List VaultId} {e : EntryId}
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) (hr : syncs (view R) d e fl = true) {o : Edit}
    (hop : o.log? = some (.entry e)) : o ∈ receive A (respondSince R d (asks A fl)) ↔ o ∈ A ∨ o ∈ R := by
  rw [mem_receive]
  constructor
  · rintro (h | h)
    · exact .inl h
    · exact .inr (respond_sub (respondSince_sub h))
  · rintro (h | h)
    · exact .inl h
    · exact respondSince_complete hid (asks_truthful A fl) (entry_in_respond h hop hr)

theorem T13_sync_converges (editsP editsQ : List Edit) (dp dq : SignerId) (flp flq : List VaultId) (e : EntryId)
    (hid : ∀ a ∈ editsP, ∀ b ∈ editsQ, a.id = b.id → a = b)
    (hp : syncs (view editsQ) dp e flp = true) (hq : syncs (view editsP) dq e flq = true)
    (o : Edit) (hop : o.log? = some (.entry e)) :
    o ∈ receive editsP (respondSince editsQ dp (asks editsP flp)) ↔
      o ∈ receive editsQ (respondSince editsP dq (asks editsQ flq)) := by
  rw [entry_after_sync hid hp hop, entry_after_sync (fun a ha b hb h => (hid b hb a ha h.symm).symm) hq hop]
  exact Or.comm

/-! ## Linking -/

theorem T20_link_shares_only_vault_logs (edits : List Edit) (p : SignerId) {o : Edit} (h : o ∈ linkCard edits p) :
    o ∈ edits ∧ ∃ v, o.log? = some (.vault v) ∧
      v ∈ closeVaults (view edits) (view edits).depth (ownedBy (view edits) p) := by
  simp only [linkCard, List.mem_filter] at h
  obtain ⟨hm, hv⟩ := h
  -- only the edits of a gathered vault's log pass the filter
  split at hv
  · rename_i v hv'
    exact ⟨hm, v, hv', List.contains_iff_mem.1 hv⟩
  · cases hv

theorem T20_stranger_gets_nothing (edits : List Edit) (p : SignerId) (h : ownedBy (view edits) p = []) :
    linkCard edits p = [] := by
  simp only [linkCard, h, closeVaults_nil]
  rw [List.filter_eq_nil_iff]
  intro o _
  split <;> simp

/-! ## Holdings -/

/-- What holdings say of a log, they hold. -/
theorem mem_of_log? {h : Holdings} {l : LogId} {F : Frontier} (hs : h.log? l = some F) : (l, F) ∈ h.logs := by
  simp only [Holdings.log?, Option.map_eq_some_iff] at hs
  obtain ⟨x, hx, rfl⟩ := hs
  have hl : x.1 = l := by simpa using List.find?_some hx
  rw [← hl]
  exact List.mem_of_find?_eq_some hx

/-- What holdings say of a file, they hold. -/
theorem mem_of_file? {h : Holdings} {f : FileId} {x : FileHold} (hs : h.file? f = some x) : (f, x) ∈ h.files := by
  simp only [Holdings.file?, Option.map_eq_some_iff] at hs
  obtain ⟨y, hy, rfl⟩ := hs
  have hf : y.1 = f := by simpa using List.find?_some hy
  rw [← hf]
  exact List.mem_of_find?_eq_some hy

/-- What holdings say of a log once a device told `a` is what `a` says of it, or what they said before. -/
theorem take_logs {h : Holdings} {a : Announce} {l : LogId} {F : Frontier} (hm : (l, F) ∈ (h.take a).logs) :
    (l, F) ∈ a.logs ∨ (l, F) ∈ h.logs := by
  simp only [Holdings.take, List.mem_append, List.mem_filter] at hm
  rcases hm with hm | ⟨hm, -⟩
  · exact .inl hm
  · split at hm
    · simp at hm
    · exact .inr hm

/-- What holdings say of a file once a device told `a` is what `a` says of it, or what they said before. -/
theorem take_files {h : Holdings} {a : Announce} {f : FileId} {x : FileHold} (hm : (f, x) ∈ (h.take a).files) :
    (f, some x) ∈ a.files ∨ (f, x) ∈ h.files := by
  simp only [Holdings.take, List.mem_append, List.mem_filter, List.mem_filterMap] at hm
  rcases hm with ⟨⟨f', y⟩, hm, he⟩ | ⟨hm, -⟩
  · cases y with
    | none => cases he
    | some y =>
      simp only [Option.map_some, Option.some.injEq, Prod.mk.injEq] at he
      obtain ⟨rfl, rfl⟩ := he
      exact .inl hm
  · split at hm
    · simp at hm
    · exact .inr hm

/-- What a node keeps of a log once a device told it `a` is what `a` says of it, or what it kept before. -/
theorem hear_logs {h : Holdings} {a : Announce} {l : LogId} {F : Frontier} (hm : (l, F) ∈ (hear h a).logs) :
    (l, F) ∈ a.logs ∨ (l, F) ∈ h.logs := by
  simp only [hear] at hm
  split at hm
  · simp at hm
  · exact take_logs hm

/-- What a node keeps of a file once a device told it `a` is what `a` says of it, or what it kept before. -/
theorem hear_files {h : Holdings} {a : Announce} {f : FileId} {x : FileHold} (hm : (f, x) ∈ (hear h a).files) :
    (f, some x) ∈ a.files ∨ (f, x) ∈ h.files := by
  simp only [hear] at hm
  split at hm
  · simp at hm
  · exact take_files hm

/-- What announcements add up to, from `h` on, says of a log what one of them said, or `h` did. -/
theorem foldl_hear_logs {l : LogId} {F : Frontier} : ∀ (xs : List (Conn × Announce)) (h : Holdings),
    (l, F) ∈ (xs.foldl (fun h x => hear h x.2) h).logs → (l, F) ∈ h.logs ∨ ∃ x ∈ xs, (l, F) ∈ x.2.logs
  | [], _, hm => .inl hm
  | x :: xs, h, hm => by
    rcases foldl_hear_logs xs (hear h x.2) hm with hm | ⟨z, hz, hm⟩
    · rcases hear_logs hm with hm | hm
      · exact .inr ⟨x, List.mem_cons_self .., hm⟩
      · exact .inl hm
    · exact .inr ⟨z, List.mem_cons_of_mem _ hz, hm⟩

/-- What announcements add up to, from `h` on, says of a file what one of them said, or `h` did. -/
theorem foldl_hear_files {f : FileId} {y : FileHold} : ∀ (xs : List (Conn × Announce)) (h : Holdings),
    (f, y) ∈ (xs.foldl (fun h x => hear h x.2) h).files → (f, y) ∈ h.files ∨ ∃ x ∈ xs, (f, some y) ∈ x.2.files
  | [], _, hm => .inl hm
  | x :: xs, h, hm => by
    rcases foldl_hear_files xs (hear h x.2) hm with hm | ⟨z, hz, hm⟩
    · rcases hear_files hm with hm | hm
      · exact .inr ⟨x, List.mem_cons_self .., hm⟩
      · exact .inl hm
    · exact .inr ⟨z, List.mem_cons_of_mem _ hz, hm⟩

/-- A node keeps of device `d` only what an announcement on a connection whose hello proved `d` said. -/
theorem record_sound (n : Node) (d : SignerId) :
    (∀ l F, (l, F) ∈ (n.record d).logs → ∃ c a, (c, a) ∈ n.heard ∧ c.device = d ∧ (l, F) ∈ a.logs) ∧
    (∀ f x, (f, x) ∈ (n.record d).files → ∃ c a, (c, a) ∈ n.heard ∧ c.device = d ∧ (f, some x) ∈ a.files) := by
  -- it takes in only what came on a connection that proved `d`
  have proven : ∀ {c : Conn} {a : Announce}, (c, a) ∈ n.heard.filter (·.1.device == d) →
      (c, a) ∈ n.heard ∧ c.device = d := fun hx => by simpa using List.mem_filter.mp hx
  refine ⟨fun l F hm => ?_, fun f x hm => ?_⟩
  · rcases foldl_hear_logs _ _ hm with hm | ⟨⟨c, a⟩, hx, hm⟩
    · simp at hm
    · exact ⟨c, a, (proven hx).1, (proven hx).2, hm⟩
  · rcases foldl_hear_files _ _ hm with hm | ⟨⟨c, a⟩, hx, hm⟩
    · simp at hm
    · exact ⟨c, a, (proven hx).1, (proven hx).2, hm⟩

/-- What a device holding `h` announces says of each log and of each file it holds what `h` says of it, and names a
    file `none`, no longer held, only if what it last told (`told`) named it. -/
theorem since_sound {h : Holdings} {told : Option Holdings} {a : Announce} (hs : h.since told = some a) :
    (∀ l F, (l, F) ∈ a.logs → (l, F) ∈ h.logs) ∧ (∀ f x, (f, some x) ∈ a.files → (f, x) ∈ h.files) ∧
    (∀ f, (f, none) ∈ a.files → ∃ t ∈ told, ∃ x, (f, x) ∈ t.files) := by
  cases told with
  | none =>
    simp only [Holdings.since, Option.some.injEq] at hs
    subst hs
    refine ⟨fun l F hm => hm, fun f x hm => ?_, fun f hm => ?_⟩
    · obtain ⟨⟨f', y⟩, hy, he⟩ := List.mem_map.mp hm
      simp only [Prod.mk.injEq, Option.some.injEq] at he
      obtain ⟨rfl, rfl⟩ := he
      exact hy
    · obtain ⟨⟨f', y⟩, -, he⟩ := List.mem_map.mp hm
      simp at he
  | some t =>
    simp only [Holdings.since] at hs
    split at hs
    · cases hs
    · simp only [Option.some.injEq] at hs
      subst hs
      refine ⟨fun l F hm => (List.mem_filter.mp hm).1, fun f x hm => ?_, fun f hm => ?_⟩
      · rcases List.mem_append.mp hm with hm | hm
        · obtain ⟨⟨f', y⟩, hy, he⟩ := List.mem_map.mp hm
          simp only [Prod.mk.injEq, Option.some.injEq] at he
          obtain ⟨rfl, rfl⟩ := he
          exact (List.mem_filter.mp hy).1
        · obtain ⟨⟨f', y⟩, -, he⟩ := List.mem_map.mp hm
          simp at he
      · rcases List.mem_append.mp hm with hm | hm
        · obtain ⟨⟨f', y⟩, -, he⟩ := List.mem_map.mp hm
          simp at he
        · obtain ⟨⟨f', y⟩, hy, he⟩ := List.mem_map.mp hm
          simp only [Prod.mk.injEq] at he
          obtain ⟨rfl, -⟩ := he
          exact ⟨t, rfl, y, (List.mem_filter.mp hy).1⟩

/-- An edit a peer sends a device brings the whole of its log with it: every edit the peer holds of that log is sent
    too. -/
theorem respond_whole_logs {edits : List Edit} {d : SignerId} {fl : List VaultId} {o o' : Edit}
    (h : o' ∈ respond edits d fl) (ho : o ∈ edits) (hl : o.log? = o'.log?) : o ∈ respond edits d fl := by
  simp only [respond, List.mem_append, List.mem_filter] at h ⊢
  rw [hl]
  rcases h with ⟨-, h⟩ | ⟨-, h⟩
  · exact .inl ⟨ho, h⟩
  · exact .inr ⟨ho, h⟩

/-- A file a device may know of by a node's view is brought by an edit sent it. -/
theorem reachFiles_brought {edits : List Edit} {d : SignerId} {f : FileId} (h : f ∈ reachFiles edits d) :
    (respond edits d).any (fun o => o.filesOf.contains f) = true := by
  simp only [reachFiles, List.mem_flatMap, List.mem_filter] at h
  obtain ⟨o, ⟨ho, hl⟩, hf⟩ := h
  split at hl
  · rename_i l hl'
    simp only [reachLogs, logsOf, List.contains_iff_mem, List.mem_eraseDups, List.mem_filterMap] at hl
    obtain ⟨o', ho', hl''⟩ := hl
    exact List.any_eq_true.mpr ⟨o, respond_whole_logs ho' ho (hl'.trans hl''.symm), by simpa using hf⟩
  · cases hl

/-- A file a device may know of by a node's view, it may fetch (T27). -/
theorem reachFiles_fetch {edits : List Edit} {d : SignerId} {f : FileId} (h : f ∈ reachFiles edits d) :
    mayFetch edits d f = true := by
  obtain ⟨o, ho, hf⟩ := List.any_eq_true.mp (reachFiles_brought h)
  unfold mayFetch
  exact List.any_eq_true.mpr ⟨o, ho, by rw [hf]; rfl⟩

/-- What a node tells device `d` it holds is of its own holdings, of logs and files `d` may know of. -/
theorem tells_sound {n : Node} {d : SignerId} :
    (∀ l F, (l, F) ∈ (n.tells d).logs → F = holdOf n.shelf l ∧ l ∈ logsOf n.shelf ∧ l ∈ reachLogs n.edits d) ∧
    (∀ f x, (f, x) ∈ (n.tells d).files → (f, x) ∈ n.files ∧ f ∈ reachFiles n.edits d) := by
  refine ⟨fun l F hm => ?_, fun f x hm => ?_⟩
  · simp only [Node.tells, Node.own, List.mem_filter, List.mem_map, List.contains_iff_mem] at hm
    obtain ⟨⟨l', hl', he⟩, hr⟩ := hm
    simp only [Prod.mk.injEq] at he
    obtain ⟨rfl, rfl⟩ := he
    exact ⟨rfl, hl', hr⟩
  · simp only [Node.tells, Node.own, List.mem_filter, List.contains_iff_mem] at hm
    exact hm

/-- Every edit a peer reaches walking back from `F` it reaches from `G`, if it reaches each of `F` from `G`. -/
theorem reaches_trans {os : List Edit} {F G : List EditId} {i : EditId} (h : Reaches os F i)
    (hF : ∀ j ∈ F, Reaches os G j) : Reaches os G i := by
  induction h with
  | base hj => exact hF _ hj
  | step hy _ hp ih => exact .step hy ih hp

/-- Every edit a device holds waiting is one it holds. -/
theorem waitingIn_mem {edits : List Edit} {l : LogId} {i : EditId} (h : i ∈ waitingIn edits l) :
    ∃ a ∈ edits, a.id = i := by
  simp only [waitingIn, inLog, List.mem_mergeSort, List.mem_eraseDups, List.mem_map, List.mem_filter] at h
  obtain ⟨a, ⟨⟨ha, -⟩, -⟩, rfl⟩ := h
  exact ⟨a, ha, rfl⟩

/-- An edit of a log outside its closed part is held waiting, when no two edits share an id. -/
theorem mem_waitingIn {edits : List Edit} {l : LogId} (hu : ∀ a ∈ edits, ∀ b ∈ edits, a.id = b.id → a = b) {x : Edit}
    (hx : x ∈ inLog Edit.log? edits l) (hc : x ∉ closedPart Edit.log? edits l) : x.id ∈ waitingIn edits l := by
  simp only [waitingIn, List.mem_mergeSort, List.mem_eraseDups, List.mem_map, List.mem_filter]
  refine ⟨x, ⟨hx, ?_⟩, rfl⟩
  simp only [Bool.not_eq_true', List.any_eq_false, beq_iff_eq]
  intro y hy hid
  exact hc (hu y (closedPart_sub _ hy).1 x (List.mem_filter.mp hx).1 hid ▸ hy)

/-- A frontier a device states of what its shelf `S` holds of log `l` covers the log as a node holding `N` holds it only
    if `S` holds every edit of it `N` holds: what the stated heads reach, walking `N`'s copy of the log, is of `S`'s
    closed part, which holds the whole past of each of its edits; and what `N` holds waiting, `S` holds. Assumes ids
    don't collide. -/
theorem covered_held {N S : List Edit} {l : LogId} (hid : ∀ a ∈ S, ∀ b ∈ N, a.id = b.id → a = b)
    (hu : ∀ a ∈ N, ∀ b ∈ N, a.id = b.id → a = b) (hc : covers N l (holdOf S l) = true) {x : Edit}
    (hx : x ∈ inLog Edit.log? N l) : x ∈ S := by
  simp only [covers, holdOf, Bool.and_eq_true, List.all_eq_true, Bool.or_eq_true, List.contains_iff_mem] at hc
  obtain ⟨hheads, hwait⟩ := hc
  -- what the stated heads reach is an edit `S` holds, with its whole past
  have held : ∀ {i}, Reaches (inLog Edit.log? N l) (frontiers S l) i → ∃ a ∈ S, a.id = i := fun hr => by
    obtain ⟨a, ha, haid⟩ := reaches_held Edit.log? Edit.log? hid (fun _ hj => frontier_mem Edit.log? hj) hr
    exact ⟨a, (closedPart_sub _ ha).1, haid⟩
  have hxN : x ∈ N := (List.mem_filter.mp hx).1
  by_cases hcp : x ∈ closedPart Edit.log? N l
  · -- at or below the node's frontier, each head of which the stated heads reach
    obtain ⟨a, ha, haid⟩ := held (reaches_trans (closed_reaches_frontier Edit.log? hu hcp) fun j hj =>
      reaches_of_ancestorsN _ (hheads j hj))
    exact hid a ha x hxN haid ▸ ha
  · rcases hwait x.id (mem_waitingIn hu hx hcp) with h | h
    · obtain ⟨a, ha, haid⟩ := held (reaches_of_ancestorsN _ h)
      exact hid a ha x hxN haid ▸ ha
    · obtain ⟨a, ha, haid⟩ := waitingIn_mem h
      exact hid a ha x hxN haid ▸ ha

/-- What announcement `a` stated of `t`, and whether that is all of it a node holding `edits` holds: a frontier of the
    entry's log, covering the log as the node holds it or not; what it holds of the file, the whole file or not. -/
def Stated (edits : List Edit) (a : Announce) (all : Bool) : Synced → Prop
  | .entry e => ∃ F, (LogId.entry e, F) ∈ a.logs ∧ covers edits (.entry e) F = all
  | .file f  => ∃ x, (f, some x) ∈ a.files ∧ (x == .whole) = all

/-- A device a node lists in "Synced to" for `t`, other than its own, may hold `t` by the node's view, and stated on a
    connection whose hello proved it what it holds of `t`: all of it, if listed so. -/
theorem syncedTo_sound {n : Node} {me d : SignerId} {t : Synced} {all : Bool} (h : (d, all) ∈ n.syncedTo me t)
    (hne : d ≠ me) : t.reaches n.edits d = true ∧ ∃ c a, (c, a) ∈ n.heard ∧ c.device = d ∧ Stated n.edits a all t := by
  simp only [Node.syncedTo] at h
  split at h
  · simp at h
  · simp only [List.mem_mergeSort, List.mem_append, List.mem_map, Option.mem_toList, List.mem_filterMap] at h
    rcases h with ⟨b, -, hb⟩ | ⟨d', -, hd'⟩
    · exact absurd (Prod.mk.inj hb).1.symm hne
    · split at hd'
      · rename_i hr
        cases t with
        | entry e =>
          simp only [Holdings.of?, Option.map_eq_some_iff, Option.map_map] at hd'
          obtain ⟨F, hF, hEq⟩ := hd'
          obtain ⟨rfl, rfl⟩ := Prod.mk.inj hEq
          obtain ⟨c, a, hca, hd, hm⟩ := (record_sound n d').1 _ _ (mem_of_log? hF)
          exact ⟨hr, c, a, hca, hd, F, hm, rfl⟩
        | file f =>
          simp only [Holdings.of?, Option.map_eq_some_iff, Option.map_map] at hd'
          obtain ⟨x, hx, hEq⟩ := hd'
          obtain ⟨rfl, rfl⟩ := Prod.mk.inj hEq
          obtain ⟨c, a, hca, hd, hm⟩ := (record_sound n d').2 _ _ (mem_of_file? hx)
          exact ⟨hr, c, a, hca, hd, x, hm, rfl⟩
      · simp at hd'

/-! ## Signed holdings (H2) -/

/-- The newer of two statements is checked no earlier than either. -/
theorem newer_ge (b s : Statement) : b.checked ≤ (newer b s).checked ∧ s.checked ≤ (newer b s).checked := by
  unfold newer
  split <;> refine ⟨?_, ?_⟩ <;> omega

/-- The newest of statements, from `s` on, is one of them. -/
theorem foldl_newer_mem : ∀ (rest : List Statement) (s : Statement), rest.foldl newer s ∈ s :: rest
  | [], _ => List.mem_singleton.mpr rfl
  | x :: rest, s => by
    rw [List.foldl_cons]
    rcases List.mem_cons.mp (foldl_newer_mem rest (newer s x)) with h | h
    · rw [h]
      unfold newer
      split
      · exact List.mem_cons_of_mem _ List.mem_cons_self
      · exact List.mem_cons_self
    · exact List.mem_cons_of_mem _ (List.mem_cons_of_mem _ h)

/-- Taking the newer of each statement in turn checks no earlier than where it starts. -/
theorem foldl_newer_ge : ∀ (rest : List Statement) (b : Statement), b.checked ≤ (rest.foldl newer b).checked
  | [], _ => Nat.le_refl _
  | x :: rest, b => Nat.le_trans (newer_ge b x).1 (foldl_newer_ge rest (newer b x))

/-- The newest of statements, from `s` on, was checked no earlier than any of them. -/
theorem le_foldl_newer : ∀ (rest : List Statement) (s x : Statement), x ∈ s :: rest →
    x.checked ≤ (rest.foldl newer s).checked
  | [], s, x, h => by
    rw [List.mem_singleton.mp h]
    exact Nat.le_refl _
  | y :: rest, s, x, h => by
    rw [List.foldl_cons]
    rcases List.mem_cons.mp h with rfl | h
    · exact Nat.le_trans (newer_ge x y).1 (foldl_newer_ge rest _)
    · rcases List.mem_cons.mp h with rfl | h
      · exact Nat.le_trans (newer_ge s x).2 (foldl_newer_ge rest _)
      · exact le_foldl_newer rest (newer s y) x (List.mem_cons_of_mem _ h)

/-- What a node keeps of device `d` is a statement it heard that `d` signed, of a device it knows, and checked no
    earlier than any other statement it heard that `d` signed. -/
theorem statement_sound {n : Node} {d : SignerId} {s : Statement} (h : n.statement d = some s) :
    s ∈ n.stated ∧ s.device = d ∧ s.signer = some d ∧ devicesIn n.edits d = true ∧
      ∀ x ∈ n.stated, x.signer = some d → x.device = d → x.checked ≤ s.checked := by
  unfold Node.statement at h
  split at h
  · rename_i hd
    split at h
    · cases h
    · rename_i s0 rest hf
      simp only [Option.some.injEq] at h
      subst h
      have hmem := hf ▸ foldl_newer_mem rest s0
      obtain ⟨hin, hok⟩ := List.mem_filter.mp hmem
      simp only [Statement.signed, Bool.and_eq_true, beq_iff_eq] at hok
      obtain ⟨hsig, hdev⟩ := hok
      refine ⟨hin, hdev, by rw [hsig, hdev], hd, fun x hx hxs hxd => le_foldl_newer rest s0 x ?_⟩
      rw [← hf]
      exact List.mem_filter.mpr ⟨hx, by simp [Statement.signed, hxs, hxd]⟩
  · cases h

/-- A statement that isn't `d`'s own, signed by it, changes nothing of what a node keeps of `d`, wherever it falls. -/
theorem statement_ignores (n : Node) (d : SignerId) (before after : List Statement) (x : Statement)
    (hx : ¬(x.signer = some d ∧ x.device = d)) :
    { n with stated := before ++ x :: after }.statement d = { n with stated := before ++ after }.statement d := by
  have hf : (x.signed && x.device == d) = false := by
    by_cases hd : x.device = d
    · have : ¬x.signer = some x.device := fun h => hx ⟨hd ▸ h, hd⟩
      simp [Statement.signed, this]
    · simp [hd]
  simp only [Node.statement, List.filter_append, List.filter_cons, hf]
  rfl

/-- A statement a node passes to device `p` is what it keeps of another device, and `p` may know all it says. -/
theorem passes_sound {n : Node} {p : SignerId} {s : Statement} (h : s ∈ n.passes p) :
    ∃ d, d ≠ p ∧ n.statement d = some s ∧ (∀ l F, (l, F) ∈ s.holdings.logs → l ∈ reachLogs n.edits p) ∧
      (∀ f x, (f, x) ∈ s.holdings.files → f ∈ reachFiles n.edits p) := by
  simp only [Node.passes, List.mem_filterMap, List.mem_filter, bne_iff_ne, ne_eq] at h
  obtain ⟨d, ⟨-, hdp⟩, hs⟩ := h
  rw [Option.filter_eq_some_iff] at hs
  obtain ⟨hs, hk⟩ := hs
  simp only [mayKnow, Bool.and_eq_true, List.all_eq_true, List.contains_iff_mem] at hk
  exact ⟨d, hdp, hs, fun l F hm => hk.1 _ hm, fun f x hm => hk.2 _ hm⟩

/-- What holdings `h` state of `t`, and whether that is all of it a node holding `edits` holds: a frontier of the entry's
    log, covering the log as the node holds it or not; what they hold of the file, the whole file or not. -/
def HoldsAs (edits : List Edit) (h : Holdings) (all : Bool) : Synced → Prop
  | .entry e => ∃ F, (LogId.entry e, F) ∈ h.logs ∧ covers edits (.entry e) F = all
  | .file f  => ∃ x, (f, x) ∈ h.files ∧ (x == .whole) = all

theorem of?_sound {h : Holdings} {edits : List Edit} {t : Synced} {all : Bool} (hh : h.of? edits t = some all) :
    HoldsAs edits h all t := by
  cases t with
  | entry e =>
    simp only [Holdings.of?, Option.map_eq_some_iff] at hh
    obtain ⟨F, hF, rfl⟩ := hh
    exact ⟨F, mem_of_log? hF, rfl⟩
  | file f =>
    simp only [Holdings.of?, Option.map_eq_some_iff] at hh
    obtain ⟨x, hx, rfl⟩ := hh
    exact ⟨x, mem_of_file? hx, rfl⟩

/-- A device "Synced to" lists with no time, other than the node's own, it lists as `syncedTo` does: by what it
    announced on a connection whose hello proved it. -/
theorem syncedToAt_now {n : Node} {me d : SignerId} {live : List SignerId} {t : Synced} {all : Bool}
    (h : (d, all, none) ∈ n.syncedToAt me live t) : (d, all) ∈ n.syncedTo me t := by
  simp only [Node.syncedToAt, List.mem_mergeSort, List.mem_append, List.mem_map, List.mem_filter] at h
  rcases h with ⟨x, ⟨hx, -⟩, he⟩ | h
  · simp only [Prod.mk.injEq] at he
    obtain ⟨rfl, rfl, -⟩ := he
    exact hx
  · split at h
    · simp [List.mem_filterMap, Option.bind_eq_some_iff, Option.map_eq_some_iff] at h
    · simp at h

/-- A device "Synced to" lists with when it checked is on no live connection, and listed by the newest statement the
    node keeps of it, which it signed, checked then: it may hold `t` by the node's view, and the statement says what it
    holds of `t`, all of it if listed so. -/
theorem syncedToAt_checked {n : Node} {me d : SignerId} {live : List SignerId} {t : Synced} {all : Bool} {T : Nat}
    (h : (d, all, some T) ∈ n.syncedToAt me live t) :
    d ≠ me ∧ d ∉ live ∧ t.reaches n.edits d = true ∧
      ∃ s, n.statement d = some s ∧ s.checked = T ∧ s.signer = some d ∧ HoldsAs n.edits s.holdings all t := by
  simp only [Node.syncedToAt, List.mem_mergeSort, List.mem_append, List.mem_map, List.mem_filter] at h
  rcases h with ⟨x, -, he⟩ | h
  · simp at he
  · split at h
    · simp only [List.mem_filterMap, Option.bind_eq_some_iff, Option.map_eq_some_iff, List.mem_filter,
        Bool.and_eq_true, bne_iff_ne, ne_eq, Bool.not_eq_true'] at h
      obtain ⟨d', ⟨-, ⟨hme, hl⟩, hr⟩, s, hs, all', ha, he⟩ := h
      simp only [Prod.mk.injEq, Option.some.injEq] at he
      obtain ⟨rfl, rfl, rfl⟩ := he
      exact ⟨hme, by simpa using hl, hr, s, hs, rfl, (statement_sound hs).2.2.1, of?_sound ha⟩
    · simp at h

end AvenDB.Syncing
