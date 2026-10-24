/-! Runtime directory creation is anchored to an already-open generation fd.
A missing/replaced generation cannot be bootstrapped by an ordinary object save;
child traversal requires a directory opened without following symbolic links.
This models admission, not all path-based disk I/O or OS syscall implementation. -/
namespace AvenDB.MountedGeneration

def createChild (sameGeneration directory noSymlink : Bool) :=
  sameGeneration && directory && noSymlink

theorem missing_generation (directory noSymlink : Bool) :
    createChild false directory noSymlink = false := by simp [createChild]
theorem symlink_rejected (sameGeneration directory : Bool) :
    createChild sameGeneration directory false = false := by simp [createChild]
theorem normal_child : createChild true true true = true := rfl
end AvenDB.MountedGeneration
