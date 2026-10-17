#!/usr/bin/env node
// The copy of the repo's code entries (code/views, code/logic) into the Maia City vault (C10): one avenDB `batch` of
// creates acting as the vault (game/code/sources/avendb.js `copyOf`), for its owner to run with one ceremony in the
// studio's Query console. It writes nothing itself: it prints the op, or saves it to a file.
//
//   node scripts/code-to-vault.mjs <Maia City vault id> --fresh [--server <avenCEO server vault id>] [out.json]
//   node scripts/code-to-vault.mjs <Maia City vault id> [--have <file|url>] [out.json]           a rerun
//
// (ids are 64 hex.) A batch is not atomic, so a rerun copies only the paths the vault does not hold yet: by default it
// reads them off the feed (avenDB's /feed/code for that vault), or from --have, a file or url of rows ({ tags } each;
// an array, or { code } or { entries }). The first copy (--fresh) also opens the vault's views and logic modules to
// everyone, before any of them, so the feed shows whatever went in before a stop; with --server it first gives the
// server a Backup share, as the page's "server keeps a copy" does, without which the feed shows nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { ENTRIES } from '../code/index.js';
import { CODE_FEED, avendb, copyOf } from '../game/code/sources/avendb.js';
import { viewOfEntry } from '../game/code/index.js';

const args = process.argv.slice(2);
const flag = (name) => {
	const i = args.indexOf(name);
	return i < 0 ? undefined : args.splice(i, name === '--fresh' ? 1 : 2).at(1) ?? true;
};
const fresh = flag('--fresh');
const from = flag('--have');
const server = flag('--server');
const [vault, out] = args;
const no = (why) => {
	console.error(why);
	process.exit(1);
};
if (!/^[0-9a-f]{64}$/.test(String(vault))) no('usage: node scripts/code-to-vault.mjs <Maia City vault id, 64 hex> (--fresh | --have <file|url>) [out.json]');
if (fresh && from) no('--fresh is the first copy, --have a rerun: one of them');
if (server && (!fresh || !/^[0-9a-f]{64}$/.test(String(server)))) no("--server goes with --fresh, and is avenCEO server's vault id, 64 hex");

/** the rows the vault already holds, off the feed or a file; null for the first copy */
async function held() {
	if (fresh) return null;
	const where = typeof from === 'string' ? from : `${CODE_FEED}?vault=${vault}&type=view,logic&bare=1`;
	try {
		const body = /^https?:/.test(where) ? await (await fetch(where).then((r) => (r.ok ? r : Promise.reject(new Error(`${where} answered ${r.status}`))))).json() : JSON.parse(readFileSync(where, 'utf8'));
		const rows = Array.isArray(body) ? body : (body?.code ?? body?.entries);
		if (!Array.isArray(rows)) throw new Error(`${where} holds no rows`);
		return rows.filter((r) => !r.vault || r.vault === vault);
	} catch (e) {
		no(`can't read what the vault holds (${e.message}); for the first copy pass --fresh`);
	}
}

const have = await held();
const batch = copyOf(Object.values(ENTRIES), vault, { have, server });
const creates = batch.ops.filter((o) => o.op === 'create');
// what the vault will hand back must load as it is: every entry maps back and passes the checker
const rows = creates.map((o, i) => ({ entry: `copy${String(i).padStart(8, '0')}`, vault, heads: '00000000', type: o.type, tags: o.tags, record: o.value }));
const { taken, refused } = avendb.use(rows, viewOfEntry);
if (refused.length) no(`not copied, it would not load back:\n${refused.join('\n')}`);
if (!batch.ops.length) {
	console.error(`nothing to copy: the vault holds every path already (${have.length} rows)`);
	process.exit(0);
}
const text = `${JSON.stringify(batch, null, '\t')}\n`;
if (out) writeFileSync(out, text);
else process.stdout.write(text);
const count = (p) => taken.filter((r) => r.startsWith(p)).length;
const kept = have ? `, ${Object.values(ENTRIES).filter((e) => e.type === 'view' || e.type === 'logic').length - creates.length} left out as held` : `, after ${server ? "the server's Backup share and " : ''}the Public share`;
console.error(`${taken.length} code entries (${count('views/')} views, ${count('logic/')} logic modules)${kept}, ${Buffer.byteLength(text)} bytes${out ? `, in ${out}` : ''}`);
