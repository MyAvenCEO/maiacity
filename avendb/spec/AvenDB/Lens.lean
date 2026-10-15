/-!
# Schemas and lenses

The two examples, each in two schema versions, and the two-way lens between them (T9). The v1 schemas are the ones
avenDB ships; the v0 schemas and the lenses are the lens engine's worked example, which only the tests use.

- Markdown documents: v0 blocks have a `kind` (h1, h2, h3, p, li, code); v1 blocks have a `type` with a heading
  `level`, items can be `checked`, code can name its `lang`, and the document gains `tags`.
- Todos: v0 has `done`; v1 has `status` (open, doing, done).

Nothing is migrated by an edit: two devices migrating at once could each drop the other's new containers, and a
default that a migration writes races a real edit. An item is stored as it was written instead, each field in the
representation of the schema it was written under: v0's, v1's, or after concurrent edits both, where v1's wins (it is
the newer one). Each app projects the item on read, through the lens, into its own schema (`v0`, `v1`), so defaults
live in the lens and are never written. An app's edit goes back through its view (`putV0`, `putV1`): it writes only
what changed, in its own representation, so what an older app can't see survives its edits.
-/

namespace AvenDB.Lens

/-! ## Markdown documents -/

inductive KindV0 where
  | h1 | h2 | h3 | p | li | code
  deriving DecidableEq, Repr

structure BlockV0 where
  id   : Nat
  kind : KindV0
  text : String
  deriving DecidableEq, Repr

structure DocV0 where
  title  : String
  blocks : List BlockV0
  deriving DecidableEq, Repr

inductive TypeV1 where
  | heading | paragraph | item | code
  deriving DecidableEq, Repr

structure BlockV1 where
  id      : Nat
  type    : TypeV1
  level   : Option Nat
  checked : Option Bool
  lang    : Option String
  text    : String
  deriving DecidableEq, Repr

structure DocV1 where
  title  : String
  blocks : List BlockV1
  tags   : List String
  deriving DecidableEq, Repr

def BlockV0.fwd (b : BlockV0) : BlockV1 :=
  let (type, level) : TypeV1 × Option Nat := match b.kind with
    | .h1 => (.heading, some 1)
    | .h2 => (.heading, some 2)
    | .h3 => (.heading, some 3)
    | .p => (.paragraph, none)
    | .li => (.item, none)
    | .code => (.code, none)
  { id := b.id, type := type, level := level, checked := none, lang := none, text := b.text }

def BlockV1.bwd (b : BlockV1) : BlockV0 :=
  let kind : KindV0 := match b.type, b.level with
    | .heading, some 1 => .h1
    | .heading, some 2 => .h2
    | .heading, _      => .h3
    | .paragraph, _    => .p
    | .item, _         => .li
    | .code, _         => .code
  { id := b.id, kind := kind, text := b.text }

def DocV0.fwd (d : DocV0) : DocV1 := { title := d.title, blocks := d.blocks.map BlockV0.fwd, tags := [] }
def DocV1.bwd (d : DocV1) : DocV0 := { title := d.title, blocks := d.blocks.map BlockV1.bwd }

/-- A block the v1 schema accepts. -/
def BlockV1.valid (b : BlockV1) : Prop :=
  (b.type = .heading → b.level = some 1 ∨ b.level = some 2 ∨ b.level = some 3) ∧
  (b.type ≠ .heading → b.level = none) ∧
  (b.type ≠ .item → b.checked = none) ∧
  (b.type ≠ .code → b.lang = none)

/-- A block using nothing v0 can't say. -/
def BlockV1.v0Only (b : BlockV1) : Prop := b.checked = none ∧ b.lang = none

def DocV1.valid (d : DocV1) : Prop := ∀ b ∈ d.blocks, b.valid
def DocV1.v0Only (d : DocV1) : Prop := d.tags = [] ∧ ∀ b ∈ d.blocks, b.v0Only

theorem BlockV0.bwd_fwd (b : BlockV0) : b.fwd.bwd = b := by
  cases b with
  | mk id kind text => cases kind <;> rfl

theorem BlockV1.fwd_bwd (b : BlockV1) (hv : b.valid) (h1 : b.v0Only) : b.bwd.fwd = b := by
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

/-- T9a: v0 → v1 → v0 returns the same document. -/
theorem T9_doc_round_trip (d : DocV0) : d.fwd.bwd = d := by
  cases d with
  | mk title blocks =>
    simp only [DocV0.fwd, DocV1.bwd, List.map_map]
    congr 1
    induction blocks with
    | nil => rfl
    | cons b bs ih => simp only [List.map_cons, Function.comp, BlockV0.bwd_fwd, ih]

/-- T9b: v1 → v0 → v1 returns the same document when it uses nothing v0 can't say. -/
theorem T9_doc_round_trip_v1 (d : DocV1) (hv : d.valid) (h1 : d.v0Only) : d.bwd.fwd = d := by
  cases d with
  | mk title blocks tags =>
    obtain ⟨ht, hb⟩ := h1
    simp only at ht hb hv
    subst ht
    simp only [DocV1.bwd, DocV0.fwd, List.map_map]
    congr 1
    induction blocks with
    | nil => rfl
    | cons b bs ih =>
      simp only [List.map_cons, Function.comp]
      rw [BlockV1.fwd_bwd b (hv b (List.mem_cons_self ..)) (hb b (List.mem_cons_self ..))]
      rw [ih (fun x hx => hb x (List.mem_cons_of_mem _ hx)) (fun x hx => hv x (List.mem_cons_of_mem _ hx))]

/-! ## Todos -/

inductive Status where
  | «open» | doing | done
  deriving DecidableEq, Repr

structure TodoV0 where
  title : String
  done  : Bool
  notes : String
  due   : Option String
  deriving DecidableEq, Repr

structure TodoV1 where
  title  : String
  status : Status
  notes  : String
  due    : Option String
  deriving DecidableEq, Repr

def TodoV0.fwd (t : TodoV0) : TodoV1 :=
  { title := t.title, status := if t.done then .done else .«open», notes := t.notes, due := t.due }

/-- Going back, a todo in progress shows as not done. -/
def TodoV1.bwd (t : TodoV1) : TodoV0 :=
  { title := t.title, done := t.status == .done, notes := t.notes, due := t.due }

/-- T9d: v0 → v1 → v0 returns the same todo. -/
theorem T9_todo_round_trip (t : TodoV0) : t.fwd.bwd = t := by
  cases t with
  | mk title done notes due => cases done <;> rfl

/-- T9e: v1 → v0 → v1 returns the same todo unless it was in progress, which v0 can't say. -/
theorem T9_todo_round_trip_v1 (t : TodoV1) (h : t.status ≠ .doing) : t.bwd.fwd = t := by
  cases t with
  | mk title status notes due =>
    cases status with
    | «open» => rfl
    | doing => exact absurd rfl h
    | done => rfl

/-! ## Items as stored, projected on read -/

/-- A block as stored: v0's field (`kind`), v1's fields in its place (`type`, and `level` for a heading), or after
    concurrent edits both; and what only v1 can say (`checked`, `lang`). A field that isn't stored is `none`. -/
structure StoredBlock where
  id      : Nat
  text    : String
  kind    : Option KindV0 := none
  type    : Option TypeV1 := none
  level   : Option Nat := none
  checked : Option Bool := none
  lang    : Option String := none
  deriving DecidableEq, Repr

/-- The block holds v1's representation, which wins over `kind`. -/
def StoredBlock.hasV1 (b : StoredBlock) : Bool := b.type.isSome || b.level.isSome

/-- v0's representation as stored; `none` without a `kind`. -/
def StoredBlock.asV0 (b : StoredBlock) : Option BlockV0 := b.kind.map fun k => ⟨b.id, k, b.text⟩

/-- v1's representation as stored; `none` without a `type`. -/
def StoredBlock.asV1 (b : StoredBlock) : Option BlockV1 :=
  b.type.map fun t => ⟨b.id, t, b.level, b.checked, b.lang, b.text⟩

/-- The block as a v1 app reads it: v1's representation, else `kind` through the lens; `none` when it has no type to
    read. -/
def StoredBlock.v1 (b : StoredBlock) : Option BlockV1 :=
  if b.hasV1 then b.asV1 else b.asV0.map fun x => { x.fwd with checked := b.checked, lang := b.lang }

/-- The block as a v0 app reads it: v1's representation through the lens, else `kind`; `none` when it has no kind
    to read. -/
def StoredBlock.v0 (b : StoredBlock) : Option BlockV0 :=
  if b.hasV1 then b.asV1.map BlockV1.bwd else b.asV0

/-- A v0 app's edit: the block now reads `nb` in its view. The text, and the kind only if it changed: as v1's fields
    when the block holds them, else as `kind`. `checked` and `lang` are never touched. -/
def StoredBlock.putV0 (b : StoredBlock) (nb : BlockV0) : StoredBlock :=
  let b' := { b with text := nb.text }
  if b.v0.map (·.kind) = some nb.kind then b'
  else if b.hasV1 then { b' with type := some nb.fwd.type, level := nb.fwd.level }
  else { b' with kind := some nb.kind }

/-- A v1 app's edit: the block now reads `nb` in its view. The text, `checked` and `lang`, and the type and level
    only if they changed, as v1's fields: `kind` goes, since v1's representation now holds the field. -/
def StoredBlock.putV1 (b : StoredBlock) (nb : BlockV1) : StoredBlock :=
  let b' := { b with text := nb.text, checked := nb.checked, lang := nb.lang }
  if b.v1.map (fun x => (x.type, x.level)) = some (nb.type, nb.level) then b'
  else { b' with kind := none, type := some nb.type, level := nb.level }

/-- A todo as stored: v0's `done`, v1's `status` in its place, or after concurrent edits both. -/
structure StoredTodo where
  title  : String
  notes  : String
  due    : Option String := none
  done   : Option Bool := none
  status : Option Status := none
  deriving DecidableEq, Repr

/-- The todo holds v1's representation, which wins over `done`. -/
def StoredTodo.hasV1 (t : StoredTodo) : Bool := t.status.isSome

/-- The todo as a v0 app reads it: the status through the lens, else `done`, else not done (v0's default, which is
    never written). -/
def StoredTodo.v0 (t : StoredTodo) : TodoV0 :=
  match t.status with
  | some s => TodoV1.bwd ⟨t.title, s, t.notes, t.due⟩
  | none => ⟨t.title, t.done.getD false, t.notes, t.due⟩

/-- The todo as a v1 app reads it: the status, else `done` through the lens, else open (v1's default, which is never
    written). -/
def StoredTodo.v1 (t : StoredTodo) : TodoV1 :=
  match t.status, t.done with
  | some s, _ => ⟨t.title, s, t.notes, t.due⟩
  | none, some d => TodoV0.fwd ⟨t.title, d, t.notes, t.due⟩
  | none, none => ⟨t.title, .«open», t.notes, t.due⟩

/-- A v0 app's edit: the todo now reads `n` in its view. The title, notes and due date, and `done` only if it
    changed: as the status when the todo holds one, else as `done`. -/
def StoredTodo.putV0 (t : StoredTodo) (n : TodoV0) : StoredTodo :=
  let t' := { t with title := n.title, notes := n.notes, due := n.due }
  if t.v0.done = n.done then t'
  else if t.hasV1 then { t' with status := some n.fwd.status }
  else { t' with done := some n.done }

/-- A v1 app's edit: the todo now reads `n` in its view. The title, notes and due date, and the status only if it
    changed: `done` goes, since v1's representation now holds the field. -/
def StoredTodo.putV1 (t : StoredTodo) (n : TodoV1) : StoredTodo :=
  let t' := { t with title := n.title, notes := n.notes, due := n.due }
  if t.v1.status = n.status then t' else { t' with status := some n.status, done := none }

/-- A document as stored: its title, its blocks, and v1's tags (none stored reads as none). -/
structure StoredDoc where
  title  : String
  blocks : List StoredBlock
  tags   : List String := []
  deriving DecidableEq, Repr

/-- The document as a v0 app reads it: the blocks it can read. -/
def StoredDoc.v0 (d : StoredDoc) : DocV0 := ⟨d.title, d.blocks.filterMap StoredBlock.v0⟩

/-- The document as a v1 app reads it: the blocks it can read, and the tags. -/
def StoredDoc.v1 (d : StoredDoc) : DocV1 := ⟨d.title, d.blocks.filterMap StoredBlock.v1, d.tags⟩

/-- A v0 app's edit: the document now reads `n` in its view. Each stored block `n` holds (by id) goes through its
    view; the other blocks and the tags stay as they are. Only edits in place: inserting, deleting and moving blocks
    are tested in Rust. -/
def StoredDoc.putV0 (d : StoredDoc) (n : DocV0) : StoredDoc :=
  { d with title := n.title, blocks := d.blocks.map fun b =>
      match n.blocks.find? (·.id == b.id) with
      | some nb => b.putV0 nb
      | none => b }

/-- A v1 app's edit: the document now reads `n` in its view, tags included. Each stored block `n` holds (by id) goes
    through its view; the other blocks stay as they are. -/
def StoredDoc.putV1 (d : StoredDoc) (n : DocV1) : StoredDoc :=
  { d with title := n.title, tags := n.tags, blocks := d.blocks.map fun b =>
      match n.blocks.find? (·.id == b.id) with
      | some nb => b.putV1 nb
      | none => b }

/-! ## The lens laws on stored items

First what each view reads, then the laws: both apps see the same item (T9c), an edit shows exactly as made (T9f,
PutGet), an unchanged view writes nothing (T9g, GetPut), and an older app's edit keeps what it can't see (T9h). -/

/-- Going back, the lens reads neither `checked` nor `lang`. -/
theorem BlockV1.bwd_checked_lang (x : BlockV1) (c : Option Bool) (l : Option String) :
    { x with checked := c, lang := l }.bwd = x.bwd := rfl

/-- A v0 view has its block's id and text. -/
theorem StoredBlock.v0_some {b : StoredBlock} {x : BlockV0} (h : b.v0 = some x) : x.id = b.id ∧ x.text = b.text := by
  rcases b with ⟨id, text, kind, type, level, checked, lang⟩
  unfold StoredBlock.v0 StoredBlock.asV0 StoredBlock.asV1 at h
  split at h
  · cases type with
    | none => cases h
    | some t => cases h; exact ⟨rfl, rfl⟩
  · cases kind with
    | none => cases h
    | some k => cases h; exact ⟨rfl, rfl⟩

/-- Writing the text changes only the text of the v0 view. -/
theorem StoredBlock.v0_text (b : StoredBlock) (s : String) :
    ({ b with text := s } : StoredBlock).v0 = b.v0.map fun x => { x with text := s } := by
  rcases b with ⟨id, text, kind, type, level, checked, lang⟩
  unfold StoredBlock.v0 StoredBlock.asV0 StoredBlock.asV1 StoredBlock.hasV1
  dsimp only
  split <;> (cases type <;> cases kind <;> rfl)

/-- A v1 view has its block's id, text, `checked` and `lang`. -/
theorem StoredBlock.v1_some {b : StoredBlock} {x : BlockV1} (h : b.v1 = some x) :
    x.id = b.id ∧ x.text = b.text ∧ x.checked = b.checked ∧ x.lang = b.lang := by
  rcases b with ⟨id, text, kind, type, level, checked, lang⟩
  unfold StoredBlock.v1 StoredBlock.asV0 StoredBlock.asV1 at h
  split at h
  · cases type with
    | none => cases h
    | some t => cases h; exact ⟨rfl, rfl, rfl, rfl⟩
  · cases kind with
    | none => cases h
    | some k => cases h; cases k <;> exact ⟨rfl, rfl, rfl, rfl⟩

/-- Writing the text, `checked` and `lang` changes only those of the v1 view. -/
theorem StoredBlock.v1_update (b : StoredBlock) (s : String) (c : Option Bool) (l : Option String) :
    ({ b with text := s, checked := c, lang := l } : StoredBlock).v1 =
      b.v1.map fun x => { x with text := s, checked := c, lang := l } := by
  rcases b with ⟨id, text, kind, type, level, checked, lang⟩
  unfold StoredBlock.v1 StoredBlock.asV0 StoredBlock.asV1 StoredBlock.hasV1
  dsimp only
  split
  · cases type <;> rfl
  · cases kind with
    | none => rfl
    | some k => cases k <;> rfl

/-- Among the views of a list whose ids are distinct, a member's id finds that member's view, if it has one. -/
theorem find?_filterMap_id {α β : Type} (f : α → Option β) (ida : α → Nat) (idb : β → Nat)
    (hf : ∀ a x, f a = some x → idb x = ida a) :
    ∀ (l : List α), (l.map ida).Nodup → ∀ a ∈ l, (l.filterMap f).find? (fun x => idb x == ida a) = f a
  | [], _, _, ha => by cases ha
  | c :: l, hnd, a, ha => by
    rw [List.map_cons, List.nodup_cons] at hnd
    obtain ⟨hc, hnd⟩ := hnd
    have ih := find?_filterMap_id f ida idb hf l hnd
    -- no view of the rest has the head's id
    have hrest : ∀ x ∈ l.filterMap f, idb x ≠ ida c := fun x hx he => by
      obtain ⟨e, he', hex⟩ := List.mem_filterMap.1 hx
      exact hc (List.mem_map.2 ⟨e, he', (hf e x hex).symm.trans he⟩)
    rcases List.mem_cons.1 ha with rfl | ha
    · cases hfa : f a with
      | none =>
        rw [List.filterMap_cons, hfa]
        exact List.find?_eq_none.2 fun x hx hxe => hrest x hx (by simpa using hxe)
      | some x => rw [List.filterMap_cons, hfa, List.find?_cons, hf a x hfa]; simp
    · have hne : ida c ≠ ida a := fun he => hc (he ▸ List.mem_map.2 ⟨a, ha, rfl⟩)
      cases hfc : f c with
      | none => rw [List.filterMap_cons, hfc]; exact ih a ha
      | some x => rw [List.filterMap_cons, hfc, List.find?_cons, hf c x hfc, ih a ha, beq_false_of_ne hne]

/-- T9c: a v0 app and a v1 app see the same block: the v0 view is the v1 view through the lens. -/
theorem T9_block_views_agree (b : StoredBlock) : b.v0 = b.v1.map BlockV1.bwd := by
  unfold StoredBlock.v0 StoredBlock.v1
  split
  · rfl
  · cases b.asV0 with
    | none => rfl
    | some x => simp only [Option.map_some, BlockV1.bwd_checked_lang, BlockV0.bwd_fwd]

/-- T9c: a v0 app and a v1 app see the same todo. -/
theorem T9_todo_views_agree (t : StoredTodo) : t.v0 = t.v1.bwd := by
  rcases t with ⟨title, notes, due, done, status⟩
  rcases status with _ | (_ | _ | _) <;> rcases done with _ | (_ | _) <;> rfl

/-- T9c: a v0 app and a v1 app see the same document. -/
theorem T9_doc_views_agree (d : StoredDoc) : d.v0 = d.v1.bwd := by
  simp only [StoredDoc.v0, StoredDoc.v1, DocV1.bwd, List.map_filterMap, DocV0.mk.injEq, true_and]
  congr 1
  funext b
  exact T9_block_views_agree b

/-- T9f: a v0 app's edit of a block shows exactly as made, even on a block it couldn't read before. -/
theorem T9_block_put_get_v0 (b : StoredBlock) (nb : BlockV0) (h : nb.id = b.id) : (b.putV0 nb).v0 = some nb := by
  unfold StoredBlock.putV0
  dsimp only
  split
  · -- the kind is as the app saw it: only the text is written
    rename_i hk
    obtain ⟨x, hx, hxk⟩ := Option.map_eq_some_iff.1 hk
    rw [StoredBlock.v0_text, hx]
    have hid := (StoredBlock.v0_some hx).1
    rcases x with ⟨xid, xk, xt⟩
    rcases nb with ⟨nid, nk, nt⟩
    simp_all
  · split
    · -- the new kind as v1's fields
      rcases nb with ⟨nid, nk, nt⟩
      simp only at h
      subst h
      cases nk <;> rfl
    · -- the new kind as `kind`, where v1's fields aren't stored
      rename_i hv1
      rcases b with ⟨id, text, kind, type, level, checked, lang⟩
      rcases nb with ⟨nid, nk, nt⟩
      simp only at h
      subst h
      simp only [StoredBlock.hasV1, Bool.or_eq_true, Option.isSome_iff_ne_none, ne_eq, not_or,
        Decidable.not_not] at hv1
      obtain ⟨rfl, rfl⟩ := hv1
      rfl

/-- T9f: a v1 app's edit of a block shows exactly as made. -/
theorem T9_block_put_get_v1 (b : StoredBlock) (nb : BlockV1) (h : nb.id = b.id) : (b.putV1 nb).v1 = some nb := by
  unfold StoredBlock.putV1
  dsimp only
  split
  · -- the type and level are as the app saw them: they aren't written
    rename_i hk
    obtain ⟨x, hx, hxk⟩ := Option.map_eq_some_iff.1 hk
    rw [StoredBlock.v1_update, hx]
    have hid := (StoredBlock.v1_some hx).1
    rcases x with ⟨xid, xt, xl, xc, xlang, xtext⟩
    rcases nb with ⟨nid, nt, nl, nc, nlang, ntext⟩
    simp only [Prod.mk.injEq] at hxk
    simp_all
  · rcases nb with ⟨nid, nt, nl, nc, nlang, ntext⟩
    simp only at h
    subst h
    rfl

/-- T9f: a v0 app's edit of a todo shows exactly as made. -/
theorem T9_todo_put_get_v0 (t : StoredTodo) (n : TodoV0) : (t.putV0 n).v0 = n := by
  rcases t with ⟨title, notes, due, done, status⟩
  rcases n with ⟨ntitle, ndone, nnotes, ndue⟩
  rcases status with _ | (_ | _ | _) <;> rcases done with _ | (_ | _) <;> cases ndone <;> rfl

/-- T9f: a v1 app's edit of a todo shows exactly as made. -/
theorem T9_todo_put_get_v1 (t : StoredTodo) (n : TodoV1) : (t.putV1 n).v1 = n := by
  rcases t with ⟨title, notes, due, done, status⟩
  rcases n with ⟨ntitle, nstatus, nnotes, ndue⟩
  rcases status with _ | (_ | _ | _) <;> rcases done with _ | (_ | _) <;> cases nstatus <;> rfl

/-- T9g: putting back the v0 view of a block unchanged writes nothing. -/
theorem T9_block_get_put_v0 (b : StoredBlock) (v : BlockV0) (h : b.v0 = some v) : b.putV0 v = b := by
  unfold StoredBlock.putV0
  rw [h, (StoredBlock.v0_some h).2]
  simp

/-- T9g: putting back the v1 view of a block unchanged writes nothing. -/
theorem T9_block_get_put_v1 (b : StoredBlock) (v : BlockV1) (h : b.v1 = some v) : b.putV1 v = b := by
  unfold StoredBlock.putV1
  obtain ⟨-, ht, hc, hl⟩ := StoredBlock.v1_some h
  rw [h, ht, hc, hl]
  simp

/-- T9g: putting back the v0 view of a todo unchanged writes nothing, not even v0's default for `done`. -/
theorem T9_todo_get_put_v0 (t : StoredTodo) : t.putV0 t.v0 = t := by
  rcases t with ⟨title, notes, due, done, status⟩
  rcases status with _ | (_ | _ | _) <;> rcases done with _ | (_ | _) <;> rfl

/-- T9g: putting back the v1 view of a todo unchanged writes nothing, not even v1's default status. -/
theorem T9_todo_get_put_v1 (t : StoredTodo) : t.putV1 t.v1 = t := by
  rcases t with ⟨title, notes, due, done, status⟩
  rcases status with _ | (_ | _ | _) <;> rcases done with _ | (_ | _) <;> rfl

/-- T9g: putting back the v0 view of a document whose block ids are distinct unchanged writes nothing. -/
theorem T9_doc_get_put_v0 (d : StoredDoc) (h : (d.blocks.map (·.id)).Nodup) : d.putV0 d.v0 = d := by
  rcases d with ⟨title, blocks, tags⟩
  simp only [StoredDoc.putV0, StoredDoc.v0, StoredDoc.mk.injEq, true_and, and_true]
  conv => rhs; rw [← List.map_id blocks]
  refine List.map_congr_left fun b hb => ?_
  rw [find?_filterMap_id StoredBlock.v0 (·.id) (·.id) (fun _ _ hx => (StoredBlock.v0_some hx).1) blocks h b hb]
  cases hv : b.v0 with
  | none => rfl
  | some v => exact T9_block_get_put_v0 b v hv

/-- T9g: putting back the v1 view of a document whose block ids are distinct unchanged writes nothing. -/
theorem T9_doc_get_put_v1 (d : StoredDoc) (h : (d.blocks.map (·.id)).Nodup) : d.putV1 d.v1 = d := by
  rcases d with ⟨title, blocks, tags⟩
  simp only [StoredDoc.putV1, StoredDoc.v1, StoredDoc.mk.injEq, true_and, and_true]
  conv => rhs; rw [← List.map_id blocks]
  refine List.map_congr_left fun b hb => ?_
  rw [find?_filterMap_id StoredBlock.v1 (·.id) (·.id) (fun _ _ hx => (StoredBlock.v1_some hx).1) blocks h b hb]
  cases hv : b.v1 with
  | none => rfl
  | some v => exact T9_block_get_put_v1 b v hv

/-- T9h: a v0 app's edit of a block keeps whether it is checked and its code's language. -/
theorem T9_block_put_v0_keeps (b : StoredBlock) (nb : BlockV0) :
    (b.putV0 nb).checked = b.checked ∧ (b.putV0 nb).lang = b.lang := by
  unfold StoredBlock.putV0
  dsimp only
  split
  · exact ⟨rfl, rfl⟩
  · split <;> exact ⟨rfl, rfl⟩

/-- T9h: a v0 app's edit of a document keeps its tags. -/
theorem T9_doc_put_v0_keeps_tags (d : StoredDoc) (n : DocV0) : (d.putV0 n).tags = d.tags := rfl

/-- T9h: a v0 app's edit that leaves `done` as it saw it keeps the stored status: a todo in progress stays so. -/
theorem T9_todo_put_v0_keeps_status (t : StoredTodo) (n : TodoV0) (h : n.done = t.v0.done) :
    (t.putV0 n).status = t.status := by
  unfold StoredTodo.putV0
  rw [ite_eq_left h.symm]

end AvenDB.Lens
