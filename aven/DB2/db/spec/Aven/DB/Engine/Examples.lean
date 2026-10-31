import Lean.Data.Json
import Aven.DB.Engine.Query
import Aven.DB.Engine.Wants
import Aven.DB.Engine.Mutate
import Aven.DB.Engine.Footprint
import Aven.DB.Engine.Changes
import Aven.DB.Engine.Index
import Aven.DB.Engine.Probe

/-!
# The engine's examples, and how its vectors are written (README, rule 10)

The models run here on `Aven.Core`'s own types: Values, Doc ids and type Docs named by BLAKE3 hashes, targets, steps
and grants. Values are equal by Core's lawful equality; integers order by sign and magnitude, text by code point. Every example is
checked by `lake build` (`#guard`), and `Vectors` writes them, with generated cases, to `queries.json`, `wants.json`,
`mutations.json` and `lookups.json`. JSON is only the readable form: a Value as `Aven.Core`'s vectors write it, a Doc
id as `d:<hex>`. -/

open Lean

namespace Aven.DB.Engine.Examples

open Aven.Core Aven.DB.Engine

def utf8 (s : String) : Bytes := s.toUTF8.toList

/-- A Doc named in an example: the hash of its label. -/
def doc (label : String) : DocId := ⟨blake3 (utf8 ("doc:" ++ label))⟩

/-- A vault named in an example, by a 32-byte name (A190). -/
def vault (label : String) : Hash := blake3 (utf8 ("vault:" ++ label))

def text (s : String) : Value := .text (utf8 s)

theorem vals_refl : ∀ x, vals.eq x x = true := by intro x; simp [vals]

def docJson (d : DocId) : Json := toJson d.text

def tupleJson (t : Tuple Value) : Json := Json.mkObj (t.map fun (c, v) => (utf8Text c, v.json))

def rows (fs : List (String × Value)) : Tuple Value := fs.map fun (c, v) => (utf8 c, v)

/-! ## Queries -/

def cmpName : Cmp → String
  | .eq => "eq" | .ne => "ne" | .lt => "lt" | .le => "le"

def pairJson (l r : Json) (lc rc : Bytes) : Json :=
  Json.mkObj [("left", l), ("right", r), ("leftColumn", toJson (utf8Text lc)), ("rightColumn", toJson (utf8Text rc))]

def queryJson : Query Value → Json
  | .scan ty => Json.mkObj [("scan", docJson ty)]
  | .filter col cmp v q => Json.mkObj [("filter", Json.mkObj
      [("column", toJson (utf8Text col)), ("cmp", toJson (cmpName cmp)), ("value", v.json),
       ("query", queryJson q)])]
  | .project cols q => Json.mkObj [("project", Json.mkObj
      [("columns", toJson (cols.map utf8Text)), ("query", queryJson q)])]
  | .join l r lc rc => Json.mkObj [("join", pairJson (queryJson l) (queryJson r) lc rc)]
  | .leftJoin l r lc rc => Json.mkObj [("leftJoin", pairJson (queryJson l) (queryJson r) lc rc)]
  | .anti l r lc rc => Json.mkObj [("anti", pairJson (queryJson l) (queryJson r) lc rc)]
  | .order col q => Json.mkObj [("order", Json.mkObj [("column", toJson (utf8Text col)), ("query", queryJson q)])]
  | .group col q => Json.mkObj [("group", Json.mkObj [("column", toJson (utf8Text col)), ("query", queryJson q)])]
  | .limit n q => Json.mkObj [("limit", Json.mkObj [("n", toJson n), ("query", queryJson q)])]

def targetJson : Target → Json
  | .doc d r => Json.mkObj [("doc", docJson d), ("reach", toJson r.name)]
  | .vault v b => Json.mkObj [("vault", toJson v.text), ("below", toJson b)]
  | .vaultType v t b => Json.mkObj [("vault", toJson v.text), ("type", docJson t), ("below", toJson b)]

def factsJson (f : Facts) : Json :=
  Json.mkObj [("id", docJson f.id), ("vault", toJson f.vault.text), ("type", docJson f.type)]

def answerJson : Answer Value → Json
  | .refused => toJson "refused"
  | .rows st rs => Json.mkObj [
      ("status", match st with
        | .complete => toJson "complete"
        | .short missing => Json.mkObj [("short", Json.arr (missing.map docJson).toArray)]),
      ("rows", Json.arr (rs.map tupleJson).toArray)]

def recJson (r : Rec Value) : Json :=
  Json.mkObj [("doc", docJson r.doc), ("type", docJson r.type), ("fields", tupleJson r.fields)]

/-- How many Records of each type the database has at all: the counts a query's bound and cost come from. -/
def counts (db : List (Rec Value)) (ty : DocId) : Nat := (db.filter (·.type == ty)).length

/-- No vault governs another, no actor spawned another and no collection lists a Doc, in these examples. -/
def noGov : Hash → Hash → Bool := fun _ _ => false
def noSpawn : DocId → DocId → Bool := fun _ _ => false
def noLists : DocId → DocId → Bool := fun _ _ => false

/-- A query vector: the directory's genesis facts, Records, the Docs held, a stored query; the answer (refused,
complete, or short with the Docs missing), the query's bound and cost, and the work it did. -/
def queryVector (name : String) (dir : List Facts) (db : List (Rec Value)) (held : List DocId) (s : Spec Value) :
    Json :=
  let heldF := fun d => held.contains d
  let answer := run vals noGov noSpawn noLists dir heldF db s
  let docs := match s.target with | some t => resolve noGov noSpawn noLists dir t | none => []
  Json.mkObj [("name", toJson name),
    ("input", Json.mkObj [("directory", Json.arr (dir.map factsJson).toArray),
      ("records", Json.arr (db.map recJson).toArray), ("held", Json.arr (held.map docJson).toArray),
      ("target", match s.target with | some t => targetJson t | none => Json.null),
      ("query", queryJson s.body)]),
    ("expected", Json.mkObj [("answer", answerJson answer), ("bound", toJson (bound (counts db) s.body)),
      ("cost", toJson (cost (counts db) s.body)), ("work", toJson (work vals (inScope db docs heldF) s.body))])]

def task : DocId := doc "type:task"
def done_ : DocId := doc "type:done"
def due : DocId := doc "type:due"
def memberOf : DocId := doc "type:member_of"
def home : DocId := doc "home"
def coop : DocId := doc "coop"
def garden : DocId := doc "garden-books"

def dir : List Facts := [⟨home, vault "samuel", doc "type:household"⟩, ⟨coop, vault "maia-city", doc "type:projects"⟩,
  ⟨garden, vault "samuel", doc "type:books"⟩]

def tasks : List (Rec Value) := [
  ⟨home, task, rows [("id", text "t1"), ("x2", text "Order seeds")]⟩,
  ⟨home, task, rows [("id", text "t2"), ("x2", text "Water the beans")]⟩,
  ⟨home, task, rows [("id", text "t3"), ("x2", text "Prune the apple")]⟩,
  ⟨home, done_, rows [("id", text "f1"), ("x1", text "t2")]⟩,
  ⟨home, due, rows [("id", text "f2"), ("x1", text "2026-11-02"), ("x2", text "t1")]⟩,
  ⟨home, due, rows [("id", text "f3"), ("x1", text "2026-11-01"), ("x2", text "t3")]⟩,
  ⟨coop, task, rows [("id", text "t9"), ("x2", text "Not in this target")]⟩]

/-- Open tasks by due date: tasks with no `done`, each with its `due`, soonest first. -/
def openByDue : Query Value :=
  .project [utf8 "id", utf8 "x2", utf8 "x1"] <|
    .order (utf8 "x1") <| .leftJoin (.anti (.scan task) (.scan done_) (utf8 "id") (utf8 "x1")) (.scan due)
      (utf8 "id") (utf8 "x2")

-- Samuel's vault: the household and the garden books. The coop's Doc is outside it.
#guard answerJson
    (run vals noGov noSpawn noLists dir (· == home) tasks ⟨some (.vault (vault "samuel") false), openByDue⟩) ==
  answerJson (.rows (.short [garden]) [
    rows [("id", text "t3"), ("x2", text "Prune the apple"), ("x1", text "2026-11-01")],
    rows [("id", text "t1"), ("x2", text "Order seeds"), ("x1", text "2026-11-02")]])

-- One Doc as the target, held: complete.
#guard answerJson (run vals noGov noSpawn noLists dir (· == home) tasks ⟨some (.doc home .self), openByDue⟩) ==
  answerJson (.rows .complete [
    rows [("id", text "t3"), ("x2", text "Prune the apple"), ("x1", text "2026-11-01")],
    rows [("id", text "t1"), ("x2", text "Order seeds"), ("x1", text "2026-11-02")]])

-- A query without a target is refused.
#guard answerJson (run vals noGov noSpawn noLists dir (fun _ => true) tasks ⟨none, openByDue⟩) == toJson "refused"

def projects : List (Rec Value) :=
  (["ana", "ben", "cai", "dee"].map fun p => ⟨coop, memberOf, rows [("x1", text p), ("x2", text "garden")]⟩) ++
  (["ana", "ben"].map fun p => ⟨coop, memberOf, rows [("x1", text p), ("x2", text "bees")]⟩)

/-- Projects with more than three members (ontology, "A worked example"). -/
def crowded : Query Value :=
  .anti (.group (utf8 "x2") (.scan memberOf))
    (.filter (utf8 "count") .lt (.uint 4) (.group (utf8 "x2") (.scan memberOf))) (utf8 "x2") (utf8 "x2")

#guard answerJson (run vals noGov noSpawn noLists dir (fun _ => true) projects ⟨some (.doc coop .self), crowded⟩) ==
  answerJson (.rows .complete [rows [("x2", text "garden"), ("count", .uint 4)]])

def queryExamples : List Json := [
  queryVector "open tasks by due date, one Doc" dir tasks [home] ⟨some (.doc home .self), openByDue⟩,
  queryVector "open tasks in a vault, one Doc not held: short" dir tasks [home]
    ⟨some (.vault (vault "samuel") false), openByDue⟩,
  queryVector "no target: refused" dir tasks [home] ⟨none, openByDue⟩,
  queryVector "projects with more than three members" dir projects [coop] ⟨some (.doc coop .self), crowded⟩,
  queryVector "the first two tasks" dir tasks [home, coop] ⟨some (.vault (vault "samuel") false), .limit 2 (.scan task)⟩,
  queryVector "every task with its due date" dir tasks [home] ⟨some (.doc home .self),
    .join (.scan task) (.scan due) (utf8 "id") (utf8 "x2")⟩]

/-! ## Wants -/

def tierName : Tier → String
  | .screen => "screen" | .turn => "turn" | .next => "next" | .later => "later" | .idle => "idle"

def depthName : Depth → String
  | .head => "head" | .records => "records" | .files => "files"

def windowJson : Window → Json
  | .newest n => Json.mkObj [("newest", toJson n)]
  | .since v => Json.mkObj [("since", toJson (v.map Hash.text))]
  | .all => toJson "all"
  | .bytes lo hi => Json.mkObj [("bytes", toJson [lo, hi])]

def keyJson (k : WantKey) : Json :=
  Json.mkObj [("doc", docJson k.doc), ("branch", toJson (utf8Text k.branch)), ("depth", toJson (depthName k.depth)),
    ("window", windowJson k.window)]

def wantJson (w : Want WantKey) : Json :=
  Json.mkObj [("key", keyJson w.key), ("tier", toJson (tierName w.tier)), ("signal", toJson w.signal)]

def keptJson (e : Kept WantKey) : Json :=
  Json.mkObj [("key", keyJson e.key), ("tier", toJson (tierName e.tier)), ("bytes", toJson e.bytes),
    ("used", toJson e.used)]

def roundJson : Round WantKey → Json
  | .moved k => Json.mkObj [("moved", keyJson k)]
  | .done => toJson "done"
  | .stalled k => Json.mkObj [("stalled", keyJson k)]

/-- A key on `main`. -/
def key (label : String) (d : Depth) (w : Window := .all) : WantKey := ⟨doc label, utf8 "main", d, w⟩

/-- A want vector: wants, the keys caps allow, each key's prerequisites; the queue. Then a round over pages left
and a source, and eviction to a budget. -/
def wantVector (name : String) (ws : List (Want WantKey)) (caps : List WantKey) (pre : List (WantKey × List WantKey))
    (left : List (WantKey × Nat)) (uploads : List WantKey) (got : List WantKey) (budget : Nat)
    (kept : List (Kept WantKey)) : Json :=
  let preF := fun k => (pre.lookup k).getD []
  let q := queue (fun k => caps.contains k) (expand preF ws)
  let leftF := fun k => (left.lookup k).getD 0
  let (r, left') := round leftF uploads (q.map (·.key)) (fun k => got.contains k)
  let keys := uploads ++ q.map (·.key)
  Json.mkObj [("name", toJson name),
    ("input", Json.mkObj [("wants", Json.arr (ws.map wantJson).toArray), ("caps", Json.arr (caps.map keyJson).toArray),
      ("pre", Json.arr (pre.map fun (k, ks) => Json.mkObj [("key", keyJson k),
        ("needs", Json.arr (ks.map keyJson).toArray)]).toArray),
      ("left", Json.arr (left.map fun (k, n) => Json.mkObj [("key", keyJson k), ("pages", toJson n)]).toArray),
      ("uploads", Json.arr (uploads.map keyJson).toArray), ("got", Json.arr (got.map keyJson).toArray),
      ("budget", toJson budget), ("kept", Json.arr (kept.map keptJson).toArray)]),
    ("expected", Json.mkObj [("queue", Json.arr (q.map wantJson).toArray), ("round", roundJson r),
      ("left", Json.arr (keys.map fun k => Json.mkObj [("key", keyJson k), ("pages", toJson (left' k))]).toArray),
      ("kept", Json.arr ((evict budget kept).map keptJson).toArray)])]

def room := key "room" .records (.newest 50)
def roomHead := key "room" .head
def roomKey := key "room:key" .records
def roomCheckpoint := key "room" .records
def archive := key "archive" .records
def photo := key "photo" .files (.bytes 0 1048576)
def secret := key "secret" .records
def outbox := key "outbox" .records
def projectsKey := key "projects" .records
def oldKey := key "old" .records

def chatWants : List (Want WantKey) := [
  ⟨roomHead, .next, 2⟩, ⟨room, .screen, 0⟩, ⟨archive, .idle, 0⟩, ⟨photo, .screen, 1⟩, ⟨secret, .screen, 0⟩,
  ⟨room, .idle, 0⟩]

def chatPre : List (WantKey × List WantKey) := [(room, [roomKey, roomCheckpoint]), (photo, [roomKey])]

def chatCaps : List WantKey := [roomHead, room, roomKey, roomCheckpoint, archive, photo]

-- The room's key and checkpoint come first, at the screen's tier its Records are wanted at, then the Records; the
-- secret Doc is wanted but not allowed, so it is not queued; the room's head, wanted at `next`, is queued once.
#guard (queue (fun k => chatCaps.contains k) (expand (fun k => (chatPre.lookup k).getD []) chatWants)).map
    (fun w => (w.key, tierName w.tier)) ==
  [(roomKey, "screen"), (roomCheckpoint, "screen"), (room, "screen"), (photo, "screen"), (roomHead, "next"),
   (archive, "idle")]

def chatKept : List (Kept WantKey) := [
  ⟨room, .screen, 40, 9⟩, ⟨archive, .idle, 300, 1⟩, ⟨oldKey, .idle, 200, 5⟩, ⟨projectsKey, .later, 100, 3⟩]

-- Over a budget of 250 bytes: the screen's room stays, then the later projects; the idle Docs go.
#guard (evict 250 chatKept).map (·.key) == [room, projectsKey]

-- The room's key waits for a cap; the outbox's upload waits on nothing: the round sends the upload, the room's wait
-- stops nothing else.
#guard (roundW (fun k => if k == roomKey then 1 else if k == outbox then 2 else 0)
    (fun k => if k == roomKey then some Wait.cap else none) [outbox] [roomKey, room] (fun _ => true)).1 ==
  .moved outbox

-- When every key with work left waits, the round names each and what it waits for.
#guard (roundW (fun k => if k == roomKey then 1 else if k == room then 3 else 0)
    (fun k => if k == roomKey then some Wait.cap else if k == room then some Wait.key else none) [] [roomKey, room]
    (fun _ => true)).1 ==
  .waiting [(roomKey, .cap), (room, .key)]

-- A page holds at most 3 entries and 1000 bytes: of the room's pending chunks of 400, 400, 400 and 100 bytes, a round
-- moves the first two (800 bytes; a third would make 1200) and leaves the rest pending.
#guard (match roundP id ⟨1000, 3⟩ (fun k => if k == room then [400, 400, 400, 100] else []) [] [room] (fun _ => true) with
  | (.moved _, p, pending') => (p, pending' room)
  | _ => ([], [])) == ([400, 400], [400, 100])

def wantExamples : List Json := [
  wantVector "a chat room on screen, the outbox first" chatWants chatCaps chatPre
    [(room, 3), (roomKey, 1), (outbox, 2)] [outbox] [outbox] 250 chatKept,
  wantVector "uploads done, the room's key first" chatWants chatCaps chatPre
    [(room, 3), (roomKey, 1)] [outbox] [roomKey] 1000 chatKept,
  wantVector "a source that gives nothing: stalled" chatWants chatCaps chatPre [(room, 3)] [] [] 40 chatKept,
  wantVector "nothing left: done" chatWants chatCaps chatPre [] [] [] 0 chatKept]

/-! ## Mutations and footprints -/

def ofId (i : NewId) : Value := .array [.uint i.writer, .uint i.counter, .uint i.index]

def cellJson : Cell Value → Json
  | .lit v => v.json
  | .ref n => Json.mkObj [("ref", toJson n)]

def idJson (i : NewId) : Json :=
  Json.mkObj [("writer", toJson i.writer), ("counter", toJson i.counter), ("index", toJson i.index)]

def opJson : Op Value → Json
  | .put ty fs => Json.mkObj [("put", Json.mkObj [("type", docJson ty),
      ("fields", Json.mkObj (fs.map fun (c, x) => (utf8Text c, cellJson x)))])]
  | .patch ty wh set => Json.mkObj [("patch", Json.mkObj [("type", docJson ty), ("where", tupleJson wh),
      ("set", tupleJson set)])]
  | .remove ty wh => Json.mkObj [("remove", Json.mkObj [("type", docJson ty), ("where", tupleJson wh)])]
  | .edit ty id f v => Json.mkObj [("edit", Json.mkObj [("type", docJson ty), ("id", idJson id),
      ("field", toJson (utf8Text f)), ("value", v.json)])]

def recordJson (r : Record Value) : Json :=
  Json.mkObj [("id", idJson r.id), ("type", docJson r.type), ("fields", tupleJson r.fields)]

def refusedJson : Refused → Json
  | .badRef op => Json.mkObj [("badRef", toJson op)]
  | .missing op => Json.mkObj [("missing", toJson op)]

def stepJson (s : Step) : Json :=
  Json.mkObj [("type", docJson s.type), ("verb", toJson s.verb.name), ("fields", toJson (s.fields.map utf8Text))]

/-- A mutation vector: the writer id, its counter, a Doc's Records and core operations; the footprint, the Records after
the commit or why it was refused (and then the Doc is as it was), and every reader's check. Whether the writer may call
those ops is caps' (A32). -/
def mutationVector (name : String) (w c : Nat) (s : List (Record Value)) (ops : List (Op Value)) : Json :=
  Json.mkObj [("name", toJson name),
    ("input", Json.mkObj [("writer", toJson w), ("counter", toJson c),
      ("records", Json.arr (s.map recordJson).toArray), ("ops", Json.arr (ops.map opJson).toArray)]),
    ("expected", Json.mkObj [("footprint", Json.arr ((footprint ops).map stepJson).toArray),
      ("commit", match commit vals.eq ofId w c s ops with
        | .ok s' => Json.mkObj [("ok", Json.arr (s'.map recordJson).toArray),
            ("check", toJson (check vals.eq ops s s'))]
        | .error e => Json.mkObj [("refused", refusedJson e)])])]

def banana : DocId := doc "type:banana"
def quantity : DocId := doc "type:quantity"
def eat : DocId := doc "type:eat"
def note : DocId := doc "type:note"

/-- "I ate 2 bananas": the banana, its quantity, and the eating, each pointing back at the banana. -/
def bananas : List (Op Value) := [
  .put banana [],
  .put quantity [(utf8 "x1", .ref 0), (utf8 "x2", .lit (.uint 2))],
  .put eat [(utf8 "x1", .lit (text "samuel")), (utf8 "x2", .ref 0)]]

#guard (match commit vals.eq ofId 1 7 [] bananas with
  | .ok s => s.map fun r => (r.type, tupleJson r.fields)
  | .error _ => []) ==
  [(banana, tupleJson []), (quantity, tupleJson (rows [("x1", ofId ⟨1, 7, 0⟩), ("x2", .uint 2)])),
   (eat, tupleJson (rows [("x1", text "samuel"), ("x2", ofId ⟨1, 7, 0⟩)]))]

-- A reference forward is refused, and the Doc is as it was.
#guard (match commit vals.eq ofId 1 7 [] [.put eat [(utf8 "x2", .ref 1)], .put banana []] with
  | .ok _ => false
  | .error _ => true)

def todo : List (Record Value) := [
  ⟨⟨1, 1, 0⟩, task, rows [("x2", text "Order seeds"), ("done", .uint 0)]⟩,
  ⟨⟨2, 4, 0⟩, task, rows [("x2", text "Water the beans"), ("done", .uint 0)]⟩]

def tick : List (Op Value) := [.patch task (rows [("x2", text "Order seeds")]) (rows [("done", .uint 1)])]

-- Ticking a task done passes every reader's check of its diff.
#guard (match commit vals.eq ofId 1 8 todo tick with
  | .ok s' => check vals.eq tick todo s'
  | .error _ => false)

-- A diff that also renames the task is not within the tick's footprint.
#guard diffWithin vals.eq (footprint tick) todo (todo.map fun r =>
  if r.id == ⟨1, 1, 0⟩ then { r with fields := rows [("x2", text "Order bean seeds"), ("done", .uint 1)] } else r) ==
  false

/-- Every type Doc written under one schema version in these examples. -/
def ver (t : DocId) : TypeId := ⟨t, blake3 (utf8 "schema:v1")⟩

-- Ticking a task done is one edited Record whose one field is `done`, and the untouched task is no change; it passes
-- the verdict's footprint part.
#guard (match commit valEq ofId 1 8 todo tick with
  | .ok s' => ((changesFrom ver todo s').map fun c => (c.kind, c.names.map utf8Text),
      verdictFootprint ver (footprint tick) todo s')
  | .error _ => ([], false)) ==
  ([(Aven.DB.Docs.ChangeKind.edited, ["done"])], true)

-- A merge into main is judged on the whole merge. A proposal renamed the task; the merger, whose cap lets it only tick
-- tasks done, settles the merge by ticking it. The settling commit's own changes are only `done`, within the tick's
-- footprint; the whole merge also renames the task on main, which isn't, so the merge's footprint must hold the
-- rename's call too, and caps checks the merger may call it (`Aven.ID.merge_covered`).
def mainBefore : List (Record Value) := [⟨⟨1, 1, 0⟩, task, rows [("x2", text "Order seeds"), ("done", .uint 0)]⟩]
def proposal : List (Record Value) := [⟨⟨1, 1, 0⟩, task, rows [("x2", text "Order bean seeds"), ("done", .uint 0)]⟩]
def merged : List (Record Value) := [⟨⟨1, 1, 0⟩, task, rows [("done", .uint 1), ("x2", text "Order bean seeds")]⟩]
def settle : List (Op Value) := [.patch task [] (rows [("done", .uint 1)])]

#guard verdictFootprint ver (footprint settle) proposal merged == true
#guard verdictFootprint ver (footprint settle) mainBefore merged == false

-- A Record's type is fixed at birth. Turning the task into a note, keeping its id and every field, changes no field, so
-- the change view shows nothing; the verdict refuses it, whatever the footprint, the empty one included.
def retyped : List (Record Value) := todo.map fun r => if r.id == ⟨1, 1, 0⟩ then { r with type := note } else r
#guard changesFrom ver todo retyped == []
#guard verdictFootprint ver [] todo retyped == false
#guard verdictFootprint ver (footprint tick) todo retyped == false

def mutationExamples : List Json := [
  mutationVector "I ate 2 bananas" 1 7 [] bananas,
  mutationVector "a reference forward: refused" 1 7 [] [.put eat [(utf8 "x2", .ref 1)], .put banana []],
  mutationVector "a reference to a patch: refused" 1 7 todo
    [.patch task [] (rows [("done", .uint 1)]), .put note [(utf8 "x1", .ref 0)]],
  mutationVector "tick one task done" 1 8 todo tick,
  mutationVector "rename a task" 1 8 todo
    [.patch task (rows [("x2", text "Order seeds")]) (rows [("x2", text "Order bean seeds")])],
  mutationVector "remove done tasks" 1 9 todo (tick ++ [.remove task (rows [("done", .uint 1)])]),
  mutationVector "edit a title" 2 5 todo [.edit task ⟨2, 4, 0⟩ (utf8 "x2") (text "Water the beans at dawn")],
  mutationVector "edit a Record that isn't there: refused" 2 5 todo
    [.patch task [] (rows [("done", .uint 1)]), .edit task ⟨3, 1, 0⟩ (utf8 "x2") (text "?")]]

/-! ## Sealed indexes -/

def shapeJson (sh : Shape) : Json :=
  Json.mkObj [("vault", toJson sh.vault.text), ("type", docJson sh.type), ("eqs", toJson (sh.eqs.map utf8Text)),
    ("range", match sh.range with | some f => toJson (utf8Text f) | none => Json.null),
    ("order", match sh.order with | some f => toJson (utf8Text f) | none => Json.null),
    ("name", toJson (sh.name blake3).text)]

def probeJson (p : Probe Value) : Json :=
  Json.mkObj [("eqs", Json.arr (p.eqs.map Value.json).toArray),
    ("range", match p.range with | some (lo, hi) => Json.arr #[lo.json, hi.json] | none => Json.null)]

def entryJson (e : Entry Value) : Json :=
  Json.mkObj [("key", Json.arr (e.key.map Value.json).toArray), ("doc", docJson e.doc)]

/-- An index vector: a shape, the Records at version V and the Docs the directory listed then, the Records now, the
Docs unfolded since and the Docs listed now, a probe; the index at V, its hits, the candidates, the query over them,
and the folded index. -/
def indexVector (name : String) (sh : Shape) (dbV db : List (Rec Value)) (docsV unfolded now : List DocId)
    (p : Probe Value) : Json :=
  let idx := build sh dbV docsV
  let cands := candidates vals sh p idx unfolded now
  Json.mkObj [("name", toJson name),
    ("input", Json.mkObj [("shape", shapeJson sh), ("recordsAtV", Json.arr (dbV.map recJson).toArray),
      ("docsAtV", Json.arr (docsV.map docJson).toArray), ("records", Json.arr (db.map recJson).toArray),
      ("unfolded", Json.arr (unfolded.map docJson).toArray), ("now", Json.arr (now.map docJson).toArray),
      ("probe", probeJson p)]),
    ("expected", Json.mkObj [("index", Json.arr (idx.map entryJson).toArray),
      ("hits", Json.arr ((hits vals sh p idx).map docJson).toArray),
      ("candidates", Json.arr (cands.map docJson).toArray),
      ("rows", Json.arr ((select vals sh p db cands).map recJson).toArray),
      ("folded", Json.arr ((fold sh idx db unfolded now).map entryJson).toArray)])]

def invoice : DocId := doc "type:invoice"
def inv (n : Nat) : DocId := doc s!"invoice-{n}"

def invoicesV : List (Rec Value) := (List.range 6).map fun n =>
  ⟨inv n, invoice, rows [("customer", text (if n % 2 = 0 then "ana" else "ben")), ("total", .uint (100 * n))]⟩

/-- Invoice 6 is new since V, and invoice 1 changed its customer. -/
def invoicesNow : List (Rec Value) :=
  invoicesV.filter (·.doc != inv 1) ++
  [⟨inv 1, invoice, rows [("customer", text "ana"), ("total", .uint 100)]⟩,
   ⟨inv 6, invoice, rows [("customer", text "ana"), ("total", .uint 600)]⟩]

/-- Ana's invoices by total. -/
def byCustomer : Shape := ⟨vault "samuel", invoice, [utf8 "customer"], some (utf8 "total"), some (utf8 "total")⟩

def anaFrom200 : Probe Value := ⟨[text "ana"], some (.uint 200, .uint 10000)⟩

def docsV : List DocId := (List.range 6).map inv
def docsNow : List DocId := (List.range 7).map inv

-- The index at V names invoices 2 and 4; the directory adds 1 and 6, unfolded; the query re-checks every candidate
-- and returns 2, 4 and 6: invoice 1, now Ana's, is below 200.
#guard (select vals byCustomer anaFrom200 invoicesNow
    (candidates vals byCustomer anaFrom200 (build byCustomer invoicesV docsV) [inv 1, inv 6] docsNow)).map (·.doc) ==
  [inv 2, inv 4, inv 6]

-- The same as running the query over every invoice the directory lists now.
#guard (select vals byCustomer anaFrom200 invoicesNow docsNow).map (·.doc) == [inv 2, inv 4, inv 6]

-- The docs layer's tree, nodes cut by the last byte and 64 bytes, finds the same hits through the probe's byte range.
#guard treeHits (fun e => (e.getLastD 0).toNat % 4 == 0) List.length 64 anaFrom200 (build byCustomer invoicesV docsV) ==
  hits vals byCustomer anaFrom200 (build byCustomer invoicesV docsV)

-- It is Ana's invoices 2 and 4 from 200 at V.
#guard treeHits (fun e => (e.getLastD 0).toNat % 4 == 0) List.length 64 anaFrom200 (build byCustomer invoicesV docsV) ==
  [inv 2, inv 4]

def indexExamples : List Json := [
  indexVector "Ana's invoices from 200, two unfolded" byCustomer invoicesV invoicesNow docsV [inv 1, inv 6] docsNow
    anaFrom200,
  indexVector "Ben's invoices, everything folded" byCustomer invoicesV invoicesV docsV [] docsV
    ⟨[text "ben"], none⟩,
  indexVector "a probe nothing matches" byCustomer invoicesV invoicesNow docsV [inv 1, inv 6] docsNow
    ⟨[text "cai"], none⟩]

end Aven.DB.Engine.Examples
