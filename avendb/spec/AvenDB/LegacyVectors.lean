import AvenDB.LegacyAnchor
import AvenDB.Vectors

/-!
# Test vectors for the legacy anchor

`lake exe vectors` writes them to `vectors/legacy.json`, which the Rust core replays (`crates/avendb/tests/legacy.rs`).
Each case names the legacy (SLH-DSA) signers, the edits a device holds at the fork, each with its signers, and the
signatures among them that don't check; then edits after the fork. It says which edits the device takes at the fork,
which it freezes, sorted as the engine sorts them (the anchor's tree hashes them in that order), and which it takes
after the fork of those it took and the later ones, each legacy part checked by its path to the anchor alone.
-/

namespace AvenDB.LegacyVectors
open AvenDB.Vectors AvenDB.Batches AvenDB.Legacy

structure Case where
  name   : String
  legacy : List SignerId
  /-- Each edit at the fork: its id, its author and its cosigners. -/
  before : List (EditId × SignerId × List SignerId)
  /-- The signatures that don't check: signer, edit. -/
  bad    : List (SignerId × EditId) := []
  later  : List (EditId × SignerId × List SignerId) := []

def Case.edits (xs : List (EditId × SignerId × List SignerId)) : List Edit :=
  xs.map fun (id, a, cs) => Legacy.mk id a cs

def Case.signed (c : Case) (s : SignerId) (e : EditId) : Bool := !c.bad.contains (s, e)
def Case.isLegacy (c : Case) (s : SignerId) : Bool := c.legacy.contains s
def Case.took (c : Case) : List Edit := Batches.takes c.signed (Case.edits c.before)
def Case.frozen (c : Case) : List EditId := (freeze c.isLegacy c.took).mergeSort
def Case.after (c : Case) : List EditId :=
  (Batches.takes (check c.isLegacy (root c.frozen) (paths c.frozen) c.signed) (c.took ++ Case.edits c.later)).map (·.id)

def cases : List Case := [
  { name := "a key move: the old passkey's edits, one cosigned by its next key, stand; it signs nothing new",
    legacy := [1], before := [(100, 1, []), (101, 1, [11]), (102, 11, [])],
    later := [(103, 1, []), (104, 11, []), (105, 1, [11])] },
  { name := "an edit refused at the fork stays refused, frozen or not",
    legacy := [1, 2], before := [(100, 1, []), (101, 2, []), (102, 2, [])], bad := [(2, 101)],
    later := [(101, 2, [])] },
  { name := "a device that never moved: its old edits stand, later ones fall, and others write as before",
    legacy := [3], before := [(110, 3, []), (111, 12, []), (112, 3, []), (113, 12, [3])],
    later := [(114, 3, []), (115, 12, []), (116, 12, [3])] },
  { name := "no legacy signer: nothing is frozen and everything is as before",
    legacy := [], before := [(120, 11, []), (121, 12, [11])], bad := [(12, 121)], later := [(122, 11, [])] },
  { name := "eleven old edits: an anchor of many levels, each edit with its own path",
    legacy := [4],
    before := (List.range 11).map fun i => (300 - 7 * i, 4, []),
    later := [(299, 4, []), (290, 13, [])] }]

def caseJson (c : Case) : String :=
  let edit := fun ((id, a, cs) : EditId × SignerId × List SignerId) =>
    obj [("id", nat id), ("author", nat a), ("cosigners", ids cs)]
  obj [("name", str c.name), ("legacy", ids c.legacy), ("before", arr (c.before.map edit)),
    ("bad", arr (c.bad.map fun (s, e) => arr [nat s, nat e])), ("later", arr (c.later.map edit)),
    ("took", ids (c.took.map (·.id))), ("frozen", ids c.frozen), ("after", ids c.after)]

def render : String := "[\n" ++ ",\n".intercalate (cases.map caseJson) ++ "\n]\n"

end AvenDB.LegacyVectors
