import AvenDB.Vectors
import AvenDB.OpsVectors
import AvenDB.BackupVectors
import AvenDB.ObjectiveVectors

/-- The complete model/runtime bridge, shared by the writer and build-time checker. -/
def AvenDB.vectorFiles : List (String × String) :=
  [("vectors/vaults.json", AvenDB.Vectors.render),
   ("vectors/lenses.json", AvenDB.Vectors.renderLenses),
   ("vectors/ops.json", AvenDB.OpsVectors.render),
   ("vectors/backups.json", AvenDB.BackupVectors.render),
   ("vectors/objectives.json", AvenDB.ObjectiveVectors.render)]
