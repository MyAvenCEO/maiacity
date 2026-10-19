import AvenDB.Backup
import AvenDB.Vectors

/-!
# Test vectors for backups

`lake exe vectors` writes them to `vectors/backups.json`, which the Rust core replays (`crates/avendb/tests/vectors.rs`):

- `snapshots`: for each sync case of `vaults.json` (by its name) and each vault of its view, the edits of the vault's
  snapshot (`Backup.snapshot`), by place and in its order, and the files they bring;
- `runs`: a vault's folder through backups, each of the snapshot of the case's edits at some places, by a node holding
  those, made whole when asked (`compact`) or due (`Bucket.due`), and retentions at some moment: after each step, the
  manifest it built on (by its time), the manifest it wrote (its time, the packs it names, by their ids, its files, the
  frontier of each log of what it restores and its loose edits, by place), the pack it added, each pack of the folder
  with its edits by place, and what each manifest of the folder restores, by place;
- `retention`: snapshots taken at some times, and which of them a retention at some moment keeps (`Backup.keeps`),
  by the default policy.
-/

namespace AvenDB.BackupVectors
open AvenDB.Vectors AvenDB.Backup

/-- A step of a run: a backup of the snapshot of vault `v` of the edits at the places `held`, at `time`; or the
    retention at `now` by the default policy. -/
inductive Step where
  | backup (v : VaultId) (held : List Nat) (time : Nat) (compact : Bool := false)
  | retain (now : Nat)

structure Run where
  name  : String
  /-- The sync case its edits are of. -/
  case  : String
  steps : List Step

/-- 2026-10-01 00:00 UTC. -/
def t0 : Nat := 1790812800

def runs : List Run := [
  { name := "a coop day by day: one new pack a day, none on a day nothing changed, made whole, then thinned out",
    case := "an entry by shares, by frontiers",
    steps := [
      .backup 200 (List.range 10) (t0 + 3 * hour),
      .backup 200 (List.range 13) (t0 + day + 3 * hour),
      .backup 200 (List.range 13) (t0 + day + 9 * hour),
      .backup 200 (List.range 18) (t0 + 2 * day + 3 * hour),
      .backup 200 (List.range 18) (t0 + 3 * day + 3 * hour) (compact := true),
      .retain (t0 + 40 * day),
      .backup 200 (List.range 18) (t0 + 40 * day + 3 * hour)] },
  { name := "a node that holds less than the newest snapshot, as after a reset: the next backup is whole",
    case := "an entry by shares, by frontiers",
    steps := [
      .backup 102 (List.range 18) (t0 + 3 * hour),
      .backup 102 (List.range 9) (t0 + day + 3 * hour),
      .backup 102 (List.range 18) (t0 + 2 * day + 3 * hour)] },
  { name := "an edit waiting for its past is named loose, and not stored again",
    case := "forks",
    steps := [
      .backup 100 (List.range 13) (t0 + 3 * hour),
      .backup 100 (List.range 15) (t0 + day + 3 * hour),
      .backup 100 (List.range 15) (t0 + 2 * day + 3 * hour)] },
  { name := "a human vault with files",
    case := "files follow their edits",
    steps := [
      .backup 100 (List.range 8) (t0 + 3 * hour),
      .backup 100 (List.range 20) (t0 + day + 3 * hour),
      .backup 100 (List.range 20) (t0 + 2 * day + 3 * hour) (compact := true),
      .retain (t0 + 2 * day + 4 * hour)] }]

def caseOf (name : String) : Option SyncCase := Vectors.syncs.find? (·.name == name)

def pack (p : Pack) : String := obj [("id", nat p.id), ("edits", ids (p.edits.map (·.id)))]

def manifestJson (m : Manifest) : String :=
  obj [("time", nat m.time), ("packs", ids m.packs), ("files", ids m.files),
    ("fronts", arr (m.fronts.map fun (l, f) => obj [("log", logId l), ("frontier", ids f)])), ("loose", ids m.loose)]

def runJson (r : Run) : String :=
  let edits := (caseOf r.case).map (·.toEdits) |>.getD []
  let (_, out) := r.steps.foldl (fun (b, out) s =>
    let (b', base, m, added) := match s with
      | .backup v held time compact =>
        let held := heldEdits edits held
        let snap := snapshot held v
        let fs := snapshotFiles held v
        let c := compact || b.due
        (backup b held snap fs time c, b.base snap c, some (b.manifest held snap fs time c), b.added held snap c)
      | .retain now => (b.retain {} now, none, none, [])
    let stepJson := match s with
      | .backup v held time compact => obj [("backup", obj [("vault", nat v), ("held", ids held), ("time", nat time),
          ("compact", bool compact)])]
      | .retain now => obj [("retain", nat now)]
    let restores := b'.manifests.map fun m => obj [("time", nat m.time), ("edits", ids ((b'.restore m).map (·.id)))]
    (b', out ++ [obj [("step", stepJson), ("base", opt (fun m => nat m.time) base),
      ("manifest", opt manifestJson m), ("added", opt pack added.head?), ("packs", arr (b'.packs.map pack)),
      ("files", ids b'.files), ("restores", arr restores)]])) (({} : Bucket), [])
  obj [("name", str r.name), ("case", str r.case), ("most", nat mostPacks),
    ("steps", "[\n  " ++ ",\n  ".intercalate out ++ "]")]

/-- Snapshots every six hours for 90 days, then one more an hour later. -/
def everySix : List Nat := (List.range (4 * 90)).map (t0 + 6 * hour * ·) ++ [t0 + 90 * day + hour]

/-- A few snapshots far apart, two on one day. -/
def sparse : List Nat := [t0, t0 + 5 * hour, t0 + 3 * week, t0 + 70 * day, t0 + 200 * day, t0 + 200 * day + hour]

def retention : List (List Nat × Nat) := [
  (everySix, t0 + 90 * day + 2 * hour),
  (sparse, t0 + 201 * day),
  (sparse, t0 + 400 * day)]

def retentionJson (c : List Nat × Nat) : String :=
  let (times, now) := c
  obj [("times", ids times), ("now", nat now), ("kept", arr (times.map fun t => bool (Backup.keeps {} now times t)))]

def snapshotsJson : List String :=
  Vectors.syncs.flatMap fun c =>
    let edits := c.toEdits
    (view edits).vaults.map fun vt => obj [("case", str c.name), ("vault", nat vt.id),
      ("edits", ids ((snapshot edits vt.id).map (·.id))), ("files", ids (snapshotFiles edits vt.id))]

def keepJson (k : Keep) : String := obj [("recent", nat k.recent), ("days", nat k.days), ("weeks", nat k.weeks),
  ("day", nat day), ("week", nat week), ("month", nat month)]

def render : String :=
  "{\"keep\": " ++ keepJson {} ++ ",\n\"snapshots\": [\n" ++ ",\n".intercalate snapshotsJson ++ "\n],\n\"runs\": [\n" ++
    ",\n".intercalate (runs.map runJson) ++ "\n],\n\"retention\": [\n" ++
    ",\n".intercalate (retention.map retentionJson) ++ "\n]}\n"

end AvenDB.BackupVectors
