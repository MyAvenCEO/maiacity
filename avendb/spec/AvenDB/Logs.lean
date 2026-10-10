import AvenDB.Sync

/-!
# Logs, frontiers and forks

Every edit belongs to one log (`Edit.log?`, in `Sync.lean`): a vault's, a cap's, a cell's or an entry's. An edit names
as its parents the frontier of its own log as its device held it, so each log is a small history of its own, and two
copies of a log compare by their frontiers alone: one hash per log on the wire. A device that asks a peer sends, for
each log it holds, its frontier and a few edits further back (`haves`): those 1, 2, 4, 8, … steps back from the
frontier, and the oldest. The peer sends back only what lies beyond the ones it holds (`respondSince`): the edits of
the log that are not among them and that none of them builds on (`missing`). A peer that is behind holds the whole
frontier and sends exactly what the device lacks; one that lacks the device's latest edits still holds one of them
close by, so it sends back little the device holds. That withholds nothing the device lacks (T19), because a device
sends only edits of the part of a log whose whole past it holds (`closedPart`): an edit whose parent hasn't arrived
waits outside, with whatever builds on it, until the gap is filled.

A device signs its edits in a log one after another, each building on the one before, so two edits of one device in one
log where neither builds on the other (`forks`) mean its key signed twice from the same past: a cloned device, one
restored from an old backup, or a stolen key. A passkey signs on several devices at once, so only devices are checked.

An edit's depth (`Edit.depth`) stays one clock across all logs: one more than the deepest edit its device held. So a
removal still sorts after everything its device had seen, in whatever log.
-/

namespace AvenDB

section
variable (lg : Edit → Option LogId)

/-- The edits of `edits` in log `l`, by the log `lg` gives each. -/
def inLog (edits : List Edit) (l : LogId) : List Edit := edits.filter fun o => lg o == some l

/-- One more round: add every edit of `os` whose parents are all among `ids`. -/
def closeStep (os : List Edit) (ids : List EditId) : List EditId :=
  ids ++ (os.filter fun o => !ids.contains o.id && o.parents.all ids.contains).map Edit.id

def closedIds (os : List Edit) : Nat → List EditId → List EditId
  | 0, ids => ids
  | n + 1, ids => closedIds os n (closeStep os ids)

/-- The part of log `l` whose whole past in it is held: an edit is in once each of its parents is. Each round adds the
    edits whose parents are all in, so a round per edit is enough. -/
def closedPart (edits : List Edit) (l : LogId) : List Edit :=
  let os := inLog lg edits l
  let ids := closedIds os os.length []
  os.filter fun o => ids.contains o.id && o.parents.all ids.contains

/-- The frontier of log `l`: the ids of the edits of its closed part that no edit of it builds on, smallest first. -/
def frontier (edits : List Edit) (l : LogId) : List EditId :=
  let os := closedPart lg edits l
  ((os.filter fun o => !os.any (·.parents.contains o.id)).map Edit.id).mergeSort fun a b => decide (a ≤ b)

/-- One more round back: add the parents of every edit of `os` among `ids`. -/
def ancestorsStep (os : List Edit) (ids : List EditId) : List EditId :=
  ids ++ ((os.filter fun o => ids.contains o.id).flatMap (·.parents)).filter (!ids.contains ·)

def ancestorsN (os : List Edit) : Nat → List EditId → List EditId
  | 0, ids => ids
  | n + 1, ids => ancestorsN os n (ancestorsStep os ids)

/-- The ids `F` and every edit of log `l` they build on, directly or further back. -/
def ancestors (edits : List Edit) (l : LogId) (F : List EditId) : List EditId :=
  let os := inLog lg edits l
  ancestorsN os os.length F

/-- What of log `l` lies beyond the edits `F` an asker sent: the edits that are not in `F` and that nothing in `F`
    builds on. -/
def missing (edits : List Edit) (l : LogId) (F : List EditId) : List Edit :=
  let anc := ancestors lg edits l F
  (inLog lg edits l).filter fun o => !anc.contains o.id

/-- One step further back from the ids `lv`: the edits of `os` that an edit of `lv` builds on, not yet `seen`. -/
def stepBack (os : List Edit) (seen lv : List EditId) : List EditId :=
  let ps := (os.filter fun o => lv.contains o.id).flatMap (·.parents)
  (os.filter fun o => ps.contains o.id && !seen.contains o.id).map Edit.id

/-- The levels back from `lv` among `os`: `lv`, then the edits one step further back by the shortest way, and so on, up
    to `n` levels and the first empty one. -/
def levels (os : List Edit) : Nat → List EditId → List EditId → List (List EditId)
  | 0, _, _ => []
  | n + 1, seen, lv => if lv.isEmpty then [] else lv :: levels os n (seen ++ lv) (stepBack os (seen ++ lv) lv)

/-- The levels a device sends of the ones `ls` from step `k` on: the first, those a power of two steps back, and the
    last. -/
def pick : Nat → List (List EditId) → List EditId
  | _, [] => []
  | _, [lv] => lv
  | k, lv :: rest => (if k == 0 || 2 ^ k.log2 == k then lv else []) ++ pick (k + 1) rest

/-- What a device holding `edits` sends of log `l` when it asks a peer, smallest first: its frontier, the edits 1, 2, 4,
    8, … steps back from it by the shortest way, and the oldest, all of its closed part. -/
def haves (edits : List Edit) (l : LogId) : List EditId :=
  let os := closedPart lg edits l
  (pick 0 (levels os (os.length + 1) [] (frontier lg edits l))).eraseDups.mergeSort fun a b => decide (a ≤ b)

/-- Two edits of one device in log `l` where neither builds on the other, the smaller id first. Only the closed part
    counts, where the whole past of both is held; `isDevice` picks out the device keys. -/
def forks (isDevice : SignerId → Bool) (edits : List Edit) (l : LogId) : List (EditId × EditId) :=
  let os := closedPart lg edits l
  let before (a b : Edit) : Bool := (ancestors lg edits l b.parents).contains a.id
  os.flatMap fun a => (os.filter fun b => isDevice a.author && b.author == a.author && decide (a.id < b.id) &&
    !before a b && !before b a).map fun b => (a.id, b.id)

end

/-! ## Sync by frontiers -/

/-- The logs the edits `edits` belong to, each once. -/
def logsOf (edits : List Edit) : List LogId := (edits.filterMap Edit.log?).eraseDups

/-- The frontier of each log a device holding `edits` holds: what its digest of the log hashes. -/
def frontiers (edits : List Edit) (l : LogId) : List EditId := frontier Edit.log? edits l

/-- The edits among `edits` outside every closed part, smallest first: waiting for their past, or of no log. -/
def loose (edits : List Edit) : List EditId :=
  let out := edits.filter fun o => match o.log? with
    | some l => !(closedPart Edit.log? edits l).any (·.id == o.id)
    | none   => true
  (out.map Edit.id).eraseDups.mergeSort fun a b => decide (a ≤ b)

/-- What a device sends a peer when it asks. -/
structure Ask where
  /-- Of each log, edits of its closed part: the peer sends nothing at or below them (`haves`). -/
  haves : LogId → List EditId
  /-- The edits it holds outside every closed part (`loose`): the peer doesn't send them again. -/
  loose : List EditId

/-- What a device holding `edits` sends when it asks a peer. -/
def asks (edits : List Edit) : Ask := ⟨haves Edit.log? edits, loose edits⟩

/-- What a peer holding `edits` sends device `d` that asked with `a` (`asks`): what `respond` would send, but none of
    the device's loose edits, and of each log only what lies beyond the edits it sent of it. -/
def respondSince (edits : List Edit) (d : SignerId) (a : Ask) : List Edit :=
  (respond edits d).filter fun edit => !a.loose.contains edit.id && match edit.log? with
    | some l => !(ancestors Edit.log? edits l (a.haves l)).contains edit.id
    | none   => true

/-- The signers that are some vault's devices in what a peer holding `edits` knows. -/
def devicesIn (edits : List Edit) (s : SignerId) : Bool := (view edits).vaults.any (·.devices.contains s)

/-- Every fork among the edits a peer holds, log by log. -/
def allForks (edits : List Edit) : List (EditId × EditId) :=
  (logsOf edits).flatMap (forks Edit.log? (devicesIn edits) edits)

end AvenDB
