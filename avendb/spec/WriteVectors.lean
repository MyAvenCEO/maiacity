import AvenDB.VectorFiles

/-- `lake exe vectors`: write every model vector consumed by the Rust tests. -/
def main : IO Unit := do
  IO.FS.createDirAll "vectors"
  for (path, contents) in AvenDB.vectorFiles do
    IO.FS.writeFile path contents
    IO.println s!"wrote {path}"
