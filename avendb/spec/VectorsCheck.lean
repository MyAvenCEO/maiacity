import AvenDB.Vectors
import AvenDB.OpsVectors

/-!
The test vectors on disk are what the model says: `lake build` fails here when `vectors/vaults.json`,
`vectors/lenses.json` or `vectors/ops.json` is out of date. A library of its own that needs the files (see
`lakefile.toml`), so that it runs again whenever a file or the rules change, and so that `lake exe vectors` can build
and write the files even when they are missing or stale.
-/

#eval show IO Unit from do
  for (path, model) in [("vectors/vaults.json", AvenDB.Vectors.render),
      ("vectors/lenses.json", AvenDB.Vectors.renderLenses), ("vectors/ops.json", AvenDB.OpsVectors.render)] do
    let file ← IO.FS.readFile path
    unless file == model do
      throw <| IO.userError s!"{path} is out of date: run `lake exe vectors`"
