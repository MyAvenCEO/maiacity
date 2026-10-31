// The runtime host in the browser (aven/runtimes, README, "The browser host"), in all three of Playwright's engines,
// in the browsers' container (`bun run up --check`), on the box's own view. Checked:
//   1. every slide's part (brain/*/slides/<id>.part.json) goes through face-runtime in the runtimes worker, by its
//      frozen hash, and is accepted; the three engines give the same answer, byte for byte;
//   2. a part that isn't a face is face-runtime's `refused`, and a runtime nobody froze isn't run;
//   3. the host loads a module only by a hash the manifest lists and only when the bytes are the hash's: another
//      module's bytes, one flipped byte and an unlisted hash are refused.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';

const run = process.argv[2] ?? 'runs/latest';
mkdirSync(run, { recursive: true });
const parts = readdirSync('brain', { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.flatMap((d) => {
		try {
			return readdirSync(`brain/${d.name}/slides`).filter((f) => f.endsWith('.part.json')).map((f) => [`${d.name}/${f}`, JSON.parse(readFileSync(`brain/${d.name}/slides/${f}`, 'utf8'))]);
		} catch {
			return [];
		}
	});

const report = {};
const answers = {};
let failed = false;
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit], ['firefox', firefox]]) {
	const started = Date.now();
	const problems = [];
	const browser = await type.launch();
	const page = await browser.newPage();
	await page.goto('http://localhost:5173/');
	const got = await page.evaluate(async (parts) => {
		const { runtime } = await import('/runtimes/runtimes.js');
		const tell = (p) => p.then((v) => ({ ok: JSON.stringify(v) }), (e) => ({ error: String(e.message) }));
		const slides = {};
		for (const [name, part] of parts) slides[name] = await tell(runtime('face-runtime', part, {}));
		const notFace = await tell(runtime('face-runtime', ['not', 'a', 'face'], {}));
		const nobody = await tell(runtime('no-runtime', [], {}));
		// the host itself, on the page: what it loads and what it refuses
		const web = await import('/runtimes/aven_runtimes_web.js');
		await web.default();
		const face = web.runtime_hash('face-runtime');
		const markdown = web.runtime_hash('markdown-runtime');
		const bytes = async (h) => new Uint8Array(await (await fetch(`/runtimes/frozen/${h.slice(3)}.wasm`)).arrayBuffer());
		const load = (h, b) => {
			try {
				web.runtime_load(h, b);
				return 'loaded';
			} catch (e) {
				return String(e.message);
			}
		};
		const flipped = await bytes(face);
		flipped[flipped.length - 1] ^= 1;
		return {
			slides,
			notFace,
			nobody,
			other: load(face, await bytes(markdown)),
			flipped: load(face, flipped),
			unlisted: load(`b3:${'0'.repeat(64)}`, await bytes(face)),
			own: load(face, await bytes(face)),
		};
	}, parts);
	await browser.close();
	for (const [name, a] of Object.entries(got.slides)) if (!a.ok) problems.push(`${name}: ${a.error}`);
	if (got.notFace.error !== 'face-runtime: refused') problems.push(`a part that isn't a face: ${JSON.stringify(got.notFace)}`);
	if (!got.nobody.error?.includes('no runtime')) problems.push(`a runtime nobody froze: ${JSON.stringify(got.nobody)}`);
	if (!got.other.includes('WrongBytes')) problems.push(`another module's bytes: ${got.other}`);
	if (!got.flipped.includes('WrongBytes')) problems.push(`a flipped byte: ${got.flipped}`);
	if (!got.unlisted.includes('NotListed')) problems.push(`an unlisted hash: ${got.unlisted}`);
	if (got.own !== 'loaded') problems.push(`face-runtime's own bytes: ${got.own}`);
	answers[engine] = createHash('sha256').update(JSON.stringify(got.slides)).digest('hex');
	report[engine] = { problems, slides: parts.length, answers: answers[engine], ms: Date.now() - started };
	if (problems.length) failed = true;
	console.log(`runtimes, ${engine}: ${problems.length ? `${problems.length} problems: ${problems.slice(0, 5).join('; ')}` : `${parts.length} slides through face-runtime by its hash, and every refusal`}`);
}
if (new Set(Object.values(answers)).size !== 1) {
	failed = true;
	console.log(`runtimes: the engines' answers differ: ${JSON.stringify(answers)}`);
}
writeFileSync(`${run}/runtimes.json`, JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
