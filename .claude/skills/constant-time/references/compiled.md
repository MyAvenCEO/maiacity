# Constant-Time Analysis: Compiled Languages

Analysis guidance for Rust (and the C, C++ and Go instruction tables, for assembly listings). These languages compile to native assembly, where timing side-channels are detected by scanning for variable-time CPU instructions.

## Running the Analyzer

Our copy builds Rust only; for C, C++ or Go, compile to assembly yourself and pass the listing with `--assembly --arch <arch>`. The instruction tables and patterns below hold for every compiled language.

```bash
# Rust (rustc, native architecture, O2)
.claude/skills/security-auditor/tools/sec ct --warnings crypto.rs

# Cross-architecture testing (RECOMMENDED; needs `rustup target add <target>` for each)
.claude/skills/security-auditor/tools/sec ct --warnings --arch x86_64 crypto.rs
.claude/skills/security-auditor/tools/sec ct --warnings --arch arm64 crypto.rs

# Multiple optimization levels
.claude/skills/security-auditor/tools/sec ct --warnings --opt-level O0 crypto.rs
.claude/skills/security-auditor/tools/sec ct --warnings --opt-level O3 crypto.rs

# Filter to specific functions
.claude/skills/security-auditor/tools/sec ct --warnings --func 'sign|verify|decrypt' crypto.rs

# JSON output
.claude/skills/security-auditor/tools/sec ct --warnings --json crypto.rs

# An assembly listing from any compiler
.claude/skills/security-auditor/tools/sec ct --warnings --assembly --arch arm64 crypto.s
```

## Compiler

| Language | Compiler | Flag |
|----------|----------|------|
| Rust | rustc (default) | `--compiler <path to rustc>` to use another toolchain |

## Supported Architectures

x86_64, arm64, arm, riscv64, ppc64le, s390x, i386

## Dangerous Instructions by Architecture

| Architecture | Division | Floating-Point |
|-------------|----------|----------------|
| x86_64 | DIV, IDIV, DIVQ, IDIVQ | DIVSS, DIVSD, SQRTSS, SQRTSD |
| ARM64 | UDIV, SDIV | FDIV, FSQRT |
| ARM | UDIV, SDIV | VDIV, VSQRT |
| RISC-V | DIV, DIVU, REM, REMU | FDIV.S, FDIV.D, FSQRT |
| PowerPC | DIVW, DIVD | FDIV, FSQRT |
| s390x | D, DR, DL, DLG, DSG | DDB, SQDB |

## Constant-Time Patterns

### Replace Division

```c
// VULNERABLE: Compiler emits DIV instruction
int32_t q = a / divisor;

// SAFE: Barrett reduction (precompute mu = ceil(2^32 / divisor))
uint32_t q = (uint32_t)(((uint64_t)a * mu) >> 32);
```

### Replace Branches

```c
// VULNERABLE: Branch timing reveals secret
if (secret) { result = a; } else { result = b; }

// SAFE: Constant-time selection
uint32_t mask = -(uint32_t)(secret != 0);
result = (a & mask) | (b & ~mask);
```

### Replace Comparisons

```c
// VULNERABLE: memcmp returns early on mismatch
if (memcmp(a, b, len) == 0) { ... }

// SAFE: Constant-time comparison
if (CRYPTO_memcmp(a, b, len) == 0) { ... }  // OpenSSL
if (subtle.ConstantTimeCompare(a, b) == 1) { ... }  // Go
```

## Common Mistakes

1. **Testing only one optimization level** - Compilers make different decisions at O0 vs O3. A clean O2 build may have divisions at O0.

2. **Testing only one architecture** - ARM and x86 have different division behavior. Test your deployment targets.

3. **Ignoring warnings** - Conditional branches on secrets are exploitable. Use `--warnings` and review each branch.

4. **Assuming the tool catches everything** - This tool detects instruction-level issues only. It cannot detect:
   - Cache timing from memory access patterns
   - Microarchitectural attacks (Spectre, etc.)
   - Whether flagged code actually processes secrets

5. **Fixing symptoms, not causes** - If compiler introduces division, understand why. Sometimes the algorithm itself needs redesign.

## Rust-Specific Notes

Rust uses `rustc --emit=asm` for assembly generation. The analyzer:
- Maps optimization levels to rustc's `-C opt-level` flag
- Supports cross-compilation via `--target` flag
- Analyzes the emitted assembly for timing-unsafe instructions

## Sweeping a crate

The repo is public and has no PR CI, so run the sweep by hand or in a session, one file at a time; exit code 1 means violations were found:

```bash
for f in $(find avendb/crates -name '*.rs' -path '*/src/*'); do .claude/skills/security-auditor/tools/sec ct --warnings --json "$f"; done
```
