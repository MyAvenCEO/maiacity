# Developer speed: measure, change, measure again

Numbers come from `bun scripts/devx/measure.mjs` (GitHub's merged PRs and Actions runs; read-only). The method is in
`.claude/skills/devx-speed/SKILL.md`. One row per change; compare windows of the same kind.

## Cycle 0: baseline (measured 2026-10-27)

| day (UTC) | tasks to main | PRs to main | lane PRs | median open→merge (min) | PR CI runner-min | cancelled % | CI min per task | release (min) |
|---|---|---|---|---|---|---|---|---|
| 10-14 | 70 | 70 | 0 | 0.2 | 0 | 0 | 0 | |
| 10-15 | 42 | 42 | 0 | 0.2 | 0 | 0 | 0 | |
| 10-16 | 82 | 82 | 0 | 0.2 | 0 | 0 | 0 | |
| 10-17 | 68 | 68 | 0 | 0.2 | 0 | 0 | 0 | |
| 10-18 | 100 | 100 | 0 | 0.2 | 0 | 0 | 0 | |
| 10-19 | 69 | 69 | 0 | 0.2 | 248 | 5.9 | 3.6 | |
| 10-20 | 88 | 88 | 0 | 8.6 | 5245 | 7.5 | 59.6 | |
| 10-21 | 57 | 57 | 0 | 8.1 | 2800 | 20.3 | 49.1 | |
| 10-22 | 22 | 22 | 0 | 19.8 | 1149 | 44.8 | 52.2 | |
| 10-23 | 7 | 7 | 0 | 36.2 | 860 | 52.1 | 122.8 | |
| 10-24 | 17 | 16 | 1 | 43.6 | 1416 | 39.4 | 83.3 | 16.4 |
| 10-25 | 5 | 5 | 0 | 9.0 | 192 | 45.7 | 38.5 | 7.1 |
| 10-26 | 33 | 22 | 11 | 24.4 | 2800 | 20.8 | 84.8 | 22.5 |
| 10-27 (to 16:00) | 23 (34.5/day) | 13 | 10 | 29.0 | 3134 | 30.1 | 136.3 | 4.3 |

Windows: Oct 14-20 averaged **74 tasks a day**, PRs merged at once, 10.6 CI minutes per task. Oct 21-27: **24.6 a
day** (Oct 22-27 about 18), median 15.6 min open to merge, **75 CI minutes per task**, 32% of PR runs cancelled.
PR CI (#1156, Oct 20) made main safe and every task wait: ~20 jobs per push on a plan that runs 20 at a time, 5.5
pushes per branch on average, a new push cancelling the last run. The work also got deeper (avenDB sync v2), so not
all of the drop is CI.

Local tools, timed on a 4-core cloud box:

| step | before | with scripts/devx |
|---|---|---|
| check a change to `src/lib/avendb/` | a CI round, median 7.8 min, p75 15.5 (or the 137 s security suite) | `check.mjs`: 3.4 s nearby tests + 65 s svelte-check |
| land 10 task branches in one branch | 10 PRs, 10+ CI rounds | `collect.mjs`: 2.5 s; 3 conflicts named, 1 wasm-only conflict resolved |
| see the numbers | by hand | `measure.mjs`: 20 s a day |

Target, 5x the Oct 22-27 rate: **90+ tasks a day**, under 2 CI minutes per task, release ~4 min after merge.

## Cycles

| date | change | before | after | verdict |
|---|---|---|---|---|
| 2026-10-27 | drafts run no CI (#1340), batch rule, `scripts/devx` | 18-25 tasks/day, 75 CI min/task | measure after the first batch | |
