// aven-id's wasm against Lean's vectors (id/spec/vectors/trees.json, README rule 10): every tree the model answers for
// is read as a cast, asked the same queries, and must answer as the model does; every one it refuses, the wasm must
// refuse. No expected value is written here. Runs in the box after build.sh, from aven/DB2:
// `bun run box bun id/core/wasm/check.mjs`.
import { readFileSync } from 'node:fs';
import { Cast, initSync } from '../../../target/wasm/aven-id/aven_id.js';

initSync({ module: readFileSync(new URL('../../../target/wasm/aven-id/aven_id_bg.wasm', import.meta.url)) });
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const vectors = read('../../spec/vectors/trees.json');
const castFile = read('../../../sandbox/cast.json');
// the model knows keys by id; a cast needs each one's public half, so every key gets a real one
const someKey = Object.values(castFile.keys)[0];

// A vector's tree as a cast. A cast's vaults are an object, so a tree with two vaults of one id has no cast.
function asCast({ keys, vaults }) {
	if (new Set(vaults.map((v) => v.id)).size !== vaults.length) return null;
	return JSON.stringify({
		keys: Object.fromEntries(keys.map((k) => [k, someKey])),
		vaults: Object.fromEntries(vaults.map((v) => [v.id, { kind: v.kind, owners: v.owners }])),
	});
}
const ask = (cast, [query, ...args]) => cast[query](...args.map((a) => a ?? undefined)) ?? null;

const problems = [];
let answered = 0;
let refused = 0;
let skipped = 0;
for (const { name, input, expected } of vectors) {
	const json = asCast(input);
	if (json === null) {
		skipped++;
		continue;
	}
	let cast;
	try {
		cast = new Cast(json);
	} catch (e) {
		if (expected.wf) problems.push(`${name}: refused (${e.message}), but the model answers for it`);
		else refused++;
		continue;
	}
	if (!expected.wf) {
		problems.push(`${name}: read, but the model refuses it: ${JSON.stringify(expected.invalid ?? expected.format)}`);
		continue;
	}
	input.queries.forEach((q, i) => {
		const got = ask(cast, q);
		if (JSON.stringify(got) !== JSON.stringify(expected.answers[i]))
			problems.push(`${name}: ${JSON.stringify(q)} is ${JSON.stringify(got)}, not ${JSON.stringify(expected.answers[i])}`);
		answered++;
	});
}
// what the wasm reads back from the cast's file is the file's: names and public halves aren't the model's
const cast = new Cast(JSON.stringify(castFile));
for (const [id, vault] of Object.entries(castFile.vaults))
	if (cast.name(id) !== vault.name) problems.push(`${id}'s name reads as ${cast.name(id)}, not the cast's ${vault.name}`);
for (const [id, key] of Object.entries(castFile.keys)) if (cast.key(id) !== key) problems.push(`${id}'s key reads back as another`);

console.log(
	problems.length
		? problems.slice(0, 20).join('\n')
		: `aven-id wasm: ${answered} answers and ${refused} refusals agree with the model (${skipped} trees no cast can write)`,
);
process.exit(problems.length ? 1 : 0);
