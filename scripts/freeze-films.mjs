#!/usr/bin/env node
// Freezes the two legacy films (src/lib/studio/filmlist.js) into films/legacy/<key>.json: each timeline as the old
// studio has it, its world shots' specs, and the media vault files it plays. Run once on the Mac, signed in to the
// studio app (it reads the app's own session; the key is never printed), while the old studio's API still answers:
//   node scripts/freeze-films.mjs            (MAIACITY_API to ask another API)
// After that the films come back from the repo and the media vault alone (src/lib/studio/frozen.js).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILMS, badFrozen, legacyOf } from '../src/lib/studio/filmlist.js';

const API = process.env.MAIACITY_API ?? 'https://api.maia.city';
const sessions = JSON.parse(readFileSync(join(homedir(), 'Library/Application Support/city.maia.studio/session.json'), 'utf8'));
const key = sessions[API];
if (!key) throw new Error(`The studio app has no session for ${API}: sign in there first.`);

/** @param {string} path */
async function get(path) {
	const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${key}` } });
	if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text().catch(() => '')}`);
	return res.json();
}

const HASH = /^[0-9a-f]{64}$/;
const all = await get('/api/timelines');
mkdirSync('films/legacy', { recursive: true });
for (const f of FILMS) {
	const found = legacyOf(f, all);
	if (!found) {
		console.error(`${f.name}: no timeline "${f.timeline}" of "${f.project}"`);
		process.exitCode = 1;
		continue;
	}
	const timeline = await get(`/api/timelines/${found.id}`);
	/** @type {Record<string, { name: string, project: string | null, spec: any }>} */
	const shots = {};
	const files = new Set();
	for (const c of timeline.clips ?? []) {
		if (c.kind === 'world' && typeof c.shot === 'string' && !c.shot.startsWith('shot:')) {
			const k = `${c.shot}@${c.shotVersion}`;
			if (shots[k]) continue;
			const s = await get(`/api/shots/${c.shot}?version=${c.shotVersion}`);
			shots[k] = { name: s.name, project: s.project ?? null, spec: s.spec };
		} else if (typeof c.hash === 'string' && HASH.test(c.hash)) files.add(c.hash);
	}
	const out = { key: f.key, name: f.name, frozen: new Date().toISOString(), story: { title: f.name, description: timeline.description ?? '' }, timeline, shots, files: [...files] };
	const bad = badFrozen(out);
	if (bad) throw new Error(`${f.name}: ${bad}`);
	writeFileSync(`films/legacy/${f.key}.json`, `${JSON.stringify(out, null, '\t')}\n`);
	console.log(`${f.name}: ${timeline.clips.length} clips, ${Object.keys(shots).length} world shots, ${files.size} files -> films/legacy/${f.key}.json`);
}
