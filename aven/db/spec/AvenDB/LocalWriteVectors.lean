import AvenDB.LocalWrite
import AvenDB.Writes

/-!
# Local write vectors

`vectors/local_writes.json`, what the models of `LocalWrite.lean` and `Writes.lean` answer, for the code that follows
them to replay: `overlays`, what a page shows of a device's answer with writes pending laid over it, and after a refusal
of each pending write (`aven/db/page/pending-writes.test.js`); `turns`, the order a Lab grants waiting turns in
(avendb-net's `lab_schedule.rs` tests).
-/

namespace AvenDB.LocalWriteVectors

open AvenDB.LocalWrite
open AvenDB.Turns

def arr (xs : List String) : String := "[" ++ ", ".intercalate xs ++ "]"
def obj (kvs : List (String × String)) : String :=
  "{" ++ ", ".intercalate (kvs.map fun (k, v) => "\"" ++ k ++ "\": " ++ v) ++ "}"
def nat (n : Nat) : String := toString n
def rows (rs : List Row) : String := arr (rs.map fun (i, v) => arr [nat i, nat v])
def op : PendingOp → String
  | .insert i v => obj [("insert", arr [nat i, nat v])]
  | .set i v => obj [("set", arr [nat i, nat v])]
def pending (ps : List Pending) : String := arr (ps.map fun p => obj [("seq", nat p.seq), ("op", op p.op)])

def overlay (c : List Row) (ps : List Pending) : String :=
  obj [("confirmed", rows c), ("pending", pending ps), ("shown", rows (shown c ps)),
    ("refused", arr (ps.map fun p => obj [("seq", nat p.seq), ("shown", rows (shown c (refuse p.seq ps)))])),
    ("held", arr (ps.map fun p => if applyOp c p.op == c then "true" else "false"))]

def overlays : List String :=
  [ overlay [] [⟨1, .insert 10 1⟩],
    overlay [(1, 5), (2, 6)] [⟨1, .insert 3 7⟩],
    overlay [(1, 5), (2, 6)] [⟨1, .insert 2 9⟩],
    overlay [(1, 5), (2, 6)] [⟨1, .set 2 8⟩, ⟨2, .insert 3 1⟩, ⟨3, .set 3 4⟩],
    overlay [(1, 5)] [⟨4, .set 9 1⟩],
    overlay [(1, 5), (3, 1)] [⟨1, .insert 3 1⟩, ⟨2, .set 1 5⟩, ⟨3, .insert 4 2⟩],
    overlay [] [⟨1, .insert 1 1⟩, ⟨2, .insert 1 2⟩, ⟨3, .set 1 3⟩] ]

def cls : Class → String
  | .write => "\"write\""
  | .read => "\"read\""
  | .background => "\"background\""

def turn (q : Queue) : String :=
  let n := q.writes.length + q.reads.length + q.background.length
  obj [("writes", arr (q.writes.map nat)), ("reads", arr (q.reads.map nat)),
    ("background", arr (q.background.map nat)), ("burst", nat q.burst),
    ("grants", arr ((grants n q).map fun (c, t) => arr [cls c, nat t]))]

def turnCases : List String :=
  [ turn ⟨[1, 2], [3, 4, 5], [6], 0⟩,
    turn ⟨[], [1, 2, 3, 4, 5], [6, 7], 0⟩,
    turn ⟨[9], [1, 2, 3, 4], [5, 6], 3⟩,
    turn ⟨[], [1], [2, 3], 3⟩,
    turn ⟨[4, 5, 6], [], [1, 2, 3], 0⟩ ]

def render : String :=
  obj [("overlays", arr overlays), ("turns", arr turnCases)] ++ "\n"

end AvenDB.LocalWriteVectors
