import AvenDB.Vectors

/-- `lake exe vectors`: write the test vectors the Rust core checks itself against. -/
def main : IO Unit := do
  IO.FS.createDirAll "vectors"
  IO.FS.writeFile "vectors/vaults.json" AvenDB.Vectors.render
  IO.FS.writeFile "vectors/lenses.json" AvenDB.Vectors.renderLenses
  IO.println "wrote vectors/vaults.json and vectors/lenses.json"
