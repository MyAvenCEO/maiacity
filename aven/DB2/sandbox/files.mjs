// A file's way through the box (store/README.md, "How it is checked"), by `bun run up --check` in the browsers'
// container, in two phases the host runs around stopping Alice Peer:
//
//   node sandbox/files.mjs seek <run> <since> <sha>    Alice Peer shared a 200 MiB file (its `shared` line since
//                                                      <since>); Bob's Peer-Light seeks to its middle, fetching from
//                                                      Alice: 64 KiB whose SHA-256 is <sha>, having fetched less than a
//                                                      quarter of the file; then the Aven Peer has kept it (`kept`)
//   node sandbox/files.mjs whole <run> <since> <sha>   Alice Peer is gone: Bob's Peer-Light fetches the whole file from
//                                                      the Aven Peer, only what it lacks, and reads the middle again
//
// Bob's Peer-Light runs here in a page of its own on Bob's origin, in a dedicated worker it starts from the Peer-Light's
// wasm, after the main check has closed Bob's tab (one key, one Peer-Light). It calls the Peer-Light's file API
// directly: `file_range` and `file_fetch` (peer/light/src/lib.rs), the same exports the chat's Service Worker will call
// through the opfs leader to answer `/files/<hash>`. Bob's OPFS keeps what the first phase fetched for the second.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { lines, profile } from './records.mjs';

const [phase, run = 'runs/latest', sinceArg = '0', sha = ''] = process.argv.slice(2);
const since = Number(sinceArg);
mkdirSync(run, { recursive: true });
const cast = JSON.parse(readFileSync(new URL('./cast.json', import.meta.url), 'utf8'));
const seed = (id) => createHash('sha256').update(`avenSANDBOX test signer: ${id}`).digest('hex');
const members = Object.keys(cast.peers).map((id) => `${id}=${cast.keys[id]}`).join(',');
const origin = 'http://bob.localhost:5173';
const size = 200 * 1024 * 1024;
const middle = size / 2;
const span = 64 * 1024;
const problems = [];
const report = { phase };
const started = Date.now();

async function waitLine(want, ms) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		const found = lines().find((l) => l.t >= since && want(l));
		if (found) return found;
		await new Promise((done) => setTimeout(done, 500));
	}
	return null;
}

const shared = await waitLine((l) => l.peer === 'alice-peer' && l.event === 'shared' && l.name === 'movie.mp4', 180_000);
if (!shared) problems.push("Alice Peer didn't share movie.mp4");
else if (shared.size !== size) problems.push(`Alice Peer shared ${shared.size} bytes, not ${size}`);

// Bob's Peer-Light, in a worker of this page: its wasm, started as the Peer-Light's own worker starts it, every
// timeline line posted to the box, and the file API answered by message
const worker = `
let light;
onmessage = async ({ data: { id, call, args } }) => {
	try {
		let result;
		if (call === 'start') {
			light = await import(self.location.origin + '/peer-light/aven_peer_light.js');
			await light.default();
			const tell = (line) => fetch('/events/' + JSON.parse(line).peer, { method: 'POST', body: line }).catch(() => {});
			result = await light.start(args.name, args.secret, self.location.origin, args.avenKey, 'aven-peer', tell, args.members, null);
		} else if (call === 'file_range') {
			const got = await light.file_range(...args);
			const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', got.bytes));
			const sha = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
			result = { sha, length: got.bytes.length, len: got.len, fetched: got.fetched };
		} else {
			const got = await light[call](...args);
			result = { len: got.len, fetched: got.fetched, chunks: got.chunks };
		}
		postMessage({ id, result });
	} catch (error) {
		postMessage({ id, error: String(error?.message ?? error) });
	}
};`;

const context = await chromium.launchPersistentContext(profile);
const page = await context.newPage();
// any page of Bob's origin will do: the Peer-Light's own script, as text
await page.goto(`${origin}/peer-light/aven_peer_light.js`);
await page.evaluate((source) => {
	const w = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' });
	const waiting = new Map();
	let next = 0;
	w.onmessage = ({ data }) => {
		const done = waiting.get(data.id);
		waiting.delete(data.id);
		if (data.error) done.reject(new Error(data.error));
		else done.resolve(data.result);
	};
	window.call = (call, args) =>
		new Promise((resolve, reject) => {
			const id = next++;
			waiting.set(id, { resolve, reject });
			w.postMessage({ id, call, args });
		});
}, worker);
const call = (name, args) => page.evaluate(([n, a]) => window.call(n, a), [name, args]);
// a call tried again while the Peer-Light's relay comes up, for up to 30 s
async function retried(name, args) {
	const deadline = Date.now() + 30_000;
	for (;;) {
		try {
			return await call(name, args);
		} catch (error) {
			if (Date.now() > deadline) throw error;
			await new Promise((done) => setTimeout(done, 1000));
		}
	}
}

try {
	if (shared) {
		await call('start', { name: 'bob-peer-light', secret: seed('bob-peer-light'), avenKey: cast.keys['aven-peer'], members });
		if (phase === 'seek') {
			// a seek to the middle, from Alice: the index and the chunk the 64 KiB lie in, nothing else
			const t = Date.now();
			const got = await retried('file_range', [shared.file, middle, middle + span, cast.keys['alice-peer']]);
			report.seek = { ...got, ms: Date.now() - t };
			if (got.length !== span) problems.push(`the seek read ${got.length} bytes, not ${span}`);
			if (got.sha !== sha) problems.push(`the middle's 64 KiB aren't Alice's: ${got.sha}, not ${sha}`);
			if (!(got.fetched < size / 4)) problems.push(`the seek fetched ${got.fetched} bytes, not less than a quarter of ${size}`);
			// the Aven Peer keeps the file it heard announced, before Alice goes
			const kept = await waitLine((l) => l.peer === 'aven-peer' && l.event === 'kept' && l.file === shared.file, 180_000);
			report.kept = kept;
			if (!kept) problems.push("the Aven Peer didn't keep the file");
		} else if (phase === 'whole') {
			// Alice is gone: the whole file from the Aven Peer, only what Bob lacks, then the middle read from Bob's OPFS
			const t = Date.now();
			const whole = await retried('file_fetch', [shared.file, null]);
			report.whole = { ...whole, ms: Date.now() - t, MBps: Math.round(whole.fetched / 1e3 / (Date.now() - t)) };
			if (whole.len !== size) problems.push(`the file is ${whole.len} bytes, not ${size}`);
			if (!(whole.fetched > 0 && whole.fetched < size)) problems.push(`the whole file fetched ${whole.fetched} bytes, not the ${size} less what the seek held`);
			const again = await call('file_range', [shared.file, middle, middle + span, null]);
			report.again = again;
			if (again.sha !== sha || again.fetched !== 0) problems.push(`the middle read again: ${JSON.stringify(again)}`);
			// the Service Worker's bridge (peer/bridge.js): Alice's own page leads her Peer-Light, and the middle comes over
			// its BroadcastChannel as the Service Worker will ask for it, from the Aven Peer; a file nobody has is "not found"
			const page = await context.newPage();
			await page.goto('http://alice.localhost:5173/#/alice');
			await page.locator('[data-testid="status"][data-phase="live"]').waitFor({ timeout: 30_000 });
			report.bridge = await page.evaluate(
				async ({ file, middle, span }) => {
					const { read } = await import('/peer/bridge.js');
					const t = Date.now();
					const got = await read('alice-peer-light', file, middle, middle + span);
					const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', got.bytes));
					const missing = await read('alice-peer-light', '0'.repeat(64), 0, 10).then(() => 'answered', (e) => e.message);
					return { sha: [...digest].map((b) => b.toString(16).padStart(2, '0')).join(''), length: got.bytes.length, size: got.size, ms: Date.now() - t, missing };
				},
				{ file: shared.file, middle, span },
			);
			if (report.bridge.sha !== sha || report.bridge.size !== size) problems.push(`the bridge read: ${JSON.stringify(report.bridge)}`);
		} else problems.push(`unknown phase ${phase}`);
	}
} catch (error) {
	problems.push(`${phase}: ${error.message}`);
}
await context.close();

report.problems = problems;
report.ms = Date.now() - started;
writeFileSync(`${run}/files-${phase}.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`files: ${problem}`);
if (!problems.length) console.log(`files: ${phase} ${JSON.stringify(report.seek ?? report.whole)}`);
process.exit(problems.length ? 1 : 0);
