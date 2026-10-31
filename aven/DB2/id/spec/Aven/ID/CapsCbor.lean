import Aven.ID.Caps
import Aven.Core.TargetCbor

/-! # A cap's bytes (A2)

A cap is a Value, encoded by `Aven.Core`'s deterministic CBOR, its targets as `Aven.Core.TargetCbor` writes them. Its
**body** is everything but its signature and approvals:

```
{"kind": "grant" or "attenuate", "role": role or null, "grant": [line…], "share": n, "holder": holder,
 "issuer": vault, "parent": cap or null, "conditions": {"own", "uses", "approve", "expires", "history", "branches",
 "notBefore"}}
line:    {"verb": "read", "target": target, "footprint": [{"type": Doc, "verb": "put-new", "fields": [field…] or null}]}
holder:  {"vault": v}   {"group": g}   "public"   {"ticket": key}
```

Keys sort as the codec sorts them: shorter first, then by their bytes. A cap's id is the BLAKE3 hash of its body's
encoding (`Cap.digest`), which its issuer's owners approve, unless it attenuates. Its kind is in its body, so a
signature over an attenuation is never one over a grant. Its issuing device signs the body under the label
`avenID cap 1` (`Cap.signing`), so the signature can't be read as anything else's (Core's `signing_separates`).

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

/-- A footprint grant: its type Doc, its step verb, and the fields it allows, or every field. -/
def fpValue (g : Core.Grant) : Value :=
  .map [(key "type", .bytes g.type.hash.bytes), (key "verb", txt g.verb.name),
    (key "fields", match g.fields with | some fs => .array (fs.map .text) | none => .null)]

def Line.value (l : Line) : Value :=
  .map [(key "verb", txt (verbName l.verb)), (key "target", l.target.value),
    (key "footprint", .array (l.footprint.map fpValue))]

def Holder.value : Holder → Value
  | .vault v => .map [(key "vault", txt v)]
  | .group g => .map [(key "group", txt g)]
  | .«public» => txt "public"
  | .ticket k => .map [(key "ticket", txt k)]

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
  .map [(key "kind", txt c.kind.name), (key "role", optText c.role), (key "grant", .array (c.grant.map Line.value)),
    (key "share", .uint c.share), (key "holder", c.holder.value), (key "issuer", txt c.issuer),
    (key "parent", optText c.parent), (key "conditions", c.conditions.value)]

/-- A cap's bytes: its body's one encoding. -/
def Cap.bytes (c : Cap) : Bytes := encode c.body

/-- A cap's id: the hash of its bytes, which its issuer's owners approve. -/
def Cap.digest (H : Bytes → Hash) (c : Cap) : Hash := nameOf H c.body

/-- What its issuing device signs. -/
def capLabel : Bytes := key "avenID cap 1"

def Cap.signing (c : Cap) : Bytes := signingBytes capLabel c.body

/-- Two allowed caps with one id say the same thing, under a hash nothing collides under. -/
theorem Cap.digest_inj {H : Bytes → Hash} (hH : Injective H) {c d : Cap} (hc : Canon c.body = true)
    (hd : Canon d.body = true) (h : c.digest H = d.digest H) : c.body = d.body :=
  nameOf_inj hH hc hd h

end Aven.ID
