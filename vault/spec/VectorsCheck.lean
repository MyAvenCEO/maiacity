import VaultSpec.Vectors

/-!
The test vectors on disk are what the model says: `lake build` fails here when `vectors/vaults.json` is out of
date. A library of its own that needs the file (see `lakefile.toml`), so that it runs again whenever the file or the
rules change, and so that `lake exe vectors` can build and write the file even when it is missing or stale.
-/

#eval show IO Unit from do
  let file ← IO.FS.readFile "vectors/vaults.json"
  unless file == VaultSpec.Vectors.render do
    throw <| IO.userError "vectors/vaults.json is out of date: run `lake exe vectors`"
