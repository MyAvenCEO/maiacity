import Aven.DB.Store

/-!
# A crash while the store writes

The opfs driver's writes (`store/README.md`, "What the store asks of the opfs driver"), and what a crash in the middle
of one leaves. A write goes to a temporary file first, then into place:

| call | on disk, in order |
|---|---|
| `put b` (a blob not there yet) | the temporary file `tmp/blob-<H b>` gets `b`; it moves to `blobs/<H b>` |
| `setRef n e new` (done) | the temporary file `tmp/ref-<n>` gets `new`'s 64 characters; it moves to `refs/<n>` |
| `delete h`, `deleteRef n e` | one remove |

**Move** is one step: the file whole in its place, or still in `tmp/` (Chromium 156 and Firefox 157 replace an existing
file, measured 30 Oct 2026). **Copy** is the fallback where `move()` fails: the place is truncated and written, then the
temporary file is removed, so a crash can leave the place torn. A write's bytes reach the disk in order, so a torn file
is a part of the whole:

- a torn blob's bytes don't hash to its name (BLAKE3 has no known collision);
- a torn ref is shorter than 64 characters, so it never reads as a hash (`torn_ref`).

**Opening the store recovers** (`recover`): a temporary file that is whole (a blob's bytes that hash to its name, a
ref's value that is a hash) rolls forward into place, whatever the place holds; every other temporary file is removed.
The temporary files are named by their place, so the roll forward knows where each goes. Without it, a copy that tore
`refs/<n>` would lose the ref, its old value and its new one alike, and a torn blob would stay under its name.

What it proves (`crash_atomic`, `crash_trace`): whatever a crash leaves while one call runs, the store recovered is the
store before the call or after it, file for file, with no temporary file left. A crash anywhere in a trace from an empty
store recovers to the trace up to the call that ran, without it or with it. A change of leader is a change of the one
writer, under the Web Lock: the old writer has stopped, as after a crash, so the new one opens, and recovers, the same
way.
-/

namespace Aven.DB.Store

/-- A temporary file in `tmp/`: a blob's bytes on their way to `blobs/<h>`, or a ref's value on its way to
`refs/<n>`. -/
inductive Tmp where
  | blob (h : Hash) (b : Bytes)
  | ref (n : Name) (v : Hash)
  deriving DecidableEq, Repr

/-- What the opfs driver's folder holds: the store's blobs and refs as files, and its temporary files. -/
structure Disk where
  blobs : List (Hash × Bytes)
  refs : List (Name × Hash)
  tmps : List Tmp
  deriving DecidableEq, Repr

/-- A store at rest: its files, and no temporary ones. -/
def Disk.of (s : Store) : Disk := ⟨s.blobs, s.refs, []⟩

/-- A file in the middle of being written. -/
inductive Mode where
  | move
  | copy
  deriving DecidableEq, Repr

variable (H : Bytes → Hash)

/-- Every state a crash can leave while the call `op` runs on the store `s`. A torn file's content is given with what
a write's bytes in order guarantee: a torn blob's bytes are the whole or don't hash to its name, a torn ref's value is
the whole or isn't a hash. -/
inductive Crash (s : Store) : Mode → Op → Disk → Prop
  /-- before the call wrote anything -/
  | before (m : Mode) (op : Op) : Crash s m op (.of s)
  /-- after it finished -/
  | after (m : Mode) (op : Op) : Crash s m op (.of (step H s op).1)
  /-- a new blob's temporary file, written in part or whole, not yet moved -/
  | blobTmp (m : Mode) (b t : Bytes) (fresh : get s.blobs (H b) = none) (torn : t = b ∨ H t ≠ H b) :
      Crash s m (.put b) ⟨s.blobs, s.refs, [.blob (H b) t]⟩
  /-- copy only: the blob in its place, written in part or whole, its temporary file not yet removed -/
  | blobCopy (b t : Bytes) (fresh : get s.blobs (H b) = none) (torn : t = b ∨ H t ≠ H b) :
      Crash s .copy (.put b) ⟨(H b, t) :: s.blobs, s.refs, [.blob (H b) b]⟩
  /-- a ref's temporary file, written in part or whole, not yet moved; compare-and-set has passed -/
  | refTmp (m : Mode) (n : Name) (e : Option Hash) (new t : Hash) (v : validName n = true) (c : get s.refs n = e)
      (torn : t = new ∨ validHash t = false) :
      Crash s m (.setRef n e new) ⟨s.blobs, s.refs, [.ref n t]⟩
  /-- copy only: the ref in its place, written in part or whole, its temporary file not yet removed -/
  | refCopy (n : Name) (e : Option Hash) (new t : Hash) (v : validName n = true) (c : get s.refs n = e)
      (torn : t = new ∨ validHash t = false) :
      Crash s .copy (.setRef n e new) ⟨s.blobs, set s.refs n t, [.ref n new]⟩

/-- Opening: a whole temporary file rolls forward into place (a blob's bytes that hash to its name, a ref's value that
is a hash), whatever the place holds; every other temporary file is removed. -/
def roll : List (Hash × Bytes) → List (Name × Hash) → List Tmp → Disk
  | bs, rs, [] => ⟨bs, rs, []⟩
  | bs, rs, .blob h b :: ts => roll (if H b == h then set bs h b else bs) rs ts
  | bs, rs, .ref n v :: ts => roll bs (if validHash v then set rs n v else rs) ts

def recover (d : Disk) : Disk := roll H d.blobs d.refs d.tmps

/-- A call the store can be given: `Hash` is always a hash in Rust, so a ref is only ever set to one. -/
def Op.ok : Op → Prop
  | .setRef _ _ new => validHash new = true
  | _ => True

variable {H}

/-! ## A torn ref never reads as a hash -/

theorem validHash_length {t : Hash} (v : validHash t = true) : t.length = 64 := by
  simp only [validHash, Bool.and_eq_true, decide_eq_true_eq] at v
  exact v.1

/-- A ref written in part is shorter than a hash, so it never reads as one. -/
theorem torn_ref {t : Hash} (short : t.length < 64) : validHash t = false := by
  cases v : validHash t
  · rfl
  · exact absurd (validHash_length v) (Nat.ne_of_lt short)

/-! ## A crash leaves the call undone or done -/

theorem erase_erase {β : Type} (l : List (String × β)) (n : String) : erase (erase l n) n = erase l n := by
  induction l with
  | nil => rfl
  | cons p l ih =>
    obtain ⟨k, w⟩ := p
    by_cases e : k = n <;> simp [erase, e, ih]

theorem erase_set {β : Type} (l : List (String × β)) (n : String) (v : β) : erase (set l n v) n = erase l n := by
  simp only [set, erase, ite_true, erase_erase]

theorem set_set {β : Type} (l : List (String × β)) (n : String) (v w : β) : set (set l n v) n w = set l n w := by
  simp only [set]
  rw [show erase ((n, v) :: erase l n) n = erase l n from erase_set l n v]

theorem erase_absent {β : Type} {l : List (String × β)} {x : String} (g : get l x = none) : erase l x = l := by
  induction l with
  | nil => rfl
  | cons p l ih =>
    obtain ⟨k, v⟩ := p
    by_cases e : k = x
    · simp [get, e] at g
    · simp only [get, e, ite_false] at g
      simp [erase, e, ih g]

/-- Whatever a crash leaves while one call runs, the store recovered is the store before the call or after it: the
same files, and no temporary one. -/
theorem crash_atomic {m : Mode} {s : Store} {op : Op} {d : Disk} (ok : op.ok) (c : Crash H s m op d) :
    recover H d = .of s ∨ recover H d = .of (step H s op).1 := by
  cases c with
  | before _ _ => exact .inl rfl
  | after _ _ => exact .inr rfl
  | blobTmp _ b t fresh torn =>
    have after : (step H s (.put b)).1 = { s with blobs := (H b, b) :: s.blobs } := by simp [step, fresh]
    rcases torn with e | ne
    · subst e
      refine .inr ?_
      rw [after]
      simp [recover, roll, Disk.of, set, erase_absent fresh]
    · refine .inl ?_
      simp [recover, roll, Disk.of, ne]
  | blobCopy b t fresh _ =>
    have after : (step H s (.put b)).1 = { s with blobs := (H b, b) :: s.blobs } := by simp [step, fresh]
    refine .inr ?_
    rw [after]
    simp [recover, roll, Disk.of, set, erase, erase_absent fresh]
  | refTmp _ n e new t v ce torn =>
    have after : (step H s (.setRef n e new)).1 = { s with refs := set s.refs n new } := by simp [step, v, ce]
    simp only [Op.ok] at ok
    rcases torn with x | bad
    · subst x
      exact .inr (by rw [after]; simp [recover, roll, Disk.of, ok])
    · exact .inl (by simp [recover, roll, Disk.of, bad])
  | refCopy n e new t v ce _ =>
    have after : (step H s (.setRef n e new)).1 = { s with refs := set s.refs n new } := by simp [step, v, ce]
    simp only [Op.ok] at ok
    exact .inr (by rw [after]; simp [recover, roll, Disk.of, ok, set_set])

theorem run_append (s : Store) (pre : List Op) (op : Op) : run H s (pre ++ [op]) = (step H (run H s pre) op).1 := by
  induction pre generalizing s with
  | nil => rfl
  | cons o os ih => exact ih _

/-- A crash anywhere in a trace from an empty store, recovered, is the store of the trace up to the call that ran:
without it or with it. -/
theorem crash_trace {m : Mode} (pre : List Op) {op : Op} {d : Disk} (ok : op.ok) (c : Crash H (run H {} pre) m op d) :
    recover H d = .of (run H {} pre) ∨ recover H d = .of (run H {} (pre ++ [op])) := by
  rw [run_append]
  exact crash_atomic ok c

end Aven.DB.Store
