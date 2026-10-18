#!/usr/bin/env node
// The repo seed of the Maia City vault (src/lib/avendb/seed.js), as the ops a device would run into a vault that holds
// none of it yet: a count of the pieces and ops by kind, and with a path, every op as JSON, each piece's ops in a list
// of their own, `"$n"` in one naming the entry op n of its piece made. It writes nothing into any vault: the page does
// that (./src/lib/avendb/Account.svelte); avenDB's test `seed` runs these ops through the ops engine. An op that brings
// a file (a recipe's create, a version's put_file) is the op the device takes, its length set as the session's `bring`
// sets it, the file's text left out: the test brings that many bytes beside it, as a node does (`Node::run`).
//
//   node scripts/seed-ops.mjs [vault id, 64 hex] [out.json]
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const [vault = '0'.repeat(64), out] = process.argv.slice(2);
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
	const seed = await server.ssrLoadModule('/src/lib/avendb/seed.js');
	const pieces = seed.seedPieces();
	/** @type {{ key: string, kind: string, ops: object[] }[]} */
	const all = [];
	let files = 0;
	let bytes = 0;
	for (const p of pieces) {
		const ops = [];
		for (const o of await seed.seeding(p, vault)) {
			const { op, file } = seed.beside(o);
			if (file) [files, bytes] = [files + 1, bytes + file.size];
			const sized = !file ? op : op.op === 'create' ? { ...op, file: { ...op.file, len: file.size } } : { ...op, len: file.size };
			ops.push(JSON.parse(JSON.stringify(sized)));
		}
		all.push({ key: p.key, kind: p.kind, ops });
	}
	const count = (/** @type {(x: any) => string} */ by, /** @type {any[]} */ xs) =>
		Object.entries(xs.reduce((n, x) => ({ ...n, [by(x)]: (n[by(x)] ?? 0) + 1 }), {}))
			.map(([k, n]) => `${n} ${k}`)
			.join(', ');
	const ops = all.flatMap((p) => p.ops);
	console.error(`${pieces.length} pieces: ${count((p) => p.kind, pieces)}`);
	console.error(`${ops.length} ops: ${count((o) => o.type ?? o.op, ops)}`);
	if (files) console.error(`${files} of them bring a file, ${bytes} bytes in all, their text left out here`);
	if (out) writeFileSync(out, `${JSON.stringify(all)}\n`);
} finally {
	await server.close();
}
