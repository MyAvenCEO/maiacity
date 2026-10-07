/**
 * SANDBOX 6 · AUTOPLAY — a player that builds the whole economy by itself, step by step, the way a person would:
 * wood first, then stone and food, the market hall and its orders (iron and tools come by trade), and then ever more food
 * for a valley that needs it. The film camera grows its valley with it (a settlement that is already busy), and it
 * plays a whole game headless to prove every chain runs end to end.
 */
import { BUILDINGS, WATER } from './rules.js';
import { PLAYER } from './sim.js';

/** the plan: what to build, in order, and where it would rather stand */
const PLAN = [
	['woodcutter', 'trees'],
	['sawmill', 'home'],
	['quarry', 'rocks'],
	['woodcutter', 'trees'],
	['forester', 'woodcutter'],
	['fishery', 'water'],
	['well', 'home'],
	['farm', 'open'],
	['market', 'fair'],
	['fishery', 'water'],
	['mill', 'home'],
	['bakery', 'home'],
	['farm', 'open'],
	['livestock', 'home'],
	['coalmine', 'mine'],
	['toolmaker', 'home'],
	['boundary', 'fair'],
	['fishery', 'water'],
	['farm', 'open'],
	['livestock', 'home'],
	['well', 'home'],
	['boundary', 'south'],
	['fishery', 'water'],
	['quarry', 'rocks'],
	['farm', 'open'],
	['mill', 'home'],
	['bakery', 'home'],
	['fishery', 'water'],
	['woodcutter', 'trees'],
	['forester', 'woodcutter'],
	['livestock', 'home'],
	['farm', 'open'],
	['well', 'home']
];

/** what it adds while a neighbour goes short of food */
const MORE = [[['fishery', 'water']], [['farm', 'open'], ['livestock', 'home']], [['fishery', 'water']], [['well', 'home'], ['bakery', 'home']]];

/** the standing orders it sets once a market hall stands: sell food, buy building goods, tools and iron */
const ORDERS = {
	fish: { sell: true, above: 2, keep: 12, buy: false, below: 0, upTo: 0 },
	bread: { sell: true, above: 3, keep: 10, buy: false, below: 0, upTo: 0 },
	meat: { sell: true, above: 3, keep: 10, buy: false, below: 0, upTo: 0 },
	// building goods from the neighbours: buying them is how their coins come back to them for food
	plank: { sell: false, above: 0, keep: 0, buy: true, below: 6, upTo: 60 },
	stone: { sell: false, above: 0, keep: 0, buy: true, below: 10, upTo: 40 },
	tools: { sell: false, above: 0, keep: 0, buy: true, below: 40, upTo: 8 },
	// coal and grain from the neighbours: what you buy is how their coins come back to them
	coal: { sell: false, above: 0, keep: 0, buy: true, below: 7, upTo: 30 },
	grain: { sell: false, above: 0, keep: 0, buy: true, below: 3, upTo: 20 },
	iron: { sell: false, above: 0, keep: 0, buy: true, below: 18, upTo: 6 }
};

/**
 * Plays a game one decision at a time: call `tick()` now and then (every few seconds of game time).
 * @param {import('./sim.js').Sim} sim
 */
export function createAutoplay(sim) {
	const st = sim.state, g = sim.grid;
	st.auto ??= 0;
	/** @type {string[][]} the plan as this game follows it (a used-up mine adds its rebuilding) */
	st.autoPlan ??= PLAN.map((x) => [...x]);
	const plan = st.autoPlan;
	let tries = 0;
	const hq = () => st.buildings[st.hq];
	const fair = () => st.buildings[st.fair];
	const count = (/** @type {(n: number) => boolean} */ f, /** @type {number} */ n, /** @type {number} */ r) => g.within(n, r).filter(f).length;
	const ofType = (/** @type {string} */ t) => Object.values(st.buildings).filter((b) => b.type === t && b.owner === PLAYER);

	/** how well a node suits a building: higher is better, -Infinity where it may not stand */
	function score(/** @type {string} */ type, /** @type {string} */ want, /** @type {number} */ n) {
		if (sim.canBuild(type, n)) return -Infinity;
		const home = hq().node;
		const d = g.dist(home, n);
		const east = g.x(n) - g.x(home);
		switch (want) {
			case 'trees':
				return count((j) => st.obj[j]?.k === 'tree', n, 5) * 3 - d;
			case 'rocks':
				return count((j) => st.obj[j]?.k === 'rock', n, 4) * 4 - d;
			case 'water':
				return count((j) => st.terrain[j] === WATER, n, 3) * 2 - d * 1.5;
			case 'woodcutter': {
				const w = ofType('woodcutter')[0];
				return w ? -g.dist(w.node, n) * 2 - d * 0.3 : -d;
			}
			case 'mine': {
				const ore = /** @type {string} */ (BUILDINGS[type].ore);
				const code = ore === 'coal' ? 1 : ore === 'iron' ? 2 : 3;
				return count((j) => st.ore[j] === code, n, 2) * 3 - d;
			}
			case 'open':
				return count((j) => !st.obj[j] && st.terrain[j] === 0, n, 2) - d;
			case 'fair':
				// toward the fair, on the way the traders go
				return -g.dist(n, fair()?.node ?? n) - d * 0.2;
			case 'south':
				return g.z(n) - g.z(home) + east * 0.3;
			default:
				return -d - (count((j) => st.obj[j]?.k === 'bld', n, 3) > 3 ? 4 : 0);
		}
	}
	function place(/** @type {string} */ type, /** @type {string} */ want) {
		const spots = [];
		for (let n = 0; n < g.N; n++) {
			if (st.owner[n] !== PLAYER) continue;
			const s = score(type, want, n);
			if (s > -Infinity) spots.push([s, n]);
		}
		spots.sort((a, b) => b[0] - a[0]);
		for (const [, n] of spots.slice(0, 6)) {
			const r = sim.build(type, n, true);
			if (r.ok && r.linked) return true;
			if (r.ok) sim.demolish(n);
		}
		return false;
	}
	/** split long roads with flags, so more carriers share the load */
	function flags() {
		for (const r of Object.values(st.roads)) {
			if (r.path.length < 6) continue;
			const k = Math.floor(r.path.length / 2);
			if (!sim.canFlag(r.path[k])) {
				sim.flag(r.path[k]);
				return;
			}
		}
	}
	return {
		tick() {
			if (st.result) return;
			flags();
			// a used-up mine is torn down and dug again elsewhere
			for (const b of Object.values(st.buildings))
				if (b.owner === PLAYER && b.deposit <= 0 && BUILDINGS[b.type].kind === 'mine' && b.stage === 'live') {
					sim.demolish(b.node);
					plan.splice(st.auto, 0, [b.type, 'mine']);
				}
			const s = sim.summary();
			if (st.auto < plan.length) {
				const [type, want] = plan[st.auto];
				const cost = BUILDINGS[type].cost;
				const sites = Object.values(st.buildings).filter((b) => b.owner === PLAYER && b.stage === 'site').length;
				const enough = Object.entries(cost).every(([w, n]) => (s.stock[w] ?? 0) >= n);
				if (sites < 3 && (enough || tries > 8)) {
					if (place(type, want) || ++tries > 12) {
						st.auto++;
						tries = 0;
					}
				} else tries++;
			}
			// once the plan is built, more water while yours runs short, more food while anyone goes short
			if (st.auto >= plan.length && plan.length < PLAN.length + 40 && st.time >= (st.autoMore ?? 0)) {
				st.autoMore = st.time + 180;
				if (st.parties[PLAYER].sat.water < 0.9) plan.push(['well', 'home']);
				else if (st.parties.some((/** @type {any} */ p) => p.sat.food < 0.85)) plan.push(...MORE[(plan.length - PLAN.length) % MORE.length]);
			}
			// once a market hall stands: the orders, and every request it can fill
			if (ofType('market').some((b) => b.stage === 'live')) {
				for (const [w, o] of Object.entries(ORDERS)) if (!st.orders[w]) sim.order(w, o);
				// requests and pleas alike: what helps a neighbour helps the valley
				for (const c of st.market.contracts) if (!c.taken && c.got < c.n && c.until > st.time + 120 && (s.stock[c.w] ?? 0) >= c.n / 3) sim.take(c.id);
			}
		},
		get step() {
			return st.auto;
		}
	};
}
