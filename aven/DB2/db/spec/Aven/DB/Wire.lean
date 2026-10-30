import Lean.Data.Json

/-!
# The wire

Our one protocol (README, rule 9), on ALPN `aven/db/1`: frames, one JSON object per line on one stream each way. The
reading half takes bytes as they come and gives whole frames: a line is a frame once its newline arrives, a line that
isn't one is refused, and so is a line that grows past `maxFrame` bytes without its newline. `aven-db-core`'s `wire`
module implements it, and its tests replay the vectors.
-/

open Lean

namespace Aven.DB

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

inductive Frame where
  /-- the first frame each side sends: the cast's id of the peer it is -/
  | hello (peer : String)
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
  /-- lines as their blobs, oldest first per chain: the Aven Peer's answer to `catchUp`, or a peer's own lines the
  Aven Peer is missing -/
  | lines (lines : List String)
  /-- the Aven Peer tells a peer files of its own chain it holds whole, by their names (an index's hash): each file as
  it keeps it, to the links of the device that shared it; and on each link the files of that peer's own chain it has
  kept, in pages (`keptPages`). A sender says "Kept by the network" only then -/
  | kept (files : List String)
  deriving DecidableEq, Repr

/-- A line longer than this, without its newline, is refused: no peer needs one. -/
def maxFrame : Nat := 64 * 1024

def Frame.json : Frame → Json
  | .hello p => Json.mkObj [("frame", "hello"), ("peer", p)]
  | .presence ps => Json.mkObj [("frame", "presence"), ("peers", toJson ps)]
  | .beat n => Json.mkObj [("frame", "beat"), ("n", toJson n)]
  | .claim st => Json.mkObj [("frame", "claim"), ("statement", st)]
  | .signIn st => Json.mkObj [("frame", "sign_in"), ("statement", st)]
  | .invite st => Json.mkObj [("frame", "invite"), ("statement", st)]
  | .withdraw st => Json.mkObj [("frame", "withdraw"), ("statement", st)]
  | .join st => Json.mkObj [("frame", "join"), ("statement", st)]
  | .network c t st => Json.mkObj [("frame", "network"), ("claimed", toJson c), ("tree", toJson t),
      ("statements", toJson st)]
  | .refused w => Json.mkObj [("frame", "refused"), ("why", w)]
  | .heads hs more => Json.mkObj [("frame", "heads"), ("heads", toJson hs), ("more", toJson more)]
  | .catchUp hs only => Json.mkObj [("frame", "catch_up"), ("have", toJson hs), ("only", toJson only)]
  | .lines ls => Json.mkObj [("frame", "lines"), ("lines", toJson ls)]
  | .kept fs => Json.mkObj [("frame", "kept"), ("files", toJson fs)]

def Frame.parse (line : String) : Option Frame := do
  let j ← (Json.parse line).toOption
  match ← (j.getObjValAs? String "frame").toOption with
  | "hello" => .hello <$> (j.getObjValAs? String "peer").toOption
  | "presence" => .presence <$> (j.getObjValAs? (List String) "peers").toOption
  | "beat" => .beat <$> (j.getObjValAs? Nat "n").toOption
  | "claim" => .claim <$> (j.getObjValAs? String "statement").toOption
  | "sign_in" => .signIn <$> (j.getObjValAs? String "statement").toOption
  | "invite" => .invite <$> (j.getObjValAs? String "statement").toOption
  | "withdraw" => .withdraw <$> (j.getObjValAs? String "statement").toOption
  | "join" => .join <$> (j.getObjValAs? String "statement").toOption
  | "network" =>
    -- `statements` absent, as an Aven Peer before milestone 2 sends it: none
    let statements := (j.getObjValAs? (Option String) "statements").toOption.join
    (.network · · statements) <$> (j.getObjValAs? Bool "claimed").toOption <*>
      (j.getObjValAs? (Option String) "tree").toOption
  | "refused" => .refused <$> (j.getObjValAs? String "why").toOption
  | "heads" => (.heads · ((j.getObjValAs? Bool "more").toOption.getD false)) <$>
      (j.getObjValAs? (List Head) "heads").toOption
  | "catch_up" => (.catchUp · ((j.getObjValAs? Bool "only").toOption.getD false)) <$>
      (j.getObjValAs? (List Have) "have").toOption
  | "lines" => .lines <$> (j.getObjValAs? (List String) "lines").toOption
  | "kept" => .kept <$> (j.getObjValAs? (List String) "files").toOption
  | _ => none

inductive WireError where
  | bad
  | tooLong
  deriving DecidableEq, Repr

/-- One chunk of bytes on top of what is buffered: the whole frames, and what stays buffered. -/
def push (buf chunk : String) : Except WireError (List Frame × String) := do
  let lines := (buf ++ chunk).splitOn "\n"
  let rest := lines.getLastD ""
  let frames ← lines.dropLast.mapM fun l => match Frame.parse l with
    | some f => .ok f
    | none => .error .bad
  if rest.utf8ByteSize > maxFrame then throw .tooLong
  pure (frames, rest)

/-- What a stream reads chunk by chunk: the frames of each push, until one is refused. -/
def decode (chunks : List String) : List (List Frame) × Option WireError := Id.run do
  let mut buf := ""
  let mut out := #[]
  for c in chunks do
    match push buf c with
    | .ok (fs, rest) => out := out.push fs; buf := rest
    | .error e => return (out.toList, some e)
  return (out.toList, none)

/-! ## Examples

Chunks as they arrive and the frames each one completes, written out by hand. -/

def wireExamples : List (String × List String × List (List Frame) × Option WireError) := [
  ("three frames in one chunk",
    ["{\"frame\":\"hello\",\"peer\":\"alice-peer\"}\n{\"frame\":\"presence\",\"peers\":[\"a\"]}\n{\"frame\":\"beat\",\"n\":7}\n"],
    [[.hello "alice-peer", .presence ["a"], .beat 7]], none),
  ("a frame split across chunks", ["{\"frame\":\"be", "at\",\"n\":1}", "\n"], [[], [], [.beat 1]], none),
  ("two frames, then half a third", ["{\"frame\":\"beat\",\"n\":1}\n{\"frame\":\"beat\",\"n\":2}\n{\"frame\":"],
    [[.beat 1, .beat 2]], none),
  ("presence of nobody", ["{\"frame\":\"presence\",\"peers\":[]}\n"], [[.presence []]], none),
  ("a claim, a sign-in, then the network and a refusal",
    ["{\"frame\":\"claim\",\"statement\":\"{}\"}\n{\"frame\":\"sign_in\",\"statement\":\"{}\"}\n",
      "{\"frame\":\"network\",\"claimed\":false,\"tree\":null}\n{\"frame\":\"network\",\"claimed\":true,\"tree\":\"{}\"}\n",
      "{\"frame\":\"refused\",\"why\":\"taken\"}\n"],
    [[.claim "{}", .signIn "{}"], [.network false none none, .network true (some "{}") none], [.refused "taken"]], none),
  ("an invite, a withdrawal and a join, then the network with its statements",
    ["{\"frame\":\"invite\",\"statement\":\"{}\"}\n{\"frame\":\"withdraw\",\"statement\":\"{}\"}\n{\"frame\":\"join\",\"statement\":\"{}\"}\n",
      "{\"frame\":\"network\",\"claimed\":true,\"tree\":\"{}\",\"statements\":\"{}\"}\n"],
    [[.invite "{}", .withdraw "{}", .join "{}"], [.network true (some "{}") (some "{}")]], none),
  ("catching up: the heads, what a peer holds, and the lines",
    ["{\"frame\":\"heads\",\"heads\":[{\"device\":\"ab\",\"id\":\"cd\",\"seq\":2}]}\n",
      "{\"frame\":\"catch_up\",\"have\":[{\"device\":\"ab\",\"seq\":1}]}\n{\"frame\":\"lines\",\"lines\":[\"x\",\"y\"]}\n",
      "{\"frame\":\"heads\",\"heads\":[]}\n{\"frame\":\"catch_up\",\"have\":[]}\n"],
    [[.heads [⟨"ab", "cd", 2⟩] false], [.catchUp [⟨"ab", 1⟩] false, .lines ["x", "y"]], [.heads [] false, .catchUp [] false]],
    none),
  ("catching up in pages: heads with more to come, and a page of the chains named",
    ["{\"frame\":\"heads\",\"heads\":[{\"device\":\"ab\",\"id\":\"cd\",\"seq\":2}],\"more\":true}\n",
      "{\"frame\":\"catch_up\",\"have\":[{\"device\":\"ab\",\"seq\":0}],\"only\":true}\n"],
    [[.heads [⟨"ab", "cd", 2⟩] true], [.catchUp [⟨"ab", 0⟩] true]], none),
  ("a file kept whole, then a page of the files of a peer's chain kept",
    ["{\"frame\":\"kept\",\"files\":[\"ab\"]}\n{\"frame\":\"kept\",\"files\":[\"ab\",\"cd\"]}\n"],
    [[.kept ["ab"], .kept ["ab", "cd"]]], none),
  ("kept without its files", ["{\"frame\":\"kept\"}\n"], [], some .bad),
  ("a head without its number", ["{\"frame\":\"heads\",\"heads\":[{\"device\":\"ab\",\"id\":\"cd\"}]}\n"], [],
    some .bad),
  ("a join without its statement", ["{\"frame\":\"join\"}\n"], [], some .bad),
  ("a claim without its statement", ["{\"frame\":\"claim\"}\n"], [], some .bad),
  ("a line that isn't JSON", ["nope\n"], [], some .bad),
  ("a frame no peer sends", ["{\"frame\":\"shout\"}\n"], [], some .bad),
  ("a beat without its count", ["{\"frame\":\"beat\"}\n"], [], some .bad),
  ("refused after the frames before it", ["{\"frame\":\"beat\",\"n\":3}\n", "{\"frame\":\n"], [[.beat 3]], some .bad),
  ("a line of exactly the limit waits", [String.ofList (List.replicate maxFrame 'x')], [[]], none),
  ("an endless line is refused", [String.ofList (List.replicate (maxFrame + 1) 'x')], [], some .tooLong)]

#guard wireExamples.all fun (_, chunks, frames, err) => decode chunks == (frames, err)

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
/-- **A page fits a frame:** `pageSize` heads of the longest kind (64-digit keys and names, the largest number) are
well under `maxFrame`. -/
def longest : List Head := List.replicate pageSize ⟨String.ofList (List.replicate 64 'f'),
  String.ofList (List.replicate 64 'e'), 2 ^ 64 - 1⟩
#guard ((Frame.heads longest true).json.compress.utf8ByteSize) * 2 < maxFrame

/-! ## The files kept, in pages

A peer that shared many files is told the ones kept in pages of at most `pageSize` names, as the heads are: together
they are every file (`keptPages_files`), none is empty (`pages_ne_nil`), and a page of the longest names fits a frame. -/

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
#guard ((Frame.kept (List.replicate pageSize (String.ofList (List.replicate 64 'f')))).json.compress.utf8ByteSize) * 2 <
  maxFrame

end Aven.DB
