import Aven.ID.P256
import Lean.Data.Json

/-! # What a WebAuthn assertion must say

A passkey signs for its person's vault through a WebAuthn assertion (PRODUCTION.md, "Lean first"): the browser writes
`clientDataJSON` (its type, the challenge it was given and the page's origin), the authenticator writes
`authenticatorData` (the SHA-256 of the RP ID it was made for, then its flags, then a counter), and the passkey signs
both. The checks are pure and run in WebAuthn's order (Level 3, 7.2): the client data is JSON with the three fields,
its type is `webauthn.get`, its challenge is the one expected, its origin one of the origins expected, and it was not
made in a frame of another origin (`crossOrigin`, false when absent); the authenticator data is long enough, names
the expected RP ID and has the user-present (UP, bit 0) and user-verified (UV, bit 2) flags; last, the passkey's
key signed exactly these bytes. Like Ed25519's, ECDSA's signature is taken as sound: it verifies for exactly what its
key signed (`signer`, `signed`), and with no other key. `check_ok` proves what an assertion that holds says. The
signature counter (`counter`) is checked across a passkey's assertions, by the network that keeps them
(`Aven.ID.Claim`).

A challenge is the base64url (RFC 4648, 5, no padding) of the SHA-256 of a statement's text, so the passkey signs the
statement itself (`Aven.ID.Claim`). -/

open Lean

namespace Aven.ID

/-! ## base64url and challenges -/

def b64Alphabet : List Char := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toList

/-- base64url without padding. -/
def base64url (bytes : List UInt8) : String := Id.run do
  let a := bytes.toArray
  let mut out : List Char := []
  let char (i : Nat) := b64Alphabet[i % 64]!
  for g in [0:(a.size + 2) / 3] do
    let i := 3 * g
    let n := a.size - i
    let x := (a[i]!.toNat <<< 16) ||| ((a[i + 1]?.getD 0).toNat <<< 8) ||| (a[i + 2]?.getD 0).toNat
    let cs := [char (x >>> 18), char (x >>> 12), char (x >>> 6), char x]
    out := out ++ cs.take (if n ≥ 3 then 4 else n + 1)
  return String.ofList out

/-- The challenge a passkey signs for a statement's text. -/
def challengeOf (text : String) : String := base64url (Keys.sha256.digest text.toUTF8.toList)

-- RFC 4648, 10, as base64url without its padding
#guard ["", "f", "fo", "foo", "foob", "fooba", "foobar"].map (base64url ·.toUTF8.toList) =
  ["", "Zg", "Zm8", "Zm9v", "Zm9vYg", "Zm9vYmE", "Zm9vYmFy"]
#guard base64url [0xfb, 0xff] = "-_8"

/-! ## The checks -/

/-- Whom an assertion must be for: the RP ID its passkey was made for, and the origins avenOS is served from. A list,
so an assertion stored when it came holds while its origin stays listed. -/
structure Relying where
  rpId : String
  origins : List String
  deriving DecidableEq, Repr

/-- `clientDataJSON`'s fields: three it must have, and `crossOrigin`, false when absent. -/
structure ClientData where
  type : String
  challenge : String
  origin : String
  crossOrigin : Bool
  deriving DecidableEq, Repr

def ClientData.parse (s : String) : Option ClientData := do
  let j ← (Json.parse s).toOption
  let field (k : String) := (j.getObjValAs? String k).toOption
  let crossOrigin ← match j.getObjVal? "crossOrigin" with
    | .error _ => some false
    | .ok v => v.getBool?.toOption
  pure ⟨← field "type", ← field "challenge", ← field "origin", crossOrigin⟩

/-- An assertion, decoded: `clientDataJSON` as text, `authenticatorData`'s bytes, and, as the model knows a
signature, the key that made it and what it signed. -/
structure Assertion where
  clientData : String
  authData : List UInt8
  signer : String
  signed : String × List UInt8
  deriving DecidableEq, Repr

inductive AssertionError where
  | clientData
  | type
  | challenge
  | origin
  /-- made in a frame of another origin -/
  | crossOrigin
  | authData
  | rpId
  | notPresent
  | notVerified
  | badSignature
  deriving DecidableEq, Repr

def rpIdHash (rpId : String) : List UInt8 := Keys.sha256.digest rpId.toUTF8.toList

/-- The flags byte, after the RP ID's hash. -/
def Assertion.flags (a : Assertion) : UInt8 := a.authData.getD 32 0

/-- The signature counter, the four bytes after the flags, big-endian. Synced passkeys keep it at 0. -/
def Assertion.counter (a : Assertion) : Nat :=
  ((a.authData.drop 33).take 4).foldl (fun acc b => acc * 256 + b.toNat) 0

def Assertion.signedBy (a : Assertion) (key : String) : Bool := a.signer == key && a.signed == (a.clientData, a.authData)

/-- An assertion holds for `rp`, the challenge and the passkey `key`, or names the first check it fails. -/
def Assertion.check (rp : Relying) (challenge key : String) (a : Assertion) : Except AssertionError Unit :=
  match ClientData.parse a.clientData with
  | none => .error .clientData
  | some cd =>
    if cd.type ≠ "webauthn.get" then .error .type
    else if cd.challenge ≠ challenge then .error .challenge
    else if cd.origin ∉ rp.origins then .error .origin
    else if cd.crossOrigin then .error .crossOrigin
    else if a.authData.length < 37 then .error .authData
    else if a.authData.take 32 ≠ rpIdHash rp.rpId then .error .rpId
    else if a.flags &&& 1 ≠ 1 then .error .notPresent
    else if a.flags &&& 4 ≠ 4 then .error .notVerified
    else if !a.signedBy key then .error .badSignature
    else .ok ()

/-- What an assertion that holds says: a `webauthn.get` for this challenge on one of these origins, made for this RP
ID with the user present and verified, signed by `key` over exactly these bytes. -/
theorem check_ok {rp : Relying} {challenge key : String} {a : Assertion} (h : a.check rp challenge key = .ok ()) :
    (∃ origin ∈ rp.origins, ClientData.parse a.clientData = some ⟨"webauthn.get", challenge, origin, false⟩) ∧
    a.authData.take 32 = rpIdHash rp.rpId ∧ a.flags &&& 1 = 1 ∧ a.flags &&& 4 = 4 ∧
    a.signer = key ∧ a.signed = (a.clientData, a.authData) := by
  unfold Assertion.check at h
  split at h
  · cases h
  next cd e =>
    split at h; · cases h
    split at h; · cases h
    split at h; · cases h
    split at h; · cases h
    split at h; · cases h
    split at h; · cases h
    split at h; · cases h
    split at h; · cases h
    split at h; · cases h
    next t c o x _ r up uv s =>
    simp only [Assertion.signedBy, Bool.not_eq_true', Bool.and_eq_false_iff, beq_eq_false_iff_ne, ne_eq,
      not_or, Decidable.not_not] at s
    refine ⟨⟨cd.origin, Decidable.not_not.mp o, ?_⟩, Decidable.not_not.mp r, Decidable.not_not.mp up,
      Decidable.not_not.mp uv, s.1, s.2⟩
    rw [e]
    cases cd
    simp_all

/-! ## What a browser makes

An assertion as a browser and its authenticator make it, for the examples and traces: `clientDataJSON` as Chromium
writes it, and authenticator data with its counter. -/

def made (type origin rpId challenge signer : String) (flags : UInt8) (crossOrigin : Bool := false)
    (counter : Nat := 0) : Assertion :=
  let cd := "{\"type\":\"" ++ type ++ "\",\"challenge\":\"" ++ challenge ++ "\",\"origin\":\"" ++ origin ++
    "\",\"crossOrigin\":" ++ (if crossOrigin then "true" else "false") ++ "}"
  let ad := rpIdHash rpId ++ [flags] ++ Keys.be 4 counter
  ⟨cd, ad, signer, (cd, ad)⟩

/-- What a test does to an assertion after it was made, before it is checked. -/
inductive Retouch where
  /-- other client data than it signed -/
  | clientData (s : String)
  /-- other flags than it signed -/
  | flags (f : UInt8)
  /-- cut the authenticator data to this many bytes -/
  | cut (n : Nat)
  deriving DecidableEq, Repr

def Assertion.retouch (a : Assertion) : Retouch → Assertion
  | .clientData s => { a with clientData := s }
  | .flags f => { a with authData := a.authData.set 32 f }
  | .cut n => { a with authData := a.authData.take n }

/-- How a browser makes an assertion for an example: its type, origin and RP ID, the challenge it was given, the
passkey that signs and the flags, then what is done to it. -/
structure Making where
  type : String := "webauthn.get"
  origin : String := "http://localhost:5174"
  rpId : String := "localhost"
  challenge : String := challengeOf "a statement"
  signer : String := "passkey-a"
  flags : UInt8 := 5
  crossOrigin : Bool := false
  retouch : List Retouch := []
  deriving DecidableEq, Repr

def Making.make (m : Making) : Assertion :=
  m.retouch.foldl Assertion.retouch (made m.type m.origin m.rpId m.challenge m.signer m.flags m.crossOrigin)

/-! ## Examples

Each check broken once, written out by hand. The Aven Peer in the box expects `localhost` and
`http://localhost:5174`, the challenge of "a statement" and the passkey `passkey-a`; `twoOrigins` lists a second
origin beside it. -/

def boxRelying : Relying := ⟨"localhost", ["http://localhost:5174"]⟩
def twoOrigins : Relying := ⟨"localhost", ["http://localhost:5174", "http://localhost:5175"]⟩

/-- The examples on the box's relying party; `twoOriginExamples` on one with two origins. -/
def passkeyExamples : List (String × Making × Except AssertionError Unit) := [
  ("an assertion that holds", {}, .ok ()),
  ("a synced passkey's flags, backed up too", { flags := 0x1d }, .ok ()),
  ("a registration, not an assertion", { type := "webauthn.create" }, .error .type),
  ("another statement's challenge", { challenge := challengeOf "another statement" }, .error .challenge),
  ("made on another origin", { origin := "http://localhost:5173" }, .error .origin),
  ("made on another host", { origin := "http://evil.localhost:5174" }, .error .origin),
  ("made for another RP ID", { rpId := "maia.city" }, .error .rpId),
  ("without the user present", { flags := 4 }, .error .notPresent),
  ("without the user verified", { flags := 1 }, .error .notVerified),
  ("signed by another passkey", { signer := "passkey-b" }, .error .badSignature),
  ("its client data swapped after signing",
    { origin := "http://localhost:5173", retouch := [.clientData ({} : Making).make.clientData] }, .error .badSignature),
  ("its flags raised after signing", { flags := 1, retouch := [.flags 5] }, .error .badSignature),
  ("client data that isn't JSON", { retouch := [.clientData "nope"] }, .error .clientData),
  ("client data without an origin", { retouch := [.clientData "{\"type\":\"webauthn.get\",\"challenge\":\"x\"}"] },
    .error .clientData),
  ("authenticator data cut short", { retouch := [.cut 36] }, .error .authData),
  ("made on an origin not listed yet", { origin := "http://localhost:5175" }, .error .origin),
  ("made in a frame of another origin", { crossOrigin := true }, .error .crossOrigin),
  ("client data without crossOrigin is not cross-origin",
    { retouch := [.clientData ("{\"type\":\"webauthn.get\",\"challenge\":\"" ++ challengeOf "a statement" ++
      "\",\"origin\":\"http://localhost:5174\"}")] }, .error .badSignature),
  ("crossOrigin that isn't true or false", { retouch := [.clientData ("{\"type\":\"webauthn.get\",\"challenge\":\"" ++
      challengeOf "a statement" ++ "\",\"origin\":\"http://localhost:5174\",\"crossOrigin\":1}")] },
    .error .clientData)]

def twoOriginExamples : List (String × Making × Except AssertionError Unit) := [
  ("with two origins, made on the second", { origin := "http://localhost:5175" }, .ok ()),
  ("with two origins, made on the first", {}, .ok ()),
  ("with two origins, made on neither", { origin := "http://localhost:5173" }, .error .origin)]

def failure : Except AssertionError Unit → Option AssertionError
  | .ok () => none
  | .error e => some e

#guard passkeyExamples.all fun (_, m, want) =>
  failure (m.make.check boxRelying (challengeOf "a statement") "passkey-a") == failure want
#guard twoOriginExamples.all fun (_, m, want) =>
  failure (m.make.check twoOrigins (challengeOf "a statement") "passkey-a") == failure want

end Aven.ID
