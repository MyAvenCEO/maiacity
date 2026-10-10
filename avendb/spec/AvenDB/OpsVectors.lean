import AvenDB.Ops
import AvenDB.Vectors

/-!
# Ops vectors

`vectors/ops.json`, the cases the Rust engine replays (`crates/avendb/tests/ops.rs`), in the very JSON the page and the
Mac app send (`avendb/docs/OPS.md`):

- **diffs**: two records and the changes between them (`Doc.diff`): every pair of a few records (among them a list
  with two rows of one id, and a field that holds a value where another holds rows), and each run's record before
  and after;
- **runs**: a record, ops run one after the other (`Doc.runAll`), and the record after them, or none where one makes
  no sense of it;
- **queries**: a few entries, each its labels and its record, and for each `where` the selector a device picks by
  (`Where.plan`) and the entries it holds of.

A type or a tag is a number in the model, and its digits here; a vault or an entry is a number, and here the id whose
last 8 bytes are that number, big-endian (`from_u64`).
-/

namespace AvenDB.OpsVectors

open AvenDB.Ops
open AvenDB.Vectors (str arr obj nat bool opt)

/-! ## Records -/

def s (x : String) : Leaf := .one (.str x)
def i (n : Int) : Leaf := .one (.int n)
def b (x : Bool) : Leaf := .one (.bool x)
def row (id : Int) (fs : List (String × Leaf)) : Row := ⟨id, fs⟩

def todo : Doc :=
  [("kind", .leaf (s "todo")), ("title", .leaf (s "Fix the door")), ("status", .leaf (s "open")),
   ("tags", .leaf (.many [.str "home"]))]

def shipIt : Doc :=
  [("kind", .leaf (s "todo")), ("title", .leaf (s "Ship it")), ("status", .leaf (s "doing")),
   ("tags", .leaf (.many [.str "work"])), ("due", .leaf (s "2026-10-12"))]

def plan : Doc :=
  [("kind", .leaf (s "document")), ("title", .leaf (s "Plan")),
   ("blocks", .rows [row 1 [("type", s "heading"), ("level", i 1), ("text", s "Seeds")],
                     row 2 [("type", s "paragraph"), ("text", s "Sow in spring")],
                     row 3 [("type", s "item"), ("checked", b false), ("text", s "Beans")]]),
   ("tags", .rows [])]

/-- What two devices that each added a block 1 at once store: apps see the first. -/
def copies : Doc :=
  [("title", .leaf (s "Copies")),
   ("blocks", .rows [row 1 [("text", s "a")], row 1 [("text", s "b")], row 2 [("text", s "c")], row 1 []])]

/-- A field holding a value where the others hold rows, and a null. -/
def odd : Doc := [("blocks", .leaf (s "not a list")), ("title", .leaf (.one .null)), ("n", .leaf (i (-3)))]

def records : List Doc := [[], todo, shipIt, plan, copies, odd]

/-! ## Runs -/

def water : Row := row 4 [("type", s "paragraph"), ("text", s "Water")]

def runs : List (Doc × List Op) :=
  [ (plan, [.setCell "blocks" 2 "text" (s "Sow in March")]),
    (plan, [.unsetCell "blocks" 3 "checked"]),
    (plan, [.setCell "blocks" 9 "text" (s "Nowhere")]),
    (plan, [.setCell "blocks" 1 "id" (i 5)]),
    (plan, [.unsetCell "blocks" 1 "id"]),
    (plan, [.setCell "title" 1 "text" (s "Not rows")]),
    (plan, [.insert "blocks" water (some 1)]),
    (plan, [.insert "blocks" water none]),
    (plan, [.insert "blocks" water (some 0)]),
    (plan, [.insert "blocks" (row 2 []) none]),
    (plan, [.insert "blocks" water (some 4)]),
    (plan, [.insert "title" water none]),
    (plan, [.insert "notes" water none]),
    (plan, [.insert "notes" water (some 1)]),
    (plan, [.remove "blocks" 1]),
    (plan, [.remove "blocks" 7]),
    (plan, [.remove "title" 1]),
    (plan, [.move "blocks" 3 0]),
    (plan, [.move "blocks" 1 2]),
    (plan, [.move "blocks" 1 3]),
    (plan, [.move "blocks" 5 0]),
    (plan, [.setRow "blocks" (row 2 [("type", s "heading"), ("level", i 2), ("text", s "Spring")])]),
    (plan, [.setRow "blocks" (row 8 [])]),
    (plan, [.set "title" (.leaf (s "Garden plan"))]),
    (plan, [.unset "title"]),
    (plan, [.unset "nothing"]),
    (plan, [.set "blocks" (.rows [])]),
    (plan, [.set "blocks" (.leaf (s "flat"))]),
    (plan, [.set "notes" (.rows [water])]),
    (plan, [.add "tags" (.str "garden") none]),
    (plan, [.add "tags" (.str "garden") (some 1)]),
    (plan, [.drop "tags" (.str "garden")]),
    (plan, [.add "title" (.str "x") none]),
    (plan, [.add "blocks" (.str "x") none]),
    (plan, [.drop "blocks" (.str "x")]),
    (plan, [.put todo]),
    (plan, [.add "tags" (.str "garden") none, .add "tags" (.str "seeds") (some 0), .drop "tags" (.str "garden")]),
    (plan, [.insert "blocks" water (some 0), .move "blocks" 4 3, .setCell "blocks" 4 "text" (s "Moved")]),
    (plan, [.remove "blocks" 2, .setCell "blocks" 2 "text" (s "Gone")]),
    (plan, [.remove "blocks" 1, .remove "blocks" 2, .remove "blocks" 3]),
    (todo, [.add "tags" (.str "work") (some 0)]),
    (todo, [.add "tags" (.str "work") (some 2)]),
    (todo, [.drop "tags" (.str "home")]),
    (todo, [.drop "tags" (.str "away")]),
    (todo, [.set "status" (.leaf (s "doing"))]),
    (todo, [.setCell "tags" 0 "x" (s "y")]),
    (todo, [.set "due" (.leaf (s "2026-10-12")), .unset "status"]),
    (copies, [.setCell "blocks" 1 "text" (s "z")]),
    (copies, [.unsetCell "blocks" 1 "text"]),
    (copies, [.remove "blocks" 1]),
    (copies, [.move "blocks" 2 0]),
    (copies, [.move "blocks" 1 3]),
    (copies, [.setRow "blocks" (row 1 [("text", s "y")])]),
    (copies, [.insert "blocks" (row 3 []) (some 2)]),
    (odd, [.setCell "blocks" 1 "text" (s "x")]),
    (odd, [.drop "n" (.int (-3))]),
    (odd, [.set "blocks" (.rows [row 1 []]), .insert "blocks" (row 2 []) none]),
    ([], [.add "tags" (.str "first") none]),
    ([], [.insert "blocks" water none, .setCell "blocks" 4 "text" (s "Only")]) ]

/-! ## Queries -/

def noteT : Sym := 1
def todoT : Sym := 2
def work : Sym := 7
def home : Sym := 8

def entries : List (Attrs × Doc) :=
  [ (⟨todoT, 1, 11, 100, [home]⟩, todo),
    (⟨todoT, 1, 12, 200, [work]⟩, shipIt),
    (⟨noteT, 2, 13, 300, []⟩, plan),
    (⟨noteT, 1, 14, 400, [work, home]⟩, copies),
    (⟨todoT, 2, 15, 500, []⟩, odd) ]

def lbl (a : Atom) : Where := .label a
def at' (f : String) (t : Test) : Where := .test (.at (.top f)) t

def wheres : List Where :=
  [ .yes, .no,
    lbl (.typeIn [todoT]),
    .and (lbl (.typeIn [todoT])) (at' "status" (.eq (s "open"))),
    .or (lbl (.tagHas work)) (at' "title" (.contains "PLAN")),
    .not (lbl (.typeIn [todoT])),
    .test (.each "blocks" "text") (.contains "spring"),
    .test (.each "blocks" "text") (.present false),
    .test (.at (.row "blocks" ⟨2, 0⟩ "text")) (.present true),
    .test (.at (.row "blocks" ⟨1, 0⟩ "level")) (.lt (.int 2)),
    .test (.at (.row "blocks" ⟨1, 0⟩ "level")) (.ge (.int 2)),
    at' "due" (.present false),
    at' "tags" (.has (.str "home")),
    at' "tags" (.eq (.many [.str "work"])),
    at' "status" (.oneOf [.str "doing", .str "done"]),
    at' "title" (.gt (.str "G")),
    at' "title" (.le (.str "Plan")),
    at' "title" (.ne (s "Plan")),
    at' "title" (.eq (.one .null)),
    at' "n" (.lt (.int 0)),
    at' "n" (.gt (.str "a")),
    at' "tags" (.eq (.many [])),
    at' "tags" (.ne (.many [])),
    at' "blocks" (.present true),
    at' "blocks" (.eq (s "not a list")),
    at' "blocks" (.has (.str "x")),
    at' "tags" (.oneOf [.str "home"]),
    at' "status" (.contains "O"),
    .and (lbl (.createdIn 150 350)) (lbl (.authorIn [1])),
    .and (.or (lbl (.typeIn [noteT])) (lbl (.tagHas work))) (.or (lbl (.authorIn [1])) (lbl (.entryIn [13]))),
    .and (lbl (.typeIn [todoT])) (.not (lbl (.tagHas home))),
    .and (lbl (.tagNone [home])) (.and (lbl (.tagsWithin [work])) (at' "kind" (.present true))),
    .or (lbl (.typeIn [noteT])) (.and (lbl (.typeIn [todoT])) (at' "status" (.ne (s "done")))),
    .and (.and (lbl (.typeIn [noteT])) (lbl (.authorIn [1]))) (.or .no (lbl (.entryIn [14]))),
    .and .yes (lbl (.entryIn [11, 15])),
    ((List.range 9).map fun n => lbl (.entryIn [n + 11])).foldr .or .no,
    ((List.range 17).map fun n => lbl (.createdIn 0 (n + 1000))).foldr .and .yes ]

/-! ## JSON -/

def hexDigit (n : Nat) : Char := if n < 10 then Char.ofNat (48 + n) else Char.ofNat (87 + n)

/-- The id whose last 8 bytes are `n`, big-endian: `from_u64` in the core. -/
def hexId (n : Nat) : String :=
  String.ofList (List.replicate 48 '0' ++ (List.range 16).reverse.map fun k => hexDigit (n / 16 ^ k % 16))

def int (n : Int) : String := toString n

def val : Val → String
  | .null   => "null"
  | .bool x => bool x
  | .int n  => int n
  | .str x  => str x

def leaf : Leaf → String
  | .one v   => val v
  | .many vs => arr (vs.map val)

def rowJson (r : Row) : String := obj (("id", int r.id) :: r.fields.map fun (g, v) => (g, leaf v))

def item : Item → String
  | .leaf v  => leaf v
  | .rows rs => arr (rs.map rowJson)

def doc (d : Doc) : String := obj (d.map fun (f, x) => (f, item x))

def key (k : Key) : String :=
  if k.copy = 0 then obj [("id", int k.id)] else obj [("id", int k.id), ("copy", nat k.copy)]

def path : Path → String
  | .top f       => arr [str f]
  | .row f k g   => arr [str f, key k, str g]

def change : Change Leaf → String
  | .set p (some v) => obj [("set", path p), ("value", leaf v)]
  | .set p none     => obj [("unset", path p)]
  | .order f ks     => obj [("rows", str f), ("keys", opt (fun ks => arr (ks.map key)) ks)]

def idStep (n : Int) : String := obj [("id", int n)]

def place : Option Nat → List (String × String)
  | some n => [("at", nat n)]
  | none => []

def op : Op → String
  | .put d            => obj [("op", str "set"), ("path", arr []), ("value", doc d)]
  | .set f x          => obj [("op", str "set"), ("path", arr [str f]), ("value", item x)]
  | .unset f          => obj [("op", str "unset"), ("path", arr [str f])]
  | .setRow f r       => obj [("op", str "set"), ("path", arr [str f, idStep r.id]), ("value", rowJson r)]
  | .setCell f n g v  => obj [("op", str "set"), ("path", arr [str f, idStep n, str g]), ("value", leaf v)]
  | .unsetCell f n g  => obj [("op", str "unset"), ("path", arr [str f, idStep n, str g])]
  | .insert f r p     => obj ([("op", str "insert"), ("path", arr [str f]), ("value", rowJson r)] ++ place p)
  | .remove f n       => obj [("op", str "remove"), ("path", arr [str f, idStep n])]
  | .move f n to      => obj [("op", str "move"), ("path", arr [str f, idStep n]), ("to", nat to)]
  | .add f v p        => obj ([("op", str "insert"), ("path", arr [str f]), ("value", val v)] ++ place p)
  | .drop f v         => obj [("op", str "remove"), ("path", arr [str f]), ("value", val v)]

def sym (t : Sym) : String := str (toString t)

/-- A label as a cap's selector writes it (`avendb::slice::Atom::to_json`). -/
def atom : Atom → String
  | .typeIn ts       => obj [("type", arr (ts.map sym))]
  | .authorIn vs     => obj [("author", arr (vs.map fun v => str (hexId v)))]
  | .entryIn es      => obj [("entry", arr (es.map fun e => str (hexId e)))]
  | .createdIn lo hi => obj [("created", arr [nat lo, nat hi])]
  | .tagHas t        => obj [("tag", sym t)]
  | .tagNone ts      => obj [("noTag", arr (ts.map sym))]
  | .tagsWithin ts   => obj [("onlyTags", arr (ts.map sym))]

/-- A conjunction of labels as a `where` writes it: one label, or all of them. -/
def conj : List Atom → String
  | [x] => atom x
  | d   => obj [("all", arr (d.map atom))]

/-- A selector as a query's `where` of labels alone writes it, in its normal form (`avendb::slice::Selector::to_json`):
    the whole vault, one conjunction, or any of several. -/
def selector : Selector → String
  | .all       => obj [("all", arr [])]
  | .anyOf [d] => conj d
  | .anyOf ds  => obj [("any", arr (ds.map conj))]

def target : Target → String
  | .at p     => path p
  | .each f g => arr [str f, str "*", str g]

def test : Test → String × String
  | .eq v       => ("eq", leaf v)
  | .ne v       => ("ne", leaf v)
  | .lt v       => ("lt", val v)
  | .le v       => ("le", val v)
  | .gt v       => ("gt", val v)
  | .ge v       => ("ge", val v)
  | .oneOf vs   => ("in", arr (vs.map val))
  | .has v      => ("has", val v)
  | .contains x => ("contains", str x)
  | .present x  => ("exists", bool x)

/-- A `where`: `{"all": [..]}` for `and`, right-nested ands in one list, as the engine folds them back from the right;
    `{"any": [..]}` alike for `or`. -/
partial def «where» : Where → String
  | .yes        => obj [("all", arr [])]
  | .no         => obj [("any", arr [])]
  | .label a    => atom a
  | .test x t   => obj [("path", target x), test t]
  | .and u w    => obj [("all", arr («where» u :: ands w))]
  | .or u w     => obj [("any", arr («where» u :: ors w))]
  | .not w      => obj [("not", «where» w)]
where
  ands : Where → List String
    | .and u w => «where» u :: ands w
    | w => [«where» w]
  ors : Where → List String
    | .or u w => «where» u :: ors w
    | w => [«where» w]

def entryJson (a : Attrs) (d : Doc) : String :=
  obj [("type", sym a.type), ("author", str (hexId a.author)), ("entry", str (hexId a.entry)),
       ("created", nat a.created), ("tags", arr (a.tags.map sym)), ("record", doc d)]

def diffCase (d e : Doc) : String :=
  obj [("before", doc d), ("after", doc e), ("changes", arr ((d.diff e).map change))]

def runCase (d : Doc) (ops : List Op) : String :=
  obj [("before", doc d), ("ops", arr (ops.map op)), ("after", opt doc (d.runAll ops))]

def queryCase (w : Where) : String :=
  let rows := (entries.zipIdx.filter fun ((a, d), _) => w.holds a d.meaning).map (·.2)
  obj [("where", «where» w), ("plan", selector w.plan), ("rows", arr (rows.map nat))]

def ran : List (Doc × Doc) := runs.filterMap fun (d, ops) => (d.runAll ops).map (d, ·)

def lines (xs : List String) : String := "[\n" ++ ",\n".intercalate xs ++ "\n]"

def render : String :=
  "{\"diffs\": " ++ lines ((records.flatMap fun d => records.map (d, ·)) ++ ran |>.map fun (d, e) => diffCase d e) ++
  ",\n\"runs\": " ++ lines (runs.map fun (d, ops) => runCase d ops) ++
  ",\n\"entries\": " ++ lines (entries.map fun (a, d) => entryJson a d) ++
  ",\n\"queries\": " ++ lines (wheres.map queryCase) ++ "}\n"

/-! ## What the cases cover -/

def _root_.AvenDB.Ops.Op.kind : Op → String
  | .put _ => "put"
  | .set .. => "set"
  | .unset _ => "unset"
  | .setRow .. => "setRow"
  | .setCell .. => "setCell"
  | .unsetCell .. => "unsetCell"
  | .insert .. => "insert"
  | .remove .. => "remove"
  | .move .. => "move"
  | .add .. => "add"
  | .drop .. => "drop"

-- O2 on the cases: every run that makes sense changes only what its ops name
#guard runs.all fun (d, ops) => match d.runAll ops with
  | some e => d.within (ops.map Op.loc) e
  | none => true
-- every op runs somewhere, and every op that names a row or a list somewhere makes no sense
#guard ["put", "set", "unset", "setRow", "setCell", "unsetCell", "insert", "remove", "move", "add", "drop"].all
  fun k => runs.any fun (d, ops) => ops.any (·.kind == k) && (d.runAll ops).isSome
#guard ["setRow", "setCell", "unsetCell", "insert", "remove", "move", "add", "drop"].all
  fun k => runs.any fun (d, ops) => ops.any (·.kind == k) && (d.runAll ops).isNone
-- diffs name copies of a row, lists that become values and back, and every kind of change
#guard (records.flatMap fun d => records.map (d, ·)).any fun (d, e) => (d.diff e).any fun
  | .set (.row _ k _) _ => k.copy > 0
  | _ => false
#guard (records.flatMap fun d => records.map (d, ·)).any fun (d, e) => (d.diff e).any fun
  | .order _ none => true
  | _ => false
#guard ran.any fun (d, e) => (d.diff e).any fun
  | .order _ (some _) => true
  | _ => false
-- queries pick some entries and not others, and some plan picks by no selector for its size
#guard wheres.all fun w => entries.all fun (a, d) => !w.holds a d.meaning || w.plan.matches a
#guard wheres.any fun w => w.cover != .all && w.plan == .all
#guard wheres.any fun w => let n := (entries.filter fun (a, d) => w.holds a d.meaning).length; 0 < n && n < entries.length

end AvenDB.OpsVectors
