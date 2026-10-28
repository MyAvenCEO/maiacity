import AvenDB.Vectors
import AvenDB.OpsVectors
import AvenDB.BackupVectors
import AvenDB.ObjectiveVectors
import AvenDB.LegacyVectors
import AvenDB.KeyTreeVectors
import AvenDB.QueryViewVectors
import AvenDB.FreshnessVectors
import AvenDB.LocalWriteVectors
import AvenDB.StepCostVectors
import AvenDB.ShowRulesVectors

/-- The complete model/runtime bridge, shared by the writer and build-time checker. -/
def AvenDB.vectorFiles : List (String × String) :=
  [("vectors/vaults.json", AvenDB.Vectors.render),
   ("vectors/lenses.json", AvenDB.Vectors.renderLenses),
   ("vectors/ops.json", AvenDB.OpsVectors.render),
   ("vectors/backups.json", AvenDB.BackupVectors.render),
   ("vectors/objectives.json", AvenDB.ObjectiveVectors.render),
   ("vectors/legacy.json", AvenDB.LegacyVectors.render),
   ("vectors/key_trees.json", AvenDB.KeyTreeVectors.render),
   ("vectors/query_views.json", AvenDB.QueryViewVectors.render),
   ("vectors/freshness.json", AvenDB.FreshnessVectors.render),
   ("vectors/local_writes.json", AvenDB.LocalWriteVectors.render),
   ("vectors/step_costs.json", AvenDB.StepCostVectors.render),
   ("vectors/show_rules.json", AvenDB.ShowRulesVectors.render)]
