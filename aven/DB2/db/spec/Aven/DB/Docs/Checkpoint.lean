import Aven.DB.Docs.Loro

/-!
# Checkpoints

A checkpoint travels: a signed statement that a state is a branch at a version, covering these segments (docs,
"Snapshots and checkpoints"; A5). A new device starts from it, marked unchecked, and checks it in the background: it
replays what the checkpoint covers and compares the state's hash. The model takes the state's encoding (its Records'
CBOR) as a parameter that loses nothing.

What it proves: a state a reader took from a checkpoint that then checks is exactly the replay of what it covers
(`checked_is_replay`), so a checkpoint that lies is always caught; and it names its version's tips, among what it
covers, and the runtime that made it (`checked_names`).
-/

namespace Aven.DB.Docs

open Aven.Core

/-- A checkpoint: the version it is at (its tips' names), what it covers, the state's hash, and the runtime that made
it (architecture, rule 8). -/
structure Checkpoint where
  version : List Hash
  covers : List Envelope
  state : Hash
  runtime : Hash

/-- The background check, with the runtime the reader replays with: the checkpoint names that runtime, every tip it
names is an envelope it covers, and replaying what it covers gives the state's hash. -/
def Checkpoint.check {St : Type} (L : Loro St) (enc : St → Value) (H : Bytes → Hash) (runtime : Hash)
    (cp : Checkpoint) : Bool :=
  cp.runtime == runtime && cp.version.all (fun t => cp.covers.any (·.name H == t)) &&
    nameOf H (enc (L.replay cp.covers)) == cp.state

/-- A state whose hash a checkpoint names, when the checkpoint checks, is the replay of what it covers. -/
theorem checked_is_replay {St : Type} {L : Loro St} {enc : St → Value} {H : Bytes → Hash} (hH : Injective H)
    (hc : ∀ s, Canon (enc s) = true) (he : ∀ a b, enc a = enc b → a = b) {runtime : Hash} {cp : Checkpoint} {s : St}
    (hs : nameOf H (enc s) = cp.state) (hck : cp.check L enc H runtime = true) : s = L.replay cp.covers := by
  simp only [Checkpoint.check, Bool.and_eq_true, beq_iff_eq] at hck
  exact he _ _ (nameOf_inj hH (hc _) (hc _) (hs.trans hck.2.symm))

/-- A checkpoint that checks names the runtime the reader replays with, and every tip of its version is one of the
envelopes it covers. -/
theorem checked_names {St : Type} {L : Loro St} {enc : St → Value} {H : Bytes → Hash} {runtime : Hash}
    {cp : Checkpoint} (hck : cp.check L enc H runtime = true) :
    cp.runtime = runtime ∧ ∀ t ∈ cp.version, ∃ e ∈ cp.covers, e.name H = t := by
  simp only [Checkpoint.check, Bool.and_eq_true, beq_iff_eq, List.all_eq_true, List.any_eq_true] at hck
  exact ⟨hck.1.1, hck.1.2⟩

end Aven.DB.Docs
