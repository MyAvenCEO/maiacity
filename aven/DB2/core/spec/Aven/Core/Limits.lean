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

private def k (s : String) : Bytes := s.toUTF8.toList

/-! ## Envelopes -/

def Envelope.withinLimits (e : Envelope) : Bool :=
  decide (e.deps.length ≤ maxDeps) && decide (e.branch.length ≤ maxBranchBytes) &&
    decide (e.signer.length ≤ maxSignerBytes) && decide (e.sig.length ≤ maxSigBytes)

/-- A hash from its CBOR: a byte string of 32 bytes. -/
def hashOf? : Value → Option Hash
  | .bytes b => if b.length = 32 then some ⟨b⟩ else none
  | _ => none

def optHashOf? : Value → Option (Option Hash)
  | .null => some none
  | v => (hashOf? v).map some

def hashesOf? : List Value → Option (List Hash)
  | [] => some []
  | v :: vs => do let h ← hashOf? v; let hs ← hashesOf? vs; some (h :: hs)

def envelopeKeys : List Bytes :=
  [k "doc", k "seq", k "sig", k "body", k "deps", k "prev", k "branch", k "signer", k "writer"]

/-- An envelope read back from `Envelope.value`'s shape: its nine keys in the codec's order, each in its form. -/
def Envelope.ofValue? : Value → Option Envelope
  | .map [(k₁, .bytes d), (k₂, .uint seq), (k₃, .bytes sig), (k₄, body), (k₅, .array deps), (k₆, prev),
      (k₇, .text branch), (k₈, .bytes signer), (k₉, .uint writer)] =>
    if [k₁, k₂, k₃, k₄, k₅, k₆, k₇, k₈, k₉] = envelopeKeys then do
      let doc ← hashOf? (.bytes d)
      let prev ← optHashOf? prev
      let deps ← hashesOf? deps
      some { doc := ⟨doc⟩, branch, writer, seq, prev, deps, body, signer, sig }
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

theorem hashOf?_value {v : Value} {h : Hash} (e : hashOf? v = some h) : h.value = v := by
  unfold hashOf? at e
  split at e
  · split at e
    · cases e; rfl
    · cases e
  · cases e

theorem optHashOf?_value {v : Value} {h : Option Hash} (e : optHashOf? v = some h) : optHash h = v := by
  unfold optHashOf? at e
  split at e
  · cases e; rfl
  · cases hv : hashOf? v with
    | none => simp [hv] at e
    | some x => simp [hv] at e; subst e; exact hashOf?_value hv

theorem hashesOf?_value : ∀ {vs : List Value} {hs : List Hash}, hashesOf? vs = some hs → hs.map Hash.value = vs
  | [], hs, e => by simp [hashesOf?] at e; subst e; rfl
  | v :: vs, hs, e => by
    simp only [hashesOf?, Option.bind_eq_bind, Option.bind_eq_some_iff, Option.some.injEq] at e
    obtain ⟨h, hh, t, ht, rfl⟩ := e
    simp [hashOf?_value hh, hashesOf?_value ht]

/-- What `ofValue?` reads is what `value` writes. -/
theorem Envelope.ofValue?_value {v : Value} {e : Envelope} (h : Envelope.ofValue? v = some e) : e.value = v := by
  unfold Envelope.ofValue? at h
  split at h
  · rename_i k₁ d seq sig body k₅ deps k₆ prev k₇ branch k₈ signer k₉ writer k₂ k₃ k₄
    split at h
    · rename_i hk
      simp only [envelopeKeys, List.cons.injEq, and_true] at hk
      obtain ⟨rfl, rfl, rfl, rfl, rfl, rfl, rfl, rfl, rfl⟩ := hk
      simp only [Option.bind_eq_bind, Option.bind_eq_some_iff, Option.some.injEq] at h
      obtain ⟨doc, hd, p, hp, ds, hds, rfl⟩ := h
      simp only [Envelope.value]
      rw [hashOf?_value (v := .bytes d) hd |>.symm, optHashOf?_value hp, hashesOf?_value hds]
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

def Signed.withinLimits (s : Signed) : Bool :=
  decide (s.label.length ≤ maxLabelBytes) && decide (s.signer.length ≤ maxSignerBytes) &&
    decide (s.sig.length ≤ maxSigBytes)

def signedKeys : List Bytes := [k "sig", k "body", k "label", k "signer"]

/-- A signed thing read back from `Signed.value`'s shape. -/
def Signed.ofValue? : Value → Option Signed
  | .map [(k₁, .bytes sig), (k₂, body), (k₃, .text label), (k₄, .bytes signer)] =>
    if [k₁, k₂, k₃, k₄] = signedKeys then some { label, body, signer, sig } else none
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
      obtain ⟨rfl, rfl, rfl, rfl⟩ := hk
      cases h
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
