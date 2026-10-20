/*
 * How the page does a rule (./runner.js): the executors that need nothing but a file's bytes (`EXECUTORS`), and on the
 * Mac those that run in the app's Rust lanes (`NATIVE`: vault/app/src/aven.rs `studio_job`), which read avenDB's files
 * from its device inside the app (plan J0a).
 */

import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** How many bytes a read asks for at a time. */
const STEP = 1 << 20;

/** @type {Record<string, import('./runner.js').Executor>} */
export const EXECUTORS = {
	/** The test rule: each file the entry brings, read whole through the Mac's device, named by its BLAKE3. */
	async checksum(task, ctx) {
		const e = ctx.entry(task.inputs[0]?.entry ?? '');
		if (!e) throw new Error('its file is not on this device');
		const files = e.files ?? [];
		if (!files.length) throw new Error('it brings no bytes');
		/** @type {Record<string, string>} */
		const sums = {};
		let done = 0;
		for (const f of files) {
			const len = f.len;
			if (len == null) throw new Error('this device cannot open its bytes');
			const h = blake3.create();
			for (let at = 0; at < len; at += STEP) {
				const bytes = await ctx.read(f.root, f.size, at, Math.min(len, at + STEP));
				if (!bytes.length) throw new Error('the file ends early');
				h.update(bytes);
				ctx.progress((done += bytes.length));
			}
			sums[f.root] = bytesToHex(h.digest());
		}
		return { result: { blake3: sums } };
	}
};

/**
 * A rule the Mac app's Rust does: the task, the entries its inputs name and the files the rules behind its made inputs
 * made, as this device's world shows them, by entry, handed to `studio_job` with the vault the Mac acts as in the
 * task's vault, where it puts what it makes; it holds the rule's lane while it runs and answers `{ outputs, result }`. A cut's rules (`render`, `frame`) hand it the
 * studio's library items of avenDB's footage too, which the cut's clips name (../aven.js `libraryOf`).
 * @param {string} rule @returns {import('./runner.js').Executor}
 */
const native = (rule) => async (task, ctx) => {
	// a file brought from the legacy studio (plan JI) brings its words and its analysis: taken as they are, never made again
	if (rule === 'transcript' || rule === 'analysis') {
		const kept = legacyValue(rule, ctx.entry(task.inputs[0]?.entry ?? ''), ctx.world);
		if (kept) {
			const { valueOfFile } = await import('../aven.js');
			const v = await valueOfFile(ctx.world, kept.entry);
			if (v) return { outputs: [kept.entry], result: { file: kept.entry, state: v.state ?? 'done', hero: v.hero ?? null, language: v.language ?? null, seconds: v.seconds ?? null } };
		}
	}
	// and the HD proxy the old studio played it from, brought into avenDB once (2026-10-19), while its journey is the one
	// found in the file: remaking it from the 4K original took the 8 GB Mac a long while, the footage playing from its
	// originals until then. A profile set by hand makes a new one.
	if (rule === 'proxy') {
		const kept = legacyValue(rule, ctx.entry(task.inputs[0]?.entry ?? ''), ctx.world);
		const journey = paramsOf(task)['probe.journey'];
		if (kept && !journey?.override) return { outputs: [kept.entry], result: { profile: journey?.profile ?? null, legacy: true } };
	}
	// a world shot version whose proxy is here already (the old studio's, brought once), asked for
	// before it came: taken, never rendered again (rendering one ran the heavy world a second time)
	if (rule === 'world-proxy') {
		const v = ctx.entry(task.inputs[0]?.entry ?? '');
		const shot = v && `shot:${v.record?.shot || v.entry}`, version = v?.record?.version ?? 1;
		const tag = `proxy:${shot}:${version}`;
		const kept = v && ctx.world.entries.find((e) => e.vault === v.vault && !e.deleted && e.type === 'file' && (e.tags ?? []).includes('media:proxy') && (e.tags ?? []).includes(tag));
		if (kept) return { outputs: [kept.entry], result: { shot, shotVersion: version, legacy: true } };
	}
	/** @type {Record<string, any>} */
	const entries = {};
	for (const i of task.inputs) {
		const e = ctx.entry(i.entry);
		if (!e) continue;
		entries[i.entry] = e;
		for (const out of e.record?.outputs ?? []) {
			const made = ctx.entry(out);
			if (made) entries[out] = made;
		}
	}
	if (!Object.keys(entries).length) throw new Error('its entry is not on this device');
	const { command } = await import('$lib/native');
	const library = rule === 'render' || rule === 'frame' ? (await import('../aven.js')).libraryOf(ctx.world) : null;
	return command('studio_job', { task, entries, library, actor: ctx.as });
};

/**
 * The JSON file of the value rule `rule` would make that original `o` brought from the legacy studio
 * (vault/app/src/aven.rs `studio_import`: tagged `media:<rule>` and the original's `legacy:<hash>`).
 * @param {string} rule @param {import('../../avendb/vaults.js').EntryView | undefined} o @param {import('../../avendb/vaults.js').WorldView} world
 */
export function legacyValue(rule, o, world) {
	const mark = (o?.tags ?? []).find((t) => t.startsWith('legacy:'));
	if (!o || !mark) return undefined;
	return world.entries.find((e) => e.vault === o.vault && !e.deleted && e.type === 'file' && (e.tags ?? []).includes(mark) && (e.tags ?? []).includes(`media:${rule}`));
}

/** A task's param values (./tasks.js keeps them as JSON). @param {{ params?: unknown }} task @returns {Record<string, any>} */
function paramsOf(task) {
	if (typeof task.params !== 'string') return /** @type {Record<string, any>} */ (task.params ?? {});
	try {
		return JSON.parse(task.params) ?? {};
	} catch {
		return {};
	}
}

/** The rules the Mac app's Rust does (vault/app/src/aven.rs). */
export const NATIVE = {
	probe: native('probe'),
	proxy: native('proxy'),
	still: native('still'),
	transcript: native('transcript'),
	analysis: native('analysis'),
	render: native('render'),
	frame: native('frame'),
	'world-proxy': native('world-proxy'),
	youtube: native('youtube')
};
