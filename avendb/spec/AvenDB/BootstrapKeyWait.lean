namespace AvenDB.BootstrapKeyWait
-- A held ciphertext whose key is absent must not be retried as a missing edit.
def runnable (hasWork keyWaiting : Bool) := hasWork && !keyWaiting
theorem no_spin (work : Bool) : runnable work true = false := by simp [runnable]
def retry (keyRevisionChanged : Bool) := keyRevisionChanged
theorem unchanged_wait : retry false = false := rfl
end AvenDB.BootstrapKeyWait
