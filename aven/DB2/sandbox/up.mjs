// avenSANDBOX's runner (SANDBOX.md, "The box"): `bun run up [--check]`, `down [--wipe]`, `logs`, `shot`, `build`,
// `doctor`, and `box <command>`, which runs any command in the box: `bun run box cargo test`.
// It runs on the host (a Mac with OrbStack, a Claude cloud session, a CI runner) and drives Docker; everything else
// runs in the box's image, whose tag is the first 16 hex digits of its Dockerfile's SHA-256, as the image workflow
// (.github/workflows/avensandbox-image.yml) tags it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { $ } from 'bun';
import { fence } from './fence.mjs';

const db2 = resolve(import.meta.dir, '..');
const box = join(db2, 'sandbox', 'box');
const tag = createHash('sha256').update(readFileSync(join(box, 'Dockerfile'))).digest('hex').slice(0, 16);
const image = process.env.AVENSANDBOX_IMAGE ?? `ghcr.io/myavenceo/aven/sandbox:${tag}`;
const port = process.env.AVENSANDBOX_PORT ?? '5173';
const proxyCa = '/root/.ccr/ca-bundle.crt';
const env = { ...process.env, AVENSANDBOX_IMAGE: image, AVENSANDBOX_PORT: port };
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
		await $`setsid -f sh -c ${'exec dockerd --allow-direct-routing > /tmp/avensandbox-dockerd.log 2>&1'} < /dev/null > /dev/null 2>&1`;
		for (let i = 0; i < 60; i++) {
			if (await ok($`docker info`)) return;
			await Bun.sleep(500);
		}
	}
	throw new Error("Docker isn't running: start OrbStack on a Mac, or dockerd here");
}

// Only GitHub builds the box (.github/workflows/avensandbox-image.yml), after every push that changes its Dockerfile;
// nothing builds it here. A pull that fails says why.
async function ensureImage() {
	if (await ok($`docker image inspect ${image}`)) return;
	say(`pulling ${image}`);
	const pull = await $`docker pull ${image}`.nothrow().quiet();
	if (pull.exitCode === 0) return;
	const why = `${pull.stdout}${pull.stderr}`;
	if (/pkg-containers\.githubusercontent\.com[^\n]*Forbidden/.test(why))
		throw new Error(
			"this environment's network refuses pkg-containers.githubusercontent.com, where GitHub's registry keeps the image's layers: allow it (SANDBOX.md, \"Where it runs\")",
		);
	if (/manifest unknown|not found/i.test(why))
		throw new Error(`${image} isn't published yet: GitHub builds it after the push that changes the Dockerfile, in about 4 minutes`);
	throw new Error(`can't pull ${image}: ${why.trim().split('\n').at(-1)}`);
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

async function inBox(args) {
	await ensureDocker();
	await ensureImage();
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
	const run = `runs/${new Date().toISOString().replace(/[:.]/g, '-')}`;
	const result = await $`${compose} exec -T browsers node sandbox/check.mjs ${run}`.env(env).nothrow();
	const passed = fenced.length === 0 && result.exitCode === 0;
	say(`${passed ? 'check passed' : 'check FAILED'}; screenshots and report in aven/DB2/${run}/`);
	return passed ? 0 : 1;
}

async function up(args) {
	const started = Date.now();
	await ensureDocker();
	await ensureImage();
	await install();
	await $`${compose} up -d --remove-orphans`.env(env);
	await waitForPage();
	say(`up in ${((Date.now() - started) / 1000).toFixed(1)} s · avenOS: http://localhost:${port}`);
	if (args.includes('--check')) process.exit(await check());
}

// Every release's deliverables (SANDBOX.md, "Production"): for now avenOS for the browser, built in the box.
async function build() {
	await ensureDocker();
	await ensureImage();
	await install();
	const volumes = ['-v', `${db2}:/work`, '-v', 'avensandbox_node_modules:/work/node_modules'];
	await $`docker run --rm ${volumes} -w /work ${image} node_modules/.bin/vite build --config vite.config.js`.env(env);
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
}

const [command = 'up', ...args] = process.argv.slice(2);
try {
	if (command === 'up') await up(args);
	else if (command === 'down') await $`${compose} down ${args.includes('--wipe') ? ['--volumes'] : []}`.env(env);
	else if (command === 'logs') await $`${compose} logs -f --tail 100`.env(env);
	else if (command === 'shot') process.exit(await check());
	else if (command === 'doctor') await doctor();
	else if (command === 'build') await build();
	else if (command === 'box') process.exit(await inBox(args.length ? args : ['bash']));
	else throw new Error(`unknown command ${command}: up [--check], down [--wipe], logs, shot, build, doctor, box <command>`);
} catch (error) {
	console.error(`avenSANDBOX: ${error.message}`);
	process.exit(1);
}
