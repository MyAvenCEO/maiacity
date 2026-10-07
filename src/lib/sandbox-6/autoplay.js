/**
 * SANDBOX 6 · AUTOPLAY — a player that builds the whole economy by itself, step by step, the way a person would:
 * wood and stone first, then food, a trade route to a neighbour and what it trades (iron ore and tools come by trade),
 * then houses and ever more food until its villages are full. The film camera grows its valley with it (a settlement that is already busy), and it
 * plays a whole game headless to prove every chain runs end to end.
 */
import { BUILDINGS, GRASS, HOUSE_MOST, HOUSE_TOP, IRON, MOUNTAIN, WATER, WOOD_UP } from './rules.js';
import { PLAYER } from './sim.js';

/** the plan: what to build, in order, and where it would rather stand */
const PLAN = [
	// a game starts with one house of two: homes beside the village center first, so there are hands to build and carry
	['house', 'home'],
	['house', 'home'],
	['woodcutter', 'trees'],
	['quarry', 'rocks'],
	['woodcutter', 'trees'],
	['well', 'home'],
	['quarry', 'rocks'],
	['toolmaker', 'home'],
	['woodcutter', 'trees'],
	['well', 'home']
];

/** what it buys, from the world market (and from a neighbour a trade route runs to): building goods, iron ore and
 * tools, while its treasury can pay */
const ORDERS = /** @type {Record<string, 'sell' | 'buy'>} */ ({ plank: 'buy', stone: 'buy', tools: 'buy', ore: 'buy' });

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
			case 'rocks':
				return count((j) => st.obj[j]?.k === 'rock', n, 9) * 4 - d;
			case 'water':
				return count((j) => st.terrain[j] === WATER, n, 7) * 1.5 - d * 1.5;
			case 'woodcutter': {
				const w = ofType('woodcutter')[0];
				return w ? -g.dist(w.node, n) * 2 - d * 0.3 : -d;
			}
			case 'mine': {
				return count((j) => st.ore[j] === IRON, n, 3) * 2 - d;
			}
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
		// (a woodcutter or forester fells the tree on its spot, a quarry breaks the rock)
		const k = st.obj[n]?.k, b = BUILDINGS[type].biome;
		const clears = (b === 'forest' && k === 'tree') || (b === 'stone' && k === 'rock');
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
		if (t.on === 'mountain' ? st.terrain[n] !== MOUNTAIN : st.terrain[n] !== GRASS) return false;
		if (type === 'quarry') return count((j) => st.obj[j]?.k === 'rock', n, t.range ?? 6) >= 2;
		if (type === 'woodcutter' && !ofType('woodcutter').length) return count((j) => st.obj[j]?.k === 'tree', n, t.range ?? 6) >= 4;
		if (t.kind === 'mine') return g.within(n, 3).some((j) => st.ore[j] === IRON && st.amount[j] > 0);
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
		if (!housed || (s.stock.plank ?? 0) < 14 || (s.stock.stone ?? 0) < 10) return;
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
	/** beds before people: in each village that is nearly full and lives well, enlarge its largest house that can still grow, or build a new one */
	function homes(/** @type {any} */ s) {
		const houses = ofType('house');
		// what the building sites still wait for is theirs, and so is a forester's growing into a woodcutter while
		// nothing cuts wood yet: homes take only what is left over
		/** @type {Record<string, number>} */
		const owed = {};
		const owe = (/** @type {Record<string, number>} */ cost) => {
			for (const [w, n] of Object.entries(cost)) owed[w] = (owed[w] ?? 0) + n;
		};
		for (const b of sim.buildingList())
			if (b.owner === PLAYER && b.stage === 'site')
				owe(Object.fromEntries(Object.entries(/** @type {Record<string, number>} */ (b.cost)).map(([w, n]) => [w, Math.max(0, n - (b.got[w] ?? 0) - (b.used[w] ?? 0) - (b.inc?.[w] ?? 0))])));
		// and until a woodcutter cuts, the first planks are for the plan's buildings, beyond a first few beds
		if (!ofType('woodcutter').some((b) => b.stage === 'live' && b.level >= 2)) {
			if (s.beds >= 6) return;
			owe(WOOD_UP[0]);
		}
		const has = (/** @type {Record<string, number>} */ cost) => Object.entries(cost).every(([w, n]) => (s.stock[w] ?? 0) >= n + 3 + (owed[w] ?? 0));
		// one great house early, once there is wood and stone to spare
		const great = houses.filter((b) => b.stage === 'live' && b.level < 4).sort((a, b) => b.level - a.level)[0];
		if (!houses.some((b) => b.level >= 4) && great && has({ plank: 13, stone: 7 })) return void sim.upgrade(great.id);
		const first = sim.plan.villageOf[sim.plan.plotOf[hq().node]];
		for (const row of sim.market().parties.filter((/** @type {any} */ r) => r.owner === PLAYER)) {
			const v = sim.plan.villageOf[sim.plan.plotOf[row.node]];
			// growing one village full: homes only in the first
			if (st.autoFocus && v !== first) continue;
			const mine = houses.filter((b) => sim.plan.villageOf[sim.plan.plotOf[b.node]] === v);
			// only where everyone has a bed and eats and drinks well: more beds bring more mouths. Growing one village full,
			// two homes grow at once, and the next starts while the last beds still fill
			const sites = mine.filter((b) => b.stage === 'site').length, fill = st.autoFocus ? Math.min(row.beds - 2, row.beds * 0.8) : row.beds - 2;
			if (sites >= (st.autoFocus ? 2 : 1) || row.pop < fill || (row.beds > 0 && (row.sat.food < 0.9 || row.sat.water < 0.9))) continue;
			const small = mine.filter((b) => b.level < HOUSE_TOP && b.stage === 'live').sort((a, b) => b.level - a.level)[0];
			if (small) {
				if (has(sim.inspect(small.id)?.up ?? {})) return void sim.upgrade(small.id);
			} else if (has(BUILDINGS.house.cost)) {
				for (const n of sim.plan.villages[v].plots.map((k) => sim.plan.spots[k][0])) {
					if (n < 0 || sim.canBuild('house', n)) continue;
					const r = sim.build('house', n, true);
					if (r.ok && r.linked) return;
					if (r.ok) sim.demolish(n);
				}
			}
		}
	}
	/** join the nearest neighbour city by a trade route once there is stone for it */
	function join(/** @type {any} */ s) {
		const first = ofType('centre').find((b) => b.stage === 'live');
		if (!first) return false;
		const links = sim.links(first.id).filter((l) => !l.mine);
		if (links.some((l) => l.joined)) return true;
		const l = links.sort((a, b) => a.cost - b.cost)[0];
		if (l && (s.stock.stone ?? 0) >= l.cost + 4) sim.connect(first.id, l.id);
		return false;
	}
	return {
		tick() {
			// a used-up mine is torn down and dug again elsewhere
			for (const b of sim.buildingList())
				if (b.owner === PLAYER && b.deposit <= 0 && BUILDINGS[b.type].kind === 'mine' && b.stage === 'live') {
					sim.demolish(b.node);
					plan.splice(st.auto, 0, [b.type, 'mine']);
				}
			// and so is a quarry whose rocks are all cut
			const spent = ofType('quarry').find((b) => b.stage === 'live' && /no rocks/i.test(b.status));
			if (spent && st.time >= (st.autoQuarry ?? 0)) {
				st.autoQuarry = st.time + 240;
				sim.demolish(spent.node);
				plan.splice(st.auto, 0, ['quarry', 'rocks']);
			}
			const s = sim.summary();
			// alone in the valley, tools come only from iron: an iron mine and a toolmaker once the tools run low
			const coming = (/** @type {string} */ t) => ofType(t).length > 0 || plan.slice(st.auto).some((/** @type {string[]} */ x) => x[0] === t);
			if (st.auto >= 8 && ((s.stock.tools ?? 0) < 3 || st.autoFocus) && st.time >= (st.autoIron ?? 0)) {
				// asked again a while later if there was no iron within reach
				st.autoIron = st.time + 300;
				if (!coming('ironmine')) plan.splice(st.auto, 0, ['ironmine', 'mine']);
				if (!coming('toolmaker')) plan.splice(st.auto + 1, 0, ['toolmaker', 'home']);
			}
			// a wood building starts as a forester: upgrade it to a woodcutter as soon as it stands, and on to a sawmill and
			// a timber works when there is wood and stone to spare
			const growing = ofType('woodcutter').some((b) => b.stage === 'site' && b.level > 0);
			for (const b of growing ? [] : ofType('woodcutter')) {
				const up = b.stage === 'live' ? sim.inspect(b.id)?.up : null;
				if (up && (b.level <= 1 || Object.entries(up).every(([w, n]) => (s.stock[w] ?? 0) >= n + 10))) {
					sim.upgrade(b.id);
					break;
				}
			}
			// on your own in the valley: past the first buildings, homes and new villages go on as the plan does
			const joined = st.auto >= 8 && (!sim.links(st.hq).some((l) => !l.mine) || join(s));
			// homes before the route only while the city is tiny: it starts with one house of two
			if (joined || s.beds < 24) homes(s);
			if (joined && st.auto >= plan.length) settle(s);
			if (st.auto < plan.length) {
				const [type, want] = plan[st.auto];
				const cost = BUILDINGS[type].cost;
				const sites = sim.buildingList().filter((b) => b.owner === PLAYER && b.stage === 'site').length;
				const enough = Object.entries(cost).every(([w, n]) => (s.stock[w] ?? 0) >= n);
				if (sites < 3 && (enough || (st.autoTries ?? 0) > 8)) {
					if (place(type, want) || (st.autoTries = (st.autoTries ?? 0) + 1) > 12) {
						st.auto++;
						st.autoTries = 0;
					}
				} else st.autoTries = (st.autoTries ?? 0) + 1;
			}
			// once the plan is built, more water while yours runs short, more wood and stone while they do
			if (st.auto >= plan.length && plan.length < PLAN.length + 60 && st.time >= (st.autoMore ?? 0)) {
				st.autoMore = st.time + 180;
				const rows = sim.market().parties.filter((/** @type {any} */ p) => p.owner === PLAYER);
				const low = (/** @type {string} */ w) => rows.some((/** @type {any} */ p) => p.sat[w] < 0.7) && (s.stock[w] ?? 0) < 20;
				if (st.parties[PLAYER].sat.water < 0.9) plan.push(['well', 'home']);
				else if (low('plank')) plan.push(['woodcutter', 'trees']);
				else if (low('stone')) plan.push(['quarry', 'rocks']);
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
