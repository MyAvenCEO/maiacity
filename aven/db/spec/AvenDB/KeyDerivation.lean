/-!
# A device derives the entry keys it opens something with (P2)

An entry's key in one of its stays derives from a key of the audience of that stay (`keys::entry_key`, `Lab::derive`
in lab.rs). An audience can hold several keys of one epoch, as devices that made its key at the same time each made one,
and each device's writes are under the entry key its own derives. Until 2026-10-28 a device derived, for every audience
key it held, the key of every entry that ever stayed in the audience (`before`): entries times audience keys. 64 devices
of one vault that wrote before they synced made 65 keys of its audience, so a device that unlocked or caught up at 32,000
edits derived 208,000 keys in one step (440 ms), where its 3,200 entries' writes were each under one.

An entry key opens only what is under it: a write, whose body names the key's id; a link, a key of an earlier stay
wrapped under it when the entry moved (`Action::Wraps`), whose box names it; and the writes to come, under the entry's key
now, the one the first key it holds of its audience at its epoch derives (`State::entry_key`, `entry_key_for`). So a
device derives the key now of each entry, and the key of a write or a link where its body or its box asks for it by its
id (`entry_key_of`), from whichever audience key it holds derives that id (`derives`).

What it derives it derived before too (`derives_sub_before`): it holds nothing it couldn't hold. Every key a write or a
link is under, and the key now, it derives where it holds the audience key they derive from (`derives_writes`,
`derives_links`, `derives_now`): it opens every body it opened before. It derives at most one key for the key now and
one for each write and link, however many keys of the audience it holds (`derives_le`). Holding as many keys of the
audience as when it last tried, it derives the same, so a box it found no key for waits for another audience key, not
for the next refresh (`as_many_held_derives_the_same`). A body's key is derived as the
body is read, so it takes the step budget the reading of bodies takes, the bodies of new edits first
(`CatchUpBudget.lean`).
-/

namespace AvenDB.KeyDerivation

/-- A key of an entry: its stay, and the audience key it derives from. -/
abbrev Key := Nat × Nat

/-- An entry as its keys read it: its stays, its key now, and the key each of its writes and links is under. -/
structure Ent where
  stays : List Nat
  now : Key
  writes : List Key
  links : List Key
  deriving Repr

/-- The rule before 2026-10-28: the key of every stay from every audience key it holds. -/
def before (held : List Nat) (e : Ent) : List Key :=
  e.stays.flatMap fun s => held.map fun a => (s, a)

/-- What it derives now: the key now and the keys its writes and links are under, each of a stay the entry had, from an
    audience key it holds. -/
def wanted (held : List Nat) (e : Ent) : List Key :=
  (e.now :: (e.writes ++ e.links)).filter fun k => decide (k.2 ∈ held ∧ k.1 ∈ e.stays)

/-- Each once. -/
def derives (held : List Nat) (e : Ent) : List Key := (wanted held e).eraseDups

theorem mem_wanted {held : List Nat} {e : Ent} {k : Key} :
    k ∈ wanted held e ↔ (k = e.now ∨ k ∈ e.writes ∨ k ∈ e.links) ∧ k.2 ∈ held ∧ k.1 ∈ e.stays := by
  simp [wanted, List.mem_filter, List.mem_cons, List.mem_append]

/-- What it derives it derived before. -/
theorem derives_sub_before {held : List Nat} {e : Ent} {k : Key} (h : k ∈ wanted held e) : k ∈ before held e := by
  obtain ⟨_, hg, hs⟩ := mem_wanted.mp h
  simp only [before, List.mem_flatMap, List.mem_map]
  exact ⟨k.1, hs, k.2, hg, rfl⟩

/-- The key of every write whose audience key it holds, it derives. -/
theorem derives_writes {held : List Nat} {e : Ent} {w : Key} (hw : w ∈ e.writes) (hg : w.2 ∈ held)
    (hs : w.1 ∈ e.stays) : w ∈ wanted held e :=
  mem_wanted.mpr ⟨.inr (.inl hw), hg, hs⟩

/-- So is every key a link is under. -/
theorem derives_links {held : List Nat} {e : Ent} {l : Key} (hl : l ∈ e.links) (hg : l.2 ∈ held)
    (hs : l.1 ∈ e.stays) : l ∈ wanted held e :=
  mem_wanted.mpr ⟨.inr (.inr hl), hg, hs⟩

/-- And the entry's key now, which the writes to come are under. -/
theorem derives_now {held : List Nat} {e : Ent} (hg : e.now.2 ∈ held) (hs : e.now.1 ∈ e.stays) :
    e.now ∈ wanted held e :=
  mem_wanted.mpr ⟨.inl rfl, hg, hs⟩

/-- At most one key for the key now and one for each write and link, however many audience keys it holds. -/
theorem derives_le (held : List Nat) (e : Ent) : (wanted held e).length ≤ 1 + e.writes.length + e.links.length := by
  have := List.length_filter_le (fun k : Key => decide (k.2 ∈ held ∧ k.1 ∈ e.stays)) (e.now :: (e.writes ++ e.links))
  simp only [List.length_cons, List.length_append] at this
  unfold wanted
  omega

/-- What a device derives turns on the audience keys it holds alone, and it holds more of them only by taking more
(`more`): where it holds as many as when it tried, it took none and derives what it derived then. So a box to a key it
derived from none of them is tried again only once it holds another key of that audience, not at every refresh
(`Store::underived`, `box_audience` in lab.rs; a fresh browser tried each of thousands of such boxes with each of its
audience's keys at every step of its catch-up, 1.4 s a step, fresh8 2026-10-29). -/
theorem as_many_held_derives_the_same (held more : List Nat) (e : Ent)
    (h : (held ++ more).length = held.length) : derives (held ++ more) e = derives held e := by
  cases more with
  | nil => rw [List.append_nil]
  | cons x xs =>
    simp only [List.length_append, List.length_cons] at h
    omega

namespace Examples

-- 65 keys of one audience, each a writer's; an entry writer 7 created and wrote 10 times: its key now from the first
-- audience key, and the key of its writes; before, 65
def held : List Nat := List.range 65
def written : Ent := { stays := [0], now := (0, 0), writes := List.replicate 10 (0, 7), links := [] }
#guard derives held written == [(0, 0), (0, 7)]
#guard (before held written).length == 65
-- written under the first audience key: one key
def first : Ent := { stays := [0], now := (0, 0), writes := List.replicate 10 (0, 0), links := [] }
#guard (derives held first).length == 1
-- moved to stay 1, its writes of stay 0 linked under its key now
def moved : Ent := { stays := [0, 1], now := (1, 0), writes := [(0, 3)], links := [(1, 0)] }
#guard derives held moved == [(1, 0), (0, 3)]
#guard (before held moved).length == 130
-- a key whose audience key it doesn't hold, it can't derive
#guard derives [0] written == [(0, 0)]

end Examples

end AvenDB.KeyDerivation
