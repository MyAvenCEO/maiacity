# aven/runtimes

avenRUNTIME: the one home of every runtime in avenDB, each a pure function frozen as a WebAssembly module that imports
nothing and named by its hash. Here are the runtimes themselves (face-runtime and markdown-runtime), the host that
loads a module only by a hash the bootstrap manifest lists and runs it under fuel, memory and output limits, natively
and in avenOS's runtimes worker, the node-tree allowlist, the file registry, and their Lean model, `Aven.Runtime`. It
is its own package, with its own Cargo workspace, lockfile, Lean project and check; the repository's root workspace
excludes it, as it excludes `aven/DB2`.

Its architecture: [avenRUNTIME](../DB2/brain/runtime/README.md)

## Build and test

In the box, from `aven/DB2`:

```
bun run box sh sandbox/vectors.sh --check   builds Aven.Runtime with the other specs and checks its vectors
bun run up --check                          runs that, freeze.sh --check and the three engines' checks
```

From `aven/runtimes`, in the box:

```
sh freeze.sh           builds the modules, prints each one's hash and keeps a new module's bytes in frozen/
                       (append its entry to the manifest by hand: a change to a runtime is its next version)
sh freeze.sh --check   builds them and runs the host's tests; writes nothing
```

## Files

```
aven/runtimes/
  README.md          this file
  spec/              Lean: Aven.Runtime, and the vectors it exports (the contract, the registry, the node tree)
  manifest.json      the bootstrap manifest: every frozen runtime (name, version, hash, limits, users) and every
                     withdrawal; append-only
  host/              aven-runtimes-host: load by hash, refuse imports, fuel, memory, output limits; a Value's
                     JSON form; the manifest's reader
  web/               aven-runtimes-web, the host behind wasm-bindgen for avenOS's runtimes worker
  abi/               the module ABI, alloc and run over the one codec's bytes, in safe Rust
  modules/           each runtime as a WebAssembly module importing nothing: markdown/ face/
  frozen/            every frozen module's bytes, <hex>.wasm
  freeze.sh          the reproducible build, each module's hash, and the host's tests against the manifest
  registry/          aven-runtimes-registry, the file registry, the sniffer, decide_file(); native and wasm
  tree/              the node-tree allowlist, shared by every runtime that draws
  contract/          the contract's failures, limits, results and render keys
  markdown/          markdown-runtime, the first file runtime
  face/              face-runtime, markup and style as data to a checked tree
```
