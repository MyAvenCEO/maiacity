import { versioned } from '../app/versions.js';

/**
 * @template {{ id: string }} T
 * @param {T[]} items
 * @param {keyof T} key
 * @param {Record<string, (import('../app/versions.js').Change & { build?: any })[]>} [history]
 */
export function registerAssets(items, key, history = {}) {
	const ids = new Set();
	for (const item of items) {
		if (!item.id || /[@:?/]/.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate asset identity: ${item.id}`);
		ids.add(item.id);
		const changes = history[item.id];
		if (changes && (!changes.length || changes.some((change, index) => change.v !== index + 1 || !/^\d{4}-\d{2}-\d{2}$/.test(change.date)))) throw new Error(`Invalid asset history: ${item.id}`);
	}
	const registered = versioned(items, key, history);
	for (const item of registered) {
		for (const version of item.versions) {
			if (!version.kept) continue;
			const build = version.build;
			if (typeof build === 'function') continue;
			if (!Array.isArray(build) || !build.length) throw new Error(`Missing builder: ${item.id}@${version.v}`);
			const variants = new Set();
			for (const variant of build) {
				if (!variant.id || variants.has(variant.id) || typeof variant.make !== 'function') throw new Error(`Invalid variant: ${item.id}@${version.v}`);
				variants.add(variant.id);
			}
		}
	}
	return registered;
}
