import { refs } from './ops.js';

/** Execute a fixed plan with core-refreshed dependency receipts. This is sequential,
 * not atomic: accepted results survive a later refusal or dependency-read failure.
 * @param {{ send: (op: any) => Promise<any>, checks: any[], ops: any[], current?: () => boolean }} options
 */
export async function guardedPlan({ send, checks, ops, current = () => true }) {
	const done = [];
	let guards = checks;
	for (const op of ops) {
		if (!current()) return { done, complete: false, reason: 'View or actor changed' };
		let response;
		try { response = await send({ op: 'guarded', checks: guards, change: refs(op, done) }); }
		catch { return { done, complete: false, reason: 'Transport failed; last step acceptance is unknown. Check its state before replanning' }; }
		if (!response?.ok) return { done, complete: false, reason: response?.why ?? response?.refused ?? 'Change was not accepted', refusalCode: response?.refused ?? null };
		const accepted = response.ok;
		done.push(accepted.value);
		if (accepted.canContinue !== true || !Array.isArray(accepted.guards)) {
			return { done, complete: false, reason: accepted.continuationError ?? 'Change accepted; remaining dependencies unavailable' };
		}
		guards = accepted.guards;
	}
	return { done, complete: true, reason: null };
}
