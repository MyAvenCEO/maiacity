/- A tag inventory is evidence only about the current local authenticated input.
   It never establishes absence on remote peers or overrides actor readability. -/
namespace ScopedTagInventory
structure Candidate where
  actorReads : Bool
  tagKnown : Bool
  tagMatches : Bool
  deriving DecidableEq

def selected (r : Candidate) := r.actorReads && r.tagKnown && r.tagMatches

theorem selected_is_authorized (r : Candidate) (h : selected r = true) : r.actorReads = true := by
  cases r with
  | mk a k m => cases a <;> cases k <;> cases m <;> simp_all [selected]

def localComplete (replayed noOverlay metadataKnown bodiesOpen : Bool) :=
  replayed && noOverlay && metadataKnown && bodiesOpen

theorem unknown_metadata_not_complete (a b d : Bool) : localComplete a b false d = false := by
  cases a <;> cases b <;> cases d <;> rfl

def remoteComplete (_localComplete : Bool) := false

theorem local_never_proves_remote (c : Bool) : remoteComplete c = false := rfl
end ScopedTagInventory
