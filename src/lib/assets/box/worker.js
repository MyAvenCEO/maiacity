// @ts-nocheck — plain JS, the box's own code
/*
 * THE ASSET BOX'S WORKER — builds an asset by its ref and hands it back as plain data (./serialize.js). It runs as a
 * worker started inside a frame with no origin (./host.js), under that frame's rules: no network, no storage of the
 * page, no page at all. Whatever a builder does in here, all that leaves is checked data.
 */
import './shim.js';
import { OBJECT_GROUPS } from '../groups.js';
import { objectIn } from '../refs.js';
import { serialize } from './serialize.js';
import { probe } from './probe.js';

const reply = (msg, transfer = []) => self.postMessage([msg, transfer], transfer);

self.onmessage = async (e) => {
	const { id, op, ref, args } = e.data ?? {};
	try {
		if (op === 'build') {
			const t0 = performance.now();
			const obj = await objectIn(OBJECT_GROUPS, ref, ...(args ?? []));
			const built = performance.now() - t0;
			const { data, transfer } = await serialize(obj);
			reply({ id, ok: true, data, ms: { build: Math.round(built), serialize: Math.round(performance.now() - t0 - built) } }, transfer);
		} else if (op === 'list') {
			const out = {};
			for (const [g, group] of Object.entries(OBJECT_GROUPS)) out[g] = (await group.list()).map((x) => ({ id: x.id, label: x.label, version: x.version, variants: Array.isArray(x.versions.at(-1)?.build) ? x.versions.at(-1).build.map((v) => v.id) : null }));
			reply({ id, ok: true, data: out });
		} else if (op === 'probe') reply({ id, ok: true, data: await probe() });
		else if (op === 'spin') while (true);
		else throw new Error(`no op ${op}`);
	} catch (err) {
		reply({ id, ok: false, error: String(err?.message ?? err) });
	}
};
reply({ op: 'ready' });
