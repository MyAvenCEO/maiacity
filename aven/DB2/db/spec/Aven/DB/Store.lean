import Aven.DB.Blake3

/-!
# The store

`store`'s contract (SANDBOX.md, "The contract"): blobs named by their hash, and refs, names pointing at a hash,
changed by compare-and-set. One writer per store (README, rule 1), so the model is a sequence of calls, each with its
result as the contract gives it:

| call | result |
|---|---|
| `put bytes` | its hash; the same bytes twice keep one blob |
| `get h`, `has h` | the blob or none; whether it is there |
| `size h` | the blob's length in bytes, or none, without reading it |
| `getRange h a b` | none for a missing blob; bytes `a..b`; `range` when `a > b` or `b` is past its end |
| `list`, `listRefs` | every blob's hash, every ref's name, sorted |
| `delete h` | done, also for a blob that isn't there |
| `getRef n` | its hash or none |
| `setRef n expected new` | done when the ref holds `expected` (none: it doesn't exist), otherwise `stale` with what it holds |
| `deleteRef n expected` | the same rule |

A ref's name is 1 to 128 of `A-Za-z0-9._-`, not starting with a dot; any other is refused before the store is
touched. The model is parametric in the hash `H`; `Blake3.hash` is the store's. What it proves:

- **A blob never changes** (`blob_never_changes`): once a hash names bytes, it names those bytes until it is deleted,
  and every blob is named by its own hash (`named_run`).
- **A stale writer is refused** (`stale_set`, `stale_delete`): a write that expected anything but what the ref holds
  changes nothing and says what the ref holds; a write that is done held what it expected (`set_done`).
- **A ref is never torn** (`ref_written`): whatever a ref reads is what some write of the trace set it to. Of racing
  writers that all expect the same value, exactly the first is done (`one_wins`).
- **Refs and blobs stay apart** (`refs_apart`, `blobs_apart`).
- **A size is the blob's length** (`size_get`): `size` says what `get` would hold, without the bytes.
- **A ref at rest is its hash and a newline** (`refText`), in every driver, and reads back with that newline or
  without it (`readRef_refText`, `readRef_bare`): the opfs driver of 30 Oct 2026 wrote refs bare, the OpenDAL one with
  the newline, and a browser keeps what either wrote.

`lake exe vectors` exports the examples below and generated traces (`vectors/store.json`), and the conformance suite
(`store/src/conformance.rs`) replays them on every backend: memory, a folder, S3 and OPFS.
-/

namespace Aven.DB.Store

abbrev Hash := String
abbrev Bytes := List UInt8
abbrev Name := String

/-! ## Association lists, one entry per key -/

def get {β : Type} : List (String × β) → String → Option β
  | [], _ => none
  | (k, v) :: l, x => if k = x then some v else get l x

def erase {β : Type} : List (String × β) → String → List (String × β)
  | [], _ => []
  | (k, v) :: l, x => if k = x then erase l x else (k, v) :: erase l x

def set {β : Type} (l : List (String × β)) (k : String) (v : β) : List (String × β) := (k, v) :: erase l k

section
variable {β : Type}

@[simp] theorem get_erase_self (l : List (String × β)) (x : String) : get (erase l x) x = none := by
  induction l with
  | nil => rfl
  | cons p l ih => obtain ⟨k, v⟩ := p; by_cases e : k = x <;> simp [erase, get, e, ih]

theorem get_erase_ne (l : List (String × β)) {x y : String} (h : x ≠ y) : get (erase l x) y = get l y := by
  induction l with
  | nil => rfl
  | cons p l ih =>
    obtain ⟨k, v⟩ := p
    by_cases e : k = x
    · subst e; simp [erase, get, h, ih]
    · by_cases f : k = y
      · subst f; simp [erase, get, e]
      · simp [erase, get, e, f, ih]

@[simp] theorem get_set_self (l : List (String × β)) (x : String) (v : β) : get (set l x v) x = some v := by
  simp [set, get]

theorem get_set_ne (l : List (String × β)) {x y : String} (v : β) (h : x ≠ y) : get (set l x v) y = get l y := by
  simp [set, get, h, get_erase_ne l h]

end

/-- Insertion sort over names and hashes: the order `list` and `listRefs` give, byte by byte. -/
def ins (a : String) : List String → List String
  | [] => [a]
  | b :: l => if b < a then b :: ins a l else a :: b :: l

def sort : List String → List String
  | [] => []
  | a :: l => ins a (sort l)

/-! ## The contract -/

/-- 1 to 128 of `A-Za-z0-9._-`, not starting with a dot. -/
def validName (n : String) : Bool :=
  0 < n.length && n.length ≤ 128 && !n.startsWith "." &&
    n.all fun c => c.isAlphanum || c = '.' || c = '_' || c = '-'

/-- 64 lowercase hex digits: the only spelling the store reads as a hash. -/
def validHash (s : String) : Bool := s.length = 64 && s.all fun c => c.isDigit || ('a' ≤ c && c ≤ 'f')

inductive Op where
  | put (bytes : Bytes)
  | get (h : Hash)
  | getRange (h : Hash) (start stop : Nat)
  | has (h : Hash)
  | size (h : Hash)
  | list
  | delete (h : Hash)
  | getRef (n : Name)
  | setRef (n : Name) (expected : Option Hash) (new : Hash)
  | deleteRef (n : Name) (expected : Hash)
  | listRefs
  deriving DecidableEq, Repr

inductive Res where
  | hash (h : Hash)
  | bytes (b : Option Bytes)
  | yes (b : Bool)
  | hashes (l : List Hash)
  | size (n : Option Nat)
  | done
  | ref (h : Option Hash)
  | names (l : List Name)
  | stale (current : Option Hash)
  | range (start stop len : Nat)
  | invalidName (n : Name)
  deriving DecidableEq, Repr

def Op.isRef : Op → Bool
  | .getRef _ | .setRef _ _ _ | .deleteRef _ _ | .listRefs => true
  | _ => false

end Store

structure Store where
  blobs : List (Store.Hash × Store.Bytes) := []
  refs : List (Store.Name × Store.Hash) := []
  deriving DecidableEq, Repr

namespace Store

variable (H : Bytes → Hash)

def step (s : Store) : Op → Store × Res
  | .put b =>
    let h := H b
    ((if (get s.blobs h).isSome then s else { s with blobs := (h, b) :: s.blobs }), .hash h)
  | .get h => (s, .bytes (get s.blobs h))
  | .getRange h a e => match get s.blobs h with
    | none => (s, .bytes none)
    | some b => if a > e ∨ e > b.length then (s, .range a e b.length) else (s, .bytes ((b.drop a).take (e - a)))
  | .has h => (s, .yes (get s.blobs h).isSome)
  | .size h => (s, .size ((get s.blobs h).map List.length))
  | .list => (s, .hashes (sort (s.blobs.map (·.1))))
  | .delete h => ({ s with blobs := erase s.blobs h }, .done)
  | .getRef n => if validName n then (s, .ref (get s.refs n)) else (s, .invalidName n)
  | .setRef n e new =>
    if !validName n then (s, .invalidName n)
    else if get s.refs n ≠ e then (s, .stale (get s.refs n))
    else ({ s with refs := set s.refs n new }, .done)
  | .deleteRef n e =>
    if !validName n then (s, .invalidName n)
    else if get s.refs n ≠ some e then (s, .stale (get s.refs n))
    else ({ s with refs := erase s.refs n }, .done)
  | .listRefs => (s, .names (sort (s.refs.map (·.1))))

def run (s : Store) : List Op → Store
  | [] => s
  | o :: os => run (step H s o).1 os

/-- The result of every call of a trace. -/
def results (s : Store) : List Op → List Res
  | [] => []
  | o :: os => (step H s o).2 :: results (step H s o).1 os

variable {H}

/-! ## A blob never changes -/

/-- Once a hash names bytes, it names those bytes after any call but its delete. -/
theorem blob_kept {s : Store} {h : Hash} {b : Bytes} (op : Op) (hb : get s.blobs h = some b) (hop : op ≠ .delete h) :
    get (step H s op).1.blobs h = some b := by
  cases op with
  | put b' =>
    simp only [step]
    split
    · exact hb
    · next n =>
      simp only [get]
      split
      · next e => subst e; simp [hb] at n
      · exact hb
  | delete h' => exact (get_erase_ne _ (fun e => hop (by rw [e]))).trans hb
  | getRange h' a e => simp only [step]; split <;> (try split) <;> exact hb
  | getRef n | setRef n e new | deleteRef n e =>
    simp only [step]; repeat (first | split | exact hb)
  | _ => exact hb

/-- A blob never changes: after any call it holds the same bytes, or it is gone. -/
theorem blob_never_changes {s : Store} {h : Hash} {b : Bytes} (op : Op) (hb : get s.blobs h = some b) :
    get (step H s op).1.blobs h = some b ∨ get (step H s op).1.blobs h = none := by
  by_cases d : op = .delete h
  · subst d; exact .inr (get_erase_self _ _)
  · exact .inl (blob_kept op hb d)

/-- Every blob is named by its own hash. -/
def Named (H : Bytes → Hash) (s : Store) : Prop := ∀ h b, get s.blobs h = some b → h = H b

theorem get_erase_some {β : Type} {l : List (String × β)} {x y : String} {v : β} (h : get (erase l x) y = some v) :
    get l y = some v := by
  by_cases e : x = y
  · subst e; simp at h
  · rwa [get_erase_ne _ e] at h

theorem named_step {s : Store} (n : Named H s) (op : Op) : Named H (step H s op).1 := by
  intro h b g
  cases op with
  | put b' =>
    simp only [step] at g
    split at g
    · exact n h b g
    · simp only [get] at g
      split at g
      · next e => cases g; exact e.symm
      · exact n h b g
  | delete h' => exact n h b (get_erase_some g)
  | getRange h' a e => simp only [step] at g; split at g <;> (try split at g) <;> exact n h b g
  | getRef _ | setRef _ _ _ | deleteRef _ _ =>
    simp only [step] at g; repeat (first | split at g | exact n h b g)
  | _ => exact n h b g

theorem named_run : ∀ {s : Store} (ops : List Op), Named H s → Named H (run H s ops)
  | _, [], n => n
  | _, o :: os, n => named_run os (named_step n o)

/-- From an empty store, every blob is named by its hash. -/
theorem named_empty (ops : List Op) : Named H (run H {} ops) := named_run ops fun _ _ g => by simp [get] at g

/-! ## A stale writer is refused -/

theorem stale_set {s : Store} {n : Name} {e : Option Hash} (new : Hash) (v : validName n = true)
    (c : get s.refs n ≠ e) : step H s (.setRef n e new) = (s, .stale (get s.refs n)) := by
  simp [step, v, c]

theorem stale_delete {s : Store} {n : Name} {e : Hash} (v : validName n = true) (c : get s.refs n ≠ some e) :
    step H s (.deleteRef n e) = (s, .stale (get s.refs n)) := by
  simp [step, v, c]

/-- A write that is done held what it expected, and the ref now holds the new value. -/
theorem set_done {s : Store} {n : Name} {e : Option Hash} {new : Hash} (d : (step H s (.setRef n e new)).2 = .done) :
    get s.refs n = e ∧ get (step H s (.setRef n e new)).1.refs n = some new := by
  simp only [step] at *
  split at d
  · cases d
  · split at d
    · cases d
    · next c => simp_all

/-! ## A ref is never torn -/

/-- What a ref holds after a call, it held before, or the call set it to. -/
theorem ref_step {s : Store} {n : Name} {h : Hash} (op : Op) (g : get (step H s op).1.refs n = some h) :
    get s.refs n = some h ∨ ∃ e, op = .setRef n e h := by
  cases op with
  | setRef m e new =>
    simp only [step] at g
    split at g
    · exact .inl g
    · split at g
      · exact .inl g
      · by_cases x : m = n
        · subst x; simp at g; exact .inr ⟨e, by rw [g]⟩
        · rw [get_set_ne _ _ x] at g; exact .inl g
  | deleteRef m e =>
    simp only [step] at g
    split at g
    · exact .inl g
    · split at g
      · exact .inl g
      · exact .inl (get_erase_some g)
  | getRange h' a e => simp only [step] at g; split at g <;> (try split at g) <;> exact .inl g
  | put b => simp only [step] at g; split at g <;> exact .inl g
  | getRef m => simp only [step] at g; split at g <;> exact .inl g
  | _ => exact .inl g

theorem ref_run : ∀ {s : Store} (ops : List Op) {n : Name} {h : Hash}, get (run H s ops).refs n = some h →
    get s.refs n = some h ∨ ∃ e, Op.setRef n e h ∈ ops
  | _, [], _, _, g => .inl g
  | s, o :: os, n, h, g => by
    rcases ref_run os g with g | ⟨e, m⟩
    · rcases ref_step o g with g | ⟨e, x⟩
      · exact .inl g
      · exact .inr ⟨e, x ▸ List.mem_cons_self⟩
    · exact .inr ⟨e, List.mem_cons_of_mem _ m⟩

/-- A ref is never torn: from an empty store, whatever it reads, a write of the trace set it to. -/
theorem ref_written (ops : List Op) {n : Name} {h : Hash} (g : get (run H {} ops).refs n = some h) :
    ∃ e, Op.setRef n e h ∈ ops := by
  rcases ref_run ops g with g | m
  · simp [get] at g
  · exact m

theorem racers_refused {s : Store} {n : Name} {e x : Hash} (v : validName n = true) (hs : get s.refs n = some x)
    (ne : x ≠ e) : ∀ ys : List Hash, results H s (ys.map (Op.setRef n (some e))) = ys.map fun _ => .stale (some x)
  | [] => rfl
  | y :: ys => by
    have c : get s.refs n ≠ some e := by rw [hs]; simpa using ne
    simp only [List.map_cons, results, stale_set y v c, hs, racers_refused v hs ne ys]

/-- Of writers racing from the same value, each expecting it, exactly the first is done: the others are refused,
told what the first wrote. -/
theorem one_wins {s : Store} {n : Name} {e x : Hash} (ys : List Hash) (v : validName n = true)
    (hs : get s.refs n = some e) (ne : x ≠ e) :
    results H s ((x :: ys).map (Op.setRef n (some e))) = .done :: ys.map fun _ => .stale (some x) := by
  have d : step H s (.setRef n (some e) x) = ({ s with refs := set s.refs n x }, .done) := by simp [step, v, hs]
  simp only [List.map_cons, results, d]
  exact congrArg _ (racers_refused v (get_set_self _ _ _) ne ys)

/-! ## Refs and blobs stay apart -/

theorem refs_apart {s : Store} (op : Op) (r : op.isRef = false) : (step H s op).1.refs = s.refs := by
  cases op <;> simp [Op.isRef] at r <;> simp only [step] <;> (try split) <;> (try split) <;> rfl

theorem blobs_apart {s : Store} (op : Op) (r : op.isRef = true) : (step H s op).1.blobs = s.blobs := by
  cases op <;> simp [Op.isRef] at r <;> simp only [step] <;> split <;> (try split) <;> rfl

/-! ## A size is the blob's length -/

/-- `size` changes nothing, and is the length of exactly what `get` holds: none for a blob that isn't there. -/
theorem size_get (s : Store) (h : Hash) :
    ∃ b, step H s (.get h) = (s, .bytes b) ∧ step H s (.size h) = (s, .size (b.map List.length)) :=
  ⟨_, rfl, rfl⟩

/-! ## A ref at rest -/

/-- How a ref holds its hash at rest, in every driver: the hash and a newline. -/
def refText (h : Hash) : String := h ++ "\n"

/-- A ref's text read back: without one trailing newline, if it has one, a hash in the store's spelling, or nothing. -/
def readRef (s : String) : Option Hash :=
  let t := if s.toList.getLast? = some '\n' then String.ofList s.toList.dropLast else s
  if validHash t then some t else none

/-- What a ref is written as reads back as its hash. -/
theorem readRef_refText {h : Hash} (v : validHash h = true) : readRef (refText h) = some h := by
  simp [readRef, refText, String.toList_append, v]

/-- A ref written bare, as the opfs driver of 30 Oct 2026 wrote it, reads back too: a hash never ends in a newline. -/
theorem readRef_bare {h : Hash} (v : validHash h = true) : readRef h = some h := by
  have last : h.toList.getLast? ≠ some '\n' := by
    intro e
    have m := List.mem_of_getLast? e
    simp only [validHash, Bool.and_eq_true, String.all_bool_eq, List.all_eq_true] at v
    have := v.2 '\n' m
    simp at this
  simp [readRef, last, v]

end Store
end Aven.DB
