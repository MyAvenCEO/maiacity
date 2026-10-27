import AvenDB.QueryView
import AvenDB.Json

/-!
# Query view vectors

`vectors/query_views.json`, the cases that hold the Rust query views (`crates/avendb/src/query_view.rs`, B3) to the
model of `QueryView.lean`: runs of edits, each with a query (a selector, a window and a follow), and for every head of
the run what the query's view shows there, worked out by the model from all the edits up to that head (`answer`). A
Rust view stepped edit by edit, stepped by batches, opened from a stamped slot or built again must show the same at
every head; so must one built from the compacted log (`compacted`: the places of the edits compaction keeps).

The runs hold each delta case of the rules: new entries that join a full window and push its oldest out (`QW1`), an
edit to an entry inside the window that keeps it, one that takes it out of the selection or away and makes the window
take an older entry again (`QW2`), an edit to an entry no view reaches, a selector that meets three tests, a follow
through a cycle of links, and a link changed inside and outside what the follow reaches (`QF1`).

The order of entries is their creation order: the place of each entry's first edit, which a later edit, or a removal
and a new row, never moves (`created`).
-/

namespace AvenDB.QueryViewVectors

open AvenDB.QueryView AvenDB.Json

def row (type : Nat) (tags : List Nat) (links : List Nat := []) (value : Nat := 0) : Option Row :=
  some ⟨type, tags, links, value⟩

def rowJson (r : Row) : String :=
  obj [("type", nat r.type), ("tags", arr (r.tags.map nat)), ("links", arr (r.links.map nat)), ("value", nat r.value)]

def editJson (x : Edit) : String :=
  obj [("entry", nat x.1), ("row", (x.2.map rowJson).getD "null")]

def atomJson : Atom → String
  | .type t => obj [("type", nat t)]
  | .tag g => obj [("tag", nat g)]
  | .link e => obj [("link", nat e)]
  | .atLeast n => obj [("at_least", nat n)]

/-- The places in `log` of the edits compaction keeps. -/
def kept : List Edit → Nat → List Nat
  | [], _ => []
  | x :: xs, i => if xs.any (·.1 == x.1) then kept xs (i + 1) else i :: kept xs (i + 1)

/-- What the view shows at head `h`: the window's entries with their rows, and the entries the follow reaches that hold
    a row, each once. -/
def headJson (q : Query) (log : List Edit) (h : Nat) : String :=
  let upTo := log.take h
  let rs := rows upTo
  let (win, reached) := answer q upTo (created upTo)
  let shown := win.filterMap fun e => (rs e).map fun r => arr [nat e, rowJson r]
  let followed := (reached.eraseDups.filter fun e => (rs e).isSome)
  obj [("head", nat h), ("touched", arr ((if h = 0 then [] else (log.drop (h - 1)).take 1).map (nat ·.1))),
       ("window", arr shown), ("follow", arr (followed.map nat))]

def caseJson (name : String) (q : Query) (log : List Edit) : String :=
  obj [("name", str name), ("select", arr (q.sel.map atomJson)), ("window", nat q.window), ("follow", nat q.follow),
       ("edits", arr (log.map editJson)), ("compacted", arr ((kept log 0).map nat)),
       ("heads", arr ((List.range (log.length + 1)).map (headJson q log)))]

/-! ## The runs -/

/-- A chat room (type 1, room tag 7), newest 3 messages: messages join and push the oldest out, a message of another
    room changes nothing, a message is edited in place, one inside the window is moved to another room and one is
    taken away, so the window takes older ones again, and a new one joins. -/
def chat : List Edit :=
  [(1, row 1 [7] [] 1), (2, row 1 [7] [] 2), (3, row 1 [8] [] 3), (4, row 1 [7] [] 4), (5, row 1 [7] [] 5),
   (6, row 1 [7] [] 6), (4, row 1 [7] [] 40), (6, row 1 [8] [] 6), (5, none), (7, row 1 [7] [] 7), (5, row 1 [7] [] 50)]

/-- Three tests met: type 1, tag 7 and a value of at least 10. Rows pass and fail each test in turn. -/
def meet3 : List Edit :=
  [(1, row 1 [7] [] 12), (2, row 2 [7] [] 12), (3, row 1 [9] [] 12), (4, row 1 [7] [] 3), (5, row 1 [7, 9] [] 10),
   (4, row 1 [7] [] 11), (1, row 1 [7] [] 9), (3, row 1 [9, 7] [] 30)]

/-- Follow two hops from the newest two entries of type 1 through a cycle (10 → 11 → 12 → 10) and a chain off it; a
    link changed inside what the follow reaches and one changed outside it. -/
def graph : List Edit :=
  [(10, row 2 [] [11]), (11, row 2 [] [12]), (12, row 2 [] [10, 13]), (13, row 2 [] [14]), (14, row 2 [] []),
   (1, row 1 [] [10]), (2, row 1 [] [13]), (14, row 2 [] [1]), (12, row 2 [] [10]), (20, row 2 [] [21]),
   (3, row 1 [] [20]), (21, none)]

/-- A window of none and a selector of nothing: every entry passes, the view shows nothing, the follow nothing. -/
def empty0 : List Edit := [(1, row 1 [] [2]), (2, row 3 [4]), (1, none)]

def render : String := lines
  [caseJson "chat" ⟨[.type 1, .tag 7], 3, 0⟩ chat,
   caseJson "meet" ⟨[.type 1, .tag 7, .atLeast 10], 2, 0⟩ meet3,
   caseJson "graph" ⟨[.type 1], 2, 2⟩ graph,
   caseJson "every" ⟨[], 5, 1⟩ graph,
   caseJson "nothing" ⟨[], 0, 3⟩ empty0]

end AvenDB.QueryViewVectors
