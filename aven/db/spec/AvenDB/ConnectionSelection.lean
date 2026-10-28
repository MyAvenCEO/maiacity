/-!
Selecting a live sync connection after its PQ Hello has authenticated a device.
For one proven device, crossed dials select the connection initiated by the lower
endpoint, independent of arrival order. A sole connection in either direction is
accepted. Same-direction and different-device replacement retain their existing
semantics; this is not a total-order arbitration model for arbitrary connections.
-/
namespace AvenDB.ConnectionSelection

structure Connection where
  id : Nat
  device : Nat
  live : Bool
  preferred : Bool
  deriving DecidableEq

-- On the other end both booleans invert, leaving the preference unchanged.
def preferred (localLower dialed : Bool) : Bool := localLower == dialed

theorem preference_agrees (localLower dialed : Bool) :
    preferred localLower dialed = preferred (!localLower) (!dialed) := by
  cases localLower <;> cases dialed <;> decide

-- Only a live preferred connection to the same proven signer rejects a crossed
-- nonpreferred newcomer. No endpoint ordering can admit an unauthenticated peer.
def retain (old incoming : Connection) : Bool :=
  old.live && old.device == incoming.device && old.preferred && !incoming.preferred

def choose (old : Option Connection) (incoming : Connection) : Connection :=
  match old with
  | none => incoming
  | some old => if retain old incoming then old else incoming

theorem sole_connection (incoming : Connection) : choose none incoming = incoming := rfl

theorem selection_is_one_of_the_authenticated_inputs (old incoming : Connection) :
    choose (some old) incoming = old ∨ choose (some old) incoming = incoming := by
  simp only [choose]
  split <;> simp

theorem closed_replaced (old incoming : Connection) (closed : old.live = false) :
    choose (some old) incoming = incoming := by
  simp [choose, retain, closed]

theorem different_device_replaced (old incoming : Connection)
    (different : old.device ≠ incoming.device) :
    choose (some old) incoming = incoming := by
  simp [choose, retain, different]

theorem same_direction_replaced (old incoming : Connection)
    (same : old.preferred = incoming.preferred) :
    choose (some old) incoming = incoming := by
  cases h : incoming.preferred <;> simp [choose, retain, same, h]

theorem crossed_arrival_order_agrees (a b : Connection)
    (aLive : a.live = true) (bLive : b.live = true)
    (sameDevice : a.device = b.device) (crossed : a.preferred ≠ b.preferred) :
    choose (some a) b = choose (some b) a := by
  cases ha : a.preferred <;> cases hb : b.preferred <;>
    simp_all [choose, retain]

theorem crossed_selects_preferred (old incoming : Connection)
    (oldLive : old.live = true) (_incomingLive : incoming.live = true)
    (sameDevice : old.device = incoming.device)
    (crossed : old.preferred ≠ incoming.preferred) :
    (choose (some old) incoming).preferred = true := by
  cases ho : old.preferred <;> cases hi : incoming.preferred <;>
    simp_all [choose, retain]

structure Selected where
  connection : Connection
  route : Option Nat
  deriving DecidableEq

-- Publication retires a route only when it actually selects another generation.
def publish (old : Selected) (incoming : Connection) : Selected :=
  if retain old.connection incoming || old.connection.id == incoming.id then old
  else ⟨incoming, none⟩

theorem losing_duplicate_keeps_route (old : Selected) (incoming : Connection)
    (kept : retain old.connection incoming = true) : publish old incoming = old := by
  simp [publish, kept]

theorem same_generation_keeps_route (old : Selected) (incoming : Connection)
    (same : old.connection.id = incoming.id) : publish old incoming = old := by
  simp [publish, same]

end AvenDB.ConnectionSelection
