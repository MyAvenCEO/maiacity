import Aven.ID.Caps
import Aven.Core.TargetCbor

/-! # A cap's bytes (A2)

A cap is a Value, encoded by `Aven.Core`'s deterministic CBOR, its targets as `Aven.Core.TargetCbor` writes them. Its
**body** is everything but its signature and approvals:

```
{"form": "grant" or "attenuate", "role": role or null, "grant": [line…], "share": n, "holder": holder,
 "issuer": vault, "parent": cap or null, "conditions": {"own", "uses", "approve", "expires", "history", "branches",
 "notBefore"}}
line:    {"op": op id, "doc": target, "params": {param: [value…] or null, …}}
holder:  {"vault": v}   {"group": Doc}   "public"
```

Keys sort as the codec sorts them: shorter first, then by their bytes. An op id and a Doc id are byte strings of their
hash; a bound is null for any value or the values it allows (A32). A line's parameters are a map, so a line whose
parameters aren't sorted, or name one twice, isn't canonical. A cap's id is Core's name of it as a signed thing, the
BLAKE3 hash of `[label, body]` (`Cap.digest`, A30), which its issuer's owners approve, unless it attenuates. Its form is
in its body, so a signature over an attenuation is never one over a grant. Its issuing device signs the body under the label `avenID cap 1`
(`Cap.signing`), so the signature can't be read as anything else's (Core's `signing_separates`).

The cast's caps go by readable names, so here a parent and a role are text; with R5 they become hashes, as every
Doc id already is. -/

namespace Aven.ID

open Aven.Core

private def txt (s : String) : Value := .text s.toUTF8.toList
private def key (s : String) : Bytes := s.toUTF8.toList

def optText : Option String → Value
  | none => .null
  | some s => txt s

def optNat : Option Nat → Value
  | none => .null
  | some n => .uint n

def Line.value (l : Line) : Value :=
  .map [(key "op", .bytes l.op.bytes), (key "doc", l.doc.value),
    (key "params", .map (l.params.map fun (p, b) => (p, Bound.value b)))]

def Holder.value : Holder → Value
  | .vault v => .map [(key "vault", txt v)]
  | .group g => .map [(key "group", .bytes g.hash.bytes)]
  | .«public» => txt "public"

def Branches.value : Branches → Value
  | .any => txt "any"
  | .main => txt "main"
  | .proposals => txt "proposals"
  | .one b => .map [(key "branch", txt b)]

def History.value : History → Value
  | .all => txt "all"
  | .fromNow => txt "from-now"

def Conditions.value (c : Conditions) : Value :=
  .map [(key "own", .bool c.own), (key "uses", optNat c.uses), (key "approve", .uint c.approve),
    (key "expires", optNat c.expires), (key "history", c.history.value), (key "branches", c.branches.value),
    (key "notBefore", .uint c.notBefore)]

/-- What a cap says, without its signature and approvals. -/
def Cap.body (c : Cap) : Value :=
  .map [(key "form", txt c.form.name), (key "role", optText c.role), (key "grant", .array (c.grant.map Line.value)),
    (key "share", .uint c.share), (key "holder", c.holder.value), (key "issuer", txt c.issuer),
    (key "parent", optText c.parent), (key "conditions", c.conditions.value)]

/-- A cap's bytes: its body's one encoding. -/
def Cap.bytes (c : Cap) : Bytes := encode c.body

/-- What its issuing device signs it under. -/
def capLabel : Bytes := key "avenID cap 1"

/-- A cap as Core's signed thing: its label and body, its signatures beside it (A30). -/
def Cap.signed (c : Cap) (sigs : List Core.Sig := []) : Signed := { label := capLabel, body := c.body, sigs }

/-- What its issuing device signs, and its owners approve: its label and body. -/
def Cap.signing (c : Cap) : Bytes := (c.signed).signing

/-- A cap's id: Core's name of the signed thing, the hash of `[label, body]`, exactly what its signers sign (A30).
Signatures never touch it. -/
def Cap.digest (H : Bytes → Hash) (c : Cap) : Hash := (c.signed).name H

theorem capLabel_ok : textOk capLabel = true := by decide +kernel

/-- Two allowed caps with one id say the same thing, under a hash nothing collides under. -/
theorem Cap.digest_inj {H : Bytes → Hash} (hH : Injective H) {c d : Cap} (hc : Canon c.body = true)
    (hd : Canon d.body = true) (h : c.digest H = d.digest H) : c.body = d.body :=
  (Signed.name_inj hH capLabel_ok capLabel_ok hc hd h).2

/-- A key as the codec stores it. -/
def recKey (s : String) : Bytes := s.toUTF8.toList

/-- Map keys in the codec's order, Core's (`keysSorted`): by their encoded bytes, so shorter first, then by their
bytes. -/
def keyBefore (a b : Bytes) : Bool := lexLt (keyBytes a) (keyBytes b)

/-- An entry put where the codec's order puts it. -/
def insertKey (e : Bytes × Value) : List (Bytes × Value) → List (Bytes × Value)
  | [] => [e]
  | x :: xs => if keyBefore e.1 x.1 then e :: x :: xs else x :: insertKey e xs

/-- A body with its signatures beside it, under `sigs`. -/
def withSigs (body : Value) (sigs : List Core.Sig) : Value :=
  match body with
  | .map kvs => .map (insertKey (recKey "sigs", .array (sigs.map Core.Sig.value)) kvs)
  | v => v

/-- A field of a map, by its key. -/
def recField (kvs : List (Bytes × Value)) (k : String) : Option Value := (kvs.find? (·.1 == recKey k)).map (·.2)

/-- A map's fields and its signatures, apart. -/
def splitSigs : Value → Option (List (Bytes × Value) × List Core.Sig)
  | .map kvs => do
    let .array ss ← recField kvs "sigs" | none
    let sigs ← sigsOf? ss
    guard (sigsWithin sigs)
    some (kvs.filter (·.1 != recKey "sigs"), sigs)
  | _ => none

def recText? : Value → Option String
  | .text b => String.fromUTF8? ⟨b.toArray⟩
  | _ => none

def recNat? : Value → Option Nat
  | .uint n => some n
  | _ => none

def recOptNat? : Value → Option (Option Nat)
  | .null => some none
  | .uint n => some (some n)
  | _ => none

def recOptText? : Value → Option (Option String)
  | .null => some none
  | v => (recText? v).map some

/-- Bytes of exactly this length. -/
def recBytes? (n : Nat) : Value → Option Bytes
  | .bytes b => if b.length = n then some b else none
  | _ => none

/-! ## Reading a cap back from its body -/

def Line.ofValue? : Value → Option Line
  | .map kvs => do
    let op ← recBytes? 32 (← recField kvs "op")
    let doc ← Target.ofValue? (← recField kvs "doc")
    let .map ps ← recField kvs "params" | none
    let params ← ps.mapM fun (p, b) => do some (p, ← Bound.ofValue? b)
    some { op := ⟨op⟩, doc, params }
  | _ => none

def Holder.ofValue? : Value → Option Holder
  | .text b => if b = recKey "public" then some .«public» else none
  | .map [(k, v)] =>
    if k = recKey "vault" then (recText? v).map .vault
    else if k = recKey "group" then (recBytes? 32 v).map fun h => .group ⟨⟨h⟩⟩
    else none
  | _ => none

def Branches.ofValue? : Value → Option Branches
  | .text b =>
    if b = recKey "any" then some .any else if b = recKey "main" then some .main
    else if b = recKey "proposals" then some .proposals else none
  | .map [(k, v)] => if k = recKey "branch" then (recText? v).map .one else none
  | _ => none

def History.ofValue? : Value → Option History
  | .text b => if b = recKey "all" then some .all else if b = recKey "from-now" then some .fromNow else none
  | _ => none

def Conditions.ofValue? : Value → Option Conditions
  | .map kvs => do
    let own ← match ← recField kvs "own" with | .bool b => some b | _ => none
    some { notBefore := ← recNat? (← recField kvs "notBefore"), expires := ← recOptNat? (← recField kvs "expires"),
           approve := ← recNat? (← recField kvs "approve"), uses := ← recOptNat? (← recField kvs "uses"), own,
           branches := ← Branches.ofValue? (← recField kvs "branches"),
           history := ← History.ofValue? (← recField kvs "history") }
  | _ => none

def CapForm.ofValue? (v : Value) : Option CapForm := do
  let f ← recText? v
  if f = "grant" then some .grant else if f = "attenuate" then some .attenuate else none

/-- A cap's body read field by field; `Cap.ofBody?` keeps it only in its one form. -/
def Cap.parseBody? (v : Value) : Option Cap := do
  let .map kvs := v | none
  let .array ls ← recField kvs "grant" | none
  let c : Cap := { id := "", issuer := ← recText? (← recField kvs "issuer"),
                   holder := ← Holder.ofValue? (← recField kvs "holder"),
                   parent := ← recOptText? (← recField kvs "parent"),
                   form := ← CapForm.ofValue? (← recField kvs "form"),
                   grant := ← ls.mapM Line.ofValue?, role := ← recOptText? (← recField kvs "role"),
                   share := ← recNat? (← recField kvs "share"),
                   conditions := ← Conditions.ofValue? (← recField kvs "conditions"), signer := default }
  some { c with id := (c.digest blake3).text }

/-- A cap read back from its body (`Cap.body`), its id its name (`Cap.digest`). No signer is read from the body: who
signed it travels beside it, as a Record's signatures, so the signer keeps its default. Only the one form `Cap.body`
writes reads back. -/
def Cap.ofBody? (v : Value) : Option Cap := do
  let c ← Cap.parseBody? v
  if c.body = v then some c else none

/-- What `Cap.ofBody?` reads is what `Cap.body` writes: a cap's body has one form. -/
theorem Cap.ofBody?_body {v : Value} {c : Cap} (h : Cap.ofBody? v = some c) : c.body = v := by
  simp only [Cap.ofBody?, Option.bind_eq_bind, Option.bind_eq_some_iff] at h
  obtain ⟨_, _, h⟩ := h
  split at h
  · cases h; assumption
  · cases h

end Aven.ID
