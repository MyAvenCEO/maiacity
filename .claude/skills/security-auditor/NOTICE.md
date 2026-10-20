# Notice

Most of the security-auditor bundle is adapted from **Trail of Bits' skills**, <https://github.com/trailofbits/skills>,
at commit `5c99c03fb8a9ea568432ecbcba5d86e9f4ac2bf0` (2026-10-15), © Trail of Bits, licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International licence](https://creativecommons.org/licenses/by-sa/4.0/)
(CC-BY-SA 4.0).

The adapted material below is shared under the same licence, CC-BY-SA 4.0. That covers the `sec` crate in `tools/`
(its Rust code ports Trail of Bits' scripts) and the fixtures in `tools/tests/golden/` (upstream test fixtures, and
the outputs the upstream scripts wrote for them). `security-auditor/SKILL.md`, `web-security` and this notice are
maiaCITY's own.

## What was adapted, and from where

Paths are relative to `.claude/` here and to `plugins/` upstream.

| Ours | Upstream |
|---|---|
| `skills/rust-security/` | `rust-review/skills/rust-review/`, `rust-review/prompts/`, `rust-review/README.md` |
| `agents/rust-security-worker.md`, `-fp-judge.md`, `-dedup-judge.md` | `rust-review/agents/rust-review-*.md` |
| `skills/constant-time/` | `constant-time-analysis/skills/constant-time-analysis/` (the analyzer's Rust and JS triage samples kept) |
| `skills/zeroize/` | `zeroize-audit/skills/zeroize-audit/` (Rust track) |
| `agents/zeroize-source.md`, `zeroize-compiler.md`, `zeroize-report.md` | `zeroize-audit/agents/2b-rust-source-analyzer.md`, `3b-rust-compiler-analyzer.md`, `4-report-assembler.md` |
| `skills/spec-compliance/`, `agents/spec-compliance-checker.md`, `workflows/spec-compliance.js` | `spec-to-code-compliance/` |
| `skills/audit-context/`, `agents/audit-function-analyzer.md`, `workflows/audit-context.js` | `audit-context-building/` (agent `function-analyzer`) |
| `skills/diff-review/`, `agents/diff-adversarial-modeler.md` | `differential-review/` (agent `adversarial-modeler`) |
| `skills/fp-check/`, `agents/fp-data-flow-analyzer.md`, `fp-poc-builder.md`, `fp-exploitability-verifier.md` | `fp-check/` |
| `skills/sharp-edges/`, `agents/sharp-edges-analyzer.md` | `sharp-edges/` |
| `skills/ci-agent-audit/` | `agentic-actions-auditor/` |
| `skills/property-tests/` | `property-based-testing/` |
| `skills/lean-proofs/` | `writing-lean-proofs/` |
| `skills/cargo-fuzz/`, `skills/fuzz-harness/`, `skills/wycheproof/` | `testing-handbook-skills/skills/cargo-fuzz`, `harness-writing`, `wycheproof` |

## What we changed

- **Names and paths.** Skills and agents renamed as above, every reference to them updated; `{baseDir}` and plugin
  paths replaced with repo paths; slash commands replaced by our saved workflows (`.claude/workflows/`).
- **Languages.** Cut to the languages we write (Rust, JavaScript, Swift, Lean): `sharp-edges` keeps only its Rust,
  Swift and JavaScript references; `constant-time` builds Rust and reads JavaScript (any other language from an
  assembly listing); `zeroize` keeps only its Rust track. Its C/C++ track, its MCP resolver and its proof-of-concept
  and test generators were left out.
- **Our context.** Notes added where our code differs: `spec-compliance` treats the Lean spec (`avendb/spec`) as the
  authoritative document; examples point at avenDB.
- **Scripts → Rust.** Every Python and shell script the kept skills run is one Rust binary, `sec`, with a subcommand
  each (`tools/`); each keeps its original's rules, output format and messages. Golden tests hold the ports to the
  originals' output on the upstream fixtures. Bugs found in the originals while porting, fixed in the ports:
  - the assembly check found no functions once Rust symbols were demangled; the port demangles legacy and v0
    symbols itself (no `rustfilt`) and reports one finding per generic function;
  - the semantic audit found nothing in current rustdoc JSON, and lost findings whose source files lie outside the
    crate's folder; the port reads today's format and resolves spans from the manifest's and the rustdoc file's
    folders;
  - the MIR, IR and assembly emitters built every dependency again in a fresh temporary folder on each run, left those
    folders behind, and wrote IR and assembly twice into one file; the ports build in one shared folder per crate
    and write each output once;
  - the rustdoc step passed `--document-private-items` where cargo refuses it; it is now its own command,
    `zeroize-emit-rustdoc`;
  - the report step called the confidence gate with the wrong arguments, and the gate crashed on evidence given as
    an array; the skill now passes the right arguments and evidence as one string, and the port refuses malformed
    input exactly where the original did.
- **Left out.** The supply-chain audit (it reads npm, PyPI and Go, not Cargo or `bun.lock`), and every plugin not
  listed above.
