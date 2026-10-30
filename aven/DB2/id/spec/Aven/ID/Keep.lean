/-! # Keepers: fetch keys that chain, proofs, and who pays

Keeping is a role any peer can take (A22, Samuel, 30 Oct 2026). A member's own Peer, or the Aven Peer, keeps a Doc's
sealed bytes for its readers under a keep cap, and none is special. A keeper reads no caps, so it checks who may add
or fetch by key proofs alone:
- fetch keys chain from the Doc's genesis, each link signed by the key before it, one epoch deeper. A keeper takes
  exactly the keys that chain: none other (`fetch_chain`), and every successor (`kept_every`);
- where two links follow one key, it takes as current the one with the smaller epoch hash, at each fork from the
  genesis on, as writers do. Keepers holding the same links agree on it whatever order they came in
  (`current_agrees`), and it is a key that chains (`current_chained`);
- it flags every fork (`fork_flagged`);
- it serves a fetch, and takes an upload, only from a device that signs the connection's TLS exporter with the current
  fetch key (`served_current`). The uploading vault pays, and only for what the keeper took from it
  (`uploader_pays`).

Hashes and keys are numbers, as `Network`'s ticket hashes are: `Aven.Core`'s 32-byte values, read big-endian. Two
links with one epoch hash and different keys can only be forged, and the smaller key goes first. A link's `n` is its
key blob's `n`, the epoch's depth from the genesis.

**What a keeper can't tell** (`grind_example`). A reader of an earlier epoch still holds that epoch's fetch key, so it
can fork the chain there and grind its epoch hash below the writers'. Writers check the rotation's cap and don't take
its epoch. A keeper can't, so it takes the fork as current and flags it. How such a fork settles is the caps spec's
open question 1.

Examples are checked by `decide` and exported as vectors (`keep.json`). -/

namespace Aven.ID

/-- A fetch key's link: its Doc, its epoch's depth and hash, the new fetch key's public half, the key before it, and
the key whose signature the link carries, over the rest. -/
structure FetchLink where
  doc : String
  n : Nat
  epoch : Nat
  key : Nat
  prev : Nat
  signer : Nat
  deriving DecidableEq, Repr

/-- What a keeper holds for one Doc: the Doc, its first fetch key from the genesis, and every link that came, in the
order it came. -/
structure Keep where
  doc : String
  genesis : Nat
  links : List FetchLink
  deriving Repr

/-- `a` goes before `b`: a smaller epoch hash, or the same hash and a key no larger. -/
def FetchLink.before (a b : FetchLink) : Bool :=
  decide (a.epoch < b.epoch) || (a.epoch == b.epoch && decide (a.key ≤ b.key))

/-- The link that goes first. -/
def least : List FetchLink → Option FetchLink
  | [] => none
  | l :: ls =>
    match least ls with
    | none => some l
    | some m => if l.before m then some l else some m

theorem before_total (a b : FetchLink) : a.before b = true ∨ b.before a = true := by
  simp only [FetchLink.before, Bool.or_eq_true, Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq]
  omega

theorem least_none : ∀ {ls : List FetchLink}, least ls = none → ls = []
  | [], _ => rfl
  | l :: ls, h => by
    simp only [least] at h
    split at h <;> (try split at h) <;> contradiction

/-- The link that goes first is one of them, and goes before every other. -/
theorem least_min :
    ∀ {ls : List FetchLink} {w : FetchLink}, least ls = some w → w ∈ ls ∧ ∀ l ∈ ls, w.before l = true
  | [], _, h => nomatch h
  | c :: cs, w, h => by
    have refl : ∀ a : FetchLink, a.before a = true := fun a => by simp [FetchLink.before]
    have trans : ∀ a b c : FetchLink, a.before b = true → b.before c = true → a.before c = true := by
      intro a b c ab bc
      simp only [FetchLink.before, Bool.or_eq_true, Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq] at ab bc ⊢
      omega
    simp only [least] at h
    split at h
    · rename_i n
      cases h
      have e := least_none n
      subst e
      exact ⟨List.mem_singleton.mpr rfl, fun x m => by simp only [List.mem_singleton] at m; subst m; exact refl _⟩
    · rename_i w' s
      have ⟨wm, wmin⟩ := least_min s
      split at h
      · rename_i le
        cases h
        refine ⟨List.mem_cons_self, fun x m => ?_⟩
        rcases List.mem_cons.mp m with e | m
        · exact e ▸ refl _
        · exact trans _ _ _ le (wmin x m)
      · rename_i lt
        cases h
        refine ⟨List.mem_cons_of_mem _ wm, fun x m => ?_⟩
        rcases List.mem_cons.mp m with e | m
        · rw [e]
          exact (before_total w c).resolve_right lt
        · exact wmin x m

/-- Lists with the same links have the same first, up to its epoch hash and key. -/
theorem least_agrees {ls ms : List FetchLink} (same : ∀ l, l ∈ ls ↔ l ∈ ms) :
    (least ls).map (fun l => (l.epoch, l.key)) = (least ms).map (fun l => (l.epoch, l.key)) := by
  cases hw : least ls with
  | none =>
    have e := least_none hw
    subst e
    cases hv : least ms with
    | none => rfl
    | some v => exact absurd ((same v).mpr (least_min hv).1) (by simp)
  | some w =>
    cases hv : least ms with
    | none =>
      have e := least_none hv
      subst e
      exact absurd ((same w).mp (least_min hw).1) (by simp)
    | some v =>
      have wv := (least_min hw).2 v ((same v).mpr (least_min hv).1)
      have vw := (least_min hv).2 w ((same w).mp (least_min hw).1)
      simp only [FetchLink.before, Bool.or_eq_true, Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq] at wv vw
      have e : w.epoch = v.epoch := by omega
      have k : w.key = v.key := by omega
      simp only [Option.map, e, k]

namespace Keep

/-- The links a keeper takes from key `k` at depth `i`: for its Doc, one epoch deeper, after `k`, and signed by it. -/
def successors (s : Keep) (i k : Nat) : List FetchLink :=
  s.links.filter fun l => l.doc == s.doc && l.n == i + 1 && l.prev == k && l.signer == k

theorem mem_successors {s : Keep} {i k : Nat} {l : FetchLink} :
    l ∈ s.successors i k ↔ l ∈ s.links ∧ l.doc = s.doc ∧ l.n = i + 1 ∧ l.prev = k ∧ l.signer = k := by
  simp [successors, and_assoc]

/-- The fetch keys a keeper takes at depth `i`: the genesis's, then the keys of the links after them. -/
def level (s : Keep) : Nat → List Nat
  | 0 => [s.genesis]
  | i + 1 => (s.level i).flatMap fun k => (s.successors i k).map (·.key)

/-- A chain from the genesis to `k` at depth `i`, each link signed by the key before it, one epoch deeper. -/
inductive Chained (s : Keep) : Nat → Nat → Prop
  | genesis : Chained s 0 s.genesis
  | link {i : Nat} {l : FetchLink} : Chained s i l.prev → l ∈ s.links → l.doc = s.doc → l.n = i + 1 →
      l.signer = l.prev → Chained s (i + 1) l.key

/-- Every fetch key a keeper takes chains back to the Doc's genesis, each link signed by the key before it. A key
signed by anyone else, for another Doc, or after a key that doesn't chain, is never taken. -/
theorem fetch_chain {s : Keep} : ∀ {i k : Nat}, k ∈ s.level i → Chained s i k
  | 0, k, h => by
    simp only [level, List.mem_singleton] at h
    exact h ▸ .genesis
  | i + 1, k, h => by
    simp only [level, List.mem_flatMap, List.mem_map] at h
    obtain ⟨k', hk', l, hl, rfl⟩ := h
    have ⟨m, d, n, p, sg⟩ := mem_successors.mp hl
    have c : Chained s i l.prev := p ▸ fetch_chain hk'
    exact Chained.link c m d n (sg.trans p.symm)

/-- A keeper keeps every successor: every key that chains is taken. -/
theorem kept_every {s : Keep} : ∀ {i k : Nat}, Chained s i k → k ∈ s.level i
  | _, _, .genesis => by simp [level]
  | _, _, @Chained.link _ _ l c m d n sg => by
    simp only [level, List.mem_flatMap, List.mem_map]
    exact ⟨l.prev, kept_every c, l, mem_successors.mpr ⟨m, d, n, rfl, sg⟩, rfl⟩

/-- From key `k` at depth `i`, `fuel` steps on: at each fork, the link that goes first. -/
def walk (s : Keep) : Nat → Nat → Nat → Nat
  | 0, _, k => k
  | f + 1, i, k =>
    match least (s.successors i k) with
    | none => k
    | some l => s.walk f (i + 1) l.key

/-- The deepest any link goes, so no walk needs more steps. -/
def depth (s : Keep) : Nat := s.links.foldr (fun l d => max l.n d) 0

/-- The current fetch key: from the genesis, at each fork the smaller epoch hash, to the end. -/
def current (s : Keep) : Nat := s.walk s.depth 0 s.genesis

theorem depth_ge {s : Keep} {l : FetchLink} (m : l ∈ s.links) : l.n ≤ s.depth := by
  unfold depth
  generalize s.links = ls at m ⊢
  induction ls with
  | nil => simp at m
  | cons x xs ih =>
    simp only [List.foldr_cons]
    rcases List.mem_cons.mp m with e | m
    · subst e; exact Nat.le_max_left _ _
    · exact Nat.le_trans (ih m) (Nat.le_max_right _ _)

theorem depth_mem {s : Keep} : s.depth = 0 ∨ ∃ l ∈ s.links, l.n = s.depth := by
  unfold depth
  generalize s.links = ls
  induction ls with
  | nil => simp
  | cons x xs ih =>
    simp only [List.foldr_cons, List.mem_cons]
    rcases Nat.le_total x.n (xs.foldr (fun l d => max l.n d) 0) with le | le
    · rw [Nat.max_eq_right le]
      rcases ih with z | ⟨l, m, e⟩
      · exact .inl z
      · exact .inr ⟨l, .inr m, e⟩
    · rw [Nat.max_eq_left le]
      exact .inr ⟨x, .inl rfl, rfl⟩

/-- The current fetch key chains back to the genesis. -/
theorem current_chained (s : Keep) : ∃ i, Chained s i s.current := by
  suffices h : ∀ f i k, Chained s i k → ∃ j, Chained s j (s.walk f i k) from h _ _ _ .genesis
  intro f
  induction f with
  | zero => exact fun i k c => ⟨i, c⟩
  | succ f ih =>
    intro i k c
    simp only [walk]
    split
    · exact ⟨i, c⟩
    · rename_i l hl
      have ⟨m, d, n, p, sg⟩ := mem_successors.mp (least_min hl).1
      have c' : Chained s i l.prev := p ▸ c
      exact ih _ _ (Chained.link c' m d n (sg.trans p.symm))

/-- Keepers of one Doc holding the same links, in whatever order they came, take the same current fetch key. -/
theorem current_agrees {s t : Keep} (doc : s.doc = t.doc) (genesis : s.genesis = t.genesis)
    (same : ∀ l, l ∈ s.links ↔ l ∈ t.links) : s.current = t.current := by
  have succ : ∀ i k l, l ∈ s.successors i k ↔ l ∈ t.successors i k := by
    intro i k l
    simp only [mem_successors, same l, doc]
  have walks : ∀ f i k, s.walk f i k = t.walk f i k := by
    intro f
    induction f with
    | zero => intro i k; rfl
    | succ f ih =>
      intro i k
      have a := least_agrees (succ i k)
      simp only [walk]
      cases hs : least (s.successors i k) <;> cases ht : least (t.successors i k) <;>
        simp only [hs, ht, Option.map, reduceCtorEq, Option.some.injEq, Prod.mk.injEq] at a ⊢
      · rename_i l m
        rw [a.2]
        exact ih _ _
  have deep : s.depth = t.depth := by
    have st : ∀ {a b : Keep}, (∀ l, l ∈ a.links → l ∈ b.links) → a.depth ≤ b.depth := by
      intro a b sub
      rcases depth_mem (s := a) with z | ⟨l, m, e⟩
      · omega
      · rw [← e]
        exact depth_ge (sub l m)
    exact Nat.le_antisymm (st fun l => (same l).mp) (st fun l => (same l).mpr)
  simp only [current, deep, genesis, walks]

/-- A fork: two links the keeper takes from one key, to different keys. -/
def forked (s : Keep) (i k : Nat) : Bool :=
  (s.successors i k).any fun l => (s.successors i k).any fun m => l.key != m.key

/-- Every fork on the chain, flagged by its depth and the key it forks from. -/
def flags (s : Keep) : List (Nat × Nat) :=
  (List.range s.depth).flatMap fun i => ((s.level i).filter (s.forked i)).map ((i, ·))

/-- Every fork the keeper takes is flagged. -/
theorem fork_flagged {s : Keep} {i k : Nat} {l m : FetchLink} (c : Chained s i k) (hl : l ∈ s.successors i k)
    (hm : m ∈ s.successors i k) (ne : l.key ≠ m.key) : (i, k) ∈ s.flags := by
  have f : s.forked i k = true := by
    simp only [forked, List.any_eq_true, bne_iff_ne, ne_eq]
    exact ⟨l, hl, m, hm, ne⟩
  have lt : i < s.depth := by
    have ⟨lm, _, n, _⟩ := mem_successors.mp hl
    have := depth_ge lm
    omega
  simp only [flags, List.mem_flatMap, List.mem_range, List.mem_map, List.mem_filter]
  exact ⟨i, lt, k, ⟨kept_every c, f⟩, rfl⟩

/-- A device's proof on one connection: the device, its vault as the door's tree says, the fetch key it signed with,
and the TLS exporter it signed. -/
structure Proof where
  device : String
  vault : String
  key : Nat
  exporter : String
  deriving DecidableEq, Repr

/-- The keeper serves a fetch, or takes an upload, on the connection with `exporter` only for a proof over that
exporter by the current fetch key. -/
def serves (s : Keep) (exporter : String) (p : Proof) : Bool := p.key == s.current && p.exporter == exporter

/-- A device served holds the current fetch key, which chains back to the genesis, and proved it on this connection:
a proof made for another connection is refused. -/
theorem served_current {s : Keep} {e : String} {p : Proof} (h : s.serves e p = true) :
    p.key = s.current ∧ p.exporter = e ∧ ∃ i, Chained s i p.key := by
  simp only [serves, Bool.and_eq_true, beq_iff_eq] at h
  exact ⟨h.1, h.2, h.1 ▸ current_chained s⟩

/-- An upload: its proof, the connection's exporter, and its padded size. -/
structure Upload where
  proof : Proof
  exporter : String
  bytes : Nat
  deriving DecidableEq, Repr

/-- What a vault pays: the bytes of the uploads the keeper took from its devices. -/
def bill (s : Keep) (ups : List Upload) (vault : String) : Nat :=
  ups.foldr (fun u b => (if s.serves u.exporter u.proof && u.proof.vault == vault then u.bytes else 0) + b) 0

/-- The uploading vault pays: one more upload adds its bytes to its own vault's bill if the keeper took it, and
nothing to anyone else's. -/
theorem uploader_pays (s : Keep) (ups : List Upload) (u : Upload) (vault : String) :
    s.bill (u :: ups) vault =
      s.bill ups vault + if s.serves u.exporter u.proof && u.proof.vault == vault then u.bytes else 0 := by
  simp only [bill, List.foldr_cons]
  exact Nat.add_comm _ _

end Keep

/-! ## Examples

Alice's Doc `d1`, its first fetch key 100. Alice removes Bob and rotates: epoch hash 7, fetch key 201. Her other
device rotated at the same time (epoch hash 9, fetch key 202), and a later rotation built on that one (302). Alice
rotates again from 201 (301). Five links that a keeper must not take come too: one Carol signed with her own key, one
for `d2`, one after a key that doesn't chain, and one at the wrong depth.

Then the limit: Bob, removed, still holds 100. He forks from it and grinds his epoch hash to 3, below Alice's 7. -/

namespace KeepExamples

open Keep

def rotation : FetchLink := ⟨"d1", 1, 7, 201, 100, 100⟩
def concurrent : FetchLink := ⟨"d1", 1, 9, 202, 100, 100⟩
def onConcurrent : FetchLink := ⟨"d1", 2, 2, 302, 202, 202⟩
def again : FetchLink := ⟨"d1", 2, 5, 301, 201, 201⟩
def carolsLink : FetchLink := ⟨"d1", 1, 1, 666, 100, 999⟩
def otherDoc : FetchLink := ⟨"d2", 1, 1, 667, 100, 100⟩
def offChain : FetchLink := ⟨"d1", 1, 1, 668, 555, 555⟩
def wrongDepth : FetchLink := ⟨"d1", 2, 1, 669, 100, 100⟩
def bobsFork : FetchLink := ⟨"d1", 1, 3, 401, 100, 100⟩

def keepD1 : Keep :=
  ⟨"d1", 100, [rotation, concurrent, onConcurrent, again, carolsLink, otherDoc, offChain, wrongDepth]⟩
def keepD1Reversed : Keep := { keepD1 with links := keepD1.links.reverse }
def keepNothing : Keep := ⟨"d1", 100, [carolsLink, otherDoc, offChain, wrongDepth]⟩
def keepGround : Keep := ⟨"d1", 100, [rotation, bobsFork]⟩

/-- Each keeper's current fetch key and flags. -/
def keepCases : List (String × Keep × Nat × List (Nat × Nat)) :=
  [("two rotations at once, then one more", keepD1, 301, [(0, 100)]),
   ("the same links in the reverse order", keepD1Reversed, 301, [(0, 100)]),
   ("no link chains", keepNothing, 100, []),
   ("a removed reader's ground fork", keepGround, 401, [(0, 100)])]

def alicesPhone : Proof := ⟨"alice-peer-light", "alice", 301, "x-1"⟩
def alicesStale : Proof := ⟨"alice-peer-light", "alice", 201, "x-1"⟩
def carolsProof : Proof := ⟨"carol-peer", "carol", 666, "x-6"⟩
def alicesAfterFork : Proof := ⟨"alice-peer-light", "alice", 201, "x-3"⟩
def bobsAfterFork : Proof := ⟨"bob-peer-light", "bob", 401, "x-4"⟩

/-- Proofs at a keeper, on a connection, and whether it serves them. -/
def proofCases : List (String × Keep × String × Proof × Bool) :=
  [("the current fetch key", keepD1, "x-1", alicesPhone, true),
   ("an older fetch key", keepD1, "x-1", alicesStale, false),
   ("a proof made for another connection", keepD1, "x-2", alicesPhone, false),
   ("a key that doesn't chain", keepD1, "x-6", carolsProof, false),
   ("after a ground fork, the writers' key", keepGround, "x-3", alicesAfterFork, false),
   ("after a ground fork, the forker's key", keepGround, "x-4", bobsAfterFork, true)]

/-- Uploads at the keeper of `d1`: Alice's taken, Bob's under an older key and Alice's replayed proof refused. -/
def uploads : List Upload :=
  [⟨alicesPhone, "x-1", 4096⟩, ⟨⟨"bob-peer-light", "bob", 201, "x-5"⟩, "x-5", 1024⟩,
   ⟨alicesPhone, "x-2", 512⟩]

def billCases : List (String × Nat) := [("alice", 4096), ("bob", 0)]

theorem keep_examples :
    (keepCases.all fun (_, s, c, f) => s.current == c && s.flags == f) &&
    (proofCases.all fun (_, s, e, p, b) => s.serves e p == b) &&
    (billCases.all fun (v, b) => keepD1.bill uploads v == b) = true := by decide

/-- What a keeper can't tell: Bob, removed, forks from the key he still holds, and his smaller hash becomes current.
The keeper flags the fork; Alice's writers never take his epoch. -/
theorem grind_example : keepGround.current = bobsFork.key ∧ (0, 100) ∈ keepGround.flags ∧
    keepGround.serves "x-3" alicesAfterFork = false := by decide

end KeepExamples

end Aven.ID
