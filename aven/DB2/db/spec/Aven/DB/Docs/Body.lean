import Aven.DB.Docs.Genesis
import Aven.DB.Docs.Changes

/-!
# What a docs envelope carries (A32, A43; docs, "Envelopes")

Inside Core's envelope (which holds the Doc, branch, writer id, sequence number, `prev`, `deps`, the signer and the
signature), a docs envelope's `body` is `{at, cap, ops, acks, calls, changes, genesis?, records, generation}`, keys in
the codec's order:

- `acks`: the revocations the writer acknowledges, by hash;
- `at` (`time` here, since `at` is Lean's): the writer's claimed time, text (rule 9: shown, never used for order);
- `calls`: the operations the commit ran, each a `Call.value` (`{op, params}`, A32);
- `cap`: the cap it writes under, by hash, or null;
- `changes`: the Loro update holding exactly the commit's ops;
- `generation`: the writer's generation, which its writer id is derived from;
- `ops`: `{to, from}`, **half-open** as Loro's spans are: the commit's first counter and the writer's next one, so in
  one log an envelope's `from` is the one before's `to` (`log_ops_disjoint`);
- `records`: every Record the commit touches, by id, with the version it was written under: `[type Doc, schema hash]`
  for a user type, `[type Doc]` for a built-in type, which is versioned by its label;
- `genesis`: exactly in a log's first envelope (sequence number 1, no `prev`, no `deps`), absent everywhere else
  (`genesis_iff_first`); a reader refuses either mismatch, and a genesis that isn't the Doc's.

The commit's Loro message is the lowercase hex of BLAKE3 over the canonical CBOR of `records` (`message`).

What it proves: `ofValue_value` on the examples (the strict decoder reads back what it wrote, `#guard`), and
`log_ops_disjoint`: in a log whose envelopes continue each other's ops, no two envelopes share an op id.
-/

namespace Aven.DB.Docs

open Aven.Core

private def k (s : String) : Bytes := s.toUTF8.toList

structure Body where
  acks : List Hash
  time : Bytes
  calls : List Call
  cap : Option Hash
  changes : Bytes
  generation : Nat
  /-- The commit's first counter. -/
  opsFrom : Nat
  /-- The writer's next counter, past the commit's last op. -/
  opsTo : Nat
  /-- By id, sorted as the codec sorts map keys. -/
  records : List (Bytes × Version)
  genesis : Option Genesis := none
  deriving Repr

def recordsValue (rs : List (Bytes × Version)) : Value := .map (rs.map fun (i, v) => (i, v.value))

/-- The body as a Value, its keys in the codec's order. -/
def Body.value (b : Body) : Value :=
  .map ([(k "at", .text b.time), (k "cap", optHash b.cap),
    (k "ops", .map [(k "to", .uint b.opsTo), (k "from", .uint b.opsFrom)]),
    (k "acks", .array (b.acks.map Hash.value)), (k "calls", .array (b.calls.map Call.value)),
    (k "changes", .bytes b.changes)] ++
    (b.genesis.map fun g => (k "genesis", g.value)).toList ++
    [(k "records", recordsValue b.records), (k "generation", .uint b.generation)])

/-- The commit's Loro message: BLAKE3 over the canonical CBOR of `records`, in lowercase hex. -/
def Body.message (b : Body) : String := hex (Blake3.digest (encode (recordsValue b.records)))

/-! ## Reading a body back, strictly -/

def hash? : Value → Option Hash
  | .bytes b => if b.length == 32 then some ⟨b⟩ else none
  | _ => none

def optHash? : Value → Option (Option Hash)
  | .null => some none
  | v => (hash? v).map some

def call? : Value → Option Call
  | .map [(o, .bytes op), (p, .map ps)] =>
    if o == k "op" && p == k "params" && op.length == 32 then some ⟨⟨op⟩, ps⟩ else none
  | _ => none

def pin? : Value → Option (DocId × List Hash)
  | .array [.bytes d, .array hs] => if d.length == 32 then (hs.mapM hash?).map (⟨⟨d⟩⟩, ·) else none
  | _ => none

def genesis? : Value → Option Genesis
  | .map [(p, .array pins), (t, .bytes ty), (n, .bytes nonce), (v, .bytes vault)] =>
    if p == k "pins" && t == k "type" && n == k "nonce" && v == k "vault" && ty.length == 32 then
      (pins.mapM pin?).map fun ps => ⟨ps, ⟨⟨ty⟩⟩, nonce, vault⟩
    else none
  | _ => none

/-- A body from its Value: exactly its keys, each in its form, and `from ≤ to`. -/
def Body.ofValue? (v : Value) : Option Body := do
  let .map kvs := v | none
  let get (key : String) : Option Value := kvs.lookup (k key)
  let keys := kvs.map (·.1)
  let want := [k "at", k "cap", k "ops", k "acks", k "calls", k "changes"] ++
    (if keys.contains (k "genesis") then [k "genesis"] else []) ++ [k "records", k "generation"]
  if keys != want then none
  let .text time ← get "at" | none
  let cap ← optHash? (← get "cap")
  let .map [(tk, .uint to), (fk, .uint fr)] ← get "ops" | none
  if tk != k "to" || fk != k "from" || to < fr then none
  let .array acks ← get "acks" | none
  let .array calls ← get "calls" | none
  let .bytes changes ← get "changes" | none
  let .map rs ← get "records" | none
  let .uint generation ← get "generation" | none
  let genesis ← match get "genesis" with
    | none => some none
    | some g => (genesis? g).map some
  let acks ← acks.mapM hash?
  let calls ← calls.mapM call?
  let records ← rs.mapM fun (i, x) => (Version.ofValue? x).map (i, ·)
  some { acks, time, calls, cap, changes, generation, opsFrom := fr, opsTo := to, records, genesis }

/-! ## Where the genesis rides -/

/-- An envelope is its log's first: sequence number 1, nothing before it, nothing it builds on. -/
def isFirst (e : Envelope) : Bool := e.seq == 1 && e.prev.isNone && e.deps.isEmpty

/-- The genesis rides exactly in a log's first envelope: present there, absent everywhere else, no default. A reader
refuses either mismatch. -/
def genesisPlaced (e : Envelope) (b : Body) : Bool := b.genesis.isSome == isFirst e

theorem genesis_iff_first {e : Envelope} {b : Body} (h : genesisPlaced e b = true) :
    b.genesis.isSome = true ↔ isFirst e = true := by
  simp only [genesisPlaced, beq_iff_eq] at h
  rw [h]

/-! ## Ops in one log -/

/-- A log's bodies continue each other's ops: each is non-empty, and each starts where the one before ended. -/
def opsChain : List Body → Bool
  | [] => true
  | [b] => b.opsFrom < b.opsTo
  | a :: b :: rest => a.opsFrom < a.opsTo && a.opsTo == b.opsFrom && opsChain (b :: rest)

theorem opsChain_tail : ∀ {a : Body} {l : List Body}, opsChain (a :: l) = true → opsChain l = true
  | _, [], _ => rfl
  | _, _ :: _, h => by simp only [opsChain, Bool.and_eq_true] at h; exact h.2

theorem opsChain_head : ∀ {a : Body} {l : List Body}, opsChain (a :: l) = true → a.opsFrom < a.opsTo
  | _, [], h => by simpa [opsChain] using h
  | _, _ :: _, h => by simp only [opsChain, Bool.and_eq_true, decide_eq_true_eq] at h; exact h.1.1

/-- Every later body of a chain starts at or after where an earlier one ends. -/
theorem opsChain_after : ∀ {a : Body} {l : List Body}, opsChain (a :: l) = true → ∀ b ∈ l, a.opsTo ≤ b.opsFrom
  | _, [], _, _, hb => by simp at hb
  | a, c :: rest, h, b, hb => by
    have hc : opsChain (c :: rest) = true := opsChain_tail h
    simp only [opsChain, Bool.and_eq_true, beq_iff_eq] at h
    rcases List.mem_cons.mp hb with rfl | hb
    · omega
    · have := opsChain_after hc b hb
      have := opsChain_head hc
      omega

/-- In one log whose ops continue, no two envelopes share an op id: their ranges `[from, to)` are disjoint. -/
theorem log_ops_disjoint : ∀ {l : List Body}, opsChain l = true → l.Pairwise fun x y => x.opsTo ≤ y.opsFrom
  | [], _ => List.Pairwise.nil
  | _ :: _, h => List.Pairwise.cons (opsChain_after h) (log_ops_disjoint (opsChain_tail h))

/-! ## Examples -/

def exampleBody : Body :=
  { acks := [], time := k "2026-10-31T12:00:00Z", calls := [⟨CoreOp.put.id blake3, []⟩], cap := none,
    changes := [1, 2, 3], generation := 0, opsFrom := 4, opsTo := 9,
    records := [(k "t1", ⟨⟨blake3 (k "a type")⟩, some (blake3 (k "a schema"))⟩)] }

#guard match exampleBody.value with | .map kvs => keysSorted kvs | _ => false
#guard (Body.ofValue? exampleBody.value).map (·.value) == some exampleBody.value
#guard (Body.ofValue? { exampleBody with opsFrom := 10 }.value).isNone
#guard decodeAll (encode exampleBody.value) == some exampleBody.value

end Aven.DB.Docs
