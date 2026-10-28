// Packs what a page needs to check an AIP objective with Lean's WebAssembly build, from a Lean install made with
// build.sh: lean.js, lean.wasm, and one bundle of the files Lean reads (Init's .olean files and the spec's
// AvenDB/Objective.olean, which this compiles with the WebAssembly Lean itself, so its .olean is 32-bit like Init's).
//
//   node scripts/lean-wasm/pack.mjs <lean install dir> <out dir>
//
// The out dir then holds lean.js, lean.wasm, bundle.json, bundle.bin, objectives.json and probe.html: serve it with
// serve.mjs and open probe.html.

import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, unbundle } from './run.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const [install, out] = process.argv.slice(2);
if (!install || !out) {
	console.error('usage: node scripts/lean-wasm/pack.mjs <lean install dir> <out dir>');
	process.exit(2);
}
mkdirSync(out, { recursive: true });

// the Init library, as Lean's own import of it reads it (every .olean* beside Init.olean)
const lib = join(install, 'lib/lean');
const files = [];
const walk = (dir) => {
	for (const name of readdirSync(dir).sort()) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p);
		else if (/\.olean(\.\w+)?$/.test(name)) files.push({ path: '/lean/' + relative(lib, p), bytes: readFileSync(p) });
	}
};
for (const name of readdirSync(lib)) if (/^Init\.olean/.test(name)) files.push({ path: '/lean/' + name, bytes: readFileSync(join(lib, name)) });
walk(join(lib, 'Init'));

const createLean = createRequire(import.meta.url)(join(install, 'bin/lean.js'));
const module = await WebAssembly.compile(readFileSync(join(install, 'bin/lean.wasm')));
const objective = readFileSync(join(repo, 'avendb/spec/AvenDB/Objective.lean'));
const init = new Map(files.map((f) => [f.path, f.bytes]));
init.set('/obj/AvenDB/Objective.lean', objective);
const compiled = await run({
	createLean,
	module,
	files: init,
	args: ['--json', '-o', '/obj/AvenDB/Objective.olean', '/obj/AvenDB/Objective.lean'],
	leanPath: '/lean:/obj',
	keep: ['/obj/AvenDB/Objective.olean'],
});
console.log('compiled the objective module:', compiled.code, compiled.ms, `${compiled.heapMB} MB`);
if (compiled.code !== 0 || !compiled.kept?.['/obj/AvenDB/Objective.olean']) {
	console.error(compiled.out, compiled.err);
	process.exit(1);
}
files.push({ path: '/obj/AvenDB/Objective.olean', bytes: compiled.kept['/obj/AvenDB/Objective.olean'] });

const index = { lean: '4.35.0', files: files.map((f) => ({ path: f.path, size: f.bytes.length })) };
writeFileSync(join(out, 'bundle.json'), JSON.stringify(index));
writeFileSync(join(out, 'bundle.bin'), Buffer.concat(files.map((f) => f.bytes)));
copyFileSync(join(install, 'bin/lean.js'), join(out, 'lean.js'));
copyFileSync(join(install, 'bin/lean.wasm'), join(out, 'lean.wasm'));
copyFileSync(join(here, 'run.js'), join(out, 'run.js'));
copyFileSync(join(here, 'probe.html'), join(out, 'probe.html'));

// the objectives the probe checks: the spec's real ones, and one Lean must reject
const spec = join(repo, 'avendb/spec/AvenDB/Objectives');
const objectives = readdirSync(spec)
	.filter((n) => n.endsWith('.lean'))
	.sort()
	.map((n) => ({ name: n, lean: readFileSync(join(spec, n), 'utf8'), expect: 'ok' }));
const start = objectives.find((o) => o.name === 'Start.lean');
objectives.push({ name: 'Broken.lean', lean: start.lean.replace('1500)', '"x")'), expect: 'error' });
writeFileSync(join(out, 'objectives.json'), JSON.stringify(objectives));

// the same check the page makes, here, to compare against
unbundle(index, readFileSync(join(out, 'bundle.bin')));
const all = new Map(files.map((f) => [f.path, f.bytes]));
for (const o of objectives) {
	all.set('/work/objective.lean', Buffer.from(o.lean));
	const r = await run({
		createLean,
		module,
		files: all,
		args: ['--json', '-DmaxHeartbeats=200000', '/work/objective.lean'],
		leanPath: '/lean:/obj',
	});
	const got = r.code === 0 ? 'ok' : 'error';
	console.log(`${o.name}: ${got} (expected ${o.expect})`, r.ms, `${r.heapMB} MB`, got === o.expect ? '' : r.out + r.err);
}
const mb = (p) => (statSync(join(out, p)).size / 1048576).toFixed(1);
console.log(`sizes: lean.wasm ${mb('lean.wasm')} MB, lean.js ${mb('lean.js')} MB, bundle.bin ${mb('bundle.bin')} MB (${files.length} files)`);
