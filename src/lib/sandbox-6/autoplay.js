/**
 * SANDBOX 6 · AUTOPLAY — a player that builds the whole economy by itself, step by step, the way a person would:
 * its logistics hub, then homes and wood, steel and glass, then houses until its villages are full (their roofs catch their water),
 * trading planks, steel, fired clay and glass with the world market. Its domes cost real tonnes, so it enlarges a house
 * once its treasury can pay for what its stores lack (it never borrows by choice). The film camera grows its valley with it (a settlement that is
 * already busy), and it plays a whole game headless to prove every chain runs end to end.
 */
import { BUILDINGS, GRASS, HOUSE_MOST, HOUSE_TOP, HOUSE_UP, IRON, MOUNTAIN, RECIPES, SAND, WATER } from './rules.js';
import { WORLD } from './market.js';
import { FOOD_KG, KEEP, PRICE } from './food.js';
import { PLAYER } from './sim.js';

/** the plan: what to build, in order, and where it would rather stand */
const PLAN = [
	// a game starts with no house: homes beside the village center first, so there are hands to build and carry
	['house', 'home'],
	['house', 'home'],
	['woodcutter', 'trees'],
	['ironmine', 'mine'],
	['glassworks', 'sand'],
	['woodcutter', 'trees'],
	['ironmine', 'mine'],
	['woodcutter', 'trees'],
	['clayworks', 'meadow']
];

/** what it trades with the world market (and a neighbour a trade route runs to): it buys planks, steel, clay and glass
 * when short, and exports what it has beyond */
const ORDERS = /** @type {Record<string, 'sell' | 'buy' | 'both'>} */ ({ plank: 'both', steel: 'both', clay: 'both', glass: 'both' });

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
	const hq = () => st.buildings[st.hq];
	const count = (/** @type {(n: number) => boolean} */ f, /** @type {number} */ n, /** @type {number} */ r) => g.within(n, r).filter(f).length;
	const ofType = (/** @type {string} */ t) => sim.buildingList().filter((b) => b.type === t && b.owner === PLAYER);

	/** how well a node suits a building: higher is better, -Infinity where it may not stand */
	function score(/** @type {string} */ type, /** @type {string} */ want, /** @type {number} */ n) {
		const home = hq().node;
		const d = g.dist(home, n);
		const east = g.x(n) - g.x(home);
		switch (want) {
			case 'trees':
				return count((j) => st.obj[j]?.k === 'tree', n, 10) * 2 - d;
			case 'water':
				return count((j) => st.terrain[j] === WATER, n, 7) * 1.5 - d * 1.5;
			case 'woodcutter': {
				const w = ofType('woodcutter')[0];
				return w ? -g.dist(w.node, n) * 2 - d * 0.3 : -d;
			}
			case 'mine': {
				return count((j) => st.ore[j] === IRON, n, 3) * 2 - d;
			}
			case 'meadow':
				return count((j) => !st.obj[j] && st.terrain[j] === GRASS, n, 4) * 0.5 - d;
			case 'sand':
				return count((j) => st.terrain[j] === SAND, n, 6) * 0.5 - d;
			case 'open':
				return count((j) => !st.obj[j] && st.terrain[j] === 0, n, 5) - d;
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
		if (type === 'house' || why !== 'Build this settlement’s house first') return null;
		const house = sim.plan.spots[sim.plan.plotOf[n]][0];
		if (house < 0 || sim.canBuild('house', house)) return null;
		// the house would make the spot buildable: everything else about it must already be fine
		// (a woodcutter or forester fells the tree on its spot, an iron mine breaks the rock)
		const k = st.obj[n]?.k, b = BUILDINGS[type].biome;
		const clears = (b === 'forest' && k === 'tree') || ((b === 'iron' || b === 'stone') && k === 'rock') || ((b === 'meadow' || b === 'sand') && (k === 'tree' || k === 'rock'));
		return (st.obj[n] && !clears) || !suits(type, n) ? null : 'house';
	}
	function place(/** @type {string} */ type, /** @type {string} */ want) {
		const spots = [];
		const kind = type === 'house' ? 0 : -1;
		for (let n = 0; n < g.N; n++) {
			const sp = sim.plan.spotOf[n];
			if (sp < 0 || (kind === 0 ? sp !== 0 : sp === 0)) continue;
			const f = fits(type, n);
			if (f === null || (f === '' && !suits(type, n))) continue;
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
		if (!spots.length && type !== 'house') expand(type);
		return false;
	}
	/** whether a spot's land suits a building, whoever holds it: grass or mountain, and water or iron ore in reach */
	function suits(/** @type {string} */ type, /** @type {number} */ n) {
		const t = BUILDINGS[type];
		if (st.obj[n]?.k === 'bld' || st.road[n]) return false;
		if (t.on === 'mountain' ? st.terrain[n] !== MOUNTAIN : t.on === 'any' ? st.terrain[n] === WATER : st.terrain[n] !== GRASS) return false;
		if (type === 'woodcutter' && !ofType('woodcutter').length) return count((j) => st.obj[j]?.k === 'tree', n, t.range ?? 6) >= 4;
		if (t.ore) return g.within(n, 3).some((j) => st.ore[j] === IRON && st.amount[j] > 0);
		return true;
	}
	/** no spot anywhere in reach: found the village next to the city nearest home where the building would stand */
	function expand(/** @type {string} */ type) {
		// three villages hold what the plan builds; the fourth and fifth come once these are housed (see settle)
		// (growing one village full, up to five: its rocks, trees and iron run out, and new ones are found further out)
		if (ofType('centre').some((b) => b.stage === 'site') || ofType('centre').length >= (st.autoFocus ? 5 : 3)) return false;
		const home = hq().node;
		let best = -1, bd = Infinity;
		for (const v of sim.plan.villages) {
			const n = sim.plan.spots[v.centre][0];
			if (sim.canBuild('centre', n)) continue;
			const ok = v.plots.some((k) => k !== v.centre && sim.plan.spots[k].slice(1).some((j) => j >= 0 && suits(type, j)));
			if (ok && g.dist(home, n) < bd) (bd = g.dist(home, n)), (best = n);
		}
		return best >= 0 && sim.build('centre', best, true).ok;
	}
	/** every village has a house in each settlement: found the next, up to five, where most houses fit, nearest home */
	function settle(/** @type {any} */ s) {
		if (st.autoFocus) return;
		const cs = ofType('centre');
		if (cs.length >= 5 || cs.some((b) => b.stage === 'site')) return;
		const rows = sim.market().parties.filter((/** @type {any} */ r) => r.owner === PLAYER);
		const housed = rows.every((/** @type {any} */ r) => {
			const v = sim.plan.villageOf[sim.plan.plotOf[r.node]];
			return ofType('house').filter((b) => b.stage === 'live' && sim.plan.villageOf[sim.plan.plotOf[b.node]] === v).length * HOUSE_MOST >= r.cap && r.pop >= r.beds - 4;
		});
		if (!housed) return;
		const home = hq().node;
		let best = -1, bs = -Infinity;
		for (const v of sim.plan.villages) {
			const n = sim.plan.spots[v.centre][0];
			if (sim.canBuild('centre', n)) continue;
			const room = v.plots.filter((k) => k !== v.centre && sim.plan.spots[k][0] >= 0 && st.terrain[sim.plan.spots[k][0]] === GRASS).length;
			const sc = room * 4 - g.dist(home, n);
			if (room >= 4 && sc > bs) (bs = sc), (best = n);
		}
		if (best >= 0) sim.build('centre', best, true);
	}
	/**
	 * What it can pay for, as things stand: what its building sites still wait for is theirs; of a cost, what its stores
	 * lack beyond that is bought from the world market, with the gold its village holds beyond two weeks of food money.
	 * @param {any} s the summary
	 */
	function means(s) {
		/** @type {Record<string, number>} */
		const owed = {};
		const owe = (/** @type {Record<string, number>} */ cost) => {
			for (const [w, n] of Object.entries(cost)) owed[w] = (owed[w] ?? 0) + n;
		};
		for (const b of sim.buildingList())
			if (b.owner === PLAYER && b.stage === 'site')
				owe(Object.fromEntries(Object.entries(/** @type {Record<string, number>} */ (b.cost)).map(([w, n]) => [w, Math.max(0, n - (b.got[w] ?? 0) - (b.used[w] ?? 0) - (b.inc?.[w] ?? 0))])));
		const rows = sim.market().parties.filter((/** @type {any} */ r) => r.owner === PLAYER);
		const gold = (/** @type {any} */ row) => (row?.eur ?? 0) - (row?.pop ?? 0) * FOOD_KG * KEEP * PRICE.world;
		const pays = (/** @type {Record<string, number>} */ cost, /** @type {any} */ row = rows[0], eur = 0) =>
			Object.entries(cost).reduce((e, [w, n]) => e + Math.max(0, n + (owed[w] ?? 0) - (s.stock[w] ?? 0)) * (WORLD[w]?.eur ?? 0), 0) + eur <= gold(row);
		return { owe, rows, pays };
	}
	/** beds before people: in each village that is nearly full and lives well, enlarge its largest house that can still grow, or build a new one */
	function homes(/** @type {any} */ s) {
		const houses = ofType('house');
		const { owe, rows, pays } = means(s);
		// until a woodcutter cuts, the first planks are for the plan's buildings (a forester's growing into a woodcutter),
		// beyond a first few beds
		if (!ofType('woodcutter').some((b) => b.stage === 'live' && b.level >= 2)) {
			if (s.beds >= 6) return;
			owe(RECIPES.woodcutter.stages[1].up);
		}
		// one great house early, once it can pay for it
		const great = houses.filter((b) => b.stage === 'live' && b.level < 4).sort((a, b) => b.level - a.level)[0];
		if (!houses.some((b) => b.level >= 4) && great && pays(HOUSE_UP[great.level - 1])) return void sim.upgrade(great.id);
		const first = sim.plan.villageOf[sim.plan.plotOf[hq().node]];
		for (const row of rows) {
			const v = sim.plan.villageOf[sim.plan.plotOf[row.node]];
			// growing one village full: homes only in the first
			if (st.autoFocus && v !== first) continue;
			const mine = houses.filter((b) => sim.plan.villageOf[sim.plan.plotOf[b.node]] === v);
			// only where everyone has a bed and eats and drinks well: more beds bring more mouths. Growing one village full,
			// two homes grow at once, and the next starts while the last beds still fill
			const sites = mine.filter((b) => b.stage === 'site').length, fill = st.autoFocus ? Math.min(row.beds - 2, row.beds * 0.8) : row.beds - 2;
			if (sites >= (st.autoFocus ? 2 : 1) || row.pop < fill || (row.beds > 0 && row.hungry)) continue;
			// the largest house it can pay to enlarge: a bed costs about as much in any dome, most of it glass
			const small = mine.filter((b) => b.level < HOUSE_TOP && b.stage === 'live').sort((a, b) => b.level - a.level);
			const can = small.find((b) => pays(HOUSE_UP[b.level - 1], row));
			if (can) return void sim.upgrade(can.id);
			if (!small.length && pays(BUILDINGS.house.cost, row)) {
				for (const n of sim.plan.villages[v].plots.map((k) => sim.plan.spots[k][0])) {
					if (n < 0 || sim.canBuild('house', n)) continue;
					const r = sim.build('house', n, true);
					if (r.ok && r.linked) return;
					if (r.ok) sim.demolish(n);
				}
			}
		}
	}
	/** join the nearest neighbour city by a trade route once it can pay for its fired clay */
	function join() {
		const first = ofType('centre').find((b) => b.stage === 'live');
		if (!first) return false;
		const links = sim.links(first.id).filter((l) => !l.mine);
		if (links.some((l) => l.joined)) return true;
		const l = links.sort((a, b) => a.cost - b.cost)[0];
		if (l) sim.connect(first.id, l.id);
		return false;
	}
	return {
		tick() {
			// a new valley: its logistics hub first, in the village the valley was grown with for it
			if (!hq()) {
				sim.build('centre', sim.spotFor('centre', st.home ?? 0), true);
				return;
			}
			// a used-up mine is torn down and dug again elsewhere
			for (const b of sim.buildingList())
				if (b.owner === PLAYER && b.deposit <= 0 && BUILDINGS[b.type].ore && b.stage === 'live') {
					sim.demolish(b.node);
					plan.splice(st.auto, 0, [b.type, 'mine']);
				}
			const s = sim.summary();
			const { pays } = means(s);
			// every factory grows by its recipe's stages: a first stage that makes nothing (a forester, a sand pit) is
			// upgraded as soon as it stands, the others once it can pay for it
			for (const type of Object.keys(RECIPES)) {
				const growing = ofType(type).some((b) => b.stage === 'site' && b.level > 0);
				for (const b of growing ? [] : ofType(type)) {
					const up = b.stage === 'live' ? sim.inspect(b.id)?.up : null;
					const idle = !Object.keys(RECIPES[type].stages[Math.max(1, b.level) - 1].make.out).length;
					if (up && (idle || pays(up))) {
						sim.upgrade(b.id);
						break;
					}
				}
			}
			// a village center grows (its hub into the village center, then more wells) once its treasury can pay for it
			for (const row of sim.market().parties.filter((/** @type {any} */ p) => p.owner === PLAYER)) {
				const next = sim.village(row.node)?.power.next, c = sim.at(row.node);
				if (next && c?.k === 'building' && pays(next.up, row, next.gold * 1000)) sim.grow(/** @type {number} */ (c.id));
			}
			// on your own in the valley: past the first buildings, homes and new villages go on as the plan does
			const joined = st.auto >= PLAN.length - 2 && (!sim.links(st.hq).some((l) => !l.mine) || join());
			// homes before the route only while the city is tiny: it starts with none
			if (joined || s.beds < 24) homes(s);
			if (joined && st.auto >= plan.length) settle(s);
			if (st.auto < plan.length) {
				const [type, want] = plan[st.auto];
				const cost = BUILDINGS[type].cost;
				const sites = sim.buildingList().filter((b) => b.owner === PLAYER && b.stage === 'site').length;
				// it waits until it can pay, for a hut too: a factory's hex may need its house first
				const hut = BUILDINGS.house.cost, both = Object.fromEntries([...new Set([...Object.keys(cost), ...Object.keys(hut)])].map((w) => [w, (cost[w] ?? 0) + (hut[w] ?? 0)]));
				if (sites < 3 && pays(both)) {
					if (place(type, want) || (st.autoTries = (st.autoTries ?? 0) + 1) > 12) {
						st.auto++;
						st.autoTries = 0;
					}
				}
			}
			// once the plan is built, more wood and steel while they run short
			if (st.auto >= plan.length && plan.length < PLAN.length + 60 && st.time >= (st.autoMore ?? 0)) {
				st.autoMore = st.time + 180;
				const rows = sim.market().parties.filter((/** @type {any} */ p) => p.owner === PLAYER);
				const low = (/** @type {string} */ w) => rows.some((/** @type {any} */ p) => (p.owe?.[w] ?? 0) > 2) && (s.stock[w] ?? 0) < 20;
				if (low('plank')) plan.push(['woodcutter', 'trees']);
				else if (low('steel')) plan.push(['ironmine', 'mine']);
			}
			// its orders, and with a trade route to a neighbour every request it can fill
			for (const [w, o] of Object.entries(ORDERS)) if (!st.orders[w]) sim.order(w, o);
			if (joined) {
				// requests and pleas alike: what helps a neighbour helps the valley
				for (const c of st.market.contracts) if (!c.taken && c.got < c.n && c.until > st.time + 120 && (s.stock[c.w] ?? 0) >= c.n / 3) sim.take(c.id);
			}
		},
		get step() {
			return st.auto;
		}
	};
}
