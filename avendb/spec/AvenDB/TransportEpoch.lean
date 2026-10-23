/-!
The optional carrier never authorizes edits. It opens only against an authenticated connection's
current two-sided challenge, consumes that challenge once, and gives its route a fresh local handle.
This model isolates lifecycle transitions. Cryptographic exporter/nonce/hash freshness, native/JS
scheduling, and the actual byte transport are assumptions tested separately, not proved here.
-/
namespace AvenDB.TransportEpoch

structure Challenge where
  connection : Nat
  initiatorNonce : Nat
  responderNonce : Nat
  deriving DecidableEq

structure Session where
  challenge : Challenge
  spent : Bool
  route : Option Nat

def openRoute (s : Session) (challenge : Challenge) (route : Nat) : Option Session :=
  if challenge = s.challenge ∧ s.spent = false then
    some { s with spent := true, route := some route }
  else none

def closeRoute (s : Session) : Session := { s with route := none }
def replace (challenge : Challenge) : Session :=
  { challenge := challenge, spent := false, route := none }
def ready (s : Session) (route : Nat) : Bool := s.route == some route

theorem opened_spends (s next : Session) (c : Challenge) (route : Nat)
    (h : openRoute s c route = some next) : next.spent = true := by
  unfold openRoute at h
  split at h
  · cases h
    rfl
  · cases h

theorem spent_cannot_reopen (s : Session) (c : Challenge) (route : Nat)
    (h : s.spent = true) : openRoute s c route = none := by
  simp [openRoute, h]

theorem closing_does_not_unspend (s : Session) (c : Challenge) (route : Nat)
    (h : s.spent = true) : openRoute (closeRoute s) c route = none := by
  simp [openRoute, closeRoute, h]

theorem closed_cannot_be_ready (s : Session) (route : Nat) :
    ready (closeRoute s) route = false := by
  simp [ready, closeRoute]

theorem stale_challenge_cannot_reopen (old fresh : Challenge) (route : Nat)
    (h : old ≠ fresh) : openRoute (replace fresh) old route = none := by
  simp [openRoute, replace, h]

theorem stale_connection_cannot_reopen (old fresh : Challenge) (route : Nat)
    (h : old.connection ≠ fresh.connection) : openRoute (replace fresh) old route = none := by
  apply stale_challenge_cannot_reopen
  intro equal
  exact h (congrArg Challenge.connection equal)

end AvenDB.TransportEpoch
