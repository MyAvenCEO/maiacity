import Aven.Core
import Aven.ID
import Aven.DB
import Aven.Runtime.Contract
import Aven.Architecture.Sealed

/-!
# The rules across all parts, as theorems

Each of ARCHITECTURE.md's fourteen rules, composed from the parts' own theorems. Where a rule can't be composed yet,
the theorem states the part that can, and `Aven.Architecture.Gaps` names what is missing; the architect tunes
ARCHITECTURE.md from those.

The two views that join the parts are defined here, once:
- `capsView`: a Core envelope as caps' revocation model sees it, its id and deps the hashes Core names (rules 2, 4,
  11);
- `served`: what a reader sends, the engine's want queue over caps' read grants (rule 6).
-/

namespace Aven.Architecture

open Aven.Core

/-! ## Rule 1: one codec for everything signed -/

/-- Bytes the codec accepts are exactly the encoding of what they decode to: a non-canonical spelling is refused. -/
theorem rule1_canonical {bs : Bytes} {v : Value} (h : decodeAll bs = some v) : Canon v = true ∧ encode v = bs :=
  encode_decodeAll h

/-- A signature covers one label and one body: what is signed for one kind of thing can't be read as another's. -/
theorem rule1_labelled {l₁ l₂ : Bytes} {b₁ b₂ : Value} (hl₁ : textOk l₁ = true) (hl₂ : textOk l₂ = true)
    (hb₁ : Canon b₁ = true) (hb₂ : Canon b₂ = true) (h : signingBytes l₁ b₁ = signingBytes l₂ b₂) :
    l₁ = l₂ ∧ b₁ = b₂ :=
  signing_separates hl₁ hl₂ hb₁ hb₂ h

/-- A thing is named by the hash of its bytes: one name, one thing. -/
theorem rule1_named {H : Bytes → Hash} (hH : Injective H) {a b : Value} (ha : Canon a = true) (hb : Canon b = true)
    (h : nameOf H a = nameOf H b) : a = b :=
  nameOf_inj hH ha hb h

/-! ## Rule 2: history names its past by hash -/

/-- The envelope before another in its log is fixed by the name it gives: two candidates are one envelope. -/
theorem rule2_prev_fixed {H : Bytes → Hash} (hH : Injective H) {a b b' : Envelope} (hb : Canon b.value = true)
    (hb' : Canon b'.value = true) (h : a.prev = some (b.name H)) (h' : a.prev = some (b'.name H)) : b = b' :=
  Envelope.name_inj hH hb hb' (Option.some.inj (h.symm.trans h'))

/-- So is each tip it builds on. -/
theorem rule2_dep_fixed {H : Bytes → Hash} (hH : Injective H) {b b' : Envelope} (hb : Canon b.value = true)
    (hb' : Canon b'.value = true) (h : b.name H = b'.name H) : b = b' :=
  Envelope.name_inj hH hb hb' h

/-- An envelope's Loro dependencies and its hashes name the same past: among envelopes that pass docs rule 7, the same
hashes exactly when the same op ids. -/
theorem rule2_ops_are_hashes {nm : Envelope → Hash} {O : DB.Docs.Ops} {held : List Envelope}
    (inj : ∀ a ∈ held, ∀ b ∈ held, nm a = nm b → a = b) (used : ∀ a ∈ held, ∀ b ∈ held, O.last a = O.last b → a = b)
    {e e' : Envelope} {p p' : List Envelope} (h : DB.Docs.OpsAgree nm O held e p) (h' : DB.Docs.OpsAgree nm O held e' p') :
    DB.Docs.namedPast e = DB.Docs.namedPast e' ↔ O.deps e = O.deps e' :=
  DB.Docs.same_past inj used h h'

/-! ## Rule 3: one writer per log; a split is final -/

/-- A log read as a chain holds no split. -/
theorem rule3_chain_whole {nm : Envelope → Hash} {c : List Envelope} (hc : IsChain nm c) {a b : Envelope}
    (ha : a ∈ c) (hb : b ∈ c) : ¬ Split nm a b :=
  chain_no_split nm hc ha hb

/-- A split, once a reader holds both halves, never counts again, whatever else arrives. -/
theorem rule3_split_final {H : Bytes → Hash} {v : DB.Docs.Verdicts} {S S' : List Envelope} (hs : ∀ x ∈ S, x ∈ S')
    {e : Envelope} (h : Discounted (Envelope.name H) S e) : ¬ DB.Docs.counts H v S' e :=
  DB.Docs.split_final hs h

/-! ## Joining Core's envelopes to caps' revocations -/

/-- A Core envelope as caps' revocation model sees it: its id is its name, its deps the names it gives, and the vault
it writes for, the caps it writes under and the revocations it acknowledges are read from its body. -/
def capsView (H : Bytes → Hash) (vaultOf : Envelope → String) (capsOf acksOf : Envelope → List String)
    (e : Envelope) : ID.Envelope where
  id := (e.name H).text
  writer := vaultOf e
  caps := capsOf e
  deps := (e.prev.toList ++ e.deps).map Hash.text
  acks := acksOf e

/-- The authorized verdict, as every reader computes it from the envelopes it holds and the revocations it knows. -/
def authorized (H : Bytes → Hash) (vaultOf : Envelope → String) (capsOf acksOf : Envelope → List String)
    (rs : List ID.Revocation) (S : List Envelope) (e : Envelope) : Prop :=
  ID.verdict (S.map (capsView H vaultOf capsOf acksOf)) rs (capsView H vaultOf capsOf acksOf e) = .counts

/-! ## Rule 4: readers judge -/

/-- What counts depends only on which envelopes a reader holds, never on the order they came in, nor on anyone's word:
two readers holding the same envelopes agree on every one. -/
theorem rule4_order_free {nm : Envelope → Hash} {ok : Envelope → Prop} {S S' : List Envelope}
    (same : ∀ x, x ∈ S ↔ x ∈ S') {e : Envelope} : Counts nm ok S e ↔ Counts nm ok S' e := by
  have to : ∀ {A B : List Envelope}, (∀ x, x ∈ A → x ∈ B) → (∀ x, x ∈ B → x ∈ A) → Counts nm ok A e →
      Counts nm ok B e := by
    intro A B ab ba h x hx
    obtain ⟨o, ns⟩ := h x (reaches_mono nm ba hx)
    exact ⟨o, fun y hy => ns y (ba y hy)⟩
  exact ⟨to (fun x => (same x).mp) (fun x => (same x).mpr), to (fun x => (same x).mpr) (fun x => (same x).mp)⟩

/-- Readers who agree on what a runtime's hash names lower an operation alike, and make the same commit: the engine's
check is every reader's own. -/
theorem rule4_lowered_alike {Src Val : Type} (rt rt' : DB.Engine.Runtimes Src Val) (h : Hash) (same : rt h = rt' h)
    (eq : Val → Val → Bool) (ofId : DB.Engine.NewId → Val) (w c : Nat) (s : List (DB.Engine.Record Val)) (src : Src) :
    (DB.Engine.lower rt h src).map (DB.Engine.commit eq ofId w c s) =
      (DB.Engine.lower rt' h src).map (DB.Engine.commit eq ofId w c s) :=
  DB.Engine.readers_agree rt rt' h same eq ofId w c s src

/-- Readers judge fit per envelope, from the schema it names; a merge then keeps every field's value fitting the
schema of the envelope that wrote it. -/
theorem rule4_fit_merges {S K V : Type} [DecidableEq K] (rule : S → K → V → Prop) {es : List (DB.Docs.Changes S K V)}
    (h : ∀ e ∈ es, e.fits rule) (k : K) {w : DB.Docs.Write (S × V)} (hw : DB.Docs.latest (DB.Docs.writesOf k es) = some w) :
    rule w.value.1 k w.value.2 :=
  DB.Docs.fit_envelopes rule h k hw

/-! ## Rule 5: reading is holding the key -/

/-- A party nothing is sealed to, a keeper, learns only its own keys; and of a segment it sees only its Doc, its epoch
and its padded length. -/
theorem rule5_keeper_blind {w : ID.World} {keeper : String} (nothing : ∀ s ∈ w.seals, s.2 ∉ w.own keeper)
    (pad : Nat → Nat) {s t : ID.Segment} (d : s.doc = t.doc) (e : s.epoch = t.epoch)
    (l : pad s.body.length = pad t.body.length) :
    (∀ n, ∀ k ∈ w.knownAfter keeper n, k ∈ w.own keeper) ∧ s.outside pad = t.outside pad :=
  ⟨ID.World.keeper_blind nothing, ID.outside_blind pad d e l⟩

/-- A key is learned only by holding a key it is sealed under. -/
theorem rule5_read_is_key {w : ID.World} {n : Nat} {p k : String} (h : w.knows (n + 1) p k = true) :
    w.knows n p k = true ∨ ∃ s ∈ w.seals, s.1 = k ∧ w.knows n p s.2 = true :=
  ID.World.confidential h

/-! ## Rule 6: demand never grants -/

open Classical in
/-- What a reader sends: the engine's want queue, where the cap is caps' read grant on the wanted Doc. -/
noncomputable def served (gov : Bytes → Bytes → Prop) (spawned : DocId → DocId → Prop) (facts : DocId → Facts)
    (g : ID.Grant) (ws : List (DB.Engine.Want DB.Engine.WantKey)) : List DB.Engine.WantKey :=
  (DB.Engine.queue (fun k => decide (g.reaches gov spawned (facts k.doc) .read)) ws).map (·.key)

/-- What leaves a reader is wants ∩ caps: a key is served exactly when someone wants it and a read grant reaches its
Doc. A want alone grants nothing. -/
theorem rule6_wants_caps (gov : Bytes → Bytes → Prop) (spawned : DocId → DocId → Prop) (facts : DocId → Facts)
    (g : ID.Grant) (ws : List (DB.Engine.Want DB.Engine.WantKey)) (k : DB.Engine.WantKey) :
    k ∈ served gov spawned facts g ws ↔ (∃ w ∈ ws, w.key = k) ∧ g.reaches gov spawned (facts k.doc) .read := by
  classical
  unfold served
  rw [DB.Engine.served_eq_wants_caps]
  simp

/-- What leaves a keeper is wants ∩ fetch proofs: it serves only a proof made on this connection, by the current fetch
key or, while a rotation settles, the newest one, chained to the genesis. -/
theorem rule6_keeper {s : ID.Keep} {e : String} {p : ID.Keep.Proof} (h : s.serves e p = true) :
    p.exporter = e ∧ (p.key = s.current ∨ s.unsettled = true ∧ s.newest p.key = true) ∧
      ∃ i, ID.Keep.Chained s i p.key :=
  ID.Keep.served_current h

/-! ## Rule 7: no privilege by position -/

/-- A keeper holds bytes it can't read, serves them only on fetch proofs, and a sealed index takes a root only from a
vault that may write its directory: none of the three is a privilege of where a peer sits. -/
theorem rule7_granted {w : ID.World} {keeper : String} (nothing : ∀ s ∈ w.seals, s.2 ∉ w.own keeper)
    {writers : List String} {pubs : List ID.Sealed.Publish} {p : ID.Sealed.Publish}
    (hp : p ∈ ID.Sealed.taken writers pubs) :
    (∀ n, ∀ k ∈ w.knownAfter keeper n, k ∈ w.own keeper) ∧ p.vault ∈ writers :=
  ⟨ID.World.keeper_blind nothing, (Sealed.root_by_writer hp).2⟩

/-! ## Rule 8: derived state is a cache or a checkpoint -/

/-- A snapshot is a cache: loading it and the rest equals replaying everything. A checkpoint that checks is the replay
of what it covers. A runtime's output, which derives the rest, doesn't depend on the device that ran it. -/
theorem rule8_cache_or_checkpoint {St : Type} (L : DB.Docs.Loro St) (covered after : List Envelope)
    {enc : St → Value} {H : Bytes → Hash} (hH : Injective H) (hc : ∀ s, Canon (enc s) = true)
    (he : ∀ a b, enc a = enc b → a = b) {runtime : Hash} {cp : DB.Docs.Checkpoint} {s : St}
    (hs : nameOf H (enc s) = cp.state) (hck : cp.check L enc H runtime = true) (d d' : Runtime.Device)
    (r : Runtime.Runtime) (l : Runtime.Limits) (p i : Value) :
    after.foldl L.apply (L.replay covered) = L.replay (covered ++ after) ∧ s = L.replay cp.covers ∧
      cp.runtime = runtime ∧ (∀ t ∈ cp.version, ∃ e ∈ cp.covers, e.name H = t) ∧
      Runtime.runOn d r l p i = Runtime.runOn d' r l p i :=
  ⟨L.snapshot_load covered after, DB.Docs.checked_is_replay hH hc he hs hck, (DB.Docs.checked_names hck).1,
    (DB.Docs.checked_names hck).2, Runtime.deterministic d d' r l p i⟩

/-- A sealed index's root is a checkpoint any reader holding its entries can rebuild and compare. -/
theorem rule8_index_root (boundary : Bytes → Bool) (size : Bytes → Nat) (limit : Nat) (H : Bytes → Hash)
    (sealer : Bytes → Bytes → Bytes) {holders : ID.Sealed.Holders} {key : String} {e₁ e₂ : List ID.Sealed.Entry}
    (h : ∀ x, x ∈ ID.Sealed.contents holders key e₁ ↔ x ∈ ID.Sealed.contents holders key e₂) :
    Sealed.sealedRoot boundary size limit H sealer holders key e₁ =
      Sealed.sealedRoot boundary size limit H sealer holders key e₂ :=
  Sealed.sealed_roots_agree boundary size limit H sealer h

/-! ## Rule 9: sealed beyond the device -/

/-- What can be stated today: a keeper, which every byte leaving a device for storage reaches, knows no key it isn't
given. That no plain byte leaves a device at all is a property of the node (`Aven.Architecture.Gaps`). -/
theorem rule9_keeper {w : ID.World} {keeper : String} (nothing : ∀ s ∈ w.seals, s.2 ∉ w.own keeper) :
    ∀ n, ∀ k ∈ w.knownAfter keeper n, k ∈ w.own keeper :=
  ID.World.keeper_blind nothing

/-! ## Rule 10: every input has a limit -/

/-- A query yields no more than its bound and does no more than its cost; a runtime's answer fits its output limit;
an index node fits its size limit; eviction keeps a device within its budget. -/
theorem rule10_limits {Val : Type} (V : DB.Engine.Vals Val) (src : DocId → List (DB.Engine.Tuple Val)) (n : DocId → Nat)
    (hn : ∀ ty, (src ty).length ≤ n ty) (q : DB.Engine.Query Val)
    {r : Runtime.Runtime} {l : Runtime.Limits} {p i o : Value} (hr : Runtime.run r l p i = .ok o)
    (boundary : Bytes → Bool) (size : Bytes → Nat) (limit : Nat) (hx : ∀ x, size x ≤ limit) (es : List Bytes) :
    (DB.Engine.eval V src q).length ≤ DB.Engine.bound n q ∧ DB.Engine.work V src q ≤ DB.Engine.cost n q ∧
      (encode o).length ≤ l.output ∧
      ∀ c ∈ DB.Docs.Index.chunks boundary size limit es, (c.map size).sum ≤ limit :=
  ⟨DB.Engine.length_le_bound V src n hn q, DB.Engine.work_le_cost V src n hn q, (Runtime.run_ok_fits hr).2.1,
    DB.Docs.Index.chunks_size boundary size limit hx es⟩

/-! ## Rule 11: every wait ends -/

/-- An envelope waits only for what it names by hash and the reader lacks: so each wait names what ends it. -/
theorem rule11_waits_named (H : Bytes → Hash) (vaultOf : Envelope → String) (capsOf acksOf : Envelope → List String)
    (rs : List ID.Revocation) (S : List Envelope) (e : Envelope) {ms : List String}
    (h : ID.verdict (S.map (capsView H vaultOf capsOf acksOf)) rs (capsView H vaultOf capsOf acksOf e) = .waits ms) :
    ms ≠ [] ∧ ∀ d ∈ ms, d ∈ (e.prev.toList ++ e.deps).map Hash.text :=
  let ⟨ne, all⟩ := ID.waits_named h
  ⟨ne, fun d m => (all d m).1⟩

/-! ## Rule 12: order is causal; time is a claim -/

/-- An envelope's past is what it names, through what a reader holds: the order uses names only, and an envelope's
claimed time, which lives in its body, never enters it. -/
theorem rule12_causal {nm : Envelope → Hash} {S : List Envelope} {a b : Envelope}
    (h : Reaches nm S a b) (body : Value) : Reaches nm S { a with body := body } b ∨ a = b := by
  cases h with
  | refl => exact .inr rfl
  | step hb hab hr => exact .inl (.step hb hab hr)

end Aven.Architecture
