#!/usr/bin/env node
// The one-time copy of the repo's code entries (code/views, code/logic) into the Maia City vault (C10): one avenDB
// `batch` of creates acting as the vault (game/code/sources/avendb.js `copyOf`), for its owner to run with one
// ceremony. It writes nothing itself: it prints the op, or saves it to a file.
//
//   node scripts/code-to-vault.mjs <Maia City vault id, 64 hex> [out.json]
import { writeFileSync } from 'node:fs';
import { ENTRIES } from '../code/index.js';
import { avendb, copyOf } from '../game/code/sources/avendb.js';
import { viewOfEntry } from '../game/code/index.js';

const [vault, out] = process.argv.slice(2);
const batch = copyOf(Object.values(ENTRIES), vault);
// what the vault will hand back must load as it is: every entry maps back and passes the checker
const rows = batch.ops.map((o, i) => ({ entry: `copy${String(i).padStart(8, '0')}`, vault, heads: '00000000', type: o.type, tags: o.tags, record: o.value }));
const { taken, refused } = avendb.use(rows, viewOfEntry);
if (refused.length) {
	console.error(`not copied, it would not load back:\n${refused.join('\n')}`);
	process.exit(1);
}
const text = `${JSON.stringify(batch, null, '\t')}\n`;
if (out) writeFileSync(out, text);
else process.stdout.write(text);
console.error(`${taken.length} code entries (${taken.filter((r) => r.startsWith('views/')).length} views, ${taken.filter((r) => r.startsWith('logic/')).length} logic modules), ${Buffer.byteLength(text)} bytes${out ? `, in ${out}` : ''}`);
