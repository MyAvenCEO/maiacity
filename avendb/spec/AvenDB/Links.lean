import AvenDB.Ops

/-!
# Links: records that point at records

`avendb/docs/ARCHITECTURE.md` §8. A field holds a record's own rows (inline, `Ops`), or a link: an entry of a vault,
maybe a row of it, at its newest or at a version it is pinned at. The schema says which, field by field: what lives
and dies with its record is inline, what has a life of its own, its own shares and keys, is linked.

- **Reading so many rows down.** A query reads each record so many rows down (`Doc.cut`): a list of rows below that
  isn't read, so nothing it holds is translated, tested or shown; an empty one stays.
- **Following links.** A query follows the links at the fields it names, a level at a time (`follow`). A hop opens
  what the reader opens of the link (`Opens`): the record there and its links, or why it opens none, which the hop
  shows in its place (L1, `follow_refused`). Each record a hop shows is one the reader opened, read as many rows down
  as the query has left, and each hop that shows nothing says why the reader opened nothing there or that it lies too
  deep (L2, `follow_opened`). Every hop is one level of the query's depth, so a chain of hops ends there, a cycle of
  links too (L3, `follow_height`).
-/

namespace AvenDB.Ops

mutual
/-- A record read `n` rows down (`ops::cut`): each list of rows below that taken out of the row that holds it, the
    record's own at 0; an empty list stays, as it holds nothing to read. -/
def Doc.cut : Nat → Doc → Doc
  | _, [] => []
  | n, (f, .leaf v) :: d => (f, .leaf v) :: Doc.cut n d
  | 0, (f, .rows []) :: d => (f, .rows []) :: Doc.cut 0 d
  | 0, (_, .rows (_ :: _)) :: d => Doc.cut 0 d
  | n + 1, (f, .rows rs) :: d => (f, .rows (Rows.cut n rs)) :: Doc.cut (n + 1) d

/-- The rows `rs`, each read `n` rows down. -/
def Rows.cut : Nat → List Row → List Row
  | _, [] => []
  | n, .mk i fs :: rs => .mk i (Doc.cut n fs) :: Rows.cut n rs
end

end AvenDB.Ops

namespace AvenDB.Links

open AvenDB.Ops

/-- A link: an entry of a vault, maybe a row of it (each list's field and its row's id, in turn: none for the whole
    record), maybe the version it is pinned at (its writes: none for the newest). -/
structure Link where
  vault : Nat
  entry : Nat
  row    : List (String × Int) := []
  pinned : List Nat := []
  deriving DecidableEq, Repr

/-- Why a hop shows nothing. -/
inductive Why where
  /-- The reader opens no such entry: none of its shares reaches it, or it holds no key that opens it. -/
  | noEntry
  /-- The entry is another vault's than the link names. -/
  | wrongVault
  /-- The reader holds no such version of the entry. -/
  | noVersion
  /-- The entry holds no such row. -/
  | noRow
  /-- Deeper than the query reads. -/
  | deep
  deriving DecidableEq, Repr

/-- What a reader opens of a link: the record there and its links, each by its field, or why it opens none. -/
abbrev Opens := Link → Except Why (Doc × List (String × Link))

mutual
/-- What a query shows of a link: the record the hop opened and what it shows of each of that record's links, or why
    it shows nothing. -/
inductive Shown where
  | hop   (l : Link) (d : Doc) (next : Next)
  | empty (l : Link) (why : Why)

/-- What a hop shows of the links of the record it opened: one it follows, shown in turn, or one it leaves as it is. -/
inductive Next where
  | done
  | follows (f : String) (s : Shown) (rest : Next)
  | leaves  (f : String) (l : Link) (rest : Next)
end

/-- The links of a record, each followed (`some`) or left (`none`). -/
def Next.of : List (String × Link × Option Shown) → Next
  | [] => .done
  | (f, _, some s) :: xs => .follows f s (Next.of xs)
  | (f, l, none) :: xs => .leaves f l (Next.of xs)

/-- Link `l` followed `n` levels deep, at the fields `fs` of each record a hop opens: none at 0; else what the reader
    opens of it, read `n - 1` rows down, and each of its links at those fields followed `n - 1` levels deep. -/
def follow (opens : Opens) (fs : List String) : Nat → Link → Shown
  | 0, l => .empty l .deep
  | n + 1, l => match opens l with
    | .error w => .empty l w
    | .ok (d, ls) => .hop l (d.cut n) (Next.of (ls.map fun (f, l') =>
        (f, l', if fs.contains f then some (follow opens fs n l') else none)))

mutual
/-- How many hops deep it goes. -/
def Shown.height : Shown → Nat
  | .empty .. => 0
  | .hop _ _ next => next.height + 1

def Next.height : Next → Nat
  | .done => 0
  | .follows _ s rest => max s.height rest.height
  | .leaves _ _ rest => rest.height
end

mutual
/-- Each hop shows what the reader opened of its link, read some rows down, or why it opened nothing there, or that
    it lies too deep. -/
def Shown.opened (opens : Opens) : Shown → Prop
  | .empty l w => w = .deep ∨ opens l = .error w
  | .hop l d next => (∃ e ls m, opens l = .ok (e, ls) ∧ d = e.cut m) ∧ next.opened opens

def Next.opened (opens : Opens) : Next → Prop
  | .done => True
  | .follows _ s rest => s.opened opens ∧ rest.opened opens
  | .leaves _ _ rest => rest.opened opens
end

theorem Next.of_height (xs : List (String × Link × Option Shown)) (n : Nat)
    (h : ∀ x ∈ xs, ∀ s, x.2.2 = some s → s.height ≤ n) : (Next.of xs).height ≤ n := by
  induction xs with
  | nil => simp [Next.of, Next.height]
  | cons x xs ih =>
    obtain ⟨f, l, o⟩ := x
    have rest := ih fun y hy => h y (List.mem_cons_of_mem _ hy)
    cases o with
    | none => simpa [Next.of, Next.height] using rest
    | some s =>
      have hs := h (f, l, some s) (List.mem_cons_self ..) s rfl
      simp only [Next.of, Next.height]
      omega

theorem Next.of_opened (opens : Opens) (xs : List (String × Link × Option Shown))
    (h : ∀ x ∈ xs, ∀ s, x.2.2 = some s → s.opened opens) : (Next.of xs).opened opens := by
  induction xs with
  | nil => simp [Next.of, Next.opened]
  | cons x xs ih =>
    obtain ⟨f, l, o⟩ := x
    have rest := ih fun y hy => h y (List.mem_cons_of_mem _ hy)
    cases o with
    | none => simpa [Next.of, Next.opened] using rest
    | some s => exact ⟨h (f, l, some s) (List.mem_cons_self ..) s rfl, rest⟩

/-- L1: a hop the reader opens nothing of shows nothing, and why. -/
theorem follow_refused (opens : Opens) (fs : List String) (n : Nat) (l : Link) (w : Why)
    (h : opens l = .error w) : follow opens fs (n + 1) l = .empty l w := by
  simp [follow, h]

/-- L2: every record a query shows through links is one the reader opened, and every hop that shows nothing says why
    the reader opened nothing there, or that it lies too deep. -/
theorem follow_opened (opens : Opens) (fs : List String) (n : Nat) (l : Link) :
    (follow opens fs n l).opened opens := by
  induction n generalizing l with
  | zero => simp [follow, Shown.opened]
  | succ n ih =>
    simp only [follow]
    split
    · next w h => exact Or.inr h
    · next d ls h =>
      refine ⟨⟨d, ls, n, h, rfl⟩, Next.of_opened opens _ ?_⟩
      intro x hx s hs
      obtain ⟨⟨f, l'⟩, _, rfl⟩ := List.mem_map.1 hx
      dsimp only at hs
      split at hs
      · cases hs
        exact ih l'
      · cases hs

/-- L3: a query follows links no deeper than its depth: a chain of hops ends there, a cycle of links too. -/
theorem follow_height (opens : Opens) (fs : List String) (n : Nat) (l : Link) :
    (follow opens fs n l).height ≤ n := by
  induction n generalizing l with
  | zero => simp [follow, Shown.height]
  | succ n ih =>
    simp only [follow]
    split
    · simp [Shown.height]
    · simp only [Shown.height, Nat.add_le_add_iff_right]
      apply Next.of_height
      intro x hx s hs
      obtain ⟨⟨f, l'⟩, _, rfl⟩ := List.mem_map.1 hx
      dsimp only at hs
      split at hs
      · cases hs
        exact ih l'
      · cases hs

end AvenDB.Links
