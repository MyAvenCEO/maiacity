import Aven.ID.Query

/-! # The queries are right

Each query against the relations of `Governs`, for well-formed trees: `governs` lists exactly what a vault governs and
`chain` exactly what governs it; no network or device vault is ever an account; whatever a vault sees, it governs; and
a device acts on what its vault governs and never on a vault above or beside it. -/

namespace Aven.ID
namespace Tree

variable {t : Tree}

theorem mem_owned {a b : String} : b ∈ t.owned a ↔ t.Owns a b := by
  simp only [owned, List.mem_filter, List.contains_iff_mem]
  exact ⟨fun h => h.2, fun h => ⟨h.mem_ids, h⟩⟩

theorem mem_below_sound : ∀ {f : Nat} {a x : String}, x ∈ t.below f a → t.Governs a x
  | 0, _, _, h => by simp [below] at h
  | f + 1, a, x, h => by
    simp only [below, List.mem_flatMap, List.mem_cons] at h
    obtain ⟨b, ob, e | m⟩ := h
    · exact e ▸ .owns (mem_owned.mp ob)
    · exact .step (mem_owned.mp ob) (mem_below_sound m)

theorem mem_below_complete (w : t.WF) {a x : String} (h : t.Governs a x) :
    ∀ f, t.rank x ≤ f + t.rank a → x ∈ t.below f a := by
  induction h with
  | @owns a b o =>
    intro f hf
    have := w.rank_lt o
    match f, hf with
    | 0, hf => omega
    | f + 1, _ => simp only [below, List.mem_flatMap, List.mem_cons]; exact ⟨b, mem_owned.mpr o, .inl rfl⟩
  | @step a b c o g ih =>
    intro f hf
    have := w.rank_lt o
    have := g.rank_lt w
    match f, hf with
    | 0, hf => omega
    | f + 1, hf =>
      simp only [below, List.mem_flatMap, List.mem_cons]
      exact ⟨b, mem_owned.mpr o, .inr (ih f (by omega))⟩

/-- `governs` lists exactly what a vault governs. -/
theorem mem_governs (w : t.WF) {a x : String} : x ∈ t.governs a ↔ t.Governs a x := by
  unfold governs
  rw [mem_dedup]
  exact ⟨mem_below_sound, fun h => mem_below_complete w h _ (by have := t.rank_le x; omega)⟩

theorem mem_above_sound : ∀ {f : Nat} {b x : String}, x ∈ t.above f b → t.Governs x b
  | 0, _, _, h => by simp [above] at h
  | f + 1, b, x, h => by
    simp only [above, List.mem_flatMap, List.mem_cons] at h
    obtain ⟨a, oa, e | m⟩ := h
    · exact e ▸ .owns oa
    · exact (mem_above_sound m).tail oa

theorem mem_above_complete (w : t.WF) {x b : String} (h : t.GovernsUp x b) :
    ∀ f, t.rank b ≤ f + t.rank x → x ∈ t.above f b := by
  induction h with
  | @owns b o =>
    intro f hf
    have := w.rank_lt o
    match f, hf with
    | 0, hf => omega
    | f + 1, _ => simp only [above, List.mem_flatMap, List.mem_cons]; exact ⟨x, o, .inl rfl⟩
  | @snoc a b g o ih =>
    intro f hf
    have := w.rank_lt o
    have := g.down.rank_lt w
    match f, hf with
    | 0, hf => omega
    | f + 1, hf =>
      simp only [above, List.mem_flatMap, List.mem_cons]
      exact ⟨a, o, .inr (ih f (by omega))⟩

/-- `chain` lists exactly the vaults that govern a vault. -/
theorem mem_chain (w : t.WF) {b x : String} : x ∈ t.chain b ↔ t.Governs x b := by
  unfold chain
  rw [mem_dedup]
  exact ⟨mem_above_sound, fun h => mem_above_complete w h.up _ (by have := t.rank_le b; omega)⟩

/-! ## Devices act for the vault they serve -/

theorem actsFor_some {d s : String} (h : t.actsFor d = some s) : t.Owns s d ∧ t.kind? d = some .device := by
  unfold actsFor at h
  cases g : t.get? d with
  | none => simp [g] at h
  | some v =>
    simp only [g] at h
    by_cases k : v.kind = .device
    · simp only [k, ↓reduceIte] at h
      refine ⟨?_, by simp [kind?, g, k]⟩
      show s ∈ t.ownersOf d
      rw [ownersOf_of_get? g]
      exact List.mem_of_mem_head? h
    · simp [k] at h

/-- Every device serves a vault, and only that one. -/
theorem actsFor_device (w : t.WF) {d : String} (h : t.kind? d = some .device) :
    ∃ s, t.actsFor d = some s ∧ ∀ s', t.Owns s' d → s' = s := by
  unfold kind? at h
  cases g : t.get? d with
  | none => simp [g] at h
  | some v =>
    have k : v.kind = .device := by simpa [g] using h
    have one := w.device v (get?_some g).1 k
    unfold Vault.servesOne at one
    split at one
    · next s e =>
      refine ⟨s, by simp [actsFor, g, k, Vault.ownerVaults, e, Owner.vault?], fun s' o => ?_⟩
      unfold Owns at o
      rw [ownersOf_of_get? g] at o
      simpa [Vault.ownerVaults, e, Owner.vault?] using o
    · contradiction

/-- A device serves no device: what it serves is a person's or a network's vault. -/
theorem actsFor_not_device (w : t.WF) {d s : String} (h : t.actsFor d = some s) : t.kind? s ≠ some .device :=
  w.not_device (actsFor_some h).1

/-- A device's own devices are exactly the device vaults it owns. -/
theorem mem_actsThrough {a d : String} : d ∈ t.actsThrough a ↔ t.Owns a d ∧ t.kind? d = some .device := by
  simp [actsThrough, mem_owned, isDevice]

/-- What a vault acts through serves that vault. -/
theorem actsThrough_actsFor (w : t.WF) {a d : String} (h : d ∈ t.actsThrough a) : t.actsFor d = some a := by
  obtain ⟨o, k⟩ := mem_actsThrough.mp h
  obtain ⟨s, e, u⟩ := actsFor_device w k
  rw [e, u a o]

/-! ## Accounts are people only -/

theorem mem_accounts {d : Option String} {x : String} (h : x ∈ t.accounts d) : t.kind? x = some .person := by
  unfold accounts at h
  cases d with
  | none => simpa [isPerson] using (List.mem_filter.mp h).2
  | some d =>
    simp only at h
    split at h
    · split at h
      · next p => simp at h; subst h; simpa [isPerson] using p
      · simp at h
    · simp at h

/-- No network or device vault is ever an account. -/
theorem not_account {d : Option String} {x : String}
    (h : t.kind? x = some .network ∨ t.kind? x = some .device) : x ∉ t.accounts d := by
  intro m
  have := mem_accounts m
  cases h <;> simp_all

/-- A device may act as the person it serves, and only as them. -/
theorem accounts_device {d x : String} (h : x ∈ t.accounts (some d)) : t.actsFor d = some x := by
  simp only [accounts] at h
  split at h
  · next s e => split at h <;> simp_all
  · simp at h

/-! ## What a vault sees -/

/-- Whatever a vault sees, it governs. -/
theorem sees_governs (w : t.WF) {a x : String} (h : x ∈ t.sees a) : t.Governs a x ∧ t.kind? x = some .device := by
  simp only [sees, List.mem_filter, isDevice, beq_iff_eq] at h
  exact ⟨(mem_governs w).mp h.1, h.2⟩

/-- A vault sees every device it governs. -/
theorem mem_sees (w : t.WF) {a x : String} : x ∈ t.sees a ↔ t.Governs a x ∧ t.kind? x = some .device := by
  simp [sees, isDevice, mem_governs w]

/-! ## Where a device may act -/

theorem mayActOn_iff (w : t.WF) {d v : String} :
    t.mayActOn d v = true ↔ ∃ s, t.actsFor d = some s ∧ (v = s ∨ t.Governs s v) := by
  unfold mayActOn
  cases t.actsFor d with
  | none => simp
  | some s =>
    simp only [Bool.or_eq_true, beq_iff_eq, List.contains_iff_mem, mem_governs w, Option.some.injEq,
      exists_eq_left']
    constructor <;> rintro (e | g)
    · exact .inl e.symm
    · exact .inr g
    · exact .inl e.symm
    · exact .inr g

/-- A device may act on what the vault it serves governs. -/
theorem mayActOn_governed (w : t.WF) {d s v : String} (h : t.actsFor d = some s) (g : t.Governs s v) :
    t.mayActOn d v = true :=
  (mayActOn_iff w).mpr ⟨s, h, .inr g⟩

/-- A device may act on the vault it serves. -/
theorem mayActOn_serves (w : t.WF) {d s : String} (h : t.actsFor d = some s) : t.mayActOn d s = true :=
  (mayActOn_iff w).mpr ⟨s, h, .inl rfl⟩

/-- A device never acts on a vault above the one it serves. -/
theorem mayActOn_not_above (w : t.WF) {d s v : String} (h : t.actsFor d = some s) (g : t.Governs v s) :
    t.mayActOn d v = false := by
  cases e : t.mayActOn d v with
  | false => rfl
  | true =>
    obtain ⟨s', h', r⟩ := (mayActOn_iff w).mp e
    rw [h] at h'
    cases h'
    rcases r with r | r
    · subst r; exact absurd g (governs_irrefl w _)
    · exact absurd g (governs_asymm w r)

/-- A device never acts on a vault beside the one it serves: neither it nor below it. -/
theorem mayActOn_not_beside (w : t.WF) {d s v : String} (h : t.actsFor d = some s) (ne : v ≠ s)
    (g : ¬ t.Governs s v) : t.mayActOn d v = false := by
  cases e : t.mayActOn d v with
  | false => rfl
  | true =>
    obtain ⟨s', h', r⟩ := (mayActOn_iff w).mp e
    rw [h] at h'
    cases h'
    rcases r with r | r
    · exact absurd r ne
    · exact absurd r g

end Tree
end Aven.ID
