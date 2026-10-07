/**
 * SANDBOX 6 · AUTOPLAY — a player that builds the whole economy by itself, step by step, the way a person would:
 * wood and stone first, then food, the market hall and what it trades (iron ore and tools come by trade), and then ever more food
 * for a valley that needs it. The film camera grows its valley with it (a settlement that is already busy), and it
 * plays a whole game headless to prove every chain runs end to end.
 */
import { BUILDINGS, GRASS, IRON, MOUNTAIN, WATER } from './rules.js';
import { PLAYER } from './sim.js';

/** the plan: what to build, in order, and where it would rather stand */
const PLAN = [
	['woodcutter', 'trees'],
	['quarry', 'rocks'],
	['woodcutter', 'trees'],
	['forester', 'woodcutter'],
	['fishery', 'water'],
	['well', 'home'],
	['farm', 'open'],
	['market', 'fair'],
	['fishery', 'water'],
	['bakery', 'home'],
	['farm', 'open'],
	['toolmaker', 'home'],
	['fishery', 'water'],
	['farm', 'open'],
	['bakery', 'home'],
	['well', 'home'],
	['fishery', 'water'],
	['quarry', 'rocks'],
	['farm', 'open'],
	['bakery', 'home'],
	['fishery', 'water'],
	['woodcutter', 'trees'],
	['forester', 'woodcutter'],
	['farm', 'open'],
	['well', 'home']
];

/** what it adds while a neighbour goes short of food */
const MORE = [[['fishery', 'water']], [['farm', 'open'], ['bakery', 'home']], [['fishery', 'water']], [['well', 'home'], ['bakery', 'home']]];

/** what it trades once a market hall stands: food out; building goods, iron ore and tools in (buying the neighbours' wares is how their coins come back to them) */
const ORDERS = /** @type {Record<string, 'sell' | 'buy'>} */ ({ fish: 'sell', bread: 'sell', plank: 'buy', stone: 'buy', tools: 'buy', ore: 'buy' });

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
				return count((j) => st.ore[j] === IRON, n, 2) * 3 - d;
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
	/** whether a building could stand on a spot once its settlement has a house: '' if so, 'house' if the house comes first */
	function fits(/** @type {string} */ type, /** @type {number} */ n) {
		const why = sim.canBuild(type, n);
		if (!why) return '';
		if (type === 'house' || (why !== 'Build this settlement’s house first' && why !== 'Outside your city')) return null;
		const house = sim.plan.spots[sim.plan.plotOf[n]][0];
		if (house < 0 || sim.canBuild('house', house)) return null;
		// the house would make the spot buildable: everything else about it must already be fine
		if (st.obj[n] || st.road[n]) return null;
		const t = BUILDINGS[type];
		if (t.on === 'mountain' ? st.terrain[n] !== MOUNTAIN : st.terrain[n] !== GRASS) return null;
		if (type === 'fishery' && !g.within(n, 4).some((j) => st.terrain[j] === WATER)) return null;
		if (t.kind === 'mine' && !g.within(n, 2).some((j) => st.ore[j] === IRON && st.amount[j] > 0)) return null;
		return 'house';
	}
	function place(/** @type {string} */ type, /** @type {string} */ want) {
		const spots = [];
		const kind = type === 'house' ? 0 : -1;
		for (let n = 0; n < g.N; n++) {
			const sp = sim.plan.spotOf[n];
			if (sp < 0 || (kind === 0 ? sp !== 0 : sp === 0)) continue;
			const f = fits(type, n);
			if (f === null) continue;
			const s = score(type, want, n) - (f ? 6 : 0);
			if (s > -Infinity) spots.push([s, n, f]);
		}
		spots.sort((a, b) => /** @type {number} */ (b[0]) - /** @type {number} */ (a[0]));
		for (const [, n, f] of spots.slice(0, 12)) {
			const node = /** @type {number} */ (n);
			if (f === 'house') {
				const h = sim.plan.spots[sim.plan.plotOf[node]][0];
				const r = sim.build('house', h, true);
				if (!r.ok) continue;
				if (!r.linked) {
					sim.demolish(h);
					continue;
				}
			}
			const r = sim.build(type, node, true);
			if (r.ok && r.linked) return true;
			if (r.ok) sim.demolish(node);
		}
		if (!spots.length && type !== 'house') expand(want);
		return false;
	}
	/** what a building looks for out in the land */
	const LOOKS = /** @type {Record<string, (j: number) => boolean>} */ ({
		trees: (j) => st.obj[j]?.k === 'tree',
		rocks: (j) => st.obj[j]?.k === 'rock',
		water: (j) => st.terrain[j] === WATER,
		mine: (j) => st.ore[j] === IRON
	});
	/** no spot anywhere in reach: found a house in the next village toward what it needs */
	function expand(/** @type {string} */ want) {
		const look = LOOKS[want];
		if (!look) return false;
		let best = -1, bd = Infinity;
		for (let n = 0; n < g.N; n++) {
			if (sim.plan.spotOf[n] !== 0 || sim.canBuild('house', n)) continue;
			let d = Infinity;
			for (const j of g.within(n, 7)) if (look(j)) d = Math.min(d, g.dist(n, j));
			d += g.dist(n, hq().node) * 0.1;
			if (d < bd) (bd = d), (best = n);
		}
		if (best < 0) return false;
		const r = sim.build('house', best, true);
		if (r.ok && !r.linked) sim.demolish(best);
		return r.ok && r.linked;
	}
	/** beds before people: enlarge the smallest house, or found a new one, when the city is nearly full */
	function homes(/** @type {any} */ s) {
		// one great house, for the goal, once there is wood and stone to spare
		const great = ofType('house').filter((b) => b.stage === 'live' && b.level < 4).sort((a, b) => b.level - a.level)[0];
		if (!st.goals.house && great && (s.stock.plank ?? 0) >= 16 && (s.stock.stone ?? 0) >= 10 && !ofType('house').some((b) => b.stage === 'site')) return void sim.upgrade(great.id);
		// only while the city lives well enough to feed more
		if (s.people < s.beds - 1 || s.settlers >= 4 || (s.people >= 24 && st.parties[PLAYER].wb < 70)) return;
		const houses = ofType('house');
		if (houses.some((b) => b.stage === 'site')) return;
		const small = houses.filter((b) => b.level < 4).sort((a, b) => b.level - a.level)[0];
		if (small) {
			const up = sim.inspect(small.id)?.up ?? {};
			if (Object.entries(up).every(([w, n]) => (s.stock[w] ?? 0) >= /** @type {number} */ (n) + 2)) return void sim.upgrade(small.id);
		}
		if ((s.stock.plank ?? 0) >= 6 && (s.stock.stone ?? 0) >= 3) place('house', 'home');
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
			homes(s);
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
