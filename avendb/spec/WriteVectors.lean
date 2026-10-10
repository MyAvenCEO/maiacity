import AvenDB.Vectors
import AvenDB.OpsVectors

/-- `lake exe vectors`: write the test vectors the Rust core checks itself against. -/
def main : IO Unit := do
  IO.FS.createDirAll "vectors"
  IO.FS.writeFile "vectors/vaults.json" AvenDB.Vectors.render
  IO.FS.writeFile "vectors/lenses.json" AvenDB.Vectors.renderLenses
  IO.FS.writeFile "vectors/ops.json" AvenDB.OpsVectors.render
  IO.println "wrote vectors/vaults.json, vectors/lenses.json and vectors/ops.json"
