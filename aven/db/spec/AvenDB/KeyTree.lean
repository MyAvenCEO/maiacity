import AvenDB.State

/-!
# Key trees

The proof of V6, the key trees of M7 of the master plan. An audience's key boxed to each of its member devices costs a
box per device on every removal: a removal from a million members, a million boxes. A key tree, in the style of MLS
TreeKEM (RFC 9420), costs about one box per level instead. Its leaves are the member devices, each with its own key;
each inner node holds secrets that only devices below it open; and the audience key of an epoch is derived from the
root. A change of keys (a commit) writes new secrets along its author's path, each derived from the one below it, and
seals each to the keys of the other side of the path (its copath), so every member below the node opens it.

Devices change keys apart, so two commits can each write the same node without having seen the other. As in Keyhive's
BeeKEM, both secrets stay on the node (`current`) until a commit that saw them replaces them, and a sender seals to
both. The order every peer applies the changes in is the replay order of the view, so every peer builds the same tree.

Safety comes from two rules, not from the shape of the tree:

- A commit counts only if it seals each secret to keys that only members open (`clean`): its author's view may be
  older than the tree it lands in, and a key a removed device opens is no longer one to seal to. The tree knows who
  opens each secret (`knowers`), as MLS knows its unmerged leaves: the author and whoever opens a key it was sealed to.
- A member the commit's seals miss (one that joined meanwhile) gets the epoch key boxed to its own key (a fill).

So every member opens every key of the current epoch (`members_open`), and a removed device opens no epoch key after
its removal, whatever it opened before (`removed_shut`). The tree is what keeps it cheap: a commit drafted on the
tree as it stands (`draft`) counts, and its seals alone reach every member, with no fill (`draft_reaches_all`).

An epoch starts at each removal, and at each new member that may not read the past. A removal's epoch seals the epoch
before under each of its keys, so whoever reads now reads the history (`history_kept`); a member added without the past
opens no key from before it joined (`no_history_shut`). Members keep the keys they opened.

The keys are named by the change that made them, its place in the replay order (`now`): `.node n c` is the secret
change `c` wrote on the node at `n`, and `.epoch g c` the key of epoch `g` change `c` derived from its root.
-/

namespace AvenDB.Trees

/-! ## The tree -/

/-- A place in an audience's key tree: the turns from its root down, `false` to the left and `true` to the right. A
    leaf's place is as long as the tree is high, an inner node's shorter, the root's empty. A tree grows by a new root
    over its old one; the Rust tree names each node by its height and index, which growth leaves as they are. -/
abbrev Place := List Bool

/-- A key of the tree: device `d`'s own key at its leaf; the secret change `c` wrote on the node at `n`; the key of
    epoch `g` that change `c` derived from its root. -/
inductive TKey where
  | leaf  (d : SignerId)
  | node  (n : Place) (c : Nat)
  | epoch (g : Nat) (c : Nat)
  deriving DecidableEq, Repr

/-- What a holder of the keys `start` opens, given seals each of a secret and the key it is sealed to or derived from:
    its own keys, and whatever is sealed to a key it opens. This is `Knows` for keys of any kind (`knows_iff_reach`), the
    spec's one assumption about encryption: a seal opens only with its key, and nothing is learned any other way. -/
inductive Reach {α : Type} (seals : List (α × α)) (start : α → Prop) : α → Prop where
  | own {k : α} : start k → Reach seals start k
  | unseal {s t : α} : (s, t) ∈ seals → Reach seals start t → Reach seals start s

/-- A member device and the place of its leaf. -/
structure Member where
  dev   : SignerId
  place : Place
  deriving DecidableEq, Repr

/-- A change of the tree, in the replay order: device `d` joins at the leaf at `p`, opening the keys of the epoch it
    joins and, through them, the epochs before if the audience gives it the past (`history`), else in an epoch of its
    own; device `d` leaves; or device `author` commits: new secrets along its path, each sealed to the keys `to` names
    for its node (a node on the path and a key), the secrets `saw` of its path replaced. -/
inductive Change where
  | add (d : SignerId) (p : Place) (history : Bool)
  | remove (d : SignerId)
  | commit (author : SignerId) (to : List (Place × TKey)) (saw : List Nat)
  deriving DecidableEq, Repr

/-- A key tree as every peer builds it from the changes in the replay order. -/
structure Tree where
  height  : Nat
  members : List Member
  /-- The commits whose secrets each node holds now: more than one where commits made apart both wrote it. -/
  current : Place → List Nat
  /-- Every commit that wrote each node, its secret current or not. -/
  written : Place → List Nat
  /-- Who opens the secret each commit wrote on each node: its author, and whoever opens a key it was sealed to. -/
  knowers : Place → Nat → List SignerId
  epoch   : Nat
  /-- The commits whose keys each epoch has: more than one where commits made apart both started it. -/
  keys    : Nat → List Nat
  /-- Whether each epoch's keys seal the keys of the epoch before: a removal's do, a new member's without the past
      don't. -/
  chains  : Nat → Bool
  /-- Every seal and derivation: the secret, and the key it is sealed to or derived from. -/
  seals   : List (TKey × TKey)
  /-- The changes applied so far: the next is change `now`. -/
  now     : Nat

/-- A tree `h` levels high, with no member yet. -/
def Tree.empty (h : Nat) : Tree :=
  { height := h, members := [], current := fun _ => [], written := fun _ => [], knowers := fun _ _ => [],
    epoch := 0, keys := fun _ => [], chains := fun _ => false, seals := [], now := 0 }

namespace Tree

def isMember (st : Tree) (d : SignerId) : Bool := st.members.any (·.dev == d)

/-- The place of member `d`'s leaf. -/
def placeOf (st : Tree) (d : SignerId) : Option Place := (st.members.find? (·.dev == d)).map (·.place)

/-- Member `d`'s leaf is below the node at `m`. -/
def under (st : Tree) (m : Place) (d : SignerId) : Bool := st.members.any fun x => x.dev == d && m.isPrefixOf x.place

/-- Who opens key `t`: a leaf's device, a node secret's knowers. Nobody is sealed an epoch key to. -/
def knowersOf (st : Tree) : TKey → List SignerId
  | .leaf d => [d]
  | .node q c => st.knowers q c
  | .epoch _ _ => []

/-- A key only members open: a member's own, or a secret a commit that counted wrote, which no device that left
    opens. -/
def clean (st : Tree) : TKey → Bool
  | .leaf d => st.isMember d
  | .node q c => (st.written q).contains c && (st.knowers q c).all st.isMember
  | .epoch _ _ => false

end Tree

/-- The child of the node at `n` off the path to the leaf at `p`: the other side of the path there. -/
def copath (p n : Place) : Place := n ++ [!(p.getD n.length false)]

/-- The key a commit `c` by `u`, whose leaf is at `p`, has `k` turns down its path: the secret it writes on the node
    there, and at the bottom its author's own key. -/
def pathKey (u : SignerId) (p : Place) (c k : Nat) : TKey := if k < p.length then .node (p.take k) c else .leaf u

namespace Tree

/-- A seal a commit from the leaf at `p` may make: of the secret of a node on its path, to a clean key below the
    node's other child. -/
def targetOk (st : Tree) (p : Place) (nt : Place × TKey) : Bool :=
  decide (nt.1.length < p.length) && nt.1.isPrefixOf p && st.clean nt.2 &&
    match nt.2 with
    | .leaf d => st.under (copath p nt.1) d
    | .node q _ => (copath p nt.1).isPrefixOf q
    | .epoch _ _ => false

/-- Who opens the secret a commit by `u` sealing to `to` writes `k` turns down its path: its author, and whoever opens a
    key it sealed a secret at or below it to, as each secret is derived from the one below it. -/
def newKnowers (st : Tree) (u : SignerId) (to : List (Place × TKey)) (k : Nat) : List SignerId :=
  u :: (to.filter fun nt => decide (k ≤ nt.1.length)).flatMap fun nt => st.knowersOf nt.2

/-- The seals of commit `c` by `u` from the leaf at `p`, sealing to `to`: each secret on its path derived from the one
    below it, the author's key at the bottom; each sealed to its keys of the other side; the epoch's new key derived
    from the root; where the epoch keeps the history, each key of the epoch before sealed under it; and the new key
    boxed to each member none of the seals reach. -/
def commitSeals (st : Tree) (u : SignerId) (p : Place) (to : List (Place × TKey)) (c : Nat) : List (TKey × TKey) :=
  (List.range p.length).map (fun k => (pathKey u p c k, pathKey u p c (k + 1))) ++
  to.map (fun nt => (.node nt.1 c, nt.2)) ++
  [(.epoch st.epoch c, pathKey u p c 0)] ++
  (if st.chains st.epoch then (st.keys (st.epoch - 1)).map fun c' => (.epoch (st.epoch - 1) c', .epoch st.epoch c)
   else []) ++
  (st.members.filter fun x => !(st.newKnowers u to 0).contains x.dev).map fun x => (.epoch st.epoch c, .leaf x.dev)

/-- The node at `q` is on the path of the leaf at `p`, above it. -/
def onPath (p q : Place) : Bool := q.isPrefixOf p && decide (q.length < p.length)

/-- Commit `now` by member `u` from the leaf at `p`, sealing to `to` and replacing the secrets `saw`, as it counts: each
    node on its path holds the new secret beside those it didn't see, opened by the new knowers. -/
def landed (st : Tree) (u : SignerId) (p : Place) (to : List (Place × TKey)) (saw : List Nat) : Tree :=
  { st with
    current := fun q => if onPath p q then st.now :: (st.current q).filter (fun x => !saw.contains x) else st.current q
    written := fun q => if onPath p q then st.now :: st.written q else st.written q
    knowers := fun q x => if onPath p q = true ∧ x = st.now then st.newKnowers u to q.length else st.knowers q x
    keys := fun g => if g = st.epoch then st.keys g ++ [st.now] else st.keys g
    seals := st.seals ++ st.commitSeals u p to st.now }

/-- Member `u` commits, sealing to `to` and replacing the secrets `saw`: it counts only if every seal is one it may
    make, else nothing changes. -/
def commit (st : Tree) (u : SignerId) (to : List (Place × TKey)) (saw : List Nat) : Tree :=
  match st.placeOf u with
  | none => st
  | some p => if to.all (st.targetOk p) then st.landed u p to saw else st

/-- Device `d` joins at the leaf at `p`: with the past, the keys of the epoch now are boxed to it; without, a new epoch
    starts that keeps no history. -/
def joined (st : Tree) (d : SignerId) (p : Place) (history : Bool) : Tree :=
  if history then
    { st with members := st.members ++ [⟨d, p⟩],
              seals := st.seals ++ (st.keys st.epoch).map fun c => (.epoch st.epoch c, .leaf d) }
  else
    { st with members := st.members ++ [⟨d, p⟩], epoch := st.epoch + 1,
              chains := fun g => if g = st.epoch + 1 then false else st.chains g }

/-- Device `d` joins at the leaf at `p`, if it is a free leaf of the tree and `d` no member yet. -/
def add (st : Tree) (d : SignerId) (p : Place) (history : Bool) : Tree :=
  if p.length = st.height ∧ st.isMember d = false ∧ st.members.any (·.place == p) = false then st.joined d p history
  else st

/-- Member `d` leaves: no secret it opens is one to seal to any more, and a new epoch starts that keeps the history. -/
def left (st : Tree) (d : SignerId) : Tree :=
  { st with members := st.members.filter (·.dev != d),
            current := fun q => (st.current q).filter fun c => !(st.knowers q c).contains d,
            epoch := st.epoch + 1,
            chains := fun g => if g = st.epoch + 1 then true else st.chains g }

def remove (st : Tree) (d : SignerId) : Tree := if st.isMember d then st.left d else st

/-- One change, in the replay order. -/
def step (st : Tree) : Change → Tree
  | .add d p h => { st.add d p h with now := st.now + 1 }
  | .remove d => { st.remove d with now := st.now + 1 }
  | .commit u to saw => { st.commit u to saw with now := st.now + 1 }

/-! ## An honest commit -/

/-- The keys that reach every member below the node at `m`, `k` levels above the leaves: the node's secrets and the key
    of each member below it that opens none of them; through a node with no secret, its children's; at a leaf, its
    device's key. -/
def resolution (st : Tree) : Nat → Place → List TKey
  | 0, m => (st.members.filter fun x => x.place == m).map fun x => .leaf x.dev
  | k + 1, m =>
    if st.current m = [] then st.resolution k (m ++ [false]) ++ st.resolution k (m ++ [true])
    else (st.current m).map (.node m) ++
      (st.members.filter fun x => m.isPrefixOf x.place && (st.current m).all fun c => !(st.knowers m c).contains x.dev).map
        fun x => .leaf x.dev

/-- What member `u`, whose leaf is at `p`, seals its path to on the tree as it stands: each secret to the resolution of
    the node's other child. -/
def draftTo (st : Tree) (p : Place) : List (Place × TKey) :=
  (List.range p.length).flatMap fun j => (st.resolution (st.height - (j + 1)) (copath p (p.take j))).map fun t => (p.take j, t)

/-- The commit member `u` drafts on the tree as it stands: every secret of its path replaced. -/
def draft (st : Tree) (u : SignerId) : Change :=
  match st.placeOf u with
  | none => .commit u [] []
  | some p => .commit u (st.draftTo p) ((List.range p.length).flatMap fun j => st.current (p.take j))

end Tree

/-- The tree `h` levels high after the changes `cs`, in the replay order. -/
def run (h : Nat) (cs : List Change) : Tree := cs.foldl Tree.step (Tree.empty h)

/-- A device's own key: all it starts out holding. -/
def own (d : SignerId) : TKey → Prop := fun k => k = .leaf d

/-! ## Examples

A tree two levels high, four leaves: Ann and Bob on the left, Cat and Dan on the right. `opens` is the closure of what
a device opens, by rounds; what it finds, the device reaches (`opens_reach`). -/

/-- What the keys `known` open in `n` rounds over the seals. -/
def opens (seals : List (TKey × TKey)) : Nat → List TKey → List TKey
  | 0, known => known
  | n + 1, known => opens seals n (known ++ (seals.filter fun s => known.contains s.2).map (·.1))

namespace Examples

def ann : SignerId := 1
def bob : SignerId := 2
def cat : SignerId := 3
def dan : SignerId := 4
def eve : SignerId := 5

def trio : List Change :=
  [.add ann [false, false] true, .add bob [false, true] true, .add cat [true, false] true]

/-- Ann commits on the tree of three: the first epoch's first key. -/
def first : List Change := trio ++ [(run 2 trio).draft ann]

/-- Cat leaves; Bob commits on the tree as he sees it, which starts epoch 1. -/
def second : List Change := first ++ [.remove cat] ++ [(run 2 (first ++ [.remove cat])).draft bob]

def canOpen (cs : List Change) (d : SignerId) (k : TKey) : Bool :=
  (opens (run 2 cs).seals 12 [.leaf d]).contains k

-- Ann's draft seals her path's two secrets: the bottom one to Bob's leaf, the root to Cat's leaf (the right child has
-- no secret yet): two boxes for three members
#guard (run 2 trio).draft ann ==
  .commit ann [([], .leaf cat), ([false], .leaf bob)] []
#guard (run 2 first).keys 0 == [3]
#guard [ann, bob, cat].all fun d => canOpen first d (.epoch 0 3)
-- Dan joins with the past: one box of the epoch's key to his own
#guard canOpen (first ++ [.add dan [true, true] true]) dan (.epoch 0 3)
-- Cat leaves, epoch 1 starts; Bob's commit reaches Ann through the node they share and nobody else needs one
#guard (run 2 second).epoch == 1
#guard (run 2 second).keys 1 == [5]
#guard [ann, bob].all fun d => canOpen second d (.epoch 1 5)
#guard !canOpen second cat (.epoch 1 5)
-- the new epoch's key seals the old one: history stays readable
#guard canOpen second ann (.epoch 0 3)
-- a commit drafted before Cat left, landing after it, seals to Cat's leaf: it doesn't count
#guard (run 2 (first ++ [.remove cat] ++ [(run 2 first).draft bob])).keys 1 == []
-- two commits drafted apart on the same tree both count, and the root holds both secrets
def apart : List Change := first ++ [(run 2 first).draft ann, (run 2 first).draft bob]
#guard (run 2 apart).keys 0 == [3, 4, 5]
#guard (run 2 apart).current [] == [5, 4]
#guard [ann, bob, cat].all fun d => canOpen apart d (.epoch 0 4) && canOpen apart d (.epoch 0 5)
-- Eve joins without the past: a new epoch, which a commit gives her, but not the one before
def fresh : List Change := first ++ [.add eve [true, true] false]
def freshly : List Change := fresh ++ [(run 2 fresh).draft ann]
#guard (run 2 freshly).epoch == 1
#guard [ann, bob, cat, eve].all fun d => canOpen freshly d (.epoch 1 5)
#guard !canOpen freshly eve (.epoch 0 3)

-- eight members on a tree three high, each of whom has committed once
def leafAt (i : Nat) : Place := [i / 4 % 2 == 1, i / 2 % 2 == 1, i % 2 == 1]
def eight : List Change := (List.range 8).map fun i => .add (i + 10) (leafAt i) true
def filled : List Change := (List.range 8).foldl (fun cs i => cs ++ [(run 3 cs).draft (i + 10)]) eight
def canOpen3 (cs : List Change) (d : SignerId) (k : TKey) : Bool :=
  (opens (run 3 cs).seals 20 [.leaf d]).contains k
def sealsOf : Change → Nat
  | .commit _ to _ => to.length
  | _ => 0
-- a commit now seals three boxes, one a level, where boxing the key to each other member would take seven
#guard sealsOf ((run 3 filled).draft 10) == 3
-- after a removal, the node the removed device opened is passed by: four boxes, and the removed device opens nothing new
def without : List Change := filled ++ [.remove 17]
def rekeyed : List Change := without ++ [(run 3 without).draft 10]
#guard sealsOf ((run 3 without).draft 10) == 4
#guard (List.range 7).all fun i => canOpen3 rekeyed (i + 10) (.epoch 1 ((run 3 without).now))
#guard !canOpen3 rekeyed 17 (.epoch 1 ((run 3 without).now))

end Examples

/-! ## Reaching keys -/

/-- `Knows` is `Reach` over a state's seals, from the keys held and the published ones. -/
theorem knows_iff_reach {st : State} {start : List KeyName} {k : KeyName} :
    Knows st start k ↔ Reach (st.seals.map fun s => (s.secret, s.to)) (fun k => k ∈ start ∨ k ∈ st.published) k := by
  constructor
  · intro h
    induction h with
    | own h => exact .own (.inl h)
    | published h => exact .own (.inr h)
    | «unseal» hs _ ih => exact .unseal (List.mem_map.2 ⟨_, hs, rfl⟩) ih
  · intro h
    induction h with
    | own h =>
      rcases h with h | h
      · exact .own h
      · exact .published h
    | «unseal» hs _ ih =>
      obtain ⟨x, hx, he⟩ := List.mem_map.1 hs
      simp only [Prod.mk.injEq] at he
      obtain ⟨rfl, rfl⟩ := he
      exact .unseal hx ih

/-- More seals open no less. -/
theorem Reach.mono {α : Type} {seals seals' : List (α × α)} {start : α → Prop} (hs : ∀ x ∈ seals, x ∈ seals')
    {k : α} (h : Reach seals start k) : Reach seals' start k := by
  induction h with
  | own h => exact .own h
  | «unseal» hm _ ih => exact .unseal (hs _ hm) ih

/-- What `opens` finds, the device reaches. -/
theorem opens_reach {seals : List (TKey × TKey)} {start : TKey → Prop} :
    ∀ (n : Nat) (known : List TKey), (∀ k ∈ known, Reach seals start k) → ∀ k ∈ opens seals n known,
      Reach seals start k
  | 0, _, h, k, hk => h k hk
  | n + 1, known, h, k, hk => by
    refine opens_reach n _ (fun k hk => ?_) k hk
    rcases List.mem_append.1 hk with hk | hk
    · exact h k hk
    · obtain ⟨s, hs, rfl⟩ := List.mem_map.1 hk
      obtain ⟨hs, hc⟩ := List.mem_filter.1 hs
      exact .unseal hs (h _ (List.contains_iff_mem.1 hc))

/-! ## The steps -/

namespace Tree

theorem isMember_iff {st : Tree} {d : SignerId} : st.isMember d = true ↔ ∃ x ∈ st.members, x.dev = d := by
  simp [isMember, List.any_eq_true]

theorem placeOf_some {st : Tree} {u : SignerId} {p : Place} (h : st.placeOf u = some p) :
    ∃ x ∈ st.members, x.dev = u ∧ x.place = p := by
  unfold placeOf at h
  cases hf : st.members.find? (·.dev == u) with
  | none => simp [hf] at h
  | some x =>
    simp only [hf, Option.map_some, Option.some.injEq] at h
    exact ⟨x, List.mem_of_find?_eq_some hf, by simpa using List.find?_some hf, h⟩

theorem placeOf_member {st : Tree} {u : SignerId} (h : st.isMember u = true) : ∃ p, st.placeOf u = some p := by
  unfold placeOf
  cases hf : st.members.find? (·.dev == u) with
  | none =>
    obtain ⟨x, hx, rfl⟩ := isMember_iff.1 h
    have := List.find?_eq_none.1 hf x hx
    simp at this
  | some x => exact ⟨x.place, rfl⟩

theorem member_of_placeOf {st : Tree} {u : SignerId} {p : Place} (h : st.placeOf u = some p) :
    st.isMember u = true := by
  obtain ⟨x, hx, hu, -⟩ := placeOf_some h
  exact isMember_iff.2 ⟨x, hx, hu⟩

theorem commit_cases (st : Tree) (u : SignerId) (to : List (Place × TKey)) (saw : List Nat) :
    st.commit u to saw = st ∨
      ∃ p, st.placeOf u = some p ∧ to.all (st.targetOk p) = true ∧ st.commit u to saw = st.landed u p to saw := by
  unfold commit
  split
  · exact .inl rfl
  · rename_i p hp
    split
    · exact .inr ⟨p, hp, by assumption, rfl⟩
    · exact .inl rfl

theorem add_cases (st : Tree) (d : SignerId) (p : Place) (hist : Bool) :
    st.add d p hist = st ∨
      (p.length = st.height ∧ st.isMember d = false ∧ st.members.any (·.place == p) = false ∧
        st.add d p hist = st.joined d p hist) := by
  unfold add
  split
  · rename_i h; exact .inr ⟨h.1, h.2.1, h.2.2, rfl⟩
  · exact .inl rfl

theorem remove_cases (st : Tree) (d : SignerId) :
    st.remove d = st ∨ (st.isMember d = true ∧ st.remove d = st.left d) := by
  unfold remove
  split
  · rename_i h; exact .inr ⟨h, rfl⟩
  · exact .inl rfl

theorem landed_current {st : Tree} {u p to saw q} : (st.landed u p to saw).current q =
    if onPath p q then st.now :: (st.current q).filter (fun x => !saw.contains x) else st.current q := rfl
theorem landed_written {st : Tree} {u p to saw q} : (st.landed u p to saw).written q =
    if onPath p q then st.now :: st.written q else st.written q := rfl
theorem landed_knowers {st : Tree} {u p to saw q x} : (st.landed u p to saw).knowers q x =
    if onPath p q = true ∧ x = st.now then st.newKnowers u to q.length else st.knowers q x := rfl
theorem landed_keys {st : Tree} {u p to saw g} : (st.landed u p to saw).keys g =
    if g = st.epoch then st.keys g ++ [st.now] else st.keys g := rfl
theorem landed_seals {st : Tree} {u p to saw} : (st.landed u p to saw).seals = st.seals ++ st.commitSeals u p to st.now :=
  rfl
theorem landed_chains {st : Tree} {u p to saw} : (st.landed u p to saw).chains = st.chains := rfl
theorem landed_epoch {st : Tree} {u p to saw} : (st.landed u p to saw).epoch = st.epoch := rfl
theorem landed_members {st : Tree} {u p to saw} : (st.landed u p to saw).members = st.members := rfl
theorem landed_isMember {st : Tree} {u p to saw} : (st.landed u p to saw).isMember = st.isMember := rfl

theorem onPath_take {p : Place} {j : Nat} (hj : j < p.length) : onPath p (p.take j) = true := by
  simp [onPath, List.isPrefixOf_iff_prefix, List.take_prefix, List.length_take, Nat.min_eq_left (Nat.le_of_lt hj), hj]

theorem onPath_iff {p q : Place} : onPath p q = true ↔ q <+: p ∧ q.length < p.length := by
  simp [onPath, List.isPrefixOf_iff_prefix]

/-- A node on the path is the path cut at its depth. -/
theorem take_of_onPath {p q : Place} (h : onPath p q = true) : p.take q.length = q :=
  (List.prefix_iff_eq_take.1 (onPath_iff.1 h).1).symm

theorem pathKey_lt {u : SignerId} {p : Place} {c k : Nat} (hk : k < p.length) :
    pathKey u p c k = .node (p.take k) c := by
  simp [pathKey, hk]

theorem pathKey_ge {u : SignerId} {p : Place} {c k : Nat} (hk : p.length ≤ k) : pathKey u p c k = .leaf u := by
  simp [pathKey, Nat.not_lt.2 hk]

/-- Whoever opens a secret down the path opens every secret above it. -/
theorem path_up {seals : List (TKey × TKey)} {u : SignerId} {p : Place} {c : Nat} {S : TKey → Prop}
    (hd : ∀ k < p.length, (pathKey u p c k, pathKey u p c (k + 1)) ∈ seals) :
    ∀ d k, k + d ≤ p.length → Reach seals S (pathKey u p c (k + d)) → Reach seals S (pathKey u p c k) := by
  intro d
  induction d with
  | zero => intro k _ h; simpa using h
  | succ d ih =>
    intro k hk h
    have h1 : Reach seals S (pathKey u p c (k + 1)) :=
      ih (k + 1) (by omega) (by rwa [show k + 1 + d = k + (d + 1) by omega])
    exact .unseal (hd k (by omega)) h1

theorem derive_mem (st : Tree) (u : SignerId) (p : Place) (to : List (Place × TKey)) (c : Nat) {k : Nat}
    (hk : k < p.length) : (pathKey u p c k, pathKey u p c (k + 1)) ∈ st.commitSeals u p to c := by
  unfold commitSeals
  simp only [List.mem_append]
  exact .inl (.inl (.inl (.inl (List.mem_map.2 ⟨k, List.mem_range.2 hk, rfl⟩))))

theorem copath_mem (st : Tree) (u : SignerId) (p : Place) {to : List (Place × TKey)} (c : Nat) {nt : Place × TKey}
    (h : nt ∈ to) : (TKey.node nt.1 c, nt.2) ∈ st.commitSeals u p to c := by
  unfold commitSeals
  simp only [List.mem_append]
  exact .inl (.inl (.inl (.inr (List.mem_map.2 ⟨nt, h, rfl⟩))))

theorem root_mem (st : Tree) (u : SignerId) (p : Place) (to : List (Place × TKey)) (c : Nat) :
    (TKey.epoch st.epoch c, pathKey u p c 0) ∈ st.commitSeals u p to c := by
  unfold commitSeals
  simp

theorem fill_mem (st : Tree) (u : SignerId) (p : Place) (to : List (Place × TKey)) (c : Nat) {x : Member}
    (hx : x ∈ st.members) (hn : x.dev ∉ st.newKnowers u to 0) :
    (TKey.epoch st.epoch c, TKey.leaf x.dev) ∈ st.commitSeals u p to c := by
  unfold commitSeals
  simp only [List.mem_append]
  refine .inr (List.mem_map.2 ⟨x, List.mem_filter.2 ⟨hx, ?_⟩, rfl⟩)
  simpa using hn

/-- Each seal of a commit is one of five: a secret derived from the one below it, a secret sealed to a key `to` names,
    the epoch's new key derived from the root, a key of the epoch before sealed under it, or the new key boxed to a
    member. -/
theorem commitSeals_cases {st : Tree} {u : SignerId} {p : Place} {to : List (Place × TKey)} {c : Nat}
    {s t : TKey} (h : (s, t) ∈ st.commitSeals u p to c) :
    (∃ k < p.length, s = pathKey u p c k ∧ t = pathKey u p c (k + 1)) ∨
    (∃ n, (n, t) ∈ to ∧ s = .node n c) ∨
    (s = .epoch st.epoch c ∧ t = pathKey u p c 0) ∨
    (st.chains st.epoch = true ∧ ∃ c' ∈ st.keys (st.epoch - 1), s = .epoch (st.epoch - 1) c' ∧ t = .epoch st.epoch c) ∨
    (∃ x ∈ st.members, x.dev ∉ st.newKnowers u to 0 ∧ s = .epoch st.epoch c ∧ t = .leaf x.dev) := by
  unfold commitSeals at h
  simp only [List.mem_append, List.mem_map, List.mem_range, List.mem_singleton, List.mem_filter, Prod.mk.injEq] at h
  rcases h with (((h | h) | h) | h) | h
  · obtain ⟨k, hk, rfl, rfl⟩ := h; exact .inl ⟨k, hk, rfl, rfl⟩
  · obtain ⟨⟨n, t'⟩, hn, rfl, rfl⟩ := h; exact .inr (.inl ⟨n, hn, rfl⟩)
  · obtain ⟨rfl, rfl⟩ := h; exact .inr (.inr (.inl ⟨rfl, rfl⟩))
  · split at h
    · rename_i hc
      obtain ⟨c', hc', rfl, rfl⟩ := List.mem_map.1 h
      exact .inr (.inr (.inr (.inl ⟨hc, c', hc', rfl, rfl⟩)))
    · simp at h
  · obtain ⟨x, ⟨hx, hn⟩, rfl, rfl⟩ := h
    exact .inr (.inr (.inr (.inr ⟨x, hx, by simpa using hn, rfl, rfl⟩)))

theorem newKnowers_mono {st : Tree} {u : SignerId} {to : List (Place × TKey)} {k k' : Nat} (hk : k ≤ k') {y : SignerId}
    (h : y ∈ st.newKnowers u to k') : y ∈ st.newKnowers u to k := by
  unfold newKnowers at *
  rcases List.mem_cons.1 h with rfl | h
  · exact List.mem_cons_self
  · obtain ⟨nt, hnt, hy⟩ := List.mem_flatMap.1 h
    obtain ⟨hnt, hle⟩ := List.mem_filter.1 hnt
    exact List.mem_cons_of_mem _ (List.mem_flatMap.2 ⟨nt, List.mem_filter.2 ⟨hnt, by simp at hle ⊢; omega⟩, hy⟩)

theorem newKnowers_target {st : Tree} {u : SignerId} {to : List (Place × TKey)} {k : Nat} {nt : Place × TKey}
    (hnt : nt ∈ to) (hk : k ≤ nt.1.length) {y : SignerId} (hy : y ∈ st.knowersOf nt.2) :
    y ∈ st.newKnowers u to k := by
  unfold newKnowers
  exact List.mem_cons_of_mem _ (List.mem_flatMap.2 ⟨nt, List.mem_filter.2 ⟨hnt, by simpa using hk⟩, hy⟩)

theorem newKnowers_cases {st : Tree} {u : SignerId} {to : List (Place × TKey)} {k : Nat} {y : SignerId}
    (h : y ∈ st.newKnowers u to k) : y = u ∨ ∃ nt ∈ to, k ≤ nt.1.length ∧ y ∈ st.knowersOf nt.2 := by
  unfold newKnowers at h
  rcases List.mem_cons.1 h with rfl | h
  · exact .inl rfl
  · obtain ⟨nt, hnt, hy⟩ := List.mem_flatMap.1 h
    obtain ⟨hnt, hle⟩ := List.mem_filter.1 hnt
    exact .inr ⟨nt, hnt, by simpa using hle, hy⟩

theorem targetOk_iff {st : Tree} {p : Place} {nt : Place × TKey} :
    st.targetOk p nt = true ↔ nt.1.length < p.length ∧ nt.1 <+: p ∧ st.clean nt.2 = true ∧
      (match nt.2 with
        | .leaf d => st.under (copath p nt.1) d
        | .node q _ => (copath p nt.1).isPrefixOf q
        | .epoch _ _ => false) = true := by
  simp [targetOk, List.isPrefixOf_iff_prefix, Bool.and_eq_true, and_assoc]

/-- A clean key is opened by members alone. -/
theorem clean_knowers {st : Tree} {t : TKey} (h : st.clean t = true) : ∀ y ∈ st.knowersOf t, st.isMember y = true := by
  cases t with
  | leaf d => intro y hy; simp [knowersOf] at hy; subst hy; simpa [clean] using h
  | node q c =>
    intro y hy
    simp only [clean, Bool.and_eq_true, List.all_eq_true] at h
    exact h.2 y hy
  | epoch g c => simp [clean] at h

/-- The new secrets of a commit that counts are opened by members alone. -/
theorem newKnowers_members {st : Tree} {u : SignerId} {p : Place} {to : List (Place × TKey)} (hp : st.placeOf u = some p)
    (ht : to.all (st.targetOk p) = true) {k : Nat} : ∀ y ∈ st.newKnowers u to k, st.isMember y = true := by
  intro y hy
  rcases newKnowers_cases hy with rfl | ⟨nt, hnt, -, hy⟩
  · exact member_of_placeOf hp
  · exact clean_knowers (targetOk_iff.1 (List.all_eq_true.1 ht nt hnt)).2.2.1 y hy

end Tree

open Tree

/-! ## What every tree keeps to -/

/-- A key named by no commit from change `n` on. -/
def Below (n : Nat) : TKey → Prop
  | .node _ c => c < n
  | _ => True

/-- What every tree the changes reach keeps to: leaves of the tree's height, each device and each leaf once; secrets
    written by commits before now, those on the nodes now opened by members alone; no key yet of an epoch to come; every
    seal of keys named before now; and each key of an epoch that keeps the history sealing the keys of the one before. -/
structure WF (st : Tree) : Prop where
  places : ∀ x ∈ st.members, x.place.length = st.height
  apart : st.members.Pairwise fun a b => a.dev ≠ b.dev ∧ a.place ≠ b.place
  written : ∀ q c, c ∈ st.written q → c < st.now
  unwritten : ∀ q c, st.now ≤ c → st.knowers q c = []
  current : ∀ q c, c ∈ st.current q → c ∈ st.written q ∧ ∀ y ∈ st.knowers q c, st.isMember y = true
  keys : ∀ g, st.epoch < g → st.keys g = []
  chains : ∀ g, st.epoch < g → st.chains g = false
  fresh : ∀ s t, (s, t) ∈ st.seals → Below st.now s ∧ Below st.now t
  history : ∀ g, st.chains (g + 1) = true → ∀ c ∈ st.keys (g + 1), ∀ c' ∈ st.keys g,
    (TKey.epoch g c', TKey.epoch (g + 1) c) ∈ st.seals

theorem wf_empty (h : Nat) : WF (Tree.empty h) where
  places := by simp [Tree.empty]
  apart := by simp [Tree.empty]
  written := by simp [Tree.empty]
  unwritten := by simp [Tree.empty]
  current := by simp [Tree.empty]
  keys := by simp [Tree.empty]
  chains := by simp [Tree.empty]
  fresh := by simp [Tree.empty]
  history := by simp [Tree.empty]

theorem Below.mono {n n' : Nat} (h : n ≤ n') {k : TKey} (hk : Below n k) : Below n' k := by
  cases k <;> simp_all [Below] <;> omega

/-- A commit that counts keeps to it. -/
theorem wf_landed {st : Tree} (hw : WF st) {u : SignerId} {p : Place} {to : List (Place × TKey)} (saw : List Nat)
    (hp : st.placeOf u = some p) (ht : to.all (st.targetOk p) = true) :
    WF { st.landed u p to saw with now := st.now + 1 } where
  places := hw.places
  apart := hw.apart
  written := by
    intro q c hc
    simp only [landed_written] at hc ⊢
    split at hc
    · rcases List.mem_cons.1 hc with rfl | hc
      · omega
      · exact Nat.lt_succ_of_lt (hw.written q c hc)
    · exact Nat.lt_succ_of_lt (hw.written q c hc)
  unwritten := by
    intro q c hc
    simp only [landed_knowers] at hc ⊢
    rw [ite_eq_right (by omega)]
    exact hw.unwritten q c (by omega)
  current := by
    intro q c hc
    show c ∈ (st.landed u p to saw).written q ∧ ∀ y ∈ (st.landed u p to saw).knowers q c, st.isMember y = true
    simp only [landed_current] at hc
    simp only [landed_written, landed_knowers]
    split at hc
    · rename_i hq
      rcases List.mem_cons.1 hc with rfl | hc
      · refine ⟨by simp [hq], ?_⟩
        rw [ite_eq_left ⟨hq, rfl⟩]
        exact newKnowers_members hp ht
      · have hc := (List.mem_filter.1 hc).1
        have hlt := hw.written q c (hw.current q c hc).1
        refine ⟨by simp [hq, (hw.current q c hc).1], ?_⟩
        rw [ite_eq_right (by omega)]
        exact (hw.current q c hc).2
    · rename_i hq
      have hlt := hw.written q c (hw.current q c hc).1
      refine ⟨by simp [hq, (hw.current q c hc).1], ?_⟩
      rw [ite_eq_right (by simp [hq])]
      exact (hw.current q c hc).2
  keys := by
    intro g hg
    simp only [landed_keys, landed_epoch] at hg ⊢
    rw [ite_eq_right (by omega)]
    exact hw.keys g hg
  chains := hw.chains
  fresh := by
    intro s t hst
    simp only [landed_seals, List.mem_append] at hst ⊢
    rcases hst with hst | hst
    · exact ⟨(hw.fresh s t hst).1.mono (by omega), (hw.fresh s t hst).2.mono (by omega)⟩
    · have hfr : ∀ k, Below (st.now + 1) (pathKey u p st.now k) := by
        intro k; unfold pathKey; split <;> simp [Below]
      rcases commitSeals_cases hst with ⟨k, -, rfl, rfl⟩ | ⟨n, hn, rfl⟩ | ⟨rfl, rfl⟩ | ⟨-, c', -, rfl, rfl⟩ |
          ⟨x, -, -, rfl, rfl⟩
      · exact ⟨hfr k, hfr (k + 1)⟩
      · refine ⟨by simp [Below], ?_⟩
        have hok := targetOk_iff.1 (List.all_eq_true.1 ht _ hn)
        cases t with
        | node q c =>
          have hcl := hok.2.2.1
          simp only [clean, Bool.and_eq_true, List.contains_iff_mem] at hcl
          have := hw.written q c hcl.1
          simp [Below]; omega
        | _ => simp [Below]
      · exact ⟨by simp [Below], hfr 0⟩
      · simp [Below]
      · simp [Below]
  history := by
    intro g hg c hc c' hc'
    simp only [landed_chains, landed_keys, landed_seals] at hg hc hc' ⊢
    by_cases he : g + 1 = st.epoch
    · rw [ite_eq_left he] at hc
      rw [ite_eq_right (by omega)] at hc'
      rcases List.mem_append.1 hc with hc | hc
      · exact List.mem_append.2 (.inl (hw.history g hg c hc c' hc'))
      · simp only [List.mem_singleton] at hc
        subst hc
        refine List.mem_append.2 (.inr ?_)
        unfold commitSeals
        simp only [List.mem_append]
        refine .inl (.inr ?_)
        rw [← he, ite_eq_left hg]
        exact List.mem_map.2 ⟨c', by simpa using hc', by simp⟩
    · rw [ite_eq_right he] at hc
      by_cases hg' : g = st.epoch
      · subst hg'
        rw [hw.chains (st.epoch + 1) (by omega)] at hg
        simp at hg
      · rw [ite_eq_right hg'] at hc'
        exact List.mem_append.2 (.inl (hw.history g hg c hc c' hc'))

/-- A change that doesn't count keeps to it. -/
theorem wf_tick {st : Tree} (hw : WF st) : WF { st with now := st.now + 1 } where
  places := hw.places
  apart := hw.apart
  written := fun q c hc => Nat.lt_succ_of_lt (hw.written q c hc)
  unwritten := fun q c hc => hw.unwritten q c (Nat.le_of_succ_le hc)
  current := hw.current
  keys := hw.keys
  chains := hw.chains
  fresh := fun s t hst => ⟨(hw.fresh s t hst).1.mono (Nat.le_succ _), (hw.fresh s t hst).2.mono (Nat.le_succ _)⟩
  history := hw.history

theorem left_isMember {st : Tree} {d y : SignerId} : (st.left d).isMember y = (st.isMember y && y != d) := by
  simp only [isMember, left]
  rw [Bool.eq_iff_iff]
  simp only [List.any_eq_true, List.mem_filter, Bool.and_eq_true, bne_iff_ne, ne_eq, beq_iff_eq]
  constructor
  · rintro ⟨x, ⟨hx, hd⟩, rfl⟩; exact ⟨⟨x, hx, rfl⟩, hd⟩
  · rintro ⟨⟨x, hx, rfl⟩, hd⟩; exact ⟨x, ⟨hx, hd⟩, rfl⟩

/-- A removal that counts keeps to it. -/
theorem wf_left {st : Tree} (hw : WF st) (d : SignerId) : WF { st.left d with now := st.now + 1 } where
  places := fun x hx => hw.places x (List.mem_filter.1 hx).1
  apart := hw.apart.filter _
  written := fun q c hc => Nat.lt_succ_of_lt (hw.written q c hc)
  unwritten := fun q c hc => hw.unwritten q c (Nat.le_of_succ_le hc)
  current := by
    intro q c hc
    obtain ⟨hc, hn⟩ := List.mem_filter.1 hc
    refine ⟨(hw.current q c hc).1, fun y hy => ?_⟩
    have hy' : y ∈ st.knowers q c := hy
    show (st.left d).isMember y = true
    rw [left_isMember, (hw.current q c hc).2 y hy']
    simp only [Bool.true_and, bne_iff_ne, ne_eq]
    rintro rfl
    simp [hy'] at hn
  keys := fun g hg => hw.keys g (Nat.lt_of_succ_lt hg)
  chains := by
    intro g hg
    have hg : st.epoch + 1 < g := hg
    show (if g = st.epoch + 1 then true else st.chains g) = false
    rw [ite_eq_right (Nat.ne_of_gt hg)]
    exact hw.chains g (Nat.lt_of_succ_lt hg)
  fresh := fun s t hst => ⟨(hw.fresh s t hst).1.mono (Nat.le_succ _), (hw.fresh s t hst).2.mono (Nat.le_succ _)⟩
  history := by
    intro g hg c hc c' hc'
    change (if g + 1 = st.epoch + 1 then true else st.chains (g + 1)) = true at hg
    split at hg
    · rename_i he
      have hc : c ∈ st.keys (g + 1) := hc
      rw [he, hw.keys (st.epoch + 1) (Nat.lt_succ_self _)] at hc
      simp at hc
    · exact hw.history g hg c hc c' hc'

theorem apart_add {st : Tree} (hw : WF st) {d : SignerId} {p : Place} (hd : st.isMember d = false)
    (hpl : st.members.any (·.place == p) = false) :
    (st.members ++ [(⟨d, p⟩ : Member)]).Pairwise fun a b => a.dev ≠ b.dev ∧ a.place ≠ b.place := by
  refine List.pairwise_append.2 ⟨hw.apart, by simp, fun a ha b hb => ?_⟩
  simp only [List.mem_singleton] at hb
  subst hb
  refine ⟨fun h => ?_, fun h => ?_⟩
  · have : st.isMember d = true := isMember_iff.2 ⟨a, ha, h⟩
    simp [this] at hd
  · have : st.members.any (·.place == p) = true := List.any_eq_true.2 ⟨a, ha, by simp [h]⟩
    simp [this] at hpl

theorem isMember_add {st : Tree} {d y : SignerId} {p : Place} (h : st.isMember y = true) :
    (st.members ++ [(⟨d, p⟩ : Member)]).any (·.dev == y) = true := by
  obtain ⟨x, hx, rfl⟩ := isMember_iff.1 h
  exact List.any_eq_true.2 ⟨x, List.mem_append.2 (.inl hx), by simp⟩

/-- A new member with the past keeps to it. -/
theorem wf_joined_true {st : Tree} (hw : WF st) {d : SignerId} {p : Place} (hl : p.length = st.height)
    (hd : st.isMember d = false) (hpl : st.members.any (·.place == p) = false) :
    WF { st.joined d p true with now := st.now + 1 } where
  places := by
    intro x hx
    rcases List.mem_append.1 hx with hx | hx
    · exact hw.places x hx
    · rw [List.mem_singleton.1 hx]; exact hl
  apart := apart_add hw hd hpl
  written := fun q c hc => Nat.lt_succ_of_lt (hw.written q c hc)
  unwritten := fun q c hc => hw.unwritten q c (Nat.le_of_succ_le hc)
  current := fun q c hc => ⟨(hw.current q c hc).1, fun y hy => isMember_add ((hw.current q c hc).2 y hy)⟩
  keys := hw.keys
  chains := hw.chains
  fresh := by
    intro s t hst
    rcases List.mem_append.1 hst with hst | hst
    · exact ⟨(hw.fresh s t hst).1.mono (Nat.le_succ _), (hw.fresh s t hst).2.mono (Nat.le_succ _)⟩
    · obtain ⟨c, -, he⟩ := List.mem_map.1 hst
      simp only [Prod.mk.injEq] at he
      obtain ⟨rfl, rfl⟩ := he
      exact ⟨trivial, trivial⟩
  history := fun g hg c hc c' hc' => List.mem_append.2 (.inl (hw.history g hg c hc c' hc'))

/-- A new member without the past keeps to it. -/
theorem wf_joined_false {st : Tree} (hw : WF st) {d : SignerId} {p : Place} (hl : p.length = st.height)
    (hd : st.isMember d = false) (hpl : st.members.any (·.place == p) = false) :
    WF { st.joined d p false with now := st.now + 1 } where
  places := by
    intro x hx
    rcases List.mem_append.1 hx with hx | hx
    · exact hw.places x hx
    · rw [List.mem_singleton.1 hx]; exact hl
  apart := apart_add hw hd hpl
  written := fun q c hc => Nat.lt_succ_of_lt (hw.written q c hc)
  unwritten := fun q c hc => hw.unwritten q c (Nat.le_of_succ_le hc)
  current := fun q c hc => ⟨(hw.current q c hc).1, fun y hy => isMember_add ((hw.current q c hc).2 y hy)⟩
  keys := fun g hg => hw.keys g (Nat.lt_of_succ_lt hg)
  chains := by
    intro g hg
    have hg : st.epoch + 1 < g := hg
    show (if g = st.epoch + 1 then false else st.chains g) = false
    split
    · rfl
    · exact hw.chains g (Nat.lt_of_succ_lt hg)
  fresh := fun s t hst => ⟨(hw.fresh s t hst).1.mono (Nat.le_succ _), (hw.fresh s t hst).2.mono (Nat.le_succ _)⟩
  history := by
    intro g hg c hc c' hc'
    change (if g + 1 = st.epoch + 1 then false else st.chains (g + 1)) = true at hg
    split at hg
    · simp at hg
    · exact hw.history g hg c hc c' hc'

/-- Every change keeps to it. -/
theorem wf_step {st : Tree} (hw : WF st) (ch : Change) : WF (st.step ch) := by
  cases ch with
  | commit u to saw =>
    rcases commit_cases st u to saw with he | ⟨p, hp, ht, he⟩
    · simp only [step, he]; exact wf_tick hw
    · simp only [step, he]; exact wf_landed hw saw hp ht
  | remove d =>
    rcases remove_cases st d with he | ⟨-, he⟩
    · simp only [step, he]; exact wf_tick hw
    · simp only [step, he]; exact wf_left hw d
  | add d p hist =>
    rcases add_cases st d p hist with he | ⟨hl, hd, hpl, he⟩
    · simp only [step, he]; exact wf_tick hw
    · simp only [step, he]
      cases hist
      · exact wf_joined_false hw hl hd hpl
      · exact wf_joined_true hw hl hd hpl

theorem wf_foldl : ∀ (cs : List Change) {st : Tree}, WF st → WF (cs.foldl Tree.step st)
  | [], _, hw => hw
  | ch :: cs, _, hw => wf_foldl cs (wf_step hw ch)

theorem wf_run (h : Nat) (cs : List Change) : WF (run h cs) := wf_foldl cs (wf_empty h)

/-! ## Every member opens the epoch's keys -/

/-- What the members open: the secret of every commit on every node, each of its knowers; every key of the epoch now,
    each member. -/
structure Opened (st : Tree) : Prop where
  nodes : ∀ q c, c ∈ st.written q → ∀ y ∈ st.knowers q c, Reach st.seals (own y) (.node q c)
  epochs : ∀ x ∈ st.members, ∀ c ∈ st.keys st.epoch, Reach st.seals (own x.dev) (.epoch st.epoch c)

theorem opened_empty (h : Nat) : Opened (Tree.empty h) := ⟨by simp [Tree.empty], by simp [Tree.empty]⟩

/-- Each knower of a commit's new secret opens it: its author from its own key up the path, each other from a key the
    commit sealed a secret at or below it to, then up the path. -/
theorem newKnowers_reach {st : Tree} (ho : Opened st) {u : SignerId} {p : Place} {to : List (Place × TKey)}
    (ht : to.all (st.targetOk p) = true) {seals : List (TKey × TKey)}
    (hs : ∀ x ∈ st.seals ++ st.commitSeals u p to st.now, x ∈ seals) :
    ∀ k ≤ p.length, ∀ y ∈ st.newKnowers u to k, Reach seals (own y) (pathKey u p st.now k) := by
  have hd : ∀ k < p.length, (pathKey u p st.now k, pathKey u p st.now (k + 1)) ∈ seals :=
    fun k hk => hs _ (List.mem_append.2 (.inr (derive_mem st u p to st.now hk)))
  intro k hk y hy
  rcases newKnowers_cases hy with hyu | ⟨⟨n, t⟩, hnt, hkn, hyt⟩
  · rw [hyu]
    have h0 : Reach seals (own u) (pathKey u p st.now (k + (p.length - k))) := by
      rw [show k + (p.length - k) = p.length by omega, pathKey_ge (Nat.le_refl _)]
      exact .own rfl
    exact path_up hd (p.length - k) k (by omega) h0
  · obtain ⟨hlen, hpre, hcl, hgeo⟩ := targetOk_iff.1 (List.all_eq_true.1 ht _ hnt)
    have hrt : Reach seals (own y) t := by
      cases t with
      | leaf d =>
        simp only [knowersOf, List.mem_singleton] at hyt
        rw [hyt]; exact .own rfl
      | node q c =>
        simp only [clean, Bool.and_eq_true, List.contains_iff_mem] at hcl
        exact (ho.nodes q c hcl.1 y hyt).mono (fun x hx => hs x (List.mem_append.2 (.inl hx)))
      | epoch g c => simp at hgeo
    have hn : Reach seals (own y) (pathKey u p st.now n.length) := by
      rw [pathKey_lt hlen, ← List.prefix_iff_eq_take.1 hpre]
      exact .unseal (hs _ (List.mem_append.2 (.inr (copath_mem st u p st.now hnt)))) hrt
    exact path_up hd (n.length - k) k (by simp at hkn hlen; omega)
      (by rwa [show k + (n.length - k) = n.length by simp at hkn; omega])

theorem opened_landed {st : Tree} (ho : Opened st) {u : SignerId} {p : Place} {to : List (Place × TKey)}
    (saw : List Nat) (ht : to.all (st.targetOk p) = true) :
    Opened { st.landed u p to saw with now := st.now + 1 } where
  nodes := by
    intro q x hx y hy
    have hs : ∀ z ∈ st.seals ++ st.commitSeals u p to st.now, z ∈ (st.landed u p to saw).seals := fun z hz => hz
    change x ∈ (st.landed u p to saw).written q at hx
    change y ∈ (st.landed u p to saw).knowers q x at hy
    change Reach (st.landed u p to saw).seals (own y) (.node q x)
    rw [landed_written] at hx
    rw [landed_knowers] at hy
    by_cases hq : onPath p q = true ∧ x = st.now
    · rw [ite_eq_left hq] at hy
      obtain ⟨hq, rfl⟩ := hq
      have := newKnowers_reach ho ht hs q.length (Nat.le_of_lt (onPath_iff.1 hq).2) y hy
      rwa [pathKey_lt (onPath_iff.1 hq).2, take_of_onPath hq] at this
    · rw [ite_eq_right hq] at hy
      have hx' : x ∈ st.written q := by
        split at hx
        · rename_i hq'
          rcases List.mem_cons.1 hx with rfl | hx
          · exact absurd ⟨hq', rfl⟩ hq
          · exact hx
        · exact hx
      exact (ho.nodes q x hx' y hy).mono (fun z hz => List.mem_append.2 (.inl hz))
  epochs := by
    intro x hx c hc
    change x ∈ st.members at hx
    change c ∈ (st.landed u p to saw).keys st.epoch at hc
    change Reach (st.landed u p to saw).seals (own x.dev) (.epoch st.epoch c)
    rw [landed_keys, ite_eq_left rfl] at hc
    rcases List.mem_append.1 hc with hc | hc
    · exact (ho.epochs x hx c hc).mono (fun z hz => List.mem_append.2 (.inl hz))
    · rw [List.mem_singleton.1 hc]
      by_cases hk : x.dev ∈ st.newKnowers u to 0
      · have := newKnowers_reach ho ht (fun z hz => hz) 0 (Nat.zero_le _) x.dev hk
        exact .unseal (List.mem_append.2 (.inr (root_mem st u p to st.now))) this
      · exact .unseal (List.mem_append.2 (.inr (fill_mem st u p to st.now hx hk))) (.own rfl)

theorem opened_step {st : Tree} (hw : WF st) (ho : Opened st) (ch : Change) : Opened (st.step ch) := by
  have tick : Opened { st with now := st.now + 1 } := ⟨ho.nodes, ho.epochs⟩
  cases ch with
  | commit u to saw =>
    rcases commit_cases st u to saw with he | ⟨p, -, ht, he⟩
    · simp only [step, he]; exact tick
    · simp only [step, he]; exact opened_landed ho saw ht
  | remove d =>
    rcases remove_cases st d with he | ⟨-, he⟩
    · simp only [step, he]; exact tick
    · simp only [step, he]
      refine ⟨ho.nodes, fun x _ c hc => ?_⟩
      have hc : c ∈ st.keys (st.epoch + 1) := hc
      rw [hw.keys (st.epoch + 1) (Nat.lt_succ_self _)] at hc
      simp at hc
  | add d p hist =>
    rcases add_cases st d p hist with he | ⟨-, -, -, he⟩
    · simp only [step, he]; exact tick
    · simp only [step, he]
      cases hist with
      | false =>
        refine ⟨ho.nodes, fun x _ c hc => ?_⟩
        have hc : c ∈ st.keys (st.epoch + 1) := hc
        rw [hw.keys (st.epoch + 1) (Nat.lt_succ_self _)] at hc
        simp at hc
      | true =>
        refine ⟨fun q c hc y hy => (ho.nodes q c hc y hy).mono (fun z hz => List.mem_append.2 (.inl hz)), ?_⟩
        intro x hx c hc
        rcases List.mem_append.1 hx with hx | hx
        · exact (ho.epochs x hx c hc).mono (fun z hz => List.mem_append.2 (.inl hz))
        · rw [List.mem_singleton.1 hx]
          exact .unseal (List.mem_append.2 (.inr (List.mem_map.2 ⟨c, hc, rfl⟩))) (.own rfl)

theorem opened_foldl : ∀ (cs : List Change) {st : Tree}, WF st → Opened st → Opened (cs.foldl Tree.step st)
  | [], _, _, ho => ho
  | ch :: cs, _, hw, ho => opened_foldl cs (wf_step hw ch) (opened_step hw ho ch)

/-- Every member of the tree opens every key of the epoch now. -/
theorem members_open (h : Nat) (cs : List Change) {x : Member} (hx : x ∈ (run h cs).members) {c : Nat}
    (hc : c ∈ (run h cs).keys (run h cs).epoch) :
    Reach (run h cs).seals (own x.dev) (.epoch (run h cs).epoch c) :=
  (opened_foldl cs (wf_empty h) (opened_empty h)).epochs x hx c hc

/-! ## History -/

theorem seals_step (st : Tree) (ch : Change) : ∀ z ∈ st.seals, z ∈ (st.step ch).seals := by
  intro z hz
  cases ch with
  | commit u to saw =>
    rcases commit_cases st u to saw with he | ⟨p, -, -, he⟩
    · simp only [step, he]; exact hz
    · simp only [step, he]; exact List.mem_append.2 (.inl hz)
  | remove d =>
    rcases remove_cases st d with he | ⟨-, he⟩
    · simp only [step, he]; exact hz
    · simp only [step, he]; exact hz
  | add d p hist =>
    rcases add_cases st d p hist with he | ⟨-, -, -, he⟩
    · simp only [step, he]; exact hz
    · simp only [step, he]
      cases hist
      · exact hz
      · exact List.mem_append.2 (.inl hz)

theorem seals_foldl : ∀ (cs : List Change) (st : Tree), ∀ z ∈ st.seals, z ∈ (cs.foldl Tree.step st).seals
  | [], _, _, hz => hz
  | ch :: cs, st, z, hz => seals_foldl cs (st.step ch) z (seals_step st ch z hz)

/-- Members keep what they opened: whatever opens on a tree opens on every tree after it. -/
theorem opens_kept (h : Nat) (cs more : List Change) {start : TKey → Prop} {k : TKey}
    (hr : Reach (run h cs).seals start k) : Reach (run h (cs ++ more)).seals start k := by
  unfold run at *
  rw [List.foldl_append]
  exact hr.mono (seals_foldl more _)

/-- Whoever opens a key of an epoch that keeps the history opens every key of the epoch before. -/
theorem history_kept (h : Nat) (cs : List Change) {g c c' : Nat} (hch : (run h cs).chains (g + 1) = true)
    (hc : c ∈ (run h cs).keys (g + 1)) (hc' : c' ∈ (run h cs).keys g) {start : TKey → Prop}
    (hr : Reach (run h cs).seals start (.epoch (g + 1) c)) : Reach (run h cs).seals start (.epoch g c') :=
  .unseal ((wf_run h cs).history g hch c hc c' hc') hr

/-! ## A device that left opens nothing after -/

/-- What device `r` may have opened, at most: its own key, the secrets it is a knower of, and the keys of the epochs `P`
    holds of. -/
def Bad (r : SignerId) (P : Nat → Prop) (st : Tree) : TKey → Prop
  | .leaf d => d = r
  | .node q c => r ∈ st.knowers q c
  | .epoch g _ => P g

/-- Every seal of the tree to a key `r` may have opened is of a key `r` may have opened. -/
def Closed (r : SignerId) (P : Nat → Prop) (st : Tree) : Prop :=
  ∀ s t, (s, t) ∈ st.seals → Bad r P st t → Bad r P st s

theorem closed_empty (h : Nat) (r : SignerId) (P : Nat → Prop) : Closed r P (Tree.empty h) := by
  intro s t hst; simp [Tree.empty] at hst

/-- What `r` opens, it may have opened. -/
theorem bad_of_reach {r : SignerId} {P : Nat → Prop} {st : Tree} (hc : Closed r P st) {k : TKey}
    (h : Reach st.seals (own r) k) : Bad r P st k := by
  induction h with
  | own h => rw [h]; rfl
  | «unseal» hs _ ih => exact hc _ _ hs ih

theorem bad_congr {r : SignerId} {P : Nat → Prop} {st st' : Tree}
    (hk : ∀ q c, c < st.now → st'.knowers q c = st.knowers q c) {k : TKey} (hb : Below st.now k) :
    Bad r P st' k ↔ Bad r P st k := by
  cases k with
  | node q c => simp only [Bad]; rw [hk q c hb]
  | leaf d => exact Iff.rfl
  | epoch g c => exact Iff.rfl

/-- The seals there were stay closed when only keys named from now on change their knowers. -/
theorem closed_old {r : SignerId} {P : Nat → Prop} {st st' : Tree} (hw : WF st) (hc : Closed r P st)
    (hk : ∀ q c, c < st.now → st'.knowers q c = st.knowers q c) :
    ∀ s t, (s, t) ∈ st.seals → Bad r P st' t → Bad r P st' s := by
  intro s t hst hb
  obtain ⟨hbs, hbt⟩ := hw.fresh s t hst
  rw [bad_congr hk hbs]
  exact hc s t hst ((bad_congr hk hbt).1 hb)

theorem bad_pathKey {r : SignerId} {P : Nat → Prop} {st : Tree} {u : SignerId} {p : Place}
    {to : List (Place × TKey)} {saw : List Nat} {j : Nat} :
    Bad r P (st.landed u p to saw) (pathKey u p st.now j) ↔
      (if j < p.length then r ∈ st.newKnowers u to j else u = r) := by
  by_cases hj : j < p.length
  · rw [pathKey_lt hj, ite_eq_left hj]
    simp only [Bad]
    rw [landed_knowers, ite_eq_left ⟨onPath_take hj, rfl⟩, List.length_take, Nat.min_eq_left (Nat.le_of_lt hj)]
  · rw [pathKey_ge (Nat.not_lt.1 hj), ite_eq_right hj]
    exact Iff.rfl

/-- What `r` may have opened of a key a commit seals to: one it opens. -/
theorem knowersOf_bad {r : SignerId} {P : Nat → Prop} {st : Tree} {t : TKey} (h : Bad r P st t)
    (ht : ∀ g c, t ≠ .epoch g c) : r ∈ st.knowersOf t := by
  cases t with
  | leaf d => simp only [Bad] at h; simp [knowersOf, h]
  | node q c => exact h
  | epoch g c => exact absurd rfl (ht g c)

/-- A commit that counts keeps the seals closed, where `r` may have opened the epoch's keys if it is a member, and
    those of the epoch before if the epoch keeps the history. -/
theorem closed_landed {r : SignerId} {P : Nat → Prop} {st : Tree} (hw : WF st) (hc : Closed r P st)
    {u : SignerId} {p : Place} {to : List (Place × TKey)} (saw : List Nat) (hp : st.placeOf u = some p)
    (ht : to.all (st.targetOk p) = true) (hE : st.isMember r = true → P st.epoch)
    (hH : st.chains st.epoch = true → P st.epoch → P (st.epoch - 1)) :
    Closed r P { st.landed u p to saw with now := st.now + 1 } := by
  have hk : ∀ q c, c < st.now → (st.landed u p to saw).knowers q c = st.knowers q c := by
    intro q c hc; rw [landed_knowers, ite_eq_right (by omega)]
  intro s t hst hb
  change Bad r P (st.landed u p to saw) t at hb
  change Bad r P (st.landed u p to saw) s
  change (s, t) ∈ st.seals ++ st.commitSeals u p to st.now at hst
  rcases List.mem_append.1 hst with hst | hst
  · exact closed_old hw hc hk s t hst hb
  · rcases commitSeals_cases hst with ⟨k, hk', rfl, rfl⟩ | ⟨n, hn, rfl⟩ | ⟨rfl, rfl⟩ | ⟨hch, c', -, rfl, rfl⟩ |
        ⟨x, hx, -, rfl, rfl⟩
    · rw [bad_pathKey] at hb ⊢
      rw [ite_eq_left hk']
      split at hb
      · exact newKnowers_mono (Nat.le_succ k) hb
      · rw [← hb]; exact List.mem_cons_self
    · obtain ⟨hlen, hpre, hcl, hgeo⟩ := targetOk_iff.1 (List.all_eq_true.1 ht _ hn)
      have hbt : Below st.now t := by
        cases t with
        | node q c =>
          simp only [clean, Bool.and_eq_true, List.contains_iff_mem] at hcl
          exact hw.written q c hcl.1
        | _ => trivial
      have hne : ∀ g c, t ≠ .epoch g c := by
        rintro g c rfl; simp at hgeo
      have hr := knowersOf_bad ((bad_congr hk hbt).1 hb) hne
      have hon : onPath p n = true := onPath_iff.2 ⟨hpre, hlen⟩
      show r ∈ (st.landed u p to saw).knowers n st.now
      rw [landed_knowers, ite_eq_left ⟨hon, rfl⟩]
      exact newKnowers_target hn (Nat.le_refl _) hr
    · rw [bad_pathKey] at hb
      apply hE
      split at hb
      · exact newKnowers_members hp ht r hb
      · rw [← hb]; exact member_of_placeOf hp
    · exact hH hch hb
    · simp only [Bad] at hb
      apply hE
      rw [← hb]
      exact isMember_iff.2 ⟨x, hx, rfl⟩

/-- Every change keeps the seals closed, where `r` may have opened the epoch's keys if it is a member or joins with the
    past, and those of the epoch before if the epoch keeps the history. -/
theorem closed_step {r : SignerId} {P : Nat → Prop} {st : Tree} (hw : WF st) (hc : Closed r P st) (ch : Change)
    (hE : st.isMember r = true → P st.epoch)
    (hH : st.chains st.epoch = true → P st.epoch → P (st.epoch - 1))
    (hW : ∀ p, ch = .add r p true → P st.epoch) : Closed r P (st.step ch) := by
  have tick : Closed r P { st with now := st.now + 1 } := hc
  cases ch with
  | commit u to saw =>
    rcases commit_cases st u to saw with he | ⟨p, hp, ht, he⟩
    · simp only [step, he]; exact tick
    · simp only [step, he]; exact closed_landed hw hc saw hp ht hE hH
  | remove d =>
    rcases remove_cases st d with he | ⟨-, he⟩
    · simp only [step, he]; exact tick
    · simp only [step, he]; exact hc
  | add d p hist =>
    rcases add_cases st d p hist with he | ⟨-, -, -, he⟩
    · simp only [step, he]; exact tick
    · simp only [step, he]
      cases hist with
      | false => exact hc
      | true =>
        intro s t hst hb
        change (s, t) ∈ st.seals ++ (st.keys st.epoch).map (fun c => (TKey.epoch st.epoch c, TKey.leaf d)) at hst
        rcases List.mem_append.1 hst with hst | hst
        · exact hc s t hst hb
        · obtain ⟨c, -, he⟩ := List.mem_map.1 hst
          simp only [Prod.mk.injEq] at he
          obtain ⟨rfl, rfl⟩ := he
          have hb : d = r := hb
          exact hW p (by rw [hb])

theorem epoch_step (st : Tree) (ch : Change) : st.epoch ≤ (st.step ch).epoch := by
  cases ch with
  | commit u to saw =>
    rcases commit_cases st u to saw with he | ⟨p, -, -, he⟩
    · simp only [step, he]; exact Nat.le_refl _
    · simp only [step, he]; exact Nat.le_refl _
  | remove d =>
    rcases remove_cases st d with he | ⟨-, he⟩
    · simp only [step, he]; exact Nat.le_refl _
    · simp only [step, he]; exact Nat.le_succ _
  | add d p hist =>
    rcases add_cases st d p hist with he | ⟨-, -, -, he⟩
    · simp only [step, he]; exact Nat.le_refl _
    · simp only [step, he]
      cases hist
      · exact Nat.le_succ _
      · exact Nat.le_refl _

theorem epoch_foldl : ∀ (cs : List Change) (st : Tree), st.epoch ≤ (cs.foldl Tree.step st).epoch
  | [], _ => Nat.le_refl _
  | ch :: cs, st => Nat.le_trans (epoch_step st ch) (epoch_foldl cs (st.step ch))

/-- A step changes no epoch's history but the next one's. -/
theorem chains_step (st : Tree) (ch : Change) {g : Nat} (hg : g ≤ st.epoch) : (st.step ch).chains g = st.chains g := by
  cases ch with
  | commit u to saw =>
    rcases commit_cases st u to saw with he | ⟨p, -, -, he⟩
    · simp only [step, he]
    · simp only [step, he]; rfl
  | remove d =>
    rcases remove_cases st d with he | ⟨-, he⟩
    · simp only [step, he]
    · simp only [step, he]
      show (if g = st.epoch + 1 then true else st.chains g) = st.chains g
      rw [ite_eq_right (by omega)]
  | add d p hist =>
    rcases add_cases st d p hist with he | ⟨-, -, -, he⟩
    · simp only [step, he]
    · simp only [step, he]
      cases hist
      · show (if g = st.epoch + 1 then false else st.chains g) = st.chains g
        rw [ite_eq_right (by omega)]
      · rfl

/-- A device stays out of the tree while no change adds it. -/
theorem out_step {st : Tree} {r : SignerId} (hr : st.isMember r = false) (ch : Change)
    (hn : ∀ p hist, ch ≠ .add r p hist) : (st.step ch).isMember r = false := by
  cases ch with
  | commit u to saw =>
    rcases commit_cases st u to saw with he | ⟨p, -, -, he⟩
    · simp only [step, he]; exact hr
    · simp only [step, he]; exact hr
  | remove d =>
    rcases remove_cases st d with he | ⟨-, he⟩
    · simp only [step, he]; exact hr
    · simp only [step, he]
      show (st.left d).isMember r = false
      rw [left_isMember, hr, Bool.false_and]
  | add d p hist =>
    rcases add_cases st d p hist with he | ⟨-, -, -, he⟩
    · simp only [step, he]; exact hr
    · simp only [step, he]
      have hd : d ≠ r := fun h => hn p hist (by rw [h])
      have : (st.members ++ [(⟨d, p⟩ : Member)]).any (·.dev == r) = false := by
        rw [List.any_append, Bool.or_eq_false_iff]
        exact ⟨hr, by simpa using hd⟩
      cases hist
      · exact this
      · exact this

theorem out_foldl : ∀ (cs : List Change) {st : Tree} {r : SignerId}, st.isMember r = false →
    (∀ p hist, Change.add r p hist ∉ cs) → (cs.foldl Tree.step st).isMember r = false
  | [], _, _, hr, _ => hr
  | ch :: cs, _, _, hr, hn =>
    out_foldl cs (out_step hr ch fun p hist he => hn p hist (by rw [he]; exact List.mem_cons_self))
      fun p hist h => hn p hist (List.mem_cons_of_mem _ h)

/-- Before `r` leaves, it may have opened the keys of every epoch up to the one it leaves in. -/
theorem closed_upto {r : SignerId} {G : Nat} : ∀ (cs : List Change) {st : Tree}, WF st → Closed r (· ≤ G) st →
    (cs.foldl Tree.step st).epoch ≤ G → Closed r (· ≤ G) (cs.foldl Tree.step st)
  | [], _, _, hc, _ => hc
  | ch :: cs, st, hw, hc, hG => by
    have h1 := epoch_step st ch
    have h2 := epoch_foldl cs (st.step ch)
    have hG' : (cs.foldl Tree.step (st.step ch)).epoch ≤ G := hG
    exact closed_upto cs (wf_step hw ch)
      (closed_step hw hc ch (fun _ => by omega) (fun _ _ => by omega) (fun _ _ => by omega)) hG'

/-- After it left, nothing new is sealed to what it may have opened. -/
theorem closed_after {r : SignerId} {G : Nat} : ∀ (cs : List Change) {st : Tree}, WF st → Closed r (· ≤ G) st →
    st.isMember r = false → (∀ p hist, Change.add r p hist ∉ cs) → Closed r (· ≤ G) (cs.foldl Tree.step st)
  | [], _, _, hc, _, _ => hc
  | ch :: cs, st, hw, hc, hr, hn => by
    have hn' : ∀ p hist, ch ≠ .add r p hist := fun p hist he => hn p hist (by rw [he]; exact List.mem_cons_self)
    exact closed_after cs (wf_step hw ch)
      (closed_step hw hc ch (fun h => by rw [hr] at h; cases h) (fun _ _ => by omega)
        (fun p he => absurd he (hn' p true)))
      (out_step hr ch hn') (fun p hist h => hn p hist (List.mem_cons_of_mem _ h))

theorem run_cons (h : Nat) (before after : List Change) (ch : Change) :
    run h (before ++ ch :: after) = after.foldl Tree.step ((run h before).step ch) := by
  simp [run, List.foldl_append]

/-- A device that leaves opens no key of any epoch after, whatever it opened before, unless it joins again. -/
theorem removed_shut (h : Nat) (before after : List Change) {r : SignerId} (hm : (run h before).isMember r = true)
    (hn : ∀ p hist, Change.add r p hist ∉ after) {g : Nat} (hg : (run h before).epoch < g) (c : Nat) :
    ¬ Reach (run h (before ++ .remove r :: after)).seals (own r) (.epoch g c) := by
  intro hr
  have hw := wf_run h before
  have h0 : Closed r (· ≤ (run h before).epoch) (run h before) :=
    closed_upto before (wf_empty h) (closed_empty h r _) (Nat.le_refl _)
  have h1 := closed_step hw h0 (.remove r) (fun _ => Nat.le_refl _) (fun _ _ => by omega) (fun _ he => by cases he)
  have hout : ((run h before).step (.remove r)).isMember r = false := by
    show ((run h before).remove r).isMember r = false
    unfold Tree.remove
    rw [ite_eq_left hm, left_isMember]
    simp
  rw [run_cons] at hr
  have := bad_of_reach (closed_after after (wf_step hw _) h1 hout hn) hr
  simp only [Bad] at this
  omega

/-- A device that joins without the past opens no key of an epoch before it joined. -/
theorem no_history_shut (h : Nat) (before after : List Change) {d : SignerId} {p : Place}
    (hnew : ∀ q hist, Change.add d q hist ∉ before) (hj : ((run h before).step (.add d p false)).isMember d = true)
    {g : Nat} (hg : g ≤ (run h before).epoch) (c : Nat) :
    ¬ Reach (run h (before ++ .add d p false :: after)).seals (own d) (.epoch g c) := by
  intro hr
  have hw := wf_run h before
  have hout : (run h before).isMember d = false := out_foldl before (by simp [Tree.empty, isMember]) hnew
  -- before it joins, nothing is sealed to what it opens
  have hpre : ∀ (cs : List Change) {st : Tree}, WF st → Closed d ((run h before).epoch < ·) st →
      st.isMember d = false → (∀ q hist, Change.add d q hist ∉ cs) →
      (cs.foldl Tree.step st).epoch ≤ (run h before).epoch →
      Closed d ((run h before).epoch < ·) (cs.foldl Tree.step st) := by
    intro cs
    induction cs with
    | nil => intro st _ hc _ _ _; exact hc
    | cons ch cs ih =>
      intro st hw hc hr hn hG
      have hn' : ∀ q hist, ch ≠ .add d q hist := fun q hist he => hn q hist (by rw [he]; exact List.mem_cons_self)
      have h1 := epoch_step st ch
      have h2 := epoch_foldl cs (st.step ch)
      have hG' : (cs.foldl Tree.step (st.step ch)).epoch ≤ (run h before).epoch := hG
      exact ih (wf_step hw ch)
        (closed_step hw hc ch (fun h => by rw [hr] at h; cases h) (fun _ h => by omega)
          (fun q he => absurd he (hn' q true)))
        (out_step hr ch hn') (fun q hist h => hn q hist (List.mem_cons_of_mem _ h)) hG'
  have h0 := hpre before (wf_empty h) (closed_empty h d _) (by simp [Tree.empty, isMember]) hnew (Nat.le_refl _)
  -- it joins: a new epoch that keeps no history
  have hadd : (run h before).step (.add d p false) =
      { (run h before).joined d p false with now := (run h before).now + 1 } := by
    rcases add_cases (run h before) d p false with he | ⟨-, -, -, he⟩
    · simp only [step, he] at hj
      have hj' : (run h before).isMember d = true := hj
      rw [hout] at hj'; cases hj'
    · simp only [step, he]
  have h1 := closed_step hw h0 (.add d p false) (fun h => by rw [hout] at h; cases h) (fun _ h => by omega)
    (fun _ he => by cases he)
  -- after it, every epoch is past the one it joined in, whose keys seal no earlier ones
  have hpost : ∀ (cs : List Change) {st : Tree}, WF st → Closed d ((run h before).epoch < ·) st →
      (run h before).epoch + 1 ≤ st.epoch → st.chains ((run h before).epoch + 1) = false →
      Closed d ((run h before).epoch < ·) (cs.foldl Tree.step st) := by
    intro cs
    induction cs with
    | nil => intro st _ hc _ _; exact hc
    | cons ch cs ih =>
      intro st hw hc he hch
      have h1 := epoch_step st ch
      refine ih (wf_step hw ch) (closed_step hw hc ch (fun _ => by omega) (fun hc' _ => ?_) (fun _ _ => by omega))
        (by omega) (by rw [chains_step st ch (by omega)]; exact hch)
      have : st.epoch ≠ (run h before).epoch + 1 := fun h' => by rw [← h', hc'] at hch; cases hch
      show (run h before).epoch < st.epoch - 1
      omega
  have hst : (run h before).epoch + 1 ≤ ((run h before).step (.add d p false)).epoch := by
    rw [hadd]; exact Nat.le_refl _
  have hch : ((run h before).step (.add d p false)).chains ((run h before).epoch + 1) = false := by
    rw [hadd]
    show (if (run h before).epoch + 1 = (run h before).epoch + 1 then false else _) = false
    rw [ite_eq_left rfl]
  rw [run_cons] at hr
  have := bad_of_reach (hpost after (wf_step hw _) h1 hst hch) hr
  simp only [Bad] at this
  omega

/-! ## A commit drafted on the tree reaches every member through it -/

/-- Two places of the same length that differ part at a first turn. -/
theorem split_off : ∀ (a b : List Bool), a.length = b.length → a ≠ b →
    ∃ j < a.length, a.take j = b.take j ∧ a.getD j false ≠ b.getD j false
  | [], [], _, h => absurd rfl h
  | [], _ :: _, hl, _ => by simp at hl
  | _ :: _, [], hl, _ => by simp at hl
  | x :: a, y :: b, hl, hne => by
    by_cases hxy : x = y
    · subst hxy
      have hab : a ≠ b := fun h => hne (by rw [h])
      obtain ⟨j, hj, ht, hd⟩ := split_off a b (by simpa using hl) hab
      exact ⟨j + 1, by simp; omega, by simp [ht], by simpa using hd⟩
    · exact ⟨0, by simp, rfl, by simpa using hxy⟩

theorem take_succ_getD {l : Place} {j : Nat} (hj : j < l.length) : l.take (j + 1) = l.take j ++ [l.getD j false] := by
  rw [List.take_add_one, List.getD_eq_getElem?_getD, List.getElem?_eq_getElem hj]
  simp

/-- Every other leaf of the tree lies below the other child of some node on a path. -/
theorem copath_of_ne {p q : Place} (hl : q.length = p.length) (hne : q ≠ p) :
    ∃ j < p.length, copath p (p.take j) <+: q := by
  obtain ⟨j, hj, ht, hd⟩ := split_off p q hl.symm (Ne.symm hne)
  refine ⟨j, hj, ?_⟩
  have hjq : j < q.length := by omega
  have hb : (!p.getD j false) = q.getD j false := by
    revert hd
    cases p.getD j false <;> cases q.getD j false <;> simp
  unfold copath
  rw [List.length_take, Nat.min_eq_left (Nat.le_of_lt hj), hb, ht, ← take_succ_getD hjq]
  exact List.take_prefix _ _

theorem pairwise_apart {l : List Member} (h : l.Pairwise (fun a b => a.dev ≠ b.dev ∧ a.place ≠ b.place)) :
    ∀ a ∈ l, ∀ b ∈ l, a.dev ≠ b.dev → a.place ≠ b.place := by
  induction l with
  | nil => intro a ha; simp at ha
  | cons x l ih =>
    intro a ha b hb hd
    rw [List.pairwise_cons] at h
    rcases List.mem_cons.1 ha with ha' | ha' <;> rcases List.mem_cons.1 hb with hb' | hb'
    · exact (hd (by rw [ha', hb'])).elim
    · rw [ha']; exact (h.1 b hb').2
    · rw [hb']; exact fun e => (h.1 a ha').2 e.symm
    · exact ih h.2 a ha' b hb' hd

/-- The resolution of a node reaches every member below it. -/
theorem resolution_covers {st : Tree} (hw : WF st) : ∀ (k : Nat) (m : Place) (x : Member), x ∈ st.members →
    m <+: x.place → m.length + k = st.height → ∃ t ∈ st.resolution k m, x.dev ∈ st.knowersOf t := by
  intro k
  induction k with
  | zero =>
    intro m x hx hm hk
    have hmx : m = x.place := hm.eq_of_length (by rw [hw.places x hx]; omega)
    refine ⟨.leaf x.dev, ?_, by simp [knowersOf]⟩
    simp only [resolution]
    exact List.mem_map.2 ⟨x, List.mem_filter.2 ⟨hx, by simp [hmx]⟩, rfl⟩
  | succ k ih =>
    intro m x hx hm hk
    simp only [resolution]
    split
    · have hlt : m.length < x.place.length := by rw [hw.places x hx]; omega
      have hm' : m ++ [x.place.getD m.length false] <+: x.place := by
        have : m ++ [x.place.getD m.length false] = x.place.take (m.length + 1) := by
          rw [take_succ_getD hlt, ← List.prefix_iff_eq_take.1 hm]
        rw [this]; exact List.take_prefix _ _
      generalize x.place.getD m.length false = b at hm'
      obtain ⟨t, ht, hxt⟩ := ih (m ++ [b]) x hx hm' (by simp; omega)
      refine ⟨t, ?_, hxt⟩
      cases b
      · exact List.mem_append.2 (.inl ht)
      · exact List.mem_append.2 (.inr ht)
    · by_cases hk' : ∃ c ∈ st.current m, x.dev ∈ st.knowers m c
      · obtain ⟨c, hc, hxc⟩ := hk'
        exact ⟨.node m c, List.mem_append.2 (.inl (List.mem_map.2 ⟨c, hc, rfl⟩)), hxc⟩
      · refine ⟨.leaf x.dev, List.mem_append.2 (.inr (List.mem_map.2 ⟨x, List.mem_filter.2 ⟨hx, ?_⟩, rfl⟩)),
          by simp [knowersOf]⟩
        simp only [Bool.and_eq_true, List.isPrefixOf_iff_prefix, List.all_eq_true]
        refine ⟨hm, fun c hc => ?_⟩
        have hno : x.dev ∉ st.knowers m c := fun h => hk' ⟨c, hc, h⟩
        simpa using hno

theorem under_mono {st : Tree} {m m' : Place} (hm : m <+: m') {d : SignerId} (h : st.under m' d = true) :
    st.under m d = true := by
  simp only [under, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, List.isPrefixOf_iff_prefix] at h ⊢
  obtain ⟨x, hx, hd, hp⟩ := h
  exact ⟨x, hx, hd, hm.trans hp⟩

/-- The resolution of a node holds clean keys below it alone. -/
theorem resolution_ok {st : Tree} (hw : WF st) : ∀ (k : Nat) (m : Place), ∀ t ∈ st.resolution k m,
    st.clean t = true ∧ (match t with
      | .leaf d => st.under m d
      | .node q _ => m.isPrefixOf q
      | .epoch _ _ => false) = true := by
  intro k
  induction k with
  | zero =>
    intro m t ht
    simp only [resolution] at ht
    obtain ⟨x, hx, rfl⟩ := List.mem_map.1 ht
    obtain ⟨hx, hpl⟩ := List.mem_filter.1 hx
    have hpl : x.place = m := by simpa using hpl
    refine ⟨isMember_iff.2 ⟨x, hx, rfl⟩, ?_⟩
    simp only [under, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, List.isPrefixOf_iff_prefix]
    exact ⟨x, hx, rfl, by rw [hpl]; exact List.prefix_refl m⟩
  | succ k ih =>
    intro m t ht
    simp only [resolution] at ht
    split at ht
    · have lift : ∀ b, t ∈ st.resolution k (m ++ [b]) → st.clean t = true ∧ (match t with
          | .leaf d => st.under m d
          | .node q _ => m.isPrefixOf q
          | .epoch _ _ => false) = true := by
        intro b hb
        obtain ⟨hcl, hgeo⟩ := ih (m ++ [b]) t hb
        refine ⟨hcl, ?_⟩
        cases t with
        | leaf d => exact under_mono (List.prefix_append m [b]) hgeo
        | node q c =>
          simp only [List.isPrefixOf_iff_prefix] at hgeo ⊢
          exact (List.prefix_append m [b]).trans hgeo
        | epoch g c => simp at hgeo
      rcases List.mem_append.1 ht with ht | ht
      · exact lift false ht
      · exact lift true ht
    · rcases List.mem_append.1 ht with ht | ht
      · obtain ⟨c, hc, rfl⟩ := List.mem_map.1 ht
        refine ⟨?_, by simp [List.isPrefixOf_iff_prefix]⟩
        simp only [clean, Bool.and_eq_true, List.contains_iff_mem, List.all_eq_true]
        exact ⟨(hw.current m c hc).1, (hw.current m c hc).2⟩
      · obtain ⟨x, hx, rfl⟩ := List.mem_map.1 ht
        obtain ⟨hx, hpl⟩ := List.mem_filter.1 hx
        simp only [Bool.and_eq_true] at hpl
        refine ⟨isMember_iff.2 ⟨x, hx, rfl⟩, ?_⟩
        simp only [under, List.any_eq_true, Bool.and_eq_true, beq_iff_eq]
        exact ⟨x, hx, rfl, hpl.1⟩

/-- Every seal of a draft is one its author may make. -/
theorem draftTo_ok {st : Tree} (hw : WF st) {p : Place} : (st.draftTo p).all (st.targetOk p) = true := by
  rw [List.all_eq_true]
  intro nt hnt
  obtain ⟨j, hj, hnt⟩ := List.mem_flatMap.1 hnt
  obtain ⟨t, ht, rfl⟩ := List.mem_map.1 hnt
  have hj := List.mem_range.1 hj
  obtain ⟨hcl, hgeo⟩ := resolution_ok hw _ _ t ht
  rw [targetOk_iff]
  exact ⟨by simp; omega, List.take_prefix _ _, hcl, hgeo⟩

/-- A commit drafted on the tree as it stands counts, and its seals alone reach every member: no member needs a fill.
    Where every node holds one secret all members below it open, it seals one key a level. -/
theorem draft_reaches_all (h : Nat) (cs : List Change) {u : SignerId} {p : Place}
    (hp : (run h cs).placeOf u = some p) :
    ((run h cs).draftTo p).all ((run h cs).targetOk p) = true ∧
      ∀ x ∈ (run h cs).members, x.dev ∈ (run h cs).newKnowers u ((run h cs).draftTo p) 0 := by
  have hw := wf_run h cs
  refine ⟨draftTo_ok hw, fun x hx => ?_⟩
  obtain ⟨xu, hxu, hdu, hpu⟩ := placeOf_some hp
  by_cases hd : x.dev = u
  · rw [hd]; exact List.mem_cons_self
  · have hne : x.place ≠ p := by
      rw [← hpu]
      exact pairwise_apart hw.apart x hx xu hxu (by rw [hdu]; exact hd)
    have hlp : p.length = (run h cs).height := by rw [← hpu]; exact hw.places xu hxu
    obtain ⟨j, hj, hcp⟩ := copath_of_ne (by rw [hw.places x hx, hlp]) hne
    have hlen : (copath p (p.take j)).length + ((run h cs).height - (j + 1)) = (run h cs).height := by
      simp [copath, List.length_take]; omega
    obtain ⟨t, ht, hxt⟩ := resolution_covers hw _ _ x hx hcp hlen
    exact newKnowers_target (List.mem_flatMap.2 ⟨j, List.mem_range.2 hj, List.mem_map.2 ⟨t, ht, rfl⟩⟩)
      (Nat.zero_le _) hxt

/-! ## Commits made apart -/

theorem step_commit (st : Tree) (u : SignerId) (to : List (Place × TKey)) (saw : List Nat) :
    st.step (.commit u to saw) = { st.commit u to saw with now := st.now + 1 } := rfl

theorem commit_landed {st : Tree} {u : SignerId} {to : List (Place × TKey)} {saw : List Nat} {p : Place}
    (hp : st.placeOf u = some p) (ht : to.all (st.targetOk p) = true) : st.commit u to saw = st.landed u p to saw := by
  unfold commit
  rw [hp]
  exact ite_eq_left ht

theorem draft_eq {st : Tree} {u : SignerId} {p : Place} (hp : st.placeOf u = some p) :
    st.draft u = .commit u (st.draftTo p) ((List.range p.length).flatMap fun j => st.current (p.take j)) := by
  unfold draft
  rw [hp]

theorem clean_landed {st : Tree} (hw : WF st) {u : SignerId} {p : Place} {to : List (Place × TKey)}
    {saw : List Nat} {t : TKey} (h : st.clean t = true) : (st.landed u p to saw).clean t = true := by
  cases t with
  | leaf d => exact h
  | node q c =>
    simp only [clean, Bool.and_eq_true, List.contains_iff_mem, List.all_eq_true] at h ⊢
    have hlt := hw.written q c h.1
    refine ⟨?_, ?_⟩
    · rw [landed_written]; split <;> simp [h.1]
    · rw [landed_knowers, ite_eq_right (fun hc => absurd hc.2 (by omega))]; exact h.2
  | epoch g c => exact h

/-- A seal a commit may make stays one after another commit counts. -/
theorem targetOk_landed {st : Tree} (hw : WF st) {u : SignerId} {p : Place} {to : List (Place × TKey)}
    {saw : List Nat} {p' : Place} {nt : Place × TKey} (h : st.targetOk p' nt = true) :
    (st.landed u p to saw).targetOk p' nt = true := by
  rw [targetOk_iff] at h ⊢
  obtain ⟨h1, h2, h3, h4⟩ := h
  exact ⟨h1, h2, clean_landed hw h3, h4⟩

/-- Two members that commit apart on the same tree, in either order: both commits count, each starts a key of the
    epoch, and each node on both paths holds both secrets, which the next commit seals to. -/
theorem concurrent_keep_both (h : Nat) (cs : List Change) {u v : SignerId} {p p' : Place}
    (hu : (run h cs).placeOf u = some p) (hv : (run h cs).placeOf v = some p') :
    (run h (cs ++ [(run h cs).draft u, (run h cs).draft v])).keys (run h cs).epoch =
        (run h cs).keys (run h cs).epoch ++ [(run h cs).now, (run h cs).now + 1] ∧
      ∀ q, onPath p q = true → onPath p' q = true →
        (run h cs).now ∈ (run h (cs ++ [(run h cs).draft u, (run h cs).draft v])).current q ∧
        (run h cs).now + 1 ∈ (run h (cs ++ [(run h cs).draft u, (run h cs).draft v])).current q := by
  have hw := wf_run h cs
  generalize hst : run h cs = st at hu hv hw ⊢
  have hT : run h (cs ++ [st.draft u, st.draft v]) = (st.step (st.draft u)).step (st.draft v) := by
    rw [← hst]; simp only [run, List.foldl_append, List.foldl_cons, List.foldl_nil]
  rw [hT]
  let sawU := (List.range p.length).flatMap fun j => st.current (p.take j)
  let sawV := (List.range p'.length).flatMap fun j => st.current (p'.take j)
  have h1 : st.step (st.draft u) = { st.landed u p (st.draftTo p) sawU with now := st.now + 1 } := by
    rw [draft_eq hu, step_commit, commit_landed hu (draftTo_ok hw)]
  have hv1 : (st.step (st.draft u)).placeOf v = some p' := by rw [h1]; exact hv
  have hok : (st.draftTo p').all ((st.step (st.draft u)).targetOk p') = true := by
    rw [List.all_eq_true]; intro nt hnt
    rw [h1]
    exact targetOk_landed (saw := sawU) hw (List.all_eq_true.1 (draftTo_ok hw) nt hnt)
  have h2 : (st.step (st.draft u)).step (st.draft v) =
      { (st.step (st.draft u)).landed v p' (st.draftTo p') sawV with now := (st.step (st.draft u)).now + 1 } := by
    rw [draft_eq hv, step_commit, commit_landed hv1 hok]
  rw [h2]
  have hn1 : (st.step (st.draft u)).now = st.now + 1 := by rw [h1]
  have he1 : (st.step (st.draft u)).epoch = st.epoch := by rw [h1]; rfl
  refine ⟨?_, fun q hq hq' => ?_⟩
  · show ((st.step (st.draft u)).landed v p' (st.draftTo p') sawV).keys st.epoch = _
    rw [landed_keys, he1, ite_eq_left rfl, hn1, h1]
    show (st.landed u p (st.draftTo p) sawU).keys st.epoch ++ [st.now + 1] = _
    rw [landed_keys, ite_eq_left rfl]
    simp
  · show st.now ∈ ((st.step (st.draft u)).landed v p' (st.draftTo p') sawV).current q ∧
      st.now + 1 ∈ ((st.step (st.draft u)).landed v p' (st.draftTo p') sawV).current q
    rw [landed_current, ite_eq_left hq', hn1]
    refine ⟨List.mem_cons_of_mem _ (List.mem_filter.2 ⟨?_, ?_⟩), List.mem_cons_self⟩
    · rw [h1]
      show st.now ∈ (st.landed u p (st.draftTo p) sawU).current q
      rw [landed_current, ite_eq_left hq]
      exact List.mem_cons_self
    · -- the second commit saw nothing written after the tree it was drafted on
      have hno : st.now ∉ sawV := by
        intro hs
        obtain ⟨j, -, hj⟩ := List.mem_flatMap.1 hs
        have := hw.written _ _ (hw.current _ _ hj).1
        omega
      simpa using hno

/-- A commit drafted before a removal it hadn't seen, which seals to a key the removed device opens, doesn't count when
    it comes after the removal in the replay order: the tree and its seals stay as the removal left them. -/
theorem stale_commit_cut (h : Nat) (cs : List Change) {u r : SignerId} {p : Place}
    (hu : (run h cs).placeOf u = some p) (hr : ∃ nt ∈ (run h cs).draftTo p, r ∈ (run h cs).knowersOf nt.2) :
    (run h (cs ++ [.remove r, (run h cs).draft u])).keys = (run h (cs ++ [.remove r])).keys ∧
      (run h (cs ++ [.remove r, (run h cs).draft u])).seals = (run h (cs ++ [.remove r])).seals ∧
      (run h (cs ++ [.remove r, (run h cs).draft u])).current = (run h (cs ++ [.remove r])).current := by
  have hw := wf_run h cs
  generalize hst : run h cs = st at hu hr hw ⊢
  have h1 : run h (cs ++ [.remove r]) = st.step (.remove r) := by
    rw [← hst]; simp only [run, List.foldl_append, List.foldl_cons, List.foldl_nil]
  have h2 : run h (cs ++ [.remove r, st.draft u]) = (st.step (.remove r)).step (st.draft u) := by
    rw [← hst]; simp only [run, List.foldl_append, List.foldl_cons, List.foldl_nil]
  rw [h1, h2]
  obtain ⟨nt, hnt, hrk⟩ := hr
  -- after the removal, `r` opens the key, and is no member
  have hk : (st.step (.remove r)).knowersOf nt.2 = st.knowersOf nt.2 := by
    show (st.remove r).knowersOf nt.2 = st.knowersOf nt.2
    unfold Tree.remove; split <;> rfl
  have hout : (st.step (.remove r)).isMember r = false := by
    show (st.remove r).isMember r = false
    unfold Tree.remove
    split
    · rw [left_isMember]; simp
    · rename_i h; simpa using h
  have hcut : (st.step (.remove r)).commit u (st.draftTo p)
      ((List.range p.length).flatMap fun j => st.current (p.take j)) = st.step (.remove r) := by
    unfold commit
    split
    · rfl
    · rename_i p'' _
      rw [ite_eq_right]
      intro hall
      have hok := targetOk_iff.1 (List.all_eq_true.1 hall nt hnt)
      have := clean_knowers hok.2.2.1 r (by rw [hk]; exact hrk)
      rw [hout] at this; cases this
  rw [draft_eq hu, step_commit, hcut]
  exact ⟨rfl, rfl, rfl⟩

end AvenDB.Trees
