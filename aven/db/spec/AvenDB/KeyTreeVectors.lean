import AvenDB.KeyTree
import AvenDB.Json

/-!
# Key tree vectors

The cases that hold the Rust key tree (`crates/avendb/src/tree.rs`) to the model of V6 (`KeyTree.lean`): runs of adds,
removals and commits, each commit drafted on the tree as it stood after some of the changes before it (the changes so
far for an honest commit, fewer for one made apart). For each run the model says which changes count, the epochs and
their keys, which epochs keep the history, and which key of which epoch each device opens. The Rust tree, with real
X-Wing keys, must count the same changes and open exactly the same keys (`crates/avendb/tests/all/key_tree_vectors.rs`).

The Rust tree grows to hold its highest leaf; the model's has its height from the start. So each run adds a device
at a leaf of the top half first, and the two trees are as high before any commit.
-/

namespace AvenDB.KeyTreeVectors

open AvenDB.Json AvenDB.Trees

/-- One step of a run: device `d` joins at leaf `leaf`, with the history or without; device `d` leaves; or member `u`
    commits what it drafts on the tree as it stood after the first `on` changes. -/
inductive Step where
  | add (d : SignerId) (leaf : Nat) (history : Bool)
  | remove (d : SignerId)
  | draft (u : SignerId) (on : Nat)
  deriving Repr

/-- Leaf `i`'s place in a tree `h` levels high: the turns from the root, its highest bit first. -/
def placeAt (h i : Nat) : Place := (List.range h).map fun j => i / 2 ^ (h - 1 - j) % 2 == 1

/-- Whether device `d` opens key `k` of the tree. -/
def reached (st : Tree) (d : SignerId) : List TKey :=
  let rec go : Nat → List TKey → List TKey
    | 0, known => known
    | n + 1, known =>
      let more := ((st.seals.filter fun s => known.contains s.2 && !known.contains s.1).map (·.1)).eraseDups
      if more.isEmpty then known else go n (known ++ more)
  go (st.seals.length + 1) [.leaf d]

/-- What `reached` finds is what `opens` finds: a device opens key `k` of the tree. -/
def holds (st : Tree) (d : SignerId) (k : TKey) : Bool := (reached st d).contains k

/-- Whether a real device can make a change the model takes. The model seals keys as symbols, so it lets a commit
    wrap the keys of the epoch before, and an add box the keys of the epoch now, whoever holds them. A device can only
    seal what it opens: a commit's author must open every key it wraps, and an add with the history needs a member
    that opens every key it boxes. Where none can, the Rust tree drafts nothing, and the run has no change there
    (a removal of device 0, who is never a member, which changes nothing). -/
def makeable (st : Tree) : Change → Bool
  | .add _ _ true => (st.keys st.epoch).isEmpty || st.members.any fun m => (st.keys st.epoch).all fun c => holds st m.dev (.epoch st.epoch c)
  | .commit u _ _ => !st.chains st.epoch || (st.keys (st.epoch - 1)).all fun c => holds st u (.epoch (st.epoch - 1) c)
  | _ => true

/-- The changes of a run, in the replay order, with the tree after each number of them (`trees[i]`: after `i`). -/
def played (h : Nat) (steps : List Step) : List Change × Array Tree :=
  steps.foldl (fun (cs, trees) s =>
    let (c, on) := match s with
      | .add d i hist => (Change.add d (placeAt h i) hist, cs.length)
      | .remove d => (.remove d, cs.length)
      | .draft u on => ((trees.getD on (Tree.empty h)).draft u, on)
    let c := if makeable (trees.getD on (Tree.empty h)) c then c else .remove 0
    (cs ++ [c], trees.push ((trees.getD cs.length (Tree.empty h)).step c))) ([], #[Tree.empty h])

def changes (h : Nat) (steps : List Step) : List Change := (played h steps).1

/-- Whether change `i` counts: it adds or removes a member, or adds a key to the epoch. -/
def counts (trees : Array Tree) (i : Nat) : Bool :=
  let before := trees.getD i (Tree.empty 0)
  let after := trees.getD (i + 1) (Tree.empty 0)
  after.members.length != before.members.length || after.epoch != before.epoch ||
    (after.keys after.epoch).length != (before.keys before.epoch).length

/-- Every device a run names. -/
def devices (steps : List Step) : List SignerId :=
  (steps.filterMap fun | .add d _ _ => some d | _ => none).eraseDups

def stepJson : Step → String
  | .add d i hist => obj [("add", nat d), ("leaf", nat i), ("history", bool hist)]
  | .remove d => obj [("remove", nat d)]
  | .draft u on => obj [("draft", nat u), ("on", nat on)]

/-- A run and all the model says of it. -/
def caseJson (name : String) (h : Nat) (steps : List Step) : String :=
  let (cs, trees) := played h steps
  let st := trees.getD cs.length (Tree.empty h)
  let epochs := List.range (st.epoch + 1)
  let reach := reached st
  let opened := (devices steps).flatMap fun d =>
    let r := reach d
    epochs.flatMap fun g => (st.keys g).map fun c => arr [nat d, nat g, nat c, bool (r.contains (.epoch g c))]
  obj [("name", str name), ("height", nat h), ("steps", arr (steps.map stepJson)),
       ("counts", arr ((List.range cs.length).map fun i => bool (counts trees i))),
       ("epoch", nat st.epoch),
       ("keys", arr (epochs.map fun g => arr ((st.keys g).map nat))),
       ("chains", arr (epochs.map fun g => bool (st.chains g))),
       ("members", arr (st.members.map fun m => nat m.dev)),
       ("opens", arr opened)]

/-! ## The runs -/

/-- The model's own examples (`KeyTree.lean`), as runs. -/
def trio : List Step := [.add 1 2 true, .add 2 1 true, .add 3 0 true]
def first : List Step := trio ++ [.draft 1 3]
def second : List Step := first ++ [.remove 3, .draft 2 5]
/-- A commit drafted before Cat left, landing after: it seals to Cat's leaf, and doesn't count. -/
def stale : List Step := first ++ [.remove 3, .draft 2 4]
def apart : List Step := first ++ [.draft 1 4, .draft 2 4]
def freshly : List Step := first ++ [.add 5 3 false, .draft 1 5]
def withPast : List Step := first ++ [.add 4 3 true, .draft 4 5]
def eight : List Step := (List.range 8).map fun i => .add (i + 10) (7 - i) true
def filled : List Step := eight ++ (List.range 8).map fun i => .draft (i + 10) (8 + i)
def rekeyed : List Step := filled ++ [.remove 17, .draft 10 17]

/-- A generator of numbers from a seed (PCG's multiplier, mod 2^64). -/
def next (s : Nat) : Nat := (s * 6364136223846793005 + 1442695040888963407) % 2 ^ 64
def pick (s n : Nat) : Nat := if n = 0 then 0 else s / 65536 % n

/-- A random run `n` steps long on a tree `h` high: first a device at a leaf of the top half, then adds at free leaves
    (with the history or without), removals, honest commits and commits made apart from other commits since. A device
    leaves at most once and never comes back. -/
def random (seed h n : Nat) : List Step := Id.run do
  let leaves := 2 ^ h
  let mut s := next seed
  let mut steps : List Step := [.add 100 (leaves / 2 + pick s (leaves / 2)) true]
  let mut members : List (SignerId × Nat) := [(100, (leaves / 2 + pick s (leaves / 2)))]
  let mut fresh := 101
  -- the first step since which every step was a commit: a commit may be drafted on any tree from there on
  let mut since := 1
  for _ in [0:n] do
    s := next s
    let kind := pick s 10
    s := next s
    let free := (List.range leaves).filter fun i => !members.any (·.2 == i)
    if kind < 3 && !free.isEmpty then
      let leaf := free.getD (pick s free.length) 0
      s := next s
      steps := steps ++ [.add fresh leaf (pick s 4 != 0)]
      members := members ++ [(fresh, leaf)]
      fresh := fresh + 1
      since := steps.length
    else if kind < 4 && members.length > 1 then
      let (d, _) := members.getD (pick s members.length) (0, 0)
      steps := steps ++ [.remove d]
      members := members.filter (·.1 != d)
      since := steps.length
    else
      let (u, _) := members.getD (pick s members.length) (0, 0)
      s := next s
      let on := if kind = 9 then since + pick s (steps.length - since + 1) else steps.length
      steps := steps ++ [.draft u on]
  return steps

def runs : List (String × Nat × List Step) :=
  [("first", 2, first), ("second", 2, second), ("stale", 2, stale), ("apart", 2, apart),
   ("freshly", 2, freshly), ("with the past", 2, withPast), ("filled", 3, filled), ("rekeyed", 3, rekeyed)] ++
  (List.range 96).map fun i => (s!"random {i}", 2 + i % 4, random (i + 1) (2 + i % 4) (12 + i % 24))

def render : String := lines (runs.map fun (name, h, steps) => caseJson name h steps) ++ "\n"

-- the examples' answers, read off the vectors' runs
#guard (run 2 (changes 2 second)).keys 1 == [5]
#guard counts (played 2 stale).2 5 == false
#guard (run 2 (changes 2 apart)).keys 0 == [3, 4, 5]

end AvenDB.KeyTreeVectors
