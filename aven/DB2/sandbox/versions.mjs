// Every pin of avenDB and where its newest stable release comes from (README, rule 13; SANDBOX.md, "Latest versions,
// always"). `pins()` reads what is pinned, `newest()` asks each pin's source, and `moves()` says what a bump would move.
// It only reads: `bun run bump` (bump.mjs) writes, and `bun run doctor` lists what's behind. A source the network
// refuses is named with its reason, never guessed. Node's and bun's own modules only, so it runs on the host.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { $ } from 'bun';

const db2 = resolve(import.meta.dir, '..');
const repo = resolve(db2, '../..');
const dockerfile = 'sandbox/box/Dockerfile';
// avenDB's own workflows, relative to aven/DB2
const workflows = ['../../.github/workflows/avensandbox.yml', '../../.github/workflows/avensandbox-image.yml'];
const leanToolchains = ['id/spec/lean-toolchain', 'db/spec/lean-toolchain'];
// The fork of OpenDAL's OPFS service (store/opendal-opfs/FORK.md) is OpenDAL at one release: OpenDAL moves only with
// a new fork, by hand.
const held = { opendal: 'the fork store/opendal-opfs is this release: moving it means a new fork (FORK.md)' };
held['opendal-core'] = held.opendal;
// What ships together: the wasm-bindgen CLI follows the crate; Playwright's image follows the npm package
const wasmBindgen = 'wasm-bindgen';

const read = (file) => readFileSync(join(db2, file), 'utf8');
const files = (keep) => {
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (['target', 'node_modules', '.git', '.lake', 'runs', 'dist', 'deliverables'].includes(entry.name)) continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (keep(entry.name)) out.push(relative(db2, path));
		}
	};
	walk(db2);
	return out.sort();
};

// Versions: x.y.z with an optional leading v; anything with a suffix (-rc1, -beta) is a pre-release and never counts
const parse = (v) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);
export const stable = (v) => Boolean(parse(v));
export const compare = (a, b) => {
	const [x, y] = [parse(a), parse(b)];
	return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
const newestOf = (versions) => versions.filter(stable).sort(compare).at(-1);
// A major move: the first non-zero part changes (Cargo's and npm's rule for what may break)
export const major = (from, to) => {
	const [a, b] = [parse(from), parse(to)];
	const i = a[0] ? 0 : a[1] ? 1 : 2;
	return a.slice(0, i + 1).join('.') !== b.slice(0, i + 1).join('.');
};

// One fetch, with the reason it failed as the error: the proxy's refusal, a status, a timeout
async function get(url, headers = {}) {
	let res;
	try {
		res = await fetch(url, { headers: { 'user-agent': 'avenSANDBOX bump (github.com/myavenceo/maiacity)', ...headers }, signal: AbortSignal.timeout(20_000) });
	} catch (error) {
		throw new Error(`${new URL(url).host} unreachable: ${error.cause?.message ?? error.message}`);
	}
	if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
	return res;
}

// The sources, each asked once per run
const cache = new Map();
const once = (key, ask) => {
	if (!cache.has(key)) cache.set(key, ask().catch((error) => ({ error: error.message })));
	return cache.get(key);
};
const sources = {
	// crates.io's sparse index, which cargo itself reads: yanked releases don't count
	crate: (name) =>
		once(`crate:${name}`, async () => {
			const n = name.toLowerCase();
			const path = n.length <= 2 ? `${n.length}/${n}` : n.length === 3 ? `3/${n[0]}/${n}` : `${n.slice(0, 2)}/${n.slice(2, 4)}/${n}`;
			const lines = (await (await get(`https://index.crates.io/${path}`)).text()).trim().split('\n').map((line) => JSON.parse(line));
			return { version: newestOf(lines.filter((v) => !v.yanked).map((v) => v.vers)) };
		}),
	// npm's registry: deprecated releases don't count
	npm: (name) =>
		once(`npm:${name}`, async () => {
			const doc = await (await get(`https://registry.npmjs.org/${name.replace('/', '%2F')}`)).json();
			return { version: newestOf(Object.values(doc.versions).filter((v) => !v.deprecated).map((v) => v.version)), all: Object.keys(doc.versions) };
		}),
	// a GitHub repository's tags, over git itself: GitHub's API and its release storage refuse a cloud session
	github: (slug) =>
		once(`github:${slug}`, async () => {
			const out = await $`git ls-remote --tags --refs ${`https://github.com/${slug}`}`.nothrow().quiet();
			if (out.exitCode !== 0) throw new Error(`git ls-remote github.com failed: ${out.stderr.toString().trim().split('\n').at(-1)}`);
			const tags = out.stdout.toString().trim().split('\n').map((line) => line.split('refs/tags/')[1]).filter(Boolean);
			return { version: newestOf(tags) };
		}),
	// Rust's stable channel, as rustup reads it
	rust: () =>
		once('rust', async () => {
			const toml = await (await get('https://static.rust-lang.org/dist/channel-rust-stable.toml')).text();
			return { version: /\[pkg\.rust\]\nversion = "(\d+\.\d+\.\d+)/.exec(toml)?.[1] };
		}),
	// an image's tags in a registry (Docker's v2 API), every page
	tags: (host, image, token) =>
		once(`tags:${host}/${image}`, async () => {
			const headers = token ? { authorization: `Bearer ${await token()}` } : {};
			const tags = [];
			for (let url = `https://${host}/v2/${image}/tags/list?n=1000`; url; ) {
				const res = await get(url, headers);
				tags.push(...((await res.json()).tags ?? []));
				const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1];
				url = next ? new URL(next, url).href : '';
			}
			return { tags };
		}),
};
const ghcrToken = (image) => async () => (await (await get(`https://ghcr.io/token?scope=repository:${image}:pull`)).json()).token;
async function ghcrDigest(image, tag) {
	const res = await get(`https://ghcr.io/v2/${image}/manifests/${tag}`, {
		authorization: `Bearer ${await ghcrToken(image)()}`,
		accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
	});
	return res.headers.get('docker-content-digest');
}

// Every pin: { name, kind, from, where: files, source(): { version } | { error } }. Crates and npm packages are one pin
// per name, wherever they're pinned.
export function pins() {
	const out = [];
	const docker = read(dockerfile);
	const arg = (name) => new RegExp(`^ARG ${name}=(\\S+)$`, 'm').exec(docker)?.[1];

	// crates: `name = "=x.y.z"` or `name = { version = "=x.y.z", ... }` in every Cargo.toml
	const crates = new Map();
	for (const file of files((name) => name === 'Cargo.toml'))
		for (const [, name, version] of read(file).matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*(?:\{[^\n]*?\bversion\s*=\s*)?"=([^"]+)"/gm)) {
			const pin = crates.get(name) ?? { name, kind: 'crate', from: version, where: [], source: () => sources.crate(name), held: held[name] };
			if (!pin.where.includes(file)) pin.where.push(file);
			if (pin.from !== version) pin.split = true;
			crates.set(name, pin);
		}
	out.push(...crates.values());

	// npm packages in package.json, exact versions only
	const pkg = JSON.parse(read('package.json'));
	for (const field of ['dependencies', 'devDependencies'])
		for (const [name, version] of Object.entries(pkg[field] ?? {}))
			if (stable(version))
				out.push({ name, kind: 'npm', from: version, where: ['package.json'], follows: name === 'playwright' ? "Playwright's image" : undefined, source: () => sources.npm(name) });

	// the tools in the image
	out.push({ name: 'Rust', kind: 'tool', from: arg('RUST_VERSION'), where: [dockerfile], source: sources.rust });
	const bindgen = crates.get(wasmBindgen);
	out.push({ name: 'wasm-bindgen-cli', kind: 'tool', from: arg('WASM_BINDGEN_VERSION'), where: [dockerfile], follows: bindgen && wasmBindgen, source: () => sources.crate(wasmBindgen) });
	const bunWhere = [dockerfile, 'package.json', ...workflows.filter((file) => /bun-version:/.test(read(file)))];
	out.push({ name: 'bun', kind: 'tool', from: arg('BUN_VERSION'), where: bunWhere, source: () => sources.npm('bun') });
	// elan and Lean come from GitHub's release storage when the image builds: the tag says what's newest, and its
	// downloads for both platforms are asked for too
	const linux = ['x86_64', 'aarch64'];
	const elanFiles = (v) => linux.map((arch) => `https://github.com/leanprover/elan/releases/download/${v}/elan-${arch}-unknown-linux-gnu.tar.gz`);
	const leanFiles = (v) => ['', '_aarch64'].map((arch) => `https://github.com/leanprover/lean4/releases/download/${v}/lean-${v.slice(1)}-linux${arch}.tar.zst`);
	out.push({ name: 'elan', kind: 'tool', from: arg('ELAN_VERSION'), where: [dockerfile], downloads: elanFiles, source: () => sources.github('leanprover/elan') });
	out.push({ name: 'Lean', kind: 'tool', from: arg('LEAN_VERSION'), where: [dockerfile, ...leanToolchains], downloads: leanFiles, source: () => sources.github('leanprover/lean4') });

	// Playwright's image, which must be the npm package's version: the newest release that has both
	const playwright = /^FROM mcr\.microsoft\.com\/playwright:v(\S+)-noble$/m.exec(docker)?.[1];
	out.push({
		name: "Playwright's image",
		kind: 'image',
		from: playwright,
		where: [dockerfile],
		source: async () => {
			const [npm, image] = await Promise.all([sources.npm('playwright'), sources.tags('mcr.microsoft.com', 'playwright')]);
			if (npm.error || image.error) return { error: npm.error ?? image.error };
			const tags = new Set(image.tags);
			const newest = newestOf(npm.all.filter((v) => tags.has(`v${v}-noble`)));
			return { version: newest, note: newest !== npm.version ? `npm has ${npm.version}, its image isn't published yet` : '' };
		},
	});

	// versitygw, by tag and digest
	const versity = /^FROM ghcr\.io\/versity\/versitygw:(v\S+)@(sha256:[0-9a-f]+)/m.exec(docker);
	out.push({
		name: 'versitygw',
		kind: 'image',
		from: versity?.[1],
		digest: versity?.[2],
		where: [dockerfile],
		source: () =>
			once('versitygw', async () => {
				const { tags, error } = await sources.tags('ghcr.io', 'versity/versitygw', ghcrToken('versity/versitygw'));
				if (error) throw new Error(error);
				const version = newestOf(tags);
				return { version, digest: await ghcrDigest('versity/versitygw', version) };
			}),
	});

	// GitHub Actions in avenDB's workflows, by tag
	const actions = new Map();
	for (const file of workflows)
		for (const [, action, version] of read(file).matchAll(/uses:\s*([\w.-]+\/[\w.-]+)(?:\/[\w./-]+)?@(v\d+\.\d+\.\d+)\s*$/gm)) {
			const pin = actions.get(action) ?? { name: action, kind: 'action', from: version, where: [], source: () => sources.github(action) };
			if (!pin.where.includes(file)) pin.where.push(file);
			actions.set(action, pin);
		}
	out.push(...actions.values());
	return out;
}

// Each pin with its newest stable release: { ...pin, to, note } or { ...pin, error }
export async function newest(list = pins()) {
	const asked = await Promise.all(list.map(async (pin) => ({ pin, found: await pin.source() })));
	const byName = new Map(asked.map(({ pin, found }) => [pin.name, found]));
	const results = asked.map(({ pin, found }) => {
		if (found.error) return { ...pin, error: found.error };
		if (!found.version) return { ...pin, error: 'no stable release found' };
		let to = pin.from?.startsWith('v') && !found.version.startsWith('v') ? `v${found.version}` : found.version;
		if (pin.from && !pin.from.startsWith('v')) to = to.replace(/^v/, '');
		if (pin.follows && byName.get(pin.follows)?.version) to = byName.get(pin.follows).version;
		const result = { ...pin, to, note: found.note ?? '' };
		if (pin.downloads) result.downloads = pin.downloads(to);
		if (found.digest) result.toDigest = found.digest;
		if (pin.held && to !== pin.from) return { ...result, to: pin.from, note: `${to} is out; held: ${pin.held}` };
		if (pin.split) result.note = `pinned at more than one version; all go to ${to}`;
		return result;
	});
	// A release whose downloads can't be asked for still moves: its tag is GitHub's own word that it's out, and the
	// image's build on GitHub fetches the downloads. The note says what wasn't checked and why.
	await Promise.all(
		results
			.filter((pin) => pin.downloads && !pin.error)
			.map(async (pin) => {
				const ask = (url) => get(url, { range: 'bytes=0-0' }).then((res) => res.body?.cancel(), (error) => error.message);
				const failed = (await Promise.all(pin.downloads.map(ask))).filter(Boolean);
				if (failed.length) pin.note = [pin.note, `its downloads for ${pin.to} not checked: ${failed[0]} (GitHub's release storage)`].filter(Boolean).join('; ');
				delete pin.downloads;
			}),
	);
	return results;
}

// What's behind: a newer version, or the same tag at a new digest
export const behind = (pin) => !pin.error && (compare(pin.to, pin.from) > 0 || pin.split || (pin.toDigest && pin.toDigest !== pin.digest));

// The table every command prints: one line per pin, behind ones first
export function table(list, { all = false } = {}) {
	const rows = list
		.filter((pin) => all || behind(pin) || pin.error || pin.note)
		.map((pin) => [
			pin.name,
			pin.kind,
			pin.from ?? '?',
			pin.error ? 'not checked' : behind(pin) ? pin.to : 'newest',
			pin.error ? `couldn't check: ${pin.error}` : [behind(pin) && major(pin.from, pin.to) ? 'major' : '', pin.note].filter(Boolean).join('; '),
		]);
	if (!rows.length) return 'Every pin is at its newest stable release.';
	const head = ['Pin', 'Kind', 'Pinned', 'Newest', 'Note'];
	return [head, head.map(() => '---'), ...rows].map((row) => `| ${row.join(' | ')} |`).join('\n');
}

export { db2, repo };
