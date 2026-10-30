// avenSANDBOX's runner (SANDBOX.md, "The box"): `bun run up [--check]`, `down [--wipe]`, `logs`, `shot`, `build`,
// `doctor`, and `box <command>`, which runs any command in the box: `bun run box cargo test`. bump.mjs imports `inBox`.
// It runs on the host (a Mac with OrbStack, a Claude cloud session, a CI runner) and drives Docker; everything else
// runs in the box's image, whose tag is a hash of every file its build reads (box/tag.mjs), as the image workflow
// (.github/workflows/avensandbox-image.yml) tags it.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { $ } from 'bun';
import { boxTag, toolsTag } from './box/tag.mjs';
import { fence } from './fence.mjs';
import { newest, table } from './versions.mjs';

const db2 = resolve(import.meta.dir, '..');
const box = join(db2, 'sandbox', 'box');
const boxes = 'ghcr.io/myavenceo/aven/sandbox';
let image = process.env.AVENSANDBOX_IMAGE ?? `${boxes}:${boxTag()}`;
const port = process.env.AVENSANDBOX_PORT ?? '5173';
const proxyCa = '/root/.ccr/ca-bundle.crt';
// What ships is the node, never the box: the peers learn the box only as configuration. Here the cast's test keys
// become it: each device's secret seed is sha256("avenSANDBOX test signer: <id>"), public on purpose and valid only
// inside the box, and the members are every peer of the cast by its public key.
const cast = JSON.parse(readFileSync(join(db2, 'sandbox', 'cast.json'), 'utf8'));
const seed = (id) => createHash('sha256').update(`avenSANDBOX test signer: ${id}`).digest('hex');
// an Ed25519 seed's public half: the seed in PKCS #8, its key's SubjectPublicKeyInfo, whose last 32 bytes are it
const publicOf = (hex) => {
	const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(hex, 'hex')]);
	const spki = createPublicKey(createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' });
	return spki.subarray(-32).toString('hex');
};
// Production's stand-in (sandbox/prod.mjs) is no peer of the cast: its key is a test key too, and its claim code the
// one the model's traces use (id/spec, Aven.ID.ClaimTrace), valid only in the box
const peerConfig = {
	AVENSANDBOX_PROD_SECRET: seed('prod-peer'),
	AVENSANDBOX_PROD_KEY: publicOf(seed('prod-peer')),
	AVENSANDBOX_CLAIM_CODE: 'box-claim-code',
	AVENSANDBOX_MEMBERS: Object.keys(cast.peers).map((id) => `${id}=${cast.keys[id]}`).join(','),
	AVENSANDBOX_AVEN_KEY: cast.keys['aven-peer'],
	AVENSANDBOX_AVEN_SECRET: seed('aven-peer'),
	AVENSANDBOX_ALICE_SECRET: seed('alice-peer'),
};
const env = { ...process.env, AVENSANDBOX_IMAGE: image, AVENSANDBOX_PORT: port, ...peerConfig };
const compose = ['docker', 'compose', '-f', join(box, 'compose.yml'), '-p', 'avensandbox'];

const say = (line) => console.log(`avenSANDBOX: ${line}`);
const proxyNames = () =>
	['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'].filter((name) => process.env[name]);
const ok = async (cmd) => (await cmd.nothrow().quiet()).exitCode === 0;

async function ensureDocker() {
	if (await ok($`docker info`)) return;
	// A Claude cloud session has Docker installed but not running; the box starts it, with the routing it needs.
	// It runs in a session of its own (setsid), so it outlives the command that started it.
	if (process.env.CLAUDE_CODE_REMOTE === 'true' && Bun.which('dockerd') && Bun.which('setsid')) {
		say('starting dockerd');
		// The session's disk snapshot keeps the last dockerd's pid files, and a new session reuses those pids for its own
		// processes: dockerd then refuses to start ("process with PID 154 is still running", 30 Oct 2026). A pid file
		// whose process isn't dockerd or containerd is stale.
		for (const pidFile of ['/var/run/docker.pid', '/var/run/docker/containerd/containerd.pid']) {
			if (!existsSync(pidFile)) continue;
			const pid = readFileSync(pidFile, 'utf8').trim();
			const comm = existsSync(`/proc/${pid}/comm`) ? readFileSync(`/proc/${pid}/comm`, 'utf8').trim() : '';
			if (comm !== 'dockerd' && comm !== 'containerd') rmSync(pidFile, { force: true });
		}
		// Spawned directly, not through bun's shell, whose parser refuses the input redirect this needs (bun 1.4.4)
		const daemon = ['sh', '-c', 'exec dockerd --allow-direct-routing > /tmp/avensandbox-dockerd.log 2>&1'];
		await Bun.spawn(['setsid', '-f', ...daemon], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).exited;
		for (let i = 0; i < 60; i++) {
			if (await ok($`docker info`)) return;
			await Bun.sleep(500);
		}
	}
	throw new Error("Docker isn't running: start OrbStack on a Mac, or dockerd here");
}

// Only GitHub builds the box (.github/workflows/avensandbox-image.yml), after every push that changes one of its inputs;
// nothing builds it here. Every service's image comes in one `docker compose pull`, in parallel, whenever any is
// missing; a pull that fails says why.
async function ensureImages() {
	const images = [...new Set([image, ...(await $`${compose} config --images`.env(env).quiet().text()).trim().split('\n').filter(Boolean)])];
	const missing = [];
	for (const name of images) if (!(await ok($`docker image inspect ${name}`))) missing.push(name);
	if (!missing.length) return;
	say(`pulling ${missing.join(', ')}`);
	const pull = await $`${compose} pull --quiet`.env(env).nothrow().quiet();
	if (pull.exitCode === 0 && (await ok($`docker image inspect ${image}`))) return;
	const why = `${pull.stdout}${pull.stderr}`;
	if (/pkg-containers\.githubusercontent\.com[^\n]*Forbidden/.test(why))
		throw new Error(
			"this environment's network refuses pkg-containers.githubusercontent.com, where GitHub's registry keeps the image's layers: allow it (SANDBOX.md, \"Where it runs\")",
		);
	if (/manifest unknown|not found/i.test(why)) {
		if (!process.env.AVENSANDBOX_IMAGE && (await sameTools())) return;
		throw new Error(`${missing.join(', ')} isn't published yet, and no box with the same tools is here or on main: GitHub builds it after the push that changes one of its inputs, in 10 to 12 minutes`);
	}
	throw new Error(`can't pull ${missing.join(', ')}: ${why.trim().split('\n').at(-1)}`);
}

// The checkout's own box isn't published yet: its crates changed (a new dependency) and GitHub hasn't built it. A box
// with the same tools serves meanwhile, one on disk or main's `latest`, whose label names its Dockerfile's hash; the
// build folder compiles the crates that changed.
async function sameTools() {
	const tools = toolsTag();
	const label = async (name) => (await $`docker image inspect --format ${'{{index .Config.Labels "avensandbox.tools"}}'} ${name}`.nothrow().quiet().text()).trim();
	const here = (await $`docker images ${boxes} --format ${'{{.Repository}}:{{.Tag}}'}`.nothrow().quiet().text()).trim().split('\n').filter(Boolean);
	let found = '';
	for (const name of here) if (!found && (await label(name)) === tools) found = name;
	if (!found && (await ok($`docker pull --quiet ${boxes}:latest`)) && (await label(`${boxes}:latest`)) === tools) found = `${boxes}:latest`;
	if (!found) return false;
	say(`${image} isn't published yet: running ${found}, the same tools, until GitHub builds it; the build folder compiles the crates that changed`);
	image = found;
	env.AVENSANDBOX_IMAGE = found;
	return true;
}

// Every box but the one this checkout runs goes, once the containers run on it: each holds the tools and the compiled
// crates, about 10 GB, and a cloud session's disk is 30 GB. A box a container still uses stays.
async function pruneBoxes() {
	const here = (await $`docker images ${boxes} --format ${'{{.Repository}}:{{.Tag}}'}`.nothrow().quiet().text()).trim().split('\n');
	const id = (await $`docker image inspect --format ${'{{.Id}}'} ${image}`.nothrow().quiet().text()).trim();
	for (const name of here.filter(Boolean)) {
		if (name === image || (await $`docker image inspect --format ${'{{.Id}}'} ${name}`.nothrow().quiet().text()).trim() === id) continue;
		if (await ok($`docker image rm ${name}`)) say(`removed the older box ${name}`);
	}
}

// What a container needs to reach the internet: through a cloud session's proxy, which it must trust, or directly.
function network() {
	if (!process.env.HTTPS_PROXY || !existsSync(proxyCa)) return [];
	const ca = '/etc/ssl/certs/proxy-ca.crt';
	const trust = ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'CARGO_HTTP_CAINFO', 'GIT_SSL_CAINFO'].flatMap((name) => ['-e', `${name}=${ca}`]);
	return ['--network', 'host', '-v', `${proxyCa}:${ca}:ro`, ...trust, ...proxyNames().flatMap((name) => ['-e', name])];
}

// The Rust builds and crate downloads live in volumes, kept across runs: a Mac's shared folders are slow for them.
const rustVolumes = [
	'-v', 'avensandbox_target:/work/target',
	'-v', 'avensandbox_cargo_registry:/opt/cargo/registry',
	'-v', 'avensandbox_cargo_git:/opt/cargo/git',
];

export async function inBox(args) {
	await ensureDocker();
	await ensureImages();
	const tty = process.stdout.isTTY ? ['-t'] : [];
	const volumes = ['-v', `${db2}:/work`, '-v', 'avensandbox_node_modules:/work/node_modules', ...rustVolumes];
	return (await $`docker run --rm -i ${tty} ${network()} ${volumes} -w /work ${image} ${args}`.env(env).nothrow()).exitCode;
}

async function install() {
	// node_modules lives in a volume, installed by the image's bun for Linux, and again only when bun.lock changes
	const lock = existsSync(join(db2, 'bun.lock')) ? createHash('sha256').update(readFileSync(join(db2, 'bun.lock'))).digest('hex') : 'none';
	await $`docker volume create avensandbox_node_modules`.quiet();
	const volumes = ['-v', `${db2}:/work`, '-v', 'avensandbox_node_modules:/work/node_modules'];
	const stamp = await $`docker run --rm ${volumes} -w /work ${image} cat node_modules/.avensandbox-lock`.nothrow().quiet().text();
	if (lock !== 'none' && stamp.trim() === lock) return;
	say('installing the page dependencies');
	const frozen = lock === 'none' ? '' : '--frozen-lockfile';
	const script = `bun install ${frozen} && sha256sum bun.lock | cut -d' ' -f1 > node_modules/.avensandbox-lock`;
	await $`docker run --rm ${network()} ${volumes} -w /work ${image} sh -c ${script}`.env(env);
}

// The builder (SANDBOX.md, "The box"): compiles the Peer, the Peer-Light's wasm and aven-id's wasm for avenOS once, into
// the shared build folder, incrementally. The Peers run that binary and restart when it changes; Vite reloads the pages
// when the wasm does.
const peerBinary = '/work/target/debug/aven-peer';
const lightWasm = 'target/wasm32-unknown-unknown/debug/aven_peer_light.wasm';
const buildPeers = [
	'set -e',
	'cargo build -q -p aven-peer',
	'cargo build -q -p aven-peer-light --lib --target wasm32-unknown-unknown',
	// wasm-bindgen takes 3 s even for nothing, so it runs only for a new wasm; one swap, so Vite never serves half a build
	`src=$(sha256sum ${lightWasm} | cut -c1-64)`,
	`if [ "$src" != "$(cat target/light/.source 2>/dev/null)" ]; then rm -rf target/light.next && wasm-bindgen --target web --no-typescript --out-dir target/light.next ${lightWasm} && echo "$src" > target/light.next/.source && rm -rf target/light && mv target/light.next target/light; fi`,
	'sh id/core/wasm/build.sh',
	`sha256sum ${peerBinary} | cut -c1-16`,
].join(' && ');

async function build() {
	await $`docker volume create avensandbox_target`.quiet();
	const started = Date.now();
	const tty = process.stdout.isTTY ? ['-t'] : [];
	const volumes = ['-v', `${db2}:/work`, ...rustVolumes];
	const out = await $`docker run --rm ${tty} ${network()} ${volumes} -w /work ${image} sh -c ${buildPeers}`.env(env).nothrow();
	if (out.exitCode !== 0) throw new Error('the peers did not build');
	say(`peers built in ${((Date.now() - started) / 1000).toFixed(1)} s`);
	return out.stdout.toString().trim().split('\n').at(-1);
}

async function waitForPage() {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		try {
			if ((await fetch(`http://localhost:${port}/`)).ok) return;
		} catch {}
		await Bun.sleep(500);
	}
	throw new Error(`avenOS didn't answer on localhost:${port}`);
}

async function check() {
	const fenced = fence();
	for (const problem of fenced) say(`fence: ${problem}`);
	// Lean's vectors are what is committed (README, rule 10): regenerated in the box and compared
	const vectorsStarted = Date.now();
	const fresh = (await inBox(['sh', 'sandbox/vectors.sh', '--check'])) === 0;
	say(`vectors ${fresh ? 'fresh' : 'STALE'} (${((Date.now() - vectorsStarted) / 1000).toFixed(1)} s)`);
	const run = `runs/${new Date().toISOString().replace(/[:.]/g, '-')}`;
	const result = await $`${compose} exec -T browsers node sandbox/check.mjs ${run}`.env(env).nothrow();
	const passed = fenced.length === 0 && fresh && result.exitCode === 0 && (await keeps(run)) && (await claims(run));
	say(`${passed ? 'check passed' : 'check FAILED'}; screenshots and report in aven/DB2/${run}/`);
	return passed ? 0 : 1;
}

// The record every peer keeps through its store (SANDBOX.md, "Done when"): a restart keeps it, and `down --wipe`
// empties it, so the next start writes a new one. Restarting means the Peers' containers and a new Chromium on the
// same profile for the Peer-Lights; the wipe leaves the box up, fresh.
async function keeps(run) {
	const problems = [];
	const before = JSON.parse(readFileSync(join(db2, run, 'check.json'), 'utf8')).records;
	const read = async (since) =>
		JSON.parse((await $`${compose} exec -T browsers node sandbox/records.mjs ${since}`.env(env).quiet().text()).trim().split('\n').at(-1));
	const timed = Date.now();

	let since = Date.now();
	await $`${compose} restart aven alice prod`.env(env).quiet();
	const restarted = await read(since);
	for (const [id, was] of Object.entries(before)) {
		const now = restarted[id];
		if (!now?.kept || now.first !== was.first || now.blob !== was.blob)
			problems.push(`after a restart, ${id}'s record is ${JSON.stringify(now)}, not ${JSON.stringify(was)} kept`);
	}
	const restartMs = Date.now() - timed;

	since = Date.now();
	await $`${compose} down --volumes`.env(env).quiet();
	await up([]);
	const wiped = await read(since);
	for (const id of Object.keys(before)) {
		const now = wiped[id];
		if (!now || now.kept || now.first < since) problems.push(`after a wipe, ${id}'s record is ${JSON.stringify(now)}, not a new one`);
	}
	if (Object.keys(before).length !== 4) problems.push(`records from ${Object.keys(before).length} peers, not 4`);

	const report = { ok: problems.length === 0, problems, before, restarted, wiped, restartMs, ms: Date.now() - timed };
	// written by the box, like everything under runs/: its containers run as root, and on a CI runner the host's user
	// can't write into the folder the check made there
	const write = 'require("node:fs").writeFileSync(process.argv[1], process.argv[2])';
	await $`${compose} exec -T browsers node -e ${write} ${`${run}/records.json`} ${`${JSON.stringify(report, null, 2)}\n`}`
		.env(env)
		.quiet();
	for (const problem of problems) say(`record: ${problem}`);
	if (report.ok) say(`a restart kept all four records, and a wipe emptied them (${(report.ms / 1000).toFixed(1)} s)`);
	return report.ok;
}

// The admin's passkey (PRODUCTION.md, "How it is checked"), on production's stand-in: an Aven Peer in production's
// configuration and avenOS at localhost:5174, driven by sandbox/claim.mjs in the browsers' container with Chromium's
// virtual authenticator. It claims the network with the code, is refused a second claim with and without it, signs in
// from a second browser profile with the same passkey, which becomes a second device; then the Aven Peer restarts and
// both find the same tree, and its store is wiped and the network is unclaimed again. The step starts from an empty
// store and leaves one.
async function claims(run) {
	const timed = Date.now();
	const wipe = async () => {
		await $`${compose} exec -T s3 rm -rf /data/aven/prod`.env(env).quiet();
		await $`${compose} restart prod`.env(env).quiet();
	};
	const step = async (phase) => (await $`${compose} exec -T browsers node sandbox/claim.mjs ${phase} ${run}`.env(env).nothrow()).exitCode === 0;
	await wipe();
	let ok = await step('claim');
	if (ok) {
		await $`${compose} restart prod`.env(env).quiet();
		ok = await step('restarted');
	}
	if (ok) {
		await wipe();
		ok = await step('wiped');
	}
	say(`${ok ? 'the claim, the refusals, the sign-in, the restart and the wipe hold' : 'the claim step FAILED'} (${((Date.now() - timed) / 1000).toFixed(1)} s)`);
	return ok;
}

async function up(args) {
	const started = Date.now();
	await ensureDocker();
	await ensureImages();
	await install();
	const binary = await build();
	// a new binary restarts the peers that run it: the loop's "a Rust change, running on every peer"
	const stamp = join(db2, 'runs', '.peer-running');
	const running = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : '';
	const peersUp = (await $`${compose} ps -q aven alice prod`.env(env).nothrow().quiet().text()).trim().split('\n').filter(Boolean).length;
	await $`${compose} up -d --remove-orphans`.env(env);
	if (peersUp && running !== binary) {
		say('the Peer changed: restarting aven, alice and prod');
		await $`${compose} restart aven alice prod`.env(env).quiet();
	}
	await $`mkdir -p ${join(db2, 'runs')}`;
	await Bun.write(stamp, `${binary}\n`);
	await pruneBoxes();
	await waitForPage();
	say(`up in ${((Date.now() - started) / 1000).toFixed(1)} s · avenOS: http://localhost:${port}`);
	if (args.includes('--check')) process.exit(await check());
}

// Every release's deliverables (SANDBOX.md, "Production"): for now avenOS for the browser, with aven-id's wasm, built in
// the box.
async function deliverables() {
	await ensureDocker();
	await ensureImages();
	await install();
	await $`docker volume create avensandbox_target`.quiet();
	const volumes = ['-v', `${db2}:/work`, '-v', 'avensandbox_node_modules:/work/node_modules', ...rustVolumes];
	const script = 'sh id/core/wasm/build.sh && node_modules/.bin/vite build --config vite.config.js';
	await $`docker run --rm ${network()} ${volumes} -w /work ${image} sh -c ${script}`.env(env);
	const out = join(db2, 'deliverables');
	rmSync(out, { recursive: true, force: true });
	await $`mkdir -p ${out}`;
	const page = join(out, 'aven-os-web.tar.gz');
	await $`tar -czf ${page} -C ${join(db2, 'dist')} .`;
	const sum = createHash('sha256').update(readFileSync(page)).digest('hex');
	await Bun.write(join(out, 'SHA256SUMS'), `${sum}  aven-os-web.tar.gz\n`);
	say(`deliverables in aven/DB2/deliverables/: aven-os-web.tar.gz (sha256 ${sum.slice(0, 16)}…)`);
}

async function doctor() {
	const line = async (label, cmd) => say(`${label}: ${(await cmd.nothrow().quiet().text()).trim().split('\n')[0] || 'missing'}`);
	await line('docker', $`docker version --format '{{.Server.Version}}'`);
	await line('compose', $`docker compose version --short`);
	say(`bun: ${Bun.version}`);
	say(`image: ${image} ${(await ok($`docker image inspect ${image}`)) ? '(here)' : '(not here yet: bun run up pulls or builds it)'}`);
	const cast = JSON.parse(readFileSync(join(db2, 'sandbox', 'cast.json'), 'utf8'));
	for (const [id, vault] of Object.entries(cast.vaults)) say(`${vault.name} (${id}, ${vault.kind}): owned by ${vault.owners.join(', ')}`);
	// what's behind, as `bun run bump --check` lists it
	say('versions:');
	console.log(table(await newest()));
}

// bump.mjs imports this module for `inBox`; only `bun sandbox/up.mjs` runs a command
if (import.meta.main) {
	const [command = 'up', ...args] = process.argv.slice(2);
	try {
		if (command === 'up') await up(args);
		else if (command === 'down') await $`${compose} down ${args.includes('--wipe') ? ['--volumes'] : []}`.env(env);
		else if (command === 'logs') await $`${compose} logs -f --tail 100`.env(env);
		else if (command === 'shot') process.exit(await check());
		else if (command === 'doctor') await doctor();
		else if (command === 'build') await deliverables();
		else if (command === 'box') process.exit(await inBox(args.length ? args : ['bash']));
		else throw new Error(`unknown command ${command}: up [--check], down [--wipe], logs, shot, build, doctor, box <command>`);
	} catch (error) {
		console.error(`avenSANDBOX: ${error.message}`);
		process.exit(1);
	}
}
