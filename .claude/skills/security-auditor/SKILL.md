---
name: security-auditor
description: The maiaCITY security auditor — the meta skill over every security skill we keep: our threat model (avenDB's keys, vaults, caps and post-quantum crypto, the trustless hosts, the API, the feed, The OS, a public repo's CI), the auditor's laws, the order of work, the `sec` tool and which sub skill to load — audit-context, rust-security, web-security, sharp-edges, constant-time, zeroize, ci-agent-audit, spec-compliance, diff-review, fp-check, property-tests, cargo-fuzz, fuzz-harness, wycheproof and lean-proofs. Use it whenever code is audited, threat-modelled or reviewed for security, a security finding is checked, a fix is tested, or it is unclear which security skill a task needs.
---

# Security auditor

One auditor, one bundle. The sub skills are Trail of Bits' (`trailofbits/skills`, CC-BY-SA 4.0, see
[NOTICE.md](NOTICE.md)) cut to our stack — Rust, JavaScript, Swift, Lean — plus `web-security`, our own. Their
scripts are one Rust tool, `sec` (below). This page holds what they share: what we protect, the laws, the order of
work and which skill to load.

## What we protect

| Asset | Where it lives | What breaks it |
|---|---|---|
| A person's vault and keys | avenDB (`avendb/crates/avendb`: `keys.rs`, `sign.rs`, `sealed.rs`, `recovery.rs`; `avendb-net/src/kx.rs`) | a key or seed left in memory, a timing leak, a signature or sealed box that verifies what it should refuse, a recovery path that skips the owner |
| Who may do what | caps and shares (`policy.rs`, `gate.rs`, `rules.rs`), the Lean spec (`avendb/spec`) | a rule the Rust engine applies differently from the Lean spec, a share that reaches further than its cap |
| Which code runs | the trustless hosts (`src/lib/sandbox`) and provenance (`game/code/sources/anchor.js`, hardening H1–H8) | vault code reaching keys, network, storage or the page; a page running code Maia City's signed edits did not name |
| Sign-in and admin | the Bun API (`api/src`), the avenDB feed (`avendb/crates/avendb-server/src/feed.rs`) | a forged session, a passkey ceremony that accepts the wrong origin or a replay, an admin route without its gate |
| The Mac | The OS (`vault/app`: Tauri commands, the `aven:` protocol, the Touch ID bridge `enclave.rs` / `enclave/Enclave.swift`) | the web view reaching a command or a file it should not, a CSP looser than the site's |
| The pipeline | `.github/workflows` | a workflow that runs untrusted input, an agent in CI steered by a comment, a secret printed to a public log |

The crypto, by name: BLAKE3, Ed25519 (device keys), ECDSA P-256 over SHA-256 (WebAuthn), ML-DSA-65 (FIPS 204, every
new signer), SLH-DSA-SHA2-128f (being retired), X-Wing (ML-KEM-768 + X25519) and Classic McEliece 6688128f in sealed
boxes, XChaCha20-Poly1305 for edits (`avendb/crates/avendb/Cargo.toml` names each with why).

## The auditor's laws (never break them)

1. **The repo is public.** A vulnerability's details never go into an issue, a PR title or body, a commit message, a
   code comment or a CI log before its fix is merged. Findings go to Samuel in the thread and in
   `/mnt/project-files/security/<audit>/`; the fixing PR says what it hardens, not how to exploit what it fixes. A
   workflow never prints a finding, a key or a vault's data (seal it first).
2. **Every finding is checked before it is reported.** Run `fp-check` on each one; a finding without a concrete path
   from attacker input to harm is a lead, and is reported as one.
3. **Lean is the truth for avenDB.** A finding about avenDB's rules is checked against `avendb/spec` first
   (`spec-compliance`). Where the Rust and the Lean disagree, the fix starts in the spec; vectors are regenerated,
   never marked pending.
4. **Fixes are pull requests; vault changes are proposals.** Code is fixed by a PR. Anything in a vault (a code entry,
   a config, a doc) changes only as an AIP Samuel signs, never a direct write.
5. **Nothing deleted without asking.** Build folders, caches, results: list them with their sizes and ask Samuel. On
   his Mac, one Rust build at a time, at low priority, in one build folder.
6. **Never test against production with load.** No bursts at `avendb.maia.city` or `api.maia.city`, no fuzzing of a
   live service; fuzz and probe a local build.
7. **Say what was not covered.** Every report names the code and the patterns it did not reach. A report without that
   section reads as full coverage.

## The order of work

1. **Understand** — `audit-context` builds what each function assumes and guarantees before any hunting. On a pull
   request, `diff-review` instead (it uses `audit-context` for the risky files).
2. **Hunt**, by surface:
   - Rust (avenDB, the Tauri side of The OS): `rust-security`; `constant-time` and `zeroize` on any code that holds a
     key or a secret.
   - The site, the API, the feed, the sandbox frames and The OS's web view: `web-security`.
   - APIs and configs that invite mistakes (our own crypto wrappers, caps, share options): `sharp-edges`.
   - Workflows: `ci-agent-audit`, and `sharp-edges`' config patterns for the rest.
   - avenDB against its Lean spec: `spec-compliance`.
3. **Verify** — `fp-check` on every finding.
4. **Prove the fix and keep it fixed** — a regression test with the fix; `property-tests` for encoders, parsers and
   merges; `cargo-fuzz` and `fuzz-harness` for anything that parses bytes from a peer; `wycheproof` for the
   primitives it has vectors for; `lean-proofs` when the fix is a rule.
5. **Report** — the finding, its evidence, the fix and what was not covered, privately (law 1).

## Sub skills

| Skill | Load it for |
|---|---|
| `audit-context` | a first deep read of unfamiliar code, function by function (a saved workflow) |
| `rust-security` | a Rust crate: `unsafe`, FFI, panics as denial of service, concurrency, async |
| `web-security` | the site, the Bun API, passkeys and sessions, CORS and CSP, the feed, the sandbox frames, The OS's web view |
| `sharp-edges` | footgun APIs and dangerous defaults (Rust, JavaScript, Swift references) |
| `constant-time` | timing leaks in crypto code (Rust, JavaScript) |
| `zeroize` | secrets left in memory by Rust code, with MIR, IR and assembly evidence |
| `ci-agent-audit` | GitHub Actions workflows that run AI agents |
| `spec-compliance` | code against the document that specifies it — for avenDB, the Lean spec (a saved workflow) |
| `diff-review` | a PR, a commit or a diff |
| `fp-check` | is this finding real? |
| `property-tests` | tests over a whole input domain (proptest in Rust, fast-check in JavaScript) |
| `cargo-fuzz`, `fuzz-harness` | fuzzing Rust, and designing the harness |
| `wycheproof` | crypto against known-attack vectors |
| `lean-proofs` | writing and reviewing Lean proofs in `avendb/spec` |

`spec-compliance` and `audit-context` run as saved workflows (`.claude/workflows/`); loading the skill is the opt-in,
and each says what it costs.

Not taken from the upstream bundle: its supply-chain audit (it reads only npm, PyPI and Go, not Cargo or `bun.lock`),
the C/C++, Go, Java, Kotlin, C#, Solidity and smart-contract tracks, and the proof-of-concept and MCP parts of the
zeroize audit.

## The `sec` tool

Every script of the bundle, as one Rust binary with a subcommand each, in `tools/` (its own crate, never built with
avenDB). Run it through the wrapper, which builds it first at low priority when its sources changed:

```bash
SEC="$(git rev-parse --show-toplevel)/.claude/skills/security-auditor/tools/sec"
"$SEC" --help            # every command
"$SEC" <command> --help  # its options
```

| Commands | Skill |
|---|---|
| `rust-plan`, `rust-validate`, `rust-sarif` | `rust-security` |
| `ct` | `constant-time` |
| `zeroize-toolchain`, `zeroize-apis`, `zeroize-semantic`, `zeroize-emit-rustdoc`, `zeroize-emit-mir`, `zeroize-emit-ir`, `zeroize-emit-asm`, `zeroize-mir`, `zeroize-diff-mir`, `zeroize-llvm`, `zeroize-asm`, `zeroize-gates` | `zeroize` |

Each port keeps its original's rules and output. `cargo test --release` in `tools/` runs the golden tests: the
upstream fixtures, with the outputs the original Python and shell scripts wrote for them (`tools/tests/golden/`).
Where an original had a bug, the port fixes it and NOTICE.md says so.

The zeroize emitters build with `cargo +nightly` in one shared folder per crate (`<target>/zeroize`, or
`--target-dir`): the first run builds every dependency, later runs only the crate. That folder stays until Samuel
says it may go.

## Where results go

- `rust-security` writes to `.rust-review-results/<time>/` and `zeroize` to a fresh `zeroize-audit-*` folder under
  `$TMPDIR`; both are scratch, never committed (`.rust-review-results/` is in `.gitignore`).
- The report Samuel reads goes to `/mnt/project-files/security/<audit>/`, never into the repo (law 1).
