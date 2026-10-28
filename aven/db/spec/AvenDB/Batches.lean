import AvenDB.Checkpoint

/-!
# Batch-signed logs

Every edit carries a signature of its own from each of its signers: ML-DSA-65's 3,309 bytes, checked one by one as the
edit arrives. A batch-signed log does away with that for new edits (M3 of the master plan). Each device keeps one
append-only log of the edits it signs, in the order it signs them, shaped as a Merkle tree of BLAKE3 hashes (`root`),
and signs the tree's root once per batch (`Root`: its log, its length, the root and its fork number), as Hypercore and
AT Protocol do. A batch is what the device wrote while it signed the batch before (group commit): the first write of a
quiet device is signed at once, so a batch adds a signature's time or two to a write and grows by itself under load.
Nothing here depends on how big a batch is.

An edit then proves its signer by a path up the tree (`climb`) to a root its signer signed: a hash beside each step,
about thirty at a billion edits, checked at hashing speed. The tree hashes the edits' ids, which hash their sealed
bytes, so a relay that opens nothing checks and serves them all the same.

The model takes a hash to be the term it hashes (`Digest`): two hashes are equal only where what they hash is, so
hashes don't collide, as edit ids don't. A root then holds the very edits it hashes (`leaves_root`), a path climbs to a
root only from an edit of it (`path_sound`), and every edit of it has one (`path_complete`, and `climb_path` for the
path the engine makes).

V5: a root its signer signed and a path to it authenticate an edit exactly as the signer's own signature on it does. A
device takes an edit where each of its signers signed it one way or the other (`check`): a signature on the edit, which
every edit held before keeps and which checks exactly as today (`check_signed`, `check_no_paths`), or a path to a signed
root of the signer's log. Where each signer keeps one log, signing edit by edit, root by root or both (`Keeps`), and each
edit comes with a signature or a path of each signer (`Comes`), a signer authenticates exactly the edits of its log
(`check_iff`). So two devices, one sent signatures and the other paths, or any mix, take the same edits, know the same,
the same edits stand and they hold the same edits on a checkpoint's word (`V5_batches_check_the_same`). An existing log
is wrapped as it stands, in its order (`wrap`): its edits keep their signatures, and its signer's one root over them
adds a path to each (`wrap_paths`).

Two roots of one log that disagree, of other fork numbers or neither's edits beginning the other's, prove a fork
(`forkProof`): its device signed two histories of one log, as a clone, a backup restored or a stolen key does. A device
that holds such a proof freezes that signer (`frozen`): it takes no path to its roots any more, and says why. A signer
that keeps one log is never frozen (`V5_honest_never_frozen`), and the roots of a signer no two of which prove a fork
are all of one log (`V5_no_fork_one_log`).
-/

namespace AvenDB.Batches

/-! ## The tree -/

/-- A hash of the tree, as the term it hashes: of no edits, of one edit's id (a leaf), or of two hashes (a node). Each
    kind hashes for a purpose of its own in the engine (`batch::Tree`), so a leaf is never a node. -/
inductive Digest where
  | empty
  | leaf (e : EditId)
  | node (l r : Digest)
  deriving DecidableEq, Repr

/-- The edits a hash hashes, left to right. -/
def Digest.leaves : Digest → List EditId
  | .empty => []
  | .leaf e => [e]
  | .node l r => l.leaves ++ r.leaves

/-- Where a tree of `n` edits, two or more, splits (RFC 9162): the largest power of two below `n`. Its left side is a
    full tree, which every longer log holds as it is. -/
def split (n : Nat) : Nat := 2 ^ (n - 1).log2

theorem split_pos (n : Nat) : 0 < split n := Nat.two_pow_pos _

theorem split_lt {n : Nat} (h : 2 ≤ n) : split n < n := by
  have := Nat.log2_self_le (n := n - 1) (by omega)
  unfold split
  omega

/-- The root of the edits `es`, at most `n` levels deep. -/
def rootN : Nat → List EditId → Digest
  | _, [] => .empty
  | _, [e] => .leaf e
  | 0, _ :: _ :: _ => .empty
  | n + 1, a :: b :: rest =>
    .node (rootN n ((a :: b :: rest).take (split (rest.length + 2))))
      (rootN n ((a :: b :: rest).drop (split (rest.length + 2))))

/-- The root of a log whose edits are `es`, in the order its device signed them. -/
def root (es : List EditId) : Digest := rootN es.length es

theorem leaves_rootN : ∀ n (es : List EditId), es.length ≤ n → (rootN n es).leaves = es
  | _, [], _ => by simp [rootN, Digest.leaves]
  | _, [e], _ => by simp [rootN, Digest.leaves]
  | 0, _ :: _ :: _, h => by simp at h
  | n + 1, a :: b :: rest, h => by
    have hk := split_pos (rest.length + 2)
    have hl := split_lt (n := rest.length + 2) (by omega)
    simp only [List.length_cons] at h
    simp only [rootN, Digest.leaves]
    rw [leaves_rootN n _ (by simp only [List.length_take, List.length_cons]; omega),
      leaves_rootN n _ (by simp only [List.length_drop, List.length_cons]; omega)]
    exact List.take_append_drop _ _

/-- A root holds the very edits of its log, in their order. -/
theorem leaves_root (es : List EditId) : (root es).leaves = es := leaves_rootN _ _ (Nat.le_refl _)

/-- So two logs with one root are one log. -/
theorem root_inj {a b : List EditId} (h : root a = root b) : a = b := by
  rw [← leaves_root a, ← leaves_root b, h]

/-- Enough levels make the same root, however many more. -/
theorem rootN_fuel : ∀ n m (es : List EditId), es.length ≤ n → es.length ≤ m → rootN n es = rootN m es
  | _, _, [], _, _ => by simp [rootN]
  | _, _, [e], _, _ => by simp [rootN]
  | 0, _, _ :: _ :: _, h, _ => by simp at h
  | _ + 1, 0, _ :: _ :: _, _, h => by simp at h
  | n + 1, m + 1, a :: b :: rest, h, h' => by
    have hk := split_pos (rest.length + 2)
    have hl := split_lt (n := rest.length + 2) (by omega)
    simp only [List.length_cons] at h h'
    simp only [rootN]
    rw [rootN_fuel n m _ (by simp only [List.length_take, List.length_cons]; omega)
        (by simp only [List.length_take, List.length_cons]; omega),
      rootN_fuel n m _ (by simp only [List.length_drop, List.length_cons]; omega)
        (by simp only [List.length_drop, List.length_cons]; omega)]

theorem rootN_eq (n : Nat) (es : List EditId) (h : es.length ≤ n) : rootN n es = root es :=
  rootN_fuel n es.length es h (Nat.le_refl _)

/-- A tree of two edits or more is the node of its two sides. -/
theorem root_split {es : List EditId} (h : 2 ≤ es.length) :
    root es = .node (root (es.take (split es.length))) (root (es.drop (split es.length))) := by
  match es, h with
  | a :: b :: rest, _ =>
    have hk := split_pos (rest.length + 2)
    have hl := split_lt (n := rest.length + 2) (by omega)
    simp only [root, List.length_cons, rootN]
    rw [rootN_eq _ _ (by simp only [List.length_take, List.length_cons]; omega),
      rootN_eq _ _ (by simp only [List.length_drop, List.length_cons]; omega)]
    rfl

/-! ## Paths -/

/-- Climb from `d` up the path `p`: at each step, hash with the hash beside it, which lies to the left where it says
    so. -/
def climb (d : Digest) : List (Bool × Digest) → Digest
  | [] => d
  | (left, s) :: p => climb (if left then .node s d else .node d s) p

theorem climb_append (d : Digest) (p q : List (Bool × Digest)) : climb d (p ++ q) = climb (climb d p) q := by
  induction p generalizing d with
  | nil => rfl
  | cons x p ih =>
    obtain ⟨l, s⟩ := x
    simp only [List.cons_append, climb, ih]

/-- Climbing keeps what it starts from among the edits it hashes. -/
theorem leaves_climb (d : Digest) (p : List (Bool × Digest)) : ∃ a b, (climb d p).leaves = a ++ d.leaves ++ b := by
  induction p generalizing d with
  | nil => exact ⟨[], [], by simp [climb]⟩
  | cons x p ih =>
    obtain ⟨l, s⟩ := x
    obtain ⟨a, b, h⟩ := ih (if l then .node s d else .node d s)
    cases l
    · refine ⟨a, s.leaves ++ b, ?_⟩
      simp only [climb, Bool.false_eq_true, ite_false] at h ⊢
      rw [h]
      simp [Digest.leaves]
    · refine ⟨a ++ s.leaves, b, ?_⟩
      simp only [climb, ite_true] at h ⊢
      rw [h]
      simp [Digest.leaves]

/-- A path from an edit climbs only to hashes of it. -/
theorem mem_climb (e : EditId) (p : List (Bool × Digest)) : e ∈ (climb (.leaf e) p).leaves := by
  obtain ⟨a, b, h⟩ := leaves_climb (.leaf e) p
  rw [h]
  simp [Digest.leaves]

/-- Every edit a hash hashes has a path up to it. -/
theorem climb_of_mem {e : EditId} : ∀ {d : Digest}, e ∈ d.leaves → ∃ p, climb (.leaf e) p = d
  | .empty, h => by simp [Digest.leaves] at h
  | .leaf x, h => by
    simp only [Digest.leaves, List.mem_singleton] at h
    subst h
    exact ⟨[], rfl⟩
  | .node l r, h => by
    simp only [Digest.leaves, List.mem_append] at h
    rcases h with h | h
    · obtain ⟨p, hp⟩ := climb_of_mem h
      exact ⟨p ++ [(false, r)], by rw [climb_append, hp]; rfl⟩
    · obtain ⟨p, hp⟩ := climb_of_mem h
      exact ⟨p ++ [(true, l)], by rw [climb_append, hp]; rfl⟩

/-- A path climbs from an edit to the root of a log only if the edit is in the log. -/
theorem path_sound {e : EditId} {p : List (Bool × Digest)} {es : List EditId} (h : climb (.leaf e) p = root es) :
    e ∈ es := by
  rw [← leaves_root es, ← h]
  exact mem_climb e p

/-- And every edit of a log has one. -/
theorem path_complete {e : EditId} {es : List EditId} (h : e ∈ es) : ∃ p, climb (.leaf e) p = root es :=
  climb_of_mem (by rw [leaves_root]; exact h)

/-- The path the engine makes (`batch::Tree::prove`) for the edit at `i` of the edits `es`, at most `n` levels deep:
    the root of the other side at each split, from the bottom up (RFC 9162's audit path). -/
def pathN : Nat → List EditId → Nat → List (Bool × Digest)
  | 0, _, _ => []
  | n + 1, es, i =>
    if es.length ≤ 1 then [] else
      let k := split es.length
      if i < k then pathN n (es.take k) i ++ [(false, root (es.drop k))]
      else pathN n (es.drop k) (i - k) ++ [(true, root (es.take k))]

/-- The path of the edit at `i` of a log whose edits are `es`. -/
def path (es : List EditId) (i : Nat) : List (Bool × Digest) := pathN es.length es i

theorem climb_pathN : ∀ n (es : List EditId) (i : Nat) (hi : i < es.length), es.length ≤ n →
    climb (.leaf es[i]) (pathN n es i) = root es
  | 0, es, i, hi, h => by omega
  | n + 1, es, i, hi, h => by
    unfold pathN
    by_cases h1 : es.length ≤ 1
    · simp only [h1, ite_true]
      match es, hi, h1 with
      | [e], _, _ =>
        have : i = 0 := by first | omega | (simp at hi; omega)
        subst this
        rfl
    · simp only [h1, ite_false]
      have h2 : 2 ≤ es.length := by omega
      have hk := split_pos es.length
      have hl := split_lt h2
      rw [root_split h2]
      by_cases hik : i < split es.length
      · simp only [hik, ite_true]
        rw [climb_append]
        have ht : i < (es.take (split es.length)).length := by simp only [List.length_take]; omega
        have hx : es[i] = (es.take (split es.length))[i] := (List.getElem_take ..).symm
        rw [hx, climb_pathN n _ i ht (by simp only [List.length_take]; omega)]
        rfl
      · simp only [hik, ite_false]
        rw [climb_append]
        have hd : i - split es.length < (es.drop (split es.length)).length := by
          simp only [List.length_drop]; omega
        have hx : es[i] = (es.drop (split es.length))[i - split es.length] := by
          rw [List.getElem_drop]
          congr 1
          omega
        rw [hx, climb_pathN n _ _ hd (by simp only [List.length_drop]; omega)]
        rfl

/-- The engine's path of each edit of a log climbs to its root. -/
theorem climb_path (es : List EditId) (i : Nat) (hi : i < es.length) :
    climb (.leaf es[i]) (path es i) = root es :=
  climb_pathN _ _ _ hi (Nat.le_refl _)

/-! ## Signed roots -/

/-- What a device signs once per batch: its log (one to a signer, named by it), the fork number, how many edits the
    log holds and their root (`batch::Root`). -/
structure Root where
  log    : SignerId
  fork   : Nat
  length : Nat
  digest : Digest
  deriving DecidableEq, Repr

/-- A root is whole: it hashes as many edits as it says. -/
def Root.whole (r : Root) : Bool := r.length == r.digest.leaves.length

/-- What one signature says: that its signer signed an edit, as each edit's signature does, or a root of its log. -/
inductive Said where
  | edit (e : EditId)
  | root (r : Root)
  deriving DecidableEq, Repr

/-- A path from an edit up to a root of its signer's log, and that root. -/
structure Proof where
  root : Root
  path : List (Bool × Digest)
  deriving DecidableEq, Repr

/-- Proof `pr` shows that signer `s` signed edit `e`, `signs` saying which signatures there are (signatures can't be
    forged): its root is of `s`'s log, whole, signed by `s`, and its path climbs from `e` to it. -/
def Proof.shows (signs : SignerId → Said → Bool) (s : SignerId) (e : EditId) (pr : Proof) : Bool :=
  pr.root.log == s && pr.root.whole && signs s (.root pr.root) && climb (.leaf e) pr.path == pr.root.digest

/-! ## Forks -/

/-- Two roots agree: of one fork, and the edits of one begin the other's. -/
def agree (a b : Root) : Bool :=
  a.fork == b.fork && (a.digest.leaves.isPrefixOf b.digest.leaves || b.digest.leaves.isPrefixOf a.digest.leaves)

/-- A proof of fork: two whole roots of one log, each signed by the log's signer, that disagree (`batch::ForkProof`). -/
def forkProof (signs : SignerId → Said → Bool) (a b : Root) : Bool :=
  a.log == b.log && a.whole && b.whole && signs a.log (.root a) && signs b.log (.root b) && !agree a b

/-- A signer that the roots `rs` a device holds prove a fork of: the device freezes it, and says why. -/
def frozen (signs : SignerId → Said → Bool) (rs : List Root) (s : SignerId) : Bool :=
  rs.any fun a => a.log == s && rs.any (forkProof signs a)

/-! ## What a device checks -/

/-- Signer `s` signed edit `e`, as a device holding the roots `rs` checks it: its signature on the edit, or one of the
    paths that come with it (`proofs`) climbs to a root of `s`'s log that `s` signed, while `s` isn't frozen. -/
def check (signs : SignerId → Said → Bool) (rs : List Root) (proofs : EditId → SignerId → List Proof)
    (s : SignerId) (e : EditId) : Bool :=
  signs s (.edit e) || (!frozen signs rs s && (proofs e s).any (Proof.shows signs s e))

/-- The edits a device takes of `edits`, `auth` saying which signers signed each: those each of whose signers did. -/
def takes (auth : SignerId → EditId → Bool) (edits : List Edit) : List Edit :=
  edits.filter fun o => o.sigs.all (auth · o.id)

/-- Signer `s` keeps the one log `L`, at fork `f`: each edit it signs on its own is of `L`, and each root of its log it
    signs, at `f`, hashes the first edits of `L`. -/
def Keeps (signs : SignerId → Said → Bool) (s : SignerId) (L : List EditId) (f : Nat) : Prop :=
  (∀ e, signs s (.edit e) = true → e ∈ L) ∧
    ∀ r : Root, r.log = s → signs s (.root r) = true → r.fork = f ∧ r.digest.leaves = L.take r.length

/-- Each of the `edits` comes with a signature or a path of each signer whose log it is in: what a device sends with
    each edit (`proofs`), or held already. -/
def Comes (signs : SignerId → Said → Bool) (proofs : EditId → SignerId → List Proof) (L : SignerId → List EditId)
    (edits : List Edit) : Prop :=
  ∀ o ∈ edits, ∀ s ∈ o.sigs, o.id ∈ L s → signs s (.edit o.id) = true ∨ ∃ pr ∈ proofs o.id s, pr.shows signs s o.id = true

/-- Two roots of a signer that keeps one log agree. -/
theorem agree_of_keeps {signs : SignerId → Said → Bool} {s : SignerId} {L : List EditId} {f : Nat}
    (hk : Keeps signs s L f) {a b : Root} (ha : a.log = s) (hb : b.log = s) (sa : signs s (.root a) = true)
    (sb : signs s (.root b) = true) : agree a b = true := by
  obtain ⟨fa, la⟩ := hk.2 a ha sa
  obtain ⟨fb, lb⟩ := hk.2 b hb sb
  unfold agree
  rw [la, lb, fa, fb]
  simp only [beq_self_eq_true, Bool.true_and, Bool.or_eq_true, List.isPrefixOf_iff_prefix]
  rcases Nat.le_total a.length b.length with h | h
  · exact Or.inl (List.take_prefix_take_left h)
  · exact Or.inr (List.take_prefix_take_left h)

/-- No proof of fork holds against a signer that keeps one log. -/
theorem forkProof_keeps {signs : SignerId → Said → Bool} {s : SignerId} {L : List EditId} {f : Nat}
    (hk : Keeps signs s L f) {a b : Root} (ha : a.log = s) : forkProof signs a b = false := by
  unfold forkProof
  by_cases hb : b.log = s
  · by_cases sa : signs s (.root a) = true
    · by_cases sb : signs s (.root b) = true
      · simp [ha, hb, sa, sb, agree_of_keeps hk ha hb sa sb]
      · simp [ha, hb, sb]
    · simp [ha, sa]
  · have hne : (a.log == b.log) = false := by
      rw [ha]
      exact beq_eq_false_iff_ne.2 fun h => hb h.symm
    simp [hne]

/-- A signer that keeps one log is never frozen, whatever roots a device holds. -/
theorem frozen_keeps {signs : SignerId → Said → Bool} {s : SignerId} {L : List EditId} {f : Nat}
    (hk : Keeps signs s L f) (rs : List Root) : frozen signs rs s = false := by
  unfold frozen
  refine List.any_eq_false.2 fun a _ => ?_
  by_cases ha : a.log = s
  · have hno : rs.any (forkProof signs a) = false :=
      List.any_eq_false.2 fun b _ => by rw [forkProof_keeps hk ha]; simp
    simp [hno]
  · simp [ha]

/-- What a device checks is a signer's own: of a signer that keeps one log, only edits of that log. -/
theorem check_sound {signs : SignerId → Said → Bool} {s : SignerId} {L : List EditId} {f : Nat}
    (hk : Keeps signs s L f) (rs : List Root) (proofs : EditId → SignerId → List Proof) {e : EditId}
    (h : check signs rs proofs s e = true) : e ∈ L := by
  unfold check at h
  simp only [Bool.or_eq_true, Bool.and_eq_true, List.any_eq_true] at h
  rcases h with h | ⟨-, pr, -, hp⟩
  · exact hk.1 e h
  · unfold Proof.shows at hp
    simp only [Bool.and_eq_true, beq_iff_eq] at hp
    obtain ⟨⟨⟨hl, -⟩, hs⟩, hc⟩ := hp
    obtain ⟨-, hlv⟩ := hk.2 pr.root hl hs
    have := mem_climb e pr.path
    rw [hc, hlv] at this
    exact List.mem_of_mem_take this

/-- And it checks every edit of the log that comes with a signature or a path. -/
theorem check_complete {signs : SignerId → Said → Bool} {s : SignerId} {L : List EditId} {f : Nat}
    (hk : Keeps signs s L f) (rs : List Root) (proofs : EditId → SignerId → List Proof) {e : EditId}
    (h : signs s (.edit e) = true ∨ ∃ pr ∈ proofs e s, pr.shows signs s e = true) :
    check signs rs proofs s e = true := by
  unfold check
  rw [frozen_keeps hk rs]
  simp only [Bool.or_eq_true, Bool.not_false, Bool.true_and, List.any_eq_true]
  exact h

/-- So a signer that keeps one log authenticates exactly the edits of it, edit by edit or root by root. -/
theorem check_iff {signs : SignerId → Said → Bool} {s : SignerId} {L : List EditId} {f : Nat}
    (hk : Keeps signs s L f) (rs : List Root) (proofs : EditId → SignerId → List Proof) {e : EditId}
    (h : e ∈ L → signs s (.edit e) = true ∨ ∃ pr ∈ proofs e s, pr.shows signs s e = true) :
    check signs rs proofs s e = true ↔ e ∈ L :=
  ⟨check_sound hk rs proofs, fun he => check_complete hk rs proofs (h he)⟩

/-- The edits a device takes, where every signer keeps one log and every edit comes with a signature or a path of each
    of its signers: those each of whose signers' logs holds them. -/
theorem takes_logs {signs : SignerId → Said → Bool} {L : SignerId → List EditId} {f : SignerId → Nat}
    (hk : ∀ s, Keeps signs s (L s) (f s)) (rs : List Root) (proofs : EditId → SignerId → List Proof)
    {edits : List Edit} (hc : Comes signs proofs L edits) :
    takes (check signs rs proofs) edits = takes (fun s e => (L s).contains e) edits := by
  unfold takes
  refine List.filter_congr fun o ho => ?_
  refine Bool.eq_iff_iff.2 ⟨fun h => ?_, fun h => ?_⟩
  · refine List.all_eq_true.2 fun s hs => ?_
    exact List.contains_iff_mem.2 (check_sound (hk s) rs proofs (List.all_eq_true.1 h s hs))
  · refine List.all_eq_true.2 fun s hs => ?_
    exact check_complete (hk s) rs proofs (hc o ho s hs (List.contains_iff_mem.1 (List.all_eq_true.1 h s hs)))

/-- So two devices whose signers keep the same logs take the same edits, one sent signatures and the other paths up to
    roots signed in batches of any size, or any mix, as long as each edit comes with one or the other. -/
theorem check_the_same {signs₁ signs₂ : SignerId → Said → Bool} {L : SignerId → List EditId}
    {f₁ f₂ : SignerId → Nat} (hk₁ : ∀ s, Keeps signs₁ s (L s) (f₁ s)) (hk₂ : ∀ s, Keeps signs₂ s (L s) (f₂ s))
    (rs₁ rs₂ : List Root) (proofs₁ proofs₂ : EditId → SignerId → List Proof) {edits : List Edit}
    (hc₁ : Comes signs₁ proofs₁ L edits) (hc₂ : Comes signs₂ proofs₂ L edits) :
    takes (check signs₁ rs₁ proofs₁) edits = takes (check signs₂ rs₂ proofs₂) edits := by
  rw [takes_logs hk₁ rs₁ proofs₁ hc₁, takes_logs hk₂ rs₂ proofs₂ hc₂]

/-- Today: with no path at all, a device checks each edit's signatures alone, exactly as before batches. -/
theorem check_no_paths (signs : SignerId → Said → Bool) (rs : List Root) (s : SignerId) (e : EditId) :
    check signs rs (fun _ _ => []) s e = signs s (.edit e) := by
  simp [check]

/-- An edit's own signature checks whatever paths come with it and whoever is frozen: old logs verify as before. -/
theorem check_signed {signs : SignerId → Said → Bool} (rs : List Root) (proofs : EditId → SignerId → List Proof)
    {s : SignerId} {e : EditId} (h : signs s (.edit e) = true) : check signs rs proofs s e = true := by
  simp [check, h]

/-! ## Wrapping a log as it stands -/

/-- The root signer `s` signs over its log `old` as it stands, in its order, at fork `f`, at the first unlock after
    batches came (`batch::wrap`). -/
def wrap (s : SignerId) (f : Nat) (old : List EditId) : Root := ⟨s, f, old.length, root old⟩

/-- Once its signer signed that root, every edit of the log has a path up to it, beside the signature it keeps. -/
theorem wrap_paths {signs : SignerId → Said → Bool} {s : SignerId} {f : Nat} {old : List EditId}
    (hs : signs s (.root (wrap s f old)) = true) {e : EditId} (he : e ∈ old) :
    ∃ p, (Proof.mk (wrap s f old) p).shows signs s e = true := by
  obtain ⟨p, hp⟩ := path_complete he
  refine ⟨p, ?_⟩
  simp only [wrap] at hs
  simp [Proof.shows, wrap, Root.whole, leaves_root, hs, hp]

/-- A log wrapped as it stands, and then written on, is still one log: the wrap hashes its first edits. -/
theorem wrap_keeps {s : SignerId} {f : Nat} (old new : List EditId) :
    (wrap s f old).fork = f ∧ (wrap s f old).digest.leaves = (old ++ new).take (wrap s f old).length := by
  simp [wrap, leaves_root]

/-! ## Forks -/

/-- Some root among `rs` hashes the most edits. -/
theorem exists_longest : ∀ (rs : List Root), rs ≠ [] → ∃ m ∈ rs, ∀ r ∈ rs, r.length ≤ m.length
  | [], h => absurd rfl h
  | [r], _ => ⟨r, by simp, by simp⟩
  | r :: q :: rest, _ => by
    obtain ⟨m, hm, hmax⟩ := exists_longest (q :: rest) (by simp)
    by_cases hr : m.length ≤ r.length
    · refine ⟨r, by simp, fun x hx => ?_⟩
      rcases List.mem_cons.1 hx with rfl | hx
      · exact Nat.le_refl _
      · exact Nat.le_trans (hmax x hx) hr
    · refine ⟨m, List.mem_cons_of_mem _ hm, fun x hx => ?_⟩
      rcases List.mem_cons.1 hx with rfl | hx
      · omega
      · exact hmax x hx

/-- Roots of a signer that no two of prove a fork are all of one log: each whole one it signed hashes the first edits
    of one list, at one fork. -/
theorem no_fork_one_log (signs : SignerId → Said → Bool) (rs : List Root) (s : SignerId)
    (h : frozen signs rs s = false) :
    ∃ (L : List EditId) (f : Nat), ∀ r ∈ rs, r.log = s → r.whole = true → signs s (.root r) = true →
      r.fork = f ∧ r.digest.leaves = L.take r.length := by
  let good := rs.filter fun r => r.log == s && r.whole && signs s (.root r)
  have hgood : ∀ r, r ∈ good ↔ r ∈ rs ∧ r.log = s ∧ r.whole = true ∧ signs s (.root r) = true := by
    intro r
    simp only [good, List.mem_filter, Bool.and_eq_true, beq_iff_eq, and_assoc]
  by_cases hn : good = []
  · refine ⟨[], 0, fun r hr hl hw hs => ?_⟩
    have : r ∈ good := (hgood r).2 ⟨hr, hl, hw, hs⟩
    rw [hn] at this
    cases this
  obtain ⟨m, hm, hmax⟩ := exists_longest good hn
  obtain ⟨hmr, hml, hmw, hms⟩ := (hgood m).1 hm
  refine ⟨m.digest.leaves, m.fork, fun r hr hl hw hs => ?_⟩
  -- the device holds no proof of fork of `r` and `m`, so they agree
  have hnf : forkProof signs r m = false := by
    unfold frozen at h
    have h1 := List.any_eq_false.1 h r hr
    simp only [hl, beq_self_eq_true, Bool.true_and, Bool.not_eq_true] at h1
    exact List.any_eq_false.1 h1 m hmr |> fun x => by simpa using x
  have hag : agree r m = true := by
    unfold forkProof at hnf
    rw [hl, hml, hw, hmw, hs, hms] at hnf
    simpa using hnf
  have hlen : r.length ≤ m.length := hmax r ((hgood r).2 ⟨hr, hl, hw, hs⟩)
  unfold agree at hag
  simp only [Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, List.isPrefixOf_iff_prefix] at hag
  obtain ⟨hf, hp⟩ := hag
  have hrw : r.length = r.digest.leaves.length := beq_iff_eq.1 hw
  have hmw' : m.length = m.digest.leaves.length := beq_iff_eq.1 hmw
  refine ⟨hf, ?_⟩
  have hpre : r.digest.leaves <+: m.digest.leaves := by
    rcases hp with hp | hp
    · exact hp
    · have := hp.length_le
      rw [hp.eq_of_length (by omega)]
      exact List.prefix_refl _
  rw [hrw]
  exact List.prefix_iff_eq_take.1 hpre

/-! ## Scenarios -/

namespace Examples

-- a device's log of five edits, and the path of each up to its root
def five : List EditId := [11, 12, 13, 14, 15]
#guard (root five).leaves == five
#guard (List.range 5).all fun i => climb (.leaf five[i]!) (path five i) == root five
-- a tree splits at the largest power of two below its size, so a path of 2^k edits has k steps: about thirty at a
-- billion edits
#guard split 5 == 4 && split 8 == 4 && split 9 == 8
#guard (path five 0).length == 3 && (path five 4).length == 1 && (path (List.range 1024) 517).length == 10
-- an edit outside the log climbs to no root of it
#guard (List.range 5).all fun i => climb (.leaf 16) (path five i) != root five

/-- The device signs a batch of three, then two more: each root it signs is of the first edits of its log. -/
def r3 : Root := ⟨7, 0, 3, root (five.take 3)⟩
def r5 : Root := ⟨7, 0, 5, root five⟩
/-- A clone of the device, restored from a backup after the third edit, signs another fourth edit. -/
def r4' : Root := ⟨7, 0, 4, root [11, 12, 13, 99]⟩

def signsOne : SignerId → Said → Bool := fun s x => s == 7 && (x == .root r3 || x == .root r5)
def signsTwo : SignerId → Said → Bool := fun s x => signsOne s x || (s == 7 && x == .root r4')

-- the first root begins the second: no fork, and the edits of the batch of three check by either root
#guard agree r3 r5 && !frozen signsOne [r3, r5] 7
#guard check signsOne [r3, r5] (fun e _ => if e == 12 then [⟨r3, path (five.take 3) 1⟩] else []) 7 12
#guard check signsOne [r3, r5] (fun e _ => if e == 12 then [⟨r5, path five 1⟩] else []) 7 12
-- a path to a root of another log, or one the signer never signed, shows nothing
#guard !check signsOne [r3, r5] (fun _ _ => [⟨{ r5 with log := 8 }, path five 1⟩]) 7 12
#guard !check signsOne [r3, r5] (fun _ _ => [⟨{ r5 with digest := root [11, 12] }, path [11, 12] 1⟩]) 7 12
-- the clone's root disagrees with the fifth: a proof of fork, and the device freezes the signer
#guard forkProof signsTwo r4' r5 && frozen signsTwo [r3, r5, r4'] 7
#guard !check signsTwo [r3, r5, r4'] (fun _ _ => [⟨r5, path five 1⟩]) 7 12
-- another fork number disagrees too, and so does another root of the same length
#guard !agree r5 { r5 with fork := 1 } && !agree r5 ⟨7, 0, 5, root [11, 12, 13, 14, 16]⟩
-- an edit's own signature checks as before, frozen or not
#guard check (fun s x => signsTwo s x || (s == 7 && x == .edit 12)) [r3, r5, r4'] (fun _ _ => []) 7 12
-- a log as it stands, wrapped in its order: each of its edits has a path to the one root over it
#guard (List.range 5).all fun i => (Proof.mk (wrap 7 0 five) (path five i)).shows (fun _ _ => true) 7 five[i]!

end Examples

end AvenDB.Batches
