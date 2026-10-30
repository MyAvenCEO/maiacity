import Aven.DB.Store

/-!
# The store's examples

Traces with the result of every call written out by hand: what the conformance suite checked case by case before
(`db/store/src/conformance.rs`), now written once, here. `lake build` replays each through the model with BLAKE3 as
its hash, and `lake exe vectors` exports them for every backend to replay. A blob's name is written `(nm b)`: the hash of
its bytes, as `Blake3.hash` computes it, whose own answers `Aven.DB.Blake3` checks.
-/

namespace Aven.DB.Store

open Blake3 (hash)

/-- Bytes that look random, the same on every run: the suite's `noise`. -/
def noise (len seed : Nat) : Bytes := Id.run do
  let mut x : UInt64 := (seed.toUInt64 * 0x9e3779b97f4a7c15) ||| 1
  let mut out : Array UInt8 := #[]
  for _ in [0:len] do
    x := x ^^^ (x <<< 13)
    x := x ^^^ (x >>> 7)
    x := x ^^^ (x <<< 17)
    out := out.push x.toUInt8
  return out.toList

def bytes (s : String) : Bytes := s.toUTF8.toList

/-- A blob's name. -/
def nm (b : Bytes) : Hash := hash b

def runs (ops : List Op) : List Res := results hash {} ops

def a := bytes "a sealed blob"
def big := noise 1000 1
def r := (List.range 100).map Nat.toUInt8
def h1 := noise 100 10
def h2 := noise 100 11
def h3 := noise 100 12
def x5 := noise 5000 3
def y7 := noise 7000 4

/-- A trace, the results it must give, and its name. -/
def storeExamples : List (String × List Op × List Res) := [
  ("a blob round trip", [.put a, .get (nm a), .has (nm a)],
    [.hash (nm a), .bytes (some a), .yes true]),
  ("the same bytes twice are one blob", [.put big, .put big, .list],
    [.hash (nm big), .hash (nm big), .hashes [(nm big)]]),
  ("the empty blob", [.put [], .get (nm []), .getRange (nm []) 0 0, .has (nm [])],
    [.hash (nm []), .bytes (some []), .bytes (some []), .yes true]),
  ("a blob never put", [.get (nm (bytes "never put")), .getRange (nm (bytes "never put")) 0 1, .has (nm (bytes "never put")),
      .delete (nm (bytes "never put")), .list],
    [.bytes none, .bytes none, .yes false, .done, .hashes []]),
  ("ranges of a blob", [.put r, .getRange (nm r) 0 10, .getRange (nm r) 90 100, .getRange (nm r) 0 100, .getRange (nm r) 7 7,
      .getRange (nm r) 100 100, .getRange (nm r) 0 101, .getRange (nm r) 101 102, .getRange (nm r) 5 3],
    [.hash (nm r), .bytes (some (r.take 10)), .bytes (some (r.drop 90)), .bytes (some r), .bytes (some []),
      .bytes (some []), .range 0 101 100, .range 101 102 100, .range 5 3 100]),
  ("blobs over a chunk", [.put x5, .put y7, .get (nm x5), .getRange (nm x5) 1000 1100, .getRange (nm y7) 4090 4100],
    [.hash (nm x5), .hash (nm y7), .bytes (some x5), .bytes (some ((x5.drop 1000).take 100)),
      .bytes (some ((y7.drop 4090).take 10))]),
  ("list and delete", [.put h1, .put h2, .put h3, .delete (nm h2), .get (nm h2), .has (nm h2), .delete (nm h2), .list],
    [.hash (nm h1), .hash (nm h2), .hash (nm h3), .done, .bytes none, .yes false, .done, .hashes (sort [(nm h1), (nm h3)])]),
  ("a blob never changes, whatever is put after it", [.put x5, .put y7, .put x5, .get (nm x5), .list],
    [.hash (nm x5), .hash (nm y7), .hash (nm x5), .bytes (some x5), .hashes (sort [(nm x5), (nm y7)])]),
  ("a ref round trip", [.getRef "doc.3f9a.head", .setRef "doc.3f9a.head" none (nm (bytes "a")),
      .getRef "doc.3f9a.head", .setRef "doc.3f9a.head" (some (nm (bytes "a"))) (nm (bytes "b")), .getRef "doc.3f9a.head",
      .setRef "peer.key" none (nm (bytes "a")), .listRefs, .deleteRef "doc.3f9a.head" (nm (bytes "b")),
      .getRef "doc.3f9a.head", .listRefs],
    [.ref none, .done, .ref (some (nm (bytes "a"))), .done, .ref (some (nm (bytes "b"))), .done,
      .names ["doc.3f9a.head", "peer.key"], .done, .ref none, .names ["peer.key"]]),
  ("a stale writer is refused", [.setRef "head" none (nm (bytes "a")), .setRef "head" none (nm (bytes "b")),
      .setRef "head" (some (nm (bytes "b"))) (nm (bytes "c")), .deleteRef "head" (nm (bytes "b")), .getRef "head",
      .setRef "missing" (some (nm (bytes "a"))) (nm (bytes "b")), .deleteRef "missing" (nm (bytes "a")), .getRef "missing"],
    [.done, .stale (some (nm (bytes "a"))), .stale (some (nm (bytes "a"))), .stale (some (nm (bytes "a"))),
      .ref (some (nm (bytes "a"))), .stale none, .stale none, .ref none]),
  ("racing writers: the first wins", [.setRef "head" none (nm (bytes "start")),
      .setRef "head" (some (nm (bytes "start"))) (nm [1]), .setRef "head" (some (nm (bytes "start"))) (nm [2]),
      .setRef "head" (some (nm (bytes "start"))) (nm [3]), .getRef "head"],
    [.done, .done, .stale (some (nm [1])), .stale (some (nm [1])), .ref (some (nm [1]))]),
  ("refs and blobs apart", [.put (bytes "x"), .setRef (nm (bytes "x")) none (nm (bytes "x")), .list, .listRefs,
      .delete (nm (bytes "x")), .getRef (nm (bytes "x")), .get (nm (bytes "x"))],
    [.hash (nm (bytes "x")), .done, .hashes [(nm (bytes "x"))], .names [(nm (bytes "x"))], .done, .ref (some (nm (bytes "x"))),
      .bytes none]),
  ("a ref may name a blob that isn't there", [.setRef "head" none (nm (bytes "absent")), .getRef "head", .list],
    [.done, .ref (some (nm (bytes "absent"))), .hashes []]),
  ("names a ref may have", [.getRef "head", .getRef "doc.3f9a.head", .getRef "peer_key-1",
      .getRef (String.ofList (List.replicate 128 'a')), .setRef "A.b_c-9" none (nm (bytes "a")), .listRefs],
    [.ref none, .ref none, .ref none, .ref none, .done, .names ["A.b_c-9"]]),
  ("names a ref may not have", [.getRef "", .getRef ".tmp", .getRef "a/b", .getRef "..", .getRef "a b",
      .getRef "ä", .getRef (String.ofList (List.replicate 129 'a')), .setRef ".x" none (nm (bytes "a")),
      .deleteRef "a/b" (nm (bytes "a")), .listRefs],
    [.invalidName "", .invalidName ".tmp", .invalidName "a/b", .invalidName "..", .invalidName "a b",
      .invalidName "ä", .invalidName (String.ofList (List.replicate 129 'a')), .invalidName ".x",
      .invalidName "a/b", .names []])]

#guard storeExamples.all fun (_, ops, want) => runs ops == want

/-- Spellings of a hash, and whether the store reads each as one: only 64 lowercase hex digits. -/
def hashExamples : List (String × Bool) :=
  let h := (nm (bytes "abc"))
  [(h, true), ((h.take 63).toString, false), (h.toUpper, false), (h ++ "0", false), ("", false),
   ((h.take 63).toString ++ "g", false), ((nm []), true)]

#guard hashExamples.all fun (s, ok) => validHash s == ok

end Aven.DB.Store
