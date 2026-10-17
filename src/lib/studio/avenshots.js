/*
 * World shots in avenDB (Jobs and studio 2.0, J10): a shot of the world kept as data, as the API's `shots` table kept
 * it, beside the cuts that play it (./cuts.js). Each version is an entry of its own and never changes, so a clip that
 * pins a version (`shot`, `shotVersion`) plays and renders the same shot for good: the first version is the shot
 * (its id `shot:<entry>`), every later one names it (`shot`) and counts on (`version`).
 *
 * The Mac makes each version's HD proxy when a cut plays it (the `world-proxy` rule, vault/app/src/aven.rs), and
 * renders its plates from the version's spec (render.rs `spec_of`, world.rs `aven_shot`).
 */

import { answer } from '$lib/avendb/ops.js';
import { asIn, device, homeOf, schemaIn, worldOf } from './cuts.js';

export const SHOT = 'shot';

/** The `shot` record's schema, in the vault's own lane. */
export const SHOT_V1 = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "World shot, v1",
  "description": "One version of a world shot: the shot it is a version of (none for the first), its name and its spec as JSON text.",
  "type": "object",
  "properties": {
    "kind": { "const": "shot" },
    "shot": { "type": "string", "maxLength": 128, "default": "" },
    "name": { "type": "string", "maxLength": 200 },
    "project": { "type": "string", "maxLength": 200, "default": "" },
    "version": { "type": "integer", "minimum": 1 },
    "spec": { "type": "string", "maxLength": 1000000 },
    "legacy": { "type": "string", "maxLength": 80, "default": "" },
    "at": { "type": "integer", "minimum": 0 }
  },
  "required": ["kind", "name", "version", "spec", "at"]
}
`;

/** @typedef {import('$lib/auth/client').Shot} Shot */
/** @typedef {import('../avendb/vaults.js').EntryView} EntryView */

/** Whether shot `id` is avenDB's. @param {unknown} id */
export const isAvenShot = (id) => typeof id === 'string' && id.startsWith('shot:');

/** The shot version entry `e` is a version of. @param {EntryView} e */
const shotOf = (e) => `shot:${e.record?.shot || e.entry}`;

/** Every shot version the world holds. @param {import('../avendb/vaults.js').WorldView} world */
const versions = (world) => world.entries.filter((e) => e.type === SHOT && e.record?.kind === SHOT && !e.deleted && !(e.tags ?? []).includes('avendb:deleted'));

/** Version `v` of shot `id`'s entry (its newest when no version is named). @param {import('../avendb/vaults.js').WorldView} world @param {string} id @param {number} [v] */
export function versionEntry(world, id, v) {
	const all = versions(world).filter((e) => shotOf(e) === id);
	return v ? all.find((e) => e.record?.version === v) : all.sort((a, b) => (b.record?.version ?? 0) - (a.record?.version ?? 0))[0];
}

/** Version entry `e` as the studio's shot. @param {EntryView} e @returns {Shot} */
export function shotFrom(e) {
	const r = e.record ?? {};
	let spec = {};
	try {
		spec = JSON.parse(r.spec);
	} catch {
		// a spec that doesn't parse plays as an empty one
	}
	const at = new Date((r.at ?? e.created ?? 0) * 1000).toISOString();
	return /** @type {Shot} */ ({ id: shotOf(e), name: r.name ?? 'A shot', project: r.project || null, version: r.version ?? 1, spec, created: at, updated: at });
}

/** Every shot this Mac's device holds, at its newest version; none off the Mac app. @param {string} [project] @returns {Promise<Shot[]>} */
export async function listAvenShots(project) {
	const call = await device();
	if (!call) return [];
	/** @type {Map<string, EntryView>} */
	const newest = new Map();
	for (const e of versions(await worldOf(call))) {
		const id = shotOf(e);
		if ((newest.get(id)?.record?.version ?? 0) < (e.record?.version ?? 0)) newest.set(id, e);
	}
	return [...newest.values()].map(shotFrom).filter((s) => !project || s.project === project);
}

/** Shot `id` at version `v` (its newest when none is named). @param {string} id @param {number} [v] @returns {Promise<Shot>} */
export async function getAvenShot(id, v) {
	const call = await device();
	if (!call) throw new Error('This world shot lives in avenDB, which is open only in the Mac app.');
	const e = versionEntry(await worldOf(call), id, v);
	if (!e) throw Object.assign(new Error('No such shot on this Mac.'), { status: 404 });
	return shotFrom(e);
}

/**
 * A version entry's record.
 * @param {string} shot the shot it is a version of, or `""` for the first @param {string} name @param {string | null | undefined} project
 * @param {number} version @param {unknown} spec
 */
const recordOf = (shot, name, project, version, spec) => ({ kind: SHOT, shot, name, project: project ?? '', version, spec: JSON.stringify(spec), at: Math.floor(Date.now() / 1000) });

/** A new shot in the person's home vault (./cuts.js `homeOf`). @param {{ name: string, project?: string | null, spec: unknown }} s @returns {Promise<Shot>} */
export async function createAvenShot(s) {
	const call = await device();
	if (!call) throw new Error('avenDB is not open in this app.');
	let world = await worldOf(call);
	const home = homeOf(world);
	if (!home) throw new Error('No avenDB vault to keep the shot in.');
	await schemaIn(call, world, home.vault, SHOT_V1, home.as);
	const made = answer(await call('run', { op: 'create', vault: home.vault, type: SHOT, value: recordOf('', s.name, s.project, 1, s.spec), as: home.as }));
	world = await worldOf(call);
	const e = world.entries.find((x) => x.entry === made.entry);
	if (!e) throw new Error('The shot was made but this Mac does not show it yet.');
	return shotFrom(e);
}

/** Shot `id` changed: a new version beside its others (a clip cut with an older one keeps playing that). @param {string} id @param {{ name?: string, spec?: unknown }} s @returns {Promise<Shot>} */
export async function saveAvenShot(id, s) {
	const call = await device();
	if (!call) throw new Error('avenDB is not open in this app.');
	let world = await worldOf(call);
	const last = versionEntry(world, id);
	if (!last) throw new Error('No such shot on this Mac.');
	const was = shotFrom(last);
	const value = recordOf(id.slice(5), s.name ?? was.name, was.project, was.version + 1, s.spec ?? was.spec);
	const made = answer(await call('run', { op: 'create', vault: last.vault, type: SHOT, value, as: asIn(world, last.vault) }));
	world = await worldOf(call);
	const e = world.entries.find((x) => x.entry === made.entry);
	if (!e) throw new Error('The shot was saved but this Mac does not show it yet.');
	return shotFrom(e);
}
