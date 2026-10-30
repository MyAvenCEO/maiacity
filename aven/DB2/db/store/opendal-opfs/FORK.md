# avenDB's fork of OpenDAL's OPFS service

`opendal-service-opfs` 0.59.5, Apache OpenDAL's OPFS service, as published on crates.io (29 Oct 2026), under its own
license (Apache-2.0, `LICENSE` and `NOTICE`). avenDB's workspace patches crates.io's crate with this folder
(`[patch.crates-io]` in `aven/DB2/Cargo.toml`), so the store keeps using OpenDAL's `services::Opfs` and its
conventions.

## What changed

Only `src/core.rs`'s `get_root_directory_handle`, and the `web-sys` features it needs:

- **Upstream** found OPFS with `web_sys::window().unwrap().navigator().storage()`. A worker has no `window`, so it
  panicked there, and avenPEER's Peer-Light runs in a worker.
- **Here** it takes the storage manager from whichever global scope runs it: a page's `Window` or a worker's
  `WorkerGlobalScope`, both of which have `navigator.storage`. Anything else is an `Unsupported` error, not a panic.

Also: `src/lib.rs` allows upstream's unused imports and variables, which Cargo hides for a crate from crates.io and
shows for a path crate. The manifest is our own (no OpenDAL workspace to inherit from), its dependencies pinned exactly
at the versions avenDB's lock holds, and `publish = false`.

## Proven by

`db/store/opfs/run.sh` runs the store's conformance suite on OPFS twice in Chromium: on a page and in a worker. Before
the fix the worker hit `unreachable`; now both pass all 12 cases. `bun run up --check` proves it again: each
Peer-Light keeps its record in OPFS from its SharedWorker.

## Leaving the fork

The fix belongs upstream. Once an OpenDAL release finds OPFS in workers, drop the patch and this folder, and bump
`opendal` to that release.
