// @ts-nocheck — plain JS
/*
 * The one checker (game/code/check.js) as the pages use it, with the types only a page has: an asset's card, judged
 * by the asset schemas ($lib/assets/schemas). The API checks the same types from game/, which it carries; it never
 * reads asset cards.
 */
import { TYPES, checkCode, define } from '../../../game/code/check.js';
import { checkCard } from '../assets/schemas/index.js';

if (!TYPES['asset-card'])
	define('asset-card', {
		what: "An asset's card, what its pack says of it (src/lib/assets/schemas/card.v1.json)",
		check(raw) {
			const r = checkCard(raw);
			return r.ok ? { ok: true, value: r.value, notes: [] } : { ok: false, errors: r.errors };
		}
	});

export { TYPES, checkCode };
