/- An exhaustive owner statement is scoped to an explicit accepted cut, never
   current remote knowledge. Missing current authority or relevant suffix changes
   prevent negative use even when the old statement is authentic. -/
namespace ScopedDiscoveryManifest
structure Evidence where
  ownerAuthenticated : Bool
  exactScope : Bool
  noTruncation : Bool
  currentReadAuthority : Bool
  allMembersReadable : Bool
  relevantSuffixUnchanged : Bool

def mayUse (e : Evidence) := e.ownerAuthenticated && e.exactScope && e.noTruncation &&
  e.currentReadAuthority && e.allMembersReadable && e.relevantSuffixUnchanged

theorem missing_members_refused (a b c d f : Bool) :
    mayUse ⟨a,b,c,d,false,f⟩ = false := by
  cases a <;> cases b <;> cases c <;> cases d <;> cases f <;> rfl

theorem changed_suffix_refused (a b c d e : Bool) :
    mayUse ⟨a,b,c,d,e,false⟩ = false := by
  cases a <;> cases b <;> cases c <;> cases d <;> cases e <;> rfl

def remoteComplete (_ : Evidence) := false
theorem no_remote_claim (e : Evidence) : remoteComplete e = false := rfl
end ScopedDiscoveryManifest
