import Aven.DB.Docs.Fit

/-!
# Lenses commute with merges

A field one schema version calls `done` and the next calls `status` may hold writes of both, made by older and newer
apps. A reader at either version reads through the lens: each write converted to the reader's version, and the later
write wins, by Loro's order, exactly as if everyone had written one field (docs, "Lenses").

What it proves: reading the merge of two sides through a lens is merging what each side reads (`lens_merge`), so an
older app's later tick is never lost to a newer app's earlier write (`later_tick_wins`).
-/

namespace Aven.DB.Docs

/-- A write converted to the reader's version. -/
def Write.through {A B : Type} (f : A → B) (w : Write A) : Write B := ⟨w.stamp, f w.value⟩

/-- A field read through a lens: every write converted, the latest kept. -/
def readThrough {A B : Type} (f : A → B) (ws : List (Write A)) : Option (Write B) := latest (ws.map (·.through f))

theorem lens_merge {A B : Type} (f : A → B) (a b : List (Write A)) :
    readThrough f (a ++ b) = pick (readThrough f a) (readThrough f b) := by
  simp [readThrough, List.map_append, latest_append]

/-- A todo's done-ness, written by a v0 app as `done` or by a v1 app as `status`. -/
inductive TodoWrite where
  | done (b : Bool)
  | status (s : String)

/-- The v0 reader's lens: a v1 status reads as done only when it is "done". -/
def asDone : TodoWrite → Bool
  | .done b => b
  | .status s => s == "done"

/-- The v1 app sets "doing" at stamp 1; the v0 app, later, ticks done at stamp 2. Merged, the tick wins for both. -/
theorem later_tick_wins :
    readThrough asDone ([⟨1, .status "doing"⟩] ++ [⟨2, .done true⟩]) = some ⟨2, true⟩ := by
  simp [readThrough, latest, pick, Write.through, asDone]

end Aven.DB.Docs
