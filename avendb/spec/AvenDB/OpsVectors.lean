import AvenDB.Ops
import AvenDB.Vectors

/-!
# Ops vectors

`vectors/ops.json`, the cases the Rust engine replays (`crates/avendb/tests/ops.rs`), in the very JSON the page and the
Mac app send (`avendb/docs/ARCHITECTURE.md` §8):

- **diffs**: two records and the changes between them (`Doc.diff`): every pair of a few records (among them a list
  with two rows of one id, a field that holds a value where another holds rows, an outline whose rows hold rows five
  lists deep, and a list in a row with two rows of one id), and each run's record before and after;
- **runs**: a record, ops run one after the other (`Doc.runAll`), and the record after them, or none where one makes
  no sense of it: at every depth, and in a row that isn't there;
- **queries**: a few entries, each its labels and its record, and for each `where` the selector a device picks by
  (`Where.plan`) and the entries it holds of, with tests in any row (`*`) at any depth.

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

instance : Coe Leaf Item := ⟨.leaf⟩

def row (id : Int) (fs : List (String × Item)) : Row := .mk id fs

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

/-- An outline: rows holding rows, five lists deep, a list of values in a row, and a row's empty list. -/
def outline : Doc :=
  [("title", .leaf (s "Garden")),
   ("blocks", .rows [
     row 1 [("text", s "Beds"), ("children", .rows [
       row 11 [("text", s "North bed"), ("children", .rows [
         row 111 [("text", s "Beans"), ("children", .rows [
           row 1111 [("text", s "Runner"), ("children", .rows [
             row 11111 [("text", s "Scarlet")],
             row 11112 [("text", s "White")]])],
           row 1112 [("text", s "Dwarf")]])],
         row 112 [("text", s "Peas")]])],
       row 12 [("text", s "South bed"), ("tags", .leaf (.many [.str "sun"]))]])],
     row 2 [("text", s "Tools"), ("children", .rows [])]])]

/-- What two devices that each added child 21 of block 2 at once store, a list down: apps see the first. -/
def nestedCopies : Doc :=
  [("blocks", .rows [
     row 1 [("text", s "a")],
     row 2 [("text", s "b"), ("children", .rows [row 21 [("text", s "c")], row 21 [("text", s "d")], row 22 []])]])]

def records : List Doc := [[], todo, shipIt, plan, copies, odd, outline, nestedCopies]

/-! ## Runs -/

def water : Row := row 4 [("type", s "paragraph"), ("text", s "Water")]

/-- The steps to a row: each list's field and the row's id in turn. -/
def rowAt : List (String × Int) → Loc
  | [] => []
  | (f, n) :: rest => .field f :: .row n :: rowAt rest

/-- An edit of a field of the record itself. -/
def top (f : String) (e : FieldOp) : RecordOp := .edit [] f e

/-- An edit of field `g` of the row with id `n` of list `f`. -/
def cell (f : String) (n : Int) (g : String) (e : FieldOp) : RecordOp := .edit [.field f, .row n] g e

/-- An edit of field `g` of the row the chain `rows` names. -/
def deep (rows : List (String × Int)) (g : String) (e : FieldOp) : RecordOp := .edit (rowAt rows) g e

/-- The rows of the outline, from block 1 down. -/
def b1 : List (String × Int) := [("blocks", 1)]
def c11 : List (String × Int) := b1 ++ [("children", 11)]
def c111 : List (String × Int) := c11 ++ [("children", 111)]
def c1111 : List (String × Int) := c111 ++ [("children", 1111)]
def c11111 : List (String × Int) := c1111 ++ [("children", 11111)]

def runs : List (Doc × List RecordOp) :=
  [ (plan, [cell "blocks" 2 "text" (.set (s "Sow in March"))]),
    (plan, [cell "blocks" 3 "checked" .unset]),
    (plan, [cell "blocks" 9 "text" (.set (s "Nowhere"))]),
    (plan, [cell "blocks" 1 "id" (.set (i 5))]),
    (plan, [cell "blocks" 1 "id" .unset]),
    (plan, [cell "title" 1 "text" (.set (s "Not rows"))]),
    (plan, [top "blocks" (.insert water (some 1))]),
    (plan, [top "blocks" (.insert water none)]),
    (plan, [top "blocks" (.insert water (some 0))]),
    (plan, [top "blocks" (.insert (row 2 []) none)]),
    (plan, [top "blocks" (.insert water (some 4))]),
    (plan, [top "title" (.insert water none)]),
    (plan, [top "notes" (.insert water none)]),
    (plan, [top "notes" (.insert water (some 1))]),
    (plan, [top "blocks" (.remove 1)]),
    (plan, [top "blocks" (.remove 7)]),
    (plan, [top "title" (.remove 1)]),
    (plan, [top "blocks" (.move 3 0)]),
    (plan, [top "blocks" (.move 1 2)]),
    (plan, [top "blocks" (.move 1 3)]),
    (plan, [top "blocks" (.move 5 0)]),
    (plan, [top "blocks" (.setRow (row 2 [("type", s "heading"), ("level", i 2), ("text", s "Spring")]))]),
    (plan, [top "blocks" (.setRow (row 8 []))]),
    (plan, [top "title" (.set (s "Garden plan"))]),
    (plan, [top "title" .unset]),
    (plan, [top "nothing" .unset]),
    (plan, [top "blocks" (.set (.rows []))]),
    (plan, [top "blocks" (.set (s "flat"))]),
    (plan, [top "notes" (.set (.rows [water]))]),
    (plan, [top "tags" (.add (.str "garden") none)]),
    (plan, [top "tags" (.add (.str "garden") (some 1))]),
    (plan, [top "tags" (.drop (.str "garden"))]),
    (plan, [top "title" (.add (.str "x") none)]),
    (plan, [top "blocks" (.add (.str "x") none)]),
    (plan, [top "blocks" (.drop (.str "x"))]),
    (plan, [.put todo]),
    (plan, [top "tags" (.add (.str "garden") none), top "tags" (.add (.str "seeds") (some 0)),
      top "tags" (.drop (.str "garden"))]),
    (plan, [top "blocks" (.insert water (some 0)), top "blocks" (.move 4 3), cell "blocks" 4 "text" (.set (s "Moved"))]),
    (plan, [top "blocks" (.remove 2), cell "blocks" 2 "text" (.set (s "Gone"))]),
    (plan, [top "blocks" (.remove 1), top "blocks" (.remove 2), top "blocks" (.remove 3)]),
    (todo, [top "tags" (.add (.str "work") (some 0))]),
    (todo, [top "tags" (.add (.str "work") (some 2))]),
    (todo, [top "tags" (.drop (.str "home"))]),
    (todo, [top "tags" (.drop (.str "away"))]),
    (todo, [top "status" (.set (s "doing"))]),
    (todo, [cell "tags" 0 "x" (.set (s "y"))]),
    (todo, [top "due" (.set (s "2026-10-12")), top "status" .unset]),
    (copies, [cell "blocks" 1 "text" (.set (s "z"))]),
    (copies, [cell "blocks" 1 "text" .unset]),
    (copies, [top "blocks" (.remove 1)]),
    (copies, [top "blocks" (.move 2 0)]),
    (copies, [top "blocks" (.move 1 3)]),
    (copies, [top "blocks" (.setRow (row 1 [("text", s "y")]))]),
    (copies, [top "blocks" (.insert (row 3 []) (some 2))]),
    (odd, [cell "blocks" 1 "text" (.set (s "x"))]),
    (odd, [top "n" (.drop (.int (-3)))]),
    (odd, [top "blocks" (.set (.rows [row 1 []])), top "blocks" (.insert (row 2 []) none)]),
    ([], [top "tags" (.add (.str "first") none)]),
    ([], [top "blocks" (.insert water none), cell "blocks" 4 "text" (.set (s "Only"))]),
    -- rows in rows: a field set, a row inserted, removed and moved, at every depth from 2 to 6
    (outline, [deep b1 "text" (.set (s "Raised beds"))]),
    (outline, [deep c11 "text" (.set (s "North"))]),
    (outline, [deep c111 "text" (.set (s "Broad beans"))]),
    (outline, [deep c1111 "text" (.set (s "Climbing"))]),
    (outline, [deep c111 "text" .unset]),
    (outline, [deep c11111 "text" (.set (s "Painted lady"))]),
    (outline, [deep b1 "children" (.insert (row 13 [("text", s "Herbs")]) (some 1))]),
    (outline, [deep c11 "children" (.insert (row 113 [("text", s "Leeks")]) none)]),
    (outline, [deep c111 "children" (.insert (row 1113 []) (some 0))]),
    (outline, [deep c1111 "children" (.insert (row 11113 [("text", s "Red")]) (some 2))]),
    (outline, [deep b1 "children" (.remove 12)]),
    (outline, [deep c11 "children" (.remove 112)]),
    (outline, [deep c111 "children" (.remove 1112)]),
    (outline, [deep c1111 "children" (.remove 11112)]),
    (outline, [deep b1 "children" (.move 12 0)]),
    (outline, [deep c11 "children" (.move 112 0)]),
    (outline, [deep c111 "children" (.move 1112 0)]),
    (outline, [deep c1111 "children" (.move 11112 0)]),
    -- a row and everything under it: removed, moved, set whole
    (outline, [top "blocks" (.remove 1)]),
    (outline, [top "blocks" (.move 1 1)]),
    (outline, [deep b1 "children" (.remove 11)]),
    (outline, [deep b1 "children" (.setRow (row 11 [("text", s "North")]))]),
    -- a list of records made in a row: set whole, or by its first row; a list of values in a row
    (outline, [deep [("blocks", 2)] "children" (.set (.rows [row 21 [("text", s "Rake")]]))]),
    (outline, [deep [("blocks", 1), ("children", 12)] "children" (.insert (row 121 [("text", s "Thyme")]) none)]),
    (outline, [deep [("blocks", 1), ("children", 12)] "children" (.insert (row 121 []) (some 1))]),
    (outline, [deep [("blocks", 1), ("children", 12)] "tags" (.add (.str "dry") none)]),
    (outline, [deep [("blocks", 1), ("children", 12)] "tags" (.drop (.str "sun"))]),
    (outline, [deep c11 "text" (.set (.rows []))]),
    -- in a row that isn't there, a field that holds no rows, or a row's id: none
    (outline, [deep [("blocks", 9)] "children" (.insert (row 91 []) none)]),
    (outline, [deep (b1 ++ [("children", 99)]) "text" (.set (s "x"))]),
    (outline, [deep (c11 ++ [("children", 999)]) "children" (.remove 1)]),
    (outline, [deep (c11111 ++ [("children", 1)]) "text" .unset]),
    (outline, [deep [("title", 1)] "text" (.set (s "x"))]),
    (outline, [deep c11 "id" (.set (i 5))]),
    (outline, [deep c11 "id" (.insert (row 1 []) none)]),
    (outline, [deep c11 "children" (.move 111 5)]),
    (outline, [deep c11 "children" (.insert (row 112 []) none)]),
    (outline, [deep c111 "children" (.move 9 0)]),
    (outline, [deep c1111 "children" (.setRow (row 9 []))]),
    -- ops one after the other, deep
    (outline, [deep c11 "children" (.insert (row 113 []) (some 0)), deep (c11 ++ [("children", 113)]) "text" (.set (s "Leeks")),
      deep c11 "children" (.move 113 2)]),
    (outline, [top "blocks" (.remove 1), deep c11 "text" (.set (s "Gone"))]),
    -- copies a list down: apps see the first
    (nestedCopies, [deep [("blocks", 2), ("children", 21)] "text" (.set (s "z"))]),
    (nestedCopies, [deep [("blocks", 2)] "children" (.remove 21)]),
    (nestedCopies, [deep [("blocks", 2)] "children" (.move 21 2)]),
    (nestedCopies, [deep [("blocks", 2)] "children" (.setRow (row 21 [("text", s "y")]))]),
    (nestedCopies, [deep [("blocks", 2)] "children" (.insert (row 23 []) (some 1))]),
    (nestedCopies, [top "blocks" (.remove 2)]),
    (odd, [deep [("blocks", 1)] "children" (.insert (row 11 []) none)]),
    ([], [top "blocks" (.insert (row 1 []) none), deep [("blocks", 1)] "children" (.insert (row 11 [("text", s "Only")]) none)]) ]

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
    (⟨todoT, 2, 15, 500, []⟩, odd),
    (⟨noteT, 1, 16, 600, [home]⟩, outline),
    (⟨noteT, 2, 17, 700, []⟩, nestedCopies) ]

def lbl (a : Atom) : Where := .label a
def at' (f : String) (t : Test) : Where := .test (.top f) t

/-- Tests in rows of rows: in any row (`*`) or one by its key, at every depth. -/
def deepWheres : List Where :=
  [ .test (.each "blocks" (.each "children" (.top "text"))) (.contains "bed"),
    .test (.each "blocks" (.each "children" (.each "children" (.each "children" (.each "children" (.top "text"))))))
      (.contains "SCARLET"),
    .test (.row "blocks" ⟨1, 0⟩ (.each "children" (.top "text"))) (.eq (s "South bed")),
    .test (.each "blocks" (.row "children" ⟨11, 0⟩ (.top "text"))) (.present true),
    .test (.each "blocks" (.top "children")) (.eq (.many [])),
    .test (.each "blocks" (.top "children")) (.present true),
    .test (.each "blocks" (.each "children" (.top "tags"))) (.has (.str "sun")),
    .test (.row "blocks" ⟨9, 0⟩ (.each "children" (.top "text"))) (.present true),
    .test (.row "blocks" ⟨9, 0⟩ (.row "children" ⟨1, 0⟩ (.top "text"))) (.present false),
    .test (.row "blocks" ⟨2, 0⟩ (.row "children" ⟨21, 1⟩ (.top "text"))) (.eq (s "d")),
    .test (.each "blocks" (.each "children" (.top "children"))) (.present false),
    .test (.each "blocks" (.each "children" (.top "id"))) (.present true),
    .and (lbl (.typeIn [noteT]))
      (.test (.each "blocks" (.each "children" (.each "children" (.top "text")))) (.oneOf [.str "Beans", .str "Peas"])),
    .not (.test (.each "blocks" (.each "children" (.top "text"))) (.gt (.str "c"))) ]

def wheres : List Where :=
  [ .yes, .no,
    lbl (.typeIn [todoT]),
    .and (lbl (.typeIn [todoT])) (at' "status" (.eq (s "open"))),
    .or (lbl (.tagHas work)) (at' "title" (.contains "PLAN")),
    .not (lbl (.typeIn [todoT])),
    .test (.each "blocks" (.top "text")) (.contains "spring"),
    .test (.each "blocks" (.top "text")) (.present false),
    .test (.row "blocks" ⟨2, 0⟩ (.top "text")) (.present true),
    .test (.row "blocks" ⟨1, 0⟩ (.top "level")) (.lt (.int 2)),
    .test (.row "blocks" ⟨1, 0⟩ (.top "level")) (.ge (.int 2)),
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
    ((List.range 17).map fun n => lbl (.createdIn 0 (n + 1000))).foldr .and .yes ] ++ deepWheres

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

mutual
partial def rowJson : Row → String
  | .mk n fs => obj (("id", int n) :: fs.map fun (g, x) => (g, item x))

partial def item : Item → String
  | .leaf v  => leaf v
  | .rows rs => arr (rs.map rowJson)
end

def doc (d : Doc) : String := obj (d.map fun (f, x) => (f, item x))

def key (k : Key) : String :=
  if k.copy = 0 then obj [("id", int k.id)] else obj [("id", int k.id), ("copy", nat k.copy)]

/-- A place's steps: each list's field and its row's key in turn, then the field. -/
def pathSteps : Path → List String
  | .top f     => [str f]
  | .row f k p => str f :: key k :: pathSteps p

def path (p : Path) : String := arr (pathSteps p)

/-- A list of records a change names: a field of the record by its name, one in a row by its path. -/
def listName : Path → String
  | .top f => str f
  | p      => path p

def change : Change Leaf → String
  | .set p (some v) => obj [("set", path p), ("value", leaf v)]
  | .set p none     => obj [("unset", path p)]
  | .order f ks     => obj [("rows", listName f), ("keys", opt (fun ks => arr (ks.map key)) ks)]

def idStep (n : Int) : String := obj [("id", int n)]

def locSteps (l : Loc) : List String := l.map fun
  | .field f => str f
  | .row n   => idStep n

def place : Option Nat → List (String × String)
  | some n => [("at", nat n)]
  | none => []

def op : RecordOp → String
  | .put d => obj [("op", str "set"), ("path", arr []), ("value", doc d)]
  | .edit l f e =>
    let path (more : List String) : String := arr (locSteps l ++ str f :: more)
    match e with
    | .set x       => obj [("op", str "set"), ("path", path []), ("value", item x)]
    | .unset       => obj [("op", str "unset"), ("path", path [])]
    | .setRow r    => obj [("op", str "set"), ("path", path [idStep r.id]), ("value", rowJson r)]
    | .insert r p  => obj ([("op", str "insert"), ("path", path []), ("value", rowJson r)] ++ place p)
    | .remove n    => obj [("op", str "remove"), ("path", path [idStep n])]
    | .move n to   => obj [("op", str "move"), ("path", path [idStep n]), ("to", nat to)]
    | .add v p     => obj ([("op", str "insert"), ("path", path []), ("value", val v)] ++ place p)
    | .drop v      => obj [("op", str "remove"), ("path", path []), ("value", val v)]

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

/-- What a test reads, as a path: each list's field, then its row's key or `"*"`, in turn, then the field. -/
def targetSteps : Target → List String
  | .top f      => [str f]
  | .row f k t  => str f :: key k :: targetSteps t
  | .each f t   => str f :: str "*" :: targetSteps t

def target (t : Target) : String := arr (targetSteps t)

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

/-- Two records, the changes between them, how deep each record's rows go, and how deep the changes reach. -/
def diffCase (d e : Doc) : String :=
  obj [("before", doc d), ("after", doc e), ("changes", arr ((d.diff e).map change)),
       ("depths", arr [nat d.depth, nat e.depth]), ("reach", nat ((d.diff e).foldl (fun m c => max m c.depth) 0))]

def runCase (d : Doc) (ops : List RecordOp) : String :=
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

def _root_.AvenDB.Ops.RecordOp.kind : RecordOp → String
  | .put _ => "put"
  | .edit _ _ (.set _) => "set"
  | .edit _ _ .unset => "unset"
  | .edit _ _ (.setRow _) => "setRow"
  | .edit _ _ (.insert ..) => "insert"
  | .edit _ _ (.remove _) => "remove"
  | .edit _ _ (.move ..) => "move"
  | .edit _ _ (.add ..) => "add"
  | .edit _ _ (.drop _) => "drop"

/-- How deep the place an op names lies: the fields on the way to it, its own among them. -/
def _root_.AvenDB.Ops.RecordOp.depth (op : RecordOp) : Nat := op.loc.countP fun
  | .field _ => true
  | .row _ => false

-- O2 on the cases: every run that makes sense changes only what its ops name
#guard runs.all fun (d, ops) => match d.runAll ops with
  | some e => d.within (ops.map RecordOp.loc) e
  | none => true
-- every op runs somewhere, and every op that names a row or a list somewhere makes no sense
#guard ["put", "set", "unset", "setRow", "insert", "remove", "move", "add", "drop"].all
  fun k => runs.any fun (d, ops) => ops.any (·.kind == k) && (d.runAll ops).isSome
#guard ["set", "unset", "setRow", "insert", "remove", "move", "add", "drop"].all
  fun k => runs.any fun (d, ops) => ops.any (·.kind == k) && (d.runAll ops).isNone
-- inserts, moves, removes and sets at every depth from 2 to 5 that make sense
#guard [2, 3, 4, 5].all fun n => ["set", "insert", "remove", "move"].all fun k =>
  runs.any fun (d, ops) => (d.runAll ops).isSome && ops.any fun op => op.kind == k && op.depth == n
-- an op in a row that isn't there makes no sense, at depths 2 to 7
#guard [2, 3, 4, 7].all fun n => runs.any fun (d, ops) => match ops with
  | [op@(.edit l _ _)] => op.depth == n && (d.atRow some l).isNone && (d.runAll ops).isNone
  | _ => false
-- diffs name copies of a row, a list down too, lists that become values and back, and every kind of change, deep
#guard (records.flatMap fun d => records.map (d, ·)).any fun (d, e) => (d.diff e).any fun
  | .set (.row _ k _) _ => k.copy > 0
  | _ => false
#guard (records.flatMap fun d => records.map (d, ·)).any fun (d, e) => (d.diff e).any fun
  | .set (.row _ _ (.row _ k _)) _ => k.copy > 0
  | _ => false
#guard ran.any fun (d, e) => (d.diff e).any fun
  | .set (.row _ _ (.row _ k _)) _ => k.copy > 0
  | _ => false
#guard (records.flatMap fun d => records.map (d, ·)).any fun (d, e) => (d.diff e).any fun
  | .order _ none => true
  | _ => false
#guard ran.any fun (d, e) => (d.diff e).any fun
  | .order _ (some _) => true
  | _ => false
#guard [1, 2, 3, 4].all fun n => ran.any fun (d, e) => (d.diff e).any fun
  | .order f _ => f.depth == n
  | _ => false
-- how deep records go, the outline five rows, and diffs that reach every depth from none to five
#guard [outline.depth, nestedCopies.depth, plan.depth, todo.depth] == [5, 2, 1, 0]
#guard [0, 1, 2, 3, 4, 5].all fun n => ((records.flatMap fun d => records.map (d, ·)) ++ ran).any fun (d, e) =>
  (d.diff e).foldl (fun m c => max m c.depth) 0 == n
-- queries pick some entries and not others, and some plan picks by no selector for its size; so do tests in rows of
-- rows
#guard wheres.all fun w => entries.all fun (a, d) => !w.holds a d.meaning || w.plan.matches a
#guard wheres.any fun w => w.cover != .all && w.plan == .all
#guard wheres.any fun w => let n := (entries.filter fun (a, d) => w.holds a d.meaning).length; 0 < n && n < entries.length
#guard (deepWheres.filter fun w => let n := (entries.filter fun (a, d) => w.holds a d.meaning).length;
  0 < n && n < entries.length).length ≥ 8

end AvenDB.OpsVectors
