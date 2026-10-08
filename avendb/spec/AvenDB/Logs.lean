import AvenDB.Sync

/-!
# Logs, frontiers and forks

Every op belongs to one log: a vault's, a space's or an entry's (`Op.log?`). An op names as its parents the frontier
of its own log as its device held it, so each log is a small history of its own, and two copies of a log compare by
their frontiers alone: one hash per log on the wire. A device that asks a peer sends, for each log it holds, its
frontier and a few ops further back (`haves`): those 1, 2, 4, 8, … steps back from the frontier, and the oldest. The
peer sends back only what lies beyond the ones it holds (`respondSince`): the ops of the log that are not among them
and that none of them builds on (`missing`). A peer that is behind holds the whole frontier and sends exactly what the
device lacks; one that lacks the device's latest ops still holds one of them close by, so it sends back little the
device holds. That withholds nothing the device lacks (T19), because a device sends only ops of the part of a log
whose whole past it holds (`closedPart`): an op whose parent hasn't arrived waits outside, with whatever builds on it,
until the gap is filled.

A device signs its ops in a log one after another, each building on the one before, so two ops of one device in one
log where neither builds on the other (`forks`) mean its key signed twice from the same past: a cloned device, one
restored from an old backup, or a stolen key. A passkey signs on several devices at once, so only devices are checked.

An op's depth (`Op.depth`) stays one clock across all logs: one more than the deepest op its device held. So a removal
still sorts after everything its device had seen, in whatever log.
-/

namespace AvenDB

/-- A log: a vault's, a space's, or an entry's. -/
inductive LogId where
  | vault (v : VaultId)
  | space (sp : SpaceId)
  | entry (sp : SpaceId) (e : EntryId)
  deriving DecidableEq, Repr

/-- The log of a space or of an entry. -/
def Scope.log : Scope → LogId
  | .space sp   => .space sp
  | .entry sp e => .entry sp e

/-- The log op `op` belongs to, among the ops `ops`: a vault op and a vault's key go to the vault's log; a write and a
    checkpoint to their entry's; a space's founding, a grant, a revocation, a space or entry key and a schema or lens
    to the log of the scope they are about (`authScope?`), so a revocation joins the log of the grant it revokes. -/
def Op.log? (ops : List Op) (op : Op) : Option LogId :=
  match op.vaultOf? with
  | some v => some (.vault v)
  | none =>
    match op.item? with
    | some (sp, e) => some (.entry sp e)
    | none => (op.authScope? ops).map Scope.log

section
variable (lg : Op → Option LogId)

/-- The ops of `ops` in log `l`, by the log `lg` gives each. -/
def inLog (ops : List Op) (l : LogId) : List Op := ops.filter fun o => lg o == some l

/-- One more round: add every op of `os` whose parents are all among `ids`. -/
def closeStep (os : List Op) (ids : List OpId) : List OpId :=
  ids ++ (os.filter fun o => !ids.contains o.id && o.parents.all ids.contains).map Op.id

def closedIds (os : List Op) : Nat → List OpId → List OpId
  | 0, ids => ids
  | n + 1, ids => closedIds os n (closeStep os ids)

/-- The part of log `l` whose whole past in it is held: an op is in once each of its parents is. Each round adds the
    ops whose parents are all in, so a round per op is enough. -/
def closedPart (ops : List Op) (l : LogId) : List Op :=
  let os := inLog lg ops l
  let ids := closedIds os os.length []
  os.filter fun o => ids.contains o.id && o.parents.all ids.contains

/-- The frontier of log `l`: the ids of the ops of its closed part that no op of it builds on, smallest first. -/
def frontier (ops : List Op) (l : LogId) : List OpId :=
  let os := closedPart lg ops l
  ((os.filter fun o => !os.any (·.parents.contains o.id)).map Op.id).mergeSort fun a b => decide (a ≤ b)

/-- One more round back: add the parents of every op of `os` among `ids`. -/
def ancestorsStep (os : List Op) (ids : List OpId) : List OpId :=
  ids ++ ((os.filter fun o => ids.contains o.id).flatMap (·.parents)).filter (!ids.contains ·)

def ancestorsN (os : List Op) : Nat → List OpId → List OpId
  | 0, ids => ids
  | n + 1, ids => ancestorsN os n (ancestorsStep os ids)

/-- The ids `F` and every op of log `l` they build on, directly or further back. -/
def ancestors (ops : List Op) (l : LogId) (F : List OpId) : List OpId :=
  let os := inLog lg ops l
  ancestorsN os os.length F

/-- What of log `l` lies beyond the ops `F` an asker sent: the ops that are not in `F` and that nothing in `F` builds
    on. -/
def missing (ops : List Op) (l : LogId) (F : List OpId) : List Op :=
  let anc := ancestors lg ops l F
  (inLog lg ops l).filter fun o => !anc.contains o.id

/-- One step further back from the ids `lv`: the ops of `os` that an op of `lv` builds on, not yet `seen`. -/
def stepBack (os : List Op) (seen lv : List OpId) : List OpId :=
  let ps := (os.filter fun o => lv.contains o.id).flatMap (·.parents)
  (os.filter fun o => ps.contains o.id && !seen.contains o.id).map Op.id

/-- The levels back from `lv` among `os`: `lv`, then the ops one step further back by the shortest way, and so on, up
    to `n` levels and the first empty one. -/
def levels (os : List Op) : Nat → List OpId → List OpId → List (List OpId)
  | 0, _, _ => []
  | n + 1, seen, lv => if lv.isEmpty then [] else lv :: levels os n (seen ++ lv) (stepBack os (seen ++ lv) lv)

/-- The levels a device sends of the ones `ls` from step `k` on: the first, those a power of two steps back, and the
    last. -/
def pick : Nat → List (List OpId) → List OpId
  | _, [] => []
  | _, [lv] => lv
  | k, lv :: rest => (if k == 0 || 2 ^ k.log2 == k then lv else []) ++ pick (k + 1) rest

/-- What a device holding `ops` sends of log `l` when it asks a peer, smallest first: its frontier, the ops 1, 2, 4,
    8, … steps back from it by the shortest way, and the oldest, all of its closed part. -/
def haves (ops : List Op) (l : LogId) : List OpId :=
  let os := closedPart lg ops l
  (pick 0 (levels os (os.length + 1) [] (frontier lg ops l))).eraseDups.mergeSort fun a b => decide (a ≤ b)

/-- Two ops of one device in log `l` where neither builds on the other, the smaller id first. Only the closed part
    counts, where the whole past of both is held; `isDevice` picks out the device keys. -/
def forks (isDevice : SignerId → Bool) (ops : List Op) (l : LogId) : List (OpId × OpId) :=
  let os := closedPart lg ops l
  let before (a b : Op) : Bool := (ancestors lg ops l b.parents).contains a.id
  os.flatMap fun a => (os.filter fun b => isDevice a.author && b.author == a.author && decide (a.id < b.id) &&
    !before a b && !before b a).map fun b => (a.id, b.id)

end

/-! ## Sync by frontiers -/

/-- The logs the ops `ops` belong to, each once. -/
def logsOf (ops : List Op) : List LogId := (ops.filterMap (Op.log? ops)).eraseDups

/-- The frontier of each log a device holding `ops` holds: what its digest of the log hashes. -/
def frontiers (ops : List Op) (l : LogId) : List OpId := frontier (Op.log? ops) ops l

/-- The ops among `ops` outside every closed part, smallest first: waiting for their past, or of no log a peer
    holding them knows, as a revocation of a grant it never held. -/
def loose (ops : List Op) : List OpId :=
  let out := ops.filter fun o => match o.log? ops with
    | some l => !(closedPart (Op.log? ops) ops l).any (·.id == o.id)
    | none   => true
  (out.map Op.id).eraseDups.mergeSort fun a b => decide (a ≤ b)

/-- What a device sends a peer when it asks. -/
structure Ask where
  /-- Of each log, ops of its closed part: the peer sends nothing at or below them (`haves`). -/
  haves : LogId → List OpId
  /-- The ops it holds outside every closed part (`loose`): the peer doesn't send them again. -/
  loose : List OpId

/-- What a device holding `ops` sends when it asks a peer. -/
def asks (ops : List Op) : Ask := ⟨haves (Op.log? ops) ops, loose ops⟩

/-- What a peer holding `ops` sends device `d` that asked with `a` (`asks`): what `respond` would send, but none of
    the device's loose ops, and of each log only what lies beyond the ops it sent of it. -/
def respondSince (ops : List Op) (d : SignerId) (a : Ask) : List Op :=
  (respond ops d).filter fun op => !a.loose.contains op.id && match op.log? ops with
    | some l => !(ancestors (Op.log? ops) ops l (a.haves l)).contains op.id
    | none   => true

/-- The signers that are some vault's devices in what a peer holding `ops` knows. -/
def devicesIn (ops : List Op) (s : SignerId) : Bool := (view ops).vaults.any (·.devices.contains s)

/-- Every fork among the ops a peer holds, log by log. -/
def allForks (ops : List Op) : List (OpId × OpId) :=
  (logsOf ops).flatMap (forks (Op.log? ops) (devicesIn ops) ops)

end AvenDB
