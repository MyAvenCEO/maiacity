/-!
# Indexes on the shelf

The rule of every index a node keeps of a log (the index gate, Samuel 2026-10-27): an index is a derivation of the log
and nothing more (`derive`), kept on the node's one shelf as content-addressed pages, never in a store of its own;
it is updated on the same path as the log append, and stamped with the head of the log it reflects (`Slot`). A node
that opens an index checks the stamp against its log: where the stamp names a prefix of the log, it steps the rest of
the log on the index (catch up); else it builds the index again from the log (rebuild). It never reads an index that
is not of its log. This is the Rust `shelf_index` module (`avendb-net/src/shelf_index.rs`).

- I1: an index of a longer log is the index of its prefix with the rest stepped on (`I1_catch_up`).
- I2: where no two prefixes of a log have one stamp (`Sound`), opening an honest slot gives the index of the whole
  log, whether it catches up or rebuilds (`I2_open`); with no slot, it rebuilds (`I2_open_none`).
- I3: a crash at any point of a write leaves the log and the slots the node kept before, or with the new one; a torn
  slot, or a page that doesn't read whole, reads as no slot. Every slot the node ever kept is honest, so whichever
  opens, the node opens the index of its log (`I3_crash`). A log rewritten from a place (a withdrawal) is no other
  case: the stamp names no prefix of it, so the node rebuilds.
- I4: the tree's root is a function of the index alone (`root_canonical`), so the root of an index stepped on page by
  page is the root of one built from scratch, and two nodes that hold the same log hold the same root (`I4_same_root`).
- The one exception, written here so the gate names it: a device's key index (`KeyIndexed` in `lab.rs`) is a memo of
  its stepped replay, kept in memory alone and made again at a start, as making it (85 ms of a phone's 116,000 edits,
  reading no box's bytes) costs less than reading it back; it is made again only where the replay replayed every edit.
- I5: an index a node fetched from a peer is a hint: it reads through it only once its root is the root of the index it
  builds from its own log (`trusted`), and then it reads what its own log says (`I5_trusted_reads`).
-/

namespace AvenDB.ShelfIndex

/-- An index: what it holds under each key. -/
abbrev Index (K V : Type) := K → Option V

/-- The empty index. -/
def empty {K V : Type} : Index K V := fun _ => none

/-- A change to one row: the value it holds from now on, or none. -/
def setRow {K V : Type} [DecidableEq K] (ix : Index K V) (r : K × Option V) : Index K V :=
  fun k => if k = r.1 then r.2 else ix k

/-- What an index says of a log: the rows each entry changes (`rows`), applied one by one, in the log's order. -/
structure Derive (E K V : Type) where
  rows : E → List (K × Option V)

variable {E K V H R : Type} [DecidableEq K]

/-- One entry stepped on an index. -/
def step (d : Derive E K V) (ix : Index K V) (e : E) : Index K V :=
  (d.rows e).foldl setRow ix

/-- The index of a log, built from scratch. -/
def derive (d : Derive E K V) (log : List E) : Index K V :=
  log.foldl (step d) empty

/-- Entries stepped on an index. -/
def catchUp (d : Derive E K V) (ix : Index K V) (more : List E) : Index K V :=
  more.foldl (step d) ix

/-- I1: an index of a longer log is the index of its prefix with the rest stepped on. -/
theorem I1_catch_up (d : Derive E K V) (log more : List E) :
    derive d (log ++ more) = catchUp d (derive d log) more := by
  simp [derive, catchUp, List.foldl_append]

/-- What a node keeps beside the pages, in its slot: how many entries of the log the index reflects, the stamp of that
    prefix (the log's head there), and the index the pages hold. -/
structure Slot (K V H : Type) where
  len : Nat
  head : H
  ix : Index K V

/-- A slot is honest: it holds the index of the prefix it names, under that prefix's stamp. Every slot a node keeps
    is: it writes the pages and then the slot, of the log it just appended. -/
def Honest (d : Derive E K V) (stamp : List E → H) (s : Slot K V H) : Prop :=
  ∃ p : List E, s.len = p.length ∧ s.head = stamp p ∧ s.ix = derive d p

/-- Two prefixes with one stamp are one: the head is a hash with no collision. -/
def Sound (stamp : List E → H) : Prop :=
  ∀ p q, stamp p = stamp q → p = q

/-- What a node opens: the slot's index caught up with the rest of the log where the slot's stamp is the stamp of the
    log's prefix as long; else the index built again from the log. -/
def openSlot [DecidableEq H] (d : Derive E K V) (stamp : List E → H) (log : List E) :
    Option (Slot K V H) → Index K V
  | some s => if s.len ≤ log.length ∧ stamp (log.take s.len) = s.head then catchUp d s.ix (log.drop s.len)
      else derive d log
  | none => derive d log

/-- I2: opening an honest slot gives the index of the whole log. -/
theorem I2_open [DecidableEq H] (d : Derive E K V) (stamp : List E → H) (hs : Sound stamp) (log : List E)
    (s : Slot K V H) (hh : Honest d stamp s) : openSlot d stamp log (some s) = derive d log := by
  obtain ⟨p, _, hhead, hix⟩ := hh
  simp only [openSlot]
  split
  · rename_i hc
    have hp : log.take s.len = p := hs _ _ (hc.2.trans hhead)
    rw [hix, ← hp, ← I1_catch_up, List.take_append_drop]
  · rfl

/-- I2, no slot: the node builds the index from its log. -/
theorem I2_open_none [DecidableEq H] (d : Derive E K V) (stamp : List E → H) (log : List E) :
    openSlot d stamp log none = derive d log := rfl

/-- I3: whatever a crash leaves, the slot the node finds is one it kept, every one of them honest, or none (a torn
    slot or a page that doesn't read whole); either way it opens the index of its log, of any log it holds then. -/
theorem I3_crash [DecidableEq H] (d : Derive E K V) (stamp : List E → H) (hs : Sound stamp)
    (kept : List (Slot K V H)) (hk : ∀ s ∈ kept, Honest d stamp s) (found : Option (Slot K V H))
    (hf : ∀ s, found = some s → s ∈ kept) (log : List E) :
    openSlot d stamp log found = derive d log := by
  cases found with
  | none => rfl
  | some s => exact I2_open d stamp hs log s (hk s (hf s rfl))

/-- The tree's root: a function of the index alone (the Rust tree cuts its pages where a key's hash says, never where
    the writes fell, so its shape is the rows' alone). -/
abbrev root (build : Index K V → R) (ix : Index K V) : R := build ix

omit [DecidableEq K] in
/-- Equal indexes have one root. -/
theorem root_canonical (build : Index K V → R) {ix ix' : Index K V} (h : ix = ix') : root build ix = root build ix' :=
  congrArg build h

/-- I4: the root of an index caught up from an honest slot is the root of the index built from scratch, so two nodes
    that hold one log hold one root, whatever slots each kept. -/
theorem I4_same_root [DecidableEq H] (d : Derive E K V) (stamp : List E → H) (hs : Sound stamp) (build : Index K V → R)
    (log : List E) (s s' : Option (Slot K V H)) (hh : ∀ x, s = some x → Honest d stamp x)
    (hh' : ∀ x, s' = some x → Honest d stamp x) :
    root build (openSlot d stamp log s) = root build (openSlot d stamp log s') := by
  have e : ∀ t : Option (Slot K V H), (∀ x, t = some x → Honest d stamp x) → openSlot d stamp log t = derive d log := by
    intro t ht
    cases t with
    | none => rfl
    | some x => exact I2_open d stamp hs log x (ht x rfl)
  rw [e s hh, e s' hh']

/-- An index fetched from a peer is trusted where its root is the root of the index the node builds from its own log. -/
def trusted [DecidableEq R] (build : Index K V → R) (d : Derive E K V) (log : List E) (fetched : Index K V) : Bool :=
  decide (root build fetched = root build (derive d log))

/-- I5: where the root has no collision (`build` is one to one), a trusted index reads what the node's own log says. -/
theorem I5_trusted_reads [DecidableEq R] (build : Index K V → R) (hb : ∀ a b, build a = build b → a = b)
    (d : Derive E K V) (log : List E) (fetched : Index K V) (ht : trusted build d log fetched = true) :
    ∀ k, fetched k = derive d log k := by
  simp only [trusted, decide_eq_true_eq] at ht
  have := hb _ _ ht
  intro k
  rw [this]

/-! ## The log's one head

The one stamp of a device's log (`Log::head`, `avendb/src/log_head.rs`), which every index of it is stamped with: a
hash over its entries in one stream from a seed, an entry at a time (`chain`). The head of a longer log goes on from
the head of its prefix (`chain_append`), so the log keeps its head as it appends, hashing each entry once; and from
the stream's state kept at every `k`th entry (a mark), the head of any prefix goes on from the mark at or before it
(`chain_from_mark`), never from the first entry. A log rewritten from a place (a withdrawal) works its head out again:
none of its marks after that place is of it. -/

/-- The stream's state after `log`, from `seed`, an entry at a time. -/
def chain {S : Type} (link : S → E → S) (seed : S) (log : List E) : S :=
  log.foldl link seed

/-- The head of a longer log goes on from its prefix's. -/
theorem chain_append {S : Type} (link : S → E → S) (seed : S) (p q : List E) :
    chain link seed (p ++ q) = chain link (chain link seed p) q := by
  simp [chain, List.foldl_append]

/-- The state after the first `n` entries is the state after the first `m ≤ n` (a mark) gone on with the entries
    between: what `Log::head_at` works out from the mark before `n`. -/
theorem chain_from_mark {S : Type} (link : S → E → S) (seed : S) (log : List E) {m n : Nat} (h : m ≤ n) :
    chain link (chain link seed (log.take m)) ((log.take n).drop m) = chain link seed (log.take n) := by
  have hm : (log.take n).take m = log.take m := by
    rw [List.take_take, Nat.min_eq_left h]
  rw [← chain_append, ← hm, List.take_append_drop]

end AvenDB.ShelfIndex
