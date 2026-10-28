import AvenDB.Gate

/-!
# What the server backs up for each person

The server of `home` (avenMAIA's device, serving Maia City) keeps a copy of what the vaults give it a backup share on:
their edits and the files those bring. It keeps every edit, as they are small and every device needs them, but it keeps
the files of each person only up to a limit, by the cap group of `home` they hold (`Limits`, `limitOf`): a Traveler's
and a Citizen's, as Maia City sets them (`AVENDB_BACKUP_LIMITS`). An admin of `home` (`isAdmin`: `home` itself, a vault
that owns it, or one holding its Admin group) has no limit, and where no limit is said nobody has one. A person who
holds none of the groups that have a limit takes the least of them, so a share revoked never lifts their limit.

A person's backup is what the server keeps that their devices brought (`Brought`): each edit and each file, by the device
that signed the edit bringing it, counted against the person of the vault that device acts for (`payer`): a human
vault for itself, and any other for the person of its one owner vault, up the chain, as a person's agents' device vault
is theirs. A vault of several owners, or a signer that is no device, counts against nobody.

The server takes the items in the order they come (`keepAll`): an edit always, a file where its person has no limit or
the bytes it already keeps for them, with the file's, are within it (`keepsItem`). Q1: nothing it kept is dropped.
Q2: every edit is kept. Q3: the files it keeps for a person never take them past their limit. Q4: a file of a person
with no limit is kept. Q5: what it tells a device of a person's backup is of that device's own person alone.
-/

namespace AvenDB

/-- The most bytes the server of `home` keeps for a person, by the name of a cap group of `home` they hold. -/
abbrev Limits := List (String × Nat)

/-- The person whose backup vault `v`'s bytes count against: `v` itself for a human vault; for any other, the person of
    its one owner vault, up the chain; none for a vault of several owners or one a signer owns. `n` bounds the chain. -/
def payerN (st : State) : Nat → VaultId → Option VaultId
  | 0, _ => none
  | n + 1, v =>
    match st.vault? v with
    | none => none
    | some vt =>
      match vt.kind, vt.owners with
      | .human, _ => some v
      | _, [.vault o] => payerN st n o
      | _, _ => none

def payer (st : State) (v : VaultId) : Option VaultId := payerN st st.depth v

/-- The person what device `d` signs counts against: the person of the vault it is a device of (`deviceVault`). -/
def payerOf (st : State) (d : SignerId) : Option VaultId := (deviceVault st d).bind (payer st)

/-- The least of some limits, `m` among them. -/
def least (m : Nat) (ls : Limits) : Nat := ls.foldl (fun a g => min a g.2) m

/-- The most bytes the server of `home` keeps for person `u` by limits `ls`: none, no limit, where no limit is said
    and for an admin of `home`; else the largest limit of the groups `u` holds, and holding none of them, the least. -/
def limitOf (st : State) (home u : VaultId) (ls : Limits) : Option Nat :=
  match ls with
  | [] => none
  | l :: rest =>
    if isAdmin st home u then none
    else match ((l :: rest).filter fun g => holdsGroup st home u g.1).map (·.2) with
      | [] => some (least l.2 rest)
      | n :: ns => some (ns.foldl max n)

/-- What the server keeps, or is offered: an edit or a file (`file`), of `size` bytes, brought by an edit device
    `signer` signed. -/
structure Brought where
  signer : SignerId
  size   : Nat
  file   : Bool
  deriving DecidableEq, Repr

/-- The bytes of `kept` that count against person `p`. -/
def used (st : State) (p : VaultId) (kept : List Brought) : Nat :=
  ((kept.filter fun i => payerOf st i.signer == some p).map (·.size)).sum

/-- The server of `home`, holding `kept`, keeps item `i`: an edit always; a file where its person has no limit, or the
    bytes it keeps for them with the file's are within it. -/
def keepsItem (st : State) (home : VaultId) (ls : Limits) (kept : List Brought) (i : Brought) : Bool :=
  !i.file ||
    match payerOf st i.signer with
    | none => true
    | some p =>
      match limitOf st home p ls with
      | none => true
      | some l => used st p kept + i.size ≤ l

/-- What the server of `home` holds once it took `items` in order, holding `kept`: each it keeps added after it. -/
def keepAll (st : State) (home : VaultId) (ls : Limits) : List Brought → List Brought → List Brought
  | kept, [] => kept
  | kept, i :: is => keepAll st home ls (if keepsItem st home ls kept i then kept ++ [i] else kept) is

/-- The service a device's pass names to ask the server about its person's backup (`world::BACKUP_AUDIENCE`). -/
def backupAudience : String := "avenDB backup"

/-- What the server of `home` answers pass `p` asking at `now` about its backup: the person of the vault its device
    is a device of, and their limit, where the pass counts for `backupAudience`; nothing otherwise
    (`world::backup_standing`). -/
def backupOf (st : State) (home : VaultId) (ls : Limits) (now : Nat) (p : ApiPass) : Option (VaultId × Option Nat) :=
  match passStanding st home backupAudience now p with
  | some (v, _) => (payer st v).map fun u => (u, limitOf st home u ls)
  | none => none

namespace Quota

theorem used_append (st : State) (p : VaultId) (kept : List Brought) (i : Brought) :
    used st p (kept ++ [i]) = used st p kept + if payerOf st i.signer == some p then i.size else 0 := by
  unfold used
  rw [List.filter_append, List.map_append, List.sum_append]
  by_cases h : payerOf st i.signer = some p <;> simp [h]

/-- Q1 (nothing kept is dropped): what the server held before it took a run of items, it holds after it, in order. -/
theorem keepAll_prefix (st : State) (home : VaultId) (ls : Limits) :
    ∀ (items kept : List Brought), kept <+: keepAll st home ls kept items
  | [], kept => List.prefix_refl kept
  | i :: is, kept => by
    simp only [keepAll]
    split
    · exact (List.prefix_append kept [i]).trans (keepAll_prefix st home ls is _)
    · exact keepAll_prefix st home ls is kept

/-- An item the server keeps whatever it holds, it keeps when it comes. -/
theorem keepAll_mem {st : State} {home : VaultId} {ls : Limits} {i : Brought} (h : ∀ k, keepsItem st home ls k i = true) :
    ∀ (items kept : List Brought), i ∈ items → i ∈ keepAll st home ls kept items
  | [], _, hi => by simp at hi
  | j :: js, kept, hi => by
    simp only [keepAll]
    rcases List.mem_cons.1 hi with rfl | hj
    · simp only [h kept, ↓reduceIte]
      exact (keepAll_prefix st home ls js _).subset (List.mem_append_right _ (List.mem_singleton_self _))
    · exact keepAll_mem h js _ hj

/-- Q2 (every edit is kept): an edit among the items the server takes is among what it holds after them. -/
theorem keepAll_edit {st : State} {home : VaultId} {ls : Limits} {i : Brought} {items kept : List Brought}
    (hi : i ∈ items) (he : i.file = false) : i ∈ keepAll st home ls kept items :=
  keepAll_mem (fun _ => by simp [keepsItem, he]) items kept hi

/-- Q3, one file: a file the server keeps for a person with a limit fits within it, with what it kept for them. -/
theorem keeps_fits {st : State} {home : VaultId} {ls : Limits} {kept : List Brought} {i : Brought} {p : VaultId} {l : Nat}
    (hk : keepsItem st home ls kept i = true) (hf : i.file = true) (hp : payerOf st i.signer = some p)
    (hl : limitOf st home p ls = some l) : used st p kept + i.size ≤ l := by
  simpa [keepsItem, hf, hp, hl] using hk

/-- Q3 (within the limit): from a backup within a person's limit, the files the server takes keep it within it. -/
theorem keepAll_within {st : State} {home : VaultId} {ls : Limits} {p : VaultId} {l : Nat}
    (hl : limitOf st home p ls = some l) :
    ∀ (items kept : List Brought), (∀ i ∈ items, i.file = true) → used st p kept ≤ l →
      used st p (keepAll st home ls kept items) ≤ l
  | [], _, _, h => h
  | i :: is, kept, hf, h => by
    simp only [keepAll]
    apply keepAll_within hl is _ (fun j hj => hf j (List.mem_cons_of_mem _ hj))
    split
    · rename_i hk
      rw [used_append]
      by_cases hp : payerOf st i.signer = some p
      · have := keeps_fits hk (hf i (List.mem_cons_self ..)) hp hl
        simp [hp]
        omega
      · simp [hp]
        exact h
    · exact h

/-- Q4 (no limit, no refusal): a file of a person with no limit, or of nobody, is kept when it comes. -/
theorem keepAll_unlimited {st : State} {home : VaultId} {ls : Limits} {i : Brought} {items kept : List Brought}
    (hi : i ∈ items) (hn : (payerOf st i.signer).bind (fun p => limitOf st home p ls) = none) :
    i ∈ keepAll st home ls kept items := by
  refine keepAll_mem (fun k => ?_) items kept hi
  unfold keepsItem
  cases hp : payerOf st i.signer with
  | none => simp
  | some p =>
    rw [hp] at hn
    simp only [Option.bind_some] at hn
    simp [hn]

/-- An admin of `home` has no limit (Maia City's owners and the holders of its Admin group). -/
theorem admin_unlimited {st : State} {home u : VaultId} {ls : Limits} (h : isAdmin st home u = true) :
    limitOf st home u ls = none := by
  unfold limitOf
  split
  · rfl
  · simp [h]

/-- Q5 (its own person alone): where the server answers a pass about a backup, the pass's device is a device of a
    vault whose bytes count against the person it names. -/
theorem backup_own {st : State} {home u : VaultId} {ls : Limits} {now : Nat} {p : ApiPass} {l : Option Nat}
    (h : backupOf st home ls now p = some (u, l)) : ∃ v, isDevice st p.device v = true ∧ payer st v = some u := by
  unfold backupOf at h
  split at h
  · rename_i v b hs
    cases hv : payer st v with
    | none => simp [hv] at h
    | some w =>
      simp only [hv, Option.map_some, Option.some.injEq, Prod.mk.injEq] at h
      exact ⟨v, Gating.standing_device hs, h.1 ▸ hv⟩
  · simp at h

end Quota

end AvenDB
