// avenDB's performance gates (the `bench` job of avendb-checks.yml): reads the `BENCH {...}` lines of avendb/crates/
// avendb/tests/bench_gates.rs and avendb-server/tests/relay_bench.rs and the `PG {...}` lines of avendb-bench-pg.mjs,
// holds avenDB's numbers to the gates of avendb/bench-gates.json, prints them beside Postgres's (to the job's summary
// too), and fails on any gate missed. The relay's carrier cases are held and printed apart from the direct path's. A
// target the gates don't hold yet (`targets`) is printed with whether it is met, and fails nothing.
//
//   bun scripts/ci/avendb-bench.mjs bench.log [pg.log]
import { appendFileSync, readFileSync } from 'node:fs';

export const gatesFile = new URL('../../avendb/bench-gates.json', import.meta.url);

// The JSON of each line of `text` that starts with `tag `, as `tag {...}`.
export function lines(text, tag) {
 return text.split('\n').filter(l => l.startsWith(`${tag} {`)).map(l => JSON.parse(l.slice(tag.length + 1)));
}

const fmt = x => x == null ? '–' : typeof x === 'number' ? (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : String(x)) : String(x);

// Every gate and target over the bench's lines: [{ name, value, limit, ok, gate }], `gate` false for a target.
export function check(bench, gates) {
 const out = [];
 const add = (gate, name, value, limit, ok) => out.push({ gate, name, value, limit, ok: value != null && ok });
 const scale = bench.filter(b => b.kind === 'scale').sort((a, b) => a.n - b.n);
 const first = bench.filter(b => b.kind === 'first');
 const g = gates.gates, t = gates.targets;
 for (const n of gates.sizes) if (!scale.some(s => s.n === n)) add(true, `scale run at ${n}`, null, 'present', false);
 for (const f of gates.first_sync) if (!first.some(s => s.n === f.n)) add(true, `first sync at ${f.n}`, null, 'present', false);
 const carriers = bench.filter(b => b.kind === 'carrier');
 for (const c of gates.carriers ?? []) if (!carriers.some(x => x.carrier === c)) add(true, `carrier ${c}`, null, 'present', false);
 for (const f of first) {
  const min = g.first_sync_speedup_min[f.n];
  if (min != null) add(true, `first sync ${f.n}: one asking × faster than batched`, f.speedup, `≥ ${min}`, f.speedup >= min);
  add(false, `first sync ${f.n}: × faster than batched`, f.speedup, `≥ ${t.first_sync_speedup}`, f.speedup >= t.first_sync_speedup);
 }
 const base = scale.find(s => s.n === gates.sizes[0]);
 for (const s of scale) {
  add(true, `${s.n}: point read p95 µs`, s.read_p95_us, `< ${g.read_p95_us_max}`, s.read_p95_us < g.read_p95_us_max);
  add(true, `${s.n}: view p95 µs`, s.view_p95_us, `< ${g.view_p95_us_max}`, s.view_p95_us < g.view_p95_us_max);
  if (g.writes_per_s_min != null) add(true, `${s.n}: writes/s, one at a time`, s.writes_per_s, `≥ ${g.writes_per_s_min}`, s.writes_per_s >= g.writes_per_s_min);
  add(false, `${s.n}: writes/s, one at a time`, s.writes_per_s, `≥ ${t.writes_per_s}`, s.writes_per_s >= t.writes_per_s);
  add(false, `${s.n}: writes/s, one at a time through draft_on`, s.device_writes_per_s, `≥ ${t.writes_per_s}`, s.device_writes_per_s >= t.writes_per_s);
  if (g.intake_per_s_min != null) add(true, `${s.n}: edits/s taken in pages`, s.intake_per_s, `≥ ${g.intake_per_s_min}`, s.intake_per_s >= g.intake_per_s_min);
  add(false, `${s.n}: edits/s taken in pages`, s.intake_per_s, `≥ ${t.writes_per_s}`, s.intake_per_s >= t.writes_per_s);
  if (base && s !== base) {
   const cost = s.tail_us_per_edit / base.tail_us_per_edit;
   const r = Math.round(cost * 100) / 100;
   add(true, `${s.n}: cost per edit ÷ ${base.n}'s`, r, `≤ ${g.cost_ratio_max}`, cost <= g.cost_ratio_max);
   add(false, `${s.n}: cost per edit ÷ ${base.n}'s`, r, `≤ ${t.cost_ratio}`, cost <= t.cost_ratio);
   const draft = Math.round(s.draft_on_us / base.draft_on_us * 100) / 100;
   add(false, `${s.n}: draft_on's cost ÷ ${base.n}'s`, draft, `≤ ${t.cost_ratio}`, draft <= t.cost_ratio);
   if (s.rss_bytes_per_edit != null && base.rss_bytes_per_edit != null) {
    const rss = s.rss_bytes_per_edit / base.rss_bytes_per_edit;
    add(true, `${s.n}: memory per edit ÷ ${base.n}'s`, Math.round(rss * 100) / 100, `≤ ${g.rss_ratio_max}`, rss <= g.rss_ratio_max);
   }
  }
 }
 const direct = carriers.find(c => c.carrier === 'direct');
 for (const c of carriers) {
  const min = g.carrier_edits_per_s_min?.[c.carrier];
  if (min != null) add(true, `carrier ${c.carrier}: edits/s`, c.edits_per_s, `≥ ${min}`, c.edits_per_s >= min);
  add(false, `carrier ${c.carrier}: edits/s, native`, c.edits_per_s, `≥ ${t.carrier_edits_per_s}`, c.edits_per_s >= t.carrier_edits_per_s);
  if (c.carrier !== 'direct' && direct) {
   const share = Math.round(c.edits_per_s / direct.edits_per_s * 100) / 100;
   add(false, `carrier ${c.carrier}: edits/s ÷ direct's`, share, '≥ 1', share >= 1);
  }
  if (c.link_share != null) {
   add(true, `carrier ${c.carrier}: edit bytes/s ÷ link`, c.link_share, `≥ ${g.relay_link_share_min}`, c.link_share >= g.relay_link_share_min);
   add(false, `carrier ${c.carrier}: edit bytes/s ÷ link`, c.link_share, `≥ ${t.relay_link_share}`, c.link_share >= t.relay_link_share);
  }
 }
 if (carriers.length) add(false, `carrier relay: edits/s on WebKit`, null, `≥ ${t.carrier_edits_per_s_webkit} (not measured here)`, false);
 return out;
}

// The tables: the gates and targets, then avenDB beside Postgres at each size.
export function report(bench, pg, results) {
 const rows = [
  '| | check | value | limit | |', '|---|---|---|---|---|',
  ...results.map(r => `| ${r.gate ? 'gate' : 'target'} | ${r.name} | ${fmt(r.value)} | ${r.limit} | ${r.ok ? 'pass' : r.gate ? '**FAIL**' : 'not yet'} |`),
  '',
  '| edits | | writes/s | read p50 µs | read p95 µs | view p50 µs | view p95 µs | view rows | bytes/edit |', '|---|---|---|---|---|---|---|---|---|',
 ];
 for (const s of bench.filter(b => b.kind === 'scale').sort((a, b) => a.n - b.n)) {
  rows.push(`| ${fmt(s.n)} | avenDB | ${fmt(s.writes_per_s)} one at a time, ${fmt(s.intake_per_s)} in pages | ${s.read_p50_us} | ${s.read_p95_us} | ${s.view_p50_us} | ${s.view_p95_us} | ${s.view_rows} | ${fmt(s.rss_bytes_per_edit)} resident |`);
  const p = pg.find(x => x.n === s.n);
  if (p) rows.push(`| ${fmt(p.n)} | Postgres | ${fmt(p.single_insert_per_s)} a commit each, ${fmt(p.insert_per_s)} in batches | ${p.read_p50_us} | ${p.read_p95_us} | ${p.view_p50_us} | ${p.view_p95_us} | ${p.view_rows} | ${fmt(p.bytes_per_edit)} on disk |`);
 }
 const first = bench.filter(b => b.kind === 'first');
 const carriers = bench.filter(b => b.kind === 'carrier');
 if (carriers.length) rows.push('', '| carrier | edits | bytes/edit | sync s | asks | edits/s | KB/s | link KB/s | of link |', '|---|---|---|---|---|---|---|---|---|',
  ...carriers.map(c => `| ${c.carrier} | ${fmt(c.edits)} | ${fmt(c.bytes_per_edit)} | ${c.sync_s} | ${c.asks} | ${fmt(c.edits_per_s)} | ${fmt(Math.round(c.bytes_per_s / 1000))} | ${c.link_bytes_per_s ? fmt(c.link_bytes_per_s / 1000) : '–'} | ${c.link_share ?? '–'} |`));
 if (first.length) rows.push('', '| first sync edits | batched s | one asking s | × |', '|---|---|---|---|', ...first.map(f => `| ${fmt(f.n)} | ${f.batched_s} | ${f.one_asking_s} | ${f.speedup} |`));
 return rows.join('\n');
}

if (import.meta.main) {
 const [benchFile, pgFile] = process.argv.slice(2);
 const bench = lines(readFileSync(benchFile, 'utf8'), 'BENCH');
 const pg = pgFile ? lines(readFileSync(pgFile, 'utf8'), 'PG') : [];
 const gates = JSON.parse(readFileSync(gatesFile, 'utf8'));
 const results = check(bench, gates);
 const text = report(bench, pg, results);
 console.log(text);
 if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## avenDB bench\n\n${text}\n`);
 const failed = results.filter(r => r.gate && !r.ok);
 for (const f of failed) console.log(`::error::avenDB bench: ${f.name} is ${fmt(f.value)}, the gate ${f.limit} (avendb/bench-gates.json)`);
 process.exit(failed.length ? 1 : 0);
}
