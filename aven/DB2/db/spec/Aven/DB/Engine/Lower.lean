import Aven.DB.Engine.Footprint

/-!
# Lowering `core/1`'s calls to steps (A32; caps, "Footprints")

A cap names the ops a holder may call, never steps. An envelope names the call it ran, `{op, params}`
(`Aven.Core.Call`), and every reader computes that call's steps, its **lowering**, alike: the footprint the verdict
judges the envelope's changes against (`verdictFootprint`). This is `core/1`'s lowering. A plugin's ops lower to
`core/1`'s, by the runtime its hash names (`Engine.Mutate`, A18).

- **A write names a type and its fields.** `core/1`'s writes, put, patch, remove and edit, take exactly two params,
  `type`, the type Doc the step writes as the 32 bytes of its hash, and `fields`, the fields it writes as a list of
  text, in that order, the codec's (caps README; Core's `patchCall` vector). No other key, no default: a call that
  differs is refused (`none`). A call's values are no params: they are in the envelope's changes, which must fit the
  lowered steps.
- **A remove writes no field:** its `fields` is empty, or the call is refused, so a remove step never lets a change
  write a field.
- **Read, tell, keep and share lower to no step** (`CoreOp.writes`), whatever their params.
- **A `put` lowers to `put-new`, never `put-replace`.** The engine's `put` always makes a Record under a new id, made
  from the writer, its counter and the op's place (`created_distinct`, `ids_differ_across`), so it never meets a
  Record that was there. Changing a Record that was there is a patch or an edit. `core/1` has no op that replaces a
  Record whole, so no call lowers to `put-replace`.
- **A committer's ops name their calls:** a typed mutation's op (`Engine.Op`, with its values) names the call
  `Op.call`, and that call lowers to exactly the op's own footprint step (`lower_call`). So what the committer ran, what
  the envelope names and what every reader lowers it to agree.

Caps' reader takes the lowering as a parameter (`Aven.ID.Authorized`), so caps never depends on the engine's internals.
-/

namespace Aven.DB.Engine

open Aven.Core

private def k (s : String) : Bytes := s.toUTF8.toList

/-- `core/1`'s eight ops. -/
def coreOps : List CoreOp := [.read, .put, .patch, .remove, .edit, .tell, .keep, .share]

/-- The `core/1` op an id names, if any. -/
def coreOp? (H : Bytes → Hash) (id : OpId) : Option CoreOp := coreOps.find? (·.id H == id)

/-- A write's step verb; `none` for the ops that write nothing. -/
def coreVerb? : CoreOp → Option StepVerb
  | .put => some .putNew
  | .patch => some .patch
  | .remove => some .remove
  | .edit => some .edit
  | .read | .tell | .keep | .share => none

theorem coreVerb?_writes (o : CoreOp) : (coreVerb? o).isSome = o.writes := by
  cases o <;> rfl

def textOf : Value → Option Bytes
  | .text b => some b
  | _ => none

/-- A write's params read back: exactly `type`, 32 bytes, then `fields`, a list of text. -/
def writeParams : List (Bytes × Value) → Option (DocId × List Bytes)
  | [(t, .bytes ty), (f, .array fs)] =>
    if t = k "type" ∧ f = k "fields" ∧ ty.length = 32 then
      (fs.mapM textOf).map fun names => (⟨⟨ty⟩⟩, names)
    else none
  | _ => none

/-- `core/1`'s lowering: a call's steps, or `none` when the call isn't `core/1`'s or its params aren't as its op
takes them. -/
def lowerCore (H : Bytes → Hash) (c : Call) : Option (List Step) := do
  let o ← coreOp? H c.op
  match coreVerb? o with
  | none => pure []
  | some v =>
    let (ty, fs) ← writeParams c.params
    if v = StepVerb.remove ∧ fs ≠ [] then none else pure [⟨ty, v, fs⟩]

/-- A lowering never yields `put-replace`. -/
theorem lowerCore_no_replace (H : Bytes → Hash) (c : Call) (sts : List Step) (h : lowerCore H c = some sts) :
    ∀ st ∈ sts, st.verb ≠ .putReplace := by
  intro st hst
  simp only [lowerCore, Option.bind_eq_bind, Option.bind_eq_some_iff] at h
  obtain ⟨o, _, h⟩ := h
  cases hv : coreVerb? o with
  | none => rw [hv] at h; simp at h; subst h; simp at hst
  | some v =>
    rw [hv] at h
    simp only [Option.bind_eq_some_iff] at h
    obtain ⟨⟨ty, fs⟩, _, h⟩ := h
    split at h
    · cases h
    · simp only [Option.pure_def, Option.some.injEq] at h
      subst h
      simp only [List.mem_singleton] at hst
      subst hst
      cases o <;> simp [coreVerb?] at hv <;> (subst hv; simp)

/-! ## A committer's ops and their calls -/

variable {Val : Type}

/-- The `core/1` op an engine op is. -/
def Op.core : Op Val → CoreOp
  | .put .. => .put
  | .patch .. => .patch
  | .remove .. => .remove
  | .edit .. => .edit

/-- The call an op names: its `core/1` op, and its step's type and fields. -/
def Op.call (H : Bytes → Hash) (o : Op Val) : Call :=
  ⟨o.core.id H, [(k "type", .bytes o.step.type.hash.bytes), (k "fields", .array (o.step.fields.map .text))]⟩

theorem mapM_textOf (fs : List Bytes) : fs.mapM (textOf ∘ Value.text) = some fs := by
  induction fs with
  | nil => rfl
  | cons f fs ih => simp [List.mapM_cons, textOf, ih]

/-- Where `core/1`'s ids are distinct, each names its op. -/
theorem coreOp?_id (H : Bytes → Hash) (hH : ∀ a b : CoreOp, a.id H = b.id H → a = b) (o : CoreOp) :
    coreOp? H (o.id H) = some o := by
  have key : ∀ a : CoreOp, (a.id H == o.id H) = decide (a = o) := by
    intro a
    by_cases h : a = o
    · subst h; simp
    · have : a.id H ≠ o.id H := fun e => h (hH _ _ e)
      simp [h, this]
  cases o <;> simp [coreOp?, coreOps, key]

/-- **An op's call lowers to its own step**, where `core/1`'s ids are distinct and the type is a 32-byte hash. -/
theorem lower_call (H : Bytes → Hash) (hH : ∀ a b : CoreOp, a.id H = b.id H → a = b) (o : Op Val)
    (hty : o.step.type.hash.bytes.length = 32) : lowerCore H (o.call H) = some [o.step] := by
  have hw : writeParams (o.call H).params = some (o.step.type, o.step.fields) := by
    simp [Op.call, writeParams, hty, mapM_textOf]
  cases o <;> simp_all [lowerCore, Op.call, coreOp?_id H hH, Op.core, coreVerb?, Op.step]

/-- **A commit's calls lower to its footprint**, op by op. -/
theorem lower_calls (H : Bytes → Hash) (hH : ∀ a b : CoreOp, a.id H = b.id H → a = b) (ops : List (Op Val))
    (hty : ∀ o ∈ ops, o.step.type.hash.bytes.length = 32) :
    ops.mapM (fun o => lowerCore H (o.call H)) = some ((footprint ops).map fun st => [st]) := by
  induction ops with
  | nil => rfl
  | cons o ops ih =>
    simp only [List.mapM_cons, footprint, List.map_cons]
    rw [lower_call H hH o (hty o List.mem_cons_self), ih (fun o' h => hty o' (List.mem_cons_of_mem _ h))]
    rfl

end Aven.DB.Engine
