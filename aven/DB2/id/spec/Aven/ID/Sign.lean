import Aven.ID.Cast

/-! # Statements

A device signs a statement for the vault it serves, with its own key (aven-id's `sign.rs`). The model knows keys by
id and takes the signature scheme as sound: a signature verifies for exactly the device, vault and body its key
signed, and with no other key. Ed25519 itself is mechanics, outside the model. A device's key has the device's id.

`sign` refuses anything but a device, and any key but the device's own; `verify` checks, in this order, that the
statement's device is one, that it serves the statement's vault, that the device has a key, and that its key signed
exactly this. `verify_ok` proves what a statement that holds means. -/

namespace Aven.ID

inductive SignError where
  | notDevice (id : String)
  | noKey (id : String)
  | wrongKey (id : String)
  | wrongVault (device vault : String)
  | badSignature
  deriving DecidableEq, Repr

/-- A statement: `device` says `body` for `vault`, and the key that signed it, with what it signed. -/
structure Statement where
  device : String
  vault : String
  body : String
  /-- the key that made the signature -/
  signer : String
  /-- the device, vault and body that key signed -/
  signed : String × String × String
  deriving DecidableEq, Repr

namespace Tree

/-- `device` signs `body` with the key `key`: for the vault it serves, and only with its own key. -/
def sign (t : Tree) (device key body : String) : Except SignError Statement :=
  match t.actsFor device with
  | none => .error (.notDevice device)
  | some vault =>
    if key = device then .ok ⟨device, vault, body, key, (device, vault, body)⟩ else .error (.wrongKey device)

def verify (t : Tree) (s : Statement) : Except SignError Unit :=
  match t.actsFor s.device with
  | none => .error (.notDevice s.device)
  | some vault =>
    if vault ≠ s.vault then .error (.wrongVault s.device s.vault)
    else if !t.keys.contains s.device then .error (.noKey s.device)
    else if s.signer = s.device ∧ s.signed = (s.device, s.vault, s.body) then .ok ()
    else .error .badSignature

/-- A statement acts on `target` when it holds and its device may act on `target`. -/
def actsOn (t : Tree) (s : Statement) (target : String) : Except SignError Bool :=
  (t.verify s).map fun _ => t.mayActOn s.device target

variable {t : Tree}

/-- A statement holds only when its device serves its vault and the device's own key signed exactly it. -/
theorem verify_ok {s : Statement} (h : t.verify s = .ok ()) :
    t.actsFor s.device = some s.vault ∧ s.signer = s.device ∧ s.signed = (s.device, s.vault, s.body) := by
  unfold verify at h
  split at h
  · cases h
  · next v e =>
    by_cases hv : v = s.vault
    · subst hv
      simp only [ne_eq, not_true_eq_false, ↓reduceIte] at h
      split at h
      · cases h
      · split at h
        · next k => exact ⟨e, k.1, k.2⟩
        · cases h
    · simp [hv] at h

/-- What a device signs, in a tree whose devices have their keys, holds. -/
theorem sign_verify (w : t.WF) {d key body : String} {s : Statement} (h : t.sign d key body = .ok s) :
    t.verify s = .ok () := by
  unfold sign at h
  split at h
  · cases h
  · next v e =>
    split at h
    · next k =>
      cases h
      obtain ⟨o, kd⟩ := actsFor_some e
      unfold kind? at kd
      cases g : t.get? d with
      | none => simp [g] at kd
      | some vt =>
        have := w.deviceKey vt (get?_some g).1 (by simpa [g] using kd)
        rw [(get?_some g).2] at this
        simpa [verify, e, k] using this
    · cases h

end Tree

/-- What a test does to a statement after signing it, before verifying: it names another device or vault, changes the
body, or swaps in another key's signature. -/
inductive Change where
  | device (id : String)
  | vault (id : String)
  | body (b : String)
  | resign (key : String)
  deriving DecidableEq, Repr

def Statement.change (s : Statement) : Change → Statement
  | .device d => { s with device := d }
  | .vault v => { s with vault := v }
  | .body b => { s with body := b }
  | .resign k => { s with signer := k }

/-- A signing example: who signs what with which key, what is changed, the target it acts on, and the answers. -/
structure SignExample where
  name : String
  device : String
  key : String
  body : String
  changes : List Change
  target : Option String
  /-- `sign`'s answer: the vault the statement is for, or the error -/
  signs : Except SignError String
  /-- `verify`'s answer on the changed statement, or `actsOn`'s with a target; none when signing is refused -/
  holds : Option (Except SignError Bool)

deriving instance DecidableEq for Except

/-- The answer for the signed statement, once changed. -/
def SignExample.holdsOn (e : SignExample) (s : Statement) : Except SignError Bool :=
  let s := e.changes.foldl Statement.change s
  match e.target with
  | some target => cast.actsOn s target
  | none => (cast.verify s).map fun _ => true

def SignExample.check (e : SignExample) : Bool :=
  match cast.sign e.device e.key e.body with
  | .error why => decide (e.signs = .error why) && e.holds.isNone
  | .ok s => decide (e.signs = .ok s.vault) && decide (some (e.holdsOn s) = e.holds)

/-- The cast's devices signing, written out by hand. -/
def signExamples : List SignExample := [
  ⟨"the Aven Peer signs for Aven", "aven-peer", "aven-peer", "hello", [], none, .ok "aven", some (.ok true)⟩,
  ⟨"Bob's Peer-Light signs for Bob", "bob-peer-light", "bob-peer-light", "hello", [], none, .ok "bob",
    some (.ok true)⟩,
  ⟨"only with its own key", "aven-peer", "alice-peer", "x", [], none, .error (.wrongKey "aven-peer"), none⟩,
  ⟨"one device's signature, naming another device", "alice-peer", "alice-peer", "x", [.device "alice-peer-light"],
    none, .ok "alice", some (.error .badSignature)⟩,
  ⟨"an owner key is no device", "alice-owner", "alice-owner", "x", [], none, .error (.notDevice "alice-owner"),
    none⟩,
  ⟨"a person's vault is no device", "alice", "alice-owner", "x", [], none, .error (.notDevice "alice"), none⟩,
  ⟨"only for its vault", "aven-peer", "aven-peer", "x", [.vault "alice"], none, .ok "aven",
    some (.error (.wrongVault "aven-peer" "alice"))⟩,
  ⟨"not once its body changed", "alice-peer-light", "alice-peer-light", "x", [.body "y"], none, .ok "alice",
    some (.error .badSignature)⟩,
  ⟨"not with another key's signature", "alice-peer-light", "alice-peer-light", "x", [.resign "bob-peer-light"],
    none, .ok "alice", some (.error .badSignature)⟩,
  ⟨"Bob's Peer-Light acts on Bob's vault", "bob-peer-light", "bob-peer-light", "x", [], some "bob", .ok "bob",
    some (.ok true)⟩,
  ⟨"Bob's devices never act on Aven", "bob-peer-light", "bob-peer-light", "x", [], some "aven", .ok "bob",
    some (.ok false)⟩,
  ⟨"the Aven Peer acts on Aven", "aven-peer", "aven-peer", "x", [], some "aven", .ok "aven", some (.ok true)⟩,
  ⟨"nor the Aven Peer on Alice's vault above it", "aven-peer", "aven-peer", "x", [], some "alice", .ok "aven",
    some (.ok false)⟩,
  ⟨"Alice Peer acts on the Aven Peer", "alice-peer", "alice-peer", "x", [], some "aven-peer", .ok "alice",
    some (.ok true)⟩,
  ⟨"nor Alice Peer on Bob's vault", "alice-peer", "alice-peer", "x", [], some "bob", .ok "alice", some (.ok false)⟩]

theorem sign_examples : signExamples.all SignExample.check = true := by decide

end Aven.ID
