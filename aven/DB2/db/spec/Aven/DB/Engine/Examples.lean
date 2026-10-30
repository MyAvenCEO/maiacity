import Lean.Data.Json
import Aven.DB.Engine.Query
import Aven.DB.Engine.Wants
import Aven.DB.Engine.Mutate

/-!
# The engine's examples, and how its vectors are written (README, rule 10)

The models are generic over `Aven.Core`'s types. Here they run on stand-ins: Docs, types, targets, keys and writers
are strings, and a value is a number or a string. Every example is checked by `lake build` (`#guard`), and `Vectors`
writes them, with generated cases, to `queries.json`, `wants.json` and `mutations.json`. -/

open Lean

namespace Aven.DB.Engine.Examples

open Aven.DB.Engine

/-- A value: a number or a string. Numbers sort before strings. -/
inductive V where
  | n (k : Nat)
  | s (t : String)
  deriving DecidableEq, Repr

def V.lt : V → V → Bool
  | .n a, .n b => a < b
  | .n _, .s _ => true
  | .s _, .n _ => false
  | .s a, .s b => decide (a < b)

def vals : Vals V := ⟨V.lt, V.n⟩

def V.json : V → Json
  | .n k => toJson k
  | .s t => toJson t

def tupleJson (t : Tuple V) : Json := Json.mkObj (t.map fun (c, v) => (c, v.json))

def rows (fs : List (String × V)) : Tuple V := fs

def cmpName : Cmp → String
  | .eq => "eq" | .ne => "ne" | .lt => "lt" | .le => "le"

def pairJson (l r : Json) (lc rc : String) : Json :=
  Json.mkObj [("left", l), ("right", r), ("leftColumn", toJson lc), ("rightColumn", toJson rc)]

def queryJson : Query String V → Json
  | .scan ty => Json.mkObj [("scan", toJson ty)]
  | .filter col cmp v q => Json.mkObj [("filter", Json.mkObj
      [("column", toJson col), ("cmp", toJson (cmpName cmp)), ("value", v.json), ("query", queryJson q)])]
  | .project cols q => Json.mkObj [("project", Json.mkObj [("columns", toJson cols), ("query", queryJson q)])]
  | .join l r lc rc => Json.mkObj [("join", pairJson (queryJson l) (queryJson r) lc rc)]
  | .leftJoin l r lc rc => Json.mkObj [("leftJoin", pairJson (queryJson l) (queryJson r) lc rc)]
  | .anti l r lc rc => Json.mkObj [("anti", pairJson (queryJson l) (queryJson r) lc rc)]
  | .order col q => Json.mkObj [("order", Json.mkObj [("column", toJson col), ("query", queryJson q)])]
  | .group col q => Json.mkObj [("group", Json.mkObj [("column", toJson col), ("query", queryJson q)])]
  | .limit n q => Json.mkObj [("limit", Json.mkObj [("n", toJson n), ("query", queryJson q)])]

def answerJson : Answer String V → Json
  | .refused => toJson "refused"
  | .rows st rs => Json.mkObj [
      ("status", match st with
        | .complete => toJson "complete"
        | .short missing => Json.mkObj [("short", toJson missing)]),
      ("rows", Json.arr (rs.map tupleJson).toArray)]

def recJson (r : Rec String String V) : Json :=
  Json.mkObj [("doc", toJson r.doc), ("type", toJson r.ty), ("fields", tupleJson r.fields)]

/-- How many Records of each type the database has at all: the counts a query's bound and cost come from. -/
def counts (db : List (Rec String String V)) (ty : String) : Nat := (db.filter (·.ty = ty)).length

/-- A query vector: a database, what this device holds, what the target resolves to, the stored query; the answer,
and the bound, cost and work. -/
def queryVector (name : String) (db : List (Rec String String V)) (held : List String) (target : Option String)
    (resolves : List String) (q : Query String V) : Json :=
  let heldF := fun d => decide (d ∈ held)
  let answer := run vals (fun _ => resolves) heldF db ⟨target, q⟩
  let src := inScope db resolves heldF
  Json.mkObj [("name", toJson name),
    ("input", Json.mkObj [("records", Json.arr (db.map recJson).toArray), ("held", toJson held),
      ("target", match target with | some t => toJson t | none => Json.null), ("resolves", toJson resolves),
      ("query", queryJson q)]),
    ("expected", Json.mkObj [("answer", answerJson answer), ("bound", toJson (bound (counts db) q)),
      ("cost", toJson (cost (counts db) q)), ("work", toJson (work vals src q))])]

/-! ## Queries -/

def home : List (Rec String String V) := [
  ⟨"home", "task", [("id", .s "t1"), ("x2", .s "Order seeds")]⟩,
  ⟨"home", "task", [("id", .s "t2"), ("x2", .s "Water the beans")]⟩,
  ⟨"home", "task", [("id", .s "t3"), ("x2", .s "Prune the apple")]⟩,
  ⟨"home", "done", [("id", .s "f1"), ("x1", .s "t2")]⟩,
  ⟨"home", "due", [("id", .s "f2"), ("x1", .s "2026-11-02"), ("x2", .s "t1")]⟩,
  ⟨"home", "due", [("id", .s "f3"), ("x1", .s "2026-11-01"), ("x2", .s "t3")]⟩,
  ⟨"coop", "task", [("id", .s "t9"), ("x2", .s "Not in this target")]⟩]

/-- Open tasks by due date: tasks with no `done`, each with its `due`, soonest first. -/
def openByDue : Query String V :=
  .project ["id", "x2", "x1"] <|
    .order "x1" <| .leftJoin (.anti (.scan "task") (.scan "done") "id" "x1") (.scan "due") "id" "x2"

#guard answerJson (run vals (fun _ => ["home"]) (· = "home") home ⟨some "home", openByDue⟩) ==
  answerJson (.rows .complete [
    [("id", .s "t3"), ("x2", .s "Prune the apple"), ("x1", .s "2026-11-01")],
    [("id", .s "t1"), ("x2", .s "Order seeds"), ("x1", .s "2026-11-02")]])

-- A query without a target is refused.
#guard answerJson (run vals (fun _ => ["home"]) (fun _ => true) home (⟨none, openByDue⟩ : Spec String String V)) ==
  toJson "refused"

-- The coop's Doc is in the target but not held: the answer is short, and names it.
#guard answerJson (run vals (fun _ => ["home", "coop"]) (· = "home") home ⟨some "both", .scan "task"⟩) ==
  answerJson (.rows (.short ["coop"]) [
    [("id", .s "t1"), ("x2", .s "Order seeds")], [("id", .s "t2"), ("x2", .s "Water the beans")],
    [("id", .s "t3"), ("x2", .s "Prune the apple")]])

def projects : List (Rec String String V) :=
  (["ana", "ben", "cai", "dee"].map fun p => ⟨"coop", "member_of", [("x1", .s p), ("x2", .s "garden")]⟩) ++
  (["ana", "ben"].map fun p => ⟨"coop", "member_of", [("x1", .s p), ("x2", .s "bees")]⟩)

/-- Projects with more than three members (ontology, "A worked example"). -/
def crowded : Query String V := .filter "count" .lt (.n 3) (.group "x2" (.scan "member_of"))

def crowdedGt : Query String V := .anti (.group "x2" (.scan "member_of")) crowded "x2" "x2"

#guard answerJson (run vals (fun _ => ["coop"]) (fun _ => true) projects ⟨some "coop", crowdedGt⟩) ==
  answerJson (.rows .complete [[("x2", .s "garden"), ("count", .n 4)]])

def queryExamples : List Json := [
  queryVector "open tasks by due date" home ["home"] (some "home") ["home"] openByDue,
  queryVector "no target: refused" home ["home"] none ["home"] openByDue,
  queryVector "a Doc not held: short" home ["home"] (some "both") ["home", "coop"] (.scan "task"),
  queryVector "projects with more than three members" projects ["coop"] (some "coop") ["coop"] crowdedGt,
  queryVector "the first two tasks" home ["home"] (some "home") ["home"] (.limit 2 (.scan "task")),
  queryVector "every task with its facts" home ["home"] (some "home") ["home"]
    (.join (.scan "task") (.scan "due") "id" "x2")]

/-! ## Wants -/

def tierName : Tier → String
  | .screen => "screen" | .turn => "turn" | .next => "next" | .later => "later" | .idle => "idle"

def wantJson (w : Want String) : Json :=
  Json.mkObj [("key", toJson w.key), ("tier", toJson (tierName w.tier)), ("signal", toJson w.signal)]

def keptJson (e : Kept String) : Json :=
  Json.mkObj [("key", toJson e.key), ("tier", toJson (tierName e.tier)), ("bytes", toJson e.bytes),
    ("used", toJson e.used)]

def roundJson : Round String → Json
  | .moved k => Json.mkObj [("moved", toJson k)]
  | .done => toJson "done"
  | .stalled k => Json.mkObj [("stalled", toJson k)]

/-- A want vector: wants, the keys caps allow, each key's prerequisites; the queue. Then a round over pages left
and a source, and eviction to a budget. -/
def wantVector (name : String) (ws : List (Want String)) (caps : List String) (pre : List (String × List String))
    (left : List (String × Nat)) (uploads : List String) (got : List String) (budget : Nat)
    (kept : List (Kept String)) : Json :=
  let preF := fun k => (pre.lookup k).getD []
  let q := queue (fun k => decide (k ∈ caps)) (expand preF ws)
  let leftF := fun k => (left.lookup k).getD 0
  let (r, left') := round leftF uploads (q.map (·.key)) (fun k => decide (k ∈ got))
  let keys := uploads ++ q.map (·.key)
  Json.mkObj [("name", toJson name),
    ("input", Json.mkObj [("wants", Json.arr (ws.map wantJson).toArray), ("caps", toJson caps),
      ("pre", Json.mkObj (pre.map fun (k, ks) => (k, toJson ks))),
      ("left", Json.mkObj (left.map fun (k, n) => (k, toJson n))), ("uploads", toJson uploads), ("got", toJson got),
      ("budget", toJson budget), ("kept", Json.arr (kept.map keptJson).toArray)]),
    ("expected", Json.mkObj [("queue", Json.arr (q.map wantJson).toArray), ("round", roundJson r),
      ("left", Json.mkObj (keys.map fun k => (k, toJson (left' k)))),
      ("kept", Json.arr ((evict budget kept).map keptJson).toArray)])]

def chatWants : List (Want String) := [
  ⟨"room:head", .next, 2⟩, ⟨"room:records", .screen, 0⟩, ⟨"archive:records", .idle, 0⟩,
  ⟨"photo:files", .screen, 1⟩, ⟨"secret:records", .screen, 0⟩, ⟨"room:records", .idle, 0⟩]

def chatPre : List (String × List String) := [
  ("room:records", ["room:key", "room:checkpoint"]), ("photo:files", ["room:key"])]

def chatCaps : List String :=
  ["room:head", "room:records", "room:key", "room:checkpoint", "archive:records", "photo:files"]

-- The room's key and checkpoint come first, at the screen's tier its Records are wanted at, then the Records; the
-- secret Doc is wanted but not allowed, so it is not queued; the room's head, wanted at `next`, is queued once.
#guard (queue (fun k => decide (k ∈ chatCaps)) (expand (fun k => (chatPre.lookup k).getD []) chatWants)).map
    (fun w => (w.key, tierName w.tier)) ==
  [("room:key", "screen"), ("room:checkpoint", "screen"), ("room:records", "screen"), ("photo:files", "screen"),
   ("room:head", "next"), ("archive:records", "idle")]

def chatKept : List (Kept String) := [
  ⟨"room:records", .screen, 40, 9⟩, ⟨"archive:records", .idle, 300, 1⟩, ⟨"old:records", .idle, 200, 5⟩,
  ⟨"projects:records", .later, 100, 3⟩]

-- Over a budget of 250 bytes: the screen's room stays, then the later projects, then the idle Doc used last.
#guard (evict 250 chatKept).map (·.key) == ["room:records", "projects:records"]

def wantExamples : List Json := [
  wantVector "a chat room on screen" chatWants chatCaps chatPre
    [("room:records", 3), ("room:key", 1), ("outbox", 2)] ["outbox"] ["outbox"] 250 chatKept,
  wantVector "uploads done, the room's key first" chatWants chatCaps chatPre
    [("room:records", 3), ("room:key", 1)] ["outbox"] ["room:key"] 1000 chatKept,
  wantVector "a source that gives nothing: stalled" chatWants chatCaps chatPre
    [("room:records", 3)] [] [] 40 chatKept,
  wantVector "nothing left: done" chatWants chatCaps chatPre [] [] [] 0 chatKept]

/-! ## Mutations -/

def ofId (i : NewId String) : V := .s s!"{i.writer}/{i.counter}/{i.index}"

def cellJson : Cell V → Json
  | .lit v => v.json
  | .ref n => Json.mkObj [("ref", toJson n)]

def idJson (i : NewId String) : Json :=
  Json.mkObj [("writer", toJson i.writer), ("counter", toJson i.counter), ("index", toJson i.index)]

def opJson : Op String String V → Json
  | .put ty fs => Json.mkObj [("put", Json.mkObj [("type", toJson ty),
      ("fields", Json.mkObj (fs.map fun (c, x) => (c, cellJson x)))])]
  | .patch ty wh set => Json.mkObj [("patch", Json.mkObj [("type", toJson ty), ("where", tupleJson wh),
      ("set", tupleJson set)])]
  | .remove ty wh => Json.mkObj [("remove", Json.mkObj [("type", toJson ty), ("where", tupleJson wh)])]
  | .edit id f v => Json.mkObj [("edit", Json.mkObj [("id", idJson id), ("field", toJson f), ("value", v.json)])]

def recordJson (r : Record String String V) : Json :=
  Json.mkObj [("id", idJson r.id), ("type", toJson r.ty), ("fields", tupleJson r.fields)]

def refusedJson : Refused → Json
  | .badRef op _ => Json.mkObj [("badRef", toJson op)]
  | .missing op => Json.mkObj [("missing", toJson op)]

/-- A mutation vector: the writer, its counter, the Doc's Records and the ops; the Records after, or why it was refused
(and then the Doc is as it was). -/
def mutationVector (name : String) (w : String) (c : Nat) (s : List (Record String String V))
    (ops : List (Op String String V)) : Json :=
  Json.mkObj [("name", toJson name),
    ("input", Json.mkObj [("writer", toJson w), ("counter", toJson c),
      ("records", Json.arr (s.map recordJson).toArray), ("ops", Json.arr (ops.map opJson).toArray)]),
    ("expected", match commit ofId w c s ops with
      | .ok s' => Json.mkObj [("ok", Json.arr (s'.map recordJson).toArray)]
      | .error e => Json.mkObj [("refused", refusedJson e)])]

/-- "I ate 2 bananas": the banana, its quantity, and the eating, each pointing back at the banana. -/
def bananas : List (Op String String V) := [
  .put "banana" [],
  .put "quantity" [("x1", .ref 0), ("x2", .lit (.n 2))],
  .put "eat" [("x1", .lit (.s "samuel")), ("x2", .ref 0)]]

#guard (match commit ofId "dev1" 7 [] bananas with
  | .ok s => s.map fun r => (r.ty, r.fields.map fun (c, v) => (c, v.json))
  | .error _ => []) ==
  [("banana", []), ("quantity", [("x1", toJson "dev1/7/0"), ("x2", toJson 2)]),
   ("eat", [("x1", toJson "samuel"), ("x2", toJson "dev1/7/0")])]

-- A reference forward is refused, and the Doc is as it was.
#guard (match commit ofId "dev1" 7 [] [.put "eat" [("x2", .ref 1)], .put "banana" []] with
  | .ok _ => false
  | .error _ => true)

def todo : List (Record String String V) := [
  ⟨⟨"dev1", 1, 0⟩, "task", [("x2", .s "Order seeds"), ("done", .n 0)]⟩,
  ⟨⟨"dev2", 4, 0⟩, "task", [("x2", .s "Water the beans"), ("done", .n 0)]⟩]

def mutationExamples : List Json := [
  mutationVector "I ate 2 bananas" "dev1" 7 [] bananas,
  mutationVector "a reference forward: refused" "dev1" 7 [] [.put "eat" [("x2", .ref 1)], .put "banana" []],
  mutationVector "a reference to a patch: refused" "dev1" 7 todo
    [.patch "task" [] [("done", .n 1)], .put "note" [("x1", .ref 0)]],
  mutationVector "tick one task done" "dev1" 8 todo [.patch "task" [("x2", .s "Order seeds")] [("done", .n 1)]],
  mutationVector "remove done tasks" "dev1" 9 todo
    [.patch "task" [("x2", .s "Order seeds")] [("done", .n 1)], .remove "task" [("done", .n 1)]],
  mutationVector "edit a title" "dev2" 5 todo [.edit ⟨"dev2", 4, 0⟩ "x2" (.s "Water the beans at dawn")],
  mutationVector "edit a Record that isn't there: refused" "dev2" 5 todo
    [.patch "task" [] [("done", .n 1)], .edit ⟨"dev3", 1, 0⟩ "x2" (.s "?")]]

end Aven.DB.Engine.Examples
