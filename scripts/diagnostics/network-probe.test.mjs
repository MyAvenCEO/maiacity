// Exercises the real standalone page's failure paths with synthetic fetch bodies.
// No browser, network, app session or storage is opened.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../../static/diagnostics/network/index.html', import.meta.url), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function harness(fetch) {
 const elements = new Map();
 const element = () => ({ append() {}, replaceChildren() {}, addEventListener() {}, textContent: '' });
 const context = vm.createContext({
  fetch, AbortController, TextDecoder, URL, Uint8Array, setTimeout, clearTimeout,
  crypto: { randomUUID: () => 'test' }, location: { href: 'https://maia.city/diagnostics/network/' },
  document: { getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, addEventListener() {}, createElement: element },
  performance: { now: () => 100, getEntriesByName: () => [] },
 });
 vm.runInContext(code + '\nreport={results:[]};', context);
 return { context, run: source => vm.runInContext(source, context), report: () => vm.runInContext('report', context) };
}
function response(status, chunks) {
 let at = 0;
 return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, body: { getReader: () => ({ read: async () => at < chunks.length ? { value: chunks[at++], done: false } : { done: true }, cancel: async () => {} }) } };
}

test('inline content still matches its CSP hashes', () => {
 for (const [tag, directive] of [['script', 'script-src'], ['style', 'style-src']]) {
  const content = html.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))[1];
  const hash = createHash('sha256').update(content).digest('base64');
  assert.ok(html.includes(`${directive} 'sha256-${hash}'`));
 }
});

test('missing public file is explicit and never yields a rate', async () => {
 let signal;
 const h = harness(async (_url, init) => { signal = init.signal; return response(404, []); });
 await h.run("measure('maia','/missing.wasm',8)");
 assert.equal(h.report().results[0].complete, false);
 assert.equal(h.report().results[0].mbps, null);
 assert.match(h.report().results[0].error, /HTTP 404/);
 assert.equal(signal.aborted, true);
});

test('range refusal and oversized body abort instead of consuming an unlimited response', async () => {
 for (const [status, bytes, expected] of [[200, 8, /did not honor/], [206, 2048, /byte limit/]]) {
  let signal;
  const h = harness(async (_url, init) => { signal = init.signal; return response(status, [new Uint8Array(bytes)]); });
  await h.run("measure('maia','/file.wasm',8)");
  assert.match(h.report().results[0].error, expected);
  assert.equal(h.report().results[0].complete, false);
  assert.equal(signal.aborted, true);
 }
});

test('stop keeps a partial result without a successful rate', async () => {
 let h;
 h = harness(async () => { h.run('stop()'); throw new Error('Aborted'); });
 await h.run("measure('download','https://speed.cloudflare.com/__down?bytes=8',8)");
 assert.match(h.report().results[0].error, /Stopped/);
 assert.equal(h.report().results[0].mbps, null);
});

test('current manifest selects only a same-origin hashed asset', async () => {
 const manifest = { kind: 'maia.city release v1', commit: 'a'.repeat(40), files: {
  'https://other.example/steal.wasm': 'f'.repeat(64),
  '_app/immutable/assets/avendb_browser_bg.NEW_HASH.wasm': 'f'.repeat(64),
 } };
 const h = harness(async (_url, init) => {
  assert.equal(init.credentials, 'omit');
  return response(200, [new TextEncoder().encode(JSON.stringify(manifest))]);
 });
 assert.equal(await h.run('currentFile()'), '/_app/immutable/assets/avendb_browser_bg.NEW_HASH.wasm');
 assert.equal(h.report().results.length, 0); // discovery bytes are excluded from throughput rows
});

test('oversized manifest and malformed manifest fail closed', async () => {
 for (const [chunks, expected] of [[[new Uint8Array(262145)], /256 KiB/], [[new TextEncoder().encode('{}')], /unexpected format/]]) {
  const h = harness(async () => response(200, chunks));
  await assert.rejects(h.run('currentFile()'), expected);
 }
});

test('embedded check reports the host PWA display mode', () => {
 const h = harness(async () => { throw new Error('no request expected'); });
 h.context.window = { top: { matchMedia: () => ({ matches: true }), navigator: { standalone: false } } };
 assert.equal(h.run('standalone()'), true);
 h.context.window.top.matchMedia = () => ({ matches: false });
 h.context.window.top.navigator.standalone = true;
 assert.equal(h.run('standalone()'), true);
 h.context.window.top.navigator.standalone = false;
 assert.equal(h.run('standalone()'), false);
});

test('cross-origin parent cannot supply a claimed standalone mode', () => {
 const h = harness(async () => { throw new Error('no request expected'); });
 h.context.window = { get top() { throw new Error('cross-origin'); } };
 h.context.matchMedia = () => ({ matches: false });
 h.context.navigator = { standalone: false };
 assert.equal(h.run('standalone()'), false);
});
