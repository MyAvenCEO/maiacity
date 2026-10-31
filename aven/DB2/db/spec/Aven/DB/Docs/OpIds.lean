import Aven.Core

/-!
# Op ids and hashes name the same past

An envelope names its past twice: by hash, the one before it in its log and the tips it builds on (Core's `prev` and
`deps`), and by Loro's op ids, the dependencies of the changes it carries. Docs rule 7 makes them agree: its Loro
dependencies are exactly the last op ids of the envelopes it names by hash, and an envelope where they disagree is
refused (docs, "Envelopes"; reader check 7).

Two facts make the two names one. Names are injective, so the op ids are fixed by the hashes (`ops_fixed`). Loro
refuses an import that reuses an op id with other content (`UsedOpID`), so no two envelopes a reader holds share their
last op id, and the hashes are fixed by the op ids (`hashes_fixed`). So when two envelopes agree on either, they name
the same past (`same_past`).

What it proves: `ops_fixed`, `hashes_fixed`, `same_past`; and the check as a reader runs it, `opsAgreeB`, is sound
(`opsAgreeB_sound`).
-/

namespace Aven.DB.Docs

open Aven.Core

/-- A Loro op id: the writer id and the counter. -/
abbrev OpId := Nat × Nat

/-- What a reader learns of an envelope's ops: the op id of its last op, and the Loro dependencies it carries. -/
structure Ops where
  last : Envelope → OpId
  deps : Envelope → List OpId

/-- What an envelope names by hash: the one before it, then its tips. -/
def namedPast (e : Envelope) : List Hash := e.prev.toList ++ e.deps

/-- Rule 7's check, given the envelopes `past` the reader resolved the names to, from what it holds: they are what
the envelope names by hash, and its Loro dependencies are their last op ids. -/
def OpsAgree (nm : Envelope → Hash) (O : Ops) (held : List Envelope) (e : Envelope) (past : List Envelope) : Prop :=
  (∀ p ∈ past, p ∈ held) ∧ past.map nm = namedPast e ∧ O.deps e = past.map O.last

theorem map_inj_on {α β : Type} {f : α → β} {S : List α} (inj : ∀ a ∈ S, ∀ b ∈ S, f a = f b → a = b) :
    ∀ {xs ys : List α}, (∀ x ∈ xs, x ∈ S) → (∀ y ∈ ys, y ∈ S) → xs.map f = ys.map f → xs = ys
  | [], [], _, _, _ => rfl
  | [], _ :: _, _, _, h => by simp at h
  | _ :: _, [], _, _, h => by simp at h
  | x :: xs, y :: ys, hx, hy, h => by
    simp only [List.map_cons, List.cons.injEq] at h
    have hx' : ∀ z ∈ xs, z ∈ S := fun z hz => hx z (List.mem_cons_of_mem _ hz)
    have hy' : ∀ z ∈ ys, z ∈ S := fun z hz => hy z (List.mem_cons_of_mem _ hz)
    rw [inj x (hx x (List.mem_cons_self ..)) y (hy y (List.mem_cons_self ..)) h.1, map_inj_on inj hx' hy' h.2]

/-- With names injective on what a reader holds, the hashes fix the past, and so the op ids it must carry. -/
theorem ops_fixed {nm : Envelope → Hash} {O : Ops} {held : List Envelope}
    (inj : ∀ a ∈ held, ∀ b ∈ held, nm a = nm b → a = b) {e : Envelope} {p p' : List Envelope}
    (h : OpsAgree nm O held e p) (h' : OpsAgree nm O held e p') : p = p' :=
  map_inj_on inj h.1 h'.1 (h.2.1.trans h'.2.1.symm)

/-- With no op id reused among what a reader holds (Loro's `UsedOpID`), two envelopes that carry the same Loro
dependencies name the same past by hash. -/
theorem hashes_fixed {nm : Envelope → Hash} {O : Ops} {held : List Envelope}
    (used : ∀ a ∈ held, ∀ b ∈ held, O.last a = O.last b → a = b) {e e' : Envelope} {p p' : List Envelope}
    (h : OpsAgree nm O held e p) (h' : OpsAgree nm O held e' p') (same : O.deps e = O.deps e') :
    namedPast e = namedPast e' := by
  have : p = p' := map_inj_on used h.1 h'.1 (h.2.2.symm.trans (same.trans h'.2.2))
  rw [← h.2.1, ← h'.2.1, this]

/-- Two envelopes that pass rule 7 name the same past by hash exactly when they carry the same Loro dependencies. -/
theorem same_past {nm : Envelope → Hash} {O : Ops} {held : List Envelope}
    (inj : ∀ a ∈ held, ∀ b ∈ held, nm a = nm b → a = b) (used : ∀ a ∈ held, ∀ b ∈ held, O.last a = O.last b → a = b)
    {e e' : Envelope} {p p' : List Envelope} (h : OpsAgree nm O held e p) (h' : OpsAgree nm O held e' p') :
    namedPast e = namedPast e' ↔ O.deps e = O.deps e' := by
  constructor
  · intro same
    have : p = p' := map_inj_on inj h.1 h'.1 (h.2.1.trans (same.trans h'.2.1.symm))
    rw [h.2.2, h'.2.2, this]
  · exact hashes_fixed used h h'

/-! ## The check, decided -/

/-- Resolve every name to an envelope the reader holds, or `none` when one is missing (the envelope waits). -/
def resolveAll (nm : Envelope → Hash) (held : List Envelope) : List Hash → Option (List Envelope)
  | [] => some []
  | h :: hs => match held.find? (fun x => nm x == h), resolveAll nm held hs with
    | some x, some xs => some (x :: xs)
    | _, _ => none

/-- Rule 7's check as a reader runs it: the names resolve, and the Loro dependencies are their last op ids. -/
def opsAgreeB (nm : Envelope → Hash) (O : Ops) (held : List Envelope) (e : Envelope) : Bool :=
  match resolveAll nm held (namedPast e) with
  | some past => O.deps e == past.map O.last
  | none => false

theorem resolveAll_sound {nm : Envelope → Hash} {held : List Envelope} :
    ∀ {hs : List Hash} {past : List Envelope}, resolveAll nm held hs = some past →
      (∀ p ∈ past, p ∈ held) ∧ past.map nm = hs
  | [], past, h => by simp only [resolveAll, Option.some.injEq] at h; subst h; simp
  | x :: hs, past, h => by
    simp only [resolveAll] at h
    split at h
    · next y ys hy hys =>
      simp only [Option.some.injEq] at h; subst h
      have m := List.find?_some hy
      have e := List.mem_of_find?_eq_some hy
      have ih := resolveAll_sound hys
      simp only [beq_iff_eq] at m
      refine ⟨fun p hp => ?_, by simp [m, ih.2]⟩
      rcases List.mem_cons.mp hp with rfl | hp
      · exact e
      · exact ih.1 p hp
    · simp at h

/-- The decided check passes exactly when rule 7's check does, for the envelopes it resolves. -/
theorem opsAgreeB_sound {nm : Envelope → Hash} {O : Ops} {held : List Envelope} {e : Envelope}
    (h : opsAgreeB nm O held e = true) : ∃ past, OpsAgree nm O held e past := by
  unfold opsAgreeB at h
  split at h
  · next past hr =>
    have ⟨m, n⟩ := resolveAll_sound hr
    exact ⟨past, m, n, beq_iff_eq.mp h⟩
  · cases h

/-- Loro's `UsedOpID`, decided: no two envelopes a reader holds share their last op id. -/
def usedOk (O : Ops) (held : List Envelope) : Bool := (held.map O.last).Nodup

end Aven.DB.Docs

/-! ## Rule 7 in Loro's terms

A Loro change's own `deps` leave out its writer's previous op when another op already builds on it, since a writer's
counters are contiguous (seen in Loro 1.17.1). So an envelope's Loro dependencies, as rule 7 compares them, are its
writer's previous op first, when it has one, then the change's other deps, sorted by op id (`carriedDeps`); a writer
names `prev` first and its `deps` in that same order. A change that names an older op of its own writer is refused. -/

namespace Aven.DB.Docs

open Aven.Core

def opLe (a b : OpId) : Bool := a.1 < b.1 || (a.1 == b.1 && a.2 ≤ b.2)

/-- An envelope's Loro dependencies from its change's `deps`, for a commit of `writer` whose first counter is `start`:
the writer's previous op, then the others by op id. `none` when the change names another op of its own writer. -/
def carriedDeps (writer start : Nat) (frontier : List OpId) : Option (List OpId) :=
  let own : List OpId := if start = 0 then [] else [(writer, start - 1)]
  if frontier.any fun d => d.1 == writer && !own.contains d then none
  else some (own ++ ((frontier.filter fun d => d.1 != writer).eraseDups.mergeSort opLe))

/-- What a reader decides from the commit's Loro deps and what the envelope names. -/
inductive LoroVerdict where
  | agrees
  | waits
  | disagrees
  | ownOp
  deriving DecidableEq, Repr

def LoroVerdict.text : LoroVerdict → String
  | .agrees => "agrees"
  | .waits => "waits: names what isn't held"
  | .disagrees => "refused: op ids and hashes disagree"
  | .ownOp => "refused: names an older op of its own writer"

/-- Rule 7 as a reader runs it on a Loro commit: the deps it carries, read by `carriedDeps`, are the last op ids of
what the envelope names by hash, `prev` first. -/
def loroAgrees (nm : Envelope → Hash) (last : Envelope → OpId) (held : List Envelope) (e : Envelope) (start : Nat)
    (frontier : List OpId) : LoroVerdict :=
  match carriedDeps e.writer start frontier with
  | none => .ownOp
  | some carried =>
    match resolveAll nm held (namedPast e) with
    | none => .waits
    | some past => if carried == past.map last then .agrees else .disagrees

/-- Past the check, the deps a commit carries are exactly the last ops of what it names: `opsAgreeB` holds with them. -/
theorem loroAgrees_sound {nm : Envelope → Hash} {last : Envelope → OpId} {held : List Envelope} {e : Envelope}
    {start : Nat} {frontier : List OpId} (h : loroAgrees nm last held e start frontier = .agrees) :
    ∃ carried, carriedDeps e.writer start frontier = some carried ∧
      opsAgreeB nm ⟨last, fun _ => carried⟩ held e = true := by
  unfold loroAgrees at h
  split at h
  · cases h
  · next carried hc =>
    refine ⟨carried, hc, ?_⟩
    unfold opsAgreeB
    split at h
    · cases h
    · next past hp =>
      simp only [hp]
      split at h
      · next he => simpa using he
      · cases h

#guard carriedDeps 1 4 [(2, 0)] == some [(1, 3), (2, 0)]
#guard carriedDeps 1 4 [(1, 3), (2, 0)] == some [(1, 3), (2, 0)]
#guard carriedDeps 1 4 [(3, 7), (2, 0)] == some [(1, 3), (2, 0), (3, 7)]
#guard carriedDeps 1 4 [(1, 2)] == none
#guard carriedDeps 1 0 [] == some []

end Aven.DB.Docs
