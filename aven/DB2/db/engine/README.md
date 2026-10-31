# avenOPS

avenOPS is avenDB's ops engine (`db/engine`): it lowers every write to steps that every reader can check, runs queries
over Records, and orders what a device fetches and opens. Its Lean model is `Aven.DB.Engine`, in
`db/spec/Aven/DB/Engine`.

Its architecture: [avenOPS](../../brain/ops/README.md)

## Build and test

`lake exe vectors` writes the model's vectors, and `bun run up --check` compares them.

## Modules

| Module | Vectors |
|---|---|
| `Query` | `queries.json` |
| `Wants` | `wants.json` |
| `Mutate` | `mutations.json` |
| `Footprint` | `mutations.json` |
| `Changes` | `mutations.json`, `changes.json`, `merge-check.json` |
| `Lower` | `lower.json` |
| `Index` | `lookups.json` |
| `Probe` | `lookups.json` |
