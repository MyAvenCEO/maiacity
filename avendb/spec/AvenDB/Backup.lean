import AvenDB.SyncLemmas

/-!
# Backups: a snapshot of each vault, deduplicated, by frontiers

A node keeps its vaults in one place, its shelf (on the server, its bucket), which holds what is true now. A backup
keeps each vault apart, as it was at many moments, in a folder of its own of a bucket of snapshots, so a vault comes
back as it was on any day kept (`docs/BACKUP.md`).

A vault's **snapshot** (`snapshot`) is what the vault needs, of the edits a node holds: the logs of its entries and
audiences, the logs of every share over it, issued by it or naming it, and of every share those rest on, and the logs of
the vault and of every vault those edits name, up their owners, so a restore checks every chain without anything else.
It is `respond` (`Sync.lean`) asked for the whole vault rather than for one device. Its files are those its writes
bring (`snapshotFiles`).

A vault's **folder** (`Bucket`) holds packs of edits, each under an id of its own, the files, and a manifest for each
snapshot, which names the packs and the files it is made of, and, of what it restores, the frontier of each log and
the edits outside every closed part (`fronts`, `loose`): what a device holding it would ask a peer with, by frontiers
alone (`Logs.lean`). A backup (`backup`) builds on the newest manifest (`Bucket.base`), as a device asks a peer: it
names that manifest's packs again and writes one new pack of what lies beyond its frontiers (`since`), the edits
`respondSince` would send. It builds on none, and writes the whole snapshot in one pack, when it is made whole
(`compact`), as it is once the newest names `mostPacks` packs (`Bucket.due`), or when the newest restores an edit the
snapshot lacks. A restore (`Bucket.restore`) takes the packs a manifest names, each edit once. Pruning (`prune`) drops
the manifests a retention policy lets go (`keeps`), and the packs and files no manifest left names.

What must hold:

- B1, recovery: what the manifest a backup writes restores is exactly its snapshot, and so in the same state (T11);
- B2, dedup: a backup stores only edits of the snapshot beyond the frontiers of the manifest it builds on, and each
  file once;
- B3, files: every file a manifest names is in its folder;
- B4, pruning and later backups leave every snapshot still kept restoring exactly as before;
- B5, retention: the newest snapshot is always kept, and every day (in the daily window), week (in the weekly window)
  and month with a snapshot keeps one;
- B6, a snapshot holds only edits the node holds, and of entries only those of its vault;
- B7, by sync: of a snapshot, every edit is one the manifest a backup builds on restores, or lies beyond its frontiers
  (from T19's `frontier_sync`), so asking by frontiers loses nothing;
- B8, bounded: a manifest names at most `mostPacks` packs, so a restore reads at most that many;
- B9, a restore checks itself: what a manifest restores has the frontiers and the loose edits it names, so a restored
  node is checked log by log against its manifest, as two peers compare digests.
-/

namespace AvenDB
namespace Backup
open Syncing

/-! ## Snapshots -/

/-- Log `l` is vault `v`'s, by the view `st`: the log of one of its entries or audiences, or of a share over it, issued
    by it or naming it, or that such a share rests on. A vault log is taken with the vaults the rest names. -/
def ofVault (st : State) (v : VaultId) : LogId → Bool
  | .entry e      => match st.entry? e with
    | some en => en.vault == v
    | none    => false
  | .audience u _ => u == v
  | .share c      => st.shares.any fun x => (x.over == v || x.issuer == v || x.who == .vault v) && restsOn st c x.id
  | .vault _      => false

/-- The edits of `edits` in vault `v`'s own logs. -/
def items (edits : List Edit) (v : VaultId) : List Edit :=
  let st := view edits
  edits.filter fun o => match o.log? with
    | some l => ofVault st v l
    | none   => false

/-- The snapshot of vault `v` of a node holding `edits`: the edits of the vault's own logs (`items`), and of the logs of
    the vault and every vault those name, up their owners. -/
def snapshot (edits : List Edit) (v : VaultId) : List Edit :=
  let st := view edits
  let mine := items edits v
  let vaults := closeVaults st st.depth (v :: mine.flatMap Edit.vaultsNamed)
  mine ++ edits.filter fun o => match o.log? with
    | some (.vault u) => vaults.contains u
    | _ => false

/-- The files a snapshot's writes bring, each once. -/
def snapshotFiles (edits : List Edit) (v : VaultId) : List FileId :=
  ((snapshot edits v).flatMap Edit.filesOf).eraseDups

/-! ## A vault's folder -/

/-- A pack of edits, under its id. -/
structure Pack where
  id    : Nat
  edits : List Edit
  deriving DecidableEq, Repr

/-- A snapshot as its folder keeps it: when it was taken, the packs it is made of and its files, and of what it
    restores, the frontier of each log (`fronts`) and the edits outside every closed part (`loose`). -/
structure Manifest where
  time   : Nat
  packs  : List Nat
  files  : List FileId
  fronts : List (LogId × List EditId)
  loose  : List EditId
  deriving DecidableEq, Repr

/-- Of the edits `r`, each log's frontier: what a device holding them asks a peer with, by frontiers alone. -/
def fronts (r : List Edit) : List (LogId × List EditId) := (logsOf r).map fun l => (l, frontiers r l)

/-- What manifest `m` names of log `l`: its frontier there, or nothing. -/
def Manifest.haves (m : Manifest) (l : LogId) : List EditId := ((m.fronts.find? (·.1 == l)).map (·.2)).getD []

/-- Manifest `m` as a device holding what it restores would ask a peer (`Ask`). -/
def Manifest.ask (m : Manifest) : Ask := ⟨m.haves, m.loose, []⟩

/-- A vault's folder: its packs, its manifests, the oldest first, and its files. -/
structure Bucket where
  packs     : List Pack := []
  manifests : List Manifest := []
  files     : List FileId := []
  deriving Repr

/-- `l` without its repeats, each kept at its last place. -/
def uniq [DecidableEq α] : List α → List α
  | [] => []
  | o :: os => if o ∈ os then uniq os else o :: uniq os

/-- An id no pack of `b` has: one more than the highest. -/
def Bucket.fresh (b : Bucket) : Nat := (b.packs.map Pack.id).foldr max 0 + 1

/-- What manifest `m` restores of `b`: the edits of the packs it names, each once. -/
def Bucket.restore (b : Bucket) (m : Manifest) : List Edit :=
  uniq ((b.packs.filter fun p => m.packs.contains p.id).flatMap Pack.edits)

/-- The newest manifest of `b`, if any. -/
def Bucket.newest (b : Bucket) : Option Manifest := b.manifests.getLast?

/-- The most packs a manifest names: once the newest names this many, the next backup is made whole. -/
def mostPacks : Nat := 64

/-- The next backup into `b` is made whole: its newest manifest names `mostPacks` packs. -/
def Bucket.due (b : Bucket) : Bool := match b.newest with
  | some m => mostPacks ≤ m.packs.length
  | none   => false

/-- Of `snap`, what lies beyond what manifest `m` names, walking back through the edits `R` the node holds: none of its
    loose edits, and of each log nothing at or below its frontier there. What `respondSince` sends a device that asked
    with `m` (`Manifest.ask`). -/
def since (R snap : List Edit) (m : Manifest) : List Edit :=
  snap.filter fun o => !m.loose.contains o.id && match o.log? with
    | some l => !(ancestors Edit.log? R l (m.haves l)).contains o.id
    | none   => true

/-- The manifest a backup of `snap` builds on: the newest, unless the backup is made whole (`compact`) or the newest
    restores an edit `snap` lacks. -/
def Bucket.base (b : Bucket) (snap : List Edit) (compact : Bool) : Option Manifest :=
  match b.newest with
  | some m => if !compact && (b.restore m).all (snap.contains ·) then some m else none
  | none   => none

/-- The packs of `b` a backup of `snap` names again: those of the manifest it builds on. -/
def Bucket.kept (b : Bucket) (snap : List Edit) (compact : Bool) : List Pack :=
  match b.base snap compact with
  | some m => b.packs.filter fun p => m.packs.contains p.id
  | none   => []

/-- The edits of the one new pack of a backup of `snap`, by the edits `R` the node holds: what lies beyond the manifest
    it builds on, or the whole snapshot. -/
def Bucket.news (b : Bucket) (R snap : List Edit) (compact : Bool) : List Edit :=
  match b.base snap compact with
  | some m => since R snap m
  | none   => snap

/-- The pack a backup adds: of its new edits, under a fresh id; none if there are none. -/
def Bucket.added (b : Bucket) (R snap : List Edit) (compact : Bool) : List Pack :=
  if (b.news R snap compact).isEmpty then [] else [⟨b.fresh, b.news R snap compact⟩]

/-- The packs the manifest of a backup names. -/
def Bucket.named (b : Bucket) (R snap : List Edit) (compact : Bool) : List Nat :=
  (b.kept snap compact).map Pack.id ++ (b.added R snap compact).map Pack.id

/-- The manifest of a backup of `snap` with files `fs`, taken at `time`: the packs it names, its files, and the
    frontiers and loose edits of what those packs restore. -/
def Bucket.manifest (b : Bucket) (R snap : List Edit) (fs : List FileId) (time : Nat) (compact : Bool) : Manifest :=
  let named := b.named R snap compact
  let r := uniq (((b.packs ++ b.added R snap compact).filter fun p => named.contains p.id).flatMap Pack.edits)
  ⟨time, named, fs, fronts r, loose r⟩

/-- A backup of `snap` with files `fs`, taken at `time`, into `b`, by a node holding `R`: the new pack, the files `b`
    lacks, then the manifest, last (nothing counts until the bucket has it). -/
def backup (b : Bucket) (R snap : List Edit) (fs : List FileId) (time : Nat) (compact : Bool := false) : Bucket :=
  { packs := b.packs ++ b.added R snap compact, manifests := b.manifests ++ [b.manifest R snap fs time compact],
    files := b.files ++ fs.filter (!b.files.contains ·) }

/-- `b` with only the manifests `keep` keeps, and the packs and files they name. -/
def prune (b : Bucket) (keep : Manifest → Bool) : Bucket :=
  let ms := b.manifests.filter keep
  { packs := b.packs.filter (fun p => ms.any (·.packs.contains p.id)), manifests := ms,
    files := b.files.filter (fun f => ms.any (·.files.contains f)) }

/-- A folder as backups and pruning leave it: no two packs share an id, every pack and file a manifest names is there,
    and each manifest names the frontiers and loose edits of what it restores. -/
structure Bucket.WF (b : Bucket) : Prop where
  ids    : (b.packs.map Pack.id).Nodup
  packs  : ∀ m ∈ b.manifests, ∀ i ∈ m.packs, ∃ p ∈ b.packs, p.id = i
  files  : ∀ m ∈ b.manifests, ∀ f ∈ m.files, f ∈ b.files
  fronts : ∀ m ∈ b.manifests, m.fronts = fronts (b.restore m) ∧ m.loose = loose (b.restore m)

/-- The edits of `b`'s packs agree with the edits `R` a node holds: an id both hold names one edit, as an edit's id is
    its hash. -/
def Bucket.Agrees (b : Bucket) (R : List Edit) : Prop := ∀ p ∈ b.packs, ∀ a ∈ p.edits, ∀ o ∈ R, a.id = o.id → a = o

/-! ## Retention, as Time Machine keeps backups -/

def hour : Nat := 3600
def day : Nat := 24 * hour
def week : Nat := 7 * day
/-- A month of retention: 30 days. -/
def month : Nat := 30 * day

/-- What a vault's backups keep: every snapshot of the last `recent` seconds, the newest of each day for `days` days,
    of each week for `weeks` weeks, and of each month for ever. -/
structure Keep where
  recent : Nat := 48 * hour
  days   : Nat := 30
  weeks  : Nat := 26
  deriving Repr

def newestOf (times : List Nat) : Nat := times.foldr max 0

/-- `t` is the newest of `times` in its period of `len` seconds (counted from 1970). -/
def newestIn (times : List Nat) (len t : Nat) : Bool := times.all fun u => u / len != t / len || u ≤ t

/-- At `now`, of snapshots taken at `times`, the one taken at `t` is kept. -/
def keeps (k : Keep) (now : Nat) (times : List Nat) (t : Nat) : Bool :=
  t == newestOf times || now - t < k.recent ||
  (now - t < k.days * day && newestIn times day t) ||
  (now - t < k.weeks * week && newestIn times week t) ||
  newestIn times month t

/-- `b` pruned at `now` by `k`. -/
def Bucket.retain (b : Bucket) (k : Keep) (now : Nat) : Bucket :=
  prune b fun m => keeps k now (b.manifests.map (·.time)) m.time

/-! ## Lemmas -/

theorem mem_uniq [DecidableEq α] {o : α} : ∀ {l : List α}, o ∈ uniq l ↔ o ∈ l
  | [] => by simp [uniq]
  | x :: xs => by
    unfold uniq
    split
    · rw [mem_uniq]; constructor
      · exact fun h => List.mem_cons_of_mem _ h
      · intro h; rcases List.mem_cons.1 h with rfl | h
        · assumption
        · exact h
    · simp [mem_uniq]

theorem uniq_nodup [DecidableEq α] : ∀ (l : List α), (uniq l).Nodup
  | [] => by simp [uniq]
  | x :: xs => by
    unfold uniq
    split
    · exact uniq_nodup xs
    · rename_i h
      exact List.nodup_cons.2 ⟨fun h' => h (mem_uniq.1 h'), uniq_nodup xs⟩

/-- Two members of `s` that `f` sends to one place are one, when `f` repeats nothing on `s`. -/
theorem inj_on {f : α → β} : ∀ {s : List α}, (s.map f).Nodup → ∀ {a b}, a ∈ s → b ∈ s → f a = f b → a = b
  | [], _, _, _, ha, _, _ => by simp at ha
  | x :: xs, h, a, b, ha, hb, hab => by
    rw [List.map_cons, List.nodup_cons] at h
    rcases List.mem_cons.1 ha with rfl | ha' <;> rcases List.mem_cons.1 hb with rfl | hb'
    · rfl
    · exact absurd (hab ▸ List.mem_map_of_mem hb') h.1
    · exact absurd (hab.symm ▸ List.mem_map_of_mem ha') h.1
    · exact inj_on h.2 ha' hb' hab

/-- A list without repeats, every member of which is in `s`, repeats no image under `f` if `s` doesn't. -/
theorem nodup_map_of_sub {f : α → β} {l s : List α} (hl : l.Nodup) (hs : (s.map f).Nodup) (sub : ∀ o ∈ l, o ∈ s) :
    (l.map f).Nodup := by
  unfold List.Nodup at *
  rw [List.pairwise_map]
  exact hl.imp_of_mem fun ha hb hne heq => hne (inj_on hs (sub _ ha) (sub _ hb) heq)

theorem nodup_of_map {f : α → β} {l : List α} (h : (l.map f).Nodup) : l.Nodup := by
  unfold List.Nodup at *
  rw [List.pairwise_map] at h
  exact h.imp fun hne heq => hne (congrArg f heq)

theorem le_foldr_max : ∀ {l : List Nat} {x : Nat}, x ∈ l → x ≤ l.foldr max 0
  | [], _, h => by simp at h
  | y :: ys, x, h => by
    simp only [List.foldr_cons]
    rcases List.mem_cons.1 h with rfl | h
    · exact Nat.le_max_left _ _
    · exact Nat.le_trans (le_foldr_max h) (Nat.le_max_right _ _)

theorem foldr_max_mem : ∀ {l : List Nat}, l ≠ [] → l.foldr max 0 ∈ l
  | [], h => absurd rfl h
  | [y], _ => by simp
  | y :: z :: zs, _ => by
    have ih := foldr_max_mem (l := z :: zs) (by simp)
    simp only [List.foldr_cons] at ih ⊢
    rw [Nat.max_def]
    split
    · exact List.mem_cons_of_mem _ ih
    · exact List.mem_cons_self

theorem lt_fresh (b : Bucket) {p : Pack} (h : p ∈ b.packs) : p.id < b.fresh :=
  Nat.lt_succ_of_le (le_foldr_max (List.mem_map_of_mem h))

theorem mem_added {b : Bucket} {R snap : List Edit} {c : Bool} {p : Pack} (h : p ∈ b.added R snap c) :
    p = ⟨b.fresh, b.news R snap c⟩ := by
  unfold Bucket.added at h; split at h <;> simp_all

theorem added_not_mem {b : Bucket} {R snap : List Edit} {c : Bool} {i : Nat} (hi : ∃ q ∈ b.packs, q.id = i) :
    i ∉ (b.added R snap c).map Pack.id := by
  intro h
  obtain ⟨p, hp, rfl⟩ := List.mem_map.1 h
  obtain ⟨q, hq, hqi⟩ := hi
  have := lt_fresh b hq
  rw [mem_added hp] at hqi
  simp at hqi; omega

/-- The new pack is added whenever there is anything new. -/
theorem mem_added_of {b : Bucket} {R snap : List Edit} {c : Bool} {o : Edit} (h : o ∈ b.news R snap c) :
    (⟨b.fresh, b.news R snap c⟩ : Pack) ∈ b.added R snap c := by
  unfold Bucket.added
  have : (b.news R snap c).isEmpty = false := by
    cases hn : b.news R snap c with
    | nil => rw [hn] at h; simp at h
    | cons _ _ => rfl
  simp [this]

/-- The manifest a backup builds on is the newest, restores only edits of the snapshot, and the backup isn't made whole.
-/
theorem base_some {b : Bucket} {snap : List Edit} {c : Bool} {m : Manifest} (h : b.base snap c = some m) :
    b.newest = some m ∧ (∀ o ∈ b.restore m, o ∈ snap) ∧ c = false := by
  unfold Bucket.base at h
  split at h
  · rename_i m' hm'
    split at h
    · rename_i hc
      simp only [Option.some.injEq] at h
      subst h
      simp only [Bool.and_eq_true, Bool.not_eq_true', List.all_eq_true, List.contains_iff_mem] at hc
      exact ⟨hm', hc.2, hc.1⟩
    · simp at h
  · simp at h

theorem newest_mem {b : Bucket} {m : Manifest} (h : b.newest = some m) : m ∈ b.manifests := List.mem_of_getLast? h

theorem kept_sub {b : Bucket} {snap : List Edit} {c : Bool} {p : Pack} (h : p ∈ b.kept snap c) :
    p ∈ b.packs ∧ ∃ m, b.base snap c = some m ∧ p.id ∈ m.packs := by
  unfold Bucket.kept at h
  split at h
  · rename_i m hm
    obtain ⟨hp, hpi⟩ := List.mem_filter.1 h
    exact ⟨hp, m, hm, List.contains_iff_mem.1 hpi⟩
  · simp at h

theorem mem_kept {b : Bucket} {snap : List Edit} {c : Bool} {p : Pack} {m : Manifest} (hp : p ∈ b.packs)
    (hm : b.base snap c = some m) (hpi : p.id ∈ m.packs) : p ∈ b.kept snap c := by
  simp only [Bucket.kept, hm]
  exact List.mem_filter.2 ⟨hp, List.contains_iff_mem.2 hpi⟩

theorem news_sub {b : Bucket} {R snap : List Edit} {c : Bool} {o : Edit} (h : o ∈ b.news R snap c) : o ∈ snap := by
  unfold Bucket.news at h
  split at h
  · exact (List.mem_filter.1 h).1
  · exact h

/-- An edit some manifest restores is one of a pack of its folder. -/
theorem mem_restore {b : Bucket} {m : Manifest} {o : Edit} :
    o ∈ b.restore m ↔ ∃ p ∈ b.packs, p.id ∈ m.packs ∧ o ∈ p.edits := by
  simp only [Bucket.restore, mem_uniq, List.mem_flatMap, List.mem_filter, List.contains_iff_mem]
  constructor
  · rintro ⟨p, ⟨hp, hpi⟩, ho⟩; exact ⟨p, hp, hpi, ho⟩
  · rintro ⟨p, hp, hpi, ho⟩; exact ⟨p, ⟨hp, hpi⟩, ho⟩

/-- What a manifest names of a log is the frontier there of what it restores. -/
theorem mem_haves {r : List Edit} {m : Manifest} (hf : m.fronts = fronts r) {l : LogId} {i : EditId}
    (h : i ∈ m.haves l) : i ∈ frontiers r l := by
  unfold Manifest.haves at h
  cases hfind : m.fronts.find? (·.1 == l) with
  | none => simp [hfind] at h
  | some p =>
    simp only [hfind, Option.map_some, Option.getD_some] at h
    have hp := List.mem_of_find?_eq_some hfind
    have hpl := List.find?_some hfind
    rw [hf] at hp
    obtain ⟨l', _, rfl⟩ := List.mem_map.1 hp
    simp only [beq_iff_eq] at hpl
    subst hpl
    exact h

/-- A manifest that names the frontiers and loose edits of what it restores asks truthfully by them (`Truthful`). -/
theorem truthful_of {r : List Edit} {m : Manifest} (hf : m.fronts = fronts r) (hl : m.loose = loose r) :
    Truthful r m.ask :=
  ⟨fun _ _ hi => frontier_mem Edit.log? (mem_haves hf hi), fun _ hi => loose_mem (hl ▸ hi)⟩

/-! ## B6: a snapshot holds only what it should -/

/-- B6: every edit of vault `v`'s snapshot is one the node holds, and of an entry only one of `v`'s. -/
theorem B6_snapshot_sealed (edits : List Edit) (v : VaultId) {o : Edit} (h : o ∈ snapshot edits v) :
    o ∈ edits ∧ ∀ e, o.log? = some (.entry e) → ((view edits).entry? e).map (·.vault) = some v := by
  simp only [snapshot, items, List.mem_append, List.mem_filter] at h
  rcases h with ⟨ho, hl⟩ | ⟨ho, hl⟩
  · refine ⟨ho, fun e he => ?_⟩
    rw [he] at hl
    simp only [ofVault] at hl
    split at hl
    · rename_i en h; simp [h, beq_iff_eq.1 hl]
    · simp at hl
  · refine ⟨ho, fun e he => ?_⟩
    rw [he] at hl; simp at hl

/-- A snapshot repeats no edit's id when the node's edits repeat none. -/
theorem snapshot_nodup {edits : List Edit} (hids : (edits.map Edit.id).Nodup) (v : VaultId) :
    ((snapshot edits v).map Edit.id).Nodup := by
  simp only [snapshot, items, List.map_append]
  refine List.nodup_append.2 ⟨((List.filter_sublist).map _).nodup hids, ((List.filter_sublist).map _).nodup hids, ?_⟩
  intro a ha a' ha' h
  subst h
  obtain ⟨x, hx, rfl⟩ := List.mem_map.1 ha
  obtain ⟨y, hy, hxy⟩ := List.mem_map.1 ha'
  obtain ⟨hx, hlx⟩ := List.mem_filter.1 hx
  obtain ⟨hy, hly⟩ := List.mem_filter.1 hy
  have : y = x := inj_on hids hy hx hxy
  subst this
  split at hly
  · rename_i u hu; rw [hu] at hlx; simp [ofVault] at hlx
  · simp at hly

/-! ## B7: asking by frontiers loses nothing -/

/-- B7: of a snapshot of the edits `R` a node holds, every edit is one a manifest of a folder as backups leave it
    restores, or lies beyond its frontiers (`since`): T19's `frontier_sync`, the manifest asking as a device would. -/
theorem B7_since {b : Bucket} (wf : b.WF) {m : Manifest} (hm : m ∈ b.manifests) {R snap : List Edit}
    (hR : ∀ o ∈ snap, o ∈ R) (hid : b.Agrees R) {o : Edit} (ho : o ∈ snap) : o ∈ b.restore m ∨ o ∈ since R snap m := by
  have hidA : ∀ a ∈ b.restore m, ∀ x ∈ R, a.id = x.id → a = x := by
    intro a ha x hx h
    obtain ⟨p, hp, _, hap⟩ := mem_restore.1 ha
    exact hid p hp a hap x hx h
  have ht := truthful_of (wf.fronts m hm).1 (wf.fronts m hm).2
  by_cases hl : m.loose.contains o.id = true
  · obtain ⟨x, hx, hxid⟩ := ht.2 _ (List.contains_iff_mem.1 hl)
    left
    exact (hidA x hx o (hR o ho) hxid) ▸ hx
  · have hl' : o.id ∉ m.loose := fun h => hl (List.contains_iff_mem.2 h)
    cases hlog : o.log? with
    | none =>
      right
      exact List.mem_filter.2 ⟨ho, by simp [hl', hlog]⟩
    | some l =>
      have hx : o ∈ inLog Edit.log? R l := List.mem_filter.2 ⟨hR o ho, by simp [hlog]⟩
      rcases frontier_sync Edit.log? Edit.log? hidA (ht.1 l) hx with h | h
      · exact .inl h
      · right
        refine List.mem_filter.2 ⟨ho, ?_⟩
        have := (List.mem_filter.1 h).2
        simp only [Manifest.ask] at this
        simp only [hlog]
        simpa [hl'] using this

/-! ## B1: a backup restores exactly its snapshot -/

/-- B1: what the manifest a backup of `snap` writes restores, of the folder it leaves, is exactly `snap`, when the node
    that backs up holds `snap`. -/
theorem B1_restore_exact {b : Bucket} (wf : b.WF) {R snap : List Edit} (hR : ∀ o ∈ snap, o ∈ R) (hid : b.Agrees R)
    (fs : List FileId) (time : Nat) (c : Bool) (o : Edit) :
    o ∈ (backup b R snap fs time c).restore (b.manifest R snap fs time c) ↔ o ∈ snap := by
  simp only [Bucket.restore, backup, Bucket.manifest, Bucket.named, mem_uniq, List.mem_flatMap, List.mem_filter,
    List.contains_iff_mem, List.mem_append]
  constructor
  · rintro ⟨p, ⟨hp, hpi⟩, ho⟩
    rcases hp with hp | hp
    · rcases hpi with hpi | hpi
      · obtain ⟨q, hq, hqi⟩ := List.mem_map.1 hpi
        obtain ⟨hqb, m, hm, hqm⟩ := kept_sub hq
        have : q = p := inj_on wf.ids hqb hp hqi
        subst this
        exact (base_some hm).2.1 o (mem_restore.2 ⟨q, hqb, hqm, ho⟩)
      · exact absurd hpi (added_not_mem ⟨p, hp, rfl⟩)
    · rw [mem_added hp] at ho
      exact news_sub ho
  · intro ho
    have viaNews : o ∈ b.news R snap c → ∃ p, ((p ∈ b.packs ∨ p ∈ b.added R snap c) ∧
        (p.id ∈ (b.kept snap c).map Pack.id ∨ p.id ∈ (b.added R snap c).map Pack.id)) ∧ o ∈ p.edits :=
      fun hn => ⟨_, ⟨Or.inr (mem_added_of hn), Or.inr (List.mem_map_of_mem (mem_added_of hn))⟩, hn⟩
    cases hb : b.base snap c with
    | none => exact viaNews (by simp only [Bucket.news, hb]; exact ho)
    | some m =>
      rcases B7_since wf (newest_mem (base_some hb).1) hR hid ho with h | h
      · obtain ⟨p, hp, hpi, hop⟩ := mem_restore.1 h
        exact ⟨p, ⟨Or.inl hp, Or.inl (List.mem_map_of_mem (mem_kept hp hb hpi))⟩, hop⟩
      · exact viaNews (by simp only [Bucket.news, hb]; exact h)

/-- B4, later backups: a backup changes nothing an older manifest restores. -/
theorem B4_backup_keeps {b : Bucket} (wf : b.WF) (R snap : List Edit) (fs : List FileId) (time : Nat) (c : Bool)
    {m : Manifest} (hm : m ∈ b.manifests) : (backup b R snap fs time c).restore m = b.restore m := by
  simp only [Bucket.restore, backup, List.filter_append]
  have : (b.added R snap c).filter (fun p => m.packs.contains p.id) = [] := by
    rw [List.filter_eq_nil_iff]
    intro p hp hpi
    exact added_not_mem (wf.packs m hm p.id (List.contains_iff_mem.1 hpi)) (List.mem_map_of_mem hp)
  rw [this, List.append_nil]

/-- A backup leaves a folder as backups do (`Bucket.WF`). -/
theorem backup_wf {b : Bucket} (wf : b.WF) (R snap : List Edit) (fs : List FileId) (time : Nat) (c : Bool) :
    (backup b R snap fs time c).WF := by
  constructor
  · simp only [backup, List.map_append]
    refine List.nodup_append.2 ⟨wf.ids, ?_, ?_⟩
    · unfold Bucket.added; split <;> simp
    · intro a ha b' hb' hab
      subst hab
      obtain ⟨q, hq, rfl⟩ := List.mem_map.1 ha
      exact added_not_mem ⟨q, hq, rfl⟩ hb'
  · intro m hm i hi
    simp only [backup, List.mem_append, List.mem_singleton] at hm ⊢
    rcases hm with hm | rfl
    · obtain ⟨p, hp, hpi⟩ := wf.packs m hm i hi
      exact ⟨p, Or.inl hp, hpi⟩
    · simp only [Bucket.manifest, Bucket.named, List.mem_append, List.mem_map] at hi
      rcases hi with ⟨p, hp, rfl⟩ | ⟨p, hp, rfl⟩
      · exact ⟨p, Or.inl (kept_sub hp).1, rfl⟩
      · exact ⟨p, Or.inr hp, rfl⟩
  · intro m hm f hf
    simp only [backup, List.mem_append, List.mem_singleton] at hm ⊢
    rcases hm with hm | rfl
    · exact Or.inl (wf.files m hm f hf)
    · by_cases h : f ∈ b.files
      · exact Or.inl h
      · exact Or.inr (List.mem_filter.2 ⟨hf, by simpa using h⟩)
  · intro m hm
    simp only [backup, List.mem_append, List.mem_singleton] at hm
    rcases hm with hm | rfl
    · rw [B4_backup_keeps wf R snap fs time c hm]
      exact wf.fronts m hm
    · exact ⟨rfl, rfl⟩

theorem empty_wf : ({} : Bucket).WF := ⟨by simp, by simp, by simp, by simp⟩

/-- B1, recovery: a vault's snapshot backed up into any folder as backups leave it, then restored from the manifest
    written, is the snapshot again, each edit once, in the same order-free state: the same view, and the same edits
    stand (T11). -/
theorem B1_recovery {b : Bucket} (wf : b.WF) {edits : List Edit} (hids : (edits.map Edit.id).Nodup)
    (hid : b.Agrees edits) (v : VaultId) (fs : List FileId) (time : Nat) (c : Bool) :
    let snap := snapshot edits v
    let r := (backup b edits snap fs time c).restore (b.manifest edits snap fs time c)
    view r = view snap ∧ standing r = standing snap := by
  intro snap r
  have hs : (snap.map Edit.id).Nodup := snapshot_nodup hids v
  have hR : ∀ o ∈ snap, o ∈ edits := fun o ho => (B6_snapshot_sealed edits v ho).1
  have hr : r.Nodup := uniq_nodup _
  have hperm : r.Perm snap :=
    (List.perm_ext_iff_of_nodup hr (nodup_of_map hs)).2 (B1_restore_exact wf hR hid fs time c)
  have hrids : (r.map Edit.id).Nodup :=
    nodup_map_of_sub hr hs fun o ho => (B1_restore_exact wf hR hid fs time c o).1 ho
  exact ⟨Syncing.T11_convergence hperm hrids, Syncing.T11_same_standing hperm hrids⟩

/-! ## B2: what a backup stores is new -/

/-- B2, edits: the pack a backup adds holds only edits of the snapshot, and, when it builds on a manifest, only those
    beyond what that names (`since`): none of its loose edits, and of each log nothing at or below its frontier there,
    what sync sends. -/
theorem B2_dedup (b : Bucket) (R snap : List Edit) (c : Bool) :
    ∀ p ∈ b.added R snap c, ∀ o ∈ p.edits, o ∈ snap ∧ ∀ m, b.base snap c = some m → o ∈ since R snap m := by
  intro p hp o ho
  rw [mem_added hp] at ho
  refine ⟨news_sub ho, fun m hm => ?_⟩
  simp only [Bucket.news, hm] at ho
  exact ho

/-- B2, files: a backup stores each file once, when the folder held its files once and the backup names each once. -/
theorem B2_files_once {b : Bucket} (hb : b.files.Nodup) {fs : List FileId} (hfs : fs.Nodup) (R snap : List Edit)
    (time : Nat) (c : Bool) : (backup b R snap fs time c).files.Nodup := by
  simp only [backup]
  refine List.nodup_append.2 ⟨hb, (List.filter_sublist).nodup hfs, ?_⟩
  intro a ha a' ha' h
  subst h
  simp [List.mem_filter, ha] at ha'

/-! ## B3: every file a manifest names is in its folder -/

/-- B3: in a folder as backups leave it, every file a manifest names is there. -/
theorem B3_files {b : Bucket} (wf : b.WF) {m : Manifest} (hm : m ∈ b.manifests) {f : FileId} (hf : f ∈ m.files) :
    f ∈ b.files := wf.files m hm f hf

/-! ## B4: pruning keeps every snapshot kept -/

/-- B4, pruning: every manifest pruning keeps restores exactly as before. -/
theorem B4_prune_keeps (b : Bucket) (keep : Manifest → Bool) {m : Manifest} (hm : m ∈ b.manifests)
    (hk : keep m = true) : (prune b keep).restore m = b.restore m := by
  simp only [Bucket.restore, prune, List.filter_filter]
  congr 2
  apply List.filter_congr
  intro p _
  cases h : m.packs.contains p.id
  · simp
  · simp only [Bool.true_and]
    exact List.any_eq_true.2 ⟨m, List.mem_filter.2 ⟨hm, hk⟩, h⟩

/-- Pruning leaves a folder as backups do. -/
theorem prune_wf {b : Bucket} (wf : b.WF) (keep : Manifest → Bool) : (prune b keep).WF := by
  constructor
  · exact ((List.filter_sublist).map Pack.id).nodup wf.ids
  · intro m hm i hi
    simp only [prune] at hm ⊢
    obtain ⟨p, hp, rfl⟩ := wf.packs m (List.mem_filter.1 hm).1 i hi
    exact ⟨p, List.mem_filter.2 ⟨hp, List.any_eq_true.2 ⟨m, hm, List.contains_iff_mem.2 hi⟩⟩, rfl⟩
  · intro m hm f hf
    simp only [prune] at hm ⊢
    exact List.mem_filter.2 ⟨wf.files m (List.mem_filter.1 hm).1 f hf,
      List.any_eq_true.2 ⟨m, hm, List.contains_iff_mem.2 hf⟩⟩
  · intro m hm
    have hm' := List.mem_filter.1 hm
    rw [B4_prune_keeps b keep hm'.1 hm'.2]
    exact wf.fronts m hm'.1

/-! ## B8: a restore reads a bounded number of packs -/

/-- B8: a backup made whole when it is due (`Bucket.due`) writes a manifest that names at most `mostPacks` packs. -/
theorem B8_bounded {b : Bucket} (wf : b.WF) (R snap : List Edit) (fs : List FileId) (time : Nat) (c : Bool) :
    (b.manifest R snap fs time (c || b.due)).packs.length ≤ mostPacks := by
  have hadd : (b.added R snap (c || b.due)).length ≤ 1 := by unfold Bucket.added; split <;> simp
  simp only [Bucket.manifest, Bucket.named, List.length_append, List.length_map]
  have hkept : (b.kept snap (c || b.due)).length < mostPacks := by
    unfold Bucket.kept
    split
    · rename_i m hm
      obtain ⟨hn, -, hc⟩ := base_some hm
      have hdue : b.due = false := by simp at hc; exact hc.2
      have hlt : m.packs.length < mostPacks := by
        unfold Bucket.due at hdue; rw [hn] at hdue; simpa using hdue
      have hnd : ((b.packs.filter fun p => m.packs.contains p.id).map Pack.id).Nodup :=
        ((List.filter_sublist).map Pack.id).nodup wf.ids
      have hsub : (b.packs.filter fun p => m.packs.contains p.id).map Pack.id ⊆ m.packs := by
        intro i hi
        obtain ⟨p, hp, rfl⟩ := List.mem_map.1 hi
        exact List.contains_iff_mem.1 (List.mem_filter.1 hp).2
      have := hnd.length_le_of_subset hsub
      simp only [List.length_map] at this
      omega
    · simp [mostPacks]
  omega

/-! ## B9: a restore checks itself -/

/-- B9: what each manifest of a folder as backups leave it restores has the frontiers and the loose edits the manifest
    names: a restored node is checked log by log against its manifest. -/
theorem B9_restore_checks {b : Bucket} (wf : b.WF) {m : Manifest} (hm : m ∈ b.manifests) :
    fronts (b.restore m) = m.fronts ∧ loose (b.restore m) = m.loose :=
  ⟨(wf.fronts m hm).1.symm, (wf.fronts m hm).2.symm⟩

/-! ## B5: retention -/

/-- B5, the newest: the newest snapshot is always kept. -/
theorem B5_newest_kept (k : Keep) (now : Nat) (times : List Nat) : keeps k now times (newestOf times) = true := by
  simp [keeps]

/-- Every period of `len` seconds with a snapshot holds one that is the newest in it, taken no earlier. -/
theorem newest_in_period (times : List Nat) (len : Nat) {t : Nat} (ht : t ∈ times) :
    ∃ u ∈ times, u / len = t / len ∧ t ≤ u ∧ newestIn times len u = true := by
  let same := times.filter (· / len == t / len)
  have hne : same ≠ [] := List.ne_nil_of_mem (List.mem_filter.2 ⟨ht, by simp⟩)
  have hu := foldr_max_mem hne
  obtain ⟨hu, hul⟩ := List.mem_filter.1 hu
  have hul : same.foldr max 0 / len = t / len := beq_iff_eq.1 hul
  refine ⟨_, hu, hul, le_foldr_max (List.mem_filter.2 ⟨ht, by simp⟩), ?_⟩
  simp only [newestIn, List.all_eq_true]
  intro w hw
  by_cases hwl : w / len = t / len
  · simp only [Bool.or_eq_true, bne_iff_ne, ne_eq, decide_eq_true_eq]
    exact Or.inr (le_foldr_max (List.mem_filter.2 ⟨hw, by simp [hwl]⟩))
  · simp [hul, hwl]

/-- B5, the daily window: every day of the last `k.days` with a snapshot keeps one, taken that day. -/
theorem B5_daily (k : Keep) (now : Nat) {times : List Nat} {t : Nat} (ht : t ∈ times) (hw : now - t < k.days * day) :
    ∃ u ∈ times, u / day = t / day ∧ keeps k now times u = true := by
  obtain ⟨u, hu, hd, htu, hn⟩ := newest_in_period times day ht
  refine ⟨u, hu, hd, ?_⟩
  have : now - u < k.days * day := Nat.lt_of_le_of_lt (Nat.sub_le_sub_left htu now) hw
  simp [keeps, this, hn]

/-- B5, the weekly window: every week of the last `k.weeks` with a snapshot keeps one, taken that week. -/
theorem B5_weekly (k : Keep) (now : Nat) {times : List Nat} {t : Nat} (ht : t ∈ times) (hw : now - t < k.weeks * week) :
    ∃ u ∈ times, u / week = t / week ∧ keeps k now times u = true := by
  obtain ⟨u, hu, hd, htu, hn⟩ := newest_in_period times week ht
  refine ⟨u, hu, hd, ?_⟩
  have : now - u < k.weeks * week := Nat.lt_of_le_of_lt (Nat.sub_le_sub_left htu now) hw
  simp [keeps, this, hn]

/-- B5, for ever: every month with a snapshot keeps one, taken that month. -/
theorem B5_monthly (k : Keep) (now : Nat) {times : List Nat} {t : Nat} (ht : t ∈ times) :
    ∃ u ∈ times, u / month = t / month ∧ keeps k now times u = true := by
  obtain ⟨u, hu, hd, _, hn⟩ := newest_in_period times month ht
  exact ⟨u, hu, hd, by simp [keeps, hn]⟩

/-- B4 with B5: retention at any moment keeps the newest snapshot restoring exactly as before. -/
theorem B4_retain_newest (b : Bucket) (k : Keep) (now : Nat) {m : Manifest} (hm : m ∈ b.manifests)
    (hn : m.time = newestOf (b.manifests.map (·.time))) : (b.retain k now).restore m = b.restore m :=
  B4_prune_keeps b _ hm (by rw [hn]; exact B5_newest_kept k now _)

end Backup
end AvenDB
