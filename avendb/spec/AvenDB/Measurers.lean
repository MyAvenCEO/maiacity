import AvenDB.Gate

/-!
# Who measures an AIP

`avendb/docs/ARCHITECTURE.md` §8, "AIPs", N2: an AIP's objective (`AvenDB.Objective`) counts a reading as measured
(`measured "x"`) only where a Measurer of the AIP's vault wrote it: a vault holding a share of the vault's cap group
named Measurer (`measurerName`), which only those who may share the vault hand out, as a vault the coop owns for a
measuring job (a device vault on its server) gets. Never the AIP's author: no author measures its own AIP, whatever it
holds (M1, `measures_not_author`). `reading "x"` still counts every reading, the author's too.

Who wrote a reading is never a typed field: the engine reads, of each write the AIP's main line counts, in the order
every device replays them, its actor and the readings it added, as written then; the model takes that list
(`measuredBy`), so a later write changes no measured reading, and only a Measurer's writes add one (M2,
`measuredBy_author`).
-/

namespace AvenDB

/-- The name of the cap group of a vault whose holders measure its AIPs. -/
def measurerName : String := "Measurer"

/-- Vault `u` measures the AIPs of vault `v` that `author` started: it holds `v`'s Measurer group, and it isn't
    `author`. -/
def measures (st : State) (v author u : VaultId) : Bool :=
  u != author && holdsGroup st v u measurerName

/-- What the Measurers of vault `v` added to an AIP `author` started: of each write, its actor and what it added, in
    order, what the writes of a vault that `measures` added. -/
def measuredBy {α : Type} (st : State) (v author : VaultId) (added : List (VaultId × List α)) : List α :=
  (added.filter fun p => measures st v author p.1).flatMap (·.2)

/-- M1: no author measures its own AIP. -/
theorem measures_not_author (st : State) (v a : VaultId) : measures st v a a = false := by
  simp [measures]

/-- M2: what the AIP's author wrote alone is measured by nobody. -/
theorem measuredBy_author {α : Type} (st : State) (v a : VaultId) (added : List (VaultId × List α))
    (h : ∀ p ∈ added, p.1 = a) : measuredBy st v a added = [] := by
  have : added.filter (fun p => measures st v a p.1) = [] := by
    rw [List.filter_eq_nil_iff]
    intro p hp
    simp [h p hp, measures_not_author]
  simp [measuredBy, this]

/-- M3: a vault that holds no Measurer group of `v` measures nothing of it. -/
theorem measuredBy_holds {α : Type} (st : State) (v a : VaultId) (added : List (VaultId × List α))
    (h : ∀ p ∈ added, holdsGroup st v p.1 measurerName = false) : measuredBy st v a added = [] := by
  have : added.filter (fun p => measures st v a p.1) = [] := by
    rw [List.filter_eq_nil_iff]
    intro p hp
    simp [measures, h p hp]
  simp [measuredBy, this]

end AvenDB
