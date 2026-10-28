# Lean in WebKit: a parked probe

Parked by Samuel's call (2026-10-28 15:52 Berlin): AIPs keep goal metrics that avenDB's own engine
(`aven/db/crates/avendb/src/objective.rs`) decides in every browser, and Lean is off proposals for now. This folder keeps the probe
so it can be picked up again.

## What was found

- Lean publishes `lean-<v>-linux_wasm32.zip` only up to 4.15.0. From 4.16.0 on there is none, and the "Web Assembly"
  job in lean4's `.github/workflows/ci.yml` is commented out. The Emscripten branch is still in `src/CMakeLists.txt`
  at v4.35.0.
- 4.15.0's build, run in Node 22 on a 4-core cloud box, compiles `aven/db/spec/AvenDB/Objective.lean`, passes
  `Objectives/Start.lean` and rejects a broken copy with the right error. But each check takes ~58 s and peaks at
  ~1.8 GB of memory (its cap is 2 GB). A `prelude` file alone takes 11 s and 1.2 GB. About 25 s is `__dlsym_js`,
  which comes from its `MAIN_MODULE` dynamic linking.
- That build refuses to run outside Node (`lean_main` throws), and it is a pthreads build that needs
  cross-origin isolation.
- Sizes: lean.wasm 77 MB, lean.js 40 MB, the Init `.olean` files 94 MB. wasm32 `.olean` files are not the 64-bit
  ones, so a build needs a 32-bit bootstrap.

## Where the 4.35.0 build stopped

`lean-4.35.0-wasm.patch` (against lean4 v4.35.0) makes the final link static, single-threaded (no `-pthread`, no
`-flto`), `MODULARIZE` and browser-capable, with `FS`, `callMain`, `ENV` and `HEAP8` exported.

The bootstrap has to build stage 0 as native 32-bit code, not with emcc. Lean's top-level CMake forwards the
toolchain file to stage 0, so you have to pass `-DSTAGE0_CMAKE_TOOLCHAIN_FILE=` and `-DSTAGE0_CMAKE_AR=/usr/bin/ar`,
plus `-m32` flags. It also needs `libuv1-dev:i386`, `libssl-dev:i386` and `pkgconf:i386`, with
`PKG_CONFIG_PATH=/usr/lib/i386-linux-gnu/pkgconfig`. The last try still failed while building stage 0, so expect a
few more rounds and then hours of build time.

## The probe

- `run.js`: one Lean run in a fresh instance with an in-memory filesystem, the same in a page and in Node.
- `pack.mjs <install> <out>`: bundles lean.js, lean.wasm, Init and a compiled Objective.olean, and runs the checks in Node.
- `probe.html`: times the download, the compile and each check, reads heap size, and posts the numbers back.
- `serve.mjs <out> [port]`: serves `<out>` to a phone on the same network and keeps results in `results.jsonl`.
