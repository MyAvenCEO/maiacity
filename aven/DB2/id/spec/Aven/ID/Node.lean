import Aven.Core
import Aven.ID.Keeping

/-! # What a node guarantees (PEERS.md; `Aven.Architecture`'s R3, R7 and R9)

Three properties of every peer, the Aven Peer included, that the architecture asks of avenPEER:

**R3, local first.** A device writes to its own log alone: whether a write fits depends only on its own log and the
new envelope, never on another peer, a link or a learned head (`write_fits`, `write_chain`). And a split's proof
reaches every reader that syncs, directly or through others, with a peer holding it, after which nothing built on
the split counts there (`split_spreads`).

**R7, no peer is the only source.** Devices reach each other through the relays on the settled relay list (PEERS §1), at
the home relay each one's newest address record names (§2). The admin lists only relays every member can use. With two
relays listed, losing any one peer leaves every member reachable by every other (`no_only_relay`); with one, losing it
leaves nobody reachable through a relay (`one_relay_only_source`). A device that re-homes signs a newer address notice,
which every peer takes as newest (`Aven.Peer.Notices.rehome_newest`). A Doc held by two members stays fetchable by every
member when any one peer is lost (`no_only_holder`). Who keeps a Doc is its vault's choice, by keep caps
(`Aven.ID.Keeping`): every new vault starts with one for everything of its own to Maia City's keeper, approved by its
owner (`default_kept`), and a second keeper of its own choice makes the Doc survive the Aven Peer's loss
(`kept_fetchable`).

**R9, what leaves a device.** A device sends a Doc's plain bytes only to a reader of it, by caps' verdict, and sealed
bytes otherwise (`no_plain_to_nonreader`). A relay on the way carries the connection's ciphertext, and a keeper that
isn't a reader is sent sealed bytes, so neither ever sees a plain byte (`relay_blind`, `keeper_blind`). The city-dome's
plain history from before sealing is the one exception (ARCHITECTURE.md, rule 9): it is part of `reads`, as caps
gives it. -/

namespace Aven.ID
namespace Node

open Aven.Core

/-! ## R3: the writer's own log -/

section Local

variable (nm : Envelope → Hash)

/-- A new envelope fits a device's own log: its next place, naming the one before (none for the first), in the same
log. Only the device's own log and the envelope are inputs. -/
def Fits (own : List Envelope) (e : Envelope) : Prop :=
  e.seq = own.length + 1 ∧
    (∀ h : own ≠ [], SameLog e (own[0]'(List.length_pos_iff.mpr h)) ∧ e.prev = some (nm (own.getLast h))) ∧
    (own = [] → e.prev = none)

/-- A device: its own log, and what it holds of others'. -/
structure Device where
  own : List Envelope
  held : List Envelope

/-- A write: the envelope goes onto the device's own log, and nothing else is read. -/
def write (d : Device) (e : Envelope) : Device := { d with own := d.own ++ [e] }

/-- **`write_fits`:** whether a write fits depends on the device's own log alone: two devices with the same own log,
whatever else they hold or whoever they are linked to, accept the same writes. -/
theorem write_fits (d d' : Device) (same : d.own = d'.own) (e : Envelope) : Fits nm d.own e ↔ Fits nm d'.own e := by
  rw [same]

/-- **`write_chain`:** a write that fits keeps the device's own log a chain (`Aven.Core.IsChain`), so it is durable
and readable at once, before any peer has seen it. -/
theorem write_chain {d : Device} {e : Envelope} (c : IsChain nm d.own) (f : Fits nm d.own e) :
    IsChain nm (write d e).own := by
  obtain ⟨fs, fp, f0⟩ := f
  intro i hi
  simp only [write, List.length_append, List.length_singleton] at hi
  by_cases hl : i < d.own.length
  · have h0 : 0 < d.own.length := by omega
    obtain ⟨s, q, p⟩ := c i hl
    refine ⟨?_, ?_, ?_⟩
    · simpa [write, List.getElem_append_left hl, List.getElem_append_left h0] using s
    · simpa [write, List.getElem_append_left hl] using q
    · simp only [write, List.getElem_append_left hl, p]
      split
      · rfl
      · rw [List.getElem_append_left (by omega)]
  · have he : i = d.own.length := by omega
    subst he
    simp only [write, List.getElem_append_right (Nat.le_refl _), Nat.sub_self, List.getElem_singleton]
    by_cases hn : d.own = []
    · have hz : d.own.length = 0 := by simp [hn]
      refine ⟨?_, by simpa [hz] using fs, ?_⟩
      · simp only [hn, List.nil_append, List.getElem_singleton]
        exact ⟨rfl, rfl, rfl⟩
      · simp [hz, f0 hn]
    · have h0 : 0 < d.own.length := List.length_pos_iff.mpr hn
      obtain ⟨s, p⟩ := fp hn
      refine ⟨?_, fs, ?_⟩
      · rw [List.getElem_append_left h0]; exact s
      · split
        · omega
        · rw [p, List.getElem_append_left (by omega), List.getLast_eq_getElem]

/-- **`split_spreads`:** peers that synced one after another, each holding at least what the one before held: a split
the first held reaches the last, and there nothing whose past holds its half counts, whatever else it learns. -/
theorem split_spreads {fit authorized : Envelope → Prop} (held : Nat → List Envelope)
    (synced : ∀ i, ∀ x ∈ held i, x ∈ held (i + 1)) {x y : Envelope} (hx : x ∈ held 0) (hy : y ∈ held 0)
    (sp : Split nm x y) (k : Nat) :
    x ∈ held k ∧ y ∈ held k ∧ ∀ e, Reaches nm (held k) e x → ¬ Counts nm fit authorized (held k) e := by
  have carried : ∀ z ∈ held 0, ∀ k, z ∈ held k := by
    intro z hz k
    induction k with
    | zero => exact hz
    | succ k ih => exact synced k z ih
  refine ⟨carried x hx k, carried y hy k, fun e he => ?_⟩
  exact discounted_not_counts nm ⟨x, y, he, carried y hy k, sp⟩

end Local

/-! ## R7: no peer is the only source -/

/-- The network as the settled tree and the newest records give it: the members' devices, the relay list, which relays
a device can use (a browser only one with a public HTTPS name), and each Doc's holders (its writers' devices and its
keepers). -/
structure Net where
  members : List String
  relays : List String
  usable : String → String → Bool
  holders : String → List String

/-- The relay list names vaults, never devices (rule 15, A28). A listed vault's relay runs on one of its devices, which
its newest address record names: these are the endpoints `Net.relays` holds. -/
def relayEndpoints (vaults : List String) (runs : String → Option String) : List String := vaults.filterMap runs

/-- The admin lists only relays every member can use (PEERS §1). -/
def Net.Listed (n : Net) : Prop := ∀ m ∈ n.members, ∀ r ∈ n.relays, n.usable m r = true

/-- A device's home relay once `gone` is lost: the first listed relay it can use that is still there. Any live one it
can use would do; this one is what its next address record names. -/
def home (n : Net) (gone d : String) : Option String := n.relays.find? fun r => r != gone && n.usable d r

/-- `a` reaches `b` once `gone` is lost: both are still there, and `a` can use the home relay `b`'s address record
names, where iroh dials it. A native pair may also reach each other directly; this is the path every peer has. -/
def reaches (n : Net) (gone a b : String) : Bool :=
  a != gone && b != gone &&
    match home n gone b with
    | some h => n.usable a h
    | none => false

theorem home_some {n : Net} {gone d r : String} (mr : r ∈ n.relays) (hr : r ≠ gone) (u : n.usable d r = true) :
    ∃ h, home n gone d = some h ∧ h ∈ n.relays := by
  cases e : home n gone d with
  | none =>
    have := List.find?_eq_none.mp e r mr
    simp [hr, u] at this
  | some h => exact ⟨h, rfl, List.mem_of_find?_eq_some e⟩

/-- **`no_only_relay`:** with two relays listed, losing any one peer, a relay or not, leaves every member reachable by
every other. -/
theorem no_only_relay {n : Net} (hl : n.Listed) {r₁ r₂ : String} (m₁ : r₁ ∈ n.relays) (m₂ : r₂ ∈ n.relays)
    (ne : r₁ ≠ r₂) (gone : String) {a b : String} (ma : a ∈ n.members) (mb : b ∈ n.members) (ha : a ≠ gone)
    (hb : b ≠ gone) : reaches n gone a b = true := by
  have live : ∃ r ∈ n.relays, r ≠ gone := by
    by_cases g : r₁ = gone
    · exact ⟨r₂, m₂, fun e => ne (g.trans e.symm)⟩
    · exact ⟨r₁, m₁, g⟩
  obtain ⟨r, mr, hr⟩ := live
  obtain ⟨h, eh, mh⟩ := home_some mr hr (hl b mb r mr)
  simp [reaches, ha, hb, eh, hl a ma h mh]

/-- **`one_relay_only_source`:** with one relay listed, losing it leaves nobody reachable through a relay: why the
list holds two. -/
theorem one_relay_only_source {n : Net} {r : String} (one : n.relays = [r]) (a b : String) :
    reaches n r a b = false := by
  simp [reaches, home, one]

/-- A Doc is fetchable by `a` once `gone` is lost: `a` holds it, or reaches a holder. -/
def fetchable (n : Net) (gone a doc : String) : Bool :=
  (n.holders doc).any fun h => h == a || reaches n gone a h

/-- **`no_only_holder`:** a Doc held by two members, with two relays listed, stays fetchable by every member when any
one peer is lost. -/
theorem no_only_holder {n : Net} (hl : n.Listed) {r₁ r₂ : String} (m₁ : r₁ ∈ n.relays) (m₂ : r₂ ∈ n.relays)
    (ne : r₁ ≠ r₂) {doc h₁ h₂ : String} (k₁ : h₁ ∈ n.holders doc) (k₂ : h₂ ∈ n.holders doc) (hne : h₁ ≠ h₂)
    (mh₁ : h₁ ∈ n.members) (mh₂ : h₂ ∈ n.members) (gone : String) {a : String} (ma : a ∈ n.members)
    (ha : a ≠ gone) : fetchable n gone a doc = true := by
  have live : ∃ h ∈ n.holders doc, h ∈ n.members ∧ h ≠ gone := by
    by_cases g : h₁ = gone
    · exact ⟨h₂, k₂, mh₂, fun e => hne (g.trans e.symm)⟩
    · exact ⟨h₁, k₁, mh₁, g⟩
  obtain ⟨h, mh, memh, hg⟩ := live
  simp only [fetchable, List.any_eq_true, Bool.or_eq_true, beq_iff_eq]
  exact ⟨h, mh, .inr (no_only_relay hl m₁ m₂ ne gone ma memh ha hg)⟩

/-- **`kept_fetchable`:** a Doc its vault keeps with the default keep cap and one keep cap of its own choice naming
another keeper stays fetchable by every member when any one peer is lost, the Aven Peer included. Keep caps are caps'
(`Aven.ID.Keeping`), and a Doc's keepers are the vaults its keep caps name for its facts `f`. With the default alone,
the Aven Peer is its one keeper, and only the writer's own devices hold it besides. -/
theorem kept_fetchable {n : Net} (hl : n.Listed) {r₁ r₂ : String} (m₁ : r₁ ∈ n.relays) (m₂ : r₂ ∈ n.relays)
    (ne : r₁ ≠ r₂) {gov : Bytes → Bytes → Bool} {spawned lists : DocId → DocId → Bool} {roles : List Role}
    {caps : List Cap} {doc : String} {f : Facts} {v k s : String} {approvals : List Sig}
    (hk : defaultKeep v k s approvals ∈ caps) (own : f.vault = vaultId v) {c : Cap} {k' : String} (hc : c ∈ caps)
    (cov : c.keeps gov spawned lists roles f = true) (held : c.holder = .vault k') (other : k' ≠ k)
    (holds : ∀ x ∈ keepersOf gov spawned lists roles caps f, x ∈ n.holders doc) (mk : k ∈ n.members)
    (mk' : k' ∈ n.members) (gone : String) {a : String} (ma : a ∈ n.members) (ha : a ≠ gone) :
    fetchable n gone a doc = true :=
  no_only_holder hl m₁ m₂ ne (holds _ (default_kept gov spawned lists hk own))
    (holds _ (holder_keeps gov spawned lists hc cov held)) (Ne.symm other) mk mk' gone ma ha

/-! ## R9: what leaves a device -/

/-- What goes out for a Doc: its plain bytes, or its sealed bytes. -/
inductive Sent where
  | plain (doc : String)
  | sealed (doc : String)
  deriving DecidableEq, Repr

/-- The send path's choice: plain bytes to a reader of the Doc by caps' verdict (`reads`: wants ∩ caps), sealed bytes
to anyone else, a keeper included. -/
def outgoing (reads : String → String → Bool) (to doc : String) : Sent :=
  if reads to doc then .plain doc else .sealed doc

/-- **`no_plain_to_nonreader`:** plain bytes go only to a reader of that Doc. -/
theorem no_plain_to_nonreader {reads : String → String → Bool} {to doc d : String}
    (h : outgoing reads to doc = .plain d) : reads to doc = true ∧ d = doc := by
  unfold outgoing at h
  split at h
  · next r => exact ⟨r, (Sent.plain.inj h).symm⟩
  · cases h

/-- What a device on the way sees of a send from one device to another through relays: the recipient sees what was
sent; a relay sees the connection's ciphertext, sealed whatever the payload, since iroh's QUIC runs end to end; any
other device sees nothing. -/
def seenBy (reads : String → String → Bool) (to : String) (via : List String) (doc x : String) : Option Sent :=
  if x == to then some (outgoing reads to doc) else if via.contains x then some (.sealed doc) else none

/-- **`relay_blind`:** on any path, a plain byte is seen only by the recipient, and only if it reads the Doc. -/
theorem relay_blind {reads : String → String → Bool} {to : String} {via : List String} {doc x d : String}
    (h : seenBy reads to via doc x = some (.plain d)) : x = to ∧ reads to doc = true := by
  unfold seenBy at h
  split at h
  · next e => exact ⟨beq_iff_eq.mp e, (no_plain_to_nonreader (Option.some.inj h)).1⟩
  · split at h <;> cases h

/-- **`keeper_blind`:** a keeper that doesn't read a Doc is sent only its sealed bytes. -/
theorem keeper_blind {reads : String → String → Bool} {keeper doc : String} (h : reads keeper doc = false) :
    outgoing reads keeper doc = .sealed doc := by
  simp [outgoing, h]

/-! ## Examples -/

namespace NodeExamples

/-- Two relays, Alice's Peer and the Aven Peer; Bob's browser can use them, as every member can. -/
def net : Net :=
  { members := ["aven-peer", "alice-peer", "bob-light", "carol-light"], relays := ["aven-peer", "alice-peer"]
    usable := fun _ _ => true
    holders := fun d => if d == "chat" then ["bob-light", "aven-peer", "alice-peer"] else [] }

/-- The chat and Bob's notes, Docs of Bob's vault, as their genesis fixes them. -/
def chat : Facts := ⟨⟨⟨"chat".toUTF8.toList⟩⟩, vaultId "bob", ⟨⟨"chat-type".toUTF8.toList⟩⟩⟩
def notes : Facts := ⟨⟨⟨"notes".toUTF8.toList⟩⟩, vaultId "bob", ⟨⟨"notes-type".toUTF8.toList⟩⟩⟩

/-- Bob's keep cap for the chat at Bob's Peer. -/
def keepChat : Cap :=
  { id := "keep-chat", issuer := "bob", holder := .vault "bob-peer", signer := "bob-light",
    grant := [⟨coreOp .keep, .doc chat.id .self, []⟩] }

-- the Aven Peer stopped: Bob's and Carol's browsers still reach each other, at Alice's relay, and fetch the chat
#guard reaches net "aven-peer" "bob-light" "carol-light"
#guard home net "aven-peer" "carol-light" == some "alice-peer"
#guard fetchable net "aven-peer" "carol-light" "chat"
-- with the Aven Peer's relay alone, its loss leaves the browsers unreachable
#guard !reaches { net with relays := ["aven-peer"] } "aven-peer" "bob-light" "carol-light"
-- Bob's vault keeps everything at the Aven Peer by default, and the chat at Bob's Peer as well
#guard keepersOf (fun _ _ => false) (fun _ _ => false) (fun _ _ => false) []
  [defaultKeep "bob" "aven-peer" "bob-light" [], keepChat] chat == ["aven-peer", "bob-peer"]
#guard keepersOf (fun _ _ => false) (fun _ _ => false) (fun _ _ => false) []
  [defaultKeep "bob" "aven-peer" "bob-light" [], keepChat] notes == ["aven-peer"]
#guard outgoing (fun to _ => to == "bob-light") "aven-peer" "chat" == .sealed "chat"
#guard seenBy (fun to _ => to == "bob-light") "bob-light" ["aven-peer"] "chat" "aven-peer" == some (.sealed "chat")

end NodeExamples

end Node
end Aven.ID
