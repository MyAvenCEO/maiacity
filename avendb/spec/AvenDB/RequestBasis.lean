/-!
An ephemeral structural request basis is reusable only for its exact held-history revision.
Rust LogRevision is process-local allocation identity, rotated on append, new receive and
withdrawal. Clone may retain it only with identical edits/IDs. This model assumes that contract;
it is not a proof of Rust mutation coverage or a persisted certificate.

The basis contains log assignments and structural haves/loose IDs only. Authorization,
current follow and available key blobs are applied at call time and are never cached here.
Rust correspondence: Lab::request_basis and Lab::request. Differential tests compare the
optimized path with asks_ids plus the original disclosure filter.
-/
namespace AvenDB.RequestBasis

structure Basis (R H B : Type) where
  revision : R
  history : H
  value : B

/-- Revision equality implies equal held histories; required of the process-local token. -/
def Sound (derive : H → B) (cached : Basis R H B) : Prop :=
  cached.value = derive cached.history

def reuse [DecidableEq R] (derive : H → B) (now : R) (history : H)
    (cached : Basis R H B) : B :=
  if cached.revision = now then cached.value else derive history

theorem exact_revision_equivalent [DecidableEq R] (derive : H → B)
    (now : R) (history : H) (cached : Basis R H B)
    (sound : Sound derive cached)
    (fence : cached.revision = now → cached.history = history) :
    reuse derive now history cached = derive history := by
  unfold reuse
  split
  next h => simpa [Sound, fence h] using sound
  next => rfl

theorem changed_revision_rebuilds [DecidableEq R] (derive : H → B)
    (now : R) (history : H) (cached : Basis R H B) (h : cached.revision ≠ now) :
    reuse derive now history cached = derive history := by simp [reuse, h]

/-- Disclosure remains a fresh filter; possession is not permission. -/
def disclose (held permitted : Bool) : Bool := held && permitted

theorem no_private_disclosure (held : Bool) : disclose held false = false := by
  simp [disclose]

def wants (referenced available : Bool) : Bool := referenced && !available

theorem arrived_blob_not_requested (referenced : Bool) : wants referenced true = false := by
  simp [wants]

/-- Follow is supplied independently at every call, never recovered from a history basis. -/
def attachFollow (basis : B) (current : F) : B × F := (basis, current)

theorem follow_is_current (basis : B) (current : F) : (attachFollow basis current).2 = current := rfl

end AvenDB.RequestBasis
