// @ts-nocheck — plain JS
// The scripts our pages may run (./policy.js `pageCsp`, every page's <meta>; vault/app/tauri.conf.json, theOS's
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
	'theOS’s': Object.fromEntries(
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

test('theOS runs the same scripts as the page', () => {
	expect([...POLICIES['theOS’s']['script-src']].sort()).toEqual([...POLICIES['the page’s']['script-src']].sort());
});

describe('the page talks only to our own servers, and posts no form', () => {
	const page = POLICIES['the page’s'];
	test('everything starts from our own origin', () => expect(page['default-src']).toEqual(["'self'"]));
	test('connects only to the hosts it names, no wildcard', () => {
		for (const s of page['connect-src']) expect(s).not.toMatch(/\*|^(https?|wss?):?$/);
		expect(page['connect-src'].filter((s) => /^(https|wss):\/\//.test(s)).sort()).toEqual(['https://api.maia.city', 'https://avendb.maia.city', 'wss://avendb.maia.city']);
	});
	test('a build reaches this machine only from a dev server', () => {
		const dev = pageCsp(sha256, { dev: true })['connect-src'];
		expect(dev.some((s) => s.includes('localhost'))).toBe(true);
		expect(page['connect-src'].some((s) => /localhost:|127\.0\.0\.1/.test(s))).toBe(false);
	});
	test('no form posts anywhere', () => expect(page['form-action']).toEqual(["'none'"]));
});

test('theOS’s policy is never looser than the page’s: every directive the page names, and nothing it does not allow', () => {
	const page = POLICIES['the page’s'];
	const os = POLICIES['theOS’s'];
	for (const [d, sources] of Object.entries(page)) {
		expect(os[d], d).toBeDefined();
		for (const s of os[d]) expect(sources, `${d} ${s}`).toContain(s);
	}
});

const { csp } = await import('./frame.js');
const { viewCsp } = await import('./view-host.js');
const { NEVER, SHUT, frameCsp } = await import('./policy.js');
// the math host's shell (./math-host.js): the shell's own policy, no WebAssembly
const mathShell = await (await import('./math-host.js')).mathShell(async () => '');

describe('every frame of ours is shut the same way (./policy.js frameCsp)', () => {
	const parse = (p) => Object.fromEntries(p.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]));
	const FRAMES = { 'the shell': csp(), 'the logic shell': csp({ wasm: true }), 'the math shell': mathShell.policy, 'a view': viewCsp('n0nce') };
	test('the math shell is the shell, with no WebAssembly', () => expect(mathShell.policy).toBe(csp()));
	for (const [name, policy] of Object.entries(FRAMES))
		test(`${name}: starts from nothing, names every directive it shuts, and never opens a way out`, () => {
			const p = parse(policy);
			expect(p['default-src']).toBe("'none'");
			for (const d of SHUT) expect(p[d], d).toBeDefined();
			for (const d of NEVER) expect(p[d], d).toBe("'none'");
			expect(p['worker-src']).toBe('blob:');
			expect(policy).not.toMatch(/'unsafe-eval'|https?:|\*/);
		});
	test('the shell shows nothing; a view, only pictures, fonts and media from data: and blob:', () => {
		for (const d of ['img-src', 'style-src', 'font-src', 'media-src']) expect(parse(csp())[d]).toBe("'none'");
		expect(parse(viewCsp('n'))['img-src']).toBe('data: blob:');
	});
	test('a frame may not open what none may', () => {
		for (const d of NEVER) expect(() => frameCsp({ script: "'none'", open: { [d]: '*' } })).toThrow(/no frame of ours opens/);
	});
});
