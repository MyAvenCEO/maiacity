/-!
# Schemas and lenses

The two examples, each in two schema versions, and the two-way lens between them (T9).

- Markdown documents: v1 blocks have a `kind` (h1, h2, h3, p, li, code); v2 blocks have a `type` with a heading
  `level`, items can be `checked`, code can name its `lang`, and the document gains `tags`.
- Todos: v1 has `done`; v2 has `status` (open, doing, done).

Nothing is migrated by a commit: two devices migrating at once could each drop the other's new containers, and a
default that a migration writes races a real edit. An item is stored as it was written instead, each field in the
representation of the schema it was written under: v1's, v2's, or after concurrent edits both, where v2's wins (it is
the newer one). Each app projects the item on read, through the lens, into its own schema (`v1`, `v2`), so defaults
live in the lens and are never written. An app's edit goes back through its view (`putV1`, `putV2`): it writes only
what changed, in its own representation, so what an older app can't see survives its edits.
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

/-! ## Items as stored, projected on read -/

/-- A block as stored: v1's field (`kind`), v2's fields in its place (`type`, and `level` for a heading), or after
    concurrent edits both; and what only v2 can say (`checked`, `lang`). A field that isn't stored is `none`. -/
structure StoredBlock where
  id      : Nat
  text    : String
  kind    : Option KindV1 := none
  type    : Option TypeV2 := none
  level   : Option Nat := none
  checked : Option Bool := none
  lang    : Option String := none
  deriving DecidableEq, Repr

/-- The block holds v2's representation, which wins over `kind`. -/
def StoredBlock.hasV2 (b : StoredBlock) : Bool := b.type.isSome || b.level.isSome

/-- v1's representation as stored; `none` without a `kind`. -/
def StoredBlock.asV1 (b : StoredBlock) : Option BlockV1 := b.kind.map fun k => ⟨b.id, k, b.text⟩

/-- v2's representation as stored; `none` without a `type`. -/
def StoredBlock.asV2 (b : StoredBlock) : Option BlockV2 :=
  b.type.map fun t => ⟨b.id, t, b.level, b.checked, b.lang, b.text⟩

/-- The block as a v2 app reads it: v2's representation, else `kind` through the lens; `none` when it has no type to
    read. -/
def StoredBlock.v2 (b : StoredBlock) : Option BlockV2 :=
  if b.hasV2 then b.asV2 else b.asV1.map fun x => { x.fwd with checked := b.checked, lang := b.lang }

/-- The block as a v1 app reads it: v2's representation through the lens, else `kind`; `none` when it has no kind
    to read. -/
def StoredBlock.v1 (b : StoredBlock) : Option BlockV1 :=
  if b.hasV2 then b.asV2.map BlockV2.bwd else b.asV1

/-- A v1 app's edit: the block now reads `nb` in its view. The text, and the kind only if it changed: as v2's fields
    when the block holds them, else as `kind`. `checked` and `lang` are never touched. -/
def StoredBlock.putV1 (b : StoredBlock) (nb : BlockV1) : StoredBlock :=
  let b' := { b with text := nb.text }
  if b.v1.map (·.kind) = some nb.kind then b'
  else if b.hasV2 then { b' with type := some nb.fwd.type, level := nb.fwd.level }
  else { b' with kind := some nb.kind }

/-- A v2 app's edit: the block now reads `nb` in its view. The text, `checked` and `lang`, and the type and level
    only if they changed, as v2's fields: `kind` goes, since v2's representation now holds the field. -/
def StoredBlock.putV2 (b : StoredBlock) (nb : BlockV2) : StoredBlock :=
  let b' := { b with text := nb.text, checked := nb.checked, lang := nb.lang }
  if b.v2.map (fun x => (x.type, x.level)) = some (nb.type, nb.level) then b'
  else { b' with kind := none, type := some nb.type, level := nb.level }

/-- A todo as stored: v1's `done`, v2's `status` in its place, or after concurrent edits both. -/
structure StoredTodo where
  title  : String
  notes  : String
  due    : Option String := none
  done   : Option Bool := none
  status : Option Status := none
  deriving DecidableEq, Repr

/-- The todo holds v2's representation, which wins over `done`. -/
def StoredTodo.hasV2 (t : StoredTodo) : Bool := t.status.isSome

/-- The todo as a v1 app reads it: the status through the lens, else `done`, else not done (v1's default, which is
    never written). -/
def StoredTodo.v1 (t : StoredTodo) : TodoV1 :=
  match t.status with
  | some s => TodoV2.bwd ⟨t.title, s, t.notes, t.due⟩
  | none => ⟨t.title, t.done.getD false, t.notes, t.due⟩

/-- The todo as a v2 app reads it: the status, else `done` through the lens, else open (v2's default, which is never
    written). -/
def StoredTodo.v2 (t : StoredTodo) : TodoV2 :=
  match t.status, t.done with
  | some s, _ => ⟨t.title, s, t.notes, t.due⟩
  | none, some d => TodoV1.fwd ⟨t.title, d, t.notes, t.due⟩
  | none, none => ⟨t.title, .«open», t.notes, t.due⟩

/-- A v1 app's edit: the todo now reads `n` in its view. The title, notes and due date, and `done` only if it
    changed: as the status when the todo holds one, else as `done`. -/
def StoredTodo.putV1 (t : StoredTodo) (n : TodoV1) : StoredTodo :=
  let t' := { t with title := n.title, notes := n.notes, due := n.due }
  if t.v1.done = n.done then t'
  else if t.hasV2 then { t' with status := some n.fwd.status }
  else { t' with done := some n.done }

/-- A v2 app's edit: the todo now reads `n` in its view. The title, notes and due date, and the status only if it
    changed: `done` goes, since v2's representation now holds the field. -/
def StoredTodo.putV2 (t : StoredTodo) (n : TodoV2) : StoredTodo :=
  let t' := { t with title := n.title, notes := n.notes, due := n.due }
  if t.v2.status = n.status then t' else { t' with status := some n.status, done := none }

/-- A document as stored: its title, its blocks, and v2's tags (none stored reads as none). -/
structure StoredDoc where
  title  : String
  blocks : List StoredBlock
  tags   : List String := []
  deriving DecidableEq, Repr

/-- The document as a v1 app reads it: the blocks it can read. -/
def StoredDoc.v1 (d : StoredDoc) : DocV1 := ⟨d.title, d.blocks.filterMap StoredBlock.v1⟩

/-- The document as a v2 app reads it: the blocks it can read, and the tags. -/
def StoredDoc.v2 (d : StoredDoc) : DocV2 := ⟨d.title, d.blocks.filterMap StoredBlock.v2, d.tags⟩

/-- A v1 app's edit: the document now reads `n` in its view. Each stored block `n` holds (by id) goes through its
    view; the other blocks and the tags stay as they are. Only edits in place: inserting, deleting and moving blocks
    are tested in Rust. -/
def StoredDoc.putV1 (d : StoredDoc) (n : DocV1) : StoredDoc :=
  { d with title := n.title, blocks := d.blocks.map fun b =>
      match n.blocks.find? (·.id == b.id) with
      | some nb => b.putV1 nb
      | none => b }

/-- A v2 app's edit: the document now reads `n` in its view, tags included. Each stored block `n` holds (by id) goes
    through its view; the other blocks stay as they are. -/
def StoredDoc.putV2 (d : StoredDoc) (n : DocV2) : StoredDoc :=
  { d with title := n.title, tags := n.tags, blocks := d.blocks.map fun b =>
      match n.blocks.find? (·.id == b.id) with
      | some nb => b.putV2 nb
      | none => b }

/-! ## The lens laws on stored items

First what each view reads, then the laws: both apps see the same item (T9c), an edit shows exactly as made (T9f,
PutGet), an unchanged view writes nothing (T9g, GetPut), and an older app's edit keeps what it can't see (T9h). -/

/-- Going back, the lens reads neither `checked` nor `lang`. -/
theorem BlockV2.bwd_checked_lang (x : BlockV2) (c : Option Bool) (l : Option String) :
    { x with checked := c, lang := l }.bwd = x.bwd := rfl

/-- A v1 view has its block's id and text. -/
theorem StoredBlock.v1_some {b : StoredBlock} {x : BlockV1} (h : b.v1 = some x) : x.id = b.id ∧ x.text = b.text := by
  rcases b with ⟨id, text, kind, type, level, checked, lang⟩
  unfold StoredBlock.v1 StoredBlock.asV1 StoredBlock.asV2 at h
  split at h
  · cases type with
    | none => cases h
    | some t => cases h; exact ⟨rfl, rfl⟩
  · cases kind with
    | none => cases h
    | some k => cases h; exact ⟨rfl, rfl⟩

/-- Writing the text changes only the text of the v1 view. -/
theorem StoredBlock.v1_text (b : StoredBlock) (s : String) :
    ({ b with text := s } : StoredBlock).v1 = b.v1.map fun x => { x with text := s } := by
  rcases b with ⟨id, text, kind, type, level, checked, lang⟩
  unfold StoredBlock.v1 StoredBlock.asV1 StoredBlock.asV2 StoredBlock.hasV2
  dsimp only
  split <;> (cases type <;> cases kind <;> rfl)

/-- A v2 view has its block's id, text, `checked` and `lang`. -/
theorem StoredBlock.v2_some {b : StoredBlock} {x : BlockV2} (h : b.v2 = some x) :
    x.id = b.id ∧ x.text = b.text ∧ x.checked = b.checked ∧ x.lang = b.lang := by
  rcases b with ⟨id, text, kind, type, level, checked, lang⟩
  unfold StoredBlock.v2 StoredBlock.asV1 StoredBlock.asV2 at h
  split at h
  · cases type with
    | none => cases h
    | some t => cases h; exact ⟨rfl, rfl, rfl, rfl⟩
  · cases kind with
    | none => cases h
    | some k => cases h; cases k <;> exact ⟨rfl, rfl, rfl, rfl⟩

/-- Writing the text, `checked` and `lang` changes only those of the v2 view. -/
theorem StoredBlock.v2_update (b : StoredBlock) (s : String) (c : Option Bool) (l : Option String) :
    ({ b with text := s, checked := c, lang := l } : StoredBlock).v2 =
      b.v2.map fun x => { x with text := s, checked := c, lang := l } := by
  rcases b with ⟨id, text, kind, type, level, checked, lang⟩
  unfold StoredBlock.v2 StoredBlock.asV1 StoredBlock.asV2 StoredBlock.hasV2
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

/-- T9c: a v1 app and a v2 app see the same block: the v1 view is the v2 view through the lens. -/
theorem T9_block_views_agree (b : StoredBlock) : b.v1 = b.v2.map BlockV2.bwd := by
  unfold StoredBlock.v1 StoredBlock.v2
  split
  · rfl
  · cases b.asV1 with
    | none => rfl
    | some x => simp only [Option.map_some, BlockV2.bwd_checked_lang, BlockV1.bwd_fwd]

/-- T9c: a v1 app and a v2 app see the same todo. -/
theorem T9_todo_views_agree (t : StoredTodo) : t.v1 = t.v2.bwd := by
  rcases t with ⟨title, notes, due, done, status⟩
  rcases status with _ | (_ | _ | _) <;> rcases done with _ | (_ | _) <;> rfl

/-- T9c: a v1 app and a v2 app see the same document. -/
theorem T9_doc_views_agree (d : StoredDoc) : d.v1 = d.v2.bwd := by
  simp only [StoredDoc.v1, StoredDoc.v2, DocV2.bwd, List.map_filterMap, DocV1.mk.injEq, true_and]
  congr 1
  funext b
  exact T9_block_views_agree b

/-- T9f: a v1 app's edit of a block shows exactly as made, even on a block it couldn't read before. -/
theorem T9_block_put_get_v1 (b : StoredBlock) (nb : BlockV1) (h : nb.id = b.id) : (b.putV1 nb).v1 = some nb := by
  unfold StoredBlock.putV1
  dsimp only
  split
  · -- the kind is as the app saw it: only the text is written
    rename_i hk
    obtain ⟨x, hx, hxk⟩ := Option.map_eq_some_iff.1 hk
    rw [StoredBlock.v1_text, hx]
    have hid := (StoredBlock.v1_some hx).1
    rcases x with ⟨xid, xk, xt⟩
    rcases nb with ⟨nid, nk, nt⟩
    simp_all
  · split
    · -- the new kind as v2's fields
      rcases nb with ⟨nid, nk, nt⟩
      simp only at h
      subst h
      cases nk <;> rfl
    · -- the new kind as `kind`, where v2's fields aren't stored
      rename_i hv2
      rcases b with ⟨id, text, kind, type, level, checked, lang⟩
      rcases nb with ⟨nid, nk, nt⟩
      simp only at h
      subst h
      simp only [StoredBlock.hasV2, Bool.or_eq_true, Option.isSome_iff_ne_none, ne_eq, not_or,
        Decidable.not_not] at hv2
      obtain ⟨rfl, rfl⟩ := hv2
      rfl

/-- T9f: a v2 app's edit of a block shows exactly as made. -/
theorem T9_block_put_get_v2 (b : StoredBlock) (nb : BlockV2) (h : nb.id = b.id) : (b.putV2 nb).v2 = some nb := by
  unfold StoredBlock.putV2
  dsimp only
  split
  · -- the type and level are as the app saw them: they aren't written
    rename_i hk
    obtain ⟨x, hx, hxk⟩ := Option.map_eq_some_iff.1 hk
    rw [StoredBlock.v2_update, hx]
    have hid := (StoredBlock.v2_some hx).1
    rcases x with ⟨xid, xt, xl, xc, xlang, xtext⟩
    rcases nb with ⟨nid, nt, nl, nc, nlang, ntext⟩
    simp only [Prod.mk.injEq] at hxk
    simp_all
  · rcases nb with ⟨nid, nt, nl, nc, nlang, ntext⟩
    simp only at h
    subst h
    rfl

/-- T9f: a v1 app's edit of a todo shows exactly as made. -/
theorem T9_todo_put_get_v1 (t : StoredTodo) (n : TodoV1) : (t.putV1 n).v1 = n := by
  rcases t with ⟨title, notes, due, done, status⟩
  rcases n with ⟨ntitle, ndone, nnotes, ndue⟩
  rcases status with _ | (_ | _ | _) <;> rcases done with _ | (_ | _) <;> cases ndone <;> rfl

/-- T9f: a v2 app's edit of a todo shows exactly as made. -/
theorem T9_todo_put_get_v2 (t : StoredTodo) (n : TodoV2) : (t.putV2 n).v2 = n := by
  rcases t with ⟨title, notes, due, done, status⟩
  rcases n with ⟨ntitle, nstatus, nnotes, ndue⟩
  rcases status with _ | (_ | _ | _) <;> rcases done with _ | (_ | _) <;> cases nstatus <;> rfl

/-- T9g: putting back the v1 view of a block unchanged writes nothing. -/
theorem T9_block_get_put_v1 (b : StoredBlock) (v : BlockV1) (h : b.v1 = some v) : b.putV1 v = b := by
  unfold StoredBlock.putV1
  rw [h, (StoredBlock.v1_some h).2]
  simp

/-- T9g: putting back the v2 view of a block unchanged writes nothing. -/
theorem T9_block_get_put_v2 (b : StoredBlock) (v : BlockV2) (h : b.v2 = some v) : b.putV2 v = b := by
  unfold StoredBlock.putV2
  obtain ⟨-, ht, hc, hl⟩ := StoredBlock.v2_some h
  rw [h, ht, hc, hl]
  simp

/-- T9g: putting back the v1 view of a todo unchanged writes nothing, not even v1's default for `done`. -/
theorem T9_todo_get_put_v1 (t : StoredTodo) : t.putV1 t.v1 = t := by
  rcases t with ⟨title, notes, due, done, status⟩
  rcases status with _ | (_ | _ | _) <;> rcases done with _ | (_ | _) <;> rfl

/-- T9g: putting back the v2 view of a todo unchanged writes nothing, not even v2's default status. -/
theorem T9_todo_get_put_v2 (t : StoredTodo) : t.putV2 t.v2 = t := by
  rcases t with ⟨title, notes, due, done, status⟩
  rcases status with _ | (_ | _ | _) <;> rcases done with _ | (_ | _) <;> rfl

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

/-- T9g: putting back the v2 view of a document whose block ids are distinct unchanged writes nothing. -/
theorem T9_doc_get_put_v2 (d : StoredDoc) (h : (d.blocks.map (·.id)).Nodup) : d.putV2 d.v2 = d := by
  rcases d with ⟨title, blocks, tags⟩
  simp only [StoredDoc.putV2, StoredDoc.v2, StoredDoc.mk.injEq, true_and, and_true]
  conv => rhs; rw [← List.map_id blocks]
  refine List.map_congr_left fun b hb => ?_
  rw [find?_filterMap_id StoredBlock.v2 (·.id) (·.id) (fun _ _ hx => (StoredBlock.v2_some hx).1) blocks h b hb]
  cases hv : b.v2 with
  | none => rfl
  | some v => exact T9_block_get_put_v2 b v hv

/-- T9h: a v1 app's edit of a block keeps whether it is checked and its code's language. -/
theorem T9_block_put_v1_keeps (b : StoredBlock) (nb : BlockV1) :
    (b.putV1 nb).checked = b.checked ∧ (b.putV1 nb).lang = b.lang := by
  unfold StoredBlock.putV1
  dsimp only
  split
  · exact ⟨rfl, rfl⟩
  · split <;> exact ⟨rfl, rfl⟩

/-- T9h: a v1 app's edit of a document keeps its tags. -/
theorem T9_doc_put_v1_keeps_tags (d : StoredDoc) (n : DocV1) : (d.putV1 n).tags = d.tags := rfl

/-- T9h: a v1 app's edit that leaves `done` as it saw it keeps the stored status: a todo in progress stays so. -/
theorem T9_todo_put_v1_keeps_status (t : StoredTodo) (n : TodoV1) (h : n.done = t.v1.done) :
    (t.putV1 n).status = t.status := by
  unfold StoredTodo.putV1
  rw [ite_eq_left h.symm]

end VaultSpec.Lens
