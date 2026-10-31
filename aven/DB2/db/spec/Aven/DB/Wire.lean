import Lean.Data.Json
import Aven.Core.Bytes

/-!
# The wire

Our one protocol (README, rule 9), on ALPN `aven/db/1`, a frozen name: one stream each way. It opens with a greeting,
a JSON line, and every frame after it is a Value in Core's one codec (`Aven.DB.WireCbor`, A29).

The greeting is the one exception to rule 1's one codec, and it is frozen (A29): its form never changes with the wire
version, so a peer of any version reads another's and refuses it with `update` (PEERS.md §7). It is a JSON object on
one line: `{"frame":"hello","peer":…,"wire":…}`, or `{"frame":"update","wire":…}` in its place. It is read from exactly
those keys, none missing and none extra (A42), and a line longer than `maxFrame` without its newline is refused. A peer
sends nothing after its hello until the other's has come, so a peer on another version never reads a frame it can't.
-/

open Lean

namespace Aven.DB

open Aven.Core (Bytes)

/-- A device's chain as a peer holds it: the device's key, its newest line's name, and that line's number. -/
structure Head where
  device : String
  id : String
  seq : Nat
  deriving DecidableEq, Repr, ToJson, FromJson

/-- How far a peer holds a device's chain: the number of its newest line there. -/
structure Have where
  device : String
  seq : Nat
  deriving DecidableEq, Repr, ToJson, FromJson

/-- The first line each side sends. -/
inductive Greeting where
  /-- the cast's id of the peer it is, and the wire version it speaks -/
  | hello (peer : String) (wire : Nat)
  /-- the answer to a hello of another wire version, in place of a hello: update, and the version this peer speaks.
  It closes then -/
  | update (wire : Nat)
  deriving DecidableEq, Repr

def Greeting.json : Greeting → Json
  | .hello p w => Json.mkObj [("frame", "hello"), ("peer", p), ("wire", toJson w)]
  | .update w => Json.mkObj [("frame", "update"), ("wire", toJson w)]

/-- How many keys a JSON object has. -/
def keyCount (j : Json) : Nat := match j with
  | .obj kvs => kvs.size
  | _ => 0

/-- A greeting, read from exactly its keys. -/
def Greeting.parse (line : String) : Option Greeting := do
  let j ← (Json.parse line).toOption
  match ← (j.getObjValAs? String "frame").toOption with
  | "hello" =>
    guard (keyCount j == 3)
    pure (.hello (← (j.getObjValAs? String "peer").toOption) (← (j.getObjValAs? Nat "wire").toOption))
  | "update" =>
    guard (keyCount j == 2)
    pure (.update (← (j.getObjValAs? Nat "wire").toOption))
  | _ => none

/-- The frames after the greeting, each a Value in the one codec (`Aven.DB.WireCbor`). -/
inductive Frame where
  /-- the Aven Peer tells each peer who is connected, itself included, on every change -/
  | presence (peers : List String)
  /-- the Aven Peer's clock, once per step -/
  | beat (n : Nat)
  /-- a browser signs up first, so claims an unclaimed network: the claim's statement (`Aven.ID.Claim`) as JSON text -/
  | claim (statement : String)
  /-- a browser signs in with the passkey that claimed the network: the sign-in's statement as JSON text -/
  | signIn (statement : String)
  /-- the admin invites (`Aven.ID.Invite`): the invite's statement as JSON text -/
  | invite (statement : String)
  /-- the admin withdraws an open invite -/
  | withdraw (statement : String)
  /-- a browser joins with an invite -/
  | join (statement : String)
  /-- an Aven Peer that keeps its tree tells each peer whether it is claimed and, to a device the door admits, the
  tree and every statement it holds, so each peer checks the members itself -/
  | network (claimed : Bool) (tree : Option String) (statements : Option String)
  /-- a statement the Aven Peer refused, and why -/
  | refused (why : String)
  /-- the Aven Peer tells a member's peer the head of every chain it keeps (`Aven.DB.Chains`), once linked, in pages
  (`headsPages`): `more` until the last page of one telling -/
  | heads (heads : List Head) (more : Bool)
  /-- a peer asks for every line newer than what it holds of each chain. With `only`, a page (`catchUpPages`): only the
  chains it names, from the number it names; without, every chain, one it doesn't name from the first -/
  | catchUp («have» : List Have) (only : Bool)
  /-- lines as their blobs' bytes, oldest first per chain: the Aven Peer's answer to `catchUp`, or a peer's own lines
  the Aven Peer is missing -/
  | lines (lines : List Bytes)
  /-- the Aven Peer tells a peer files of its own chain it holds whole, by their names (an index's hash): each file as
  it keeps it, to the links of the device that shared it; and on each link the files of that peer's own chain it has
  kept, in pages (`keptPages`). A sender says "Kept by the network" only then -/
  | kept (files : List String)
  deriving DecidableEq, Repr

/-- A greeting longer than this without its newline, or a frame longer than this, is refused: no peer needs one. -/
def maxFrame : Nat := 64 * 1024

inductive WireError where
  | bad
  | tooLong
  deriving DecidableEq, Repr

/-! ### Examples -/

#guard Greeting.parse "{\"frame\":\"hello\",\"peer\":\"alice-peer\",\"wire\":2}" = some (.hello "alice-peer" 2)
#guard Greeting.parse "{\"frame\":\"update\",\"wire\":2}" = some (.update 2)
-- a hello without its version (the wire before it had one), with a key extra, or a version that is text: none
#guard Greeting.parse "{\"frame\":\"hello\",\"peer\":\"a\"}" = none
#guard Greeting.parse "{\"frame\":\"hello\",\"peer\":\"a\",\"wire\":2,\"x\":1}" = none
#guard Greeting.parse "{\"frame\":\"hello\",\"peer\":\"a\",\"wire\":\"2\"}" = none
#guard Greeting.parse "{\"frame\":\"beat\",\"n\":1}" = none
#guard [Greeting.hello "a" 2, .update 2].all fun g => Greeting.parse g.json.compress == some g

/-! ## Catching up in pages

`heads` and `catch_up` name one entry per device, and every browser reset adds a device: in one frame each, they would
pass `maxFrame` at a few hundred devices, and catching up would break for everyone (the security audit, 30 Oct 2026).
So both go in pages of at most `pageSize` entries, as `lines` does, each well under `maxFrame` (`page_fits`):

- **the heads**: one telling is its pages, every one but the last with `more`, so a peer knows when it has heard every
  head (`headsPages_more`), and the pages together are the heads (`headsPages_heads`);
- **catching up**: a peer names every chain it wants, the ones it holds and the ones the heads told it of, in pages
  `only` for the chains each names. The Aven Peer answers each page alone, and the pages' answers together are the
  answer to all of it at once (`answer_pages`);
- **every page moves the receiver forward** (README, rule 3): no page is empty (`pages_ne_nil`), so each one tells a
  head or asks for a chain the ones before it didn't, and the pages end.
-/

/-- The most heads or haves in one frame. -/
def pageSize : Nat := 128

/-- A list in pages of at most `n`, in order; none for an empty list. -/
def pages (n : Nat) (xs : List α) : List (List α) :=
  if _h : n = 0 ∨ xs = [] then [] else xs.take n :: pages n (xs.drop n)
termination_by xs.length
decreasing_by
  cases xs with
  | nil => exact absurd (.inr rfl) _h
  | cons x xs => simp only [List.length_drop, List.length_cons]; omega

theorem pages_eq {n : Nat} (hn : 0 < n) {xs : List α} (hx : xs ≠ []) :
    pages n xs = xs.take n :: pages n (xs.drop n) := by
  rw [pages, dite_eq_right]
  intro h
  rcases h with h | h
  · omega
  · exact hx h

/-- The pages together are the list. -/
theorem pages_flatten {n : Nat} (hn : 0 < n) : ∀ (k : Nat) (xs : List α), xs.length ≤ k → (pages n xs).flatten = xs
  | 0, xs, h => by
    cases xs with
    | nil => simp [pages]
    | cons _ _ => simp at h
  | k + 1, xs, h => by
    cases xs with
    | nil => simp [pages]
    | cons x xs =>
      rw [pages_eq hn (List.cons_ne_nil x xs), List.flatten_cons,
        pages_flatten hn k _ (by simp only [List.length_drop, List.length_cons] at h ⊢; omega)]
      exact List.take_append_drop n _

/-- **No page is empty, and none is longer than `n`:** each moves the receiver forward. -/
theorem pages_ne_nil {n : Nat} (hn : 0 < n) : ∀ (k : Nat) (xs : List α), xs.length ≤ k →
    ∀ p ∈ pages n xs, p ≠ [] ∧ p.length ≤ n
  | 0, xs, h => by
    cases xs with
    | nil => simp [pages]
    | cons _ _ => simp at h
  | k + 1, xs, h => by
    cases xs with
    | nil => simp [pages]
    | cons x xs =>
      rw [pages_eq hn (List.cons_ne_nil x xs)]
      intro p mp
      rcases List.mem_cons.mp mp with rfl | mp
      · constructor
        · cases n with
          | zero => omega
          | succ n => simp
        · simp only [List.length_take]; exact Nat.min_le_left _ _
      · exact pages_ne_nil hn k _ (by simp only [List.length_drop, List.length_cons] at h ⊢; omega) p mp

/-- One telling of the heads: its pages, every one but the last with `more`. No heads is one empty page, so a peer
always hears the end of a telling. -/
def headsPages (hs : List Head) : List Frame :=
  let ps := pages pageSize hs
  if ps = [] then [.heads [] false] else ps.zipIdx.map fun (p, i) => .heads p (i + 1 < ps.length)

/-- What a peer asks for in pages: only the chains it names. -/
def catchUpPages (hs : List Have) : List Frame := (pages pageSize hs).map (.catchUp · true)

def Frame.heads? : Frame → List Head
  | .heads hs _ => hs
  | _ => []

def Frame.more? : Frame → Bool
  | .heads _ m => m
  | _ => false

theorem heads?_told (ps : List (List Head)) :
    (ps.zipIdx.map fun (p, i) => Frame.heads p (i + 1 < ps.length)).flatMap Frame.heads? = ps.flatten := by
  rw [List.flatMap_map]
  show (ps.zipIdx.map Prod.fst).flatten = ps.flatten
  rw [List.zipIdx_map_fst]

/-- **The pages are the heads.** -/
theorem headsPages_heads (hs : List Head) : (headsPages hs).flatMap Frame.heads? = hs := by
  have whole := pages_flatten (n := pageSize) (by decide) hs.length hs (Nat.le_refl _)
  unfold headsPages
  simp only
  split
  · next e => rw [e] at whole; simp [Frame.heads?, ← whole]
  · rw [heads?_told, whole]

theorem more_told (ps : List (List Head)) :
    (ps.zipIdx.map fun (p, i) => Frame.heads p (i + 1 < ps.length)).map Frame.more? =
      (List.range ps.length).map fun i => decide (i + 1 < ps.length) := by
  apply List.ext_getElem
  · simp
  · intro i h1 h2
    simp [Frame.more?, List.getElem_zipIdx]

/-- **A peer knows when it has heard every head:** only the last page of a telling says nothing more is coming. -/
theorem headsPages_more (hs : List Head) :
    ((headsPages hs).map Frame.more?).getLast? = some false ∧
      ((headsPages hs).map Frame.more?).dropLast.all id := by
  unfold headsPages
  simp only
  split
  · simp [Frame.more?]
  · next h =>
    rw [more_told]
    generalize e : (pages pageSize hs).length = m
    cases m with
    | zero => exact absurd (List.length_eq_zero_iff.mp e) h
    | succ m =>
      rw [List.range_succ, List.map_append]
      refine ⟨by simp, ?_⟩
      rw [List.map_singleton, List.dropLast_concat, List.all_eq_true]
      intro b mb
      obtain ⟨i, mi, rfl⟩ := List.mem_map.mp mb
      simp only [List.mem_range] at mi
      simp; omega

/-- The Aven Peer's answer to a page that names only some chains: for each one it keeps, the number after which its
lines go out (`chains` maps a device to its head's number). -/
def answer (chains : List (String × Nat)) (hs : List Have) : List (String × Nat) :=
  hs.filterMap fun h => match chains.lookup h.device with
    | some head => if h.seq < head then some (h.device, h.seq) else none
    | none => none

/-- **Answered page by page, the pages are answered as the whole is.** -/
theorem answer_pages (chains : List (String × Nat)) (hs : List Have) :
    ((pages pageSize hs).map (answer chains)).flatten = answer chains hs := by
  conv => rhs; rw [← pages_flatten (n := pageSize) (by decide) hs.length hs (Nat.le_refl _)]
  unfold answer
  rw [List.filterMap_flatten]

theorem catchUpPages_have (hs : List Have) :
    ((catchUpPages hs).map fun | .catchUp h _ => h | _ => []).flatten = hs := by
  unfold catchUpPages
  rw [List.map_map]
  show ((pages pageSize hs).map id).flatten = hs
  rw [List.map_id]
  exact pages_flatten (by decide) hs.length hs (Nat.le_refl _)

/-! ### Examples -/

def heads300 : List Head := (List.range 300).map fun i => ⟨toString i, "id", i⟩

#guard (headsPages heads300).length = 3
#guard (headsPages heads300).map Frame.more? = [true, true, false]
#guard headsPages [] = [.heads [] false]
#guard (catchUpPages ((List.range 129).map fun i => ⟨toString i, i⟩)).map (fun | .catchUp h o => (h.length, o) | _ => (0, false))
  = [(128, true), (1, true)]

/-! ## The files kept, in pages

A peer that shared many files is told the ones kept in pages of at most `pageSize` names, as the heads are: together
they are every file (`keptPages_files`), none is empty (`pages_ne_nil`), and a page of the longest names fits a frame
(`Aven.DB.WireCbor`). -/

def keptPages (fs : List String) : List Frame := (pages pageSize fs).map .kept

def Frame.kept? : Frame → List String
  | .kept fs => fs
  | _ => []

/-- **The pages together are the files.** -/
theorem keptPages_files (fs : List String) : (keptPages fs).flatMap Frame.kept? = fs := by
  have whole := pages_flatten (n := pageSize) (by decide) fs.length fs (Nat.le_refl _)
  unfold keptPages
  rw [List.flatMap_map]
  simpa [Frame.kept?] using whole

#guard (keptPages (List.replicate 300 "f")).map (·.kept?.length) = [128, 128, 44]
#guard keptPages [] = []

/-! ## The wire version

Every connection's greeting, the hello, names the wire version its peer speaks, and so does the gossip topic's name
(`topicName`). The version is a number of its own, not the release's: it changes only when a frame's meaning changes,
rarely, and never with an ordinary release (PEERS.md §7, decision 11). Two peers meet only on one version:

- **no fallback** (README rule 9): a peer speaks to another only when their versions are equal (`meet_speaks`, as
  `Aven.ID.Records.speaks_same` says of every peer); any other hello is answered with `update` and the version it speaks,
  and the connection closes (`meet_refuses`). A line that is no greeting, such as version 0's hello without its
  version, is refused as `bad`: version 1, the first to carry a version, made those tabs reload once by hand;
- **the older one follows**: of two peers that differ, exactly one is behind (`follows_one`), and only it updates
  (`follows_newer`): an open tab switches to the newer release at once, a native Peer says `update` until its owner
  upgrades it. A peer that is ahead never goes back, so a tab never reloads for an older peer;
- **the gossip topic is per version**: a peer on another version is in another room, so no message of another meaning
  ever reaches it (`topicName`). -/

/-- The wire version this model speaks: 2, frames in CBOR (A29). Version 1 was frames as JSON lines, version 0 the wire
before it had versions. -/
def wireVersion : Nat := 2

/-- What a peer answers a hello of version `theirs` with, speaking `mine`: nothing, and the connection carries on; or
`update` with its own version, and the connection closes. -/
def meet (mine theirs : Nat) : Option Greeting := if theirs = mine then none else some (.update mine)

/-- **No fallback:** a connection carries on only between peers of one wire version. -/
theorem meet_speaks {mine theirs : Nat} : meet mine theirs = none ↔ theirs = mine := by
  unfold meet; split <;> simp_all

/-- **Any other version is refused with `update`,** and the version spoken. -/
theorem meet_refuses {mine theirs : Nat} (h : theirs ≠ mine) : meet mine theirs = some (.update mine) := by
  simp [meet, h]

/-- A peer told `update` by a peer of version `theirs`: it updates only when that peer is ahead of it. -/
def follows (mine theirs : Nat) : Bool := decide (mine < theirs)

/-- **Only to a newer version:** a peer that follows a refusal moves forward, never back. -/
theorem follows_newer {mine theirs : Nat} : follows mine theirs = true ↔ mine < theirs := by
  simp [follows]

/-- **Exactly one of two peers that differ follows:** the one behind. Two peers of one version never do. -/
theorem follows_one {a b : Nat} (h : a ≠ b) : follows a b = !follows b a := by
  unfold follows
  by_cases l : a < b
  · simp [l, Nat.not_lt.mpr (Nat.le_of_lt l)]
  · simp [l, Nat.lt_of_le_of_ne (Nat.not_lt.mp l) (Ne.symm h)]

theorem follows_same (v : Nat) : follows v v = false := by simp [follows]

/-- The gossip topic's name for a network on a wire version: its BLAKE3 is the topic (`aven-peer`'s `room::topic`). -/
def topicName (wire : Nat) (network : String) : String := s!"avenDB chat 1\nwire {wire}\nnetwork {network}"

/-! ### Examples -/

#guard meet 2 2 = none
#guard meet 2 1 = some (.update 2)
#guard meet 2 3 = some (.update 2)
#guard follows 1 2 && !follows 2 1 && !follows 1 1 && !follows 1 0
#guard topicName 1 "aven" = "avenDB chat 1\nwire 1\nnetwork aven"
#guard topicName 1 "aven" ≠ topicName 2 "aven"

/-- Hellos of every kind a peer of `wireVersion` meets: its answer, and whether the peer that sent the hello follows the
refusal. -/
def meetExamples : List (String × Nat × Nat) := [
  ("one version: the connection carries on", wireVersion, wireVersion),
  ("a peer of version 1, frames as JSON lines: refused, and it follows", wireVersion, 1),
  ("an older peer: refused, and it follows", 3, 2),
  ("a newer peer: refused, and it waits for this one", 2, 3),
  ("far apart: refused", 2, 9)]

end Aven.DB
