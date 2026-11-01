import Aven.ID.Keeping

/-! # Keepers: fetch keys that chain, proofs, and what a keeper keeps for whom

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
  fetch key (`served_current`).

Caps' half of a keeper's gate answers two things: who may fetch or upload (the fetch-key chain and its proof), and how
much the keeper keeps for a vault (`Books.quota`, from its own offers). Who pays, and what a keeper takes within the
quota, are the keeper's own, since only it sees each item's uploaders (`Aven.Peer.Serve`, A44, A45).

Hashes and keys are numbers, as `Network`'s ticket hashes are: `Aven.Core`'s 32-byte values, read big-endian. Two
links with one epoch hash and different keys can only be forged, and the smaller key goes first. A link's `n` is its
key blob's `n`, the epoch's depth from the genesis. The bytes a backend signs and checks, each a Core signed thing, are
`Aven.ID.KeepCbor`'s (A30).

**How a ground fork settles** (A22, the architect's answer, 30 Oct 2026). A reader of an earlier epoch still holds that
epoch's fetch key, so it can fork the chain there and grind its epoch hash below the writers' (`grind_example`).
Writers check the rotation's cap and don't take its epoch. A keeper can't, so it flags the fork and, while it is
unsettled, serves proofs by any branch's newest key, so honest readers are never refused (`fork_served`). A device of
the vault that issued the keep cap, which can check caps, signs which branch to follow; the keeper checks the signer
against the tree, follows that branch, and later forks from that point change nothing (`grind_settled`,
`settled_example`).

**What a keeper keeps, and for whom** (A22, Samuel, 31 Oct 2026: "a vault owner always decides, where its data gets
shared to"). A keeper keeps a vault's data only under a keep cap that vault's owners approved, naming the keeper. It
holds its keep caps, so it checks each against the tree: the cap names the keeper's vault, a device of its issuer
signed it, and its issuer's owners approved it (D14). It can't read a Doc's facts, so it takes the Docs the issuer's
device resolved the cap's target to (`resolve_exact`). A device of the issuing vault withdraws a keep cap, or deletes
a Doc, by an order the keeper checks against the tree. A withdrawal or a delete only takes away, so a device signs it
alone, as it signs a revocation. The theorems: whatever a keeper keeps, an owner-approved keep cap lists
(`kept_only_covered`, `kept_only_by_owner`), and by its facts covers, a cap in its issuer's authority
(`kept_by_owner`); a withdrawn keep cap's Docs are dropped and served no more (`withdrawn_dropped`,
`withdrawn_not_served`), and the others stay (`others_kept`); a deleted Doc is gone for good (`deleted_gone`,
`deleted_final`).

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

/-- The keep cap's issuer settling a fork: the depth and key the fork is from, the key of the branch to follow, and the
device that signed it. -/
structure Choice where
  depth : Nat
  fork : Nat
  branch : Nat
  signer : String
  deriving DecidableEq, Repr

/-- What a keeper holds for one Doc: the Doc, its first fetch key from the genesis, every link that came, in the order
it came, the devices of the vault that issued its keep cap (as the tree says), and that vault's choices at forks. -/
structure Keep where
  doc : String
  genesis : Nat
  links : List FetchLink
  issuer : List String := []
  choices : List Choice := []
  deriving Repr

/-- The smallest of some numbers. -/
def smallest : List Nat → Option Nat
  | [] => none
  | x :: xs =>
    match smallest xs with
    | none => some x
    | some m => some (min x m)

theorem smallest_spec : ∀ {l : List Nat} {m : Nat}, smallest l = some m → m ∈ l ∧ ∀ x ∈ l, m ≤ x
  | [], _, h => nomatch h
  | x :: xs, m, h => by
    simp only [smallest] at h
    split at h
    · rename_i n
      cases h
      have : xs = [] := by
        cases xs with
        | nil => rfl
        | cons y ys =>
          simp only [smallest] at n
          split at n <;> cases n
      subst this
      exact ⟨List.mem_singleton.mpr rfl, fun y m => by simp at m; omega⟩
    · rename_i m' e
      cases h
      have ⟨mm, mmin⟩ := smallest_spec e
      refine ⟨?_, fun y my => ?_⟩
      · rcases Nat.le_total x m' with le | le
        · rw [Nat.min_eq_left le]; exact List.mem_cons_self
        · rw [Nat.min_eq_right le]; exact List.mem_cons_of_mem _ mm
      · rcases List.mem_cons.mp my with rfl | my
        · exact Nat.min_le_left _ _
        · exact Nat.le_trans (Nat.min_le_right _ _) (mmin y my)

theorem smallest_none : ∀ {l : List Nat}, smallest l = none → l = []
  | [], _ => rfl
  | x :: xs, h => by
    simp only [smallest] at h
    split at h <;> cases h

/-- Lists with the same numbers have the same smallest. -/
theorem smallest_set {l l' : List Nat} (h : ∀ x, x ∈ l ↔ x ∈ l') : smallest l = smallest l' := by
  cases hl : smallest l with
  | none =>
    have e := smallest_none hl
    subst e
    cases hl' : smallest l' with
    | none => rfl
    | some m => exact absurd ((h m).mpr (smallest_spec hl').1) (by simp)
  | some m =>
    cases hl' : smallest l' with
    | none =>
      have e := smallest_none hl'
      subst e
      exact absurd ((h m).mp (smallest_spec hl).1) (by simp)
    | some m' =>
      have a := (smallest_spec hl).2 m' ((h m').mpr (smallest_spec hl').1)
      have b := (smallest_spec hl').2 m ((h m).mp (smallest_spec hl).1)
      rw [Nat.le_antisymm a b]

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

/-- The branch the keep cap's issuer chose at the fork from `k` at depth `i`: by a device of the issuing vault, which
the keeper checks against the tree, naming a key the keeper keeps there. Its devices choose alike; were two choices
different, the smaller key. -/
def chosen (s : Keep) (i k : Nat) : Option Nat :=
  smallest ((s.choices.filter fun ch => ch.depth == i && ch.fork == k && s.issuer.contains ch.signer &&
    (s.successors i k).any (·.key == ch.branch)).map (·.branch))

/-- Where a keeper goes from `k` at depth `i`: the issuer's choice if it made one, else the smaller epoch hash. -/
def next (s : Keep) (i k : Nat) : Option Nat :=
  match s.chosen i k with
  | some c => some c
  | none => (least (s.successors i k)).map (·.key)

/-- From key `k` at depth `i`, `fuel` steps on. -/
def walk (s : Keep) : Nat → Nat → Nat → Nat
  | 0, _, k => k
  | f + 1, i, k =>
    match s.next i k with
    | none => k
    | some c => s.walk f (i + 1) c

/-- The deepest any link goes, so no walk needs more steps. -/
def depth (s : Keep) : Nat := s.links.foldr (fun l d => max l.n d) 0

/-- The current fetch key: from the genesis, at each fork the issuer's choice or the smaller epoch hash, to the end. -/
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

/-- Where a keeper goes next is a key it keeps there. -/
theorem next_kept {s : Keep} {i k c : Nat} (h : s.next i k = some c) : ∃ l ∈ s.successors i k, l.key = c := by
  unfold next at h
  split at h
  · rename_i c' e
    cases h
    obtain ⟨m, _⟩ := smallest_spec e
    simp only [List.mem_map, List.mem_filter, Bool.and_eq_true, List.any_eq_true, beq_iff_eq] at m
    obtain ⟨ch, ⟨_, _, l, hl, kl⟩, rfl⟩ := m
    exact ⟨l, hl, kl⟩
  · cases e : least (s.successors i k) with
    | none => simp [e] at h
    | some l =>
      simp only [e, Option.map_some, Option.some.injEq] at h
      exact ⟨l, (least_min e).1, h⟩

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
    · rename_i n hn
      obtain ⟨l, hl, e⟩ := next_kept hn
      have ⟨m, d, nn, p, sg⟩ := mem_successors.mp hl
      have c' : Chained s i l.prev := p ▸ c
      exact e ▸ ih _ _ (Chained.link c' m d nn (sg.trans p.symm))

/-- Keepers of one Doc holding the same links and the same choices, in whatever order they came, take the same current
fetch key. -/
theorem current_agrees {s t : Keep} (doc : s.doc = t.doc) (genesis : s.genesis = t.genesis)
    (same : ∀ l, l ∈ s.links ↔ l ∈ t.links) (issuer : ∀ d, d ∈ s.issuer ↔ d ∈ t.issuer)
    (choices : ∀ c, c ∈ s.choices ↔ c ∈ t.choices) : s.current = t.current := by
  have succ : ∀ i k l, l ∈ s.successors i k ↔ l ∈ t.successors i k := by
    intro i k l
    simp only [mem_successors, same l, doc]
  have nexts : ∀ i k, s.next i k = t.next i k := by
    intro i k
    have ch : s.chosen i k = t.chosen i k := by
      apply smallest_set
      intro x
      simp only [List.mem_map, List.mem_filter, Bool.and_eq_true, List.any_eq_true, beq_iff_eq,
        List.contains_iff_mem, choices, issuer, succ]
    have a := least_agrees (succ i k)
    unfold next
    rw [ch]
    cases t.chosen i k with
    | some c => rfl
    | none =>
      cases hs : least (s.successors i k) <;> cases ht : least (t.successors i k) <;>
        simp only [hs, ht, Option.map, reduceCtorEq, Option.some.injEq, Prod.mk.injEq] at a ⊢
      exact a.2
  have walks : ∀ f i k, s.walk f i k = t.walk f i k := by
    intro f
    induction f with
    | zero => intro i k; rfl
    | succ f ih =>
      intro i k
      simp only [walk, nexts i k]
      split
      · rfl
      · exact ih _ _
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

/-- A flagged fork the keep cap's issuer hasn't settled yet. -/
def unsettled (s : Keep) : Bool := s.flags.any fun (i, k) => (s.chosen i k).isNone

/-- A branch's newest key: one the keeper keeps that nothing follows. -/
def newest (s : Keep) (k : Nat) : Bool :=
  (List.range (s.depth + 1)).any fun i => (s.level i).contains k && (s.successors i k).isEmpty

/-- The keeper serves a fetch, or takes an upload, on the connection with `exporter` only for a proof over that
exporter by the current fetch key, or, while a fork is unsettled, by any branch's newest key (A22, 30 Oct 2026). -/
def serves (s : Keep) (exporter : String) (p : Proof) : Bool :=
  p.exporter == exporter && (p.key == s.current || (s.unsettled && s.newest p.key))

/-- A device served proved, on this connection, a fetch key that chains back to the genesis: the current one, or a
branch's newest while a fork is unsettled. A proof made for another connection is refused. -/
theorem served_current {s : Keep} {e : String} {p : Proof} (h : s.serves e p = true) :
    p.exporter = e ∧ (p.key = s.current ∨ (s.unsettled = true ∧ s.newest p.key = true)) ∧ ∃ i, Chained s i p.key := by
  simp only [serves, Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true] at h
  refine ⟨h.1, h.2, ?_⟩
  rcases h.2 with c | ⟨_, n⟩
  · exact c ▸ current_chained s
  · simp only [newest, List.any_eq_true, Bool.and_eq_true, List.contains_iff_mem] at n
    obtain ⟨i, _, m, _⟩ := n
    exact ⟨i, fetch_chain m⟩

/-- While a fork is unsettled, a branch's newest key is served, so honest readers are never refused. -/
theorem fork_served {s : Keep} {e : String} {p : Proof} (u : s.unsettled = true) (n : s.newest p.key = true)
    (x : p.exporter = e) : s.serves e p = true := by
  simp [serves, u, n, x]

/-- Once the keep cap's issuer has chosen a branch at a fork, a keeper follows it whatever links arrive after: later
forks from that point, ground or not, change nothing there. -/
theorem grind_settled {s : Keep} {i k c : Nat} {X : List FetchLink}
    (only : ∀ ch ∈ s.choices, ch.depth = i → ch.fork = k → ch.signer ∈ s.issuer → ch.branch = c)
    (h : s.chosen i k = some c) : ({ s with links := s.links ++ X } : Keep).next i k = some c := by
  have sub : ∀ l, l ∈ s.successors i k → l ∈ ({ s with links := s.links ++ X } : Keep).successors i k := by
    intro l m
    have ⟨ml, d, n, p, sg⟩ := mem_successors.mp m
    exact mem_successors.mpr ⟨List.mem_append_left _ ml, d, n, p, sg⟩
  have ch : ({ s with links := s.links ++ X } : Keep).chosen i k = some c := by
    obtain ⟨mc, _⟩ := smallest_spec h
    have all : ∀ x ∈ ((({ s with links := s.links ++ X } : Keep).choices.filter fun ch => ch.depth == i &&
        ch.fork == k && ({ s with links := s.links ++ X } : Keep).issuer.contains ch.signer &&
        (({ s with links := s.links ++ X } : Keep).successors i k).any (·.key == ch.branch)).map (·.branch)), x = c := by
      intro x m
      simp only [List.mem_map, List.mem_filter, Bool.and_eq_true, beq_iff_eq, List.contains_iff_mem] at m
      obtain ⟨ch, ⟨mch, ⟨⟨d, f⟩, sg⟩, _⟩, rfl⟩ := m
      exact only ch mch d f sg
    have mem : c ∈ ((({ s with links := s.links ++ X } : Keep).choices.filter fun ch => ch.depth == i &&
        ch.fork == k && ({ s with links := s.links ++ X } : Keep).issuer.contains ch.signer &&
        (({ s with links := s.links ++ X } : Keep).successors i k).any (·.key == ch.branch)).map (·.branch)) := by
      simp only [List.mem_map, List.mem_filter, Bool.and_eq_true, List.any_eq_true, beq_iff_eq] at mc ⊢
      obtain ⟨ch, ⟨mch, ⟨⟨d, f⟩, sg⟩, l, ml, kl⟩, e⟩ := mc
      exact ⟨ch, ⟨mch, ⟨⟨d, f⟩, sg⟩, l, sub l ml, kl⟩, e⟩
    cases e : smallest ((({ s with links := s.links ++ X } : Keep).choices.filter fun ch => ch.depth == i &&
        ch.fork == k && ({ s with links := s.links ++ X } : Keep).issuer.contains ch.signer &&
        (({ s with links := s.links ++ X } : Keep).successors i k).any (·.key == ch.branch)).map (·.branch)) with
    | none => exact absurd (smallest_none e ▸ mem) (by simp)
    | some m =>
      unfold chosen
      rw [e, all m (smallest_spec e).1]
  unfold next
  rw [ch]

end Keep

/-! ## What a keeper keeps, and for whom (A22) -/

/-- A keep cap as its keeper holds it: the cap, and the Docs its issuer's device resolved its target to, each with its
first fetch key (`resolve`). -/
structure Listing where
  cap : Cap String
  docs : List (Core.DocId × Nat)

/-- What a device of a keep cap's issuer orders its keeper: withdraw that cap, or delete a Doc. -/
inductive Order where
  | withdraw (cap : String)
  | delete (doc : Core.DocId)
  deriving DecidableEq, Repr

/-- A keeper's order, a withdrawal or a delete, and the device that sent it (A45: "signed" is only Core's). -/
structure KeepOrder where
  order : Order
  signer : String
  deriving DecidableEq, Repr

/-- A keeper's books: its own vault, the tree as it holds it, how many owners each vault needs, the keep caps it was
handed, the orders that came, the offers its own vault issued (A44), and who is in each group they name. -/
structure Books where
  keeper : String
  tree : Tree String
  threshold : String → Nat := fun _ => 1
  listings : List Listing
  orders : List KeepOrder := []
  offers : List (Cap String) := []
  inGroup : Core.DocId → String → Bool := fun _ _ => false

namespace Books

variable (b : Books)

/-- A keep cap the keeper takes: a grant to the keeper's vault, signed by its issuer, by a device or its owners (A28),
which its issuer's owners approved, an owner vault by its own quorum (D14). -/
def valid (c : Cap String) : Bool :=
  c.form == .grant && c.holder == .vault b.keeper && b.tree.issued b.threshold c &&
    b.tree.approves b.threshold c.issuer c.id c.approvals

/-- An order a device of vault `v` signed, as the tree says. -/
def signedBy (v : String) (o : KeepOrder) : Bool := b.tree.actsFor o.signer == some v

/-- A keep cap a device of its issuer withdrew. -/
def withdrawn (c : Cap String) : Bool := b.orders.any fun o => o.order == .withdraw c.id && b.signedBy c.issuer o

/-- A Doc a device of vault `v` deleted. -/
def deleted (v : String) (d : Core.DocId) : Bool := b.orders.any fun o => o.order == .delete d && b.signedBy v o

/-- An offer the keeper stands by (A44): a grant of its own vault, signed by it and approved by its owners (D14), not
withdrawn, that offers storage (`keepOffer`). -/
def offerValid (o : Cap String) : Bool :=
  o.form == .grant && o.issuer == b.keeper && b.tree.issued b.threshold o &&
    b.tree.approves b.threshold o.issuer o.id o.approvals && !b.withdrawn o && o.grant.any (·.op == keepOffer)

/-- Whom an offer covers: the vault it names, or every vault in the group it names. -/
def offeredTo (o : Cap String) (v : String) : Bool :=
  match o.holder with
  | .vault w => w == v
  | .group g => b.inGroup g v
  | .«public» => false

/-- The keeper's own offers cover vault `v`. -/
def offered (v : String) : Bool := b.offers.any fun o => b.offerValid o && b.offeredTo o v

/-- How much the keeper keeps for vault `v`: the largest quota of the offers that cover it. The keeper takes uploads
within it (`Aven.Peer.Serve`). -/
def quota (v : String) : Nat :=
  ((b.offers.filter fun o => b.offerValid o && b.offeredTo o v).map (·.offerQuota)).foldr max 0

/-- The keeper keeps `d` under the keep cap `l`: the cap is valid and not withdrawn, it lists `d`, its issuer hasn't
deleted `d`, and the keeper's own offer covers that issuer (A44). -/
def keepsUnder (l : Listing) (d : Core.DocId) : Bool :=
  b.valid l.cap && !b.withdrawn l.cap && l.docs.any (·.1 == d) && !b.deleted l.cap.issuer d && b.offered l.cap.issuer

/-- The keeper keeps `d`: under one of its keep caps. -/
def keeps (d : Core.DocId) : Bool := b.listings.any (b.keepsUnder · d)

/-- The keeper serves a fetch of `d`, or takes an upload for it, only while it keeps `d`, and only for a device that
proves `d`'s current fetch key (`Keep.serves`). -/
def serves (k : Keep) (d : Core.DocId) (exporter : String) (p : Keep.Proof) : Bool := b.keeps d && k.serves exporter p

theorem keepsUnder_iff {l : Listing} {d : Core.DocId} :
    b.keepsUnder l d = true ↔ b.valid l.cap = true ∧ b.withdrawn l.cap = false ∧ (∃ k, (d, k) ∈ l.docs) ∧
      b.deleted l.cap.issuer d = false ∧ b.offered l.cap.issuer = true := by
  simp only [keepsUnder, Bool.and_eq_true, Bool.not_eq_true', List.any_eq_true, beq_iff_eq, Prod.exists]
  constructor
  · rintro ⟨⟨⟨⟨v, w⟩, d', k, m, rfl⟩, nd⟩, o⟩
    exact ⟨v, w, ⟨k, m⟩, nd, o⟩
  · rintro ⟨v, w, ⟨k, m⟩, nd, o⟩
    exact ⟨⟨⟨⟨v, w⟩, d, k, m, rfl⟩, nd⟩, o⟩

/-- **A keeper keeps only what a keep cap covers** (D1): whatever it keeps, a valid keep cap lists, one its issuer
hasn't withdrawn, with the Doc not deleted. -/
theorem kept_only_covered {d : Core.DocId} (h : b.keeps d = true) :
    ∃ l ∈ b.listings, b.valid l.cap = true ∧ b.withdrawn l.cap = false ∧ (∃ k, (d, k) ∈ l.docs) ∧
      b.deleted l.cap.issuer d = false ∧ b.offered l.cap.issuer = true := by
  simp only [keeps, List.any_eq_true] at h
  obtain ⟨l, m, k⟩ := h
  exact ⟨l, m, (b.keepsUnder_iff).mp k⟩

/-- **A keeper keeps only what it offered** (A44): whatever it keeps, the owner's keep cap lists, and one of the
keeper's own offers, valid and not withdrawn, covers that owner: keep caps ∩ offers. -/
theorem kept_only_offered {d : Core.DocId} (h : b.keeps d = true) :
    ∃ l ∈ b.listings, (∃ k, (d, k) ∈ l.docs) ∧
      ∃ o ∈ b.offers, b.offerValid o = true ∧ b.offeredTo o l.cap.issuer = true := by
  obtain ⟨l, m, _, _, ld, _, off⟩ := b.kept_only_covered h
  simp only [offered, List.any_eq_true, Bool.and_eq_true] at off
  obtain ⟨o, mo, v, t⟩ := off
  exact ⟨l, m, ld, o, mo, v, t⟩

/-- **A keeper holds a vault's data only under a keep cap that vault's owners approved** (A22): whatever it keeps, a
keep cap lists that names the keeper, that its issuer signed, and that its issuer's owners approved. That
its issuer is the Doc's own vault, or one that governs it, is the issuer's check and every reader's
(`kept_by_owner`). -/
theorem kept_only_by_owner {d : Core.DocId} (h : b.keeps d = true) :
    ∃ l ∈ b.listings, (∃ k, (d, k) ∈ l.docs) ∧ l.cap.form = .grant ∧ l.cap.holder = .vault b.keeper ∧
      b.tree.issued b.threshold l.cap = true ∧
      b.tree.approves b.threshold l.cap.issuer l.cap.id l.cap.approvals = true := by
  obtain ⟨l, m, v, _, ld, _, _⟩ := b.kept_only_covered h
  simp only [valid, Bool.and_eq_true, beq_iff_eq] at v
  obtain ⟨⟨⟨g, ho⟩, s⟩, a⟩ := v
  exact ⟨l, m, ld, g, ho, s, a⟩

/-- With every list resolved by its issuer's device from the Docs that vault holds, and every keep cap one its issuer
checked, a keeper keeps a Doc only when a keep cap its issuer's owners approved covers it by its facts, every line of it
in its issuer's authority: its own vault, or one it governs. -/
theorem kept_by_owner (gov : Core.Hash → Core.Hash → Bool) (spawned lists : Core.DocId → Core.DocId → Bool)
    (x : Ctx String) (held : String → List (Core.Facts × Nat))
    (resolved : ∀ l ∈ b.listings, l.docs = resolve gov spawned lists x.roles l.cap (held l.cap.issuer))
    (checked : ∀ l ∈ b.listings, chainOk x [l.cap] = true) {d : Core.DocId} (h : b.keeps d = true) :
    ∃ l ∈ b.listings, ∃ f, f.id = d ∧ l.cap.keeps gov spawned lists x.roles f = true ∧
      b.tree.approves b.threshold l.cap.issuer l.cap.id l.cap.approvals = true ∧
      ∀ line ∈ l.cap.grants x.roles, authorityOver x l.cap.issuer line = true := by
  obtain ⟨l, m, ⟨k, ld⟩, _, _, _, a⟩ := b.kept_only_by_owner h
  rw [resolved l m] at ld
  obtain ⟨f, _, fd, kf⟩ := (resolve_exact gov spawned lists).mp ld
  exact ⟨l, m, f, fd, kf, a, root_authority (checked l m) l.cap (List.mem_singleton_self _)⟩

/-- **A withdrawn keep cap is dropped** (D2): once a device of its issuer withdraws every keep cap that lists a Doc,
the keeper keeps it no more. -/
theorem withdrawn_dropped {d : Core.DocId}
    (w : ∀ l ∈ b.listings, (∃ k, (d, k) ∈ l.docs) → b.withdrawn l.cap = true) : b.keeps d = false := by
  cases h : b.keeps d
  · rfl
  · obtain ⟨l, m, _, nw, ld, _, _⟩ := b.kept_only_covered h
    rw [w l m ld] at nw
    exact absurd nw (by decide)

/-- And serves it no more: no fetch of it and no upload for it, whatever proof comes. -/
theorem withdrawn_not_served {d : Core.DocId}
    (w : ∀ l ∈ b.listings, (∃ k, (d, k) ∈ l.docs) → b.withdrawn l.cap = true) (k : Keep) (e : String) (p : Keep.Proof) :
    b.serves k d e p = false := by
  simp [serves, b.withdrawn_dropped w]

theorem any_congr_mem {α : Type} {p q : α → Bool} : ∀ {l : List α}, (∀ a ∈ l, p a = q a) → l.any p = l.any q
  | [], _ => rfl
  | a :: l, h => by
    simp only [List.any_cons, h a List.mem_cons_self, any_congr_mem fun x m => h x (List.mem_cons_of_mem _ m)]

/-- Withdrawing a cap changes no other cap's standing. -/
theorem withdrawn_other {c s : String} {x : Cap String} (ne : x.id ≠ c) :
    ({ b with orders := b.orders ++ [⟨.withdraw c, s⟩] } : Books).withdrawn x = b.withdrawn x := by
  have : (Order.withdraw c == Order.withdraw x.id) = false := by simp [Ne.symm ne]
  simp [withdrawn, signedBy, this]

/-- Nor deletes anything. -/
theorem deleted_withdraw {c s v : String} {d : Core.DocId} :
    ({ b with orders := b.orders ++ [⟨.withdraw c, s⟩] } : Books).deleted v d = b.deleted v d := by
  simp [deleted, signedBy]

/-- Nor changes whom the keeper's offers cover, when it is no offer. -/
theorem offered_withdraw_other {c s v : String} (notOffer : ∀ o ∈ b.offers, o.id ≠ c) :
    ({ b with orders := b.orders ++ [⟨.withdraw c, s⟩] } : Books).offered v = b.offered v := by
  unfold offered
  exact any_congr_mem fun o mo => by simp only [offerValid, offeredTo, b.withdrawn_other (notOffer o mo)]

/-- **Withdrawing one keep cap leaves the others** (D2): a Doc the keeper keeps under another keep cap, it keeps, and
its offers stand. -/
theorem others_kept {l : Listing} {d : Core.DocId} (m : l ∈ b.listings) (k : b.keepsUnder l d = true) {c : String}
    (other : l.cap.id ≠ c) (notOffer : ∀ o ∈ b.offers, o.id ≠ c) (s : String) :
    ({ b with orders := b.orders ++ [⟨.withdraw c, s⟩] } : Books).keeps d = true := by
  simp only [keeps, List.any_eq_true]
  refine ⟨l, m, ?_⟩
  obtain ⟨v, w, ld, nd, off⟩ := (b.keepsUnder_iff).mp k
  refine (Books.keepsUnder_iff _).mpr ⟨v, ?_, ld, ?_, ?_⟩
  · rw [b.withdrawn_other other]; exact w
  · rw [b.deleted_withdraw]; exact nd
  · rw [b.offered_withdraw_other notOffer]; exact off

/-- **A delete drops the bytes** (D3): once a device of a Doc's vault deletes it, the keeper keeps it under none of
that vault's keep caps, and, a vault's keep caps listing only its own Docs (`kept_by_owner`), under none at all: it
keeps and serves nothing of it. -/
theorem deleted_gone {d : Core.DocId} {v : String}
    (del : ∃ o ∈ b.orders, o.order = .delete d ∧ b.tree.actsFor o.signer = some v)
    (only : ∀ l ∈ b.listings, (∃ k, (d, k) ∈ l.docs) → l.cap.issuer = v) :
    b.keeps d = false ∧ ∀ k e p, b.serves k d e p = false := by
  have gone : b.keeps d = false := by
    cases h : b.keeps d
    · rfl
    · obtain ⟨l, m, _, _, ld, nd, _⟩ := b.kept_only_covered h
      obtain ⟨o, mo, od, sv⟩ := del
      have : b.deleted l.cap.issuer d = true := by
        simp only [deleted, signedBy, List.any_eq_true, Bool.and_eq_true, beq_iff_eq]
        exact ⟨o, mo, od, by rw [only l m ld]; exact sv⟩
      rw [this] at nd
      exact absurd nd (by decide)
  exact ⟨gone, fun k e p => by simp [serves, gone]⟩

/-- **A delete is final** (D3): whatever keep caps and orders come after, under the same tree, a deleted Doc stays gone
while only its own vault lists it. -/
theorem deleted_final {d : Core.DocId} {v : String}
    (del : ∃ o ∈ b.orders, o.order = .delete d ∧ b.tree.actsFor o.signer = some v) (b' : Books)
    (tree : b'.tree = b.tree) (more : ∀ o ∈ b.orders, o ∈ b'.orders)
    (only : ∀ l ∈ b'.listings, (∃ k, (d, k) ∈ l.docs) → l.cap.issuer = v) : b'.keeps d = false := by
  obtain ⟨o, mo, od, sv⟩ := del
  exact (b'.deleted_gone ⟨o, more o mo, od, tree ▸ sv⟩ only).1

end Books

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
  { doc := "d1", genesis := 100,
    links := [rotation, concurrent, onConcurrent, again, carolsLink, otherDoc, offChain, wrongDepth] }
def keepD1Reversed : Keep := { keepD1 with links := keepD1.links.reverse }
def keepNothing : Keep := { doc := "d1", genesis := 100, links := [carolsLink, otherDoc, offChain, wrongDepth] }
def keepGround : Keep := { doc := "d1", genesis := 100, links := [rotation, bobsFork] }

/-- Alice's devices see the fork, check the rotations' caps, and choose her branch: a device of the vault that issued
the keep cap signs it. Bob then grinds again from the same point, to an even smaller hash. -/
def alicesChoice : Choice := ⟨0, 100, 201, "alice-peer"⟩
def keepSettled : Keep := { keepGround with issuer := ["alice-peer", "alice-peer-light"], choices := [alicesChoice] }
def bobsSecondFork : FetchLink := ⟨"d1", 1, 1, 402, 100, 100⟩
def keepSettledAgain : Keep := { keepSettled with links := keepSettled.links ++ [bobsSecondFork] }
/-- Bob signs a choice of his own branch: no device of the issuing vault, so the keeper ignores it. -/
def keepBobsChoice : Keep :=
  { keepGround with issuer := ["alice-peer", "alice-peer-light"], choices := [⟨0, 100, 401, "bob-peer-light"⟩] }

/-- Each keeper's current fetch key and flags. -/
def keepCases : List (String × Keep × Nat × List (Nat × Nat)) :=
  [("two rotations at once, then one more", keepD1, 301, [(0, 100)]),
   ("the same links in the reverse order", keepD1Reversed, 301, [(0, 100)]),
   ("no link chains", keepNothing, 100, []),
   ("a removed reader's ground fork", keepGround, 401, [(0, 100)]),
   ("the issuer's choice settles it", keepSettled, 201, [(0, 100)]),
   ("a later grind from the same point changes nothing", keepSettledAgain, 201, [(0, 100)]),
   ("a choice by the forker's own device is ignored", keepBobsChoice, 401, [(0, 100)])]

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
   ("while the ground fork is unsettled, the writers' key", keepGround, "x-3", alicesAfterFork, true),
   ("while the ground fork is unsettled, the forker's key", keepGround, "x-4", bobsAfterFork, true),
   ("after the issuer's choice, the writers' key", keepSettled, "x-3", alicesAfterFork, true),
   ("after the issuer's choice, the forker's key", keepSettled, "x-4", bobsAfterFork, false),
   ("a second grind after the choice, the forker's new key", keepSettledAgain, "x-5",
     ⟨"bob-peer-light", "bob", 402, "x-5"⟩, false)]

theorem keep_examples :
    (keepCases.all fun (_, s, c, f) => s.current == c && s.flags == f) &&
    (proofCases.all fun (_, s, e, p, b) => s.serves e p == b) = true := by decide

/-- What a keeper can't tell: Bob, removed, forks from the key he still holds, and his smaller hash becomes current.
The keeper flags the fork, and while it is unsettled still serves Alice's readers by their branch's newest key. -/
theorem grind_example : keepGround.current = bobsFork.key ∧ (0, 100) ∈ keepGround.flags ∧
    keepGround.serves "x-3" alicesAfterFork = true := by decide

/-- Alice's devices choose her branch; Bob grinds again from the same point, and the keeper keeps to her branch and
refuses his keys. -/
theorem settled_example : keepSettledAgain.current = rotation.key ∧
    keepSettledAgain.serves "x-3" alicesAfterFork = true ∧ keepSettledAgain.serves "x-4" bobsAfterFork = false ∧
    keepSettledAgain.serves "x-5" ⟨"bob-peer-light", "bob", 402, "x-5"⟩ = false := by decide

end KeepExamples

end Aven.ID
