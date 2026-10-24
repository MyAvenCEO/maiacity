import { reads } from './ops.js';
import { beginReactiveTiming } from './reactive-latency.js';

/** Targeted authorized reads shared by every avenDB consumer. Revisions coalesce
 * without invalidating in-flight answers. Query/owner changes abort the previous
 * scope and start independently; old engine work may finish but cannot publish.
 * There is at most one read per scope, without a timeout spawning duplicate work.
 * @param {{ read: (owner: any, query: any, signal: AbortSignal) => Promise<any>,
 *   take: (answer: any) => void, failed?: (error: Error) => void, timing?: typeof beginReactiveTiming }} options */
export function createReactiveRead({ read, take, failed = () => {}, timing = beginReactiveTiming }) {
	let closed = false;
	/** @type {{ owner: any, query: any, key: string, controller: AbortController, running: boolean, again: boolean, emitted: (answer: any) => void } | null} */
	let scope = null;
	/** @param {NonNullable<typeof scope>} s */
	async function pump(s) {
		if (s.running) return;
		s.running = true;
		try {
			while (s.again && scope === s && !closed) {
				s.again = false;
				try {
					if (!reads(s.query)) throw new Error('An avenDB observer accepts read operations only.');
					const answer = await read(s.owner, s.query, s.controller.signal);
					if (scope === s && !closed) { take(answer); s.emitted(answer); }
				} catch (error) {
					if (scope === s && !closed) failed(error instanceof Error ? error : new Error(String(error)));
				}
			}
		} finally { s.running = false; }
	}
	return {
		/** @param {any} query @param {any} owner @param {string} [context] */
		update(query, owner, context = '') {
			if (closed) return;
			const key = JSON.stringify([context, query]);
			if (!scope || scope.owner !== owner || scope.key !== key) {
				scope?.controller.abort();
				scope = { owner, query, key, controller: new AbortController(), running: false, again: false, emitted: timing(query) };
			}
			if (!query || !owner) return;
			scope.again = true;
			void pump(scope);
		},
		close() { closed = true; scope?.controller.abort(); scope = null; }
	};
}
