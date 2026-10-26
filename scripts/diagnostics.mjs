#!/usr/bin/env node
// The person's devices' diagnostics reports, as theOS keeps them on this Mac (~/Library/Logs/TheOS/diagnostics, each
// `<device>-<at>.json`, vault/app's diagnostics.rs): every device's newest, said in a few lines, so whoever looks into
// a device reads its report without anyone copying it (Samuel 2026-10-26). The devices send them to avenDB's server
// (src/lib/avendb/diagnostics-send.js) and theOS reads them back every few minutes while it runs.
//
//   node scripts/diagnostics.mjs                 every device's newest report, in short
//   node scripts/diagnostics.mjs <device> [n]    that device's (its id's first digits) newest n, whole JSON
//   node scripts/diagnostics.mjs --list          every report kept, by device
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dir = join(homedir(), 'Library/Logs/TheOS/diagnostics');
const args = process.argv.slice(2);
let files = [];
try {
	files = readdirSync(dir).filter((f) => /^[0-9a-f]+-\d+\.json$/.test(f));
} catch {
	console.error(`No reports kept yet in ${dir}: theOS keeps them once it runs this build with its vault open.`);
	process.exit(1);
}
/** the reports kept, by device, the newest first */
const by = new Map();
for (const f of files) {
	const [device, at] = f.replace(/\.json$/, '').split('-');
	if (!by.has(device)) by.set(device, []);
	by.get(device).push({ at: Number(at), file: join(dir, f) });
}
for (const list of by.values()) list.sort((a, b) => b.at - a.at);
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const when = (at) => new Date(at * 1000).toISOString().replace('T', ' ').slice(0, 19) + 'Z';

if (args[0] === '--list') {
	for (const [device, list] of by) console.log(`${device}: ${list.map((r) => when(r.at)).join(', ')}`);
} else if (args[0]) {
	const list = [...by].find(([d]) => d.startsWith(args[0]))?.[1];
	if (!list) throw new Error(`no device ${args[0]}: ${[...by.keys()].join(', ')}`);
	for (const r of list.slice(0, Number(args[1] ?? 1))) console.log(JSON.stringify(read(r.file), null, 1));
} else {
	for (const [device, list] of by) {
		const { report } = read(list[0].file);
		const d = report.diagnostics ?? report;
		const sync = d.sync ?? {};
		const run = d.run ?? {};
		const peers = report.network?.peers ?? [];
		const failed = peers.reduce((n, p) => n + (p.pulled?.failed ?? 0), 0);
		const speed = (run.network?.results ?? []).filter((r) => r.mbps != null).map((r) => `${r.kind} ${r.mbps.toFixed(1)} Mbit/s`);
		console.log([
			`${device} · ${d.device ?? '?'} · build ${String(d.build?.frontend ?? '?').slice(0, 8)} · ${report.page ?? '?'} · ${when(list[0].at)} (${list.length} kept)`,
			`  phase ${d.phase ?? '?'} · sync ${sync.status === 'unavailable' ? 'unknown' : `${sync.peers ?? '?'} peers, ${sync.behind ?? '?'} of ${sync.logs ?? '?'} logs behind, ${sync.pulling ?? 0} pulling`}`,
			`  peers ${peers.length}: ${peers.map((p) => `${String(p.device).slice(0, 8)} ${p.way}${p.lacks ? `, lacks ${p.lacks}` : ''}`).join('; ') || 'none'}${failed ? ` · ${failed} failed page requests` : ''}`,
			...(run.status ? [`  last checks: ${run.status}${speed.length ? ` · ${speed.join(', ')}` : ''}${run.responsiveness?.eventLoopDelayP95Ms != null ? ` · page delay p95 ${Math.round(run.responsiveness.eventLoopDelayP95Ms)} ms` : ''}`] : [])
		].join('\n'));
	}
}
