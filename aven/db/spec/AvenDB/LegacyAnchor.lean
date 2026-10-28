import AvenDB.Batches

/-!
# The legacy anchor: a hard fork off SLH-DSA

avenDB signed with SLH-DSA until the key move (K3, 2026-10-19), and with ML-DSA-65 since. Samuel, 2026-10-26: drop
SLH-DSA for good, as a hard fork, without a ceremony: "we trust all current signers and devices". Signing old edits
again would give them new ids, as an edit's id hashes its author, and break every link, pin and frontier: a reset,
which avenDB never does. So the old edits keep their ids and lose their signatures instead.

At the fork, the edits a device takes today that a legacy (SLH-DSA) signer signed are frozen (`freeze`): their ids, in
one list, hashed as one Merkle tree of BLAKE3 hashes like a batch-signed log's (`Batches.root`). Its root is the legacy
anchor, pinned in the repo as the Maia City vault's id is (H2). From then on a device checks a legacy signer's part of
an edit by a path up the tree to the anchor alone (`check`), never by its signature, which it needs no more: not to
sync, store, restore or check. A part of any other signer it checks as before.

- A legacy part checks only for an edit frozen at the fork (`check_sound`): an SLH-DSA key, stolen or not, signs nothing
  after it (`refused_late`), whatever signature it brings (`check_ignores_signatures`).
- Every frozen edit has its path (`paths`, `paths_hold`), so a device takes exactly the edits it took before the fork
  (`keeps_today`) and knows exactly what it knew (`view_today`): no edit, id, link or entry changes.
- Edits made after the fork are taken as before where no legacy signer signed them (`later_today`), and refused where
  one did (`later_refused`).

The model takes a hash to be the term it hashes (`Batches.Digest`), so the anchor holds the very ids it hashes; an id
hashes its edit's sealed bytes, so it pins each frozen edit byte for byte.
-/

namespace AvenDB.Legacy

open Batches

/-- The ids of the edits of `edits` that a legacy signer signed, in their order: what the fork freezes, `edits` being
    the edits a device takes at the fork. -/
def freeze (legacy : SignerId → Bool) (edits : List Edit) : List EditId :=
  (edits.filter fun o => o.sigs.any legacy).map (·.id)

/-- After the fork, signer `s` signed edit `e`: for a legacy signer, one of the paths held with `e` (`held`) climbs to
    the anchor; for any other, `auth` says so, as before the fork. A legacy signer's signature is never asked. -/
def check (legacy : SignerId → Bool) (anchor : Digest) (held : EditId → List (List (Bool × Digest)))
    (auth : SignerId → EditId → Bool) (s : SignerId) (e : EditId) : Bool :=
  if legacy s then (held e).any fun p => climb (.leaf e) p == anchor else auth s e

/-- The paths the engine holds for an edit of the frozen `ids`: one for each place it is at. -/
def paths (ids : List EditId) (e : EditId) : List (List (Bool × Digest)) :=
  (List.range ids.length).filterMap fun i => if ids[i]? = some e then some (path ids i) else none

/-- Every frozen edit has a path to the anchor among those `held` with it. -/
def Holds (ids : List EditId) (held : EditId → List (List (Bool × Digest))) : Prop :=
  ∀ e ∈ ids, ∃ p ∈ held e, climb (.leaf e) p = root ids

/-! ## What a device checks -/

/-- A signer of the new suite is checked as before the fork. -/
theorem check_today {legacy : SignerId → Bool} {s : SignerId} (h : legacy s = false) (anchor : Digest)
    (held : EditId → List (List (Bool × Digest))) (auth : SignerId → EditId → Bool) (e : EditId) :
    check legacy anchor held auth s e = auth s e := by
  simp [check, h]

/-- A legacy signer's part never asks its signature: the same whatever signatures there are. -/
theorem check_ignores_signatures {legacy : SignerId → Bool} {s : SignerId} (h : legacy s = true) (anchor : Digest)
    (held : EditId → List (List (Bool × Digest))) (auth auth' : SignerId → EditId → Bool) (e : EditId) :
    check legacy anchor held auth s e = check legacy anchor held auth' s e := by
  simp [check, h]

/-- A legacy part checks only for an edit the fork froze. -/
theorem check_sound {legacy : SignerId → Bool} {s : SignerId} (h : legacy s = true) {ids : List EditId}
    {held : EditId → List (List (Bool × Digest))} {auth : SignerId → EditId → Bool} {e : EditId}
    (hc : check legacy (root ids) held auth s e = true) : e ∈ ids := by
  simp only [check, h, ite_true, List.any_eq_true, beq_iff_eq] at hc
  obtain ⟨p, -, hp⟩ := hc
  exact path_sound hp

/-- So an SLH-DSA key signs nothing after the fork, whatever signature it brings. -/
theorem refused_late {legacy : SignerId → Bool} {s : SignerId} (h : legacy s = true) {ids : List EditId}
    (held : EditId → List (List (Bool × Digest))) (auth : SignerId → EditId → Bool) {e : EditId} (he : e ∉ ids) :
    check legacy (root ids) held auth s e = false := by
  cases hc : check legacy (root ids) held auth s e
  · rfl
  · exact absurd (check_sound h hc) he

/-- And it checks every frozen edit held with its path. -/
theorem check_complete {legacy : SignerId → Bool} {s : SignerId} (h : legacy s = true) {ids : List EditId}
    {held : EditId → List (List (Bool × Digest))} (hh : Holds ids held) (auth : SignerId → EditId → Bool)
    {e : EditId} (he : e ∈ ids) : check legacy (root ids) held auth s e = true := by
  obtain ⟨p, hp, hc⟩ := hh e he
  simp only [check, h, ite_true, List.any_eq_true, beq_iff_eq]
  exact ⟨p, hp, hc⟩

/-- The engine's paths climb to the anchor, one for every frozen edit. -/
theorem paths_hold (ids : List EditId) : Holds ids (paths ids) := by
  intro e he
  obtain ⟨i, hi, rfl⟩ := List.getElem_of_mem he
  refine ⟨path ids i, ?_, climb_path ids i hi⟩
  simp only [paths, List.mem_filterMap, List.mem_range]
  exact ⟨i, hi, by simp [List.getElem?_eq_getElem hi]⟩

/-! ## What a device takes -/

/-- The edits a device took at the fork it takes after it, with the paths to an anchor of the very edits it froze, in
    any order (the engine sorts them): no edit is left out, and none added. -/
theorem keeps_today {legacy : SignerId → Bool} {auth : SignerId → EditId → Bool} {edits : List Edit}
    {ids : List EditId} (hids : ∀ e, e ∈ ids ↔ e ∈ freeze legacy (Batches.takes auth edits))
    {held : EditId → List (List (Bool × Digest))} (hh : Holds ids held) :
    Batches.takes (check legacy (root ids) held auth) (Batches.takes auth edits) = Batches.takes auth edits := by
  unfold Batches.takes
  refine List.filter_eq_self.2 fun o ho => List.all_eq_true.2 fun s hs => ?_
  cases hl : legacy s
  · rw [check_today hl]
    exact List.all_eq_true.1 (List.mem_filter.1 ho).2 s hs
  · refine check_complete hl hh auth ((hids o.id).2 ?_)
    exact List.mem_map.2 ⟨o, List.mem_filter.2 ⟨ho, List.any_eq_true.2 ⟨s, hs, hl⟩⟩, rfl⟩

/-- So a device knows after the fork exactly what it knew before it: every vault, share, entry and link. -/
theorem view_today {legacy : SignerId → Bool} {auth : SignerId → EditId → Bool} {edits : List Edit}
    {ids : List EditId} (hids : ∀ e, e ∈ ids ↔ e ∈ freeze legacy (Batches.takes auth edits))
    {held : EditId → List (List (Bool × Digest))} (hh : Holds ids held) :
    view (Batches.takes (check legacy (root ids) held auth) (Batches.takes auth edits)) =
      view (Batches.takes auth edits) := by
  rw [keeps_today hids hh]

/-- And with edits after the fork: it keeps what it took, and takes of the later ones what it takes of them alone. -/
theorem keeps_today_append {legacy : SignerId → Bool} {auth : SignerId → EditId → Bool} {edits : List Edit}
    {ids : List EditId} (hids : ∀ e, e ∈ ids ↔ e ∈ freeze legacy (Batches.takes auth edits))
    {held : EditId → List (List (Bool × Digest))} (hh : Holds ids held) (later : List Edit) :
    Batches.takes (check legacy (root ids) held auth) (Batches.takes auth edits ++ later) =
      Batches.takes auth edits ++ Batches.takes (check legacy (root ids) held auth) later := by
  rw [Batches.takes, List.filter_append, ← Batches.takes, ← Batches.takes, keeps_today hids hh]

/-- A later edit no legacy signer signed is taken exactly as before the fork. -/
theorem later_today {legacy : SignerId → Bool} {auth : SignerId → EditId → Bool} {ids : List EditId}
    (held : EditId → List (List (Bool × Digest))) {o : Edit} (h : o.sigs.any legacy = false) :
    o.sigs.all (check legacy (root ids) held auth · o.id) = o.sigs.all (auth · o.id) := by
  have hn : ∀ s ∈ o.sigs, legacy s = false := fun s hs => by
    cases hl : legacy s
    · rfl
    · exact absurd (List.any_eq_true.2 ⟨s, hs, hl⟩) (by simp [h])
  refine Bool.eq_iff_iff.2 ⟨fun ha => List.all_eq_true.2 fun s hs => ?_, fun ha => List.all_eq_true.2 fun s hs => ?_⟩
  · have := List.all_eq_true.1 ha s hs
    rwa [check_today (hn s hs)] at this
  · rw [check_today (hn s hs)]
    exact List.all_eq_true.1 ha s hs

/-- A later edit a legacy signer signed is refused, unless the fork froze it. -/
theorem later_refused {legacy : SignerId → Bool} {auth : SignerId → EditId → Bool} {ids : List EditId}
    (held : EditId → List (List (Bool × Digest))) {later : List Edit} {o : Edit} {s : SignerId} (hs : s ∈ o.sigs)
    (hl : legacy s = true) (he : o.id ∉ ids) : o ∉ Batches.takes (check legacy (root ids) held auth) later := by
  intro ho
  have := List.all_eq_true.1 (List.mem_filter.1 ho).2 s hs
  rw [refused_late hl held auth he] at this
  cases this

/-! ## An example

Signers below 10 are of the old suite. Alice's old passkey 1 made two edits, the second with her new passkey 11 beside
it (the key move); her new key made one; Bob's old Mac 2 made one that a device refused at the fork (its signature
didn't check). After the fork the three it took stand, Bob's refused edit stays refused, and old key 1 signs nothing new,
not even with a signature that checks. -/

def legacy (s : SignerId) : Bool := s < 10

def mk (id : EditId) (author : SignerId) (cosigners : List SignerId := []) : Edit :=
  { id, depth := id, author, cosigners, action := .checkpoint 0 [] }

def before : List Edit := [mk 100 1, mk 101 1 [11], mk 102 11, mk 103 2]

/-- Today's signatures: every one checks but Bob's on edit 103; old key 1 signs edit 104 after the fork too. -/
def signed (s : SignerId) (e : EditId) : Bool := !(s == 2 && e == 103)

def took : List Edit := Batches.takes signed before
def frozen : List EditId := freeze legacy took
def anchor : Digest := root frozen
def after (later : List Edit) : List EditId :=
  (Batches.takes (check legacy anchor (paths frozen) signed) (took ++ later)).map (·.id)

#guard took.map (·.id) == [100, 101, 102]
#guard frozen == [100, 101]
#guard after [] == [100, 101, 102]
-- the new key writes as before; the old key's later edit, its signature checking, and Bob's refused edit stay out
#guard after [mk 104 1, mk 105 11, mk 103 2] == [100, 101, 102, 105]
-- a path of another tree, or of another edit, climbs to no anchor
#guard !check legacy anchor (fun _ => [path [100, 104] 1]) signed 1 104
#guard !check legacy anchor (fun _ => paths frozen 100) signed 1 104

end AvenDB.Legacy
