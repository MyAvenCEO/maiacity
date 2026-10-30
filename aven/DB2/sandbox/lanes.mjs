// avenSANDBOX's lanes (SANDBOX.md, "Real-world iroh inside the box"; MILESTONE2.md, thread C): `bun run lanes
// [--runs N] [--keep]`. Beside the box, never inside `bun run up`: a project of its own (box/lanes.yml), a WAN with an
// Aven Peer on it, and three homes behind routers, each with an Alice Peer of its own. For each lane it reports the path
// iroh took, the time from the Peer's start to its first connection and to a direct path, and the router's NAT as
// conntrack and iptables show it, so the lane is proven to be what it says; then passes or fails it against what iroh
// should do. Each run starts every container afresh, routers included, so no NAT mapping outlives a run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { $ } from 'bun';
import { build, ensureDocker, ensureImages, image, publicOf, seed } from './up.mjs';

const db2 = resolve(import.meta.dir, '..');
const compose = ['docker', 'compose', '-f', join(db2, 'sandbox', 'box', 'lanes.yml'), '-p', 'avensandbox-lanes'];
const aven = '10.78.0.10';

// What iroh should do from each home to an Aven Peer on a public address. The NATed side opens its own mapping by
// sending first, so any NAT that lets UDP out goes direct; relay first and a hard NAT held on the relay are what two
// NATed members see, which needs QAD on the relay (the PR's open questions).
const lanes = [
	{ id: 'home', name: 'home NAT', home: '10.77.1.3', expect: 'direct', nat: 'ports kept' },
	{ id: 'hard', name: 'hard NAT', home: '10.77.2.3', expect: 'direct', nat: 'random ports' },
	{ id: 'udp', name: 'UDP blocked', home: '10.77.3.3', expect: 'relay', nat: 'UDP dropped' },
];
// a direct path must come this soon after the Peer starts; a relay-only lane must hold this long without one,
// three of iroh's 5 s hole-punching rounds and more
const directWithin = 30_000;
const relayHold = 20_000;

const say = (line) => console.log(`avenSANDBOX lanes: ${line}`);
const ids = ['lanes-aven', ...lanes.map((lane) => `alice-${lane.id}`)];
const env = {
	...process.env,
	AVENSANDBOX_IMAGE: image,
	LANES_AVEN_SECRET: seed('lanes-aven'),
	LANES_AVEN_KEY: publicOf(seed('lanes-aven')),
	LANES_MEMBERS: ids.map((id) => `${id}=${publicOf(seed(id))}`).join(','),
	...Object.fromEntries(lanes.map((lane) => [`LANES_${lane.id.toUpperCase()}_SECRET`, seed(`alice-${lane.id}`)])),
};

// an Alice Peer's timeline so far, from its stdout
async function timeline(lane) {
	const out = await $`${compose} logs --no-log-prefix ${`${lane.id}-alice`}`.env(env).nothrow().quiet().text();
	return out
		.split('\n')
		.filter((line) => line.startsWith('{'))
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

// The path iroh took, in order, and the times that matter, from the Peer's own `started` line
function read(lines) {
	const started = lines.find((l) => l.event === 'started')?.t;
	const connected = lines.find((l) => l.event === 'connected');
	const paths = [];
	for (const l of lines)
		if ((l.event === 'connected' || l.event === 'path' || l.event === 'status') && l.path && paths.at(-1) !== l.path) paths.push(l.path);
	const direct = lines.find((l) => l.path === 'direct');
	const lost = lines.filter((l) => l.event === 'lost').length;
	const live = lines.filter((l) => l.event === 'status').at(-1)?.phase === 'live';
	return {
		started,
		paths,
		firstPath: connected?.path ?? null,
		connectMs: connected && started ? connected.t - started : null,
		directMs: direct && started ? direct.t - started : null,
		lost,
		live,
		last: lines.at(-1)?.t,
	};
}

// The router's NAT as the kernel keeps it: the mapping of Alice's UDP socket to the Aven Peer's, and how many of the
// home's UDP packets were dropped
async function router(lane) {
	const sh = (cmd) => $`${compose} exec -T ${`${lane.id}-router`} sh -c ${cmd}`.env(env).nothrow().quiet().text();
	const flows = await sh(`conntrack -L -p udp -s ${lane.home} -d ${aven} 2>/dev/null`);
	// its reply tuple: from the Aven Peer's 4433 to the port the router mapped Alice's 4433 to
	const mapped = flows.match(new RegExp(`sport=4433 dport=4433 .*src=${aven.replaceAll('.', '\\.')} dst=\\S+ sport=4433 dport=(\\d+)`))?.[1];
	const forward = await sh('iptables -L FORWARD -v -n -x');
	const dropped = forward.split('\n').find((line) => /DROP\s+17\b|DROP\s+udp/.test(line))?.trim().split(/\s+/)[0];
	return { mapped: mapped ? Number(mapped) : null, udpDropped: dropped ? Number(dropped) : 0 };
}

// Whether a lane did what it should, and why not
function judge(lane, seen, nat) {
	const why = [];
	if (seen.connectMs == null) why.push('never connected');
	if (lane.expect === 'direct' && seen.directMs == null) why.push(`no direct path within ${directWithin / 1000} s`);
	if (lane.expect === 'relay' && seen.paths.includes('direct')) why.push('went direct, where UDP is dropped');
	if (lane.expect === 'relay' && seen.firstPath && seen.firstPath !== 'relay') why.push(`started on ${seen.firstPath}`);
	if (!seen.live) why.push('not live at the end');
	if (lane.id === 'home' && nat.mapped !== 4433) why.push(`the router mapped port 4433 to ${nat.mapped}, not kept`);
	if (lane.id === 'hard' && (nat.mapped == null || nat.mapped === 4433)) why.push(`the router kept port ${nat.mapped}, not a random one`);
	if (lane.id === 'udp' && !(nat.udpDropped > 0)) why.push('the router dropped no UDP');
	return why;
}

async function once() {
	await $`${compose} down --remove-orphans`.env(env).quiet();
	await $`${compose} up -d`.env(env).quiet();
	const decided = new Map();
	const deadline = Date.now() + directWithin + relayHold + 10_000;
	while (decided.size < lanes.length && Date.now() < deadline) {
		await Bun.sleep(250);
		for (const lane of lanes) {
			if (decided.has(lane.id)) continue;
			const seen = read(await timeline(lane));
			if (!seen.started) continue;
			const age = Date.now() - seen.started;
			const done =
				lane.expect === 'direct'
					? seen.directMs != null || age > directWithin
					: seen.paths.includes('direct') || (seen.connectMs != null && age > seen.connectMs + relayHold);
			if (done) decided.set(lane.id, seen);
		}
	}
	const results = [];
	for (const lane of lanes) {
		const seen = decided.get(lane.id) ?? read(await timeline(lane));
		const nat = await router(lane);
		results.push({ lane: lane.id, name: lane.name, nat: lane.nat, expect: lane.expect, ...seen, router: nat, problems: judge(lane, seen, nat) });
	}
	return results;
}

const ms = (value) => (value == null ? '-' : `${value} ms`);

async function main(args) {
	const runs = Number(args[args.indexOf('--runs') + 1]) || 1;
	const started = Date.now();
	await ensureDocker();
	await ensureImages();
	await $`${compose} pull --quiet --ignore-buildable`.env(env).quiet();
	await build();
	const all = [];
	for (let run = 1; run <= runs; run++) {
		const results = await once();
		all.push(results);
		for (const r of results) {
			const nat = r.lane === 'udp' ? `${r.router.udpDropped} UDP packets dropped` : `4433 mapped to ${r.router.mapped}`;
			say(
				`${r.problems.length ? 'FAIL' : 'pass'} ${r.name.padEnd(11)} path ${r.paths.join(' → ') || 'none'}, connected ${ms(r.connectMs)}, direct ${ms(r.directMs)} (${nat})${runs > 1 ? `, run ${run}` : ''}`,
			);
			for (const problem of r.problems) say(`  ${r.name}: ${problem}`);
		}
	}
	if (!args.includes('--keep')) await $`${compose} down --remove-orphans`.env(env).quiet();
	const passed = all.flat().every((r) => r.problems.length === 0);
	const dir = join(db2, 'runs', `lanes-${new Date().toISOString().replace(/[:.]/g, '-')}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'lanes.json'), `${JSON.stringify({ ok: passed, runs: all, ms: Date.now() - started }, null, 2)}\n`);
	say(`${passed ? 'all lanes passed' : 'lanes FAILED'} in ${((Date.now() - started) / 1000).toFixed(1)} s; report in aven/DB2/${dir.slice(db2.length + 1)}/lanes.json`);
	return passed ? 0 : 1;
}

try {
	process.exit(await main(process.argv.slice(2)));
} catch (error) {
	console.error(`avenSANDBOX lanes: ${error.message}`);
	process.exit(1);
}
