import Aven.ID.Query

/-! # Approvals

An approval is k of a vault's owners signing one digest, for one act (`id/caps/README.md`, rule 25). The model knows
a signature as avenID's statements do: the key that made it and what it signed, the scheme taken as sound. Every grant
needs its vault's owners' approval (D14): today any one owner is enough, so the threshold is 1 until owners act k of n.

An owner is a key or a vault. A key approves by signing exactly the digest; a vault approves by its own quorum, and so
on up to keys (`approves`):
- `approvesF_exact`: a vault approves only with its threshold of distinct owners, each a key that signed exactly the
  digest or a vault that approves it;
- `approves_signed`: with every threshold at least one, an approval rests on such a signature by a key above the vault;
- `approves_iff`: in a well-formed tree, looking as many levels up as the tree has vaults finds every approval.

What a person approves is shown from the exact bytes they sign (rule 25, A2): `shown` decodes those bytes and renders
what they hold, never a copy kept beside them. The codec is `Aven.Core`'s deterministic CBOR; here it is any encoding
that decodes what it encodes. -/

namespace Aven.ID

/-- A signature as the model knows one: the key that made it and the digest it signed. -/
structure Sig where
  key : String
  digest : String
  deriving DecidableEq, Repr

theorem nodup_dedup : ∀ (l : List String), (dedup l).Nodup
  | [] => List.nodup_nil
  | x :: xs => by
    simp only [dedup]
    refine List.nodup_cons.mpr ⟨by simp [List.mem_filter], (nodup_dedup xs).filter _⟩

/-- Each owner once, at its first place. -/
def ownersOnce : List Owner → List Owner
  | [] => []
  | o :: os => o :: (ownersOnce os).filter (· != o)

theorem mem_ownersOnce {o : Owner} : ∀ {l : List Owner}, o ∈ ownersOnce l ↔ o ∈ l
  | [] => by simp [ownersOnce]
  | p :: ps => by
    simp only [ownersOnce, List.mem_cons, List.mem_filter, bne_iff_ne, ne_eq, mem_ownersOnce]
    by_cases e : o = p <;> simp [e]

theorem nodup_ownersOnce : ∀ (l : List Owner), (ownersOnce l).Nodup
  | [] => List.nodup_nil
  | p :: ps => by
    simp only [ownersOnce]
    exact List.nodup_cons.mpr ⟨by simp [List.mem_filter], (nodup_ownersOnce ps).filter _⟩

/-- A filter with a weaker test keeps at least as many. -/
theorem length_filter_le {α : Type} {p q : α → Bool} : ∀ {l : List α}, (∀ x ∈ l, p x = true → q x = true) →
    (l.filter p).length ≤ (l.filter q).length
  | [], _ => Nat.le_refl _
  | x :: xs, h => by
    have ih := length_filter_le (l := xs) fun y m => h y (List.mem_cons_of_mem _ m)
    by_cases hp : p x = true
    · simp [hp, h x (List.mem_cons_self ..) hp] <;> omega
    · by_cases hq : q x = true <;> simp [hp, hq] <;> omega

namespace Tree

/-- `k` is one of `vault`'s owner keys. -/
def ownerKey (t : Tree) (vault k : String) : Bool :=
  match t.get? vault with
  | some v => v.ownerKeys.contains k
  | none => false

/-- The owners of `vault` who signed exactly `digest`, each once. -/
def approvers (t : Tree) (vault digest : String) (sigs : List Sig) : List String :=
  dedup ((sigs.filter fun s => s.digest == digest && t.ownerKey vault s.key).map (·.key))

/-- `k` of `vault`'s owners signed exactly `digest`. -/
def approved (t : Tree) (k : Nat) (vault digest : String) (sigs : List Sig) : Bool :=
  decide (k ≤ (t.approvers vault digest sigs).length)

variable {t : Tree}

theorem mem_approvers {vault digest o : String} {sigs : List Sig} :
    o ∈ t.approvers vault digest sigs ↔ ⟨o, digest⟩ ∈ sigs ∧ t.ownerKey vault o = true := by
  simp only [approvers, mem_dedup, List.mem_map, List.mem_filter, Bool.and_eq_true, beq_iff_eq]
  constructor
  · rintro ⟨s, ⟨m, d, k⟩, rfl⟩
    exact ⟨by cases s; simp_all, k⟩
  · rintro ⟨m, k⟩
    exact ⟨⟨o, digest⟩, ⟨m, rfl, k⟩, rfl⟩

/-- An approval holds only with `k` distinct owners of the vault, each having signed exactly this digest. -/
theorem approval_exact {k : Nat} {vault digest : String} {sigs : List Sig} (h : t.approved k vault digest sigs = true) :
    ∃ owners : List String, owners.Nodup ∧ k ≤ owners.length ∧
      ∀ o ∈ owners, ⟨o, digest⟩ ∈ sigs ∧ t.ownerKey vault o = true :=
  ⟨t.approvers vault digest sigs, nodup_dedup _, by simpa [approved] using h, fun _ m => mem_approvers.mp m⟩

/-- A signature over another digest never counts toward this one. -/
theorem approvers_other {vault digest : String} {sigs : List Sig} {s : Sig} (other : s.digest ≠ digest) :
    t.approvers vault digest (s :: sigs) = t.approvers vault digest sigs := by
  simp [approvers, other]

/-! ### Owners that are vaults

An owner of a vault is a key or a vault. A key approves by signing exactly the digest; a vault approves when its own
owners do, by its own threshold, and so on up to keys (D14, rule 25). `approves` looks as many levels up as the tree has
vaults, which in a well-formed tree finds every approval (`approves_iff`). -/

/-- Whether an owner approves `digest`: a key by having signed exactly it, a vault by `ok`. -/
def ownerApproves (digest : String) (sigs : List Sig) (ok : String → Bool) : Owner → Bool
  | .key k => sigs.contains ⟨k, digest⟩
  | .vault a => ok a

/-- `vault` approves `digest`, looking `f` levels of owners up: at least its threshold of its owners do, each once. -/
def approvesF (t : Tree) (th : String → Nat) (digest : String) (sigs : List Sig) : Nat → String → Bool
  | 0, _ => false
  | f + 1, vault =>
    match t.get? vault with
    | none => false
    | some v =>
      decide (th vault ≤
        ((ownersOnce v.owners).filter (ownerApproves digest sigs (t.approvesF th digest sigs f))).length)

/-- `vault`'s owners approve `digest` by its threshold, an owner vault by its own, recursively. -/
def approves (t : Tree) (th : String → Nat) (vault digest : String) (sigs : List Sig) : Bool :=
  t.approvesF th digest sigs (t.vaults.length + 1) vault

/-- `k` is an owner key of `b`, or of a vault above it. -/
inductive KeyAbove (t : Tree) (k : String) : String → Prop
  | own {b : String} : t.KeyOwns k b → KeyAbove t k b
  | up {a b : String} : t.Owns a b → KeyAbove t k a → KeyAbove t k b

variable {th : String → Nat} {digest : String} {sigs : List Sig}

theorem owns_of_get? {a vault : String} {v : Vault} (hv : t.get? vault = some v) (m : Owner.vault a ∈ v.owners) :
    t.Owns a vault := by
  simp only [Owns, ownersOf, hv, Option.map_some, Option.getD_some, Vault.ownerVaults, List.mem_filterMap]
  exact ⟨_, m, rfl⟩

/-- An approval holds only with its threshold of distinct owners, each a key that signed exactly this digest or a vault
that approves it by its own quorum. -/
theorem approvesF_exact {f : Nat} {vault : String} (h : t.approvesF th digest sigs (f + 1) vault = true) :
    ∃ v, t.get? vault = some v ∧ ∃ owners : List Owner, owners.Nodup ∧ th vault ≤ owners.length ∧
      ∀ o ∈ owners, o ∈ v.owners ∧ ownerApproves digest sigs (t.approvesF th digest sigs f) o = true := by
  unfold approvesF at h
  cases hv : t.get? vault with
  | none => simp [hv] at h
  | some v =>
    simp only [hv, decide_eq_true_eq] at h
    refine ⟨v, rfl, _, (nodup_ownersOnce _).filter _, h, fun o m => ?_⟩
    simp only [List.mem_filter, mem_ownersOnce] at m
    exact m

/-- With every threshold at least one, an approval rests on a signature of exactly this digest by a key above the
vault: no vault approves on nobody's signature. -/
theorem approvesF_signed (pos : ∀ x, 1 ≤ th x) : ∀ {f : Nat} {vault : String},
    t.approvesF th digest sigs f vault = true → ∃ k, t.KeyAbove k vault ∧ ⟨k, digest⟩ ∈ sigs
  | 0, _, h => by simp [approvesF] at h
  | f + 1, vault, h => by
    obtain ⟨v, hv, owners, _, le, all⟩ := approvesF_exact h
    obtain ⟨o, mo⟩ : ∃ o, o ∈ owners := List.exists_mem_of_length_pos (by have := pos vault; omega)
    obtain ⟨ov, oa⟩ := all o mo
    cases o with
    | key k =>
      refine ⟨k, .own ⟨v, hv, ?_⟩, by simpa [ownerApproves] using oa⟩
      simp only [Vault.ownerKeys, List.mem_filterMap]
      exact ⟨_, ov, rfl⟩
    | vault a =>
      obtain ⟨k, ka, s⟩ := approvesF_signed pos (by simpa [ownerApproves] using oa)
      exact ⟨k, .up (owns_of_get? hv ov) ka, s⟩

/-- Looking one more level up never undoes an approval. -/
theorem approvesF_succ : ∀ {f : Nat} {vault : String}, t.approvesF th digest sigs f vault = true →
    t.approvesF th digest sigs (f + 1) vault = true
  | 0, _, h => by simp [approvesF] at h
  | f + 1, vault, h => by
    unfold approvesF at h ⊢
    cases hv : t.get? vault with
    | none => simp [hv] at h
    | some v =>
      simp only [hv, decide_eq_true_eq] at h ⊢
      refine Nat.le_trans h (length_filter_le fun o _ p => ?_)
      cases o with
      | key k => exact p
      | vault a => exact approvesF_succ p

theorem approvesF_mono {f g : Nat} {vault : String} (le : f ≤ g) (h : t.approvesF th digest sigs f vault = true) :
    t.approvesF th digest sigs g vault = true := by
  induction le with
  | refl => exact h
  | step _ ih => exact approvesF_succ ih

/-- In a well-formed tree a vault's owners stand lower than it, so looking as many levels up as its rank finds every
approval. -/
theorem approvesF_rank (w : t.WF) : ∀ {f : Nat} {vault : String}, t.approvesF th digest sigs f vault = true →
    t.approvesF th digest sigs (t.rank vault + 1) vault = true
  | 0, _, h => by simp [approvesF] at h
  | f + 1, vault, h => by
    unfold approvesF at h ⊢
    cases hv : t.get? vault with
    | none => simp [hv] at h
    | some v =>
      simp only [hv, decide_eq_true_eq] at h ⊢
      refine Nat.le_trans h (length_filter_le fun o m p => ?_)
      cases o with
      | key k => exact p
      | vault a =>
        exact approvesF_mono (w.rank_lt (owns_of_get? hv (mem_ownersOnce.mp m))) (approvesF_rank w p)

/-- In a well-formed tree, `approves` is the recursive quorum itself: it holds exactly when looking some number of
levels up finds the approval. -/
theorem approves_iff (w : t.WF) {vault : String} :
    t.approves th vault digest sigs = true ↔ ∃ f, t.approvesF th digest sigs f vault = true :=
  ⟨fun h => ⟨_, h⟩, fun ⟨_, h⟩ => approvesF_mono (by have := t.rank_le vault; omega) (approvesF_rank w h)⟩

/-- An approval of a vault with every threshold at least one rests on a signature of exactly this digest by a key above
it. -/
theorem approves_signed (pos : ∀ x, 1 ≤ th x) {vault : String} (h : t.approves th vault digest sigs = true) :
    ∃ k, t.KeyAbove k vault ∧ ⟨k, digest⟩ ∈ sigs :=
  approvesF_signed pos h

end Tree

/-- Any encoding that decodes what it encodes. `Aven.Core`'s deterministic CBOR is one (A2). -/
structure Codec (α : Type) where
  encode : α → List UInt8
  decode : List UInt8 → Option α
  roundtrip : ∀ a, decode (encode a) = some a

/-- What avenOS shows for the bytes a passkey is asked to sign: those bytes, decoded and rendered. -/
def shown {α : Type} (c : Codec α) (render : α → String) (bytes : List UInt8) : Option String :=
  (c.decode bytes).map render

/-- What is shown is what is signed: for the bytes of an act, avenOS shows exactly that act. -/
theorem shown_is_signed {α : Type} (c : Codec α) (render : α → String) (a : α) :
    shown c render (c.encode a) = some (render a) := by
  simp [shown, c.roundtrip]

end Aven.ID
