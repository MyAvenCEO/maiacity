# avenSTORE

`aven/DB2/store`, the crate `aven-db-store`, is avenSTORE: where a peer's bytes rest. It holds the `Store` contract of
blobs and refs, its backends (memory, a folder and S3 through OpenDAL, OPFS through our own driver), the conformance
suite every backend passes, files as hash sequences of chunk blobs, and the adapter that moves blobs between peers over
iroh-blobs.

Its architecture: [avenSTORE](../brain/store/README.md)

## Build and test

The store's one check, the conformance suite on all four backends, in the box. From `aven/DB2`, after `bun run up`
(which starts the box's S3 server):

```sh
bun run box sh store/check.sh
```

memory, fs and s3 run under `cargo test -p aven-db-store`; opfs runs as wasm in the box's Chromium, WebKit and Firefox:

```sh
bun run box sh store/opfs/run.sh
```

The store against the running Lean model, which builds the model with `lake build` first:

```sh
bun run box cargo test -p aven-db-store --test model
```

## Files

| Path | What |
|---|---|
| `src/store.rs` | the `Store` contract and its errors |
| `src/hash.rs`, `src/name.rs` | a blob's name (`Hash`) and a ref's (`RefName`) |
| `src/backend.rs`, `src/dal.rs` | the backends: memory, fs and s3 through OpenDAL (`DalStore`), and opfs's constructors |
| `src/opfs.rs`, `src/folder.rs`, `src/opfs_folder.rs` | the opfs driver, the folder it needs, and that folder on OPFS's sync access handles |
| `src/conformance.rs` | the conformance suite every backend passes |
| `src/files.rs` | files as hash sequences of chunk blobs |
| `src/blobs/` | iroh-blobs on this store: the adapter |
| `src/withhold.rs` | a store that serves a withheld blob as gone |
| `tests/` | the suite on memory, fs, s3 and the opfs driver; the names; the running model; files and iroh-blobs |
| `examples/opfs_conformance.rs`, `opfs/` | the suite as wasm in a browser, and its runner with the per-engine gates |
| `check.sh` | the one check |
