/**
 * SANDBOX 6 · THE BUILDING TREE — the valley's chains as a graph, laid out in columns from the land to the last ware:
 * each building stands one column after the wares it needs, each ware one column after the building that makes it.
 * Read from the rules (./rules.js), so it always shows the game as it is. The page draws it (./Tree.svelte).
 */
import { BUILDINGS, FOOD, WARES } from './rules.js';
import { NEEDS } from './market.js';

/** where in the land a gatherer finds its work */
export const SOURCE = /** @type {Record<string, string>} */ ({
	woodcutter: 'grown trees',
	forester: 'free grass',
	quarry: 'rocks',
	fishery: 'a lake',
	farm: 'open grass',
	well: 'anywhere',
	ironmine: 'iron rock'
});
/** the wares people live on (what wellbeing counts) */
export const LIVED_ON = new Set([...FOOD, ...Object.keys(NEEDS).filter((n) => n !== 'food')]);

/** buildings that make or gather something: the chains */
const CHAIN = Object.values(BUILDINGS).filter((b) => b.group && (b.out || b.kind === 'forester'));
/** the rest you build: houses and village centers */
export const OTHERS = Object.values(BUILDINGS).filter((b) => b.group && !CHAIN.includes(b));

/**
 * @typedef {{ id: string, kind: 'building' | 'ware', col: number, row: number, x: number, y: number }} TreeNode
 * @typedef {{ from: string, to: string, alt: boolean }} TreeEdge
 */

/** the tree, laid out: nodes in columns, edges ware → building (an input) and building → ware (what it makes) */
export function chainTree(colW = 168, rowH = 50) {
	/** @type {Record<string, number>} */
	const wareLevel = {};
	/** @type {Record<string, number>} */
	const bLevel = {};
	// a building comes after the wares it needs: the latest of its slots, the earliest ware of a slot that takes any one
	for (let pass = 0; pass < 12; pass++)
		for (const b of CHAIN) {
			const slots = b.inputs ?? [];
			let lv = 0;
			for (const slot of slots) {
				const ws = slot.map((w) => wareLevel[w]).filter((x) => x !== undefined);
				lv = Math.max(lv, ws.length ? Math.min(...ws) + 1 : 99);
			}
			if (lv >= 99) continue;
			bLevel[b.id] = lv;
			if (b.out) wareLevel[b.out] = Math.min(wareLevel[b.out] ?? Infinity, lv);
		}
	/** @type {TreeNode[]} */
	const nodes = [];
	/** @type {Map<number, string[]>} */
	const cols = new Map();
	const put = (/** @type {string} */ id, /** @type {number} */ col) => cols.set(col, [...(cols.get(col) ?? []), id]);
	for (const b of CHAIN) if (bLevel[b.id] !== undefined) put(`b:${b.id}`, bLevel[b.id] * 2);
	for (const [w, lv] of Object.entries(wareLevel)) put(`w:${w}`, lv * 2 + 1);
	// keep a ware level with the building that makes it, and a building near the wares it takes
	const order = Object.keys(WARES);
	const rows = Math.max(...[...cols.values()].map((c) => c.length));
	/** @type {Record<string, number>} */
	const at = {};
	for (const col of [...cols.keys()].sort((a, b) => a - b)) {
		const ids = /** @type {string[]} */ (cols.get(col));
		const want = (/** @type {string} */ id) => {
			if (id.startsWith('w:')) {
				const maker = CHAIN.find((b) => b.out === id.slice(2) && bLevel[b.id] * 2 === col - 1);
				return maker ? at[`b:${maker.id}`] ?? 0 : order.indexOf(id.slice(2));
			}
			const b = BUILDINGS[id.slice(2)];
			const ins = (b.inputs ?? []).flat().map((w) => at[`w:${w}`]).filter((x) => x !== undefined);
			return ins.length ? ins.reduce((a, c) => a + c, 0) / ins.length : CHAIN.indexOf(b) * 0.01;
		};
		ids.sort((a, b) => want(a) - want(b));
		const taken = new Set();
		for (const id of ids) {
			let r = Math.max(0, Math.round(want(id)));
			if (col === 0) r = ids.indexOf(id);
			while (taken.has(r)) r++;
			taken.add(r);
			at[id] = r;
		}
	}
	for (const [col, ids] of cols)
		for (const id of ids) nodes.push({ id, kind: id.startsWith('b:') ? 'building' : 'ware', col, row: at[id], x: col * colW, y: at[id] * rowH });
	/** @type {TreeEdge[]} */
	const edges = [];
	for (const b of CHAIN) {
		if (bLevel[b.id] === undefined) continue;
		// a slot that takes any one ware: drawn from those that come before it (fish feeds the first miners)
		for (const slot of b.inputs ?? []) for (const w of slot) if (wareLevel[w] !== undefined && wareLevel[w] < bLevel[b.id]) edges.push({ from: `w:${w}`, to: `b:${b.id}`, alt: slot.length > 1 });
		if (b.out) edges.push({ from: `b:${b.id}`, to: `w:${b.out}`, alt: false });
	}
	const width = (Math.max(...nodes.map((n) => n.col)) + 1) * colW;
	const height = (Math.max(rows, ...nodes.map((n) => n.row + 1))) * rowH;
	return { nodes, edges, width, height };
}

/** who in the valley has plenty of a ware, or where it is missing: a line under the ware */
export const TRADE_NOTE = /** @type {Record<string, string>} */ ({
	ore: 'Little in your land: Eastmere has plenty',
	tools: 'Eastmere has plenty',
	fish: 'Your plenty: Highfold has none',
	plank: 'Highfold has plenty',
	grain: 'Your plenty: wide farmland',
	stone: 'Eastmere has plenty'
});
