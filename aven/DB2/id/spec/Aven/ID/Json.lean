import Aven.ID.OS
import Aven.ID.Sign
import Lean.Data.Json

/-! # Trees, questions and answers as JSON

The one JSON form of `aven-id-model` (`Main.lean`) and of the vectors (`Vectors.lean`):

```
tree:    {"keys":["k"],"vaults":[{"id":"a","name":"A's vault","kind":"person","owners":["key:k"]}]}
query:   ["governs","a"]   ["accounts",null]   ["mayActOn","d","a"]
answer:  ["a","b"]   "a"   null   true
result:  {"wf":true,"answers":[…]}   {"wf":false,"invalid":{"rule":"unowned","vault":"a"},"answers":[]}
         {"format":"…"} when the input isn't a tree at all
```
-/

open Lean

namespace Aven.ID

def Vault.json (v : Vault) : Json :=
  Json.mkObj [("id", v.id), ("name", v.name), ("kind", v.kind.name), ("owners", toJson (v.owners.map Owner.name)),
    ("threshold", toJson v.threshold)]

def Tree.json (t : Tree) : Json :=
  Json.mkObj [("keys", toJson t.keys), ("vaults", Json.arr (t.vaults.map Vault.json).toArray)]

def Query.json : Query → Json
  | .kind x => toJson ["kind", x]
  | .name x => toJson ["name", x]
  | .owners x => toJson ["owners", x]
  | .owned x => toJson ["owned", x]
  | .governs x => toJson ["governs", x]
  | .chain x => toJson ["chain", x]
  | .actsFor x => toJson ["actsFor", x]
  | .actsThrough x => toJson ["actsThrough", x]
  | .accounts x => Json.arr #["accounts", toJson x]
  | .sees x => toJson ["sees", x]
  | .mayActOn d v => toJson ["mayActOn", d, v]

def Answer.json : Answer → Json
  | .ids l => toJson l
  | .id x => toJson x
  | .yes b => toJson b

def Invalid.json : Invalid → Json
  | .duplicate id => Json.mkObj [("rule", "duplicate"), ("vault", id)]
  | .unowned id => Json.mkObj [("rule", "unowned"), ("vault", id)]
  | .unknown v o => Json.mkObj [("rule", "unknown"), ("vault", v), ("owner", o.name)]
  | .deviceOwners id => Json.mkObj [("rule", "deviceOwners"), ("vault", id)]
  | .deviceOwns d v => Json.mkObj [("rule", "deviceOwns"), ("device", d), ("vault", v)]
  | .deviceKeyless id => Json.mkObj [("rule", "deviceKeyless"), ("vault", id)]
  | .deviceKeyOwns d v => Json.mkObj [("rule", "deviceKeyOwns"), ("device", d), ("vault", v)]
  | .name id => Json.mkObj [("rule", "name"), ("vault", id)]
  | .coopOwner c o => Json.mkObj [("rule", "coopOwner"), ("vault", c), ("owner", o.name)]
  | .coopDevice c d => Json.mkObj [("rule", "coopDevice"), ("vault", c), ("device", d)]
  | .noQuorum id => Json.mkObj [("rule", "noQuorum"), ("vault", id)]
  | .cycle => Json.mkObj [("rule", "cycle")]

/-- What the model answers for a tree and its queries. A tree that is not well formed gets no answers. -/
def Tree.result (t : Tree) (qs : List Query) : Json :=
  match t.check with
  | none => Json.mkObj [("wf", true), ("answers", Json.arr (qs.map fun q => (t.ask q).json).toArray)]
  | some why => Json.mkObj [("wf", false), ("invalid", why.json), ("answers", Json.arr #[])]

def parseVault (j : Json) : Except String Vault := do
  let id ← j.getObjValAs? String "id"
  let name ← j.getObjValAs? String "name"
  let k ← j.getObjValAs? String "kind"
  let kind ← (Kind.parse k).elim (.error s!"{id}'s kind {k} is unknown") pure
  let owners ← (← j.getObjValAs? (List String) "owners").mapM fun o =>
    (Owner.parse o).elim (.error s!"{id}'s owner {o} is neither key: nor vault:") pure
  -- a tree written before thresholds (A28) has none: each of its vaults took one owner, its threshold 1
  let threshold ← match j.getObjValD "threshold" with
    | .null => pure 1
    | t => fromJson? t
  pure ⟨id, name, kind, owners, threshold⟩

def parseTree (j : Json) : Except String Tree := do
  let keys ← j.getObjValAs? (List String) "keys"
  let vaults ← (← j.getObjValAs? (Array Json) "vaults").toList.mapM parseVault
  pure ⟨keys, vaults⟩

def parseQuery (q : Json) : Except String Query := do
  let args ← q.getArr?
  let arg (i : Nat) : Except String String := (args[i]?.getD Json.null).getStr?
  match ← arg 0 with
  | "kind" => pure (.kind (← arg 1))
  | "name" => pure (.name (← arg 1))
  | "owners" => pure (.owners (← arg 1))
  | "owned" => pure (.owned (← arg 1))
  | "governs" => pure (.governs (← arg 1))
  | "chain" => pure (.chain (← arg 1))
  | "actsFor" => pure (.actsFor (← arg 1))
  | "actsThrough" => pure (.actsThrough (← arg 1))
  | "accounts" => pure (.accounts (arg 1).toOption)
  | "sees" => pure (.sees (← arg 1))
  | "mayActOn" => pure (.mayActOn (← arg 1) (← arg 2))
  | q => throw s!"unknown query {q}"

/-- A case as the model reads it: a tree and its queries in one object. Malformed input is a `format` result. -/
def answerCase (j : Json) : Except String Json := do
  match parseTree j with
  | .error why => pure (Json.mkObj [("format", why)])
  | .ok t =>
    let qs ← ((j.getObjValD "queries").getArr?.toOption.getD #[]).toList.mapM parseQuery
    pure (t.result qs)

end Aven.ID

namespace Aven.ID

def SignError.json : SignError → Json
  | .notDevice id => Json.mkObj [("error", "notDevice"), ("id", id)]
  | .noKey id => Json.mkObj [("error", "noKey"), ("id", id)]
  | .wrongKey id => Json.mkObj [("error", "wrongKey"), ("id", id)]
  | .wrongVault d v => Json.mkObj [("error", "wrongVault"), ("device", d), ("vault", v)]
  | .badSignature => Json.mkObj [("error", "badSignature")]

def Change.json : Change → Json
  | .device d => toJson ["device", d]
  | .vault v => toJson ["vault", v]
  | .body b => toJson ["body", b]
  | .resign k => toJson ["resign", k]

/-- A statement's vector: the input as the example writes it, the model's answers as expected. -/
def SignExample.vector (e : SignExample) : Json × Json :=
  let input := Json.mkObj [("device", e.device), ("key", e.key), ("body", e.body),
    ("changes", Json.arr (e.changes.map Change.json).toArray), ("target", toJson e.target)]
  let expected := match cast.sign e.device e.key e.body with
    | .error why => Json.mkObj [("signs", why.json), ("holds", Json.null)]
    | .ok s => Json.mkObj [("signs", Json.mkObj [("vault", s.vault)]), ("holds", match e.holdsOn s with
      | .ok b => toJson b
      | .error why => why.json)]
  (input, expected)

end Aven.ID
