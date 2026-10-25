import { flowsFor, moving, STORY, CONTENT, stageOf, stageTag } from './flows.js';
import { seedCity } from './vaults.js';
import { guardedPlan } from './guarded-plan.js';

/** Capture only the canonical local inputs used to plan a Story stage change.
 * Every receipt is rechecked by core at the actual write/approval continuation.
 * @param {{api:any, actor:string, entry:string, to:string, current:()=>boolean, about?:string}} args */
export async function guardedStoryTransition({ api, actor, entry, to, current, about = 'story' }) {
	/** @type {any[]} */
	const checks = [];
	const capture = async (/** @type {any} */ query, requireComplete = false) => {
		if (!current()) throw new Error('View or actor changed');
		const out = await api.ask({ op: 'read_guard', query, requireComplete });
		if (!out?.ok?.guard) throw new Error(out?.refused ?? 'Local dependencies are unavailable');
		checks.push(out.ok.guard);
		return out.ok.value;
	};
	try {
		const summary = await capture({ op: 'world_summary' });
		const target = await capture({ op: 'entry_views', entries: [entry], as: actor });
		const item = target.rows?.find((/** @type {any} */ row) => row.entry === entry);
		if (!item || item.deleted || !(item.writers ?? []).includes(actor)) throw new Error('The story is not locally writable');
		const ownQuery = { op: 'entry_views', vault: item.vault, as: actor, types: ['flow', 'function', 'post'] };
		const own = await capture(ownQuery, true);
		const city = seedCity(summary)?.id;
		const trustedQuery = city && city !== item.vault ? { op: 'entry_views', vault: city, as: actor, types: ['flow', 'function'] } : null;
		const trusted = trustedQuery ? await capture(trustedQuery, true) : { rows: [] };
		let world = { ...summary, entries: [...own.rows, ...trusted.rows, item] };
		const flow = flowsFor(world, item.vault, about)[0] ?? (about === 'post' ? CONTENT : STORY);
		const from = stageOf(item, flow);
		const destination = flow.stages.find(stage => stage.key === to);
		// Flow fallback and function/post enumeration make absence decisions even
		// for private transitions, so their inventories above remain strict.
		// Only exact target/summary reads are positive-only. Public transitions
		// additionally require the profile/file domain.
		if (from?.public || destination?.public) {
			const publicInputs = await capture({ ...ownQuery, types: ['flow', 'function', 'post', 'profile', 'file'] }, true);
			if (trustedQuery) await capture(trustedQuery, true);
			world = { ...world, entries: [...new Map([...world.entries, ...publicInputs.rows].map(row => [row.entry, row])).values()] };
		}
		if (from?.public) {
			const users = await capture({ op: 'entry_views', vault: item.vault, tag: stageTag(flow.key, from.key), as: actor }, true);
			const rows = new Map([...world.entries, ...users.rows].map(row => [row.entry, row]));
			world = { ...world, entries: [...rows.values()] };
		}
		const { ops, errors } = await moving(world, actor, item, flow, to, about === 'post');
		if (errors.length) throw new Error(errors.join(' · '));
		return await guardedPlan({ checks, ops, current, send: async op => {
			const value = await api.run(about === 'post' ? 'Moving the post' : 'Moving the story', op);
			return value == null ? { refused: 'Change not accepted; remaining plan stopped' } : { ok: value };
		} });
	} catch (error) {
		return { done: [], complete: false, reason: error instanceof Error ? error.message : 'Local dependencies unavailable' };
	}
}
