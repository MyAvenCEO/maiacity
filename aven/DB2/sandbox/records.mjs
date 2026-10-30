// The record every peer keeps through its store (SANDBOX.md, "Storage"): its first start, a blob and a ref, which each
// peer reports as a `stored` line. Runs in the browsers' container. As a module it reads the newest record of each
// peer since a moment; as a command (`node sandbox/records.mjs <since>`) it opens both Peer-Lights in the check's
// Chromium profile, so they start again on their own OPFS, waits until all four peers have reported since then, and
// prints the records. `bun run up --check` uses it to prove that a restart keeps the record and a wipe empties it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

export const events = process.env.AVENSANDBOX_EVENTS ?? '/events';
export const profile = '/profile';
// the backend each peer keeps its record in: the Aven Peer in the box's S3, Alice Peer in a folder, the Peer-Lights in
// their origins' OPFS
export const stores = { 'aven-peer': 's3', 'alice-peer': 'fs', 'alice-peer-light': 'opfs', 'bob-peer-light': 'opfs' };

// every peer's lines, oldest first
export function lines() {
	const files = existsSync(events) ? readdirSync(events).filter((name) => name.endsWith('.jsonl')) : [];
	return files
		.flatMap((name) => readFileSync(`${events}/${name}`, 'utf8').split('\n'))
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.sort((a, b) => a.t - b.t);
}

// each peer's newest record since `since`: { store, first, blob, kept }
export function records(since = 0) {
	const out = {};
	for (const line of lines())
		if (line.event === 'stored' && line.t >= since && line.peer in stores) out[line.peer] = { store: line.store, first: line.first, blob: line.blob, kept: line.kept };
	return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const since = Number(process.argv[2] ?? 0);
	const context = await chromium.launchPersistentContext(profile);
	for (const origin of ['alice', 'bob']) await (await context.newPage()).goto(`http://${origin}.localhost:5173/`);
	const deadline = Date.now() + 60_000;
	let got = records(since);
	while (Object.keys(got).length < Object.keys(stores).length && Date.now() < deadline) {
		await new Promise((done) => setTimeout(done, 250));
		got = records(since);
	}
	await context.close();
	console.log(JSON.stringify(got));
}
