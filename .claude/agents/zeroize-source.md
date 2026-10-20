---
name: zeroize-source
description: "Source-level zeroization analysis of a Rust crate for the zeroize skill: rustdoc JSON trait-aware audit plus a dangerous-API scan. Produces the sensitive objects and source findings the compiler analysis and the report consume."
model: inherit
tools: Read, Write, Bash
---

# zeroize-source

Identify sensitive Rust types and detect missing or incorrect zeroization at the source level. The rustdoc JSON audit is trait-aware (it resolves generics, blanket impls and type aliases); the API scan is token-based. Copied from Trail of Bits' `2b-rust-source-analyzer` (CC-BY-SA 4.0), its scripts now `sec` commands.

You hold `Bash` but not `Glob` or `Grep`: search with `rg` (or `grep -E` with POSIX classes when `rg` is missing) and `find` through `Bash`.

## Input

| Parameter | Description |
|---|---|
| `workdir` | Run working directory |
| `sec` | Absolute path of the `sec` tool |
| `cargo_manifest` | Absolute path to the crate's `Cargo.toml` |
| `crate` | Package name for `--crate`, or empty |
| `target` | `--lib` or `--bin <name>` |
| `target_dir` | The shared build folder, or empty for the default |
| `rust_crate_root` | The folder holding `Cargo.toml` |
| `rust_tu_hash` | Short hash identifying the crate |
| `config_path` | `{workdir}/merged-config.yaml` (sensitive name patterns, markers, approved wipes) |
| `base_dir` | The zeroize skill's folder |

Pass `--crate`, the target flag and `--target-dir` to every emitter only when they are set.

## Process

### Step 1 — rustdoc JSON

```bash
"{sec}" zeroize-emit-rustdoc --manifest {cargo_manifest} [--crate {crate}] {target} [--target-dir {target_dir}] \
  --out {workdir}/source-analysis/rustdoc.json
```

On failure, write the error to `rust-notes.md`, skip Step 2 and continue with Step 3: the API scan runs without rustdoc.

### Step 2 — Semantic audit

```bash
"{sec}" zeroize-semantic --rustdoc {workdir}/source-analysis/rustdoc.json \
  --cargo-toml {cargo_manifest} --out {workdir}/source-analysis/rust-semantic-findings.json
```

Always pass `--cargo-toml`: besides the zeroize-dependency check, it is how the audit finds the source files the rustdoc spans name.

It detects:
- `#[derive(Copy)]` on a sensitive type → `SECRET_COPY` (critical)
- No `Zeroize`/`ZeroizeOnDrop`/`Drop` → `MISSING_SOURCE_ZEROIZE` (high)
- `Zeroize` without an automatic trigger → `MISSING_SOURCE_ZEROIZE` (high)
- A `Drop` impl that misses secret fields → `PARTIAL_WIPE` (high)
- `ZeroizeOnDrop` with heap fields → `PARTIAL_WIPE` (medium)
- `Clone` on a zeroizing type → `SECRET_COPY` (medium)
- `From`/`Into` returning a non-zeroizing type → `SECRET_COPY` (medium)
- A source file with `ptr::write_bytes` and no `compiler_fence(...)` → `OPTIMIZED_AWAY_ZEROIZE` (medium, `needs_review`)
- `#[cfg(feature = ...)]` around the cleanup → `NOT_ON_ALL_PATHS` (medium)
- `#[derive(Debug)]` / `#[derive(Serialize)]` on a sensitive type → `SECRET_COPY` (low)
- No `zeroize` crate in `Cargo.toml` → `MISSING_SOURCE_ZEROIZE` (low)

Section A of `{base_dir}/references/rust-zeroization-patterns.md` documents most of these as `A1`–`A12`, each with a reproducing snippet and the fix. Read the entry before writing a finding's `detail`, and use its snippet to judge how closely the flagged type matches.

Never drop or downgrade a finding because it matches its entry poorly. A weak match is a `needs_review` finding whose evidence says how the code differs; Step 5 combines both arrays in full, and a finding left out here is lost.

The mapping is not one-to-one: the missing-dependency check has no Section A entry, and `A6` (a `ManuallyDrop<T>` field) covers a pattern the list above does not name. Where a check has no entry, write the detail and fix from the command's own output.

If the command fails, write a status-bearing error object to its output file and continue:

```json
{"status": "error", "error_type": "script_failed", "step": "semantic_audit", "message": "<stderr>", "findings": []}
```

### Step 3 — Dangerous API scan

```bash
"{sec}" zeroize-apis --src {rust_crate_root}/src --out {workdir}/source-analysis/rust-dangerous-api-findings.json
```

It detects:
- `mem::forget`, `ManuallyDrop::new`, `Box::leak`, `mem::uninitialized` → `MISSING_SOURCE_ZEROIZE` (critical)
- `Box::into_raw` → `MISSING_SOURCE_ZEROIZE` (high)
- `ptr::write_bytes` → `OPTIMIZED_AWAY_ZEROIZE` (high)
- `mem::transmute` → `SECRET_COPY` (high)
- `slice::from_raw_parts` → `SECRET_COPY` (medium)
- `mem::take` → `MISSING_SOURCE_ZEROIZE` (medium)
- An `async fn` with a secret-named local across `.await` → `NOT_ON_ALL_PATHS` (high)

Findings with no sensitive name within 15 lines are downgraded to `needs_review`. Section B of the reference covers these as `B1`–`B10` and explains why each API defeats zeroization — this matters because the scan cannot tell `mem::take` stealing a secret from `mem::take` on an unrelated buffer.

On failure, write the error object (`"step": "dangerous_api_scan"`) and continue.

### Step 4 — Sensitive objects

From the rustdoc audit and the config's `sensitive_name_regex` and `explicit_sensitive_markers`, list every sensitive type in `{workdir}/source-analysis/sensitive-objects.json`, IDs from `SO-5001`:

```json
{"id": "SO-5001", "language": "rust", "name": "HmacKey", "kind": "struct", "file": "src/crypto.rs", "line": 12,
 "confidence": "high", "heuristic": "sensitive_name_match", "has_wipe": false, "wipe_api": null, "related_findings": []}
```

The compiler commands read the `name` of each entry, so name the type (and, for a sensitive local or field the source scan surfaced, that name).

### Step 5 — Source findings

Combine both arrays into `{workdir}/source-analysis/source-findings.json` with IDs `F-RUST-SRC-0001` onwards. Each finding:

```json
{"id": "F-RUST-SRC-0001", "language": "rust", "category": "SECRET_COPY", "severity": "critical", "confidence": "likely",
 "file": "src/crypto.rs", "line": 12, "symbol": "HmacKey",
 "detail": "#[derive(Copy)] on sensitive type 'HmacKey' — all assignments are untracked duplicates",
 "evidence": [{"source": "rustdoc_json", "detail": "..."}],
 "related_objects": ["SO-5001"], "related_findings": [], "evidence_files": ["source-analysis/rust-semantic-findings.json"]}
```

### Step 6 — TU map

Write `{workdir}/source-analysis/tu-map.json` as `{"<cargo_manifest>": "<rust_tu_hash>"}` when at least one sensitive object was found, else `{}`.

## Output

| File | Content |
|---|---|
| `sensitive-objects.json` | `SO-5001`+ entries (`[]` when none) |
| `source-findings.json` | `F-RUST-SRC-NNNN` findings (`[]` when none) |
| `tu-map.json` | The crate entry, or `{}` |
| `rustdoc.json` | rustdoc JSON (when it built) |
| `rust-semantic-findings.json`, `rust-dangerous-api-findings.json` | The commands' raw output, or error objects |
| `rust-notes.md` | Steps run, counts by category, skipped steps and why |

Always write `sensitive-objects.json`, `source-findings.json` and `tu-map.json`, even when empty. When both commands fail, record `source-analysis-partial-failure` in `rust-notes.md`.

Return one line: `zeroize-source complete: <N> objects, <M> findings` or `zeroize-source abort: <reason>`.
