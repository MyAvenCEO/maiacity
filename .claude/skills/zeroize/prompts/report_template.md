# Zeroize Audit Report

**Run ID:** `<run_id>`
**Timestamp:** `<ISO-8601>`
**Repository:** `<path>`
**Crate:** `<cargo_manifest>` (`<crate>`, `<--lib | --bin name>`)

**Configuration:**
| Setting | Value |
|---|---|
| Optimization levels | O0, O1, O2 |
| Assembly analysis | enabled / disabled |
| Toolchain | `<cargo +nightly --version>` |
| Build folder | `<target_dir>` |

---

## Executive Summary

| Metric | Count |
|---|---|
| Files scanned | 0 |
| Crates analyzed | 1 |
| **Total findings** | **0** |

### By Severity

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

### By Confidence

| Confidence | Count |
|---|---|
| Confirmed | 0 |
| Likely | 0 |
| Needs review | 0 |

### By Category

| Category | Count |
|---|---|
| MISSING_SOURCE_ZEROIZE | 0 |
| PARTIAL_WIPE | 0 |
| NOT_ON_ALL_PATHS | 0 |
| SECRET_COPY | 0 |
| OPTIMIZED_AWAY_ZEROIZE | 0 |
| STACK_RETENTION | 0 |
| REGISTER_SPILL | 0 |

---

## Sensitive Objects Inventory

| ID | Name | Kind | Location | Confidence | Heuristic | Has Wipe |
|---|---|---|---|---|---|---|
| SO-5001 | SigningKey | struct | src/keys.rs:24 | high | name pattern + `Secret<` marker | partial (ZeroizeOnDrop, heap fields) |
| SO-5002 | SessionToken | struct | src/session.rs:12 | medium | name pattern | no |

---

## Findings

### Critical

#### ZA-0001: SECRET_COPY — critical (confirmed)

**Location:** `src/session.rs:12`
**Object:** `SessionToken` (struct)

**Evidence:**
- [rustdoc] `#[derive(Copy, Clone)]` on `SessionToken`; no `Drop` impl.
- [mir] `_7 = copy _3` moves the token into a `Vec<SessionToken>` with no zeroize call in its drop glue.

**Recommended Fix:**
Remove `Copy`, derive `Zeroize, ZeroizeOnDrop`, and hand out `&SessionToken` instead of copies.

---

### High

#### ZA-0002: OPTIMIZED_AWAY_ZEROIZE — high (confirmed)

**Location:** `src/keys.rs:88` (`<hash>.O2.ll`)
**Object:** `seed_buf` (`[u8; 32]`)

**Evidence:**
- [ir] 32 `store volatile i8 0` into `%seed_buf` at O0; 0 at O1 and O2.
- [mir] `ptr::write_bytes(seed_buf, 0, 32)` with no `compiler_fence` afterwards.

**Compiler Evidence:**
- Opt levels analyzed: O0, O1, O2
- O0: the wipe present
- O1: the wipe removed (dead-store elimination)
- **Summary:** The wipe first disappears at O1; nothing reads `seed_buf` after it.

**Recommended Fix:**
Replace `ptr::write_bytes` with `seed_buf.zeroize()`.

---

#### ZA-0003: STACK_RETENTION — high (likely)

**Location:** `src/keys.rs:120` (`<hash>.O2.ll`)
**Object:** `derive_key` (stack frame, 96 bytes)

**Evidence:**
- [ir] `alloca [96 x i8]` with `@llvm.lifetime.end` and no volatile store in `derive_key`.

**Recommended Fix:**
Keep the intermediate in `Zeroizing<[u8; 96]>` so it is wiped before the frame is released.

---

### Needs Review

#### ZA-0004: REGISTER_SPILL — medium (needs_review)

**Location:** `<hash>.O2.ll`
**Object:** `sign`

**Evidence:**
- [ir] `%secret` loaded and passed to a non-zeroize call. [gated: missing assembly evidence]

**Recommended Fix:**
Confirm with assembly (`enable_asm=true`); if the spill is real, restructure so the secret stays in a `Zeroizing` buffer across the call.

---

## Superseded Findings

_No findings were superseded in this run._

<!-- Example:
| Superseded | Superseded By | Reason |
|---|---|---|
| F-RUST-SRC-0003 (OPTIMIZED_AWAY_ZEROIZE, source flag) | ZA-0002 / F-RUST-IR-0001 | The IR diff confirms the removal; IR evidence supersedes the source-level flag |
-->

---

## Confidence Gate Summary

| Finding | Action | Reason |
|---|---|---|
| ZA-0004 (REGISTER_SPILL) | Downgraded to needs_review | Missing assembly evidence |

---

## Analysis Coverage

| Metric | Value |
|---|---|
| Source files scanned | 0 |
| rustdoc JSON | generated / failed |
| zeroize-source | success / partial / failed |
| zeroize-compiler | success / partial / failed (MIR, IR, assembly each) |
| zeroize-report | success |

### Unaudited Patterns

Patterns from `coverage-gaps.json` that no command detects. A clean report above does not rule these out. Say "none reported" when the file is empty, and never drop this section.

| Pattern | Where | Why it is unaudited |
|---|---|---|
| D3 | `src/keys.rs:44` | `static LazyLock<MasterKey>` is never dropped, so there is no wipe path to check |

---

## Appendix: Evidence Files

| Finding | Evidence File | Description |
|---|---|---|
| ZA-0002 | `rust-compiler-analysis/<hash>.O0.ll`, `<hash>.O2.ll` | IR at O0 and O2 |
| ZA-0003 | `rust-compiler-analysis/ir-findings.json` | IR analysis output |
