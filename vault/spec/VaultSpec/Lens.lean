/-!
# Schemas and lenses

The two examples, each in two schema versions, and the two-way lens between them (T9).

- Markdown documents: v1 blocks have a `kind` (h1, h2, h3, p, li, code); v2 blocks have a `type` with a heading
  `level`, items can be `checked`, code can name its `lang`, and the document gains `tags`.
- Todos: v1 has `done`; v2 has `status` (open, doing, done).
-/

namespace VaultSpec.Lens

/-! ## Markdown documents -/

inductive KindV1 where
  | h1 | h2 | h3 | p | li | code
  deriving DecidableEq, Repr

structure BlockV1 where
  id   : Nat
  kind : KindV1
  text : String
  deriving DecidableEq, Repr

structure DocV1 where
  title  : String
  blocks : List BlockV1
  deriving DecidableEq, Repr

inductive TypeV2 where
  | heading | paragraph | item | code
  deriving DecidableEq, Repr

structure BlockV2 where
  id      : Nat
  type    : TypeV2
  level   : Option Nat
  checked : Option Bool
  lang    : Option String
  text    : String
  deriving DecidableEq, Repr

structure DocV2 where
  title  : String
  blocks : List BlockV2
  tags   : List String
  deriving DecidableEq, Repr

def BlockV1.fwd (b : BlockV1) : BlockV2 :=
  let (type, level) : TypeV2 × Option Nat := match b.kind with
    | .h1 => (.heading, some 1)
    | .h2 => (.heading, some 2)
    | .h3 => (.heading, some 3)
    | .p => (.paragraph, none)
    | .li => (.item, none)
    | .code => (.code, none)
  { id := b.id, type := type, level := level, checked := none, lang := none, text := b.text }

def BlockV2.bwd (b : BlockV2) : BlockV1 :=
  let kind : KindV1 := match b.type, b.level with
    | .heading, some 1 => .h1
    | .heading, some 2 => .h2
    | .heading, _      => .h3
    | .paragraph, _    => .p
    | .item, _         => .li
    | .code, _         => .code
  { id := b.id, kind := kind, text := b.text }

def DocV1.fwd (d : DocV1) : DocV2 := { title := d.title, blocks := d.blocks.map BlockV1.fwd, tags := [] }
def DocV2.bwd (d : DocV2) : DocV1 := { title := d.title, blocks := d.blocks.map BlockV2.bwd }

/-- A block the v2 schema accepts. -/
def BlockV2.valid (b : BlockV2) : Prop :=
  (b.type = .heading → b.level = some 1 ∨ b.level = some 2 ∨ b.level = some 3) ∧
  (b.type ≠ .heading → b.level = none) ∧
  (b.type ≠ .item → b.checked = none) ∧
  (b.type ≠ .code → b.lang = none)

/-- A block using nothing v1 can't say. -/
def BlockV2.v1Only (b : BlockV2) : Prop := b.checked = none ∧ b.lang = none

def DocV2.valid (d : DocV2) : Prop := ∀ b ∈ d.blocks, b.valid
def DocV2.v1Only (d : DocV2) : Prop := d.tags = [] ∧ ∀ b ∈ d.blocks, b.v1Only

theorem BlockV1.bwd_fwd (b : BlockV1) : b.fwd.bwd = b := by
  cases b with
  | mk id kind text => cases kind <;> rfl

theorem BlockV2.fwd_bwd (b : BlockV2) (hv : b.valid) (h1 : b.v1Only) : b.bwd.fwd = b := by
  obtain ⟨hl, hn, _, _⟩ := hv
  obtain ⟨hc, hlang⟩ := h1
  cases b with
  | mk id type level checked lang text =>
    simp only at hl hn hc hlang
    subst hc hlang
    cases type with
    | heading =>
      rcases hl rfl with h | h | h <;> subst h <;> rfl
    | paragraph => rw [hn (by decide)]; rfl
    | item => rw [hn (by decide)]; rfl
    | code => rw [hn (by decide)]; rfl

/-- T9a: v1 → v2 → v1 returns the same document. -/
theorem T9_doc_round_trip (d : DocV1) : d.fwd.bwd = d := by
  cases d with
  | mk title blocks =>
    simp only [DocV1.fwd, DocV2.bwd, List.map_map]
    congr 1
    induction blocks with
    | nil => rfl
    | cons b bs ih => simp only [List.map_cons, Function.comp, BlockV1.bwd_fwd, ih]

/-- T9b: v2 → v1 → v2 returns the same document when it uses nothing v1 can't say. -/
theorem T9_doc_round_trip_v2 (d : DocV2) (hv : d.valid) (h1 : d.v1Only) : d.bwd.fwd = d := by
  cases d with
  | mk title blocks tags =>
    obtain ⟨ht, hb⟩ := h1
    simp only at ht hb hv
    subst ht
    simp only [DocV2.bwd, DocV1.fwd, List.map_map]
    congr 1
    induction blocks with
    | nil => rfl
    | cons b bs ih =>
      simp only [List.map_cons, Function.comp]
      rw [BlockV2.fwd_bwd b (hv b (List.mem_cons_self ..)) (hb b (List.mem_cons_self ..))]
      rw [ih (fun x hx => hb x (List.mem_cons_of_mem _ hx)) (fun x hx => hv x (List.mem_cons_of_mem _ hx))]

/-- A block as stored after concurrent edits: still v1-shaped (from an offline v1 app) or already v2. -/
inductive AnyBlock where
  | v1 (b : BlockV1)
  | v2 (b : BlockV2)
  deriving DecidableEq, Repr

def AnyBlock.migrate : AnyBlock → AnyBlock
  | .v1 b => .v2 b.fwd
  | .v2 b => .v2 b

/-- The migration commit: every block in v2 shape. -/
def migrate (bs : List AnyBlock) : List AnyBlock := bs.map AnyBlock.migrate

/-- T9c: migrating twice equals migrating once, so stragglers can be migrated by any later commit. -/
theorem T9_migrate_idem (bs : List AnyBlock) : migrate (migrate bs) = migrate bs := by
  induction bs with
  | nil => rfl
  | cons b bs ih =>
    simp only [migrate, List.map_cons] at *
    rw [ih]
    cases b <;> rfl

/-! ## Todos -/

inductive Status where
  | «open» | doing | done
  deriving DecidableEq, Repr

structure TodoV1 where
  title : String
  done  : Bool
  notes : String
  due   : Option String
  deriving DecidableEq, Repr

structure TodoV2 where
  title  : String
  status : Status
  notes  : String
  due    : Option String
  deriving DecidableEq, Repr

def TodoV1.fwd (t : TodoV1) : TodoV2 :=
  { title := t.title, status := if t.done then .done else .«open», notes := t.notes, due := t.due }

/-- Going back, a todo in progress shows as not done. -/
def TodoV2.bwd (t : TodoV2) : TodoV1 :=
  { title := t.title, done := t.status == .done, notes := t.notes, due := t.due }

/-- T9d: v1 → v2 → v1 returns the same todo. -/
theorem T9_todo_round_trip (t : TodoV1) : t.fwd.bwd = t := by
  cases t with
  | mk title done notes due => cases done <;> rfl

/-- T9e: v2 → v1 → v2 returns the same todo unless it was in progress, which v1 can't say. -/
theorem T9_todo_round_trip_v2 (t : TodoV2) (h : t.status ≠ .doing) : t.bwd.fwd = t := by
  cases t with
  | mk title status notes due =>
    cases status with
    | «open» => rfl
    | doing => exact absurd rfl h
    | done => rfl

end VaultSpec.Lens
