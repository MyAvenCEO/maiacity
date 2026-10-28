import AvenDB.KeyDerivation
import AvenDB.CapGroupsOnce
import AvenDB.Json

/-!
# Step cost vectors

`vectors/step_costs.json`, what the models of `KeyDerivation.lean` and `CapGroupsOnce.lean` answer, for the Rust engine
to replay (`crates/avendb/tests/all/step_costs.rs`):

- `keys`: `writers` devices of one vault that each wrote `entries` entries before they synced, so that each made its own
  key of the vault's audience and wrote under it, and a device that took them all, holding `held` keys of the audience.
  Where it holds one key more than the writers made, the vault's Mac wrote an entry under its own first. It derives each
  entry's key now, from the first audience key, and the key its writes are under: `least` keys where the first audience
  key is the first writer's, `most` where it is the Mac's. The rule before derived `before`.
- `caps`: cap groups of `writes` writes in all, shown `shows` times as a catch-up shows them, then a write to a group and
  `shows` shows more: the writes it judges, `judged`, and those the rule before judged, `old`.
-/

namespace AvenDB.StepCostVectors

open AvenDB.Json

/-- The entries of `w` writers, `n` each, writer `i`'s under audience key `i`, and where it holds `a` keys of the audience,
    more than the writers made, one entry of the vault's own Mac under key `w`; the first audience key being `first`. -/
def written (w n a first : Nat) : List KeyDerivation.Ent :=
  let ent (k : Nat) : KeyDerivation.Ent := { stays := [0], now := (0, first), writes := [(0, k)], links := [] }
  (List.range w).flatMap (fun i => List.replicate n (ent i)) ++ (if w < a then [ent w] else [])

def derivedOf (held : List Nat) (es : List KeyDerivation.Ent) : Nat :=
  (es.map fun e => (KeyDerivation.derives held e).length).foldl (· + ·) 0

def beforeOf (held : List Nat) (es : List KeyDerivation.Ent) : Nat :=
  (es.map fun e => (KeyDerivation.before held e).length).foldl (· + ·) 0

def keyCase (name : String) (w n a : Nat) : String :=
  let held := List.range a
  -- the first audience key is a writer's, or, where it holds one more, the Mac's
  let mostFirst := if w < a then w else 0
  obj [("name", str name), ("writers", nat w), ("entries", nat n), ("held", nat a),
       ("least", nat (derivedOf held (written w n a 0))), ("most", nat (derivedOf held (written w n a mostFirst))),
       ("before", nat (beforeOf held (written w n a 0)))]

def keyCases : List String :=
  [ keyCase "one writer" 1 12 1,
    keyCase "four writers" 4 6 4,
    keyCase "four writers and a key of the vault's own" 4 6 5 ]

/-- `k` shows at one print, then `k` at another after a write to a group. -/
def capCase (name : String) (n k : Nat) : String :=
  let (p, q) := (7, 8)
  let judged := CapGroupsOnce.run n none (List.replicate k p) + CapGroupsOnce.run (n + 1) (some p) (List.replicate k q)
  let old := CapGroupsOnce.old n (List.replicate k p) + CapGroupsOnce.old (n + 1) (List.replicate k q)
  obj [("name", str name), ("writes", nat n), ("shows", nat k), ("judged", nat judged), ("old", nat old)]

def capCases : List String :=
  [ capCase "two groups, a show" 2 1,
    capCase "two groups of 6 writes, 20 shows" 6 20 ]

def render : String :=
  obj [("keys", arr keyCases), ("caps", arr capCases)] ++ "\n"

#guard (written 4 6 4 0).length == 24
#guard (written 4 6 5 0).length == 25

end AvenDB.StepCostVectors
