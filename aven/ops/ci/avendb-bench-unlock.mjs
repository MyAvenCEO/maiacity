// The iPhone's unlock as WebAssembly in a browser (avendb-browser's `bench` feature, src/bench.rs `benchUnlock`): the
// device of aven/db/crates/avendb/tests/unlock_phone.rs opening again from what its shelf holds. The fixture goes into
// the page's OPFS first and is read back from there, as a page reads its shelf, then the device restores from it. Prints
// an `UNLOCK {...}` line per browser: the OPFS read, the restore, and the restore split as the native probe splits it.
// Synthetic data only; only numbers are printed.
//
//   UNLOCK_PHONE_FIXTURE=/tmp/unlock.bin cargo test --release -p avendb --test unlock_phone -- --ignored --nocapture
//   cargo build -p avendb-browser --target wasm32-unknown-unknown --release --features bench
//   wasm-bindgen --target web --no-typescript --out-dir /tmp/pkg target/wasm32-unknown-unknown/release/avendb_browser.wasm
//   bun aven/ops/ci/avendb-bench-unlock.mjs /tmp/pkg /tmp/unlock.bin chromium
//
// AVENDB_TEST_PLAYWRIGHT names the Playwright to drive, else the repository's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SPLIT = { derive_ms: 'keys: derive', open_keys_ms: 'open keys', read_ms: 'read', show_items_ms: 'show items',
 open_kept_shown_ms: 'open kept shown', refresh_ms: 'refresh', check_ms: 'check' };

export async function run(pkg, fixture, engines, playwright) {
 const files = {
  '/': ['text/html', '<!doctype html><meta charset="utf-8"><title>avenDB unlock bench</title>'],
  '/fixture.bin': ['application/octet-stream', readFileSync(fixture)],
  '/avendb_browser.js': ['text/javascript', readFileSync(join(pkg, 'avendb_browser.js'))],
  '/avendb_browser_bg.wasm': ['application/wasm', readFileSync(join(pkg, 'avendb_browser_bg.wasm'))],
 };
 const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(req) {
  const file = files[new URL(req.url).pathname];
  return file ? new Response(file[1], { headers: { 'content-type': file[0] } }) : new Response('not here', { status: 404 });
 } });
 const out = [];
 try {
  for (const engine of engines) {
   const browser = await playwright[engine].launch();
   try {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') console.error(`${engine}: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    const line = await page.evaluate(async () => {
     const avendb = await import('/avendb_browser.js');
     await avendb.default();
     const bytes = new Uint8Array(await (await fetch('/fixture.bin')).arrayBuffer());
     const root = await navigator.storage.getDirectory();
     const handle = await root.getFileHandle('unlock-shelf.bin', { create: true });
     const w = await handle.createWritable();
     await w.write(bytes);
     await w.close();
     let t = performance.now();
     const shelf = new Uint8Array(await (await handle.getFile()).arrayBuffer());
     const opfsMs = performance.now() - t;
     t = performance.now();
     const perf = JSON.parse(avendb.benchUnlock(shelf));
     const restoreMs = performance.now() - t;
     await root.removeEntry('unlock-shelf.bin');
     return { bytes: shelf.length, opfs_read_ms: opfsMs, restore_ms: restoreMs, timers: perf.timers, counts: perf.counts };
    });
    const round = x => Math.round(x * 10) / 10;
    const split = Object.fromEntries(Object.entries(SPLIT).map(([k, t]) => [k, round(line.timers[t]?.total_ms ?? 0)]));
    out.push({ engine, bytes: line.bytes, opfs_read_ms: round(line.opfs_read_ms), restore_ms: round(line.restore_ms), ...split,
     edits: line.counts['edits offered'] ?? 0, version: browser.version() });
   } finally { await browser.close(); }
  }
 } finally { server.stop(true); }
 return out;
}

if (import.meta.main) {
 const [pkg, fixture, engines = 'chromium'] = process.argv.slice(2);
 const playwright = await import(process.env.AVENDB_TEST_PLAYWRIGHT || 'playwright');
 let failed = false;
 for (const engine of engines.split(',')) {
  try {
   for (const line of await run(pkg, fixture, [engine], playwright)) console.log(`UNLOCK ${JSON.stringify(line)}`);
  } catch (e) { failed = true; console.error(`${engine}: ${e.message}`); }
 }
 if (failed) process.exit(1);
}
