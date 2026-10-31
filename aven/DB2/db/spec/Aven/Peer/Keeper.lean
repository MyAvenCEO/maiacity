import Aven.DB.Wire

/-!
# A keeper's arrivals: what it holds of one Doc, numbered as it came (PEERS.md §3 and §4; docs, "Catching up")

A keeper keeps a Doc's sealed bytes for its readers (A22) and can read none of them: it sees `{ct, doc, epoch, nonce,
commit}` and nothing else. Whether it may take an upload or serve a fetch at all is avenID's gate (`Aven.ID.Keep`:
`Keep.serves`, `admit`, `Books.keeps`); this model is what it does with the bytes it took.

**Items by their sealed hash, numbered by arrival.** Each sealed thing the keeper takes, a segment or a loose envelope,
is an item named by the hash of its sealed bytes. A new item gets the Doc's next arrival number, from 1, never reused
(`numbers_fresh`, `Store.wf`); the same bytes again get no new number, only another uploader.

**Covers: the uploader's own word, binding only its own uploads** (the gap in `Aven.DB.Docs.Segment`, settled
31 Oct 2026, A44). A segment holds its loose envelopes by their names, the hashes of their signed plaintext, which a keeper
can't see. So the keeper records which devices uploaded each item (the door knows every connection's device), and a
segment's upload names, in the clear, the sealed hashes of the loose envelopes it holds: its `covers`. A cover takes
off an item's uploaders only the device that uploaded the segment, and an item is dropped once no uploader is left.
- every item dropped was covered, by each device that ever uploaded it, by an item the keeper still holds
  (`dropped_covered`);
- a device's upload never takes another device off any item (`cover_own`), so a reader can't make a keeper drop
  someone else's envelopes, and a lie hurts only the liar's own uploads, which it could have withheld anyway;
- a writer that never comes back covers nothing, so what it uploaded stays, whatever anyone else uploads
  (`gone_writer_kept`, architecture scenario 16);
- the item uploaded is held after its own upload, whatever it covers (`put_held`);
- a dropped item stays reachable through the item that covered it: a reader that hadn't got the dropped item gets
  the covering one by asking what came after its number, or already holds it (`dropped_listed`). That the covering
  segment really holds the dropped envelopes is the uploader's word: it holds while the uploader is honest, and a lie
  loses only the liar's own envelopes.

The covers count only for the device whose proof authenticates the upload on that connection (`Aven.ID.Keep`,
`served_current`). They are upload metadata beside the sealed segment, never part of its bytes: the seal's outside
stays `{ct, doc, epoch, nonce, commit}` (D13), and covers tell the keeper nothing it couldn't link from the uploads
themselves, which device sent which bytes. Covers only decide which loose items a keeper may drop early while it keeps
the Doc: a withdrawn keep cap or a deleted Doc drops every item at once, whoever uploaded it (`withdrawn_dropped`,
`deleted_gone`). An item stays on its uploaders' bills while kept (`uploader_pays`), so a writer that never comes back
keeps paying for its loose envelopes. Decided under A44 (ARCHITECTURE.md, #1721).

**Catching up: "what came after your number n?"** (`after`). The answer lists exactly the items held with a number
above `n`, by number and hash (`after_complete`), in pages of at most `pageSize`, none empty (`after_pages`): every
page moves the device forward (README, rule 3). A device then fetches the hashes it lacks as one hash sequence, lands
the page in one write and imports it in one batch (docs, "Catching up", items 1, 3 to 5). Numbers dropped leave holes;
a device that held a dropped loose envelope already has it, and one that didn't gets the segment that covered it, which
came after it and so has a higher number.
-/

namespace Aven.Peer.Keeper

-- the wire's paging, the Peers' own: `Aven.DB.Wire` moves into `Aven.Peer` with thread E (A45)
open Aven.DB (pages pageSize pages_flatten pages_ne_nil)

/-- An item a keeper holds of one Doc: its arrival number, the hash of its sealed bytes, their length, and the devices
that uploaded it and haven't covered it since. -/
structure Item where
  n : Nat
  hash : Nat
  bytes : Nat
  uploaders : List String
  deriving DecidableEq, Repr

/-- What a keeper holds of one Doc: the next arrival number, and the items, oldest first. -/
structure Store where
  next : Nat := 1
  items : List Item := []
  deriving DecidableEq, Repr

/-- One sealed thing in an upload: its hash, its length, and the hashes of the loose envelopes it covers (a segment's;
none for a loose envelope). -/
structure Put where
  hash : Nat
  bytes : Nat
  covers : List Nat := []
  deriving DecidableEq, Repr

namespace Store

/-- The keeper holds an item with this hash. -/
def holds (s : Store) (h : Nat) : Bool := s.items.any (·.hash == h)

/-- Take `p` from device `d`: the same bytes again add `d` to its uploaders; new bytes get the next number. -/
def add (s : Store) (d : String) (p : Put) : Store :=
  if s.holds p.hash then
    { s with items := s.items.map fun i =>
        if i.hash == p.hash && !i.uploaders.contains d then { i with uploaders := i.uploaders ++ [d] } else i }
  else { next := s.next + 1, items := s.items ++ [⟨s.next, p.hash, p.bytes, [d]⟩] }

/-- Device `d`'s covers: it comes off the uploaders of every item `p` covers but `p` itself, and an item no uploader
is left on is dropped. -/
def cover (s : Store) (d : String) (p : Put) : Store :=
  { s with items := (s.items.map fun i =>
      if p.covers.contains i.hash && i.hash != p.hash then { i with uploaders := i.uploaders.filter (· != d) } else i)
    |>.filter (!·.uploaders.isEmpty) }

/-- Take one sealed thing from device `d`: hold it, then apply its covers. -/
def put (s : Store) (d : String) (p : Put) : Store := (s.add d p).cover d p

/-- Take an upload from device `d`, its items in order: one write of the Doc's ref at the keeper. -/
def upload (s : Store) (d : String) (ps : List Put) : Store := ps.foldl (fun s p => s.put d p) s

/-- What came after number `n`: the items held numbered above it, by number and hash, oldest first. -/
def afterAll (s : Store) (n : Nat) : List (Nat × Nat) := (s.items.filter (n < ·.n)).map fun i => (i.n, i.hash)

/-- The answer to "what came after your number n?", in pages of at most `pageSize`. -/
def after (s : Store) (n : Nat) : List (List (Nat × Nat)) := pages pageSize (s.afterAll n)

/-- A store is well formed: numbers strictly increase, each below `next`, and every item has an uploader. -/
def wf (s : Store) : Prop :=
  s.items.Pairwise (·.n < ·.n) ∧ (∀ i ∈ s.items, i.n < s.next) ∧ (∀ i ∈ s.items, i.uploaders ≠ [])

theorem holds_iff {s : Store} {h : Nat} : s.holds h = true ↔ ∃ i ∈ s.items, i.hash = h := by
  simp [holds]

/-! ### Adding -/

theorem add_next_le (s : Store) (d : String) (p : Put) : s.next ≤ (s.add d p).next := by
  unfold add; split <;> simp

/-- An item of the store after adding: an item before, maybe with `d` added, or the new one. -/
theorem mem_add {s : Store} {d : String} {p : Put} {j : Item} (m : j ∈ (s.add d p).items) :
    (∃ i ∈ s.items, j.n = i.n ∧ j.hash = i.hash ∧ j.bytes = i.bytes ∧ (∀ x, x ∈ i.uploaders → x ∈ j.uploaders) ∧
      (∀ x, x ∈ j.uploaders → x ∈ i.uploaders ∨ x = d)) ∨
    (s.holds p.hash = false ∧ j = ⟨s.next, p.hash, p.bytes, [d]⟩) := by
  unfold add at m
  split at m
  · left
    simp only [List.mem_map] at m
    obtain ⟨i, mi, e⟩ := m
    refine ⟨i, mi, ?_⟩
    split at e <;> subst e
    · refine ⟨rfl, rfl, rfl, fun x hx => List.mem_append_left _ hx, fun x hx => ?_⟩
      rcases List.mem_append.mp hx with hx | hx
      · exact .inl hx
      · exact .inr (List.mem_singleton.mp hx)
    · exact ⟨rfl, rfl, rfl, fun _ h => h, fun _ h => .inl h⟩
  · rename_i nh
    rcases List.mem_append.mp m with m | m
    · left; exact ⟨j, m, rfl, rfl, rfl, fun _ h => h, fun _ h => .inl h⟩
    · right; exact ⟨by simpa using nh, List.mem_singleton.mp m⟩

/-- After adding, the item added is held, with `d` among its uploaders. -/
theorem add_held (s : Store) (d : String) (p : Put) : ∃ j ∈ (s.add d p).items, j.hash = p.hash ∧ d ∈ j.uploaders := by
  unfold add
  split
  · rename_i hh
    obtain ⟨i, mi, hi⟩ := holds_iff.mp hh
    refine ⟨_, List.mem_map_of_mem mi, ?_⟩
    by_cases c : i.uploaders.contains d
    · simp_all
    · simp_all
  · exact ⟨_, List.mem_append_right _ (List.mem_singleton_self _), rfl, List.mem_singleton_self d⟩

/-- Every item held before adding is held after, by the same number, with every uploader it had. -/
theorem add_keeps {s : Store} {d : String} {p : Put} {i : Item} (m : i ∈ s.items) :
    ∃ j ∈ (s.add d p).items, j.n = i.n ∧ j.hash = i.hash ∧ ∀ x, x ∈ i.uploaders → x ∈ j.uploaders := by
  unfold add
  split
  · refine ⟨_, List.mem_map_of_mem m, ?_⟩
    split
    · exact ⟨rfl, rfl, fun x h => List.mem_append_left _ h⟩
    · exact ⟨rfl, rfl, fun _ h => h⟩
  · exact ⟨i, List.mem_append_left _ m, rfl, rfl, fun _ h => h⟩

theorem add_wf {s : Store} (w : s.wf) (d : String) (p : Put) : (s.add d p).wf := by
  obtain ⟨pw, lt, ne⟩ := w
  unfold add
  split
  · refine ⟨?_, ?_, ?_⟩
    · rw [List.pairwise_map]
      refine pw.imp fun {a b} h => ?_
      split <;> split <;> exact h
    · intro j mj
      simp only [List.mem_map] at mj
      obtain ⟨i, mi, rfl⟩ := mj
      split <;> exact lt i mi
    · intro j mj
      simp only [List.mem_map] at mj
      obtain ⟨i, mi, rfl⟩ := mj
      split
      · simp
      · exact ne i mi
  · refine ⟨?_, ?_, ?_⟩
    · rw [List.pairwise_append]
      refine ⟨pw, List.pairwise_singleton _ _, fun a ma b mb => ?_⟩
      rw [List.mem_singleton] at mb
      subst mb
      exact lt a ma
    · intro j mj
      rcases List.mem_append.mp mj with mj | mj
      · exact Nat.lt_succ_of_lt (lt j mj)
      · rw [List.mem_singleton.mp mj]; exact Nat.lt_succ_self _
    · intro j mj
      rcases List.mem_append.mp mj with mj | mj
      · exact ne j mj
      · rw [List.mem_singleton.mp mj]; simp

/-! ### Covering -/

theorem cover_next (s : Store) (d : String) (p : Put) : (s.cover d p).next = s.next := rfl

/-- An item after covering: one before, the same but maybe with `d` taken off, if `p` covers it. -/
theorem mem_cover {s : Store} {d : String} {p : Put} {j : Item} (m : j ∈ (s.cover d p).items) :
    ∃ i ∈ s.items, j.n = i.n ∧ j.hash = i.hash ∧ j.bytes = i.bytes ∧ j.uploaders ≠ [] ∧
      (∀ x, x ∈ j.uploaders → x ∈ i.uploaders) ∧ (∀ x, x ∈ i.uploaders → x ≠ d → x ∈ j.uploaders) ∧
      (∀ x, x ∈ i.uploaders → x ∉ j.uploaders → x = d ∧ p.covers.contains i.hash = true ∧ i.hash ≠ p.hash) := by
  simp only [cover, List.mem_filter, List.mem_map, Bool.not_eq_true', List.isEmpty_eq_false_iff] at m
  obtain ⟨⟨i, mi, e⟩, ne⟩ := m
  refine ⟨i, mi, ?_⟩
  split at e <;> subst e
  · rename_i c
    simp only [Bool.and_eq_true, bne_iff_ne, ne_eq] at c
    refine ⟨rfl, rfl, rfl, ne, fun x hx => (List.mem_filter.mp hx).1, fun x hx xd => ?_, fun x hx nx => ?_⟩
    · exact List.mem_filter.mpr ⟨hx, by simpa using xd⟩
    · by_cases xd : x = d
      · exact ⟨xd, c.1, c.2⟩
      · exact absurd (List.mem_filter.mpr ⟨hx, by simpa using xd⟩) nx
  · exact ⟨rfl, rfl, rfl, ne, fun _ h => h, fun _ h _ => h, fun _ h n => absurd h n⟩

/-- An item covering keeps: one with an uploader other than `d`, or one `p` doesn't cover, or `p` itself. -/
theorem cover_keeps {s : Store} {d : String} {p : Put} {i : Item} (m : i ∈ s.items)
    (stays : (∃ x ∈ i.uploaders, x ≠ d) ∨ (p.covers.contains i.hash = false ∧ i.uploaders ≠ []) ∨
      (i.hash = p.hash ∧ i.uploaders ≠ [])) :
    ∃ j ∈ (s.cover d p).items, j.n = i.n ∧ j.hash = i.hash ∧ ∀ x, x ∈ i.uploaders → x ≠ d → x ∈ j.uploaders := by
  simp only [cover, List.mem_filter, List.mem_map, Bool.not_eq_true', List.isEmpty_eq_false_iff]
  by_cases c : (p.covers.contains i.hash && i.hash != p.hash) = true
  · refine ⟨{ i with uploaders := i.uploaders.filter (· != d) }, ⟨⟨i, m, ite_eq_left c⟩, ?_⟩, rfl, rfl,
      fun x hx xd => List.mem_filter.mpr ⟨hx, by simpa using xd⟩⟩
    rcases stays with ⟨x, hx, xd⟩ | ⟨nc, _⟩ | ⟨e, _⟩
    · exact List.ne_nil_of_mem (List.mem_filter.mpr ⟨hx, by simpa using xd⟩)
    · rw [nc, Bool.false_and] at c; exact absurd c Bool.false_ne_true
    · rw [e, bne_self_eq_false, Bool.and_false] at c; exact absurd c Bool.false_ne_true
  · have ne : i.uploaders ≠ [] := by
      rcases stays with ⟨x, hx, _⟩ | ⟨_, ne⟩ | ⟨_, ne⟩
      · exact List.ne_nil_of_mem hx
      · exact ne
      · exact ne
    exact ⟨i, ⟨⟨i, m, ite_eq_right c⟩, ne⟩, rfl, rfl, fun _ h _ => h⟩

theorem cover_wf {s : Store} (w : s.wf) (d : String) (p : Put) : (s.cover d p).wf := by
  obtain ⟨pw, lt, _⟩ := w
  refine ⟨?_, fun j mj => ?_, fun j mj => ?_⟩
  · refine List.Pairwise.filter _ ?_
    rw [List.pairwise_map]
    refine pw.imp fun {a b} h => ?_
    split <;> split <;> exact h
  · obtain ⟨i, mi, e, -⟩ := mem_cover mj
    rw [e, cover_next]
    exact lt i mi
  · exact (mem_cover mj).choose_spec.2.2.2.2.1

/-! ### Putting -/

theorem put_wf {s : Store} (w : s.wf) (d : String) (p : Put) : (s.put d p).wf := cover_wf (add_wf w d p) d p

theorem upload_wf : ∀ {s : Store} (_ : s.wf) (d : String) (ps : List Put), (s.upload d ps).wf
  | _, w, _, [] => w
  | _, w, d, p :: ps => upload_wf (put_wf w d p) d ps

/-- `p` itself is never covered by its own upload: an item with its hash passes covering untouched. -/
theorem cover_self {s : Store} {d : String} {p : Put} {i : Item} (m : i ∈ s.items) (e : i.hash = p.hash)
    (ne : i.uploaders ≠ []) : i ∈ (s.cover d p).items := by
  simp only [cover, List.mem_filter, List.mem_map, Bool.not_eq_true', List.isEmpty_eq_false_iff]
  exact ⟨⟨i, m, by simp [e]⟩, ne⟩

/-- **`put_held`:** the item uploaded is held after its own upload, whatever it covers, with its uploader on it. -/
theorem put_held (s : Store) (d : String) (p : Put) : ∃ j ∈ (s.put d p).items, j.hash = p.hash ∧ d ∈ j.uploaders := by
  obtain ⟨i, mi, hi, di⟩ := add_held s d p
  exact ⟨i, cover_self mi hi (List.ne_nil_of_mem di), hi, di⟩

/-- An item covering drops: `d` was its only uploader, `p` covers it, and it isn't `p`. -/
theorem cover_drops {s : Store} {d : String} {p : Put} {i : Item} (m : i ∈ s.items) (ne : i.uploaders ≠ [])
    (gone : ∀ j ∈ (s.cover d p).items, j.n ≠ i.n) :
    (∀ x ∈ i.uploaders, x = d) ∧ p.covers.contains i.hash = true ∧ i.hash ≠ p.hash := by
  refine ⟨fun x hx => ?_, ?_, fun e => ?_⟩
  · refine Classical.byContradiction fun xd => ?_
    obtain ⟨j, mj, nj, -⟩ := cover_keeps (p := p) m (.inl ⟨x, hx, xd⟩)
    exact gone j mj nj
  · cases c : p.covers.contains i.hash
    · obtain ⟨j, mj, nj, -⟩ := cover_keeps (p := p) (d := d) m (.inr (.inl ⟨c, ne⟩))
      exact absurd nj (gone j mj)
    · rfl
  · exact gone i (cover_self m e ne) rfl

/-- **`dropped_covered`:** an item a put drops had only the putting device as its uploader, and the put covers it;
the item that covered it is held (`put_held`). Since a device comes off an item only by its own cover (`mem_cover`),
every device that ever uploaded a dropped item covered it. -/
theorem dropped_covered {s : Store} (w : s.wf) {d : String} {p : Put} {i : Item} (m : i ∈ s.items)
    (gone : ∀ j ∈ (s.put d p).items, j.n ≠ i.n) :
    (∀ x ∈ i.uploaders, x = d) ∧ p.covers.contains i.hash = true ∧ i.hash ≠ p.hash := by
  obtain ⟨k, mk, nk, hk, up⟩ := add_keeps (d := d) (p := p) m
  have ne : k.uploaders ≠ [] := (add_wf w d p).2.2 k mk
  obtain ⟨all, c, np⟩ := cover_drops mk ne (fun j mj e => gone j mj (e.trans nk))
  exact ⟨fun x hx => all x (up x hx), hk ▸ c, hk ▸ np⟩

/-- **`numbers_fresh`:** an item new to the keeper gets the Doc's next number, and numbers only grow. -/
theorem numbers_fresh (s : Store) (d : String) (p : Put) (nh : s.holds p.hash = false) :
    ∃ j ∈ (s.put d p).items, j.n = s.next ∧ j.hash = p.hash ∧ (s.put d p).next = s.next + 1 := by
  have mi : (⟨s.next, p.hash, p.bytes, [d]⟩ : Item) ∈ (s.add d p).items := by
    simp [add, nh]
  obtain ⟨j, mj, nj, hj, -⟩ := cover_keeps (p := p) (d := d) mi (.inr (.inr ⟨rfl, by simp⟩))
  exact ⟨j, mj, nj, hj, by simp [put, cover_next, add, nh]⟩

/-- **`cover_own`:** device `d`'s upload never takes another device off any item: every item held with an uploader
other than `d` is held after, by the same number, with that uploader still on it. -/
theorem cover_own {s : Store} {d x : String} (xd : x ≠ d) {i : Item} (m : i ∈ s.items) (hx : x ∈ i.uploaders) (p : Put) :
    ∃ j ∈ (s.put d p).items, j.n = i.n ∧ j.hash = i.hash ∧ x ∈ j.uploaders := by
  obtain ⟨k, mk, nk, hk, up⟩ := add_keeps (d := d) (p := p) m
  obtain ⟨j, mj, nj, hj, up'⟩ := cover_keeps (p := p) mk (.inl ⟨x, up x hx, xd⟩)
  exact ⟨j, mj, nj.trans nk, hj.trans hk, up' x (up x hx) xd⟩

/-- **`gone_writer_kept`:** what a device uploaded stays, however many uploads of other devices come after: a writer
that never comes back leaves nothing unreachable (architecture, scenario 16). -/
theorem gone_writer_kept {x : String} : ∀ (ups : List (String × List Put)) {s : Store} {i : Item},
    (∀ u ∈ ups, u.1 ≠ x) → i ∈ s.items → x ∈ i.uploaders →
      ∃ j ∈ (ups.foldl (fun s u => s.upload u.1 u.2) s).items, j.n = i.n ∧ j.hash = i.hash ∧ x ∈ j.uploaders
  | [], _, i, _, m, hx => ⟨i, m, rfl, rfl, hx⟩
  | (d, qs) :: ups, s, i, others, m, hx => by
    have one : ∀ (ps : List Put) {s : Store} {i : Item}, i ∈ s.items → x ∈ i.uploaders →
        ∃ j ∈ (s.upload d ps).items, j.n = i.n ∧ j.hash = i.hash ∧ x ∈ j.uploaders := by
      intro ps
      induction ps with
      | nil => intro s i m hx; exact ⟨i, m, rfl, rfl, hx⟩
      | cons p ps ih =>
        intro s i m hx
        obtain ⟨k, mk, nk, hk, xk⟩ := cover_own (Ne.symm (others (d, qs) List.mem_cons_self)) m hx p
        obtain ⟨j, mj, nj, hj, xj⟩ := ih mk xk
        exact ⟨j, mj, nj.trans nk, hj.trans hk, xj⟩
    obtain ⟨k, mk, nk, hk, xk⟩ := one qs m hx
    obtain ⟨j, mj, nj, hj, xj⟩ := gone_writer_kept ups (fun u mu => others u (List.mem_cons_of_mem _ mu)) mk xk
    exact ⟨j, mj, nj.trans nk, hj.trans hk, xj⟩

/-! ### Catching up -/

/-- **`after_complete`:** what came after `n` is exactly the items held numbered above it. -/
theorem after_complete {s : Store} {n m h : Nat} :
    (m, h) ∈ s.afterAll n ↔ ∃ i ∈ s.items, i.n = m ∧ i.hash = h ∧ n < m := by
  simp only [afterAll, List.mem_map, List.mem_filter, decide_eq_true_eq, Prod.mk.injEq]
  constructor
  · rintro ⟨i, ⟨mi, lt⟩, rfl, rfl⟩; exact ⟨i, mi, rfl, rfl, lt⟩
  · rintro ⟨i, mi, rfl, rfl, lt⟩; exact ⟨i, ⟨mi, lt⟩, rfl, rfl⟩

/-- **`after_pages`:** the pages together are what came after `n`, and each holds one to `pageSize` of it: every page
moves the device forward (README, rule 3). -/
theorem after_pages (s : Store) (n : Nat) :
    (s.after n).flatten = s.afterAll n ∧ ∀ q ∈ s.after n, q ≠ [] ∧ q.length ≤ pageSize :=
  ⟨pages_flatten (by decide) _ _ (Nat.le_refl _), pages_ne_nil (by decide) _ _ (Nat.le_refl _)⟩

/-- **`after_sorted`:** in a well formed store, what came after `n` is in arrival order, numbers strictly rising, so
a device keeps the last number of a page as where it is. -/
theorem after_sorted {s : Store} (w : s.wf) (n : Nat) : (s.afterAll n).Pairwise (·.1 < ·.1) := by
  unfold afterAll
  rw [List.pairwise_map]
  exact (w.1.filter _)

/-- **`dropped_listed`:** an item a put drops stays reachable through the item that covered it, which the keeper holds:
a reader whose number is below the dropped item's either holds the covering item already (its number is at most the
reader's) or is told it by what came after its number; and a covering item new to the keeper is numbered after the
dropped one. It holds for every item held before the put, so for the dropped ones (`dropped_covered`). That the
covering segment holds the dropped envelopes is the uploader's word: this holds while the uploader is honest. -/
theorem dropped_listed {s : Store} (w : s.wf) (d : String) (p : Put) {i : Item} (m : i ∈ s.items) :
    ∃ j ∈ (s.put d p).items, j.hash = p.hash ∧ (s.holds p.hash = false → i.n < j.n) ∧
      ∀ n, n < i.n → (j.n, j.hash) ∈ (s.put d p).afterAll n ∨ j.n ≤ n := by
  have reach : ∀ j ∈ (s.put d p).items, ∀ n, n < i.n → (j.n, j.hash) ∈ (s.put d p).afterAll n ∨ j.n ≤ n :=
    fun j mj n _ => if c : n < j.n then .inl (after_complete.mpr ⟨j, mj, rfl, rfl, c⟩) else .inr (Nat.not_lt.mp c)
  cases nh : s.holds p.hash with
  | false =>
    obtain ⟨k, mk, nk, hk, -⟩ := numbers_fresh s d p nh
    exact ⟨k, mk, hk, fun _ => nk ▸ w.2.1 i m, reach k mk⟩
  | true =>
    obtain ⟨j, mj, hj, -⟩ := put_held s d p
    exact ⟨j, mj, hj, fun h => absurd h (by decide), reach j mj⟩

end Store

/-! ## A device catching up from a keeper -/

/-- What a device holds of one Doc from one keeper: the keeper's number it has caught up to, and the sealed hashes it
holds. -/
structure Reader where
  at_ : Nat := 0
  held : List Nat := []
  deriving DecidableEq, Repr

namespace Reader

/-- The hashes of a page the device lacks: what it fetches, as one request. -/
def lacks (r : Reader) (page : List (Nat × Nat)) : List Nat := (page.map (·.2)).filter (!r.held.contains ·)

/-- The largest of `a` and a page's numbers. -/
def upTo (a : Nat) (page : List (Nat × Nat)) : Nat := page.foldl (fun a e => max a e.1) a

/-- A page lands in one write: what it lacked held, and the device at the page's largest number. -/
def land (r : Reader) (page : List (Nat × Nat)) : Reader := { at_ := upTo r.at_ page, held := r.held ++ r.lacks page }

/-- Catching up: ask what came after its number, land each page in turn. -/
def catchUp (r : Reader) (s : Store) : Reader := (s.after r.at_).foldl land r

theorem upTo_ge : ∀ (a : Nat) (page : List (Nat × Nat)), a ≤ upTo a page ∧ ∀ e ∈ page, e.1 ≤ upTo a page
  | a, [] => ⟨Nat.le_refl a, fun _ m => nomatch m⟩
  | a, e :: es => by
    have ⟨ge, all⟩ := upTo_ge (max a e.1) es
    refine ⟨Nat.le_trans (Nat.le_max_left _ _) ge, fun x m => ?_⟩
    rcases List.mem_cons.mp m with rfl | m
    · exact Nat.le_trans (Nat.le_max_right _ _) ge
    · exact all x m

theorem land_holds (r : Reader) (page : List (Nat × Nat)) :
    (∀ h ∈ r.held, h ∈ (r.land page).held) ∧ ∀ e ∈ page, e.2 ∈ (r.land page).held := by
  refine ⟨fun h m => List.mem_append_left _ m, fun e m => ?_⟩
  by_cases c : r.held.contains e.2 = true
  · exact List.mem_append_left _ (List.contains_iff_mem.mp c)
  · refine List.mem_append_right _ (List.mem_filter.mpr ⟨List.mem_map_of_mem m, ?_⟩)
    simpa using c

/-- **`land_progress`:** a page that isn't empty, of numbers above the device's, moves it forward (README, rule 3). -/
theorem land_progress {r : Reader} {page : List (Nat × Nat)} (ne : page ≠ []) (above : ∀ e ∈ page, r.at_ < e.1) :
    r.at_ < (r.land page).at_ := by
  obtain ⟨e, m⟩ := List.exists_mem_of_ne_nil page ne
  exact Nat.lt_of_lt_of_le (above e m) ((upTo_ge r.at_ page).2 e m)

theorem foldl_land : ∀ (ps : List (List (Nat × Nat))) (r : Reader),
    r.at_ ≤ (ps.foldl land r).at_ ∧ (∀ h ∈ r.held, h ∈ (ps.foldl land r).held) ∧
      ∀ e ∈ ps.flatten, e.1 ≤ (ps.foldl land r).at_ ∧ e.2 ∈ (ps.foldl land r).held
  | [], r => ⟨Nat.le_refl _, fun _ m => m, fun _ m => nomatch m⟩
  | p :: ps, r => by
    have ⟨ge, keeps, all⟩ := foldl_land ps (r.land p)
    simp only [List.foldl_cons, List.flatten_cons]
    refine ⟨Nat.le_trans (upTo_ge r.at_ p).1 ge, fun h m => keeps h ((land_holds r p).1 h m), fun e m => ?_⟩
    rcases List.mem_append.mp m with m | m
    · exact ⟨Nat.le_trans ((upTo_ge r.at_ p).2 e m) ge, keeps _ ((land_holds r p).2 e m)⟩
    · exact all e m

/-- **`caught_up_holds`:** after catching up, a device holds every item the keeper held after its number, and
everything it held before. -/
theorem caught_up_holds (r : Reader) (s : Store) :
    (∀ h ∈ r.held, h ∈ (r.catchUp s).held) ∧ ∀ e ∈ s.afterAll r.at_, e.2 ∈ (r.catchUp s).held := by
  have ⟨_, keeps, all⟩ := foldl_land (s.after r.at_) r
  refine ⟨keeps, fun e m => (all e ?_).2⟩
  rw [(Store.after_pages s r.at_).1]
  exact m

/-- **`caught_up_done`:** after catching up, nothing the keeper holds came after the device's number: asking again
gets no page. -/
theorem caught_up_done (r : Reader) (s : Store) : s.afterAll (r.catchUp s).at_ = [] := by
  have ⟨ge, _, all⟩ := foldl_land (s.after r.at_) r
  rw [(Store.after_pages s r.at_).1] at all
  refine List.eq_nil_iff_forall_not_mem.mpr fun ⟨a, b⟩ m => ?_
  obtain ⟨i, mi, rfl, rfl, lt⟩ := Store.after_complete.mp m
  have := (all (i.n, i.hash) (Store.after_complete.mpr ⟨i, mi, rfl, rfl, Nat.lt_of_le_of_lt ge lt⟩)).1
  exact absurd lt (Nat.not_lt.mpr this)

end Reader

/-! ## Examples -/

namespace KeeperExamples

open Store

/-- Bob's Peer-Light writes three loose envelopes, 11, 12, 13; Carol, a reader, relays 12 too and then claims to
cover 11 and 12 with junk 99; Bob closes his segment 50 over 11 to 13. -/
def bobsLoose : Store := ({} : Store).upload "bob" [⟨11, 900, []⟩, ⟨12, 900, []⟩, ⟨13, 900, []⟩]
def carolRelays : Store := bobsLoose.upload "carol" [⟨12, 900, []⟩, ⟨99, 100, [11, 12]⟩]
def bobCloses : Store := carolRelays.upload "bob" [⟨50, 3000, [11, 12, 13]⟩]

-- numbers by arrival: Bob's three, then Carol's 99; her relayed 12 got no number of its own
#guard bobsLoose.afterAll 0 == [(1, 11), (2, 12), (3, 13)]
-- Carol's covers take only Carol off: 11 and 12 stay, 12 still Bob's
#guard carolRelays.afterAll 0 == [(1, 11), (2, 12), (3, 13), (4, 99)]
#guard (carolRelays.items.find? (·.hash == 12)).map (·.uploaders) == some ["bob"]
-- Bob's segment drops his loose envelopes, and is held at number 5
#guard bobCloses.afterAll 0 == [(4, 99), (5, 50)]
-- a device that had caught up to 2 learns of Carol's 99 and Bob's segment
#guard bobCloses.afterAll 2 == [(4, 99), (5, 50)]
#guard bobCloses.afterAll 5 == []
-- a writer that never comes back: Dave's loose 21 stays, whatever Bob covers
def davesGone : Store := ({} : Store).upload "dave" [⟨21, 900, []⟩] |>.upload "bob" [⟨51, 3000, [21]⟩]
#guard davesGone.afterAll 0 == [(1, 21), (2, 51)]
-- a segment can't cover itself
#guard (({} : Store).upload "bob" [⟨60, 3000, [60]⟩]).afterAll 0 == [(1, 60)]
-- 500 envelopes and two segments: 300 numbers after 200, in three pages of 128, 128 and 44
def five : Store := ({} : Store).upload "alice" ((List.range 500).map fun i => ⟨1000 + i, 900, []⟩)
#guard (five.after 200).map (·.length) == [128, 128, 44]
#guard (five.after 500).isEmpty
-- Bob's Peer-Light was offline at 0: it catches up in three pages and holds all 500; asking again gets nothing
#guard ((({} : Reader).catchUp five).at_, (({} : Reader).catchUp five).held.length) == (500, 500)
-- holding 11 already, Bob fetches only 13, 99 and 50 of what came after 0
#guard ({ held := [11] } : Reader).lacks (bobCloses.afterAll 0 ++ [(1, 11), (3, 13)]) == [99, 50, 13]

end KeeperExamples

end Aven.Peer.Keeper
