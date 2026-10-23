/-!
# Range sync

The rule of M4 of the master plan: two devices find the logs they differ on by comparing one fingerprint per range of
log ids, cutting a range that differs into smaller ones, and sending what each holds of a range once it is small (a
round). Two devices that finish a round over a range hold the same head of every log in it, the join of the two they held (`round_agrees`, R1).

Keys and heads are any types here. In avenDB a key is a log id and its value the digest of a device's frontier of that
log, which T19 (`t19_one_digest_per_log`) shows names its closed part. A range is any set of keys (a `Bool` predicate),
and a cut any split of it in two (`Round.split`), so ordered ranges and 16-way cuts are cases of it.

A fingerprint of a range stands for what a device holds there. That two devices that hold different heads in a range
have different fingerprints of it is an assumption about the hash (`Sound`), not a theorem: a fingerprint is a hash of
what the range holds, kept per subtree so a range costs O(log n). What a device takes in of a range it was sent is the
join of the two heads (`Join`): commutative, so both ends take in the same, and idempotent, so a head both hold stays.
For a log's heads, the later one wins (`later`): the longer, which on one chain holds the shorter, and of two as long,
which only a fork makes, the one with the greater root, so both ends keep the same and the fork is still flagged by the
log's own check (`Logs.lean`).
-/

namespace AvenDB

namespace Range

variable {K V F : Type}

/-- What a device holds: its head of each log, if any. -/
abbrev Held (K V : Type) := K → Option V

/-- How a round over a range went: the two fingerprints agreed (`same`), each end sent what it holds of the range
    (`send`), or the range was cut in two by `p`, its keys where `p` holds and those where it doesn't, each with a round
    of its own. -/
inductive Round (K : Type) where
  | same
  | send
  | split (p : K → Bool) (l r : Round K)

/-- The keys of range `r` where `p` holds. -/
def cutIn (r p : K → Bool) : K → Bool := fun k => r k && p k

/-- The keys of range `r` where `p` doesn't hold. -/
def cutOut (r p : K → Bool) : K → Bool := fun k => r k && !p k

/-- Round `t` over range `r` between `a` and `b` finished: every part of it where nothing was sent had the same
    fingerprint at both ends. -/
def finished (fp : Held K V → (K → Bool) → F) (a b : Held K V) : Round K → (K → Bool) → Prop
  | .same, r => fp a r = fp b r
  | .send, _ => True
  | .split p l t, r => finished fp a b l (cutIn r p) ∧ finished fp a b t (cutOut r p)

/-- The keys round `t` over range `r` sent: those of its parts where each end sent what it holds. -/
def sent : Round K → (K → Bool) → K → Bool
  | .same, _ => fun _ => false
  | .send, r => r
  | .split p l t, r => fun k => sent l (cutIn r p) k || sent t (cutOut r p) k

/-- What `a` holds once it took in what `b` sent of round `t` over range `r`: the join of the two heads of each key
    sent, its own head of every other. -/
def takeIn (join : Option V → Option V → Option V) (t : Round K) (r : K → Bool) (a b : Held K V) : Held K V :=
  fun k => if sent t r k then join (a k) (b k) else a k

/-- A fingerprint is sound: two devices with the same fingerprint of a range hold the same head of every key in it (no
    collision of the hash). -/
def Sound (fp : Held K V → (K → Bool) → F) : Prop :=
  ∀ a b r, fp a r = fp b r → ∀ k, r k = true → a k = b k

/-- A join both ends take in alike: commutative and idempotent. -/
structure Join (join : Option V → Option V → Option V) : Prop where
  comm : ∀ x y, join x y = join y x
  idem : ∀ x, join x x = x

/-- A round sends only keys of its range. -/
theorem sent_in (t : Round K) (r : K → Bool) (k : K) (h : sent t r k = true) : r k = true := by
  induction t generalizing r with
  | same => simp [sent] at h
  | send => simpa [sent] using h
  | split p l t ihl iht =>
    simp only [sent, Bool.or_eq_true] at h
    rcases h with h | h
    · have := ihl _ h; simp only [cutIn, Bool.and_eq_true] at this; exact this.1
    · have := iht _ h; simp only [cutOut, Bool.and_eq_true] at this; exact this.1

/-- Of a finished round, the two ends held the same head of every key of the range it didn't send. -/
theorem unsent_agree {fp : Held K V → (K → Bool) → F} (hfp : Sound fp) (a b : Held K V) (t : Round K) (r : K → Bool)
    (hfin : finished fp a b t r) (k : K) (hr : r k = true) (hs : sent t r k = false) : a k = b k := by
  induction t generalizing r with
  | same => exact hfp a b r hfin k hr
  | send => simp [sent, hr] at hs
  | split p l t ihl iht =>
    simp only [sent, Bool.or_eq_false_iff] at hs
    cases hp : p k
    · exact iht (cutOut r p) hfin.2 (by simp [cutOut, hr, hp]) hs.2
    · exact ihl (cutIn r p) hfin.1 (by simp [cutIn, hr, hp]) hs.1

/-- R1: two devices that finish a round over a range hold the same head of every log in it, the join of the heads they
    held, and the round changes nothing outside the range. -/
theorem round_agrees {fp : Held K V → (K → Bool) → F} {join : Option V → Option V → Option V} (hfp : Sound fp)
    (hj : Join join) (a b : Held K V) (t : Round K) (r : K → Bool) (hfin : finished fp a b t r) :
    (∀ k, r k = true → takeIn join t r a b k = takeIn join t r b a k ∧ takeIn join t r a b k = join (a k) (b k)) ∧
    (∀ k, r k = false → takeIn join t r a b k = a k ∧ takeIn join t r b a k = b k) := by
  refine ⟨fun k hr => ?_, fun k hr => ?_⟩
  · unfold takeIn
    cases hs : sent t r k
    · have hab := unsent_agree hfp a b t r hfin k hr hs
      simp only [Bool.false_eq_true, ↓reduceIte, hab, hj.idem]
      exact ⟨trivial, trivial⟩
    · simp only [↓reduceIte, hj.comm (a k) (b k)]
      exact ⟨trivial, trivial⟩
  · have hs : sent t r k = false := by
      cases h : sent t r k
      · rfl
      · simp [sent_in t r k h] at hr
    simp [takeIn, hs]

/-- Two devices whose fingerprints of a range agree are done with it: a round of one comparison sends nothing and
    finishes. -/
theorem same_sends_nothing (fp : Held K V → (K → Bool) → F) (a b : Held K V) (r : K → Bool) (h : fp a r = fp b r) :
    finished fp a b .same r ∧ ∀ k, sent (.same : Round K) r k = false :=
  ⟨h, fun _ => rfl⟩

/-! ## Replacing a peer's routing claim

The network's sparse holdings exchange carries one authenticated device's new claim to a peer that remembers its
old claim. It does not merge edit authority: only the sent ranges replace that remembered claim. `unsent_agree`
therefore suffices, without assuming the commutative head join used for full edit reconciliation below.
-/

/-- Replace the remembered claim `old` with `fresh` only for the ranges this round sent. -/
def replaceHeld (t : Round K) (r : K → Bool) (old fresh : Held K V) : Held K V :=
  fun k => if sent t r k then fresh k else old k

/-- A finished sparse claim replacement equals a full replacement inside its range and preserves everything
outside. The hash soundness assumption is explicit; this grants no permission and verifies no edit. -/
theorem replacement_agrees {fp : Held K V → (K → Bool) → F} (hfp : Sound fp)
    (old fresh : Held K V) (t : Round K) (r : K → Bool) (hfin : finished fp old fresh t r) :
    (∀ k, r k = true → replaceHeld t r old fresh k = fresh k) ∧
    (∀ k, r k = false → replaceHeld t r old fresh k = old k) := by
  refine ⟨fun k hr => ?_, fun k hr => ?_⟩
  · cases hs : sent t r k
    · simpa [replaceHeld, hs] using unsent_agree hfp old fresh t r hfin k hr hs
    · simp [replaceHeld, hs]
  · have hs : sent t r k = false := by
      cases h : sent t r k
      · rfl
      · simp [sent_in t r k h] at hr
    simp [replaceHeld, hs]

/-! ## A log's head -/

/-- A device's head of a log: how many edits it holds of it and the root over them. -/
structure Head where
  len : Nat
  root : Nat
  deriving DecidableEq, Repr

/-- The later of two heads: the longer, and of two as long, the one with the greater root. -/
def Head.later (x y : Head) : Head :=
  if x.len < y.len then y else if y.len < x.len then x else if x.root < y.root then y else x

/-- The later head of each log, either end's where only one holds one. -/
def later : Option Head → Option Head → Option Head
  | some x, some y => some (x.later y)
  | some x, none => some x
  | none, y => y

theorem Head.later_comm (x y : Head) : x.later y = y.later x := by
  obtain ⟨xl, xr⟩ := x
  obtain ⟨yl, yr⟩ := y
  unfold Head.later
  simp only
  by_cases h1 : xl < yl
  · simp [h1, Nat.lt_asymm h1]
  · by_cases h2 : yl < xl
    · simp [h1, h2]
    · have hl : xl = yl := by omega
      subst hl
      by_cases h3 : xr < yr
      · simp [h3, Nat.lt_asymm h3]
      · by_cases h4 : yr < xr
        · simp [h3, h4]
        · have hr : xr = yr := by omega
          subst hr
          rfl

theorem Head.later_self (x : Head) : x.later x = x := by
  unfold Head.later
  simp

/-- The later head is a join both ends take in alike. -/
theorem later_join : Join later where
  comm x y := by
    cases x <;> cases y <;> simp [later, Head.later_comm]
  idem x := by
    cases x <;> simp [later, Head.later_self]

/-- R1 for heads: two devices that finish a round over a range of logs hold the later head of every log in it, the
    same at both ends. -/
theorem round_agrees_heads {fp : Held K Head → (K → Bool) → F} (hfp : Sound fp) (a b : Held K Head) (t : Round K)
    (r : K → Bool) (hfin : finished fp a b t r) (k : K) (hr : r k = true) :
    takeIn later t r a b k = takeIn later t r b a k ∧ takeIn later t r a b k = later (a k) (b k) :=
  (round_agrees hfp later_join a b t r hfin).1 k hr

end Range

end AvenDB
