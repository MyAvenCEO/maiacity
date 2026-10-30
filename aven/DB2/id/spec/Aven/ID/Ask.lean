import Aven.ID.Query

/-! # Questions and answers

Every query of `Aven.ID.Query` as data, with its answer: the form the examples are written in (`Aven.ID.Cast`) and
the test vectors are exported in (`Vectors.lean`), so a test elsewhere asks the same question and compares its answer
with the model's. -/

namespace Aven.ID

inductive Query where
  | kind (id : String)
  | owners (id : String)
  | owned (a : String)
  | governs (a : String)
  | chain (b : String)
  | actsFor (d : String)
  | actsThrough (a : String)
  | accounts (d : Option String)
  | sees (a : String)
  | mayActOn (d v : String)
  deriving DecidableEq, Repr

inductive Answer where
  | ids (l : List String)
  | id (x : Option String)
  | yes (b : Bool)
  deriving DecidableEq, Repr

def Kind.name : Kind → String
  | .person => "person"
  | .network => "network"
  | .device => "device"

/-- An owner as the cast writes it. -/
def Owner.name : Owner → String
  | .key id => s!"key:{id}"
  | .vault id => s!"vault:{id}"

def Kind.parse : String → Option Kind
  | "person" => some .person
  | "network" => some .network
  | "device" => some .device
  | _ => none

/-- `key:<id>` or `vault:<id>`; anything else is not an owner. -/
def Owner.parse (s : String) : Option Owner :=
  if s.startsWith "key:" then some (.key (s.drop 4).toString)
  else if s.startsWith "vault:" then some (.vault (s.drop 6).toString)
  else none

/-- What a cast may not write, beside a tree that is not well formed: an unknown kind, an owner without its prefix. -/
def formatExamples : List (String × Option Kind × Option Owner) :=
  [("ghost", none, none), ("k", none, none), ("person", some .person, none), ("key:k", none, some (.key "k")),
   ("vault:a", none, some (.vault "a"))]

-- evaluated as `lake build` compiles this file: the kernel can't unfold `String.startsWith`
#guard formatExamples.all fun (s, k, o) => Kind.parse s == k && Owner.parse s == o

namespace Tree

def ask (t : Tree) : Query → Answer
  | .kind id => .id ((t.kind? id).map Kind.name)
  | .owners id => .ids (((t.get? id).map fun v => v.owners.map Owner.name).getD [])
  | .owned a => .ids (t.owned a)
  | .governs a => .ids (t.governs a)
  | .chain b => .ids (t.chain b)
  | .actsFor d => .id (t.actsFor d)
  | .actsThrough a => .ids (t.actsThrough a)
  | .accounts d => .ids (t.accounts d)
  | .sees a => .ids (t.sees a)
  | .mayActOn d v => .yes (t.mayActOn d v)

/-- Every query on every vault, and on one the tree doesn't have; every pair for `mayActOn`. -/
def everyQuery (t : Tree) : List Query :=
  let ids := t.ids ++ ["nobody"]
  .accounts none :: ids.flatMap fun x =>
    [.kind x, .owners x, .owned x, .governs x, .chain x, .actsFor x, .actsThrough x, .accounts (some x), .sees x] ++
      ids.map (.mayActOn x)

end Tree
end Aven.ID
