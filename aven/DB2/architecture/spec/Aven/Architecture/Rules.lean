import Aven.Core
import Aven.ID
import Aven.DB
import Aven.Runtime.Contract
import Aven.Architecture.Sealed
import Aven.Actor.Hosting

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

/-- A writer's own log never waits for a peer: whether a write fits depends on its own log alone, and a write that fits
keeps that log a chain, readable at once. -/
theorem rule3_never_waits (nm : Envelope → Hash) (d d' : ID.Node.Device) (same : d.own = d'.own) (e : Envelope)
    (c : IsChain nm d.own) :
    (ID.Node.Fits nm d.own e ↔ ID.Node.Fits nm d'.own e) ∧
      (ID.Node.Fits nm d.own e → IsChain nm (ID.Node.write d e).own) :=
  ⟨ID.Node.write_fits nm d d' same e, ID.Node.write_chain nm c⟩

/-- A split is shown to every reader that syncs: its two sides reach each, and nothing built on it counts there. -/
theorem rule3_split_spreads (nm : Envelope → Hash) {ok : Envelope → Prop} (held : Nat → List Envelope)
    (synced : ∀ i, ∀ x ∈ held i, x ∈ held (i + 1)) {x y : Envelope} (hx : x ∈ held 0) (hy : y ∈ held 0)
    (sp : Split nm x y) (k : Nat) :
    x ∈ held k ∧ y ∈ held k ∧ ∀ e, Reaches nm (held k) e x → ¬ Counts nm ok (held k) e :=
  ID.Node.split_spreads nm held synced hx hy sp k

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
theorem rule5_keeper_blind {κ : Type} [DecidableEq κ] {w : ID.WorldOf κ} {keeper : String}
    (nothing : ∀ s ∈ w.seals, s.2 ∉ w.own keeper) (pad : Nat → Nat) {s t : ID.Segment} (d : s.doc = t.doc)
    (e : s.epoch = t.epoch) (l : pad s.body.length = pad t.body.length) :
    (∀ n, ∀ k ∈ w.knownAfter keeper n, k ∈ w.own keeper) ∧ s.outside pad = t.outside pad :=
  ⟨ID.WorldOf.keeper_blind nothing, ID.outside_blind pad d e l⟩

/-- A key is learned only by holding a key it is sealed under, for keys of any kind: Core's bytes where the docs
layer's segments are sealed. -/
theorem rule5_read_is_key {κ : Type} [DecidableEq κ] {w : ID.WorldOf κ} {n : Nat} {p : String} {k : κ}
    (h : w.knows (n + 1) p k = true) : w.knows n p k = true ∨ ∃ s ∈ w.seals, s.1 = k ∧ w.knows n p s.2 = true :=
  ID.WorldOf.confidential h

/-- An envelope sealed under an epoch older than one it builds on, among the Core envelopes a reader holds, doesn't
pass: a removed reader's old key reads nothing new. -/
theorem rule5_epoch_fresh {nm : Envelope → Hash} {epochOf : Envelope → Nat} {doc : List Envelope} {e x : Envelope}
    {d : Hash} (ok : ID.freshEpoch nm epochOf doc e = true) (dm : d ∈ e.deps) (found : doc.find? (nm · == d) = some x) :
    epochOf x ≤ epochOf e :=
  ID.stale_refused ok dm found

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
  ⟨ID.World.keeper_blind nothing, (ID.Sealed.root_by_writer hp).2⟩

/-- No peer is the only source: with two relays listed, losing any one peer leaves every member reaching every other,
and a Doc two members hold stays fetchable by every member. -/
theorem rule7_no_only_source {n : ID.Node.Net} (hl : n.Listed) {r₁ r₂ : String} (m₁ : r₁ ∈ n.relays)
    (m₂ : r₂ ∈ n.relays) (ne : r₁ ≠ r₂) (gone : String) {a b : String} (ma : a ∈ n.members) (mb : b ∈ n.members)
    (ha : a ≠ gone) (hb : b ≠ gone) {doc h₁ h₂ : String} (k₁ : h₁ ∈ n.holders doc) (k₂ : h₂ ∈ n.holders doc)
    (hne : h₁ ≠ h₂) (mh₁ : h₁ ∈ n.members) (mh₂ : h₂ ∈ n.members) :
    ID.Node.reaches n gone a b = true ∧ ID.Node.fetchable n gone a doc = true :=
  ⟨ID.Node.no_only_relay hl m₁ m₂ ne gone ma mb ha hb,
    ID.Node.no_only_holder hl m₁ m₂ ne k₁ k₂ hne mh₁ mh₂ gone ma ha⟩

/-- Hosting is an explicit read cap per actor (A16): a host reads a Doc exactly when a hosting cap of its own, one the
actor's owner is shown, reaches it with `read`. -/
theorem rule7_hosting_explicit (w : Actor.World) (caps : List ID.Cap) (host : String) (f : Facts) :
    Actor.HostReads w caps host f ↔ ∃ a, ∃ c ∈ Actor.shownTo caps (w.ownerOf a),
      Actor.Hosting w c host a ∧ (c.grants w.roles).reaches w.gov w.spawned f .read :=
  Actor.hosting_explicit w caps host f

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

/-- A reader takes a checkpoint only from a device whose vault may write the Doc at the version it names (A5). -/
theorem rule8_checkpoint_by_writer {mayWrite : Bytes → List Hash → Bool} {cps : List DB.Docs.Checkpoint}
    {cp : DB.Docs.Checkpoint} (h : cp ∈ DB.Docs.takenCheckpoints mayWrite cps) :
    cp ∈ cps ∧ mayWrite cp.vault cp.version = true :=
  DB.Docs.checkpoint_by_writer h

/-- A sealed index's root is a checkpoint any reader holding its entries can rebuild and compare. -/
theorem rule8_index_root (boundary : Bytes → Bool) (size : Bytes → Nat) (limit : Nat) (H : Bytes → Hash)
    (sealer : Bytes → Bytes → Bytes) {holders : ID.Sealed.Holders} {key : String} {e₁ e₂ : List ID.Sealed.Entry}
    (h : ∀ x, x ∈ ID.Sealed.contents holders key e₁ ↔ x ∈ ID.Sealed.contents holders key e₂) :
    ID.Sealed.sealedRoot (Sealed.docsRoot boundary size limit) H sealer holders key e₁ =
      ID.Sealed.sealedRoot (Sealed.docsRoot boundary size limit) H sealer holders key e₂ :=
  ID.Sealed.sealed_roots_agree (Sealed.docsRoot_set boundary size limit) H sealer h

/-! ## Rule 9: sealed beyond the device -/

/-- What can be stated today: a keeper, which every byte leaving a device for storage reaches, knows no key it isn't
given. That no plain byte leaves a device at all is a property of the node (`Aven.Architecture.Gaps`). -/
theorem rule9_keeper {w : ID.World} {keeper : String} (nothing : ∀ s ∈ w.seals, s.2 ∉ w.own keeper) :
    ∀ n, ∀ k ∈ w.knownAfter keeper n, k ∈ w.own keeper :=
  ID.World.keeper_blind nothing

/-- What leaves a device: plain bytes go only to a reader of that Doc, by caps' verdict; on any path a plain byte is
seen only by that reader; a keeper that doesn't read the Doc is sent only its sealed bytes. -/
theorem rule9_sealed {reads : String → String → Bool} {to doc d : String} (via : List String) {x keeper : String} :
    (ID.Node.outgoing reads to doc = .plain d → reads to doc = true ∧ d = doc) ∧
      (ID.Node.seenBy reads to via doc x = some (.plain d) → x = to ∧ reads to doc = true) ∧
      (reads keeper doc = false → ID.Node.outgoing reads keeper doc = .sealed doc) :=
  ⟨ID.Node.no_plain_to_nonreader, ID.Node.relay_blind, ID.Node.keeper_blind⟩

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

/-- An envelope is bounded before Loro sees it: its sealed bytes are read capped, holding at most the limit plus one
chunk; once decoded it is admitted only within depth, fan-out, Records and ops; a segment within its envelope and byte
limits hands Loro at most their product of Record changes; a blob stops at its limit whatever size it declared. -/
theorem rule10_inputs (L : DB.Docs.Limits) {chunks : List Bytes} {b out : Bytes}
    (hb : b ∈ DB.Docs.held L.sealed [] chunks) (ho : DB.Docs.capped L.sealed [] chunks = some out) {ops : Nat}
    {e : Envelope} {cs : List DB.Docs.RecordChange} (ha : DB.Docs.admits L ops e cs = true)
    {es : List (List DB.Docs.RecordChange)} (hn : es.length ≤ L.segmentEnvelopes)
    (hr : ∀ cs ∈ es, cs.length ≤ L.records) {declared : Nat} {blobChunks : List Bytes} {blob : Bytes}
    (hbl : DB.Docs.capped (if DB.Docs.fetchBlob L declared then L.blob else 0) [] blobChunks = some blob) :
    (∃ c ∈ chunks, b.length ≤ L.sealed + c.length) ∧ out.length ≤ L.sealed ∧
      (DB.Docs.depth e.body ≤ L.depth ∧ e.deps.length ≤ L.fanout ∧ cs.length ≤ L.records ∧ ops ≤ L.ops) ∧
      (es.map List.length).sum ≤ L.segmentEnvelopes * L.records ∧ blob.length ≤ L.blob :=
  ⟨DB.Docs.capped_holds (by simp) hb, DB.Docs.capped_within (by simp) ho, DB.Docs.admitted_bounded ha,
    DB.Docs.segment_records es hn hr, DB.Docs.blob_bounded hbl⟩

/-- A want page is bounded: a round that moves sends at most the page's entries and bytes, takes them off the front of
what was pending, and sends something whenever every pending entry fits a page. -/
theorem rule10_pages {Key α : Type} [DecidableEq Key] (size : α → Nat) (lim : DB.Engine.Limit)
    (pending : Key → List α) (uploads keys : List Key) (got : Key → Bool) (k : Key) (p : List α)
    (pending' : Key → List α) (h : DB.Engine.roundP size lim pending uploads keys got = (.moved k, p, pending')) :
    p.length ≤ lim.entries ∧ (p.map size).sum ≤ lim.bytes ∧ p ++ pending' k = pending k ∧
      ((∀ x ∈ pending k, size x ≤ lim.bytes) → 0 < lim.entries → p ≠ []) :=
  DB.Engine.page_bounded size lim pending uploads keys got k p pending' h

/-! ## Rule 11: every wait ends -/

/-- An envelope waits only for what it names by hash and the reader lacks: so each wait names what ends it. -/
theorem rule11_waits_named (H : Bytes → Hash) (vaultOf : Envelope → String) (capsOf acksOf : Envelope → List String)
    (rs : List ID.Revocation) (S : List Envelope) (e : Envelope) {ms : List String}
    (h : ID.verdict (S.map (capsView H vaultOf capsOf acksOf)) rs (capsView H vaultOf capsOf acksOf e) = .waits ms) :
    ms ≠ [] ∧ ∀ d ∈ ms, d ∈ (e.prev.toList ++ e.deps).map Hash.text :=
  let ⟨ne, all⟩ := ID.waits_named h
  ⟨ne, fun d m => (all d m).1⟩

/-- A wait never blocks unrelated work: while some key with work left waits on nothing, a round moves such a key and
shrinks what is left, or raises the stall alarm on it, whatever the other keys wait for. -/
theorem rule11_waits_isolated {Key : Type} [DecidableEq Key] (left : Key → Nat)
    (waits : Key → Option DB.Engine.Wait) (uploads keys : List Key) (got : Key → Bool) (hn : (uploads ++ keys).Nodup)
    (k : Key) (hk : k ∈ uploads ++ keys) (hw : waits k = none) (hl : 0 < left k) :
    ∃ k', (waits k' = none ∧ k' ∈ uploads ++ keys ∧ 0 < left k') ∧
      ((DB.Engine.roundW left waits uploads keys got).1 = .moved k' ∧
          DB.Engine.measure (DB.Engine.roundW left waits uploads keys got).2 (uploads ++ keys) <
            DB.Engine.measure left (uploads ++ keys) ∨
        (DB.Engine.roundW left waits uploads keys got).1 = .stalled k') :=
  DB.Engine.waits_isolated left waits uploads keys got hn k hk hw hl

/-- Every round ends one of four ways, each named: done when nothing is left; the stall alarm on a key that could
move and got nothing; waiting, naming every key with work left and what it waits for; or a move. -/
theorem rule11_stall_raised {Key : Type} [DecidableEq Key] (left : Key → Nat) (waits : Key → Option DB.Engine.Wait)
    (uploads keys : List Key) (got : Key → Bool) :
    (∀ left', DB.Engine.roundW left waits uploads keys got = (.done, left') → ∀ k ∈ uploads ++ keys, left k = 0) ∧
    (∀ k left', DB.Engine.roundW left waits uploads keys got = (.stalled k, left') →
        left' = left ∧ k ∈ uploads ++ keys ∧ 0 < left k ∧ waits k = none) ∧
    (∀ ks left', DB.Engine.roundW left waits uploads keys got = (.waiting ks, left') →
        left' = left ∧ ks ≠ [] ∧ ∀ k ∈ uploads ++ keys, 0 < left k → ∃ w, waits k = some w ∧ (k, w) ∈ ks) :=
  DB.Engine.stall_raised left waits uploads keys got

/-! ## Rule 12: order is causal; time is a claim -/

/-- An envelope's past is what it names, through what a reader holds: the order uses names only, and an envelope's
claimed time, which lives in its body, never enters it. -/
theorem rule12_causal {nm : Envelope → Hash} {S : List Envelope} {a b : Envelope}
    (h : Reaches nm S a b) (body : Value) : Reaches nm S { a with body := body } b ∨ a = b := by
  cases h with
  | refl => exact .inr rfl
  | step hb hab hr => exact .inl (.step hb hab hr)

end Aven.Architecture
