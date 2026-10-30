// `bun run bump`: moves every pin to its newest stable release (README, rule 13; SANDBOX.md, "Latest versions,
// always"). Only a person runs it, when they choose: nothing schedules it. It writes the new pins, regenerates
// Cargo.lock and bun.lock in the box with cargo and bun, checks that everything still builds there, and prints what
// moved. A major move that breaks the build goes back and is reported. It never commits: the change stays in the
// working tree for a person to review, test and commit. `bun run bump --check` (and `bun run doctor`) only lists what's
// behind.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boxTag } from './box/tag.mjs';
import { behind, db2, major, newest, table } from './versions.mjs';

const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const read = (file) => readFileSync(join(db2, file), 'utf8');

// Where each kind of pin stands in its files, as patterns over the pinned version
function patterns(pin, from) {
	const v = esc(from);
	if (pin.kind === 'crate') return [new RegExp(`^(\\s*${esc(pin.name)}\\s*=\\s*(?:\\{[^\\n]*?\\bversion\\s*=\\s*)?"=)${pin.split ? '[^"]+' : v}(")`, 'gm')];
	if (pin.kind === 'npm') return [new RegExp(`^(\\s*"${esc(pin.name)}":\\s*")${v}(")`, 'gm')];
	if (pin.kind === 'action') return [new RegExp(`(uses:\\s*${esc(pin.name)}(?:/[\\w./-]+)?@)${v}(\\s*$)`, 'gm')];
	const arg = (name) => new RegExp(`^(ARG ${name}=)${v}()$`, 'gm');
	return {
		Rust: [arg('RUST_VERSION')],
		'wasm-bindgen-cli': [arg('WASM_BINDGEN_VERSION')],
		bun: [arg('BUN_VERSION'), new RegExp(`("packageManager":\\s*"bun@)${v}(")`, 'g'), new RegExp(`(bun-version:\\s*)${v}()$`, 'gm')],
		elan: [arg('ELAN_VERSION')],
		Lean: [arg('LEAN_VERSION'), new RegExp(`^(leanprover/lean4:)${v}()$`, 'gm')],
		"Playwright's image": [new RegExp(`^(FROM mcr\\.microsoft\\.com/playwright:v)${v}(-noble)$`, 'gm')],
		versitygw: [new RegExp(`^(FROM ghcr\\.io/versity/versitygw:)${v}@sha256:[0-9a-f]+()`, 'gm')],
	}[pin.name];
}

// Writes one pin at `to` (or back at `from`) in every file it stands in
function write(pin, to, digest) {
	for (const file of pin.where) {
		let text = read(file);
		for (const pattern of patterns(pin, pin.now ?? pin.from)) text = text.replace(pattern, (_, before, after) => `${before}${to}${digest ? `@${digest}` : ''}${after}`);
		writeFileSync(join(db2, file), text);
	}
	pin.now = to;
	if (pin.split) pin.split = false;
}
const move = (pin) => write(pin, pin.to, pin.name === 'versitygw' ? pin.toDigest : '');
const back = (pin) => write(pin, pin.from, pin.name === 'versitygw' ? pin.digest : '');

// Every crate in Cargo.lock at its version, to say what the new lock moved beyond the pins
const locked = () => new Map([...read('Cargo.lock').matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)].map(([, name, version]) => [`${name} ${version.split('.')[0]}`, version]));

// The box: the one this checkout ran before the bump, since a moved tool or crate is a box GitHub hasn't built yet
let inBox;
const run = async (script) => (await inBox(['sh', '-c', `set -e\n${script}`])) === 0;
// cargo and bun write the lockfiles; the box runs as root, so they go back to the checkout's owner
const relock = () =>
	run(`owner=$(stat -c %u:%g package.json)
cargo update -q
rm -f bun.lock && bun install --silent
chown "$owner" Cargo.lock bun.lock`);
// Everything still builds: the workspace with its tests, both wasm crates, and avenOS's page
const builds = () =>
	run(`cargo check --locked -q --workspace --all-targets
cargo check --locked -q -p aven-peer-light --lib --target wasm32-unknown-unknown
cargo check --locked -q -p aven-id --lib --target wasm32-unknown-unknown
[ -f target/wasm/aven-id/aven_id.js ] || sh id/core/wasm/build.sh
node_modules/.bin/vite build --config vite.config.js --outDir /tmp/bump-dist --emptyOutDir --logLevel warn`);

async function bump(list) {
	const moves = list.filter(behind);
	const refused = [];
	const say = (line) => console.log(`bump: ${line}`);
	({ inBox } = await import('./up.mjs'));
	const lockBefore = locked();
	const tagBefore = boxTag();

	for (const pin of moves) move(pin);
	say(`${moves.length} pins moved; regenerating the lockfiles in the box`);
	if (!(await relock())) throw new Error("cargo or bun couldn't regenerate the lockfiles: the pins are moved, the locks aren't");
	let ok = await builds();
	// Something broke: the major moves go back, then each comes in alone and stays only if the build holds
	const majors = moves.filter((pin) => ['crate', 'npm'].includes(pin.kind) && major(pin.from, pin.to));
	if (!ok && majors.length) {
		say(`the build broke; trying the ${majors.length} major moves one at a time`);
		for (const pin of majors) back(pin);
		ok = (await relock()) && (await builds());
		if (ok)
			for (const pin of majors) {
				move(pin);
				if ((await relock()) && (await builds())) continue;
				back(pin);
				refused.push(pin);
				ok = await relock();
			}
	}

	const moved = moves.filter((pin) => !refused.includes(pin));
	const lockAfter = locked();
	const pinned = new Set(moved.map((pin) => pin.name));
	const transitive = [...lockAfter].filter(([key, version]) => lockBefore.has(key) && lockBefore.get(key) !== version && !pinned.has(key.split(' ')[0]));
	const added = [...lockAfter.keys()].filter((key) => !lockBefore.has(key)).length;

	console.log('\nWhat moved:\n');
	console.log(moved.length ? ['| Pin | Kind | From | To |', '| --- | --- | --- | --- |', ...moved.map((p) => `| ${p.name} | ${p.kind} | ${p.from} | ${p.to}${p.toDigest && p.toDigest !== p.digest ? ` (${p.toDigest.slice(0, 19)}…)` : ''} |`)].join('\n') : 'Nothing: every pin was at its newest.');
	if (transitive.length || added)
		console.log(`\nCargo.lock: ${transitive.length} crates under the pins moved too${added ? `, ${added} came in` : ''}${transitive.length ? `: ${transitive.map(([key, v]) => `${key.split(' ')[0]} ${lockBefore.get(key)} → ${v}`).join(', ')}` : ''}`);
	for (const pin of refused) console.log(`\nNot moved: ${pin.name} ${pin.from} → ${pin.to} is a major release that breaks the build; it needs a change by hand.`);
	for (const pin of list.filter((p) => p.error)) console.log(`\nNot checked: ${pin.name} (${pin.from}): ${pin.error}`);
	if (boxTag() !== tagBefore)
		console.log(`\nThe box's tag changed, ${tagBefore} → ${boxTag()}: GitHub builds the new box after the push (SANDBOX.md, "The box"). The build above ran with the box's current tools.`);
	console.log(ok ? '\nEverything builds. Review the change, run `bun run up --check`, and commit it.' : '\nThe build is red: see above. Nothing was committed.');
	return ok ? 0 : 1;
}

if (import.meta.main) {
	try {
		const list = await newest();
		console.log(table(list));
		process.exit(process.argv.includes('--check') ? 0 : await bump(list));
	} catch (error) {
		console.error(`bump: ${error.message}`);
		process.exit(1);
	}
}
