import Aven.DB.Docs.Loro

/-!
# Checkpoints

A checkpoint travels: a signed statement that a state is a branch at a version, covering these segments (docs,
"Snapshots and checkpoints"; A5). A new device starts from it, marked unchecked, and checks it in the background: it
replays what the checkpoint covers and compares the state's hash. The model takes the state's encoding (its Records'
CBOR) as a parameter that loses nothing.

What it proves: a state a reader took from a checkpoint that then checks is exactly the replay of what it covers
(`checked_is_replay`), so a checkpoint that lies is always caught.
-/

namespace Aven.DB.Docs

open Aven.Core

structure Checkpoint where
  covers : List Envelope
  state : Hash

/-- The background check: replay what it covers, and compare the state's hash. -/
def Checkpoint.check {St : Type} (L : Loro St) (enc : St → Value) (H : Bytes → Hash) (cp : Checkpoint) : Bool :=
  nameOf H (enc (L.replay cp.covers)) == cp.state

/-- A state whose hash a checkpoint names, when the checkpoint checks, is the replay of what it covers. -/
theorem checked_is_replay {St : Type} {L : Loro St} {enc : St → Value} {H : Bytes → Hash} (hH : Injective H)
    (hc : ∀ s, Canon (enc s) = true) (he : ∀ a b, enc a = enc b → a = b) {cp : Checkpoint} {s : St}
    (hs : nameOf H (enc s) = cp.state) (hck : cp.check L enc H = true) : s = L.replay cp.covers := by
  simp only [Checkpoint.check, beq_iff_eq] at hck
  exact he _ _ (nameOf_inj hH (hc _) (hc _) (hs.trans hck.symm))

end Aven.DB.Docs
