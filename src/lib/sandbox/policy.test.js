// @ts-nocheck — plain JS
// The scripts our pages may run (./policy.js `pageCsp`, every page's <meta>; vault/app/tauri.conf.json, The OS's
// window): a frame written into the page (the box, the logic host, a view) keeps the page's policy beside its own, so
// both name the one script of each frame by its hash. A frame's script changed without its hash in the policies
// leaves the box and every view unable to start; a policy that lets in inline code it does not name, or eval, lets in
// whatever is injected. The Mac app's policy is the page's, written out by hand: this keeps the two the same.
// Run: bun test src/lib/sandbox/policy.test.js
import { describe, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

mock.module('$app/paths', () => ({ base: '' }));
const { SHELL_SCRIPT, VIEW_SCRIPT, pageCsp } = await import('./policy.js');
const { bootDoc } = await import('./view-host.js');

const ROOT = new URL('../../../', import.meta.url).pathname;
const sha256 = (text) => createHash('sha256').update(text).digest('base64');
const HASHES = [`'sha256-${sha256(SHELL_SCRIPT)}'`, `'sha256-${sha256(VIEW_SCRIPT)}'`];
/** a SvelteKit directive's sources as its <meta> writes them: keywords and hashes quoted */
const quoted = (sources) => sources.map((s) => (/^(self|none|unsafe-[a-z-]+|wasm-unsafe-eval|strict-dynamic|report-sample)$|^(nonce|sha\d{3})-/.test(s) ? `'${s}'` : s));
const POLICIES = {
	'the page’s': Object.fromEntries(Object.entries(pageCsp(sha256)).map(([k, v]) => [k, quoted(v)])),
	'The OS’s': Object.fromEntries(
		Object.entries(JSON.parse(readFileSync(`${ROOT}vault/app/tauri.conf.json`, 'utf8')).app.security.csp).map(([k, v]) => [k, Array.isArray(v) ? v : v.split(/\s+/)])
	)
};

test('a view’s frame runs the script the policies name', () => {
	const doc = bootDoc('key', 'n0nce');
	const open = '<script nonce="n0nce">';
	expect(doc.slice(doc.indexOf(open) + open.length, doc.lastIndexOf('</script>'))).toBe(VIEW_SCRIPT);
});

for (const [whose, policy] of Object.entries(POLICIES))
	describe(`${whose} policy`, () => {
		test('names the box’s and a view’s frame script by its hash (else: its hash, new, in the policy)', () => {
			for (const h of HASHES) expect(policy['script-src']).toContain(h);
		});
		test('runs our own files, WebAssembly and blob: URLs; no inline code it does not name, no eval, no other host', () => {
			expect(policy['script-src']).toEqual(expect.arrayContaining(["'self'", "'wasm-unsafe-eval'", 'blob:']));
			for (const loose of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", 'data:', 'https:', 'http:', '*']) expect(policy['script-src']).not.toContain(loose);
			expect(policy['script-src'].filter((s) => /^https?:\/\//.test(s))).toEqual([]);
			expect(policy['worker-src']).toEqual(["'self'", 'blob:']);
			expect(policy['object-src']).toEqual(["'none'"]);
			expect(policy['base-uri']).toEqual(["'self'"]);
		});
	});

test('The OS runs the same scripts as the page', () => {
	expect([...POLICIES['The OS’s']['script-src']].sort()).toEqual([...POLICIES['the page’s']['script-src']].sort());
});
