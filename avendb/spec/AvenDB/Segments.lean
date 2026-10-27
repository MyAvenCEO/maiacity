import AvenDB.WireBatches

/-!
# Segments: one signature per segment, served by any relay (S8)

V5 and P8 let a writer sign one root over many of its edits, and a reply carry each root once beside a path for each
edit. But only the writer could make those paths: a relay held each edit with its signature, and served it so, so a
device syncing through the server still checked one ML-DSA-65 signature per edit, about 2 to 21 ms each on a phone's
WebAssembly, 1.6 to 15 s for a page of 720 edits.

A segment is what a relay holds of a writer's log to serve paths for it: the ids of the log's first edits, in their
order (32 bytes an edit), and the newest root its writer signed over exactly them (`Segment`, `Segment.ok`). The writer
signs once per segment: the root of the Merkle tree over its edits (V5's `Root`). A relay is handed the ids beyond the
ones it holds with a newer root, and takes them only once the root is signed by its log's writer and the ids it holds,
then the new ones, rebuild that root (`extend`): verify before apply, as a relay that is handed ids that rebuild no
signed root keeps what it held (`extend_none`), and what it takes is a segment again (`extend_ok`). It keeps the newest
alone: what it held begins what it takes (`extend_prefix`), so every edit it served a path for before it serves one for
still (`extend_covers`).

From a segment a relay makes the path of any edit of it up to its root (`Segment.prove`), which shows the edit's
writer signed it (`prove_shows`), as V5 checks it, and only for edits of the segment (`prove_mem`), every one of them
(`prove_of_mem`). A writer that keeps one log gives a relay only its first edits (`ok_keeps`). Two segments of one writer
agree, the shorter beginning the longer, or prove a fork (`agree_or_fork`), and the writer is frozen
(`fork_freezes`); a writer that keeps one log never is (`ok_agree`).

A relay serves each part of an edit (`served`) by the path its segment of the edit's signer makes, and by the
signature it holds otherwise. Each root in a reply is then a segment's newest root, one to a signer
(`served_roots`): a device checks one signature for each signer of a page, not for each edit. And it takes exactly the
edits a device sent every signature takes (`V5_segments_take_as_today`): it knows the same, the same edits stand, and it
holds the same edits on a checkpoint's word. Signatures the relay holds stay held, so it serves old apps as today
(`WireBatches.toOld`).

What a segment shows beyond what a path does: its ids, so the edits its writer signed in every vault, as opaque
hashes, and how many. A relay is handed a writer's segment only by the writer or a relay it holds edits of that writer
from, and sends a path of it only beside an edit the asker is authorized to read.
-/

namespace AvenDB.Segments

open Batches WireBatches

/-! ## What a relay holds -/

/-- What a relay holds of one writer's log: the ids of its first edits, in order, and the newest root over them. -/
structure Segment where
  ids  : List EditId
  root : Root
  deriving DecidableEq, Repr

/-- A segment of writer `s`: its root is of `s`'s log, as long as its ids, signed by `s`, and its ids rebuild it. -/
def Segment.ok (signs : SignerId → Said → Bool) (s : SignerId) (g : Segment) : Bool :=
  g.root.log == s && g.root.length == g.ids.length && signs s (.root g.root) && Batches.root g.ids == g.root.digest

/-- A relay holding the ids `held` is handed the ids `more` beyond them and the root `r`: it takes them only where `r`
    is signed by `s` and `held ++ more` rebuilds it (`Signers::extend`). -/
def extend (signs : SignerId → Said → Bool) (s : SignerId) (held more : List EditId) (r : Root) : Option Segment :=
  if (Segment.mk (held ++ more) r).ok signs s then some ⟨held ++ more, r⟩ else none

/-- The path a relay makes for edit `e` of its segment, up to the segment's root. -/
def Segment.prove (g : Segment) (e : EditId) : Option Proof :=
  if e ∈ g.ids then some ⟨g.root, path g.ids (g.ids.idxOf e)⟩ else none

theorem ok_parts {signs : SignerId → Said → Bool} {s : SignerId} {g : Segment} (h : g.ok signs s = true) :
    g.root.log = s ∧ g.root.length = g.ids.length ∧ signs s (.root g.root) = true ∧ root g.ids = g.root.digest := by
  simp only [Segment.ok, Bool.and_eq_true, beq_iff_eq] at h
  exact ⟨h.1.1.1, h.1.1.2, h.1.2, h.2⟩

/-- A segment's root is whole and hashes exactly its ids. -/
theorem ok_whole {signs : SignerId → Said → Bool} {s : SignerId} {g : Segment} (h : g.ok signs s = true) :
    g.root.whole = true ∧ g.root.digest.leaves = g.ids := by
  obtain ⟨-, hl, -, hr⟩ := ok_parts h
  rw [← hr, leaves_root]
  simp [Root.whole, ← hr, leaves_root, hl]

/-! ## Verify before apply -/

/-- What a relay takes is a segment of the writer. -/
theorem extend_ok {signs : SignerId → Said → Bool} {s : SignerId} {held more : List EditId} {r : Root} {g : Segment}
    (h : extend signs s held more r = some g) : g.ok signs s = true := by
  unfold extend at h
  split at h
  · cases h; assumption
  · cases h

/-- Ids that rebuild no root the writer signed are refused: the relay keeps what it held. -/
theorem extend_none {signs : SignerId → Said → Bool} {s : SignerId} {held more : List EditId} {r : Root}
    (h : (⟨held ++ more, r⟩ : Segment).ok signs s = false) : extend signs s held more r = none := by
  simp [extend, h]

/-- What it held begins what it takes. -/
theorem extend_prefix {signs : SignerId → Said → Bool} {s : SignerId} {held more : List EditId} {r : Root}
    {g : Segment} (h : extend signs s held more r = some g) : held <+: g.ids := by
  unfold extend at h
  split at h
  · cases h; exact List.prefix_append _ _
  · cases h

/-! ## Paths a relay makes -/

theorem prove_mem {g : Segment} {e : EditId} {pr : Proof} (h : g.prove e = some pr) : e ∈ g.ids := by
  unfold Segment.prove at h
  split at h
  · assumption
  · cases h

theorem prove_of_mem {g : Segment} {e : EditId} (h : e ∈ g.ids) : ∃ pr, g.prove e = some pr :=
  ⟨⟨g.root, path g.ids (g.ids.idxOf e)⟩, by simp [Segment.prove, h]⟩

/-- The path a relay makes up to its segment's root shows the edit's writer signed it, as V5 checks it. -/
theorem prove_shows {signs : SignerId → Said → Bool} {s : SignerId} {g : Segment} (hg : g.ok signs s = true)
    {e : EditId} {pr : Proof} (h : g.prove e = some pr) : pr.shows signs s e = true := by
  have he := prove_mem h
  simp only [Segment.prove, he, ite_true, Option.some.injEq] at h
  subst h
  obtain ⟨hl, -, hs, hr⟩ := ok_parts hg
  have hi : g.ids.idxOf e < g.ids.length := List.idxOf_lt_length_of_mem he
  have hc := climb_path g.ids _ hi
  rw [List.getElem_idxOf] at hc
  simp [Proof.shows, hl, (ok_whole hg).1, hs, hc, hr]

/-- So every edit a relay served a path for, it serves one for after it takes a newer segment. -/
theorem extend_covers {signs : SignerId → Said → Bool} {s : SignerId} {g g' : Segment} {more : List EditId}
    {r : Root} (h : extend signs s g.ids more r = some g') {e : EditId} (he : e ∈ g.ids) :
    ∃ pr, g'.prove e = some pr ∧ pr.shows signs s e = true := by
  obtain ⟨pr, hp⟩ := prove_of_mem ((extend_prefix h).subset he)
  exact ⟨pr, hp, prove_shows (extend_ok h) hp⟩

/-! ## Keeping the newest, and forks -/

/-- A writer that keeps one log gives a relay only its first edits. -/
theorem ok_keeps {signs : SignerId → Said → Bool} {s : SignerId} {L : List EditId} {f : Nat} (hk : Keeps signs s L f)
    {g : Segment} (hg : g.ok signs s = true) : g.ids <+: L := by
  obtain ⟨hl, hlen, hs, -⟩ := ok_parts hg
  obtain ⟨-, hlv⟩ := hk.2 g.root hl hs
  rw [(ok_whole hg).2, hlen] at hlv
  rw [hlv]
  exact List.take_prefix _ _

/-- Two segments of one writer agree, or their roots prove a fork. -/
theorem agree_or_fork {signs : SignerId → Said → Bool} {s : SignerId} {g g' : Segment} (hg : g.ok signs s = true)
    (hg' : g'.ok signs s = true) : agree g.root g'.root = true ∨ forkProof signs g.root g'.root = true := by
  obtain ⟨hl, -, hs, -⟩ := ok_parts hg
  obtain ⟨hl', -, hs', -⟩ := ok_parts hg'
  cases ha : agree g.root g'.root
  · right
    simp [forkProof, hl, hl', (ok_whole hg).1, (ok_whole hg').1, hs, hs', ha]
  · left; rfl

/-- And a relay holding both roots freezes the writer: it serves no path of it any more. -/
theorem fork_freezes {signs : SignerId → Said → Bool} {s : SignerId} {g g' : Segment} (hg : g.ok signs s = true)
    (h : forkProof signs g.root g'.root = true) : frozen signs [g.root, g'.root] s = true := by
  obtain ⟨hl, -, -, -⟩ := ok_parts hg
  simp [frozen, hl, h]

/-- A writer that keeps one log never forks its segments: the shorter begins the longer. -/
theorem ok_agree {signs : SignerId → Said → Bool} {s : SignerId} {L : List EditId} {f : Nat} (hk : Keeps signs s L f)
    {g g' : Segment} (hg : g.ok signs s = true) (hg' : g'.ok signs s = true) : agree g.root g'.root = true := by
  obtain ⟨hl, -, hs, -⟩ := ok_parts hg
  obtain ⟨hl', -, hs', -⟩ := ok_parts hg'
  exact agree_of_keeps hk hl hl' hs hs'

/-! ## What a relay serves -/

/-- How a relay serves writer `s`'s part of edit `e`, holding the segments `segs`: by the path its segment of `s`
    makes, else by the signature it holds. -/
def served (segs : SignerId → Option Segment) (e : EditId) (s : SignerId) : Held :=
  match (segs s).bind (·.prove e) with
  | some pr => .proof pr
  | none => .sig

/-- Each root a relay's reply carries is its segment's newest root of a signer of the page: one signature to check for
    each signer, however many of its edits the page holds. -/
theorem served_roots {segs : SignerId → Option Segment} {edits : List Edit} {r : Root}
    (h : r ∈ table (named (served segs) edits)) : ∃ o ∈ edits, ∃ s ∈ o.sigs, ∃ g, segs s = some g ∧ g.root = r := by
  obtain ⟨o, ho, hr⟩ := List.mem_flatMap.1 (mem_table.1 h)
  obtain ⟨s, hs, hm⟩ := List.mem_filterMap.1 hr
  refine ⟨o, ho, s, hs, ?_⟩
  unfold served at hm
  cases hg : segs s with
  | none => simp [hg] at hm
  | some g =>
    cases hp : g.prove o.id with
    | none => simp [hg, hp] at hm
    | some pr =>
      simp only [hg, hp, Option.bind_some, Option.some.injEq] at hm
      refine ⟨g, rfl, ?_⟩
      unfold Segment.prove at hp
      split at hp
      · cases hp; exact hm
      · cases hp

/-- V5 through a relay: where every writer keeps one log, a relay whose segments are each its writer's and that holds
    the signature of each part its segments don't cover serves pages a device takes exactly as it takes a page sent
    every signature (`today`). -/
theorem V5_segments_take_as_today {signs today : SignerId → Said → Bool} {L : SignerId → List EditId}
    {f : SignerId → Nat} (hk : ∀ s, Keeps signs s (L s) (f s))
    (ht : ∀ s e, today s (.edit e) = (L s).contains e) (rs : List Root) {segs : SignerId → Option Segment}
    (hg : ∀ s g, segs s = some g → g.ok signs s = true) {edits : List Edit}
    (hsig : ∀ o ∈ edits, ∀ s ∈ o.sigs, o.id ∈ L s → (∀ g, segs s = some g → o.id ∉ g.ids) →
      signs s (.edit o.id) = true) :
    let tbl := table (named (served segs) edits)
    Batches.takes (wireAuth signs rs tbl fun e s => strip tbl (served segs e s)) edits =
      Batches.takes (check today [] fun _ _ => []) edits := by
  refine V5_wire_takes_as_today hk ht rs fun o ho s hs hl => ?_
  unfold served
  cases hgs : segs s with
  | none => simpa [Sound] using hsig o ho s hs hl fun g h => by simp [hgs] at h
  | some g =>
    cases hp : g.prove o.id with
    | some pr => simpa [hp, Sound] using prove_shows (hg s g hgs) hp
    | none =>
      simp only [Option.bind_some, hp, Sound]
      refine hsig o ho s hs hl fun g' h' hm => ?_
      rw [hgs] at h'
      cases h'
      obtain ⟨_, hp'⟩ := prove_of_mem hm
      rw [hp] at hp'
      cases hp'

/-! ## Scenarios -/

namespace Examples

open Batches.Examples WireBatches.Examples

def signsAll : SignerId → Said → Bool := fun s x => s == 7 && (x == .root r3 || x == .root r5 || x == .root r4')

-- a relay handed the first three ids and the root over them holds a segment; then two more and the newer root
#guard extend signsAll 7 [] (five.take 3) r3 == some ⟨five.take 3, r3⟩
#guard extend signsAll 7 (five.take 3) [14, 15] r5 == some ⟨five, r5⟩
-- ids that rebuild no signed root, a root of another writer, or a root it never signed are refused
#guard extend signsAll 7 (five.take 3) [14, 16] r5 == none
#guard extend signsAll 8 (five.take 3) [14, 15] r5 == none
#guard extend signsAll 7 (five.take 3) [14] { r5 with length := 4, digest := root (five.take 4) } == none
-- each edit of the segment has a path the relay makes, which checks as the writer's signature would
#guard five.all fun e => match (Segment.mk five r5).prove e with
  | some pr => pr.shows signsAll 7 e
  | none => false
#guard (Segment.mk five r5).prove 16 == none
-- a clone's segment of four forks it, and the writer is frozen
#guard (Segment.mk [11, 12, 13, 99] r4').ok signsAll 7 && forkProof signsAll r5 r4' && frozen signsAll [r5, r4'] 7
-- a page of three edits through the relay: one root, so one signature checked, and every edit taken
#guard (table (named (served fun _ => some ⟨five, r5⟩) page)).length == 1
#guard let tbl := table (named (served fun _ => some ⟨five, r5⟩) page)
  page.all fun o => wireAuth signsAll [r5] tbl (fun e s => strip tbl (served (fun _ => some ⟨five, r5⟩) e s)) 7 o.id
-- an edit beyond its segment goes by the signature the relay holds
#guard served (fun _ => some ⟨five.take 3, r3⟩) 15 7 == .sig

end Examples

end AvenDB.Segments
