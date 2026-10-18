// @ts-nocheck — plain JS
// The render core's lint (plan C5): every three.js renderer, orbit controls and post stack of the app is made in
// src/lib/render, and every raw WebGL context is one of the few listed below. A page mounts a purpose renderer
// (./world.js, ./stage.js, ./preview.js, ./film.js, ./diagram.js); it never makes its own.
// Run: bun test src/lib/render/lint.test.js
import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '../../..');
/** what is read: the app, the code entries (views), the game's rules, the scripts, the API and what is served as is */
const SCAN = ['src', 'code', 'game', 'scripts', 'api', 'static'];
const FILES = /\.(js|mjs|ts|svelte|html)$/;

/** what may not be made outside the core */
const RULES = {
	'new WebGLRenderer': /\bnew\s+(?:[\w$]+\.)*(?:WebGLRenderer|WebGPURenderer)\s*\(/,
	'new OrbitControls': /\bnew\s+(?:[\w$]+\.)*OrbitControls\s*\(/,
	'new EffectComposer': /\bnew\s+(?:[\w$]+\.)*EffectComposer\s*\(/,
	'a raw WebGL context': /\.getContext\(\s*['"`](?:webgl2?|experimental-webgl|webgpu)['"`]/
};

/** Where they may be, each with its owner. A path ending in / is a folder (not read at all). */
const ALLOWED = {
	'src/lib/render/': 'the render core itself',
	'static/engines/': 'the frozen engines, the view engine and the libraries they bundle (three.js among them): frozen, never touched',
	'code/views/': "a view's own script, drawing on its own canvas in the view host's frame (plan 4.4: the view's own business; the C2/C4 thread)",
	'code/index.js': 'the views of code/views, bundled (the C4 thread)',
	'src/lib/sandbox/view/libs/': 'what the frozen view engine bundles (the C2 thread)',
	'src/lib/studio/gl.js': "a raw WebGL2 context: the studio's video compositor, not three.js (the studio thread)"
};

/**
 * Lines allowed in a file, each with its owner: AirSup's factory runtime, ported line for line
 * (.claude/skills/factory-skill), makes its renderer, controls and composer as `new T.…`; src/lib/factories/three.js
 * hands out the core's under those names (checked below), so these lines make nothing outside the core.
 */
const AIRSUP = /\bnew T\.(?:WebGLRenderer|OrbitControls|EffectComposer)\(/;
const ALLOWED_LINES = {
	'src/lib/factories/look.js': [AIRSUP, "AirSup's factory runtime (the Factories): T.WebGLRenderer and T.EffectComposer are the core's"],
	'src/lib/factories/app.js': [AIRSUP, "AirSup's factory runtime (the Factories): T.OrbitControls is the core's"]
};

/** a comment line (prose may name the constructors) */
const COMMENT = /^\s*(?:\*|\/\/|\/\*|<!--)/;

const allowed = (path) => Object.keys(ALLOWED).some((a) => (a.endsWith('/') ? path.startsWith(a) : path === a));

function* files(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) yield* files(p);
		else if (FILES.test(e.name) && !/\.test\.[jt]s$/.test(e.name)) yield p;
	}
}

test('every renderer, orbit controls, post stack and WebGL context is made in src/lib/render, or listed with its owner', () => {
	const found = [];
	for (const top of SCAN)
		for (const file of files(join(ROOT, top))) {
			const path = relative(ROOT, file);
			if (allowed(path)) continue;
			const lines = ALLOWED_LINES[path]?.[0];
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					if (COMMENT.test(line) || lines?.test(line)) return;
					for (const [what, re] of Object.entries(RULES)) if (re.test(line)) found.push(`${path}:${i + 1} ${what}`);
				});
		}
	expect(found).toEqual([]);
});

test('the core makes them (so the rule above holds something)', () => {
	const core = readFileSync(join(import.meta.dir, 'core.js'), 'utf8');
	expect(core).toMatch(RULES['new WebGLRenderer']);
	expect(core).toMatch(RULES['new OrbitControls']);
	expect(readFileSync(join(import.meta.dir, 'post.js'), 'utf8')).toMatch(RULES['new EffectComposer']);
});

test("the factories' T hands out the core's renderer, controls and composer under AirSup's names", () => {
	const t = readFileSync(join(ROOT, 'src/lib/factories/three.js'), 'utf8');
	expect(t).toMatch(/import \{ createControls, createRenderer \} from '\$lib\/render\/core\.js'/);
	expect(t).toMatch(/import \{ createComposer \} from '\$lib\/render\/post\.js'/);
	for (const [name, fn] of [['WebGLRenderer', 'WebGLRenderer'], ['EffectComposer', 'Composer'], ['OrbitControls', 'Controls']])
		expect(t).toMatch(new RegExp(`\\n\\t${name}: /\\*\\* @type \\{typeof [\\w.]+\\} \\*/ \\(/\\*\\* @type \\{unknown\\} \\*/ \\(${fn}\\)\\),`));
});

test('every listed exception is still there (one that went comes off the list)', () => {
	for (const path of [...Object.keys(ALLOWED), ...Object.keys(ALLOWED_LINES)]) expect(existsSync(join(ROOT, path)), path).toBe(true);
});
