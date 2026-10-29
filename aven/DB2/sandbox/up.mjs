// avenSANDBOX's runner (SANDBOX.md, "The box"): `bun run up [--check]`, `down [--wipe]`, `logs`, `shot`, `doctor`.
// It runs on the host (a Mac with OrbStack, a Claude cloud session, a CI runner) and drives Docker; everything else
// runs in the box's image, whose tag is the first 16 hex digits of its Dockerfile's SHA-256, as the image workflow
// (.github/workflows/avensandbox-image.yml) tags it.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { $ } from 'bun';

const db2 = resolve(import.meta.dir, '..');
const box = join(db2, 'box');
const tag = createHash('sha256').update(readFileSync(join(box, 'Dockerfile'))).digest('hex').slice(0, 16);
const image = process.env.AVENSANDBOX_IMAGE ?? `ghcr.io/myavenceo/avensandbox:${tag}`;
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

async function ensureImage() {
	if (await ok($`docker image inspect ${image}`)) return;
	say(`pulling ${image}`);
	if (await ok($`docker pull ${image}`)) return;
	// Not published yet (a Dockerfile changed on this branch): build it here. Behind a cloud session's proxy, the
	// build goes through the host's network and trusts the proxy's certificate authority, only in this local copy.
	say(`building ${image} here`);
	const ca = join(box, 'extra-ca', 'proxy.crt');
	const proxied = Boolean(process.env.HTTPS_PROXY) && existsSync(proxyCa);
	if (proxied) copyFileSync(proxyCa, ca);
	try {
		const net = proxied ? ['--network', 'host', ...proxyNames().flatMap((name) => ['--build-arg', `${name}=${process.env[name]}`])] : [];
		await $`docker build ${net} -t ${image} ${box}`.env(env);
	} finally {
		rmSync(ca, { force: true });
	}
}

async function install() {
	// node_modules lives in a volume, installed by the image's bun for Linux, and again only when bun.lock changes
	const lock = existsSync(join(db2, 'bun.lock')) ? createHash('sha256').update(readFileSync(join(db2, 'bun.lock'))).digest('hex') : 'none';
	await $`docker volume create avensandbox_node_modules`.quiet();
	const volumes = ['-v', `${db2}:/work`, '-v', 'avensandbox_node_modules:/work/node_modules'];
	const stamp = await $`docker run --rm ${volumes} -w /work ${image} cat node_modules/.avensandbox-lock`.nothrow().quiet().text();
	if (lock !== 'none' && stamp.trim() === lock) return;
	say('installing the page dependencies');
	const proxied = Boolean(process.env.HTTPS_PROXY) && existsSync(proxyCa);
	const net = proxied ? ['--network', 'host', '-v', `${proxyCa}:/etc/ssl/certs/proxy-ca.crt:ro`, '-e', 'NODE_EXTRA_CA_CERTS=/etc/ssl/certs/proxy-ca.crt'] : [];
	const proxy = proxyNames().flatMap((name) => ['-e', name]);
	const frozen = lock === 'none' ? '' : '--frozen-lockfile';
	const script = `bun install ${frozen} && sha256sum bun.lock | cut -d' ' -f1 > node_modules/.avensandbox-lock`;
	await $`docker run --rm ${net} ${proxy} ${volumes} -w /work ${image} sh -c ${script}`.env(env);
}

async function waitForPage() {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		try {
			if ((await fetch(`http://localhost:${port}/`)).ok) return;
		} catch {}
		await Bun.sleep(500);
	}
	throw new Error(`the control room didn't answer on localhost:${port}`);
}

async function check() {
	const run = `runs/${new Date().toISOString().replace(/[:.]/g, '-')}`;
	const result = await $`${compose} exec -T browsers node sandbox/check.mjs ${run}`.env(env).nothrow();
	say(`${result.exitCode === 0 ? 'check passed' : 'check FAILED'}; screenshot and report in aven/DB2/${run}/`);
	return result.exitCode;
}

async function up(args) {
	const started = Date.now();
	await ensureDocker();
	await ensureImage();
	await install();
	await $`${compose} up -d --remove-orphans`.env(env);
	await waitForPage();
	say(`up in ${((Date.now() - started) / 1000).toFixed(1)} s · control room: http://localhost:${port}`);
	if (args.includes('--check')) process.exit(await check());
}

async function doctor() {
	const line = async (label, cmd) => say(`${label}: ${(await cmd.nothrow().quiet().text()).trim().split('\n')[0] || 'missing'}`);
	await line('docker', $`docker version --format '{{.Server.Version}}'`);
	await line('compose', $`docker compose version --short`);
	say(`bun: ${Bun.version}`);
	say(`image: ${image} ${(await ok($`docker image inspect ${image}`)) ? '(here)' : '(not here yet: bun run up pulls or builds it)'}`);
	const cast = JSON.parse(readFileSync(join(db2, 'sandbox', 'cast.json'), 'utf8'));
	for (const [id, vault] of Object.entries(cast.vaults)) say(`${vault.name}: ${vault.owners.map((o) => cast.peers[o].name).join(', ')} (${id})`);
}

const [command = 'up', ...args] = process.argv.slice(2);
try {
	if (command === 'up') await up(args);
	else if (command === 'down') await $`${compose} down ${args.includes('--wipe') ? ['--volumes'] : []}`.env(env);
	else if (command === 'logs') await $`${compose} logs -f --tail 100`.env(env);
	else if (command === 'shot') process.exit(await check());
	else if (command === 'doctor') await doctor();
	else throw new Error(`unknown command ${command}: up [--check], down [--wipe], logs, shot, doctor`);
} catch (error) {
	console.error(`avenSANDBOX: ${error.message}`);
	process.exit(1);
}
