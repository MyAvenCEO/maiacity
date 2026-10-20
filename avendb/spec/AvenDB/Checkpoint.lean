import AvenDB.Examples

/-!
# Signed checkpoints

The model takes an edit's signers to be the keys that signed it: a device checks every signature as an edit arrives.
A checkpoint (`Action.checkpoint`) lets a device skip that for edits a vault's owners already checked. It is an edit
of the vault's own log, accepted only where the vault approves it, by its root or its threshold of owners (`apply`), and
it names the edits it covers. A device may then hold a covered edit without its signatures ("bare"): it takes it on the
checkpoint's word, as long as

- the checkpoint stands in what the device knows, so an owner removed by a revocation that hadn't seen the checkpoint
  vouches for nothing, as any edit of a removed owner that the revocation hadn't seen falls;
- the checkpoint stands after the edit, so it vouches only for edits it had seen;
- every signer of the edit acted for the checkpoint's vault just before or just after it stood (`actsFor`): owners vouch
  only for their own vault's devices and passkeys, the vaults that own it, and none of another's, so a checkpoint can't
  put words in the mouth of a signer its vault never had.

An owner already approves anything its vault may do, so its word adds no power it hadn't; and only a device's own copy
of the signatures is dropped, never an edit or its id. A bare edit no standing checkpoint vouches for is left out, and
the replay runs again without it (`trusted`), until every bare edit left is vouched for (`trusted_vouched`). Where every
bare edit is vouched for by what all the edits say, nothing is left out and the device knows exactly what it would know
with every signature (`trusted_eq`, `trustedView_eq`). So a vault whose old edits a checkpoint by a key of today covers
needs no signature of the old suite (SLH-DSA) again: not to sync, not to restore, not to check.
-/

namespace AvenDB

/-- Each edit of `s`, applied in this order from the empty state, with the state just before it and just after it. -/
def around (s : List Edit) : List (Edit × State × State) :=
  let sts := trace {} s
  s.zip (sts.zip sts.tail)

/-- The ids the checkpoints among the edits `s` vouch for, `s` being the edits that stand in replay order: each edit
    before a checkpoint that the checkpoint covers and whose signers all acted for its vault just before or just after
    it. -/
def vouched (s : List Edit) : List EditId :=
  let a := around s
  s.zipIdx.flatMap fun (c, j) => match c.action with
    | .checkpoint v covers =>
      ((a.take j).filter fun (e, pre, post) =>
        covers.contains e.id && e.sigs.all fun x => actsFor pre x v || actsFor post x v).map (·.1.id)
    | _ => []

/-- One round: the edits held with their signatures (`signed`), and of the bare ones those vouched for by what the
    edits held stand for. -/
def trustRound (signed : EditId → Bool) (edits : List Edit) : List Edit :=
  let v := vouched (standing edits)
  edits.filter fun o => signed o.id || v.contains o.id

/-- Rounds until none leaves anything out, at most `n`. -/
def trustN (signed : EditId → Bool) : Nat → List Edit → List Edit
  | 0, es => es
  | n + 1, es =>
    let es' := trustRound signed es
    if es'.length == es.length then es else trustN signed n es'

/-- The edits a device holding `edits` takes, the ones `signed` with their signatures and the rest bare: one round per
    edit is enough, as each round that changes anything leaves one out. -/
def trusted (signed : EditId → Bool) (edits : List Edit) : List Edit := trustN signed edits.length edits

/-- What a device knows holding `edits`, the bare ones taken on the word of the checkpoints. -/
def trustedView (signed : EditId → Bool) (edits : List Edit) : State := view (trusted signed edits)

/-! ## What it keeps -/

/-- A round that leaves nothing out keeps every edit. -/
theorem trustRound_self {signed : EditId → Bool} {es : List Edit}
    (h : ∀ o ∈ es, (signed o.id || (vouched (standing es)).contains o.id) = true) :
    trustRound signed es = es := by
  unfold trustRound
  exact List.filter_eq_self.2 h

/-- The rounds take only edits held. -/
theorem trustN_sub (signed : EditId → Bool) : ∀ n es, ∀ o ∈ trustN signed n es, o ∈ es
  | 0, _, _, h => h
  | n + 1, es, o, h => by
    unfold trustN at h
    dsimp only at h
    split at h
    · exact h
    · exact (List.mem_filter.1 (trustN_sub signed n _ o h)).1

/-- A device takes only edits it holds. -/
theorem trusted_sub (signed : EditId → Bool) (edits : List Edit) : ∀ o ∈ trusted signed edits, o ∈ edits :=
  trustN_sub signed _ _

/-- Edits all held with their signatures are all taken. -/
theorem trustN_self {signed : EditId → Bool} {es : List Edit}
    (h : ∀ o ∈ es, (signed o.id || (vouched (standing es)).contains o.id) = true) : ∀ n, trustN signed n es = es
  | 0 => rfl
  | n + 1 => by
    unfold trustN
    dsimp only
    rw [trustRound_self h]
    simp

/-- Where every bare edit is vouched for by what all the edits say, a device takes every edit. -/
theorem trusted_eq {signed : EditId → Bool} {edits : List Edit}
    (h : ∀ o ∈ edits, (signed o.id || (vouched (standing edits)).contains o.id) = true) :
    trusted signed edits = edits :=
  trustN_self h _

/-- And then it knows exactly what it would know with every signature. -/
theorem trustedView_eq {signed : EditId → Bool} {edits : List Edit}
    (h : ∀ o ∈ edits, (signed o.id || (vouched (standing edits)).contains o.id) = true) :
    trustedView signed edits = view edits := by
  unfold trustedView
  rw [trusted_eq h]

/-- Holding every signature, a device takes every edit, as before checkpoints. -/
theorem trusted_signed {signed : EditId → Bool} {edits : List Edit} (h : ∀ o ∈ edits, signed o.id = true) :
    trusted signed edits = edits :=
  trusted_eq fun o ho => by simp [h o ho]

/-- Every bare edit a device takes is vouched for by the checkpoints that stand in what it takes. -/
theorem trustN_vouched (signed : EditId → Bool) :
    ∀ n es, es.length ≤ n → ∀ o ∈ trustN signed n es,
      (signed o.id || (vouched (standing (trustN signed n es))).contains o.id) = true
  | 0, es, hl, o, ho => by
    cases es with
    | nil => cases ho
    | cons _ _ => simp at hl
  | n + 1, es, hl, o, ho => by
    unfold trustN at ho ⊢
    dsimp only at ho ⊢
    split
    · rename_i heq
      split at ho
      · have hall := (List.length_filter_eq_length_iff.1 (beq_iff_eq.1 heq))
        exact hall o ho
      · contradiction
    · rename_i hne
      split at ho
      · contradiction
      · have hlt : (trustRound signed es).length < es.length := by
          have := List.length_filter_le (fun o => signed o.id || (vouched (standing es)).contains o.id) es
          unfold trustRound at hne ⊢
          dsimp only at hne ⊢
          have : ¬(List.filter (fun o => signed o.id || (vouched (standing es)).contains o.id) es).length
              = es.length := fun h => hne (beq_iff_eq.2 h)
          omega
        exact trustN_vouched signed n _ (by omega) o ho

theorem trusted_vouched (signed : EditId → Bool) (edits : List Edit) :
    ∀ o ∈ trusted signed edits,
      (signed o.id || (vouched (standing (trusted signed edits))).contains o.id) = true :=
  trustN_vouched signed _ _ (Nat.le_refl _)

/-- A checkpoint vouches only for edits before it that it covers. -/
theorem vouched_covered {s : List Edit} {x : EditId} (h : x ∈ vouched s) :
    ∃ c v covers, c ∈ s ∧ c.action = .checkpoint v covers ∧ x ∈ covers := by
  unfold vouched at h
  obtain ⟨⟨c, j⟩, hc, hx⟩ := List.mem_flatMap.1 h
  dsimp only at hx
  split at hx
  · rename_i v covers hact
    obtain ⟨⟨e, pre, post⟩, he, rfl⟩ := List.mem_map.1 hx
    obtain ⟨-, hcond⟩ := List.mem_filter.1 he
    simp only [Bool.and_eq_true, List.contains_iff_mem] at hcond
    exact ⟨c, v, covers, List.fst_mem_of_mem_zipIdx hc, hact, hcond.1⟩
  · cases hx

/-! ## Scenarios -/

namespace Examples

/-- Alice's vault with its two devices, and a checkpoint her passkey signs over both devices' edits. -/
def sChecked : List Edit := s1 ++ chain 30 [(passkeyA, [], .checkpoint alice [2, 3])]

/-- The Mac signs a checkpoint of its own: a device is no owner. -/
def sByDevice : List Edit := s1 ++ chain 30 [(macA, [], .checkpoint alice [2, 3])]

/-- Bob's passkey signs a checkpoint over Alice's edits: not his vault. -/
def sByBob : List Edit := s2 ++ chain 30 [(passkeyB, [], .checkpoint alice [2, 3])]

/-- Alice's passkey covers Bob's vault's founding: Bob's passkey never acted for Alice. -/
def sOverBob : List Edit := s2 ++ chain 30 [(passkeyA, [], .checkpoint alice [1, 2, 3, 10])]

-- held bare: the edits `ids`, the rest with their signatures
def bare (ids : List EditId) : EditId → Bool := fun i => !ids.contains i

-- with no checkpoint the bare device edits are left out, and the Mac is no device of Alice's
#guard (trusted (bare [2, 3]) s1).map (·.id) == [1]
#guard !actsFor (trustedView (bare [2, 3]) s1) macA alice
-- her passkey's checkpoint vouches for both: the device knows what it would with every signature
#guard (trusted (bare [2, 3]) sChecked).map (·.id) == [1, 2, 3, 30]
#guard actsFor (trustedView (bare [2, 3]) sChecked) macA alice
-- the founding too, when it is held bare: its passkey acts for Alice just after it; the checkpoint keeps its signature
#guard (trusted (bare [1, 2, 3]) (s1 ++ chain 30 [(passkeyA, [], .checkpoint alice [1, 2, 3])])).length == 4
-- a device's checkpoint, or another vault's passkey's, is refused and vouches for nothing
#guard !accepted s1 (attempt macA [] (.checkpoint alice [2, 3]))
#guard (trusted (bare [2, 3]) sByDevice).map (·.id) == [1, 30]
#guard !accepted s2 (attempt passkeyB [] (.checkpoint alice [2, 3]))
#guard !(trusted (bare [2, 3]) sByBob).any (·.id == 2)
-- Alice's word doesn't cover Bob's founding, held bare; her own edits it does
#guard vouched (standing sOverBob) == [1, 2, 3]
#guard !(trusted (bare [10]) sOverBob).any (·.id == 10)

end Examples

end AvenDB
