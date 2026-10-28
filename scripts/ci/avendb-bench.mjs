// avenDB's performance gates (the `bench` job of avendb-checks.yml): reads the `BENCH {...}` lines of avendb/crates/
// avendb/tests/bench_gates.rs and avendb-server/tests/relay_bench.rs and the `PG {...}` lines of avendb-bench-pg.mjs,
// holds avenDB's numbers to the gates of avendb/bench-gates.json, prints them beside Postgres's (to the job's summary
// too), and fails on any gate missed. The relay's carrier cases are held and printed apart from the direct path's. A
// target the gates don't hold yet (`targets`) is printed with whether it is met, and fails nothing.
//
//   bun scripts/ci/avendb-bench.mjs bench.log [pg.log]
//   bun scripts/ci/avendb-bench.mjs phone.log --phone      the phone-class rows alone (avendb-bench-phone.mjs)
//   bun scripts/ci/avendb-bench.mjs bench.log [pg.log] --shard core|carriers|live   one shard of the bench job: only
//                                                          its own runs are required present
//   bun scripts/ci/avendb-bench.mjs index.log --index      the index's scale rows alone (avendb-net's shelf_index_bench.rs,
//                                                          run in the net test shard, whose build it shares)
import { appendFileSync, readFileSync } from 'node:fs';

export const gatesFile = new URL('../../avendb/bench-gates.json', import.meta.url);

// The JSON of each line of `text` that starts with `tag `, as `tag {...}`.
export function lines(text, tag) {
 return text.split('\n').filter(l => l.startsWith(`${tag} {`)).map(l => JSON.parse(l.slice(tag.length + 1)));
}

const fmt = x => x == null ? '–' : typeof x === 'number' ? (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : String(x)) : String(x);

// The index's gates over its lines (`kind` index and parity): a view opened cold reads pages as the tree is deep, not
// as the log is long, and steps on no edit of the log.
export function checkIndex(bench, gates) {
 const out = [];
 const add = (gate, name, value, limit, ok) => out.push({ gate, name, value, limit, ok: value != null && ok });
 const g = gates.gates, ix = bench.filter(b => b.kind === 'index'), parity = bench.find(b => b.kind === 'parity');
 for (const n of gates.index_sizes ?? []) if (!ix.some(s => s.n === n)) add(true, `index at ${n}`, null, 'present', false);
 if (gates.parity_n) add(true, `index at ${gates.parity_n}: bulk-built root == written as they come`, parity?.same_root ?? null, 'true', parity?.same_root === true);
 for (const s of ix) {
  add(true, `index ${s.n}: log edits stepped on opening`, s.open_log_edits, `≤ ${g.index_log_edits_max}`, s.open_log_edits <= g.index_log_edits_max);
  add(true, `index ${s.n}: depth ÷ the model's`, s.depth, `≤ ${s.depth_model}`, s.depth <= s.depth_model);
  add(true, `index ${s.n}: pages read opening a view (median), past the depth`, s.open_pages_p50 - s.depth, `≤ ${g.index_view_pages_p50_over_depth_max}`, s.open_pages_p50 - s.depth <= g.index_view_pages_p50_over_depth_max);
  add(true, `index ${s.n}: pages read opening a view (most), past the depth`, s.open_pages_read - s.depth, `≤ ${g.index_view_pages_over_depth_max}`, s.open_pages_read - s.depth <= g.index_view_pages_over_depth_max);
  add(true, `index ${s.n}: pages read by a point read`, s.get_pages_read, `≤ ${s.depth}`, s.get_pages_read <= s.depth);
  add(true, `index ${s.n}: bytes read opening a view`, s.open_bytes_read, `≤ ${g.index_view_bytes_max}`, s.open_bytes_read <= g.index_view_bytes_max);
  add(true, `index ${s.n}: index bytes/edit`, s.index_bytes_per_edit, `≤ ${g.index_bytes_per_edit_max}`, s.index_bytes_per_edit <= g.index_bytes_per_edit_max);
  add(true, `index ${s.n}: view open p95 µs`, s.open_p95_us, `< ${g.index_open_p95_us_max}`, s.open_p95_us < g.index_open_p95_us_max);
 }
 // G1: a named query's window opened end to end (query_window_bench.rs), the head of the log at n edits counted in
 const wins = bench.filter(b => b.kind === 'window');
 for (const n of gates.window_sizes ?? []) if (!wins.some(s => s.n === n)) add(true, `window at ${n}`, null, 'present', false);
 for (const s of wins) {
  add(true, `window ${s.n}: log edits stepped on`, s.window_log_edits, `≤ ${g.window_log_edits_max}`, s.window_log_edits <= g.window_log_edits_max);
  add(true, `window ${s.n}: index rows read`, s.window_rows_read, `≤ ${s.w}`, s.window_rows_read <= s.w);
  add(true, `window ${s.n}: pages read (most)`, s.window_pages_read, `≤ ${g.window_pages_max}`, s.window_pages_read <= g.window_pages_max);
  add(true, `window ${s.n}: bytes read`, s.window_bytes_read, `≤ ${g.window_bytes_max}`, s.window_bytes_read <= g.window_bytes_max);
  add(true, `window ${s.n}: a query answered cold, p50 µs`, s.window_at_n_p50_us, `< ${g.window_at_n_p50_us_max}`, s.window_at_n_p50_us < g.window_at_n_p50_us_max);
  if (s.node_open_head_ms != null) add(false, `window ${s.n}: the log's head a node works out as it opens, ms`, s.node_open_head_ms, `≤ ${gates.targets.node_open_head_ms}`, s.node_open_head_ms <= gates.targets.node_open_head_ms);
 }
 // a window's cost holds with the edits: the largest size's over the smallest's
 const [lo, hi] = [wins.reduce((a, b) => (a && a.n < b.n ? a : b), null), wins.reduce((a, b) => (a && a.n > b.n ? a : b), null)];
 if (lo && hi && lo !== hi) {
  const r = Math.round(hi.window_at_n_p50_us / lo.window_at_n_p50_us * 100) / 100;
  add(true, `window ${hi.n} p50 ÷ ${lo.n}'s`, r, `≤ ${g.window_growth_max}`, r <= g.window_growth_max);
 }
 return out;
}

// G1's named query of the Universe on a node (avendb-net's posts_page_bench.rs, the path the always-on peer's
// /feed/posts and Node::run take): a page of posts off the shared index, held by what it reads as well as its time, so a
// slow runner can neither hide a regression nor make one up: pages, bytes and index rows read (no row past those a page
// needs, as a find reading past its token's rows did before fab0a86d). Across vaults of more posts and of posts with history, a
// page reads the same pages (it reads no history); at 1M and 10M edits, measured there, not drawn from slopes, it reads
// at most posts_pages_max pages and posts_bytes_max bytes cold, its p50 under posts_page_ms_max, and both grow little.
export function checkPosts(bench, gates) {
 const out = [];
 const add = (gate, name, value, limit, ok) => out.push({ gate, name, value, limit, ok: value != null && ok });
 const g = gates.gates, p = bench.find(b => b.kind === 'posts_node');
 if (!p) add(true, 'posts page on a node', null, 'present', false);
 else {
  const more = Math.max(...p.pages, ...p.next_pages) - p.pages[0];
  add(true, 'posts page: pages read more with 8x the posts or 16 edits each (reads no history)', more, `≤ ${g.posts_shape_pages_more_max}`, more <= g.posts_shape_pages_more_max);
  const over = Math.max(...p.rows, ...p.next_rows) - p.rows_needed;
  add(true, 'posts page: index rows read past those it needs, any shape', over, `≤ ${g.posts_rows_over_max}`, over <= g.posts_rows_over_max);
 }
 const sized = new Map(bench.filter(b => b.kind === 'posts_at').map(b => [b.n, b]));
 for (const n of gates.window_sizes) {
  const s = sized.get(n);
  if (!s) { add(true, `posts page ${n}`, null, 'present', false); continue; }
  const pages = Math.max(s.pages_read, s.next_pages_read);
  add(true, `posts page ${n}: pages read cold (most)`, pages, `≤ ${g.posts_pages_max}`, pages <= g.posts_pages_max);
  add(true, `posts page ${n}: bytes read cold`, s.bytes_read, `≤ ${g.posts_bytes_max}`, s.bytes_read <= g.posts_bytes_max);
  const over = Math.max(s.rows_read, s.next_rows_read) - s.rows_needed;
  add(true, `posts page ${n}: index rows read past the ${s.rows_needed} it needs`, over, `≤ ${g.posts_rows_over_max}`, over <= g.posts_rows_over_max);
  add(true, `posts page ${n}: a page cold, p50 ms`, Math.round(s.p50_us / 100) / 10, `< ${g.posts_page_ms_max}`, s.p50_us < g.posts_page_ms_max * 1000);
 }
 const [lo, hi] = [Math.min(...gates.window_sizes), Math.max(...gates.window_sizes)].map(n => sized.get(n));
 if (lo && hi && lo !== hi) {
  const pages = hi.pages_read - lo.pages_read;
  add(true, `posts page ${hi.n}: pages read more than at ${lo.n}`, pages, `≤ ${g.posts_growth_pages_max}`, pages <= g.posts_growth_pages_max);
  const r = Math.round(hi.p50_us / lo.p50_us * 100) / 100;
  add(true, `posts page ${hi.n} p50 ÷ ${lo.n}'s`, r, `≤ ${g.window_growth_max}`, r <= g.window_growth_max);
 }
 return out;
}

// Every gate and target over the bench's lines: [{ name, value, limit, ok, gate }], `gate` false for a target.
export function check(bench, gates, pg = []) {
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
  if (s.log_bytes_per_edit != null) {
   if (g.log_bytes_per_edit_max != null) add(true, `${s.n}: log bytes/edit`, s.log_bytes_per_edit, `≤ ${g.log_bytes_per_edit_max}`, s.log_bytes_per_edit <= g.log_bytes_per_edit_max);
   const p = pg.find(x => x.n === s.n);
   if (p) {
    const r = Math.round(s.log_bytes_per_edit / p.bytes_per_edit * 100) / 100;
    add(false, `${s.n}: log bytes/edit ÷ Postgres's (the index apart)`, r, `≤ ${t.bytes_ratio_pg}`, r <= t.bytes_ratio_pg);
   }
  }
  if (base && s !== base) {
   const cost = s.tail_us_per_edit / base.tail_us_per_edit;
   const r = Math.round(cost * 100) / 100;
   add(true, `${s.n}: cost per edit ÷ ${base.n}'s`, r, `≤ ${g.cost_ratio_max}`, cost <= g.cost_ratio_max);
   add(false, `${s.n}: cost per edit ÷ ${base.n}'s`, r, `≤ ${t.cost_ratio}`, cost <= t.cost_ratio);
   const draft = Math.round(s.draft_on_us / base.draft_on_us * 100) / 100;
   if (g.draft_on_ratio_max != null) add(true, `${s.n}: draft_on's cost ÷ ${base.n}'s`, draft, `≤ ${g.draft_on_ratio_max}`, draft <= g.draft_on_ratio_max);
   add(false, `${s.n}: draft_on's cost ÷ ${base.n}'s`, draft, `≤ ${t.draft_on_ratio}`, draft <= t.draft_on_ratio);
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
 // live sync (avendb-net's sync_bench.rs, plan D3): a live edit's delay while a catch-up runs, and the catch-up's use of
 // its link
 const lives = bench.filter(b => b.kind === 'live');
 for (const l of gates.live_links ?? []) if (!lives.some(x => x.link === l)) add(true, `live sync on a ${l} link`, null, 'present', false);
 for (const l of lives) {
  // a `_bulk` link's run (20 MB of fat edits) holds the link's use (G3); every run a live edit's delay (G4), whose p95
  // means something only over enough live edits: the phone's bulk, whose catch-up runs longest, must give them
  const bulk = l.link.endsWith('_bulk');
  if (l.link === 'phone_bulk' && g.live_busy_samples_min != null) add(true, `live ${l.link}: live edits timed during the catch-up`, l.live_busy, `≥ ${g.live_busy_samples_min}`, l.live_busy >= g.live_busy_samples_min);
  {
   if (g.live_busy_p95_ms_max != null) add(true, `live ${l.link}: a live edit's delay during a catch-up, p95 ms`, l.live_busy_p95_ms, `< ${g.live_busy_p95_ms_max}`, l.live_busy_p95_ms < g.live_busy_p95_ms_max);
   add(false, `live ${l.link}: a live edit's delay during a catch-up, p95 ms`, l.live_busy_p95_ms, `< ${t.live_busy_p95_ms}`, l.live_busy_p95_ms < t.live_busy_p95_ms);
   if (g.live_idle_p95_ms_max != null) add(true, `live ${l.link}: a live edit's delay, idle, p95 ms`, l.live_idle_p95_ms, `< ${g.live_idle_p95_ms_max}`, l.live_idle_p95_ms < g.live_idle_p95_ms_max);
   if (g.live_missed_max != null) add(true, `live ${l.link}: live edits not there in 15 s`, l.live_missed, `≤ ${g.live_missed_max}`, l.live_missed <= g.live_missed_max);
  }
  if (bulk && l.link_share != null) {
   if (g.live_link_share_min != null) add(true, `live ${l.link}: catch-up bytes/s ÷ link`, l.link_share, `≥ ${g.live_link_share_min}`, l.link_share >= g.live_link_share_min);
   add(false, `live ${l.link}: catch-up bytes/s ÷ link`, l.link_share, `≥ ${t.live_link_share}`, l.link_share >= t.live_link_share);
  }
  if (g.live_resent_ratio_max != null) add(true, `live ${l.link}: edits sent again ÷ new`, l.resent_ratio, `≤ ${g.live_resent_ratio_max}`, l.resent_ratio <= g.live_resent_ratio_max);
  add(false, `live ${l.link}: edits sent again ÷ new`, l.resent_ratio, `≤ ${t.live_resent_ratio}`, l.resent_ratio <= t.live_resent_ratio);
 }
 // G5: a person's write while the Lab is busy (avendb-net's lab_schedule_bench.rs): ahead of every queued read, and soon
 const writes = bench.filter(b => b.kind === 'writes');
 for (const k of gates.writes_runs ?? []) if (!writes.length) add(true, `${k}: a write behind a busy Lab`, null, 'present', false);
 for (const x of writes) {
  add(true, 'a write behind a catch-up slice and 32 queued reads: reads run before it', x.writes_behind_a_read, '≤ 0', x.writes_behind_a_read === 0);
  if (g.write_p95_ms_max != null) add(true, 'a write behind a catch-up slice and 32 queued reads: p95 ms', x.write_p95_ms, `< ${g.write_p95_ms_max}`, x.write_p95_ms < g.write_p95_ms_max);
 }
 const phones = bench.filter(b => b.kind === 'phone');
 for (const p of phones) {
  add(false, `phone ${p.engine}: edits/s taken, signatures checked`, p.intake_per_s, `≥ ${t.phone_edits_per_s}`, p.intake_per_s >= t.phone_edits_per_s);
  add(false, `phone ${p.engine}: signatures checked/s`, p.verify_per_s, `≥ ${t.phone_edits_per_s}`, p.verify_per_s >= t.phone_edits_per_s);
 }
 return out;
}

// The tables: the gates and targets, then avenDB beside Postgres at each size.
export function report(bench, pg, results) {
 const rows = [
  '| | check | value | limit | |', '|---|---|---|---|---|',
  ...results.map(r => `| ${r.gate ? 'gate' : 'target'} | ${r.name} | ${fmt(r.value)} | ${r.limit} | ${r.ok ? 'pass' : r.gate ? '**FAIL**' : 'not yet'} |`),
 ];
 const scale = bench.filter(b => b.kind === 'scale').sort((a, b) => a.n - b.n);
 if (scale.length) rows.push('', '| edits | | writes/s | read p50 µs | read p95 µs | view p50 µs | view p95 µs | view rows | bytes/edit |', '|---|---|---|---|---|---|---|---|---|');
 for (const s of scale) {
  rows.push(`| ${fmt(s.n)} | avenDB | ${fmt(s.writes_per_s)} one at a time, ${fmt(s.intake_per_s)} in pages | ${s.read_p50_us} | ${s.read_p95_us} | ${s.view_p50_us} | ${s.view_p95_us} | ${s.view_rows} | ${fmt(s.rss_bytes_per_edit)} resident${s.log_bytes_per_edit ? `, ${fmt(s.log_bytes_per_edit)} log` : ''} |`);
  const p = pg.find(x => x.n === s.n);
  if (p) rows.push(`| ${fmt(p.n)} | Postgres | ${fmt(p.single_insert_per_s)} a commit each, ${fmt(p.insert_per_s)} in batches | ${p.read_p50_us} | ${p.read_p95_us} | ${p.view_p50_us} | ${p.view_p95_us} | ${p.view_rows} | ${fmt(p.bytes_per_edit)} on disk |`);
 }
 const ix = bench.filter(b => b.kind === 'index').sort((a, b) => a.n - b.n);
 if (ix.length) rows.push('', '| index of edits | rows | depth (model) | pages read, view (median) | bytes read, view | pages read, point | view open p50 µs | p95 µs | index bytes/edit | built s |', '|---|---|---|---|---|---|---|---|---|---|',
  ...ix.map(s => `| ${fmt(s.n)} | ${fmt(s.rows)} | ${s.depth} (${s.depth_model}) | ${s.open_pages_p50}, at most ${s.open_pages_read} | ${fmt(s.open_bytes_read)} | ${s.get_pages_read} | ${s.open_p50_us} | ${s.open_p95_us} | ${s.index_bytes_per_edit} | ${s.build_s} |`));
 const wins = bench.filter(b => b.kind === 'window').sort((a, b) => a.n - b.n);
 if (wins.length) rows.push('', '| named query answered at edits | index rows | pages read (median, most) | bytes read | rows read | log edits | cold p50 / p95 µs | again p50 µs | log head at node open ms |', '|---|---|---|---|---|---|---|---|---|',
  ...wins.map(s => `| ${fmt(s.n)} | ${fmt(s.rows)} | ${s.window_pages_p50}, ${s.window_pages_read} | ${fmt(s.window_bytes_read)} | ${s.window_rows_read} | ${s.window_log_edits} | ${s.window_p50_us} / ${s.window_p95_us} | ${s.window_warm_p50_us ?? '–'} | ${fmt(s.node_open_head_ms)} |`));
 const posts = bench.filter(b => b.kind === 'posts_node');
 if (posts.length) rows.push('', '| posts page on a node, cold | base | 8x posts | 16 edits each |', '|---|---|---|---|',
  ...posts.flatMap(p => [`| pages read, first / next page | ${p.pages.map((x, i) => `${x} / ${p.next_pages[i]}`).join(' | ')} |`,
   `| bytes read | ${p.bytes.map(fmt).join(' | ')} |`, `| index rows read (needs ${p.rows_needed}) | ${p.rows.join(' | ')} |`, `| p50 µs | ${p.us.join(' | ')} |`]));
 const postsAt = bench.filter(b => b.kind === 'posts_at').sort((a, b) => a.n - b.n);
 if (postsAt.length) rows.push('', '| posts page at edits | pages read, first / next page | bytes read | index rows read (needed) | cold p50 / p95 µs | built s |', '|---|---|---|---|---|---|',
  ...postsAt.map(s => `| ${fmt(s.n)} | ${s.pages_read} / ${s.next_pages_read} | ${fmt(s.bytes_read)} | ${s.rows_read} (${s.rows_needed}) | ${s.p50_us} / ${s.p95_us} | ${s.build_s} |`));
 const first = bench.filter(b => b.kind === 'first');
 const carriers = bench.filter(b => b.kind === 'carrier');
 if (carriers.length) rows.push('', '| carrier | edits | bytes/edit | sync s | asks | edits/s | KB/s | link KB/s | of link |', '|---|---|---|---|---|---|---|---|---|',
  ...carriers.map(c => `| ${c.carrier} | ${fmt(c.edits)} | ${fmt(c.bytes_per_edit)} | ${c.sync_s} | ${c.asks} | ${fmt(c.edits_per_s)} | ${fmt(Math.round(c.bytes_per_s / 1000))} | ${c.link_bytes_per_s ? fmt(c.link_bytes_per_s / 1000) : '–'} | ${c.link_share ?? '–'} |`));
 const lives = bench.filter(b => b.kind === 'live');
 if (lives.length) rows.push('', '| live sync link | edits | bytes/edit | catch-up s | edits/s | of link | sent again | live during catch-up p50 / p95 ms | idle p50 / p95 ms | missed | peak MB |', '|---|---|---|---|---|---|---|---|---|---|---|',
  ...lives.map(l => `| ${l.link} | ${fmt(l.edits)} | ${fmt(l.bytes_per_edit)} | ${l.sync_s} | ${fmt(l.edits_per_s)} | ${l.link_share ?? '–'} | ${l.resent_ratio} | ${l.live_busy_p50_ms} / ${l.live_busy_p95_ms} | ${l.live_idle_p50_ms} / ${l.live_idle_p95_ms} | ${l.live_missed} | ${l.peak_kib ? Math.round(l.peak_kib / 1024) : '–'} |`));
 const writes = bench.filter(b => b.kind === 'writes');
 if (writes.length) rows.push('', '| a write behind a busy Lab | rounds | p50 ms | p95 ms | max ms | reads run before it |', '|---|---|---|---|---|---|',
  ...writes.map(x => `| ${x.turn_ms} ms slice + ${x.reads_queued} reads of ${x.turn_ms} ms | ${x.rounds} | ${x.write_p50_ms} | ${x.write_p95_ms} | ${x.write_max_ms} | ${x.writes_behind_a_read} |`));
 const phones = bench.filter(b => b.kind === 'phone');
 if (phones.length) rows.push('', '| phone class (WebAssembly) | edits | bytes/edit | verified | signatures/s | held | taken/s |', '|---|---|---|---|---|---|---|',
  ...phones.map(p => `| ${p.engine} ${p.version} | ${fmt(p.edits)} | ${fmt(p.bytes_per_edit)} | ${fmt(p.verified)} | ${fmt(p.verify_per_s)} | ${fmt(p.held)} | ${fmt(p.intake_per_s)} |`));
 if (first.length) rows.push('', '| first sync edits | batched s | one asking s | × |', '|---|---|---|---|', ...first.map(f => `| ${fmt(f.n)} | ${f.batched_s} | ${f.one_asking_s} | ${f.speedup} |`));
 return rows.join('\n');
}

// The gates with only shard `--shard`'s runs required present (the bench job's shards, avendb-checks.yml).
function shardOf(gates) {
 const at = process.argv.indexOf('--shard');
 if (at < 0) return gates;
 const shard = process.argv[at + 1];
 const keep = { core: ['sizes', 'first_sync'], carriers: ['carriers'], live: ['live_links', 'writes_runs'] }[shard];
 if (!keep) throw new Error(`--shard ${shard}: none of core, carriers, live`);
 const out = { ...gates };
 for (const k of ['sizes', 'first_sync', 'carriers', 'live_links', 'writes_runs']) if (!keep.includes(k)) out[k] = [];
 return out;
}

if (import.meta.main) {
 const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--shard');
 const [benchFile, pgFile] = args;
 const bench = lines(readFileSync(benchFile, 'utf8'), 'BENCH');
 const pg = pgFile ? lines(readFileSync(pgFile, 'utf8'), 'PG') : [];
 const gates = JSON.parse(readFileSync(gatesFile, 'utf8'));
 const phoneOnly = process.argv.includes('--phone');
 const results = process.argv.includes('--index') ? checkIndex(bench, gates)
  : process.argv.includes('--posts') ? checkPosts(bench, gates)
  : phoneOnly ? check(bench, { ...gates, sizes: [], first_sync: [], carriers: [] }).filter(r => !r.gate) : check(bench, shardOf(gates), pg);
 const text = report(bench, pg, results);
 console.log(text);
 if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## avenDB bench\n\n${text}\n`);
 const failed = results.filter(r => r.gate && !r.ok);
 for (const f of failed) console.log(`::error::avenDB bench: ${f.name} is ${fmt(f.value)}, the gate ${f.limit} (avendb/bench-gates.json)`);
 process.exit(failed.length ? 1 : 0);
}
