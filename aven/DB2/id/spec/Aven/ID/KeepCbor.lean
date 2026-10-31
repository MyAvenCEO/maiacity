import Aven.ID.Keep
import Aven.ID.Keys
import Aven.ID.CapsCbor

/-! # A keeper's bytes (A30, A44)

Everything a keeper checks is one of Core's signed things: a label and a body, its signatures beside it, named by the
hash of the two (A30, `Aven.Core.Signed`). The labels are frozen format strings, never a package's name. Each body has
exactly its own keys, none null and none optional (A42), sorted as the codec sorts them:

```
listing:     ["avenID keep listing 1", {"cap": name, "docs": [{"doc": Doc, "key": key}, …]}]
fetch link:  ["avenDB fetch link 1",   {"n": n, "doc": Doc, "key": key, "prev": name, "epoch": name}]
order:       ["avenID keep order 1",   {"act": "withdraw", "cap": name}  or  {"act": "delete", "doc": Doc}]
choice:      ["avenID keep choice 1",  {"doc": Doc, "fork": key, "branch": key}]
proof:       ["avenDB fetch 1",        {"doc": Doc, "exporter": bytes}]
```

A fetch key is Ed25519, its seed `derive_key("avenDB fetch key 1", the Doc epoch's key)`, so every reader of the epoch
derives it and a keeper checks by its public half (`fetchSeed`, `fetchKey`). A Doc and a name are 32 bytes, a key is
an Ed25519 public key, 32 bytes, and `epoch` is the epoch's name (`KeyFormats.Epoch.name`).

Who signs each (the architect, 31 Oct 2026):
- a **listing**: a device acting for the keep cap's issuer, within its device cap, or the issuer's owners, k of n. It
  names each Doc's first fetch key, number 0;
- **fetch link `n ≥ 1`**: fetch key `n − 1`. It names key `n`, and `prev` is the name of the link before, or of the
  listing for link 1, so a Doc's chain starts at its listing and holds no null;
- an **order**: as a listing;
- a **choice**: a device of the vault that issued the keep cap (A22);
- a **proof**: the fetch key it proves, the Doc's current one or a branch's newest while a fork is unsettled
  (`Keep.serves`), over the connection's TLS exporter.

The keeper's model reads keys and hashes as numbers (`Aven.ID.Keep`); these are the bytes a backend signs and checks.
`keep-bytes.json` gives each body's Value, its CBOR, the bytes signed and its name. Lean signs nothing: the
signatures are the backends', checked against these bytes.

- `labels_distinct`: the five labels differ, so no signature over one kind reads as another's (Core's
  `signing_separates`);
- `link_name_inj`, `listing_name_inj`: two links, or two listings, with one name say the same thing. -/

namespace Aven.ID.KeepCbor

open Aven.Core

private def k (s : String) : Bytes := s.toUTF8.toList

/-- A fetch key's Ed25519 seed, from the key of the Doc epoch it opens. -/
def fetchSeed (epochKey : Bytes) : Bytes := Blake3.deriveKey "avenDB fetch key 1" epochKey

/-- A fetch key's public half, which a keeper checks proofs and links by. -/
def fetchKey (epochKey : Bytes) : Bytes := Keys.publicKey (fetchSeed epochKey)

def listingLabel : Bytes := k "avenID keep listing 1"
def linkLabel : Bytes := k "avenDB fetch link 1"
def orderLabel : Bytes := k "avenID keep order 1"
def choiceLabel : Bytes := k "avenID keep choice 1"
/-- The fetch proof's label, caps' (the keeper's `Aven.Peer.Fetch` cites it). -/
def fetchLabel : Bytes := k "avenDB fetch 1"

theorem labels_distinct : [listingLabel, linkLabel, orderLabel, choiceLabel, fetchLabel].Nodup := by decide +kernel

theorem listingLabel_ok : textOk listingLabel = true := by decide +kernel
theorem linkLabel_ok : textOk linkLabel = true := by decide +kernel

/-! ## A listing -/

/-- A listing: the keep cap it rests on, by its name, and each Doc with its first fetch key, number 0. -/
structure Listing where
  cap : Hash
  docs : List (DocId × Bytes)
  deriving DecidableEq, Repr

def Listing.body (l : Listing) : Value :=
  .map [(k "cap", l.cap.value),
    (k "docs", .array (l.docs.map fun (d, key) => .map [(k "doc", docValue d), (k "key", .bytes key)]))]

def Listing.signed (l : Listing) (sigs : List Core.Sig := []) : Signed :=
  { label := listingLabel, body := l.body, sigs }

/-! ## A fetch link -/

/-- Fetch link `n`: the Doc, the epoch it opens by its name, its new fetch key, and the name before it. -/
structure Link where
  doc : DocId
  epoch : Hash
  key : Bytes
  n : Nat
  prev : Hash
  deriving DecidableEq, Repr

def Link.body (l : Link) : Value :=
  .map [(k "n", .uint l.n), (k "doc", docValue l.doc), (k "key", .bytes l.key), (k "prev", l.prev.value),
    (k "epoch", l.epoch.value)]

def Link.signed (l : Link) (sigs : List Core.Sig := []) : Signed := { label := linkLabel, body := l.body, sigs }

/-! ## An order and a choice -/

/-- What a keep cap's issuer orders its keeper: withdraw the keep cap named, or delete a Doc. -/
inductive Order where
  | withdraw (cap : Hash)
  | delete (doc : DocId)
  deriving DecidableEq, Repr

def Order.body : Order → Value
  | .withdraw c => .map [(k "act", .text (k "withdraw")), (k "cap", c.value)]
  | .delete d => .map [(k "act", .text (k "delete")), (k "doc", docValue d)]

def Order.signed (o : Order) (sigs : List Core.Sig := []) : Signed := { label := orderLabel, body := o.body, sigs }

/-- Which branch to follow at a fork of a Doc's fetch keys: the key forked from, and the next key chosen. -/
structure Choice where
  doc : DocId
  fork : Bytes
  branch : Bytes
  deriving DecidableEq, Repr

def Choice.body (c : Choice) : Value :=
  .map [(k "doc", docValue c.doc), (k "fork", .bytes c.fork), (k "branch", .bytes c.branch)]

def Choice.signed (c : Choice) (sigs : List Core.Sig := []) : Signed := { label := choiceLabel, body := c.body, sigs }

/-! ## A fetch proof -/

/-- What a fetch key signs to prove it on a connection: the Doc, and the connection's TLS exporter. -/
def proofBody (doc : DocId) (exporter : Bytes) : Value :=
  .map [(k "doc", docValue doc), (k "exporter", .bytes exporter)]

def proofSigned (doc : DocId) (exporter : Bytes) (sigs : List Core.Sig := []) : Signed :=
  { label := fetchLabel, body := proofBody doc exporter, sigs }

/-! ## One name, one thing -/

/-- Two links with one name say the same thing, under a hash nothing collides under. -/
theorem link_name_inj {H : Bytes → Hash} (hH : Injective H) {a b : Link} (ha : Canon a.body = true)
    (hb : Canon b.body = true) (h : a.signed.name H = b.signed.name H) : a.body = b.body :=
  (Signed.name_inj hH linkLabel_ok linkLabel_ok ha hb h).2

/-- Two listings with one name say the same thing. -/
theorem listing_name_inj {H : Bytes → Hash} (hH : Injective H) {a b : Listing} (ha : Canon a.body = true)
    (hb : Canon b.body = true) (h : a.signed.name H = b.signed.name H) : a.body = b.body :=
  (Signed.name_inj hH listingLabel_ok listingLabel_ok ha hb h).2

end Aven.ID.KeepCbor
