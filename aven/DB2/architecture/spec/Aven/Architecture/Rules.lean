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

The view that joins the parts is defined here, once: `served`, what a reader sends, the engine's want queue over caps'
read grants (rule 6). Caps' revocation verdict, and the deletes a reader holds, read Core's envelopes themselves, their
past Core's `Reaches` (`Aven.Core.Past.reaches_iff`, rules 2, 4 and 11).
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

/-- The envelope before another in its log is fixed by the name it gives: two candidates say the same thing, and
differ at most in their signatures (A30). -/
theorem rule2_prev_fixed {H : Bytes → Hash} (hH : Injective H) {a b b' : Envelope} (hb : Canon b.unsigned = true)
    (hb' : Canon b'.unsigned = true) (h : a.prev = some (b.name H)) (h' : a.prev = some (b'.name H)) :
    { b with sig := b'.sig } = b' :=
  Envelope.name_inj hH hb hb' (Option.some.inj (h.symm.trans h'))

/-- So is each tip it builds on. -/
theorem rule2_dep_fixed {H : Bytes → Hash} (hH : Injective H) {b b' : Envelope} (hb : Canon b.unsigned = true)
    (hb' : Canon b'.unsigned = true) (h : b.name H = b'.name H) : { b with sig := b'.sig } = b' :=
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

/-- The authorized verdict, as every reader computes it from the envelopes it holds and the revocations it knows: caps'
verdict on Core's envelopes, with the vault each writes for, the caps it writes under and the revocations it
acknowledges read from its body. -/
def authorized (H : Bytes → Hash) (vaultOf : Envelope → String) (capsOf acksOf : Envelope → List Hash)
    (rs : List ID.Revocation) (S : List Envelope) (e : Envelope) : Prop :=
  ID.verdict (Envelope.name H) ⟨vaultOf, capsOf, acksOf⟩ S rs e = .counts

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

/-- The content of an envelope, as every reader judges it from the changes it sees: the engine's footprint check (the
changes stay within the steps its calls lower to, `fp`, which caps checked it may call, A32) and docs' fit, both over
the one change view, from the version the envelope builds on (`before`) to the one it makes (`step`). -/
def contentOk (ver : DocId → DB.Docs.Version) (fp : Envelope → List Step) (rule : DB.Docs.Version → Bytes → Value → Prop)
    (before : Envelope → List (DB.Engine.Record Value))
    (step : List (DB.Engine.Record Value) → Envelope → List (DB.Engine.Record Value)) (e : Envelope) : Prop :=
  DB.Engine.verdictFootprint (fp e) (DB.Engine.changesFrom ver (before e) (step (before e) e)) = true ∧
    DB.Docs.FitsAll rule (DB.Engine.changesFrom ver (before e) (step (before e) e))

/-- One reader verdict (rule 4): caps' `Verdict`, with fresh the epoch check, live the revocation verdict and the
deletes the reader holds (`ID.liveWith`), and fit the content check against the reader's footprint: the steps the
calls it authorized lower to (A32). An envelope counts exactly when everything in its past is signed, in a fresh epoch,
authorized by its cap chain, not revoked, not ended by a delete, within its calls' footprint and fit, and none of it is
half of a split. -/
theorem rule4_one_verdict (r : ID.Reader) (gov : Bytes → Bytes → Prop) (spawned lists : DocId → DocId → Prop)
    (signed : Envelope → Prop) (H : Bytes → Hash) (epochOf : Envelope → Nat) (rd : ID.Reads)
    (rs : List ID.Revocation) (isDelete byOwner : Envelope → Bool) (ver : DocId → DB.Docs.Version)
    (rule : DB.Docs.Version → Bytes → Value → Prop) (before : Envelope → List (DB.Engine.Record Value))
    (step : List (DB.Engine.Record Value) → Envelope → List (DB.Engine.Record Value)) (S : List Envelope)
    (e : Envelope) :
    Counts (Envelope.name H)
        (r.Verdict gov spawned lists signed (fun x => ID.freshEpoch (Envelope.name H) epochOf S x = true)
          (fun x => ID.liveWith (Envelope.name H) rd isDelete byOwner S rs x = true)
          (contentOk ver r.footprint rule before step)) S e ↔
      ∀ x, Reaches (Envelope.name H) S e x →
        (signed x ∧ ID.freshEpoch (Envelope.name H) epochOf S x = true ∧ r.Authorized gov spawned lists x ∧
          ID.liveWith (Envelope.name H) rd isDelete byOwner S rs x = true ∧
          contentOk ver r.footprint rule before step x) ∧
        ∀ y ∈ S, ¬ Split (Envelope.name H) x y :=
  ID.counts_iff r gov spawned lists (Envelope.name H) _ _ _ _ S e

/-- A delete ends a Doc for every reader (A22): `byOwner` is caps' own-authority path (`ID.Reader.Own`, never an actor
host's), so the delete is written by a device of the Doc's vault or of one that governs it; and once a reader holds
it, an envelope that counts is the delete or in its past, whatever cap it writes under. Readers holding the same
deletes, and the same past of each, agree on it (`ID.deleted_agree`). -/
theorem rule4_delete_ends (r : ID.Reader) (gov : Bytes → Bytes → Prop) (spawned lists : DocId → DocId → Prop)
    (signed : Envelope → Prop) (H : Bytes → Hash) (epochOf : Envelope → Nat) (rd : ID.Reads)
    (rs : List ID.Revocation) (isDelete byOwner : Envelope → Bool)
    (owner : ∀ x, byOwner x = true → r.Own gov x ∧ ¬ r.HostSigned x) (fit : Envelope → Prop) {S : List Envelope}
    {d e : Envelope} (hd : d ∈ S) (del : isDelete d = true) (own : byOwner d = true) (he : e ∈ S)
    (h : Counts (Envelope.name H)
      (r.Verdict gov spawned lists signed (fun x => ID.freshEpoch (Envelope.name H) epochOf S x = true)
        (fun x => ID.liveWith (Envelope.name H) rd isDelete byOwner S rs x = true) fit) S e) :
    r.Own gov d ∧ (Envelope.name H d = Envelope.name H e ∨ Past.Before (Envelope.name H) S d e) :=
  ⟨(owner d own).1, ID.delete_ends hd del own he (ID.liveWith_iff.mp ((h e (.refl e)).1).2.2.2.1).2⟩

/-- Two readers that hold the same past of an envelope, and the same splits in it, give it the same verdict, whatever
else each holds. -/
theorem rule4_readers_agree (nm : Envelope → Hash) (ok : Envelope → Prop) {S S' : List Envelope} {e : Envelope}
    (past : ∀ x, Reaches nm S e x ↔ Reaches nm S' e x)
    (splits : ∀ x, Reaches nm S e x → ((∃ y ∈ S, Split nm x y) ↔ (∃ y ∈ S', Split nm x y))) :
    Counts nm ok S e ↔ Counts nm ok S' e :=
  ID.readers_agree nm ok past splits

/-- What the content check gives: every change is one a step of the footprint makes, the footprint being the steps the
envelope's calls lower to; and where what an envelope says it does is the diff a reader sees (`ChangesAreDiff`, with
distinct Record ids in the engine's `diff_footprint`), fit holds of what it says. -/
theorem rule4_content {ver : DocId → DB.Docs.Version} {fp : Envelope → List Step} {rule : DB.Docs.Version → Bytes → Value → Prop}
    {before : Envelope → List (DB.Engine.Record Value)}
    {step : List (DB.Engine.Record Value) → Envelope → List (DB.Engine.Record Value)} {e : Envelope}
    (h : contentOk ver fp rule before step e) {R : DB.Docs.Reading (List (DB.Engine.Record Value))}
    (link : DB.Docs.ChangesAreDiff R (DB.Engine.changesFrom ver) step) {cs : List DB.Docs.RecordChange}
    (said : R.changesOf (before e) e = some cs) :
    (∀ ch ∈ DB.Engine.changesFrom ver (before e) (step (before e) e),
      (ch.kind = .new → ∃ st ∈ fp e, st.type = ch.type.type ∧ st.verb = .putNew) ∧
      (ch.kind = .gone → ∃ st ∈ fp e, st.type = ch.type.type ∧ st.verb = .remove) ∧
      (ch.kind ≠ .gone → ∀ f ∈ ch.names, ∃ st ∈ fp e, st.type = ch.type.type ∧ f ∈ st.fields)) ∧
    DB.Docs.FitsAll rule cs :=
  ⟨DB.Engine.footprint_steps _ _ h.1, (DB.Docs.fit_diff link rule said).mpr h.2⟩

/-- **What an owner approves as reading never writes** (A2, A32): under a chain whose last cap names only ops that lower
to no step, as `core/1`'s read, tell, keep and share do, an envelope that passes the content check brings no Record,
removes none and changes no field of one. -/
theorem rule4_reading_writes_nothing (r : ID.Reader) (gov : Bytes → Bytes → Prop)
    (spawned lists : DocId → DocId → Prop) {ver : DocId → DB.Docs.Version} {rule : DB.Docs.Version → Bytes → Value → Prop}
    {before : Envelope → List (DB.Engine.Record Value)}
    {step : List (DB.Engine.Record Value) → Envelope → List (DB.Engine.Record Value)} {e : Envelope}
    (h : r.ByChain gov spawned lists e) {last : ID.Cap} (hl : (r.chain e).getLast? = some last)
    (reads : ∀ l ∈ last.grants r.ctx.roles, ∀ c : Call, c.op = l.op → r.lower c = [])
    (hc : contentOk ver r.footprint rule before step e) :
    ∀ ch ∈ DB.Engine.changesFrom ver (before e) (step (before e) e), ch.kind = .edited ∧ ch.names = [] := by
  have z := ID.chain_writes_nothing r gov spawned lists h hl reads
  intro ch m
  obtain ⟨hn, hg, hf⟩ := DB.Engine.footprint_steps _ _ hc.1 ch m
  rw [z] at hn hg hf
  cases k : ch.kind with
  | new =>
    obtain ⟨_, m, _⟩ := hn k
    simp at m
  | gone =>
    obtain ⟨_, m, _⟩ := hg k
    simp at m
  | edited =>
    refine ⟨rfl, ?_⟩
    cases hnm : ch.names with
    | nil => rfl
    | cons f _ =>
      have := hf (by simp [k]) f (by simp [hnm])
      simp at this

/-- **A merge into main is judged on the whole merge** (caps, "Checking"). A reader whose calls for an envelope on
main are every call the merge brings onto main, whose footprint is the steps they lower to, and whose `before` for it
is main's Records at its `prev`, judges every merge into main whole (`WholeMerges` holds by construction). Then, for an
authorized merge on main that passes the content check: every Record of main it changes, brings or removes is written,
created or removed by a step those calls lower to; the signing device's cap writes on main and allows every such call;
and the authority is either the signer's vault, which owns or governs the Doc, or a chain whose last cap writes on
main and allows every such call. A narrow merger can't land a proposal's wider changes. -/
theorem rule4_merge_whole (r : ID.Reader) (gov : Bytes → Bytes → Prop) (spawned lists : DocId → DocId → Prop)
    {ver : DocId → DB.Docs.Version} (hver : ∀ t, (ver t).type = t) {rule : DB.Docs.Version → Bytes → Value → Prop}
    {before : Envelope → List (DB.Engine.Record Value)}
    {step : List (DB.Engine.Record Value) → Envelope → List (DB.Engine.Record Value)} {e : Envelope}
    (main : e.branch = ID.mainBranch) (hn : ((before e).map (·.id)).Nodup) (h : r.Authorized gov spawned lists e)
    (hc : contentOk ver r.footprint rule before step e) :
    -- every Record of main the merge touches, every field it changes or removes, is handled by a step the whole merge's
    -- calls lower to
    ((∀ r' ∈ step (before e) e, ∀ r0 ∈ before e, r0.id = r'.id → ∀ fl v, (fl, v) ∈ r'.fields →
        DB.Engine.optEq DB.Engine.valEq (DB.Engine.get r0.fields fl) (DB.Engine.get r'.fields fl) = false →
          ∃ st ∈ r.footprint e, st.type = r'.type ∧ fl ∈ st.fields) ∧
      (∀ r' ∈ step (before e) e, ∀ r0 ∈ before e, r0.id = r'.id → ∀ fl ∈ r0.fields.map Prod.fst,
        DB.Engine.get r'.fields fl = none → ∃ st ∈ r.footprint e, st.type = r'.type ∧ fl ∈ st.fields) ∧
      (∀ r' ∈ step (before e) e, (∀ r0 ∈ before e, r0.id ≠ r'.id) →
        (∃ st ∈ r.footprint e, st.type = r'.type ∧ st.verb = .putNew) ∧
        ∀ fl ∈ r'.fields.map Prod.fst, ∃ st ∈ r.footprint e, st.type = r'.type ∧ fl ∈ st.fields) ∧
      (∀ r0 ∈ before e, (∀ r' ∈ step (before e) e, r'.id ≠ r0.id) →
        ∃ st ∈ r.footprint e, st.type = r0.type ∧ st.verb = .remove)) ∧
    -- the signing device's cap writes on main and allows every call of the whole merge
    (∃ dc f, r.deviceCap e.signer = some dc ∧ dc.branches.allows ID.mainBranch = true ∧ r.facts e.doc = some f ∧
      ∀ c ∈ r.calls e, dc.allows gov spawned lists f c) ∧
    -- on the signer's vault's own authority, or by a chain whose last cap writes on main and allows every call
    (r.Own gov e ∨
      ∃ last, (r.chain e).getLast? = some last ∧ last.conditions.branches.allows ID.mainBranch = true ∧
        ∃ f, r.facts e.doc = some f ∧ ∀ c ∈ r.calls e, (last.grants r.ctx.roles).allows gov spawned lists f c) := by
  have wm : r.WholeMerges r.calls := fun _ _ _ m => m
  have ⟨hchg, hrm, hnew, hgone⟩ :=
    DB.Engine.merge_steps ver hver (r.footprint e) (before e) (step (before e) e) hn hc.1
  refine ⟨⟨hchg, hrm, hnew, hgone⟩, ID.merge_within_device r gov spawned lists wm main h, ?_⟩
  rcases ID.authorized_by r gov spawned lists h with own | chain
  · exact .inl own
  · exact .inr (ID.merge_covered r gov spawned lists wm main chain)

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
noncomputable def served (gov : Bytes → Bytes → Prop) (spawned lists : DocId → DocId → Prop) (facts : DocId → Facts)
    (g : ID.Grant) (ws : List (DB.Engine.Want DB.Engine.WantKey)) : List DB.Engine.WantKey :=
  (DB.Engine.queue (fun k => decide (g.reaches gov spawned lists (facts k.doc) (ID.coreOp .read))) ws).map (·.key)

/-- What leaves a reader is wants ∩ caps: a key is served exactly when someone wants it and a line naming `read`
reaches its Doc. A want alone grants nothing. -/
theorem rule6_wants_caps (gov : Bytes → Bytes → Prop) (spawned lists : DocId → DocId → Prop) (facts : DocId → Facts)
    (g : ID.Grant) (ws : List (DB.Engine.Want DB.Engine.WantKey)) (k : DB.Engine.WantKey) :
    k ∈ served gov spawned lists facts g ws ↔
      (∃ w ∈ ws, w.key = k) ∧ g.reaches gov spawned lists (facts k.doc) (ID.coreOp .read) := by
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
      Actor.Hosting w c host a ∧ (c.grants w.roles).reaches w.gov w.spawned w.lists f (ID.coreOp .read) :=
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

/-- A vault's quota at the keeper: what the keeper takes leaves every vault within its quota, and it takes only uploads
it serves. -/
theorem rule10_quota (k : ID.Keep) (quota : String → Nat) (us taken : List ID.Keep.Upload)
    (within : ∀ v, ID.Keep.spent taken v ≤ quota v) (served : ∀ u ∈ taken, k.serves u.exporter u.proof = true) :
    (∀ v, ID.Keep.spent (k.admit quota taken us) v ≤ quota v) ∧
      ∀ u ∈ k.admit quota taken us, k.serves u.exporter u.proof = true :=
  ⟨ID.Keep.quota_holds k quota us taken within, ID.Keep.admitted_served k quota us taken served⟩

/-! ## Rule 11: every wait ends -/

/-- An envelope waits only for what it names by hash and the reader lacks: so each wait names what ends it. -/
theorem rule11_waits_named (H : Bytes → Hash) (vaultOf : Envelope → String) (capsOf acksOf : Envelope → List Hash)
    (rs : List ID.Revocation) (S : List Envelope) (e : Envelope) {ms : List Hash}
    (h : ID.verdict (Envelope.name H) ⟨vaultOf, capsOf, acksOf⟩ S rs e = .waits ms) :
    ms ≠ [] ∧ ∀ d ∈ ms, d ∈ e.prev.toList ++ e.deps :=
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

/-- Time is a claim, judged by acks: once a writer whose clock had passed an expiry acks it, a write the ack hadn't
seen doesn't count whatever time it claims, and a write claiming a time past the expiry never counts. -/
theorem rule12_time_acked (nm : Envelope → Hash) (rd : ID.Reads) (time : Envelope → Nat) {doc : List Envelope}
    {x : Hash} {t : Nat} {e a : Envelope} (ha : a ∈ doc) (acks : x ∈ rd.acks a) (late : t ≤ time a) (he : e ∈ doc)
    (unseen : ¬ Past.Before nm doc a e) :
    ID.inTime nm rd time doc x t e = false ∧ (t ≤ time e → ID.inTime nm rd time doc x t e = false) :=
  ⟨ID.time_acked ha acks late he unseen, fun l => ID.claimed_late l⟩

/-! ## Rule 13: keys live only in the safe -/

/-- Whatever the safe answers, it shows only what may be lent, and carries out none of the keys and credentials it
keeps, not even sealed. -/
theorem rule13_safe {r : ID.Safe.Runtime} {s : ID.Safe.Safe} {as : List ID.Safe.Ask} {o : ID.Safe.Out}
    (m : o ∈ ID.Safe.run r s as) :
    (∀ x ∈ o.shows, x.lendable = true) ∧ ∀ x ∈ o.carries, x.kept = false :=
  ⟨ID.Safe.safe_holds m, ID.Safe.stays_inside m⟩

end Aven.Architecture
