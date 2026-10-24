namespace AvenDB.BootstrapDependency
-- A missing authenticated body pauses at the current edit, preserving its tail.
def pause (edit : α) (tail : List α) : List α := edit :: tail
theorem no_drop (e : α) (xs : List α) : (pause e xs).head? = some e := rfl
-- Rendering a validated prefix does not grant writes or imply completeness.
def runnable (pending missing : Nat) : Bool := pending > 0 && missing == 0
theorem missing_pauses (n m : Nat) : runnable n (m+1) = false := by simp [runnable]
end AvenDB.BootstrapDependency
