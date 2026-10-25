/- Private Story transitions use withPictures=false. They never enter either
   public-stage branch requiring profile/public-share or negative picture evidence. -/
namespace PrivateStoryTransition

def scopedReady (localReady trustedReady fromPublic toPublic : Bool) :=
  localReady && trustedReady && !fromPublic && !toPublic

theorem scoped_excludes_public (a b c d : Bool) (h : scopedReady a b c d = true) :
    c = false ∧ d = false := by
  cases a <;> cases b <;> cases c <;> cases d <;> simp_all [scopedReady]

theorem incomplete_refused (b c d : Bool) : scopedReady false b c d = false := by
  simp [scopedReady]
end PrivateStoryTransition
