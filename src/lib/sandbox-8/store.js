// @ts-nocheck — plain JS, kept loose on purpose
// The economy sandbox's link to the database (api/src/economy.js): the configs the valley can run on, MIPs (MaiaCity
// improvement proposals, which are the only way a config changes), and every game run, day by day. In the Mac app the
// calls go out with the app's key; on the site with the admin's session. Nothing here ever holds up the game: when the
// API can't be reached or refuses, the valley plays on its defaults and nothing is saved, and the page says why.

import { apiCall } from '$lib/auth/client';

const post = (path, body) => apiCall(path, { method: 'POST', body: JSON.stringify(body) });

export const loadConfigs = () => apiCall('/api/economy/configs');
export const loadConfig = (id) => apiCall(`/api/economy/configs/${encodeURIComponent(id)}`);
export const loadMips = () => apiCall('/api/economy/mips');
export const propose = (mip) => post('/api/economy/mips', mip);
export const decide = (number, accept, note = '') => post(`/api/economy/mips/${number}/decide`, { accept, note });
export const withdraw = (number) => post(`/api/economy/mips/${number}/withdraw`, {});
export const loadRuns = (limit = 50) => apiCall(`/api/economy/runs?limit=${limit}`);

/**
 * A run being recorded: starts it in the database, then sends each finished day (its stats row, and the trades and
 * Liquid decisions of that day, from world.outbox) every few seconds, and its standing at the end.
 */
export function recorder(world, start) {
	const rec = { id: null, sent: 0, error: '', busy: false, ended: false, pending: {} };
	world.outbox = [];
	const ready = post('/api/economy/runs', start)
		.then((r) => (rec.id = r.id))
		.catch((e) => {
			rec.error = e?.message || 'the run could not be saved';
			world.outbox = null;
		});

	/** take what the world collected into per-day piles */
	function drain() {
		if (!world.outbox) return;
		for (const e of world.outbox.splice(0)) {
			const { kind, ...rest } = e;
			const p = (rec.pending[e.day] ??= { trades: [], decisions: [] });
			(kind === 'trade' ? p.trades : p.decisions).push(rest);
		}
	}

	/** send every finished day not sent yet; `ended` closes the run */
	rec.flush = async (summary, ended = false) => {
		await ready;
		if (!rec.id || rec.busy || rec.ended) return;
		drain();
		const rows = world.stats.slice(rec.sent);
		if (!rows.length && !ended) return;
		rec.busy = true;
		try {
			const days = rows.map((stats) => ({ day: stats.day, stats, ...(rec.pending[stats.day] ?? { trades: [], decisions: [] }) }));
			await post(`/api/economy/runs/${rec.id}/days`, { days, alive: summary?.alive, summary, ended });
			for (const r of rows) delete rec.pending[r.day];
			rec.sent += rows.length;
			rec.error = '';
			if (ended) {
				rec.ended = true;
				world.outbox = null;
			}
		} catch (e) {
			rec.error = e?.message || 'a day could not be saved';
		} finally {
			rec.busy = false;
		}
	};
	return rec;
}

// ---- each aven's brain, kept across runs (mind.js): read when a run starts, written each night. Without the database
// (not signed in, or the API down) they live in this browser instead. ----
const LOCAL = (config) => `sandbox-8-brains-${config}`;
const local = {
	get(config) {
		try {
			return JSON.parse(localStorage.getItem(LOCAL(config)) ?? '{}');
		} catch {
			return {};
		}
	},
	set(config, minds) {
		try {
			localStorage.setItem(LOCAL(config), JSON.stringify(minds));
		} catch {
			/* no storage here */
		}
	}
};
/** { aven name: mind (with pending edits) }; `remote` false keeps them in this browser */
export async function loadMinds(config, remote) {
	if (!remote) return local.get(config);
	const r = await apiCall(`/api/economy/brains/${encodeURIComponent(config)}`);
	return r.brains ?? {};
}
export async function saveMinds(config, minds, remote) {
	if (!remote) return local.set(config, { ...local.get(config), ...minds });
	return apiCall(`/api/economy/brains/${encodeURIComponent(config)}`, { method: 'PUT', body: JSON.stringify({ brains: minds }) });
}
export const forgetMinds = (config, remote) => (remote ? apiCall(`/api/economy/brains/${encodeURIComponent(config)}`, { method: 'DELETE' }) : Promise.resolve(local.set(config, {})));
