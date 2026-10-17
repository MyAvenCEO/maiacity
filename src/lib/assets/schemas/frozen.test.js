// @ts-nocheck — plain JS
// Phase 10 of the asset pipeline: the asset schemas are frozen by version and hash (./schemas.json), as the engines
// are (../engines.json). A schema's bytes never change: a change is a new version, a file and an entry of its own.
// Run: bun test src/lib/assets/schemas/frozen.test.js
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ASSET, CARD, SCHEMAS } from './index.js';

const HERE = new URL('./', import.meta.url).pathname;
const ROOT = new URL('../../../../', import.meta.url).pathname;
const FILE = /^([a-z][a-z-]*)\.v([1-9][0-9]*)\.json$/;

const bytesOf = (s) => readFileSync(`${HERE}${s.name}.v${s.v}.json`);
const hashOf = (bytes) => bytesToHex(blake3(bytes));
const latest = (name) => SCHEMAS.filter((s) => s.name === name).at(-1);

test('every frozen schema is the bytes its hash names, its versions in order from 1, none taken out', () => {
	expect(SCHEMAS.length).toBeGreaterThan(1);
	const seen = {};
	for (const s of SCHEMAS) {
		expect(s.v).toBe((seen[s.name] ?? 0) + 1);
		seen[s.name] = s.v;
		const bytes = bytesOf(s);
		const now = hashOf(bytes);
		if (now !== s.blake3 || bytes.length !== s.bytes)
			throw new Error(`${s.name}.v${s.v}.json changed since it was frozen (${now.slice(0, 12)}…, ${bytes.length} bytes, not ${s.blake3.slice(0, 12)}…, ${s.bytes}): undo the change, or write it as ${s.name}.v${s.v + 1}.json and freeze that in schemas.json`);
		expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(s.note.length).toBeGreaterThan(10);
		const schema = JSON.parse(bytes.toString('utf8'));
		expect(schema.title).toBe(s.title);
		expect(s.title.endsWith(`, v${s.v}`)).toBe(true);
	}
});

test('no schema file here is left unfrozen', () => {
	const files = readdirSync(HERE).filter((f) => f.endsWith('.json') && f !== 'schemas.json');
	for (const f of files) {
		const m = FILE.exec(f);
		if (!m) throw new Error(`${f}: a schema is named <name>.v<n>.json`);
		const s = SCHEMAS.find((x) => x.name === m[1] && x.v === Number(m[2]));
		if (!s) throw new Error(`${f} is not frozen: add it to schemas.json, its hash ${hashOf(readFileSync(`${HERE}${f}`))} and ${readFileSync(`${HERE}${f}`).length} bytes`);
	}
	expect(files.length).toBe(SCHEMAS.length);
});

test('what the checker and avenDB read is the latest frozen version of each', () => {
	expect(JSON.parse(bytesOf(latest('asset')).toString('utf8'))).toEqual(ASSET);
	expect(JSON.parse(bytesOf(latest('card')).toString('utf8'))).toEqual(CARD);
	// a card says which version of its schema it fits; an asset entry is of the kind its schema names
	expect(CARD.properties.v.const).toBe(latest('card').v);
	expect(ASSET.properties.kind.const).toBe('asset');
	// avenDB's own test reads the asset schema from these very bytes, with avenDB's parser (read here, never changed)
	const avendb = readFileSync(`${ROOT}avendb/crates/avendb/tests/assets.rs`, 'utf8');
	expect(avendb).toContain(`src/lib/assets/schemas/asset.v${latest('asset').v}.json`);
});
