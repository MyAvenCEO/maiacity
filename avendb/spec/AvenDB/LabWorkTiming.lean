/-! Bounded diagnostic dimensions only. Timings never decide authorization,
scheduling or completeness, and this model does not prove a latency bound. -/
namespace AvenDB.LabWorkTiming
inductive Class | mutation | foreground | background deriving DecidableEq
inductive Phase | queue | dispatch | lockWait | operation deriving DecidableEq
def classIndex : Class → Fin 3
  | .mutation => 0 | .foreground => 1 | .background => 2
def phaseIndex : Phase → Fin 4
  | .queue => 0 | .dispatch => 1 | .lockWait => 2 | .operation => 3
theorem dimensions_bounded (c : Class) (p : Phase) :
    (classIndex c).val < 3 ∧ (phaseIndex p).val < 4 :=
  ⟨(classIndex c).isLt, (phaseIndex p).isLt⟩
def permitted (authorization : Bool) (_duration : Nat) := authorization
theorem timing_does_not_authorize (a : Bool) (x y : Nat) :
    permitted a x = permitted a y := rfl
end AvenDB.LabWorkTiming
