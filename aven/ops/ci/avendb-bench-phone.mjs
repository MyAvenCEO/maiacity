// The phone-class row of avenDB's bench, by hand (out of CI since Goal 7a W1): avenDB's device as WebAssembly
// in a browser, as an iPhone's page runs it, taking a peer's signed edits with their signatures checked
// (avendb-browser's `bench` feature, src/bench.rs). Serves the package wasm-bindgen wrote and the fixture
// (aven/db/crates/avendb/tests/all/phone_fixture.rs) on this machine, opens them in each browser named, and prints a
// `BENCH {...}` line (`kind: "phone"`) for each. Synthetic data only; only numbers are printed.
//
//   bun aven/ops/ci/avendb-bench-phone.mjs <pkg dir> <fixture> chromium,webkit
//
// AVENDB_TEST_PLAYWRIGHT names the Playwright to drive, else the repository's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = 600;

export async function run(pkg, fixture, engines, playwright) {
 const files = {
  '/': ['text/html', '<!doctype html><meta charset="utf-8"><title>avenDB phone bench</title>'],
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
    const line = await page.evaluate(async size => {
     const avendb = await import('/avendb_browser.js');
     await avendb.default();
     const fixture = new Uint8Array(await (await fetch('/fixture.bin')).arrayBuffer());
     const edits = avendb.benchCount(fixture);
     let t = performance.now();
     const verified = avendb.benchVerify(fixture);
     const verifyS = (performance.now() - t) / 1000;
     t = performance.now();
     const held = avendb.benchIntake(fixture, size);
     const intakeS = (performance.now() - t) / 1000;
     return { edits, bytes: fixture.length, verified, verify_s: verifyS, held, intake_s: intakeS };
    }, PAGE);
    const round = (x, p) => Math.round(x * 10 ** p) / 10 ** p;
    out.push({ kind: 'phone', engine, edits: line.edits, bytes_per_edit: Math.round(line.bytes / line.edits), verified: line.verified,
     verify_s: round(line.verify_s, 3), verify_per_s: Math.round(line.edits / line.verify_s), held: line.held,
     intake_s: round(line.intake_s, 3), intake_per_s: Math.round(line.edits / line.intake_s), version: browser.version() });
   } finally { await browser.close(); }
  }
 } finally { server.stop(true); }
 return out;
}

if (import.meta.main) {
 const [pkg, fixture, engines = 'chromium'] = process.argv.slice(2);
 const playwright = await import(process.env.AVENDB_TEST_PLAYWRIGHT || 'playwright');
 // one engine at a time, each row printed as it comes, so that one browser that doesn't launch keeps the other's row
 let failed = false;
 for (const engine of engines.split(',')) {
  try {
   for (const line of await run(pkg, fixture, [engine], playwright)) console.log(`BENCH ${JSON.stringify(line)}`);
  } catch (e) { failed = true; console.error(`${engine}: ${e.message}`); }
 }
 if (failed) process.exit(1);
}
