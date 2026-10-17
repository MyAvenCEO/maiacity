#!/usr/bin/env node
// The repo seed of the Maia City vault (src/lib/avendb/seed.js), as the ops a device would run into a vault that holds
// none of it yet: a count of the pieces and ops by kind, and with a path, every op as JSON, each piece's ops in a list
// of their own, `"$n"` in one naming the entry op n of its piece made. It writes nothing into any vault: the page does
// that (./src/lib/avendb/Account.svelte); avenDB's test `seed` runs these ops through the ops engine.
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
	for (const p of pieces) all.push({ key: p.key, kind: p.kind, ops: await seed.seeding(p, vault) });
	const count = (/** @type {(x: any) => string} */ by, /** @type {any[]} */ xs) =>
		Object.entries(xs.reduce((n, x) => ({ ...n, [by(x)]: (n[by(x)] ?? 0) + 1 }), {}))
			.map(([k, n]) => `${n} ${k}`)
			.join(', ');
	const ops = all.flatMap((p) => p.ops);
	console.error(`${pieces.length} pieces: ${count((p) => p.kind, pieces)}`);
	console.error(`${ops.length} ops: ${count((o) => o.type ?? o.op, ops)}`);
	if (out) writeFileSync(out, `${JSON.stringify(all)}\n`);
} finally {
	await server.close();
}
