// avenDB's bench beside Postgres (the `bench` job of avendb-checks.yml): the same work as avendb/crates/avendb/tests/
// bench_gates.rs at each size, on the Postgres of DATABASE_URL, printed as `PG {...}` lines for avendb-bench.mjs to set
// beside avenDB's numbers. Nothing here is gated: Postgres is the yardstick, not the subject.
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres bun scripts/ci/avendb-bench-pg.mjs 10000,100000
//
// The work, for N edits over max(N/50, 200) entries of 16 types:
//   insert   every edit, 1,000 rows to a statement (`insert_per_s`), and 2,000 more a statement each, each its own
//            commit, as avenDB takes a device's own writes one at a time (`single_insert_per_s`)
//   read     an entry's last edit, by the index on (entry, id): 20,000 at random entries, over one connection
//   view     the entries of one type, by the index on (ty, entry), each with its last edit, at most 512
import { SQL } from 'bun';

const READS = 20_000, VIEWS = 400, TYPES = 16, BATCH = 1_000, SINGLES = 2_000;

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(s.length * p) - 1)]; };
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;
const now = () => Number(process.hrtime.bigint()) / 1e3; // microseconds

// the same deterministic draws as the Rust bench's (an LCG), so both ask about alike entries
function lcg(seed) {
 let s = BigInt(seed);
 return () => { s = (s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn; return Number(s >> 33n); };
}

export async function bench(sql, n) {
 const entries = Math.max(Math.floor(n / 50), 200);
 await sql`DROP TABLE IF EXISTS bench_edits, bench_entries`;
 await sql`CREATE TABLE bench_entries (entry bigint PRIMARY KEY, ty int NOT NULL)`;
 await sql`CREATE INDEX bench_entries_ty ON bench_entries (ty, entry)`;
 await sql`CREATE TABLE bench_edits (id bigserial PRIMARY KEY, entry bigint NOT NULL, n bigint NOT NULL, body bytea NOT NULL)`;
 await sql`CREATE INDEX bench_edits_entry ON bench_edits (entry, id)`;
 for (let i = 0; i < entries; i += BATCH) {
  const rows = [];
  for (let j = i; j < Math.min(entries, i + BATCH); j++) rows.push({ entry: 1000 + j, ty: j % TYPES });
  await sql`INSERT INTO bench_entries ${sql(rows)}`;
 }
 const body = k => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(k)); return b; };
 const edit = k => ({ entry: 1000 + Number((BigInt(k) * 7919n) % BigInt(entries)), n: k, body: body(k) });
 let t = now();
 for (let k = 0; k < n; k += BATCH) {
  const rows = [];
  for (let j = k; j < Math.min(n, k + BATCH); j++) rows.push(edit(j));
  await sql`INSERT INTO bench_edits ${sql(rows)}`;
 }
 const insertS = (now() - t) / 1e6;
 t = now();
 for (let k = n; k < n + SINGLES; k++) { const e = edit(k); await sql`INSERT INTO bench_edits (entry, n, body) VALUES (${e.entry}, ${e.n}, ${e.body})`; }
 const singleS = (now() - t) / 1e6;
 await sql`VACUUM ANALYZE bench_edits`;
 await sql`ANALYZE bench_entries`;
 const [{ bytes }] = await sql`SELECT pg_total_relation_size('bench_edits') + pg_total_relation_size('bench_entries') AS bytes`;

 const next = lcg(42), reads = [];
 for (let i = 0; i < READS; i++) {
  const e = 1000 + next() % entries;
  const t0 = now();
  await sql`SELECT id, n, body FROM bench_edits WHERE entry = ${e} ORDER BY id DESC LIMIT 1`;
  reads.push(now() - t0);
 }
 const views = [];
 let rows = 0;
 for (let q = 0; q < VIEWS; q++) {
  const t0 = now();
  const page = await sql`SELECT e.entry, w.n FROM bench_entries e CROSS JOIN LATERAL
   (SELECT n FROM bench_edits x WHERE x.entry = e.entry ORDER BY x.id DESC LIMIT 1) w
   WHERE e.ty = ${q % TYPES} ORDER BY e.entry LIMIT 512`;
  views.push(now() - t0);
  rows = Math.max(rows, page.length);
 }
 await sql`DROP TABLE bench_edits, bench_entries`;
 return {
  kind: 'pg', n, entries,
  insert_s: round(insertS, 3), insert_per_s: Math.round(n / insertS), single_insert_per_s: Math.round(SINGLES / singleS),
  bytes_per_edit: Math.round(Number(bytes) / n),
  read_p50_us: round(pct(reads, 0.5), 1), read_p95_us: round(pct(reads, 0.95), 1),
  view_rows: rows, view_p50_us: round(pct(views, 0.5), 1), view_p95_us: round(pct(views, 0.95), 1),
 };
}

if (import.meta.main) {
 const sizes = (process.argv[2] ?? '10000').split(',').map(Number);
 const sql = new SQL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres', { max: 1 });
 const [{ version }] = await sql`SHOW server_version`.then(r => r.map(x => ({ version: x.server_version })));
 console.log(`PGVERSION ${version}`);
 for (const n of sizes) console.log(`PG ${JSON.stringify(await bench(sql, n))}`);
 await sql.close();
}
