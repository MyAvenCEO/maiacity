import AvenDB.Sync

/-!
# Logs, frontiers and forks

Every edit belongs to one log (`Edit.log?`, in `Sync.lean`): a vault's, a share's, an audience's or an entry's. An edit
names as its parents the frontier of its own log as its device held it, so each log is a small history of its own, and
two copies of a log compare by their frontiers alone: one hash per log on the wire. A device that asks a peer sends, for
each log it holds, its frontier and a few edits further back (`haves`): those 1, 2, 4, 8, … steps back from the
frontier, and the oldest. The peer sends back only what lies beyond the ones it holds (`respondSince`): the edits of the
log that are not among them and that none of them builds on (`missing`). A peer that is behind holds the whole frontier
and sends exactly what the device lacks; one that lacks the device's latest edits still holds one of them close by, so
it sends back little the device holds. That withholds nothing the device lacks (T19), because a device sends only edits
of the part of a log whose whole past it holds (`closedPart`): an edit whose parent hasn't arrived waits outside, with
whatever builds on it, until the gap is filled.

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
  haves  : LogId → List EditId
  /-- The edits it holds outside every closed part (`loose`): the peer doesn't send them again. -/
  loose  : List EditId
  /-- The vaults it follows: it may name any, and receives of each what is public of it, as it would with an interest
      in it, and nothing more (`mayReceiveAudience`). -/
  follow : List VaultId := []

/-- What a device holding `edits` and following the vaults `follow` sends when it asks a peer. -/
def asks (edits : List Edit) (follow : List VaultId := []) : Ask := ⟨haves Edit.log? edits, loose edits, follow⟩

/-- What a peer holding `edits` sends device `d` that asked with `a` (`asks`): what `respond` would send, given the
    vaults the device follows, but none of the device's loose edits, and of each log only what lies beyond the edits it
    sent of it. -/
def respondSince (edits : List Edit) (d : SignerId) (a : Ask) : List Edit :=
  (respond edits d a.follow).filter fun edit => !a.loose.contains edit.id && match edit.log? with
    | some l => !(ancestors Edit.log? edits l (a.haves l)).contains edit.id
    | none   => true

/-- The signers that are some vault's devices in what a peer holding `edits` knows. -/
def devicesIn (edits : List Edit) (s : SignerId) : Bool := (view edits).vaults.any (·.devices.contains s)

/-- Every fork among the edits a peer holds, log by log. -/
def allForks (edits : List Edit) : List (EditId × EditId) :=
  (logsOf edits).flatMap (forks Edit.log? (devicesIn edits) edits)

/-! ## Holdings

Each device tells each peer, on their connection, what it holds for good (`Announce`): of each log the peer may know by
the device's view, the frontier of the part whose whole past it holds and the edits of it it holds waiting for their
past (`holdOf`); of each file the peer may fetch, all of it or the pieces it holds whole. For good means on its shelf:
the first `held` of its edits, those its shelf has taken (on the server, those its bucket accepted). On a new connection
it tells them all (`full`), and after that what changed (`Holdings.since`).

A connection proves the device at its other end by the hello on it, and an announcement names no device: a node keeps
what it hears as the holdings of the device the connection proved (`Node.record`), so no device speaks for another, and
it announces to each peer its own holdings alone, never what it heard (H1). A device signs them too, with when it
checked, and those statements a node keeps and passes on (H2, below). Holdings route and never authorize: a node asks a
peer for the logs where the peer holds what it lacks, fetches a file first from those that hold it, and lists the
devices each entry and file is synced to, with whether each holds all of it (`Node.syncedTo`); its blob gate hands a file out by T27 alone, to the device a
sync connection still open proves (`Node.hands`), and it names to a device only the files that device may fetch (T27).
-/

/-- The edits of log `l` outside its closed part, smallest first: those waiting for their past. -/
def waitingIn (edits : List Edit) (l : LogId) : List EditId :=
  let cp := closedPart Edit.log? edits l
  (((inLog Edit.log? edits l).filter fun o => !cp.any (·.id == o.id)).map Edit.id).eraseDups.mergeSort
    fun a b => decide (a ≤ b)

/-- What a device states it holds of a log (`wire::Frontier`): the frontier of the part whose whole past it holds, and
    the edits it holds outside that part, waiting for their past. -/
structure Frontier where
  heads   : List EditId := []
  waiting : List EditId := []
  deriving DecidableEq, Repr

/-- What a device holding `edits` holds of log `l`, cut as sync cuts it. -/
def holdOf (edits : List Edit) (l : LogId) : Frontier := ⟨frontiers edits l, waitingIn edits l⟩

/-- What a device states it holds of a file (`wire::FileHold`): every sealed byte of it, or some of its pieces whole. -/
inductive FileHold where
  | whole
  | pieces (ps : List Nat)
  deriving DecidableEq, Repr

/-- A device's holdings: what it holds of each log and of each file. -/
structure Holdings where
  logs  : List (LogId × Frontier) := []
  files : List (FileId × FileHold) := []
  deriving DecidableEq, Repr

/-- What holdings `h` say of log `l`. -/
def Holdings.log? (h : Holdings) (l : LogId) : Option Frontier := (h.logs.find? (·.1 == l)).map (·.2)

/-- What holdings `h` say of file `f`. -/
def Holdings.file? (h : Holdings) (f : FileId) : Option FileHold := (h.files.find? (·.1 == f)).map (·.2)

/-- What a device tells a peer of its holdings (`wire::Announce`): all of them (`full`), which stand in for whatever it
    told the peer before, or what changed since, a file it no longer holds with `none`. It names no device. -/
structure Announce where
  full  : Bool := false
  logs  : List (LogId × Frontier) := []
  files : List (FileId × Option FileHold) := []
  deriving DecidableEq, Repr

/-- What a device holding `h` tells a peer it last told `told` on their connection (`Holdings::since`): all of it on a
    new connection (`none`), even nothing; else what changed since, a file it no longer holds with `none`, if anything
    did. -/
def Holdings.since (h : Holdings) : Option Holdings → Option Announce
  | none => some ⟨true, h.logs, h.files.map fun (f, x) => (f, some x)⟩
  | some t =>
    let logs := h.logs.filter fun (l, F) => t.log? l != some F
    let files := (h.files.filter fun (f, x) => t.file? f != some x).map (fun (f, x) => (f, some x)) ++
      (t.files.filter fun (f, _) => (h.file? f).isNone).map fun (f, _) => (f, none)
    if logs.isEmpty && files.isEmpty then none else some ⟨false, logs, files⟩

/-- What a device holds once it told `a` (`Holdings::take`): `a` alone if it tells all, else `a` over what it told
    before. -/
def Holdings.take (h : Holdings) (a : Announce) : Holdings :=
  let h := if a.full then ({} : Holdings) else h
  { logs := a.logs ++ h.logs.filter fun x => !a.logs.any (·.1 == x.1),
    files := a.files.filterMap (fun (f, x) => x.map (f, ·)) ++ h.files.filter fun x => !a.files.any (·.1 == x.1) }

/-- The most logs and files a node keeps of what one device holds (`MOST`): far more than any device holds. -/
def most : Nat := 2 ^ 18

/-- What a node keeps of a device's holdings `h` once the device told it `a` (`Shared::hear`): a device that claims to
    hold more than `most` logs or files claims nothing. -/
def hear (h : Holdings) (a : Announce) : Holdings :=
  let h := h.take a
  if most < h.logs.length || most < h.files.length then {} else h

/-- An endpoint: the iroh key a connection comes from, a sync connection and a blob connection alike. -/
abbrev EndpointId := Nat

/-- A sync connection, as the node at one end holds it: the endpoint at the other end, and the device whose hello proved
    itself on it. The hello signs the connection's own keying material with the device's key, so whatever comes on the
    connection comes from that device. -/
structure Conn where
  endpoint : EndpointId
  device   : SignerId
  deriving DecidableEq, Repr

/-- A device's signed statement of its holdings (H2, `wire::Statement`): the device, when it checked (seconds by its
    clock), and what it holds, as it tells one peer. The model abstracts its signature, ML-DSA-65 or, from a device
    made before the key move, SLH-DSA, as `signer`: whose key it verifies under, if anyone's (`Statement::verify`),
    which only that device's key can make. -/
structure Statement where
  device   : SignerId
  checked  : Nat
  holdings : Holdings := {}
  signer   : Option SignerId
  deriving DecidableEq, Repr

/-- A statement its own device signed. -/
def Statement.signed (s : Statement) : Bool := s.signer == some s.device

/-- A node, as far as holdings go: the edits it holds, in the order it took them; how many of them its shelf holds for
    good, the first `held` (on the server, those its bucket accepted; with no shelf, all of them); what its shelf holds
    of each file; its open sync connections; each announcement it heard, oldest first, with the connection it came
    on; and each statement it heard or kept on its shelf, on whatever connection it came. -/
structure Node where
  edits  : List Edit
  held   : Nat
  files  : List (FileId × FileHold) := []
  conns  : List Conn := []
  heard  : List (Conn × Announce) := []
  stated : List Statement := []

/-- The edits a node's shelf holds for good. -/
def Node.shelf (n : Node) : List Edit := n.edits.take n.held

/-- What a node holds for good (`Own`): of each log of its shelf, what its shelf holds of it, and of each file what its
    shelf holds of it. -/
def Node.own (n : Node) : Holdings :=
  { logs := (logsOf n.shelf).map fun l => (l, holdOf n.shelf l), files := n.files }

/-- The logs device `d` may know of a node holding `edits` (`Reach`): those of what the node would send `d` (`respond`,
    `Lab::announce`), which are whole logs. -/
def reachLogs (edits : List Edit) (d : SignerId) : List LogId := logsOf (respond edits d)

/-- The files device `d` may know of (`Reach`): those the edits of those logs bring, which it may fetch (T27). -/
def reachFiles (edits : List Edit) (d : SignerId) : List FileId :=
  (edits.filter fun o => match o.log? with
    | some l => (reachLogs edits d).contains l
    | none => false).flatMap Edit.filesOf

/-- What a node tells device `d` it holds (`Holdings::only`): of its own holdings, those of the logs and the files `d`
    may know of, and nothing anyone told it. (The Rust node tells only the devices it knows, `Lab::peers`.) -/
def Node.tells (n : Node) (d : SignerId) : Holdings :=
  { logs := n.own.logs.filter fun x => (reachLogs n.edits d).contains x.1,
    files := n.own.files.filter fun x => (reachFiles n.edits d).contains x.1 }

/-- What a node announces on connection `c`, having last told `told` on it (`Shared::tell`): what it tells the device
    the connection proved, all of it on a new connection, else what changed. -/
def Node.announce (n : Node) (c : Conn) (told : Option Holdings) : Option Announce := (n.tells c.device).since told

/-- What a node keeps of device `d`'s holdings: what the announcements it heard on connections whose hello proved `d`
    add up to, in order, and nothing said on any other connection. (The Rust node also drops the record of a device it
    doesn't know once its connection closes, `Shared::gone`, which only takes away.) -/
def Node.record (n : Node) (d : SignerId) : Holdings :=
  (n.heard.filter (·.1.device == d)).foldl (fun h x => hear h x.2) {}

/-- A device that states `F` of log `l` holds every edit of it a node holding `edits` holds, as far as the node's edits
    show (`Logs::covered`): each head of the node's frontier of the log is one of `F`'s heads or one they build on,
    walking the node's own edits of it, and so is each edit of it the node holds waiting, unless `F` states it waiting
    too. -/
def covers (edits : List Edit) (l : LogId) (F : Frontier) : Bool :=
  let anc := ancestors Edit.log? edits l F.heads
  (frontiers edits l).all anc.contains && (waitingIn edits l).all fun w => anc.contains w || F.waiting.contains w

/-- What "Synced to" lists devices for: an entry, by its log, or a file. -/
inductive Synced where
  | entry (e : EntryId)
  | file  (f : FileId)
  deriving DecidableEq, Repr

/-- A node holding `edits` holds some of `t`: an edit of the entry's log, or an edit that brings the file. -/
def Synced.held (edits : List Edit) : Synced → Bool
  | .entry e => !(inLog Edit.log? edits (.entry e)).isEmpty
  | .file f  => edits.any (·.filesOf.contains f)

/-- Device `d` may hold `t` by the view of a node holding `edits`: the entry's log, or the file, it may know of. -/
def Synced.reaches (edits : List Edit) (d : SignerId) : Synced → Bool
  | .entry e => (reachLogs edits d).contains (.entry e)
  | .file f  => (reachFiles edits d).contains f

/-- What holdings `h` state of `t`, if anything, and whether that is all of it a node holding `edits` holds: of an
    entry, a frontier of its log, all of it when it covers the log as the node holds it (`covers`); of a file, all of it
    or some of its pieces. -/
def Holdings.of? (h : Holdings) (edits : List Edit) : Synced → Option Bool
  | .entry e => (h.log? (.entry e)).map (covers edits (.entry e))
  | .file f  => (h.file? f).map (· == .whole)

/-- "Synced to" for `t` on a node whose device is `me` (`Node::synced_to`), smallest first: if it holds some of `t`,
    `me` if what it holds for good states some of it, and each device whose record states some of it and that may hold
    it by the node's view; each with whether it holds all of it. One list for entries and files alike. (The Rust node
    lists only devices it knows, `Lab::peers`, and leaves out a device that holds none of it as far as its own edits
    show, which only narrows; and it says how much each holds: of an entry, the node's edits of its log; of a file,
    its pieces.) -/
def Node.syncedTo (n : Node) (me : SignerId) (t : Synced) : List (SignerId × Bool) :=
  if !t.held n.edits then [] else
    (((n.own.of? n.edits t).toList.map (me, ·)) ++ (n.heard.map (·.1.device)).eraseDups.filterMap fun d =>
      if t.reaches n.edits d then ((n.record d).of? n.edits t).map (d, ·) else none).mergeSort
      fun a b => decide (a.1 ≤ b.1)

/-! ### Signed holdings (H2)

A device also signs what it tells each peer it holds, with when it checked (`Node.states`): the holdings it announces to
that peer (`Node.tells`), under its own signature. A statement names its device and proves itself, so unlike an
announcement it counts whatever connection it came on, and a node passes it on. Of each device it knows as some vault's
(`devicesIn`) a node keeps the newest statement that device signed, the one checked last (`Node.statement`), and passes
it to a peer only if the peer may know all it says by the node's view (`Node.passes`), so it tells nobody what they may
not know. "Synced to" lists a device on a live connection, or of which the node keeps no statement, by what it
announced (H1), and any other by its newest statement, with when it checked (`Node.syncedToAt`): a device's word
outlives its connection. Statements route nothing and authorize nothing: the gate reads none (T27). -/

/-- What a node whose device is `me` signs for device `d`, having checked at `now` (`Shared::statement`): what it tells
    `d` it holds. -/
def Node.states (n : Node) (me d : SignerId) (now : Nat) : Statement :=
  { device := me, checked := now, holdings := n.tells d, signer := some me }

/-- The newer of two statements: `b`, unless `s` was checked later. -/
def newer (b s : Statement) : Statement := if b.checked < s.checked then s else b

/-- What a node keeps of device `d` (`Shared::keep`): if it knows `d` as some vault's device, of the statements it heard
    that `d` signed, the one checked last, the first it heard among those checked at once. -/
def Node.statement (n : Node) (d : SignerId) : Option Statement :=
  if devicesIn n.edits d then
    match n.stated.filter (fun s => s.signed && s.device == d) with
    | [] => none
    | s :: rest => some (rest.foldl newer s)
  else none

/-- Device `p` may know all that statement `s` says by the view of a node holding `edits`: each log it states is one
    `p` may know of, and each file one `p` may fetch. -/
def mayKnow (edits : List Edit) (p : SignerId) (s : Statement) : Bool :=
  s.holdings.logs.all (fun x => (reachLogs edits p).contains x.1) &&
    s.holdings.files.all (fun x => (reachFiles edits p).contains x.1)

/-- The statements a node passes to device `p` (`Shared::pass`): of each other device it keeps a statement of, that
    statement, if `p` may know all it says. -/
def Node.passes (n : Node) (p : SignerId) : List Statement :=
  ((n.stated.map (·.device)).eraseDups.filter (· != p)).filterMap fun d => (n.statement d).filter (mayKnow n.edits p)

/-- "Synced to" for `t`, with when each device checked (`Node::synced_to`), smallest first: this device, and each device
    on a live connection (`live`) or of which the node keeps no statement, as `syncedTo` lists them, with no time; and
    each other device by its newest statement, if it may hold `t` by the node's view and the statement states some of
    it, with when it checked. -/
def Node.syncedToAt (n : Node) (me : SignerId) (live : List SignerId) (t : Synced) :
    List (SignerId × Bool × Option Nat) :=
  let byWord := ((n.syncedTo me t).filter fun x => x.1 == me || live.contains x.1 || (n.statement x.1).isNone).map
    fun x => (x.1, x.2, (none : Option Nat))
  let others := (n.stated.map (·.device)).eraseDups.filter fun d => d != me && !live.contains d && t.reaches n.edits d
  let byStatement := if t.held n.edits then others.filterMap fun d =>
      (n.statement d).bind fun s => (s.holdings.of? n.edits t).map fun all => (d, all, some s.checked)
    else []
  (byWord ++ byStatement).mergeSort fun a b => decide (a.1 ≤ b.1)

/-- A blob of a file: its root (the HashSeq of a file of several pieces, or a small file's one piece) or one of its
    pieces. -/
inductive FileBlob where
  | root  (f : FileId)
  | piece (f : FileId) (i : Nat)
  deriving DecidableEq, Repr

/-- The file a blob is of. -/
def FileBlob.file : FileBlob → FileId
  | .root f | .piece f _ => f

/-- A node's blob gate (S2, T27): a blob connection from endpoint `ep` gets blob `b` only while a sync connection from
    `ep` is open, and only if the device its hello proved, following `fl`, may fetch the file by the node's view
    (`mayFetch`). It reads no holdings, the node's own or anyone's. -/
def Node.hands (n : Node) (ep : EndpointId) (b : FileBlob) (fl : List VaultId := []) : Bool :=
  match n.conns.find? (·.endpoint == ep) with
  | some c => mayFetch n.edits c.device b.file fl
  | none   => false

end AvenDB
