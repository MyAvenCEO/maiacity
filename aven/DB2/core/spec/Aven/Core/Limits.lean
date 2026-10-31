import Aven.Core.Log

/-!
# Limits (ARCHITECTURE.md rule 10)

Every input has a limit before it costs memory or time. A reader accepts an envelope or a signed thing from its bytes
only when they are at most `maxEnvelopeBytes` long, decode in the one codec, have exactly the shape `Envelope.value`
(or `Signed.value`) writes, and keep within the limits of each field. Nesting is bounded by the codec's `maxDepth`.

- `Envelope.accept_limits`, `Signed.accept_limits`: what is accepted is within every limit;
- `Envelope.accept_encode`, `Signed.accept_encode`: what is accepted encodes back to exactly the bytes it came from,
  so a reader that accepts keeps the bytes it was given, and names what it was given.
-/

namespace Aven.Core

/-- The largest encoded envelope or signed thing: 1 MiB, a store chunk. A Doc's bulk travels in segments and blobs. -/
def maxEnvelopeBytes : Nat := 1048576

/-- The most tips of other logs one envelope builds on. -/
def maxDeps : Nat := 256

/-- The longest branch name, in bytes of UTF-8. -/
def maxBranchBytes : Nat := 256

/-- The longest label, in bytes of UTF-8. -/
def maxLabelBytes : Nat := 256

/-- The longest signer: room for a hybrid key (Ed25519 with ML-DSA-65's 1952 bytes) or a passkey's. -/
def maxSignerBytes : Nat := 4096

/-- The longest signature: room for a hybrid one (Ed25519 with ML-DSA-65's 3309 bytes) or a passkey's assertion. -/
def maxSigBytes : Nat := 16384

/-- The most signatures beside one name: the writer's and approvals, k of a vault's owners. -/
def maxSigs : Nat := 16

private def k (s : String) : Bytes := s.toUTF8.toList

/-! ## Envelopes -/

/-- A set of signatures within the limits, in its one form: at most `maxSigs`, each signer and signature within its
limit, sorted by signer, one each (`sigsOk`). -/
def sigsWithin (xs : List Sig) : Bool :=
  decide (xs.length ≤ maxSigs) && sigsOk xs &&
    xs.all fun x => decide (x.signer.length ≤ maxSignerBytes) && decide (x.sig.length ≤ maxSigBytes)

def Envelope.withinLimits (e : Envelope) : Bool :=
  decide (e.deps.length ≤ maxDeps) && decide (e.branch.length ≤ maxBranchBytes) && sigsWithin e.sigs

def hashesOf? : List Value → Option (List Hash)
  | [] => some []
  | v :: vs => do let h ← Hash.ofValue? v; let hs ← hashesOf? vs; some (h :: hs)

/-- A signature from `Sig.value`'s shape. -/
def sigOf? : Value → Option Sig
  | .map [(k₁, .bytes sig), (k₂, .bytes signer)] => if k₁ = k "sig" ∧ k₂ = k "signer" then some ⟨signer, sig⟩ else none
  | _ => none

def sigsOf? : List Value → Option (List Sig)
  | [] => some []
  | v :: vs => do let x ← sigOf? v; let xs ← sigsOf? vs; some (x :: xs)

def envelopeKeys : List Bytes :=
  [k "doc", k "seq", k "body", k "deps", k "prev", k "sigs", k "branch", k "writer"]

/-- A log's first envelope's keys: `prev` left out, never null (A200). -/
def firstEnvelopeKeys : List Bytes :=
  [k "doc", k "seq", k "body", k "deps", k "sigs", k "branch", k "writer"]

/-- An envelope read back from `Envelope.value`'s shape: its keys in the codec's order, each in its form, `prev` a
hash or left out. A null `prev` is no envelope (A200). -/
def Envelope.ofValue? : Value → Option Envelope
  | .map [(k₁, .bytes d), (k₂, .uint seq), (k₃, body), (k₄, .array deps), (k₅, prev), (k₆, .array sigs),
      (k₇, .text branch), (k₈, .uint writer)] =>
    if [k₁, k₂, k₃, k₄, k₅, k₆, k₇, k₈] = envelopeKeys then do
      let doc ← Hash.ofValue? (.bytes d)
      let prev ← Hash.ofValue? prev
      let deps ← hashesOf? deps
      let sigs ← sigsOf? sigs
      some { doc := ⟨doc⟩, branch, writer, seq, prev := some prev, deps, body, sigs }
    else none
  | .map [(k₁, .bytes d), (k₂, .uint seq), (k₃, body), (k₄, .array deps), (k₆, .array sigs),
      (k₇, .text branch), (k₈, .uint writer)] =>
    if [k₁, k₂, k₃, k₄, k₆, k₇, k₈] = firstEnvelopeKeys then do
      let doc ← Hash.ofValue? (.bytes d)
      let deps ← hashesOf? deps
      let sigs ← sigsOf? sigs
      some { doc := ⟨doc⟩, branch, writer, seq, prev := none, deps, body, sigs }
    else none
  | _ => none

/-- What a reader accepts as an envelope: bytes within the limit, decoded, of the envelope's shape, every field
within its limit. -/
def Envelope.accept (bs : Bytes) : Option Envelope :=
  if bs.length ≤ maxEnvelopeBytes then
    match decodeAll bs >>= Envelope.ofValue? with
    | some e => if e.withinLimits then some e else none
    | none => none
  else none

theorem hashesOf?_value : ∀ {vs : List Value} {hs : List Hash}, hashesOf? vs = some hs → hs.map Hash.value = vs
  | [], hs, e => by simp [hashesOf?] at e; subst e; rfl
  | v :: vs, hs, e => by
    simp only [hashesOf?, Option.bind_eq_bind, Option.bind_eq_some_iff, Option.some.injEq] at e
    obtain ⟨h, hh, t, ht, rfl⟩ := e
    simp [Hash.ofValue?_value hh, hashesOf?_value ht]

theorem sigOf?_value {v : Value} {x : Sig} (e : sigOf? v = some x) : x.value = v := by
  unfold sigOf? at e
  split at e
  · split at e
    · rename_i h
      obtain ⟨rfl, rfl⟩ := h
      cases e; rfl
    · cases e
  · cases e

theorem sigsOf?_value : ∀ {vs : List Value} {xs : List Sig}, sigsOf? vs = some xs → xs.map Sig.value = vs
  | [], xs, e => by simp [sigsOf?] at e; subst e; rfl
  | v :: vs, xs, e => by
    simp only [sigsOf?, Option.bind_eq_bind, Option.bind_eq_some_iff, Option.some.injEq] at e
    obtain ⟨x, hx, t, ht, rfl⟩ := e
    simp [sigOf?_value hx, sigsOf?_value ht]

/-- What `ofValue?` reads is what `value` writes. -/
theorem Envelope.ofValue?_value {v : Value} {e : Envelope} (h : Envelope.ofValue? v = some e) : e.value = v := by
  unfold Envelope.ofValue? at h
  split at h
  · split at h
    · rename_i hk
      simp only [envelopeKeys, List.cons.injEq, and_true] at hk
      obtain ⟨rfl, rfl, rfl, rfl, rfl, rfl, rfl, rfl⟩ := hk
      simp only [Option.bind_eq_bind, Option.bind_eq_some_iff, Option.some.injEq] at h
      obtain ⟨doc, hd, p, hp, ds, hds, xs, hxs, rfl⟩ := h
      simp only [Envelope.value, prevKey]
      rw [← Hash.ofValue?_value hd, ← Hash.ofValue?_value hp, hashesOf?_value hds, sigsOf?_value hxs]
      rfl
    · cases h
  · split at h
    · rename_i hk
      simp only [firstEnvelopeKeys, List.cons.injEq, and_true] at hk
      obtain ⟨rfl, rfl, rfl, rfl, rfl, rfl, rfl⟩ := hk
      simp only [Option.bind_eq_bind, Option.bind_eq_some_iff, Option.some.injEq] at h
      obtain ⟨doc, hd, ds, hds, xs, hxs, rfl⟩ := h
      simp only [Envelope.value, prevKey]
      rw [← Hash.ofValue?_value hd, hashesOf?_value hds, sigsOf?_value hxs]
      rfl
    · cases h
  · cases h

theorem Envelope.accept_limits {bs : Bytes} {e : Envelope} (h : Envelope.accept bs = some e) :
    bs.length ≤ maxEnvelopeBytes ∧ e.withinLimits = true := by
  unfold Envelope.accept at h
  split at h
  · rename_i hl
    split at h
    · split at h
      · cases h; exact ⟨hl, by assumption⟩
      · cases h
    · cases h
  · cases h

/-- An accepted envelope encodes back to exactly its bytes. -/
theorem Envelope.accept_encode {bs : Bytes} {e : Envelope} (h : Envelope.accept bs = some e) : encode e.value = bs := by
  unfold Envelope.accept at h
  split at h
  · split at h
    · rename_i e' he
      split at h
      · cases h
        simp only [Option.bind_eq_bind, Option.bind_eq_some_iff] at he
        obtain ⟨v, hv, ho⟩ := he
        rw [Envelope.ofValue?_value ho]
        exact (encode_decodeAll hv).2
      · cases h
    · cases h
  · cases h

/-! ## Signed things -/

def Signed.withinLimits (s : Signed) : Bool := decide (s.label.length ≤ maxLabelBytes) && sigsWithin s.sigs

def signedKeys : List Bytes := [k "body", k "sigs", k "label"]

/-- A signed thing read back from `Signed.value`'s shape. -/
def Signed.ofValue? : Value → Option Signed
  | .map [(k₁, body), (k₂, .array sigs), (k₃, .text label)] =>
    if [k₁, k₂, k₃] = signedKeys then (sigsOf? sigs).map fun sigs => { label, body, sigs } else none
  | _ => none

def Signed.accept (bs : Bytes) : Option Signed :=
  if bs.length ≤ maxEnvelopeBytes then
    match decodeAll bs >>= Signed.ofValue? with
    | some s => if s.withinLimits then some s else none
    | none => none
  else none

theorem Signed.ofValue?_value {v : Value} {s : Signed} (h : Signed.ofValue? v = some s) : s.value = v := by
  unfold Signed.ofValue? at h
  split at h
  · split at h
    · rename_i hk
      simp only [signedKeys, List.cons.injEq, and_true] at hk
      obtain ⟨rfl, rfl, rfl⟩ := hk
      simp only [Option.map_eq_some_iff] at h
      obtain ⟨xs, hxs, rfl⟩ := h
      simp only [Signed.value]
      rw [sigsOf?_value hxs]
      rfl
    · cases h
  · cases h

theorem Signed.accept_limits {bs : Bytes} {s : Signed} (h : Signed.accept bs = some s) :
    bs.length ≤ maxEnvelopeBytes ∧ s.withinLimits = true := by
  unfold Signed.accept at h
  split at h
  · rename_i hl
    split at h
    · split at h
      · cases h; exact ⟨hl, by assumption⟩
      · cases h
    · cases h
  · cases h

theorem Signed.accept_encode {bs : Bytes} {s : Signed} (h : Signed.accept bs = some s) : encode s.value = bs := by
  unfold Signed.accept at h
  split at h
  · split at h
    · rename_i s' hs
      split at h
      · cases h
        simp only [Option.bind_eq_bind, Option.bind_eq_some_iff] at hs
        obtain ⟨v, hv, ho⟩ := hs
        rw [Signed.ofValue?_value ho]
        exact (encode_decodeAll hv).2
      · cases h
    · cases h
  · cases h

end Aven.Core
