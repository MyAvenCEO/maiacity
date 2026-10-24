import AvenDB.VectorFiles

/-!
The test vectors on disk are what the model says: `lake build` fails here when `vectors/vaults.json`,
`vectors/lenses.json`, `vectors/ops.json`, `vectors/backups.json` or `vectors/objectives.json` is out of date. A library of its own that needs the files (see
`lakefile.toml`), so that it runs again whenever a file or the rules change, and so that `lake exe vectors` can build
and write the files even when they are missing or stale.
-/

#eval show IO Unit from do
  for (path, model) in AvenDB.vectorFiles do
    let file ← IO.FS.readFile path
    unless file == model do
      throw <| IO.userError s!"{path} is out of date: run `lake exe vectors`"
