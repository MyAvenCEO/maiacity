import Aven.DB.Docs.Genesis

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

/-- The version a Record was written under: its type Doc, and its schema's hash unless the type is built in. -/
structure Version where
  type : DocId
  schema : Option Hash
  deriving DecidableEq, Repr

def Version.value (v : Version) : Value := .array (.bytes v.type.hash.bytes :: (v.schema.map Hash.value).toList)

def Version.ofValue? : Value → Option Version
  | .array [.bytes t] => if t.length == 32 then some ⟨⟨⟨t⟩⟩, none⟩ else none
  | .array [.bytes t, .bytes s] => if t.length == 32 && s.length == 32 then some ⟨⟨⟨t⟩⟩, some ⟨s⟩⟩ else none
  | _ => none

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

/-- The reader's genesis check: placed exactly in a log's first envelope, and when there, the genesis of the Doc the
envelope says it belongs to. -/
def genesisOk (H : Bytes → Hash) (e : Envelope) (b : Body) : Bool :=
  genesisPlaced e b && b.genesis.all (·.id H == e.doc)

/-- A genesis an envelope carries, past the check, names the envelope's own Doc. -/
theorem genesis_names_doc {H : Bytes → Hash} {e : Envelope} {b : Body} {g : Genesis} (h : genesisOk H e b = true)
    (hg : b.genesis = some g) : g.id H = e.doc := by
  simp only [genesisOk, Bool.and_eq_true, hg, Option.all_some, beq_iff_eq] at h
  exact h.2

/-- An envelope that builds on nothing is its log's first (the log's rule: sequence number 1 exactly when there is no
`prev`), so past the check it carries its Doc's genesis: every Doc's history starts at the genesis that names it. -/
theorem root_carries_genesis {H : Bytes → Hash} {e : Envelope} {b : Body} (h : genesisOk H e b = true)
    (hlog : e.seq = 1 ↔ e.prev = none) (hprev : e.prev = none) (hdeps : e.deps = []) :
    ∃ g, b.genesis = some g ∧ g.id H = e.doc := by
  have hfirst : isFirst e = true := by simp [isFirst, hlog.mpr hprev, hprev, hdeps]
  have hok := h
  simp only [genesisOk, Bool.and_eq_true] at h
  have hsome := (genesis_iff_first h.1).mpr hfirst
  obtain ⟨g, hg⟩ := Option.isSome_iff_exists.mp hsome
  exact ⟨g, hg, genesis_names_doc hok hg⟩

/-- **Every envelope of a Doc descends from the genesis that names it.** Among held envelopes `S` that each pass the
reader's genesis check, keep the log's rule (`seq = 1` exactly when there is no `prev`) and belong to Doc `d`, an
envelope of `d` whose whole past is held (Core's `Closed`) reaches a root carrying `d`'s genesis. The past is finite and
acyclic, which the model takes as a rank that drops along every parent, as Core takes names: a parent's hash is in its
child, so no cycle can be held. -/
theorem closed_reaches_genesis {H : Bytes → Hash} {nm : Envelope → Hash} {S : List Envelope} {d : DocId}
    (bodyOf : Envelope → Body) (rank : Envelope → Nat) (hrank : ∀ a b, BuildsOn nm a b → rank b < rank a)
    (hgood : ∀ x ∈ S, genesisOk H x (bodyOf x) = true)
    (hlog : ∀ x : Envelope, x.seq = 1 ↔ x.prev = none) (hdoc : ∀ x ∈ S, x.doc = d) :
    ∀ (e : Envelope), genesisOk H e (bodyOf e) = true → e.doc = d → Closed nm S e →
      ∃ r g, Reaches nm S e r ∧ (bodyOf r).genesis = some g ∧ g.id H = d := by
  suffices aux : ∀ n (e : Envelope), rank e < n → genesisOk H e (bodyOf e) = true → e.doc = d → Closed nm S e →
      ∃ r g, Reaches nm S e r ∧ (bodyOf r).genesis = some g ∧ g.id H = d by
    intro e hok he hc
    exact aux (rank e + 1) e (Nat.lt_succ_self _) hok he hc
  intro n
  induction n with
  | zero => intro e h; exact absurd h (Nat.not_lt_zero _)
  | succ n ih =>
    intro e hlt hok he hc
    by_cases hroot : e.prev = none ∧ e.deps = []
    · obtain ⟨g, hg, hid⟩ := root_carries_genesis hok (hlog e) hroot.1 hroot.2
      exact ⟨e, g, .refl _, hg, hid.trans he⟩
    · -- a parent it names, which `Closed` holds
      have hpar : ∃ h, e.prev = some h ∨ h ∈ e.deps := by
        cases hp : e.prev with
        | some h => exact ⟨h, .inl rfl⟩
        | none =>
          cases hd : e.deps with
          | nil => exact absurd ⟨hp, hd⟩ hroot
          | cons h _ => exact ⟨h, .inr (by simp)⟩
      obtain ⟨h, hh⟩ := hpar
      obtain ⟨y, hy, hny⟩ := hc e (.refl _) h hh
      have hb : BuildsOn nm e y := by
        rcases hh with hh | hh
        · exact .inl (hny ▸ hh)
        · exact .inr (hny ▸ hh)
      have hry : Reaches nm S e y := .step hy hb (.refl _)
      have hylt : rank y < n := Nat.lt_of_lt_of_le (hrank e y hb) (Nat.le_of_lt_succ hlt)
      obtain ⟨r, g, hr, hg, hid⟩ := ih y hylt (hgood y hy) (hdoc y hy) (closed_past nm hc hry)
      exact ⟨r, g, .step hy hb hr, hg, hid⟩

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
