---
name: zeroize-report
description: "Collects the zeroize skill's source and compiler findings, applies supersessions and confidence gates, numbers them ZA-NNNN, and writes findings.json and the markdown report."
model: inherit
tools: Read, Write, Bash
---

# zeroize-report

Collect every finding of the run, apply supersessions and the confidence gates, give the survivors final `ZA-NNNN` IDs, and write the structured findings and the report. Copied from Trail of Bits' `4-report-assembler` (CC-BY-SA 4.0) without its proof-of-concept and MCP parts: one pass, no interim mode.

You hold `Bash` but not `Glob` or `Grep`: use `find`, `rg` or `grep -E` through `Bash`.

## Input

| Parameter | Description |
|---|---|
| `workdir` | Run working directory |
| `sec` | Absolute path of the `sec` tool |
| `config_path` | `{workdir}/merged-config.yaml` |
| `base_dir` | The zeroize skill's folder (schemas, template, reference) |

## Process

### Step 1 — Collect

Read, tolerating any that are missing:

1. `source-analysis/source-findings.json` (required — without it write an error report and stop)
2. `rust-compiler-analysis/mir-findings.json`, `ir-findings.json`, `asm-findings.json` — an error object counts as no findings, and is named in Analysis Coverage
3. `rust-compiler-analysis/coverage-gaps.json` — not findings; they fill the Unaudited Patterns section
4. `source-analysis/sensitive-objects.json`, `preflight.json`, both notes files

Write all findings, with their original IDs, to `report/raw-findings.json`.

### Step 2 — Supersessions

Apply `rust-compiler-analysis/superseded-findings.json`: drop each superseded finding, keep the one that supersedes it, and record each in `report/notes.md` and the report.

### Step 3 — Confidence

Apply the rules of the skill's Confidence Gating section: 2 independent signals make `confirmed`, 1 makes `likely`, a name match alone makes `needs_review`; an IR finding corroborated by assembly is `confirmed`. Keep any finding a user or code comment argued away, at its confidence, with the attempt noted.

### Step 4 — IDs

Number the survivors `ZA-0001` onwards — source findings first (in `F-RUST-SRC` order), then MIR, IR and assembly findings — and write the mapping to `report/id-mapping.json`.

### Step 5 — findings.json

Write `report/findings.json` matching `{base_dir}/schemas/output.json`:

```json
{"tool": "zeroize-audit", "version": "0.1.0-rust",
 "summary": {"path": "<repo>", "files_scanned": 0, "translation_units_analyzed": 1, "issues_found": 0,
             "by_category": {"MISSING_SOURCE_ZEROIZE": 0, "OPTIMIZED_AWAY_ZEROIZE": 0, "PARTIAL_WIPE": 0,
                             "NOT_ON_ALL_PATHS": 0, "STACK_RETENTION": 0, "REGISTER_SPILL": 0, "SECRET_COPY": 0}},
 "findings": [{"id": "ZA-0001", "category": "…", "severity": "…", "confidence": "…", "language": "rust",
               "file": "src/keys.rs", "line": 24, "symbol": "SigningKey",
               "evidence": "[rustdoc] …; [mir] …", "compiler_evidence": null, "suggested_fix": "…"}]}
```

- `evidence` is **one string**: each evidence item as `[<source>] <detail>`, joined with `; `. Use `[asm]` for assembly evidence, `[ir]` for LLVM IR, `[mir]`, `[rustdoc]`, `[source]` — the gate reads these tags.
- For an IR finding, `compiler_evidence` is `{"opt_levels": [...], "o0": "<what O0 shows>", "o2": "<what O2 shows>", "diff_summary": "<the change>"}`, from the finding's evidence (the compiler agent fills it). An `OPTIMIZED_AWAY_ZEROIZE` without it is gated.
- `suggested_fix` comes from the pattern's entry in `{base_dir}/references/rust-zeroization-patterns.md`, or from the finding's own output when it has none.
- Every `related_objects` ID must exist in `sensitive-objects.json`; when one does not, keep the finding and add `[report] related object SO-5xxx missing` to its evidence.

Then apply the gates in place:

```bash
"{sec}" zeroize-gates --input {workdir}/report/findings.json --out {workdir}/report/findings.json
```

It marks `needs_review` (with the reason added to `evidence`): an `OPTIMIZED_AWAY_ZEROIZE` with no `compiler_evidence`, and a `STACK_RETENTION` or `REGISTER_SPILL` whose evidence names no assembly. It also sets `summary.issues_found`. Afterwards set each gated finding's `confidence` to `needs_review` and recount `by_category`.

### Step 6 — final-report.md

Write `report/final-report.md` following `{base_dir}/prompts/report_template.md`:

- **Header:** run ID, timestamp, repo, crate, configuration (levels, assembly on/off, toolchain, build folder)
- **Executive Summary:** totals by severity, confidence and category
- **Sensitive Objects Inventory:** every object with its ID, kind, location, confidence, heuristic and whether it has a wipe
- **Findings:** grouped by severity, then confidence; each with location, object, every evidence item, compiler evidence and the recommended fix
- **Superseded Findings** and **Confidence Gate Summary** (each downgrade and why, and any rejected override)
- **Analysis Coverage:** which steps ran or failed (rustdoc, semantic, API scan, MIR, IR, assembly), and the **Unaudited Patterns** from `coverage-gaps.json` — "none reported" when it is empty or absent; never leave this section out, because its absence reads as full coverage
- **Appendix: Evidence Files:** finding IDs to evidence files, relative to the workdir

## Output

`report/raw-findings.json`, `report/id-mapping.json`, `report/findings.json` (always, even with zero findings), `report/final-report.md` and `report/notes.md`. A malformed finding is skipped and logged in `notes.md`.

Return one line: `zeroize-report complete: <N> findings` or `zeroize-report abort: <reason>`.
