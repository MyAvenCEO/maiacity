import VaultSpec.Vectors

/-- `lake exe vectors`: write the test vectors the Rust core checks itself against. -/
def main : IO Unit := do
  IO.FS.createDirAll "vectors"
  IO.FS.writeFile "vectors/vaults.json" VaultSpec.Vectors.render
  IO.println "wrote vectors/vaults.json"
