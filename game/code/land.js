// @ts-nocheck — plain JS, kept loose on purpose
/**
 * LANDING — what a decision writes into code/. Samuel (2026-10-16): the repo is the truth for what runs until avenDB
 * carries code; the admin accepts a MIP in the app as before, and its cards go live once the PR that writes them into
 * code/ is merged. An agent's Generated UI view is a draft until the admin keeps it and it lands the same way.
 *
 * The landing job (.github/workflows/code-land.yml) reads what waits to land from the database
 * (deploy/code-export.sh), hands it here with the entries code/ holds, writes the files that come back, and merges
 * them by PR; the API lands each MIP whose entry it finds (api/src/economy.js, landMips) and drops each draft that
 * landed (api/src/genui.js). Everything is checked again here by the one checker (./check.js), and an id becomes a
 * path only after it passed its pattern.
 *
 *   landing({ versions?, configs?, mips?, views? }, have) -> { files: { path under code/: text }, landed, refused }
 *
 *   versions  every Sandbox 7 config version (the first export: econ_config_versions)  { config, version, body, mip, at }
 *   configs   every config row, for the ones deleted                                    { id, deleted }
 *   mips      accepted MIPs waiting to land                                             { number, title, action, ... }
 *   views     Generated UI views to keep (every one, the first time)                    { id, title, note, kind, spec }
 *
 * A MIP already in code/ is never written again, so a job that runs while the last one's deploy is still on its way
 * changes nothing.
 */
import { checkCode } from './check.js';
import { applyCards, defaultCards } from '../economy/params.js';
import { canonical, cardsOfFiles, cardsToFiles, jsonFile, viewToFiles } from './files.js';

export const GAME = 'sandbox-7';
const CONFIG_ID = /^[a-z][a-z0-9-]{1,40}$/;
const ACTIONS = ['edit', 'create', 'delete', 'world', 'amend'];

const iso = (t) => {
	const d = new Date(t ?? 0);
	return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
// one line of plain text (a title in a commit message and a log, where a new line could start a command)
const line = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const prefix = (dir, files) => Object.fromEntries(Object.entries(files).map(([n, t]) => [`${dir}/${n}`, t]));

/** a config version as its files */
function versionFiles(id, v) {
	const entry = { type: 'config', for: GAME, id, version: v.version, name: v.name, description: v.description ?? '', mip: v.mip ?? null, at: v.at, ...(v.deleted ? { deleted: true } : {}) };
	return prefix(`configs/${GAME}/${id}/v${v.version}`, { 'entry.json': jsonFile(entry), ...cardsToFiles(v.cards) });
}

/** checked cards, or the first reason one is refused */
function checked(list, mode) {
	const cards = [];
	for (const raw of Array.isArray(list) ? list : []) {
		const r = checkCode('rule-card', raw, { mode });
		if (!r.ok) return { error: r.errors[0] };
		if (cards.some((c) => c.id === r.value.id)) return { error: `card ${r.value.id} is in it twice` };
		cards.push(r.value);
	}
	return { cards };
}

export function landing(exported, have = {}) {
	const files = {};
	const landed = [];
	const refused = [];
	// every config's versions: those code/ holds, and those written here
	const versions = {};
	for (const e of Object.values(have)) if (e.type === 'config' && e.for === GAME) (versions[e.id] ??= {})[e.version] = { ...e, cards: cardsOfFiles(e.files) };
	const latest = (id) => {
		const vs = Object.values(versions[id] ?? {}).sort((a, b) => b.version - a.version);
		return vs[0] ?? null;
	};
	const put = (id, v) => {
		(versions[id] ??= {})[v.version] = v;
		Object.assign(files, versionFiles(id, v));
	};

	// the first export: every config version the database kept, and a last one for a config it deleted
	const fromDb = {};
	for (const v of exported?.versions ?? []) {
		const id = String(v?.config ?? '');
		const n = Number(v?.version);
		if (!CONFIG_ID.test(id) || !Number.isInteger(n) || n < 1) {
			refused.push(`config version ${JSON.stringify(id).slice(0, 50)} v${line(v?.version, 10)}: not a config id and version`);
			continue;
		}
		if (versions[id]?.[n]) continue;
		const c = checked(v.body?.cards, 'read'); // kept long ago: only its shape is checked again
		if (c.error) {
			refused.push(`config ${id} v${n}: ${c.error}`);
			continue;
		}
		put(id, { version: n, name: String(v.body?.name ?? id).slice(0, 80), description: String(v.body?.description ?? '').slice(0, 2000), mip: v.mip == null ? null : Number(v.mip), at: iso(v.at), cards: c.cards });
		(fromDb[id] ??= []).push(n);
	}
	for (const c of exported?.configs ?? []) {
		const last = CONFIG_ID.test(String(c?.id ?? '')) && c.deleted ? latest(c.id) : null;
		if (!last || last.deleted) continue;
		put(c.id, { ...last, version: last.version + 1, mip: null, at: iso(c.deleted), deleted: true });
		(fromDb[c.id] ??= []).push(last.version + 1);
	}
	for (const [id, ns] of Object.entries(fromDb).sort(([a], [b]) => a.localeCompare(b))) landed.push(`Config ${id}: version${ns.length > 1 ? 's' : ''} ${ns.sort((a, b) => a - b).join(', ')} from the database`);

	// accepted MIPs, in their order: the MIP as it landed, and the config version it makes
	for (const m of [...(exported?.mips ?? [])].sort((a, b) => Number(a?.number) - Number(b?.number))) {
		const n = Number(m?.number);
		const what = `MIP ${Number.isInteger(n) ? n : '?'}`;
		if (!Number.isInteger(n) || n < 1) {
			refused.push(`${what}: no number`);
			continue;
		}
		if (have[`mips/${GAME}/${n}`]) continue;
		const action = m.action;
		const config = String(m.config ?? '');
		if (!ACTIONS.includes(action) || !CONFIG_ID.test(config)) {
			refused.push(`${what}: no action or config`);
			continue;
		}
		const c = checked(m.cards, 'write');
		if (c.error) {
			refused.push(`${what}: ${line(c.error, 400)}`);
			continue;
		}
		const remove = (Array.isArray(m.remove) ? m.remove : []).map(String).filter((id) => /^[a-z][a-z0-9_-]{1,40}$/.test(id));
		const at = iso(m.decided);
		let made = null;
		if (action === 'edit' || action === 'delete') {
			const base = latest(config);
			if (!base || base.deleted) {
				refused.push(`${what}: no config ${config} to ${action}`);
				continue;
			}
			made =
				action === 'delete'
					? { ...base, version: base.version + 1, mip: n, at, deleted: true }
					: { version: base.version + 1, name: m.name ?? base.name, description: m.about ?? base.description, mip: n, at, cards: applyCards(base.cards, c.cards, remove) };
		} else if (action === 'create') {
			if (latest(config)) {
				refused.push(`${what}: there is already a config ${config}`);
				continue;
			}
			const from = m.from ? latest(String(m.from)) : null;
			if (m.from && (!from || from.deleted)) {
				refused.push(`${what}: no config ${line(m.from, 41)} to start from`);
				continue;
			}
			made = { version: 1, name: m.name || config, description: m.about ?? '', mip: n, at, cards: applyCards(from ? from.cards : defaultCards(), c.cards, remove) };
		}
		const entry = {
			type: 'mip',
			for: GAME,
			number: n,
			title: line(m.title, 160),
			action,
			config,
			...(m.name != null ? { name: String(m.name).slice(0, 80) } : {}),
			...(m.about != null ? { about: String(m.about).slice(0, 2000) } : {}),
			...(m.from ? { from: String(m.from).slice(0, 41) } : {}),
			...(m.world_id ? { world_id: String(m.world_id).slice(0, 41) } : {}),
			...(m.world ? { world: m.world } : {}),
			remove,
			accepted: at
		};
		Object.assign(files, prefix(`mips/${GAME}/${n}`, { 'entry.json': jsonFile(entry), ...cardsToFiles(c.cards) }));
		if (made) put(config, made);
		const title = entry.title ? ` “${entry.title}”` : '';
		landed.push(
			action === 'world'
				? `MIP ${n}${title}: a new world${m.world?.name ? `, ${line(m.world.name, 80)}` : ''}`
				: action === 'amend'
					? `MIP ${n}${title}: amends a world's rules`
					: `MIP ${n}${title}: config ${config} ${made.deleted ? 'deleted' : `version ${made.version}`}`
		);
	}

	// Generated UI views to keep: only what passes the one checker with nothing left doing nothing
	for (const raw of exported?.views ?? []) {
		const r = checkCode('view', raw);
		const id = r.ok ? r.value.id : line(raw?.id ?? '?', 48);
		if (!r.ok || r.notes.length) {
			refused.push(`view ${id}: ${line((r.ok ? r.notes : r.errors).join(' '), 400)}`);
			continue;
		}
		const there = have[`views/${id}`];
		if (there && there.for !== 'genui') {
			refused.push(`view ${id}: that id is ${there.for}'s screen`);
			continue;
		}
		const made = viewToFiles(r.value);
		const { 'entry.json': entryText, ...own } = made;
		if (there && canonical(JSON.parse(entryText)) === canonical(entryOf(there)) && canonical(own) === canonical(there.files)) continue;
		Object.assign(files, prefix(`views/${id}`, made));
		landed.push(`View ${id} “${line(r.value.title, 80)}” (Generated UI)${there ? ', changed' : ''}`);
	}
	return { files, landed, refused };
}

/** an entry's entry.json as it was written: without what the index adds */
const entryOf = (e) => {
	const { ref, files, hash, ...entry } = e;
	return entry;
};
