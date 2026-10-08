/**
 * SANDBOX 6 · THE SIMULATION — the whole game as plain data and the rules that move it on, without a pixel: the page
 * draws it (./view.js), and a script can play it headless (./autoplay.js).
 *
 * The state is one JSON object (save it, load it, it goes on where it was). Every 0.1 s of game time:
 *   · carriers walk their roads: each road has one, who takes a ware from the flag at one end to the flag at the
 *     other; at its last flag the ware goes into the building that asked for it;
 *   · every half second the economy matches wares to who needs them: a site its planks and steel, a workshop its
 *     inputs; a ware nobody needs goes to its village center; what a village center holds is sent out to whoever in
 *     its village asks, nearest first; a ware finds its way flag by flag along the shortest roads;
 *   · every second the robots follow: from its village center every site gets its builder, every path its bus, every
 *     finished building its worker; they are autonomous robots, and settlers only live in the village (Samuel,
 *     2026-10-07);
 *   · buildings work: workshops turn inputs into wares, gatherers go out into the land (trees, rocks);
 *   · carts run the trade routes under the ground between village centers: your villages share what they have, and
 *     the cities trade by the orders you set and by what the neighbours have spare and lack (./market.js);
 *   · every village eats and drinks, in kg and litres (./food.js): its hexes' food forests grow a share of it, more
 *     each year, it buys the rest by itself, and its roofs fill its tanks with rain;
 *   · every village makes and uses energy, in kWh (./rules.js ENERGY): its center's geothermal plant and its domes'
 *     solar glass make it, its people and factories use it, and the world grid buys what is left over;
 *   · every factory works by its recipe (./rules.js RECIPES, `craft` here): a round of its land and energy in, its ware
 *     out;
 *   · what a treasury lacks it borrows, an annuity loan over fifteen years (./market.js LOAN). There is no goal to win.
 */
import { BIOMES, BUILDINGS, BUILD_MWH_T, CENTRE, ENERGY, EUR_GOLD, GROWS, GRASS, HOUSE_BEDS, HOUSE_KEEP, HOUSE_MOST, HOUSE_TOP, HOUSE_UP, IRON, LAND, LOAD_T, MOUNTAIN, RECIPES, ROUNDS_YEAR, ROUTE_T_KM, START, UNIT_M, UPKEEP, WARES, WATER, WEEK_YEAR, centreStage, holdsLand, loadsRound, recipe, sunBedDay, weekOf } from './rules.js';
import { CART, GRID_EUR_KWH, HEARTS, LOAN, LOAN_PAY, NEIGHBOURS, TRADED, WORLD, heartsFor, keepOf, loanMonths, make, newMarket, orderRule, party, priceIn, request, shortIn, spareIn } from './market.js';
import { SE, STEP, findPath, makeGrid } from './hex.js';
import { CISTERN, FOOD_KG, FRESH_L, KEEP, MOST, PACE, PRICE, RAIN_L, RAIN_MONTH, TANK, WATER_PRICE, WATER_USE, WEEK, YEAR, DAY, MONTH, calendar, clockOf, forestShare } from './food.js';
import { makePlan, spoke } from './plots.js';
import { growValley } from './map.js';
import { fmt } from './units.js';

/** seconds of game time a step moves on */
export const TICK = 0.1;
/** who owns what: you, and the two neighbours (1, 2) */
export const PLAYER = 0;
/** wares a flag holds at most */
export const FLAG_CAP = 8;
/** each input of a workshop is kept this full */
const SLOT_CAP = 4;
/** nodes a second: walking, and carrying (3.6 and 2.9 world units a second, however fine the grid) */
const WALK = 3.6 / STEP, CARRY = 2.9 / STEP;
/** nodes a second a trader's cart goes */
const CART_SPEED = 2.6 / STEP;
/** a forester plants until so many trees stand round it */
const FORESTER_TREES = 45;
/** weeks over which a building's output a week is averaged: a quarter year */
const LATELY = 13;
/** the wood building's level, 1 (forester) to 4 (timber works); one built before it grew levels was a woodcutter */
export const woodLevel = (/** @type {any} */ b) => b.level || 2;
/** a building's level as it stands: a house's size, a factory's stage (1 for its first), a village center's (1, a
 * logistics hub) */
export const levelOf = (/** @type {any} */ b) => (b.type === 'woodcutter' ? woodLevel(b) : RECIPES[b.type] || b.type === 'centre' ? b.level || 1 : b.level);
/** the geothermal plants under a village center, by its stage: none under a logistics hub, one under the village
 * center */
export const plantOf = (/** @type {any} */ c) => (c.type === 'centre' ? centreStage(levelOf(c)).plant : 0);
/** a neighbour city's people when its village is full: six houses of sixteen */
/** the most villages a neighbour founds */
const CITY_VILLAGES = 5;
/** a building rests while the storehouses hold this much of what it makes */
const ENOUGH = 40;

/** a new valley, grown from a seed; its calendar runs at the master clock's pace @param {number} [seed] */
export function newGame(seed = 7) {
	const v = growValley(seed);
	const N = v.W * v.H;
	const st = {
		v: 20,
		seed,
		time: 0,
		/** days of the valley's calendar gone by (./food.js) */
		cal: 0,
		/** the year it was started in: its calendar begins on 1 January of it */
		year0: new Date().getFullYear(),
		rng: (Math.imul(seed, 2654435761) >>> 0) || 1,
		W: v.W,
		H: v.H,
		terrain: v.terrain,
		/** what each settlement hex is good for (./rules.js BIOMES), as the valley was grown @type {string[]} */
		biome: v.biome,
		height: v.height,
		ore: v.ore,
		amount: v.amount,
		fish: v.fish,
		obj: /** @type {any[]} */ (v.obj),
		road: /** @type {number[]} */ (Array(N).fill(0)),
		owner: /** @type {number[]} */ (Array(N).fill(-1)),
		/** who holds each village (./plots.js), or -1 @type {number[]} */
		villageOwner: [],
		/** the trade routes under the ground, village center to village center @type {Record<string, { id: number, a: number, b: number, path: number[], owner: number }>} */
		tunnels: {},
		tunV: 1,
		/** how each of your villages lives, by village @type {Record<string, any>} */
		vill: {},
		/** when each hex's food forest was planted (its first house finished), by hex @type {Record<string, number>} */
		forest: {},
		/** @type {Record<string, any>} */ flags: {},
		/** @type {Record<string, any>} */ roads: {},
		/** @type {Record<string, any>} */ buildings: {},
		/** @type {Record<string, any>} */ units: {},
		/** @type {Record<string, any>} */ wares: {},
		nextId: 1,
		/** @type {Record<string, number>} */ made: {},
		/** @type {{ t: number, text: string, node: number, tone: string, n: number }[]} */ msgs: [],
		msgSeq: 0,
		/** what changed, for whoever draws it */
		netV: 1,
		objV: 1,
		terV: 1,
		/** when the slower rules next run */
		clocks: { dispatch: 0, people: 0, grow: 0, pop: 18, needs: 0, trade: 5, grow2: 60 },
		hq: 0,
		/** where the valley would have your first village: the camera starts here until you put up your hub */
		home: 0,
		/** the neighbours' village centers (building ids) */
		/** @type {number[]} */ villages: [],
		...newMarket(),
		/** your orders, by ware: buy when short, sell (export) the surplus, or both @type {Record<string, 'sell' | 'buy' | 'both'>} */
		orders: {},
		/** buildings burning, for a while */
		/** @type {{ node: number, t: number }[]} */ fx: []
	};
	const sim = createSim(st);
	sim.setup(v);
	return sim;
}

/** A game from its saved state. @param {string | object} saved */
export function loadGame(saved) {
	const st = typeof saved === 'string' ? JSON.parse(saved) : saved;
	if (!st || st.v !== 20 || !Array.isArray(st.terrain)) throw new Error('Not a Sandbox 6 game of this kind');
	return createSim(st);
}

/** @typedef {ReturnType<typeof createSim>} Sim */

/** the settlement plan of a valley's size, made once (it is only read) @type {Map<string, ReturnType<typeof makePlan>>} */
const plans = new Map();

/** @param {any} st */
export function createSim(st) {
	const g = makeGrid(st.W, st.H);
	const N = g.N;
	// a valley saved before it kept the year it was started in counts from this one
	st.year0 ??= new Date().getFullYear();
	// nothing pauses any more: a building paused in an older save works again
	for (const b of Object.values(st.buildings ?? {})) if (b) delete b.paused;
	const size = `${st.W}x${st.H}`;
	if (!plans.has(size)) plans.set(size, makePlan(g));
	const plan = /** @type {ReturnType<typeof makePlan>} */ (plans.get(size));
	/** the village a node lies in */
	const villageAt = (/** @type {number} */ n) => plan.villageOf[plan.plotOf[n]];

	const rand = () => {
		st.rng = (st.rng + 0x6d2b79f5) >>> 0;
		let t = st.rng;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const newId = () => st.nextId++;
	/** @param {string} text @param {number} [node] @param {'info'|'good'|'alert'} [tone] */
	const say = (text, node = -1, tone = 'info') => {
		st.msgSeq = (st.msgSeq ?? 0) + 1;
		st.msgs.push({ t: st.time, text, node, tone, n: st.msgSeq });
		if (st.msgs.length > 40) st.msgs.shift();
	};
	const T = (/** @type {any} */ b) => BUILDINGS[b.type];
	const isWarehouse = (/** @type {any} */ b) => b.type === 'centre';
	const all = (/** @type {Record<string, any>} */ o) => Object.values(o);
	// the buildings and the people as lists, kept until one comes or goes (never saved: st is what is saved). Frozen,
	// so a caller sorts a copy; a list handed out stays as it was, as Object.values would
	/** @type {readonly any[] | null} */
	let bldList = null;
	/** @type {readonly any[] | null} */
	let unitList = null;
	const blds = () => (bldList ??= Object.freeze(Object.values(st.buildings)));
	const units = () => (unitList ??= Object.freeze(Object.values(st.units)));
	/** @type {readonly any[] | null} */
	let roadList = null;
	const roads = () => (roadList ??= Object.freeze(Object.values(st.roads)));
	/** @type {{ of: readonly any[], ends: Set<string> } | null} */
	let rIdx = null;
	/** whether a road joins two flags, either way round */
	const joins = (/** @type {number} */ a, /** @type {number} */ b) => {
		const list = roads();
		if (rIdx?.of !== list) rIdx = { of: list, ends: new Set(list.map((r) => (r.a < r.b ? `${r.a},${r.b}` : `${r.b},${r.a}`))) };
		return rIdx.ends.has(a < b ? `${a},${b}` : `${b},${a}`);
	};
	// what is read off those lists again and again, rebuilt with them (a building's type, owner and node never change,
	// nor a unit's kind, owner and village)
	/** @type {{ of: readonly any[], hubs: any[], mine: Map<number, any[]> } | null} */
	let bIdx = null;
	/** @type {{ of: readonly any[], carts: any[], folk: Map<number, number> } | null} */
	let uIdx = null;
	/** every village center (yours and the neighbours'), and your buildings by village; each in list order */
	const bIndex = () => {
		const list = blds();
		if (bIdx?.of === list) return bIdx;
		/** @type {any[]} */
		const hubs = [];
		/** @type {Map<number, any[]>} */
		const mine = new Map();
		for (const b of list) {
			if (b.type === 'centre' || b.type === 'village') hubs.push(b);
			if (b.owner !== PLAYER) continue;
			const v = villageAt(b.node);
			const l = mine.get(v);
			if (l) l.push(b);
			else mine.set(v, [b]);
		}
		return (bIdx = { of: list, hubs, mine });
	};
	/** your buildings in a village @returns {any[]} */
	const mineIn = (/** @type {number} */ v) => bIndex().mine.get(v) ?? [];
	/** the carts on the trade routes, and how many of your people (carts aside) are out of each village */
	const uIndex = () => {
		const list = units();
		if (uIdx?.of === list) return uIdx;
		/** @type {any[]} */
		const carts = [];
		/** @type {Map<number, number>} */
		const folk = new Map();
		for (const u of list) {
			if (u.kind === 'cart') carts.push(u);
			// your builders, buses and workers are robots, not people: only a neighbour's walkers are its folk
			else if (u.owner !== PLAYER) folk.set(u.vil, (folk.get(u.vil) ?? 0) + 1);
		}
		return (uIdx = { of: list, carts, folk });
	};
	const flagAt = (/** @type {number} */ n) => (st.obj[n]?.k === 'flag' ? st.flags[st.obj[n].id] : null);
	const buildingAt = (/** @type {number} */ n) => (st.obj[n]?.k === 'bld' ? st.buildings[st.obj[n].id] : null);
	const warehouses = (owner = PLAYER) => bIndex().hubs.filter((b) => b.owner === owner && isWarehouse(b) && b.stage === 'live');
	/** where a unit stands now, as a node */
	const nodeOf = (/** @type {any} */ u) => u.path[Math.max(0, Math.min(u.path.length - 1, Math.round(u.p)))];
	/** a walk across the land: anywhere but water and other buildings */
	const walkable = (/** @type {number} */ i) => st.terrain[i] !== WATER && st.obj[i]?.k !== 'bld';
	const made = (/** @type {string} */ ware) => (st.made[ware] = (st.made[ware] ?? 0) + 1);

	// ── the road network: flags joined by roads, and the shortest way from any flag to any other ──
	let netSeen = -1;
	/** @type {Record<string, { road: number, to: number, cost: number }[]>} */
	let adj = {};
	/** @type {Map<number, Map<number, { d: number, road: number }>>} */
	const routes = new Map();
	function network() {
		if (netSeen === st.netV) return adj;
		netSeen = st.netV;
		routes.clear();
		adj = {};
		for (const f of all(st.flags)) adj[f.id] = [];
		for (const r of roads()) {
			const cost = r.path.length - 1 + 0.5;
			adj[r.a]?.push({ road: r.id, to: r.b, cost });
			adj[r.b]?.push({ road: r.id, to: r.a, cost });
		}
		return adj;
	}
	/** Every flag that can reach `dest`, how far, and which road it takes first. @param {number} dest */
	function route(dest) {
		network();
		let m = routes.get(dest);
		if (m) return m;
		m = new Map([[dest, { d: 0, road: 0 }]]);
		const open = [dest];
		const done = new Set();
		while (open.length) {
			let k = 0;
			for (let j = 1; j < open.length; j++) if (/** @type {any} */ (m.get(open[j])).d < /** @type {any} */ (m.get(open[k])).d) k = j;
			const f = open.splice(k, 1)[0];
			if (done.has(f)) continue;
			done.add(f);
			const d = /** @type {any} */ (m.get(f)).d;
			for (const e of adj[f] ?? []) {
				const nd = d + e.cost;
				if (nd < (m.get(e.to)?.d ?? Infinity)) {
					m.set(e.to, { d: nd, road: e.road });
					open.push(e.to);
				}
			}
		}
		routes.set(dest, m);
		return m;
	}
	/** how far along the roads, flag to flag */
	const roadDist = (/** @type {number} */ from, /** @type {number} */ to) => route(to).get(from)?.d ?? Infinity;
	/** the road a ware takes next from where it lies */
	const nextRoad = (/** @type {any} */ w) => {
		const b = st.buildings[w.dest];
		return b ? route(b.flag).get(w.flag)?.road ?? 0 : 0;
	};
	/** the nodes a walker follows along the roads from one flag to another, or null */
	function roadWalk(/** @type {number} */ from, /** @type {number} */ to) {
		const m = route(to);
		if (!m.has(from)) return null;
		const nodes = [st.flags[from].node];
		let f = from;
		while (f !== to) {
			const r = st.roads[/** @type {any} */ (m.get(f)).road];
			const fwd = r.a === f;
			const p = fwd ? r.path : [...r.path].reverse();
			for (let k = 1; k < p.length; k++) nodes.push(p[k]);
			f = fwd ? r.b : r.a;
		}
		return nodes;
	}
	/** the nearest storehouse a flag reaches by road that `ok` accepts */
	function nearestWarehouse(/** @type {number} */ flag, /** @type {(b: any) => boolean} */ ok) {
		const m = route(flag);
		let best = null, bd = Infinity;
		for (const wh of warehouses()) {
			const d = m.get(wh.flag)?.d ?? Infinity;
			if (d < bd && ok(wh)) (best = wh), (bd = d);
		}
		return best;
	}

	// ── making and unmaking things ──
	function makeFlag(/** @type {number} */ node, /** @type {number} */ owner) {
		const f = { id: newId(), node, owner, wares: /** @type {number[]} */ ([]), bld: 0 };
		st.flags[f.id] = f;
		const rid = st.road[node];
		st.obj[node] = { k: 'flag', id: f.id };
		if (rid) splitRoad(st.roads[rid], f);
		st.netV++;
		st.objV++;
		return f;
	}
	function makeRoad(/** @type {number[]} */ path, /** @type {number} */ owner) {
		const a = /** @type {any} */ (flagAt(path[0])), b = /** @type {any} */ (flagAt(path[path.length - 1]));
		const r = { id: newId(), a: a.id, b: b.id, path, carrier: 0, owner };
		for (let k = 1; k < path.length - 1; k++) st.road[path[k]] = r.id;
		st.roads[r.id] = r;
		roadList = null;
		st.netV++;
		return r;
	}
	/** a flag set down on a road splits it in two: the carrier keeps the half it stands on */
	function splitRoad(/** @type {any} */ r, /** @type {any} */ f) {
		const k = r.path.indexOf(f.node);
		const u = st.units[r.carrier];
		for (let j = 1; j < r.path.length - 1; j++) st.road[r.path[j]] = 0;
		delete st.roads[r.id];
		roadList = null;
		const r1 = makeRoad(r.path.slice(0, k + 1), r.owner);
		const r2 = makeRoad(r.path.slice(k), r.owner);
		if (!u) return;
		if (u.job === 'c-go') {
			u.road = r1.id;
			r1.carrier = u.id;
			return;
		}
		const second = u.p > k;
		const r_ = second ? r2 : r1;
		r_.carrier = u.id;
		u.road = r_.id;
		u.path = r_.path;
		u.p = second ? u.p - k : Math.min(u.p, k);
		if (u.wareId) {
			const w = st.wares[u.wareId];
			u.wareId = 0;
			u.ware = '';
			if (w && f.wares.length < FLAG_CAP) {
				w.flag = f.id;
				w.since = st.time;
				f.wares.push(w.id);
			} else if (w) destroyWare(w);
		}
		u.job = 'c-idle';
		u.wait = 0;
		u.tgt = Math.floor((u.path.length - 1) / 2);
	}
	function makeBuilding(/** @type {string} */ type, /** @type {number} */ node, /** @type {number} */ owner, live = false) {
		const t = BUILDINGS[type];
		// every building's door faces the flag in the middle of its settlement
		const mid = plan.centre[plan.plotOf[node]];
		const fnode = mid === node ? g.nb(node, SE) : mid;
		// it clears its own ground and the square at its door
		clearAround(node, 1);
		clearAround(fnode, 1);
		if (st.obj[fnode] && st.obj[fnode].k !== 'flag') st.obj[fnode] = null;
		const flag = flagAt(fnode) ?? makeFlag(fnode, owner);
		const b = {
			id: newId(), type, node, flag: flag.id, owner, stage: live ? 'live' : 'site', since: st.time,
			cost: { ...t.cost }, used: /** @type {Record<string, number>} */ ({}), got: /** @type {Record<string, number>} */ ({}), inc: /** @type {Record<string, number>} */ ({}),
			builder: 0, worker: 0, slots: (t.inputs ?? []).map(() => ({ have: 0, inc: 0 })),
			timer: 0, out: 0, status: live ? '' : 'Waiting for a builder', eff: 0,
			stock: /** @type {Record<string, number>} */ ({}), settlers: 0, deposit: 0, fields: 0, level: 0,
			/** a village center's: what is on its way to it along the trade routes */
			coming: /** @type {Record<string, number>} */ ({}),
			/** a village center's treasury, in HEARTs (its settlers issue them) */
			hearts: 0,
		};
		// a village center is founded as a logistics hub, its first stage
		if (type === 'centre') b.level = 1;
		for (const w of Object.keys(b.cost)) (b.used[w] = 0), (b.got[w] = 0), (b.inc[w] = 0);
		if (t.ore) b.deposit = depositAt(node);
		flag.bld ||= b.id;
		st.obj[node] = { k: 'bld', id: b.id };
		st.buildings[b.id] = b;
		bldList = null;
		st.objV++;
		return b;
	}
	/** how much ore a mine at a node can dig: what the iron round it holds */
	function depositAt(/** @type {number} */ node) {
		let n = 0;
		for (const j of g.within(node, 3)) if (st.ore[j] === IRON) n += st.amount[j];
		return n * 4;
	}
	function destroyWare(/** @type {any} */ w) {
		unclaim(w);
		if (w.flag) {
			const f = st.flags[w.flag];
			if (f) f.wares = f.wares.filter((/** @type {number} */ x) => x !== w.id);
		}
		delete st.wares[w.id];
	}
	/** a ware no longer goes where it was bound: its building stops counting on it */
	function unclaim(/** @type {any} */ w) {
		const b = st.buildings[w.dest];
		w.dest = 0;
		if (!b) return;
		if (b.stage === 'site') b.inc[w.type] = Math.max(0, (b.inc[w.type] ?? 0) - 1);
		else if (w.slot === -3) b.incBox[w.type] = Math.max(0, (b.incBox[w.type] ?? 0) - 1);
		else if (w.slot >= 0 && b.slots[w.slot]) b.slots[w.slot].inc = Math.max(0, b.slots[w.slot].inc - 1);
	}
	function removeRoad(/** @type {any} */ r) {
		for (let k = 1; k < r.path.length - 1; k++) st.road[r.path[k]] = 0;
		delete st.roads[r.id];
		roadList = null;
		const u = st.units[r.carrier];
		if (u) {
			if (u.wareId && st.wares[u.wareId]) destroyWare(st.wares[u.wareId]);
			u.wareId = 0;
			u.ware = '';
			u.road = 0;
			goHome(u);
		}
		st.netV++;
		st.objV++;
	}
	function removeFlag(/** @type {any} */ f) {
		for (const r of roads()) if (r.a === f.id || r.b === f.id) removeRoad(r);
		for (const b of blds()) if (b.flag === f.id && st.buildings[b.id]) removeBuilding(b);
		for (const wid of [...f.wares]) if (st.wares[wid]) destroyWare(st.wares[wid]);
		delete st.flags[f.id];
		st.obj[f.node] = null;
		st.netV++;
		st.objV++;
	}
	function removeBuilding(/** @type {any} */ b, burn = true, retally = true) {
		delete st.buildings[b.id];
		bldList = null;
		st.obj[b.node] = null;
		const f = st.flags[b.flag];
		if (f && f.bld === b.id) f.bld = blds().find((x) => x.flag === f.id)?.id ?? 0;
		for (const w of all(st.wares)) if (w.dest === b.id) w.dest = 0;
		for (const uid of [b.worker, b.builder]) {
			const u = st.units[uid];
			if (!u) continue;
			if (u.inside) {
				u.inside = false;
				u.path = [b.node];
				u.p = 0;
				u.tgt = 0;
			}
			releaseTarget(u);
			goHome(u);
		}
		if (burn) st.fx.push({ node: b.node, t: st.time });
		st.objV++;
		if (retally && holdsLand(b.type)) territory();
	}
	function releaseTarget(/** @type {any} */ u) {
		const o = st.obj[u.target];
		if (o && o.r === u.id) delete o.r;
	}

	// ── people ──
	function spawn(/** @type {string} */ kind, /** @type {number} */ owner, /** @type {number[]} */ path, /** @type {string} */ job, extra = {}) {
		const u = {
			id: newId(), kind, owner, path, p: 0, tgt: path.length - 1, speed: kind === 'carrier' ? CARRY : WALK, job,
			road: 0, bld: 0, home: 0, target: -1, ware: '', wareId: 0, rank: 0, wait: 0, inside: false, end: 0, ...extra
		};
		st.units[u.id] = u;
		unitList = null;
		return u;
	}
	function removeUnit(/** @type {any} */ u) {
		releaseTarget(u);
		delete st.units[u.id];
		unitList = null;
	}
	/** the stop a unit can set off from by road: the flag it stands at, or the flag of the building it is at; else 0 */
	const setOffAt = (/** @type {number} */ n) => flagAt(n)?.id ?? buildingAt(n)?.flag ?? 0;
	/** a unit with nothing left to do goes to the nearest storehouse (a neighbour's to its village): along the paths
	 * when it stands at one, across the land only when no path leads there */
	function goHome(/** @type {any} */ u) {
		const here = nodeOf(u), from = setOffAt(here);
		const mine = warehouses().filter((b) => villageAt(b.node) === u.vil);
		const homes = u.owner === PLAYER ? (mine.length ? mine : warehouses()) : blds().filter((b) => b.type === 'village' && b.owner === u.owner);
		homes.sort((a, b) => g.dist(here, a.node) - g.dist(here, b.node));
		const near = homes.slice(0, 3);
		for (const byRoad of [true, false])
			for (const h of near) {
				const walk = byRoad && from && st.flags[from] && h.flag ? roadWalk(from, h.flag) : null;
				if (byRoad && !walk) continue;
				const path = walk ? [...(walk[0] === here ? [] : [here]), ...walk, ...(h.node === walk[walk.length - 1] ? [] : [h.node])] : findPath(g, here, h.node, walkable);
				if (path) {
					Object.assign(u, { path, p: 0, tgt: path.length - 1, job: 'home', home: h.id, inside: false, wait: 0, road: 0 });
					return;
				}
			}
		removeUnit(u);
	}
	function arriveHome(/** @type {any} */ u) {
		const h = st.buildings[u.home];
		if (h && h.owner === u.owner) {
			// your robots park there; a neighbour's walkers are its people
			if (u.owner !== PLAYER) h.settlers++;
			if (u.ware && isWarehouse(h)) h.stock[u.ware] = (h.stock[u.ware] ?? 0) + 1;
		}
		removeUnit(u);
	}

	/** what a site still lacks of each ware: its cost less what it has, has used and has on its way */
	const lacks = (/** @type {any} */ b) =>
		/** @type {[string, number][]} */ (Object.keys(b.cost).map((w) => [w, b.cost[w] - (b.got[w] ?? 0) - (b.used[w] ?? 0) - (b.inc[w] ?? 0)])).filter(([, n]) => n > 0);
	/** what an idle builder waits for: the wares neither at the site nor on their way */
	function waitingFor(/** @type {any} */ b) {
		const w = lacks(b).map(([x]) => WARES[x].label.toLowerCase());
		return w.length ? `Waiting for ${w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w.at(-1)}` : w[0]}` : 'Waiting for materials';
	}
	/** a site's builder fetches what it still lacks from its store, as much as the store holds */
	function fetchFor(/** @type {any} */ b, /** @type {any} */ wh) {
		for (const [w, n] of lacks(b)) {
			const k = Math.min(n, Math.floor(wh.stock[w] ?? 0));
			if (k <= 0) continue;
			wh.stock[w] -= k;
			b.got[w] = (b.got[w] ?? 0) + k;
		}
	}
	/** every site gets its builder, every path its bus and every finished building its worker, each from its nearest
	 * village center. They are all autonomous robots, not settlers (Samuel, 2026-10-07): settlers only live in the
	 * village, so however many there are, nothing waits for one */
	function people() {
		for (const b of blds()) {
			if (b.owner !== PLAYER || b.stage !== 'site' || b.type === 'centre') continue;
			// a builder sets out for every site at once and brings what it is built of from the store, fetching the rest
			// from there as it comes in (bought, made or brought by cart), so no site waits on a bus
			const wh = nearestWarehouse(b.flag, () => true);
			if (b.builder) {
				if (wh) fetchFor(b, wh);
				continue;
			}
			const walk = wh && roadWalk(wh.flag, b.flag);
			if (!wh || !walk) {
				b.status = 'Not connected by road';
				continue;
			}
			const u = spawn('builder', PLAYER, [wh.node, ...walk, b.node], 'b-go', { bld: b.id, vil: villageAt(wh.node) });
			b.builder = u.id;
			b.status = 'A builder is on the way';
			fetchFor(b, wh);
		}
		// every path gets its bus, the busiest first (each road's count taken once, then a stable sort)
		const busy = (/** @type {any} */ r) => (st.flags[r.a]?.wares.length ?? 0) + (st.flags[r.b]?.wares.length ?? 0);
		const byBusy = roads().map((r) => /** @type {[number, any]} */ ([busy(r), r])).sort((x, y) => y[0] - x[0]).map(([, r]) => r);
		for (const r of byBusy) {
			if (r.carrier || r.owner !== PLAYER) continue;
			const wh = nearestWarehouse(r.a, () => true);
			const walk = wh && roadWalk(wh.flag, r.a);
			if (!wh || !walk) continue;
			const u = spawn('carrier', PLAYER, [wh.node, ...walk], 'c-go', { road: r.id, vil: villageAt(wh.node) });
			u.speed = WALK;
			r.carrier = u.id;
		}
		for (const b of blds()) {
			if (b.owner !== PLAYER) continue;
			const t = T(b);
			if (b.stage === 'live' && t.worker && !b.worker) {
				const wh = nearestWarehouse(b.flag, () => true);
				const walk = wh && roadWalk(wh.flag, b.flag);
				if (!wh || !walk) {
					b.status = 'Not connected by road';
					continue;
				}
				const u = spawn('worker', PLAYER, [wh.node, ...walk, b.node], 'w-go', { bld: b.id, vil: villageAt(wh.node) });
				b.worker = u.id;
				b.status = `A ${t.worker?.toLowerCase()} is on the way`;
			}
		}
	}

	// ── the economy: who needs what, and where it comes from ──
	function requestsOf(/** @type {any} */ b) {
		const t = T(b);
		if (b.stage === 'site' && b.type === 'centre') return [];
		// your builders fetch what they build with from the store (see people)
		if (b.stage === 'site' && b.owner === PLAYER) return [];
		if (b.stage === 'site') return Object.keys(b.cost).map((w) => ({ types: [w], slot: -1, n: b.cost[w] - b.used[w] - b.got[w] - b.inc[w] }));
		if (b.stage !== 'live') return [];
		if (!b.worker) return [];
		return (t.inputs ?? []).map((/** @type {string[]} */ types, /** @type {number} */ k) => ({ types, slot: k, n: SLOT_CAP - b.slots[k].have - b.slots[k].inc }));
	}
	function claim(/** @type {any} */ w, /** @type {any} */ b, /** @type {number} */ slot) {
		w.dest = b.id;
		w.slot = slot;
		if (b.stage === 'site') b.inc[w.type]++;
		else if (slot === -3) b.incBox[w.type] = (b.incBox[w.type] ?? 0) + 1;
		else if (slot >= 0) b.slots[slot].inc++;
	}
	function deliver(/** @type {any} */ w) {
		const b = st.buildings[w.dest];
		delete st.wares[w.id];
		if (!b) return;
		if (isWarehouse(b) && b.stage === 'live') b.stock[w.type] = (b.stock[w.type] ?? 0) + 1;
		else if (b.stage === 'site') {
			b.inc[w.type] = Math.max(0, b.inc[w.type] - 1);
			b.got[w.type]++;
		} else if (w.slot === -3) {
			b.incBox[w.type] = Math.max(0, (b.incBox[w.type] ?? 0) - 1);
			b.box[w.type] = (b.box[w.type] ?? 0) + 1;
		} else if (w.slot >= 0 && b.slots[w.slot]) {
			b.slots[w.slot].inc = Math.max(0, b.slots[w.slot].inc - 1);
			b.slots[w.slot].have++;
		}
	}
	/** a ware set down at a flag, bound nowhere yet */
	function newWare(/** @type {string} */ type, /** @type {any} */ f) {
		const w = { id: newId(), type, flag: f.id, dest: 0, slot: -1, since: st.time };
		st.wares[w.id] = w;
		f.wares.push(w.id);
		return w;
	}
	let turn = 0;
	function dispatch() {
		// wares bound somewhere they can no longer reach let go of it; wares at their building's own flag go in
		for (const w of all(st.wares)) {
			if (!w.flag) continue;
			const b = st.buildings[w.dest];
			if (w.dest && !b) w.dest = 0;
			if (!w.dest) continue;
			if (b.flag === w.flag) {
				const f = st.flags[w.flag];
				f.wares = f.wares.filter((/** @type {number} */ x) => x !== w.id);
				deliver(w);
			} else if (!route(b.flag).has(w.flag)) unclaim(w);
		}
		const loose = all(st.wares).filter((w) => w.flag && (!w.dest || isWarehouse(st.buildings[w.dest])));
		const list = blds().filter((b) => b.owner === PLAYER);
		turn = (turn + 1) % Math.max(1, list.length);
		const ordered = [...list.slice(turn), ...list.slice(0, turn)].sort((a, b) => (a.stage === 'site' ? 0 : 1) - (b.stage === 'site' ? 0 : 1));
		const whs = warehouses();
		for (const b of ordered) {
			for (const req of requestsOf(b)) {
				for (let k = 0; k < req.n; k++) if (!supply(b, req, loose, whs)) break;
			}
		}
		// what nobody needs goes to the nearest storehouse
		for (const w of loose) {
			if (w.dest) continue;
			let best = null, bd = Infinity;
			for (const wh of whs) {
				const d = roadDist(w.flag, wh.flag);
				if (d < bd) (best = wh), (bd = d);
			}
			if (best) {
				if (best.flag === w.flag) {
					const f = st.flags[w.flag];
					f.wares = f.wares.filter((/** @type {number} */ x) => x !== w.id);
					w.dest = best.id;
					deliver(w);
				} else claim(w, best, -1);
			}
		}
	}
	function supply(/** @type {any} */ b, /** @type {{ types: string[], slot: number }} */ req, /** @type {any[]} */ loose, /** @type {any[]} */ whs) {
		const m = route(b.flag);
		let best = null, bd = Infinity;
		for (const w of loose) {
			if (st.buildings[w.dest] && !isWarehouse(st.buildings[w.dest])) continue;
			if (!req.types.includes(w.type)) continue;
			const d = m.get(w.flag)?.d ?? Infinity;
			if (d < bd) (best = w), (bd = d);
		}
		if (best) {
			if (best.dest) best.dest = 0;
			claim(best, b, req.slot);
			return true;
		}
		const ranked = whs.map((wh) => /** @type {[number, any]} */ ([m.get(wh.flag)?.d ?? Infinity, wh])).filter(([d]) => d < Infinity).sort((x, y) => x[0] - y[0]);
		for (const [, wh] of ranked) {
			const f = st.flags[wh.flag];
			const type = req.types.filter((t) => (wh.stock[t] ?? 0) > 0).sort((x, y) => wh.stock[y] - wh.stock[x])[0];
			if (!type) continue;
			if (f.wares.length >= FLAG_CAP || (wh.emit ?? 0) > st.time) return false;
			wh.stock[type]--;
			wh.emit = st.time + 0.6;
			const w = newWare(type, f);
			claim(w, b, req.slot);
			return true;
		}
		return false;
	}

	// ── carriers ──
	/** a ware waiting at either end of a carrier's road to go along it: the carrier goes for the oldest */
	function carrierJob(/** @type {any} */ u) {
		const r = st.roads[u.road];
		if (!r) return false;
		let pick = null, end = 0;
		for (const [e, fid] of /** @type {[number, number][]} */ ([[0, r.a], [1, r.b]])) {
			const f = st.flags[fid];
			for (const wid of f.wares) {
				const w = st.wares[wid];
				if (w && w.dest && nextRoad(w) === r.id && (!pick || w.since < pick.since)) (pick = w), (end = e);
			}
		}
		if (!pick) return false;
		u.job = 'c-fetch';
		u.end = end;
		u.tgt = end ? r.path.length - 1 : 0;
		return true;
	}
	function carrierArrive(/** @type {any} */ u) {
		const r = st.roads[u.road];
		if (!r) return goHome(u);
		if (u.job === 'c-go') {
			u.path = r.path;
			u.p = 0;
			u.speed = CARRY;
			u.job = 'c-idle';
			u.tgt = Math.floor((r.path.length - 1) / 2);
			return;
		}
		const at = u.p === 0 ? r.a : r.b;
		const f = st.flags[at];
		if (u.job === 'c-fetch') {
			const wid = f.wares.find((/** @type {number} */ x) => st.wares[x]?.dest && nextRoad(st.wares[x]) === r.id);
			if (!wid) return idle(u, r);
			f.wares = f.wares.filter((/** @type {number} */ x) => x !== wid);
			const w = st.wares[wid];
			w.flag = 0;
			u.wareId = wid;
			u.ware = w.type;
			u.job = 'c-carry';
			u.tgt = u.p === 0 ? r.path.length - 1 : 0;
			return;
		}
		if (u.job === 'c-carry' || u.job === 'c-wait') {
			const w = st.wares[u.wareId];
			if (!w) {
				u.wareId = 0;
				u.ware = '';
				return idle(u, r);
			}
			const dest = st.buildings[w.dest];
			if (dest && dest.flag === f.id) {
				// in through the door
				u.job = 'c-in';
				u.wait = 0.7;
				return;
			}
			if (f.wares.length < FLAG_CAP) {
				w.flag = f.id;
				w.since = st.time;
				f.wares.push(w.id);
				u.wareId = 0;
				u.ware = '';
				return idle(u, r);
			}
			// the flag of a storehouse is full: the storehouse takes the ware in, and sends it on when there is room
			const home = bIndex().hubs.find((x) => x.flag === f.id && isWarehouse(x));
			if (home && isWarehouse(home) && home.owner === u.owner && home.stage === 'live') {
				unclaim(w);
				w.dest = home.id;
				u.job = 'c-in';
				u.wait = 0.7;
				return;
			}
			// the flag is full: swap with a ware going back the other way, or wait
			const back = f.wares.find((/** @type {number} */ x) => st.wares[x]?.dest && nextRoad(st.wares[x]) === r.id);
			if (back) {
				f.wares = f.wares.filter((/** @type {number} */ x) => x !== back);
				w.flag = f.id;
				w.since = st.time;
				f.wares.push(w.id);
				st.wares[back].flag = 0;
				u.wareId = back;
				u.ware = st.wares[back].type;
				u.job = 'c-carry';
				u.tgt = u.p === 0 ? r.path.length - 1 : 0;
				return;
			}
			u.job = 'c-wait';
		}
	}
	function idle(/** @type {any} */ u, /** @type {any} */ r) {
		u.job = 'c-idle';
		if (!carrierJob(u)) u.tgt = Math.floor((r.path.length - 1) / 2);
	}

	// ── buildings at work ──
	function flushOutput(/** @type {any} */ b, /** @type {string} */ ware) {
		const f = st.flags[b.flag];
		while (b.out > 0 && f && f.wares.length < FLAG_CAP) {
			newWare(ware, f);
			b.out--;
		}
		return b.out === 0;
	}
	/** a free spot of grass to plant on (a tree, a field): nothing on it, no path, and not where a hex keeps its ground
	 * clear (its square, its spots and round them, its village center) */
	function freeSpot(/** @type {number} */ j) {
		return st.terrain[j] === GRASS && !st.obj[j] && !st.road[j] && st.owner[j] <= PLAYER && !plan.clear[j];
	}
	/** what grew round a node is cleared: trees felled, rocks broken, fields ploughed under */
	function clearAround(/** @type {number} */ n, /** @type {number} */ r) {
		for (const j of g.within(n, r)) {
			const o = st.obj[j];
			if (!o || (o.k !== 'tree' && o.k !== 'rock' && o.k !== 'field')) continue;
			if (o.k === 'field' && st.buildings[o.b]) st.buildings[o.b].fields = Math.max(0, st.buildings[o.b].fields - 1);
			st.obj[j] = null;
			st.objV++;
		}
	}
	/** where a gatherer goes next: [the node it works, the node it stands on], or null */
	function findTarget(/** @type {any} */ b) {
		const t = T(b);
		const near = g.within(b.node, t.range ?? 0).sort((x, y) => g.dist(b.node, x) - g.dist(b.node, y));
		switch (b.type) {
			case 'woodcutter': {
				// a forester plants; from a woodcutter on, it fells a grown tree and plants a young one in its place, and
				// plants more while none is grown
				const grown = woodLevel(b) >= 2 ? near.find((n) => st.obj[n]?.k === 'tree' && st.obj[n].g >= 1 && !st.obj[n].r) : undefined;
				if (grown === undefined) {
					let trees = 0;
					for (const n of near) if (st.obj[n]?.k === 'tree') trees++;
					const spots = trees < FORESTER_TREES ? near.filter((n) => g.dist(b.node, n) >= 2 && g.dist(b.node, n) <= 8 && freeSpot(n)) : [];
					if (spots.length) {
						const j = spots[Math.floor(rand() * spots.length)];
						return [j, j];
					}
				}
				return grown === undefined ? null : [grown, grown];
			}
			case 'forester': {
				let trees = 0;
				for (const n of near) if (st.obj[n]?.k === 'tree') trees++;
				if (trees >= FORESTER_TREES) return null;
				const spots = near.filter((n) => g.dist(b.node, n) >= 2 && freeSpot(n));
				if (!spots.length) return null;
				const j = spots[Math.floor(rand() * spots.length)];
				return [j, j];
			}
		}
		return null;
	}
	const NOTHING = /** @type {Record<string, string>} */ ({ woodcutter: 'The forest round it is full, and no tree is grown yet', forester: 'The forest round it is full' });

	/** whether your orders export a ware to the world market: then its makers never rest, the world takes it all */
	const exported = (/** @type {string} */ w) => st.orders[w] === 'sell' || st.orders[w] === 'both';
	/** what one of your village centers paid out (imp) or took in (exp) in trade, and what it spent on wares from the
	 * world market, booked to its village's week (see eatAndDrink); and the energy a factory of its used
	 * @param {any} c @param {string} k @param {number} eur */
	const book = (c, k, eur) => {
		const p = st.vill[villageAt(c.node)];
		if (p) (p.pend ??= {}), (p.pend[k] = (p.pend[k] ?? 0) + eur);
	};
	/** how much of a ware the storehouses hold */
	const stocked = (/** @type {string} */ ware) => warehouses().reduce((s, w) => s + (w.stock[ware] ?? 0), 0);
	/** how many rounds a building's land gives it yet (trees to fell, loads of ore to dig): it gathers with the
	 * calendar, up to a quarter year's, and a new building starts with one */
	const quotaOf = (/** @type {any} */ b) => b.quota ?? 1;
	/** what a building that waits on its land says, as its recipe reads: what its land gives a week, and when the next
	 * round of it is ready */
	const waits = (/** @type {any} */ b) => {
		const r = RECIPES[b.type], days = Math.ceil(((1 - quotaOf(b)) * YEAR) / r.rounds), land = r.stages[levelOf(b) - 1].make.in[r.land] ?? 0;
		const when = `${days} ${days === 1 ? 'day' : 'days'}`;
		return `Land → ${fmt(land * r.rounds * WEEK_YEAR)} ${LAND[/** @type {keyof typeof LAND} */ (r.land)].label} a week · the next ${b.type === 'woodcutter' ? `tree (${land} t)` : `${land} t`} in ${when}`;
	};
	/**
	 * The crafting engine at work: a factory's round by its make recipe at its stage (./rules.js RECIPES). Its land gave
	 * the round already (its quota); the energy it takes is booked to its village's grid, and what it makes goes out to
	 * its stop a truckload at a time. How many loads it made. (Its build recipe is its builders' work, and its keep its
	 * village's upkeep: see finish and settlements.)
	 * @param {any} b
	 */
	function craft(b) {
		const r = recipe(b.type, levelOf(b)), t = T(b);
		if (!r) return 0;
		const n = Math.round(loadsRound(b.type, levelOf(b)));
		for (let k = 0; k < n; k++) {
			b.out++;
			made(/** @type {string} */ (t.out));
		}
		b.lately = (b.lately ?? 0) + n;
		book(b, 'kwhWork', (r.make.in.energy ?? 0) * 1000);
		return n;
	}
	function work(/** @type {any} */ b, /** @type {number} */ dt) {
		const t = T(b);
		// a wood or steel building's land gives it so much a year, on the calendar
		if (ROUNDS_YEAR[b.type] && b.stage === 'live') b.quota = Math.min(Math.max(1, ROUNDS_YEAR[b.type] / 4), quotaOf(b) + (ROUNDS_YEAR[b.type] * dt * PACE) / YEAR);
		if (b.stage === 'site') {
			const u = st.units[b.builder];
			if (!u || u.job !== 'b-work') return;
			if (b.timer > 0) {
				b.timer -= dt;
				if (b.timer <= 0) {
					const w = Object.keys(b.got).find((x) => b.got[x] > 0);
					if (w) (b.got[w]--, b.used[w]++);
					const total = Object.values(b.cost).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n, 0);
					const used = Object.values(b.used).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n, 0);
					if (used >= total) finish(b);
				}
			} else if (Object.values(b.got).some((n) => /** @type {number} */ (n) > 0)) {
				b.timer = 2.4;
				b.status = 'Being built';
			} else b.status = waitingFor(b);
			return;
		}
		if (b.stage !== 'live') return;
		if (isWarehouse(b) || !t.worker) return;
		const u = st.units[b.worker];
		if (!u || u.job === 'w-go') return;
		let busy = false;
		if (t.kind === 'make' || t.kind === 'mine') {
			if (b.timer > 0) {
				busy = true;
				b.timer -= dt;
				if (b.timer <= 0) {
					// a round of its recipe: more from the same land at each stage, and energy for it
					if (RECIPES[b.type]) craft(b);
					else
						for (let k = 0; k < (t.yield ?? 1); k++) {
							b.out++;
							made(/** @type {string} */ (t.out));
						}
					if (t.ore) b.deposit--;
				}
			}
			if (b.out > 0 && !flushOutput(b, /** @type {string} */ (t.out))) b.status = 'Its stop is full';
			else if (b.timer > 0) b.status = 'Working';
			else if (t.ore && b.deposit <= 0) b.status = 'The vein is used up';
			else if (RECIPES[b.type] && !loadsRound(b.type, levelOf(b))) {
				// a first stage that only gets its land ready (a sand pit): it makes nothing until it is upgraded
				const next = recipe(b.type, levelOf(b) + 1);
				b.status = `It ${recipe(b.type, levelOf(b))?.does ?? 'makes nothing yet'}${next ? `: upgrade it to a ${next.label.toLowerCase()}` : ''}`;
			}
			else if (stocked(/** @type {string} */ (t.out)) >= ENOUGH && !exported(/** @type {string} */ (t.out))) b.status = 'Resting: the storehouses are full of it';
			else if (ROUNDS_YEAR[b.type] && quotaOf(b) < 1) b.status = waits(b);
			else {
				const missing = b.slots.findIndex((/** @type {any} */ s) => s.have < 1);
				if (missing >= 0) b.status = `Waiting for ${/** @type {string[][]} */ (t.inputs)[missing].map((w) => WARES[w].label.toLowerCase()).join(' or ')}`;
				else {
					for (const s of b.slots) s.have--;
					if (ROUNDS_YEAR[b.type]) b.quota = quotaOf(b) - 1;
					b.timer = /** @type {number} */ (t.time);
					b.status = 'Working';
					busy = true;
				}
			}
		} else if (u.inside) {
			// a gatherer: rest, then out into the land
			if (b.out > 0 && !flushOutput(b, /** @type {string} */ (t.out))) b.status = 'Its stop is full';
			else if (b.timer > 0) b.timer -= dt;
			else if (t.out && stocked(t.out) >= ENOUGH && !exported(t.out) && !(b.type === 'woodcutter' && woodLevel(b) === 1)) {
				b.status = 'Resting: the storehouses are full of it';
				b.timer = 3;
			} else {
				const target = findTarget(b);
				const path = target && findPath(g, b.node, target[1], walkable, 1500);
				if (!target || !path) {
					b.status = b.type === 'woodcutter' && woodLevel(b) === 1 ? 'The forest round it is full: upgrade it to a woodcutter to fell trees' : NOTHING[b.type] ?? 'Nothing to do';
					b.timer = 3;
				} else if (b.type === 'woodcutter' && st.obj[target[0]] && quotaOf(b) < 1) {
					// a grown tree, but its land has given this year's: it waits for the calendar
					b.status = waits(b);
					b.timer = 3;
				} else {
					const plant = b.type === 'forester' || (b.type === 'woodcutter' && !st.obj[target[0]]);
					if (st.obj[target[0]] && !plant) st.obj[target[0]].r = u.id;
					Object.assign(u, { inside: false, path, p: 0, tgt: path.length - 1, job: 'w-out', target: target[0] });
					b.status = 'Working';
					busy = true;
				}
			}
		} else busy = true;
		b.eff += ((busy ? 1 : 0) - b.eff) * Math.min(1, dt / 40);
		// what it made lately, and over how many weeks: both fade over a quarter year
		if (b.lately !== undefined) {
			const weeks = (dt * PACE) / WEEK, fade = Math.exp(-weeks / LATELY);
			b.lately *= fade;
			b.span = (b.span ?? 0) * fade + weeks;
		}
	}
	function finish(/** @type {any} */ b) {
		// its build recipe's energy: its builders' cranes, welding and presses, for every tonne it is built of
		book(b, 'kwhWork', Object.values(b.cost).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n, 0) * LOAD_T * BUILD_MWH_T * 1000);
		// a village center that opens joins the trade routes dug to it
		if (b.type === 'centre') st.tunV++;
		if (b.type === 'house' || GROWS[b.type]) {
			const was = b.level;
			b.level = Math.max(1, b.level + (b.level ? 1 : 0));
			b.cost = {};
			if (was) {
				b.stage = 'live';
				b.status = '';
				const u = st.units[b.builder];
				b.builder = 0;
				if (u) goHome(u);
				say(b.type === 'house' ? `A house now holds ${HOUSE_BEDS[b.level - 1]} settlers` : `Your ${GROWS[b.type].levels[was - 1].label.toLowerCase()} is now a ${GROWS[b.type].levels[b.level - 1].label.toLowerCase()}`, b.node, 'good');
				st.objV++;
				return;
			}
		}
		b.stage = 'live';
		b.timer = 0;
		b.since = st.time;
		// a house's first finishing plants its hex's food forest
		if (b.type === 'house') st.forest[plan.plotOf[b.node]] ??= st.cal;
		const t = T(b);
		b.status = t.worker ? 'Waiting for a worker' : '';
		const u = st.units[b.builder];
		b.builder = 0;
		if (u) goHome(u);
		say(`${t.label} finished`, b.node, 'good');
		st.objV++;
		if (holdsLand(b.type)) territory();
	}
	/** what a gatherer does when it reaches its spot, and after */
	function workerArrive(/** @type {any} */ u) {
		const b = st.buildings[u.bld];
		if (!b) return goHome(u);
		if (u.job === 'w-go') {
			b.worker = u.id;
			u.inside = true;
			u.job = 'w-in';
			b.status = '';
			return;
		}
		if (u.job === 'w-out') {
			u.job = 'w-work';
			u.wait = /** @type {number} */ (T(b).time);
			return;
		}
		if (u.job === 'w-back') {
			u.inside = true;
			u.job = 'w-in';
			if (u.ware) {
				if (RECIPES[b.type]) craft(b);
				else
					for (let k = 0; k < (T(b).yield ?? 1); k++) {
						b.out++;
						made(u.ware);
					}
				u.ware = '';
			}
			b.timer = /** @type {number} */ (T(b).rest);
		}
	}
	function workerDone(/** @type {any} */ u) {
		const b = st.buildings[u.bld];
		if (!b) return goHome(u);
		const j = u.target, o = st.obj[j];
		if (o?.r === u.id) delete o.r;
		switch (b.type) {
			case 'woodcutter':
				if (o?.k === 'tree' && o.g >= 1 && woodLevel(b) >= 2) {
					st.obj[j] = { k: 'tree', g: 0.04 };
					u.ware = 'plank';
					b.quota = quotaOf(b) - 1;
					st.objV++;
				} else if (!o && !st.road[j]) {
					st.obj[j] = { k: 'tree', g: 0.04 };
					st.objV++;
				}
				break;
			case 'forester':
				if (!st.obj[j] && !st.road[j]) {
					st.obj[j] = { k: 'tree', g: 0.04 };
					st.objV++;
				}
				break;
		}
		const path = findPath(g, nodeOf(u), b.node, walkable, 1500) ?? [nodeOf(u), b.node];
		Object.assign(u, { path, p: 0, tgt: path.length - 1, job: 'w-back' });
	}

	// ── trade routes under the ground, and the carts on them ──
	/** your purse */
	/** your gold: what all your village centers' treasuries hold */
	const purse = () => myCentres().reduce((s, c) => s + (c.hearts ?? 0), 0) / HEARTS.perGold;
	/** what selling or buying a ware means for you now (./market.js) */
	const rule = (/** @type {string} */ w) => orderRule(w);
	/** every village center that stands: yours and the neighbours' */
	const centres = () => bIndex().hubs.filter((b) => (b.type === 'centre' || b.type === 'village') && b.stage === 'live');
	const myCentres = () => centres().filter((b) => b.owner === PLAYER);
	/** the wares a village center holds: yours in the building, a neighbour city's in its stores */
	const storeOf = (/** @type {any} */ c) => (c.type === 'centre' ? c.stock : st.parties[c.owner].stock);
	/** what is on its way to a village center */
	const comingTo = (/** @type {any} */ c) => (c.type === 'centre' ? (c.coming ??= {}) : st.parties[c.owner].coming);
	/** the neighbour's village center */
	const cityCentre = (/** @type {number} */ k) => st.buildings[st.villages[k - 1]];
	/** a neighbour city's village centers, its seat first, then the villages it founded in turn */
	const cityVillages = (/** @type {number} */ k) => bIndex().hubs.filter((b) => b.type === 'village' && b.owner === k).sort((a, b) => a.id - b.id);
	/** how many people a neighbour city holds when every one of its villages is full */
	const cityCap = (/** @type {number} */ k) => cityVillages(k).reduce((s, c) => s + capOf(villageAt(c.node)), 0);
	/** a neighbour city's people, village by village: each filled in turn, the newest takes what is left */
	function cityShares(/** @type {number} */ k) {
		const vs = cityVillages(k);
		let left = st.parties[k].pop;
		return vs.map((c, x) => {
			const cap = capOf(villageAt(c.node)), n = x === vs.length - 1 ? left : Math.min(cap, left);
			left -= n;
			return { c, v: villageAt(c.node), cap, pop: n };
		});
	}
	/** a neighbour city that is full and lives well founds its next village: free land beside one of its own, away from yours */
	function cityFounds(/** @type {number} */ k) {
		const mine = cityVillages(k);
		const ownV = new Set(mine.map((c) => villageAt(c.node)));
		const seat = cityCentre(k);
		if (!seat) return;
		const homes = (/** @type {number} */ v) => plan.villages[v].plots.filter((x) => x !== plan.villages[v].centre && plan.spots[x][0] >= 0 && st.terrain[plan.spots[x][0]] === GRASS).length;
		const free = plan.villages
			.map((vill, v) => ({ v, n: plan.centre[vill.centre] }))
			.filter(({ v, n }) => (st.villageOwner[v] ?? -1) === -1 && plan.plotOf[n] === plan.villages[v].centre && homes(v) >= 3)
			.filter(({ n }) => st.terrain[n] === GRASS && g.nb(n, SE) >= 0 && st.terrain[g.nb(n, SE)] === GRASS && st.obj[n]?.k !== 'bld' && !st.road[n] && !st.road[g.nb(n, SE)]);
		// rather not beside your villages, rather beside its own, rather on its own side of the valley (nearer its seat
		// than your first village center), then the nearest; boxed in, it takes the next free village it can
		const home = st.buildings[st.hq]?.node ?? -1;
		const byYou = (/** @type {number} */ v) => +plan.villages[v].near.some((x) => st.villageOwner[x] === PLAYER);
		const apart = (/** @type {number} */ v) => +!plan.villages[v].near.some((x) => ownV.has(x));
		const away = (/** @type {number} */ n) => +(home >= 0 && g.dist(n, seat.node) >= g.dist(n, home));
		const near = (/** @type {number} */ n) => Math.min(...mine.map((c) => g.dist(c.node, n)));
		const pick = free.sort((a, b) => byYou(a.v) - byYou(b.v) || apart(a.v) - apart(b.v) || away(a.n) - away(b.n) || near(a.n) - near(b.n))[0];
		if (!pick) return;
		if (st.obj[pick.n]) st.obj[pick.n] = null;
		const b = makeBuilding('village', pick.n, k, true);
		const to = mine.sort((x, y) => g.dist(x.node, pick.n) - g.dist(y.node, pick.n))[0];
		dig(b, to, false);
		territory();
		say(`${st.parties[k].name} founded its ${['', '', 'second', 'third', 'fourth', 'fifth'][mine.length + 1] ?? 'next'} village`, pick.n, 'info');
	}
	let tunSeen = -1;
	/** @type {Map<number, Map<number, number[]>>} */
	const ways = new Map();
	/** every village center one reaches along the trade routes, through anyone's, with the way there (nodes) */
	function reach(/** @type {number} */ from) {
		if (tunSeen !== st.tunV) {
			tunSeen = st.tunV;
			ways.clear();
		}
		let m = ways.get(from);
		if (m) return m;
		const a = st.buildings[from];
		m = new Map([[from, a ? [stopAt(a)] : []]]);
		const open = [from];
		while (open.length) {
			const x = /** @type {number} */ (open.shift());
			const here = /** @type {number[]} */ (m.get(x));
			for (const t of all(st.tunnels)) {
				const y = t.a === x ? t.b : t.b === x ? t.a : 0;
				if (!y || m.has(y) || st.buildings[y]?.stage !== 'live') continue;
				const p = t.a === x ? t.path : [...t.path].reverse();
				m.set(y, [...here, ...p.slice(1)]);
				open.push(y);
			}
		}
		ways.set(from, m);
		return m;
	}
	/** your village centers joined to one of yours by trade routes, itself first: what they hold, they pay together */
	const pool = (/** @type {any} */ a) => [a, ...[...reach(a.id).keys()].map((id) => st.buildings[id]).filter((c) => c && c !== a && c.type === 'centre' && c.owner === PLAYER)];
	function payPooled(/** @type {any} */ a, /** @type {Record<string, number>} */ cost) {
		for (const [w, n] of Object.entries(cost)) {
			let left = n;
			for (const c of pool(a)) {
				const k = Math.min(left, c.stock[w] ?? 0);
				c.stock[w] = (c.stock[w] ?? 0) - k;
				left -= k;
			}
		}
	}
	/** the gold your village centers joined to one of yours hold, in € (HEARTs) */
	const goldIn = (/** @type {any} */ a) => pool(a).reduce((s, c) => s + Math.max(0, c.hearts ?? 0), 0);
	/** what a village center may still borrow, in € (./market.js LOAN): 125 gold a villager, less what it owes and what
	 * it is behind */
	const credit = (/** @type {any} */ c) => (c.type === 'centre' ? Math.max(0, LOAN.perHead * villagePeople(villageAt(c.node)) - (c.loan?.left ?? 0) - Math.max(0, -(c.hearts ?? 0))) : 0);
	/** what the world market asks for what the stores joined to a village center lack of a cost, in € */
	const lacking = (/** @type {any} */ a, /** @type {Record<string, number>} */ cost) =>
		Object.entries(cost).reduce((e, [w, n]) => e + Math.max(0, n - pool(a).reduce((s, c) => s + (c.stock[w] ?? 0), 0)) * (WORLD[w]?.eur ?? Infinity), 0);
	/** whether a village center can pay for something: from the stores joined to it, what they lack bought from the
	 * world market with their gold, and gold besides; what they lack of that it borrows @param {any} a @param {Record<string, number>} cost */
	const payable = (a, cost, eur = 0) => lacking(a, cost) + eur <= goldIn(a) + credit(a);
	/** gold paid out of the treasuries joined to a village center, its own first, for the world market; what they lack
	 * it borrows @param {any} a @param {number} eur */
	function spend(a, eur) {
		let left = eur;
		for (const c of pool(a)) {
			const k = Math.min(left, Math.max(0, c.hearts ?? 0));
			if (k <= 0) continue;
			c.hearts -= k;
			book(c, 'imp', k);
			book(c, 'wimp', k);
			book(c, 'wares', k);
			left -= k;
		}
		if (left > 0) {
			a.hearts = (a.hearts ?? 0) - left;
			book(a, 'imp', left);
			book(a, 'wimp', left);
			book(a, 'wares', left);
		}
	}
	/** pay for something (see payable): what the stores lack is bought from the world market first, then it all goes,
	 * and the gold besides @param {any} a @param {Record<string, number>} cost */
	function payAll(a, cost, eur = 0) {
		for (const [w, n] of Object.entries(cost)) {
			const lack = Math.max(0, n - pool(a).reduce((s, c) => s + (c.stock[w] ?? 0), 0));
			if (lack <= 0) continue;
			spend(a, lack * WORLD[w].eur);
			a.stock[w] = (a.stock[w] ?? 0) + lack;
			st.market.fromWorld[w] = (st.market.fromWorld[w] ?? 0) + lack;
		}
		payPooled(a, cost);
		if (eur > 0) spend(a, eur);
	}
	/** a village center's stop: the middle of its hex, where its trade routes start */
	const stopAt = (/** @type {any} */ c) => st.flags[c.flag]?.node ?? c.node;
	/** what a trade route between two village centers costs, in loads of fired clay: the real tunnel's 36,000 t a km */
	const tunnelCost = (/** @type {number} */ a, /** @type {number} */ b) => Math.ceil((((g.dist(a, b) * STEP * UNIT_M) / 1000) * ROUTE_T_KM) / LOAD_T);
	/** dig a trade route between two village centers (paid by the first) */
	function dig(/** @type {any} */ a, /** @type {any} */ b, pay = true) {
		// always straight from center to center, under whatever lies between: the nodes along the line, a step apart
		const an = stopAt(a), bn = stopAt(b);
		const n = Math.max(1, g.dist(an, bn)), ax = g.x(an), az = g.z(an), bx = g.x(bn), bz = g.z(bn);
		/** @type {number[]} */
		const path = [];
		for (let k = 0; k <= n; k++) {
			const j = k === 0 ? an : k === n ? bn : g.at(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
			if (j >= 0 && j !== path[path.length - 1]) path.push(j);
		}
		if (pay) payAll(a, { clay: tunnelCost(an, bn) });
		const t = { id: newId(), a: a.id, b: b.id, path, owner: a.owner };
		st.tunnels[t.id] = t;
		st.tunV++;
		return t;
	}
	/** a cart sets out along the trade routes, at twice a walker's pace */
	function sendCart(/** @type {any} */ from, /** @type {any} */ to, /** @type {Record<string, number>} */ load, /** @type {any} */ deal, /** @type {number[] | null} */ way = null) {
		const path = way ?? reach(from.id).get(to.id);
		if (!path || path.length < 2) return null;
		for (const [w, n] of Object.entries(load)) comingTo(to)[w] = (comingTo(to)[w] ?? 0) + n;
		return spawn('cart', from.owner, path, 'cart', { load, deal, to: to.id, speed: CART_SPEED * 2, ware: Object.keys(load)[0] ?? '' });
	}
	function cartArrive(/** @type {any} */ u) {
		const to = st.buildings[u.to], d = u.deal;
		removeUnit(u);
		for (const [w, n] of Object.entries(u.load)) {
			if (!to) continue;
			comingTo(to)[w] = Math.max(0, (comingTo(to)[w] ?? 0) - /** @type {number} */ (n));
			storeOf(to)[w] = (storeOf(to)[w] ?? 0) + /** @type {number} */ (n);
		}
		if (!to) return;
		if (d.settlers) to.settlers += d.settlers;
		if (d.kind === 'found') {
			finish(to);
			say('A new village is founded: build houses round its center', to.node, 'good');
		}
		// the buyer pays on delivery
		if (d.pay) st.parties[d.seller].coins += d.pay;
		// between your own villages: the giver's treasury gets the gold, and it counts as trade
		if (d.hearts) {
			const giver = st.buildings[d.from];
			if (giver) (giver.hearts = (giver.hearts ?? 0) + d.hearts), book(giver, 'exp', d.hearts);
			st.market.sold += /** @type {number} */ (Object.values(u.load)[0] ?? 0);
		}
		if (d.kind === 'request') {
			const c = st.market.contracts.find((/** @type {any} */ x) => x.id === d.cid);
			if (c) {
				const n = /** @type {number} */ (Object.values(u.load)[0] ?? 0);
				c.got += n;
				c.sending = Math.max(0, (c.sending ?? 0) - n);
				st.market.sold += n;
				if (c.got >= c.n) {
					const p = st.parties[c.k];
					const paid = Math.min(c.reward, Math.floor(p.coins));
					p.coins -= paid;
					st.parties[PLAYER].coins += paid;
					st.market.filled++;
					say(paid ? `${p.name} got its ${WARES[c.w].label.toLowerCase()} and paid ${paid} coins. Thank you!` : `${p.name} thanks you for the ${WARES[c.w].label.toLowerCase()}!`, to.node, 'good');
				}
			}
		}
	}
	/** what a village of yours wants to hold of a ware: a few loads of wood and steel, what its sites wait for, what its
	 * factories work with */
	function wantAt(/** @type {any} */ c, /** @type {string} */ w) {
		const v = villageAt(c.node);
		let want = 0;
		for (const b of mineIn(v)) {
			if (b.stage === 'site') want += Math.max(0, (b.cost[w] ?? 0) - (b.used[w] ?? 0) - (b.got[w] ?? 0) - (b.inc[w] ?? 0));
			else if ((T(b).inputs ?? []).some((/** @type {string[]} */ s) => s.includes(w))) want += 4;
		}
		if (w === 'plank' || w === 'steel') want = Math.max(want, 6);
		return want;
	}
	/** a cart already on its way with a ware between two places */
	const onWay = (/** @type {number} */ to, /** @type {string} */ w) => uIndex().carts.some((u) => u.to === to && u.load[w]);
	/** every few seconds: wares shared between your villages, your sales and purchases, the neighbours' trade, requests */
	function trade() {
		const m = st.market, mine = myCentres();
		// your villages share: from the one best stocked to the one worst stocked, for what each wants
		for (const w of TRADED) {
			const rows = mine.map((c) => {
				const want = Math.max(1, wantAt(c, w)), have = c.stock[w] ?? 0;
				return { c, want, have, r: (have + (comingTo(c)[w] ?? 0)) / want };
			});
			const donor = rows.reduce((a, b) => (b.r > a.r ? b : a), rows[0]), recv = rows.reduce((a, b) => (b.r < a.r ? b : a), rows[0]);
			if (!donor || donor === recv || donor.r - recv.r < 0.3 || recv.r >= 1.5 || !reach(donor.c.id).has(recv.c.id) || onWay(recv.c.id, w)) continue;
			// as much as evens them out: the taker pays in gold, to the giver, on delivery (into debt if it must)
			const even = (donor.have + recv.have + (comingTo(recv.c)[w] ?? 0)) / (donor.want + recv.want);
			const each = heartsFor(w);
			const n = Math.min(CART, Math.floor(donor.have - even * donor.want), Math.ceil(even * recv.want - recv.have - (comingTo(recv.c)[w] ?? 0)));
			if (n < 1) continue;
			donor.c.stock[w] -= n;
			recv.c.hearts -= n * each;
			book(recv.c, 'imp', n * each);
			sendCart(donor.c, recv.c, { [w]: n }, { kind: 'move', hearts: n * each, from: donor.c.id });
		}
		// and settlers move to where there are beds for them
		for (const c of mine) {
			const v = villageAt(c.node);
			// to fill new beds
			if (c.settlers > 0 || villagePeople(v) >= bedsIn(v)) continue;
			const from = mine.find((x) => x !== c && x.settlers >= 4 && reach(x.id).has(c.id));
			if (!from || uIndex().carts.some((u) => u.to === c.id && u.deal.settlers)) continue;
			from.settlers -= 2;
			sendCart(from, c, {}, { kind: 'move', settlers: 2 });
		}
		const total = (/** @type {string} */ w) => mine.reduce((s, c) => s + (c.stock[w] ?? 0), 0);
		const coming = (/** @type {string} */ w) => mine.reduce((s, c) => s + (comingTo(c)[w] ?? 0), 0);
		const you = st.parties[PLAYER];
		for (let k = 1; k < st.parties.length; k++) {
			const p = st.parties[k], their = cityCentre(k);
			if (!their) continue;
			const near = mine.filter((c) => reach(c.id).has(their.id));
			if (!near.length) continue;
			for (const w of TRADED) {
				const r = rule(w);
				// what you sell: to whoever pays most (the first neighbour that pays enough, as each is asked in turn)
				if (st.orders[w] === 'sell' && !onWay(their.id, w)) {
					const spare = Math.floor(total(w) - r.keep), price = priceIn(p, w);
					const n = Math.min(CART, spare, shortIn(p, w), Math.floor(p.coins / Math.max(0.1, price)));
					const from = near.filter((c) => (c.stock[w] ?? 0) >= n).sort((a, b) => b.stock[w] - a.stock[w])[0];
					if (n >= 1 && price >= r.above && from) {
						const pay = Math.min(p.coins, Math.round(n * price * 10) / 10);
						from.stock[w] -= n;
						p.coins -= pay;
						sendCart(from, their, { [w]: n }, { kind: 'sale', pay, seller: PLAYER });
						m.sold += n;
					}
				}
				// what you buy: from whoever asks least
				if (st.orders[w] === 'buy') {
					const price = priceIn(p, w);
					const n = Math.min(CART, Math.ceil(r.upTo - total(w) - coming(w)), spareIn(p, w), Math.floor(you.coins / Math.max(0.1, price)));
					const to = near.sort((a, b) => (a.stock[w] ?? 0) - (b.stock[w] ?? 0))[0];
					const cheaper = st.parties.some((/** @type {any} */ q, /** @type {number} */ j) => j > 0 && j !== k && cityCentre(j) && near.some((c) => reach(c.id).has(cityCentre(j).id)) && spareIn(q, w) >= 1 && priceIn(q, w) < price);
					if (n >= 1 && price <= r.below && !cheaper && !onWay(to.id, w)) {
						const pay = Math.min(you.coins, Math.round(n * price * 10) / 10);
						p.stock[w] -= n;
						you.coins -= pay;
						sendCart(their, to, { [w]: n }, { kind: 'sale', pay, seller: k });
						m.bought += n;
					}
				}
			}
			// requests you took: a cart brings them
			for (const c of m.contracts) {
				if (c.k !== k || !c.taken || c.got + (c.sending ?? 0) >= c.n || c.until <= st.time) continue;
				const from = near.filter((x) => (x.stock[c.w] ?? 0) >= 1).sort((a, b) => b.stock[c.w] - a.stock[c.w])[0];
				if (!from) continue;
				const n = Math.min(CART, c.n - c.got - (c.sending ?? 0), Math.floor(from.stock[c.w]));
				from.stock[c.w] -= n;
				c.sending = (c.sending ?? 0) + n;
				sendCart(from, their, { [c.w]: n }, { kind: 'request', cid: c.id });
			}
		}
		// the neighbours trade with each other where a route runs between them: the ware the buyer lacks most
		for (let a = 1; a < st.parties.length; a++)
			for (let b = 1; b < st.parties.length; b++) {
				const pa = st.parties[a], pb = st.parties[b], ca = cityCentre(a), cb = cityCentre(b);
				if (a === b || !ca || !cb || !reach(ca.id).has(cb.id)) continue;
				const w = TRADED.filter((x) => spareIn(pa, x) >= 3 && shortIn(pb, x) >= 1 && !onWay(cb.id, x)).sort((x, y) => shortIn(pb, y) / keepOf(pb, y) - shortIn(pb, x) / keepOf(pb, x))[0];
				if (!w) continue;
				const price = priceIn(pb, w);
				const n = Math.min(CART, spareIn(pa, w), shortIn(pb, w), Math.floor(pb.coins / Math.max(0.1, price)));
				if (n < 1) continue;
				const pay = Math.min(pb.coins, Math.round(n * price * 10) / 10);
				pa.stock[w] -= n;
				pb.coins -= pay;
				sendCart(ca, cb, { [w]: n }, { kind: 'sale', pay, seller: a });
			}
		// and the world market trades by your orders, a cart's worth at a time: it sells what you are short of to the
		// village that lacks it most, paid from its treasury while it keeps two weeks of its food in hand, and it buys
		// what you have beyond that, from the village with the most to spare
		for (const w of TRADED) {
			// what your orders keep in store: their usual stock, or what your homes and building sites want, if more
			const o = st.orders[w], upTo = Math.max(rule(w).upTo, Math.ceil(mine.reduce((s, c) => s + wantAt(c, w), 0)));
			if (o === 'buy' || o === 'both') {
				const short = Math.ceil(upTo - total(w) - coming(w));
				const to = [...mine].sort((a, b) => (a.stock[w] ?? 0) - wantAt(a, w) - ((b.stock[w] ?? 0) - wantAt(b, w)))[0];
				if (short >= 1 && to) worldBuy(to, w, Math.min(CART, short), villagePeople(villageAt(to.node)) * FOOD_KG * KEEP * PRICE.world);
			}
			if (o === 'sell' || o === 'both') {
				const spare = Math.floor(total(w) - upTo);
				const from = [...mine].sort((a, b) => (b.stock[w] ?? 0) - wantAt(b, w) - ((a.stock[w] ?? 0) - wantAt(a, w)))[0];
				if (spare >= CART && from) worldSell(from, w, Math.min(CART, spare, Math.floor((from.stock[w] ?? 0) - wantAt(from, w))));
			}
		}
	}
	/**
	 * Buy from the world market (./market.js WORLD): a village center pays from its treasury, never into debt, beyond
	 * what it keeps in hand, and the wares are in its storehouse at once. How many it bought.
	 * @param {any} c @param {string} w @param {number} n @param {number} [keep] HEARTs (€) it keeps
	 */
	function worldBuy(c, w, n, keep = 0) {
		const price = WORLD[w]?.eur;
		if (!price) return 0;
		// what its treasury lacks it borrows
		const k = Math.min(n, Math.floor((Math.max(0, c.hearts ?? 0) - keep + credit(c)) / price));
		if (k < 1) return 0;
		c.hearts -= k * price;
		c.stock[w] = (c.stock[w] ?? 0) + k;
		book(c, 'imp', k * price);
		book(c, 'wimp', k * price);
		book(c, 'wares', k * price);
		st.market.fromWorld[w] = (st.market.fromWorld[w] ?? 0) + k;
		return k;
	}
	/**
	 * Sell to the world market at its price: a village center's storehouse lets go of the wares and its treasury takes
	 * the gold, an export. How many it sold.
	 * @param {any} c @param {string} w @param {number} n
	 */
	function worldSell(c, w, n) {
		const price = WORLD[w]?.eur;
		const k = Math.min(n, Math.floor(c.stock[w] ?? 0));
		if (!price || k < 1) return 0;
		c.stock[w] -= k;
		c.hearts = (c.hearts ?? 0) + k * price;
		book(c, 'exp', k * price);
		book(c, 'wexp', k * price);
		st.market.toWorld[w] = (st.market.toWorld[w] ?? 0) + k;
		return k;
	}

	// ── the land ──
	function territory() {
		// a village belongs to whoever has its village center
		const vo = Array(plan.villages.length).fill(-1);
		for (const b of [...blds()].sort((x, y) => x.since - y.since)) if (holdsLand(b.type) && vo[villageAt(b.node)] === -1) vo[villageAt(b.node)] = b.owner;
		st.villageOwner = vo;
		const own = Array(N).fill(-1);
		for (let i = 0; i < N; i++) own[i] = vo[villageAt(i)];
		st.owner = own;
		st.terV++;
		// what stands on land its owner lost, burns
		for (const b of blds())
			if (st.buildings[b.id] && b.owner === PLAYER && own[b.node] !== b.owner) {
				if (b.owner === PLAYER) say(`Your ${T(b).label.toLowerCase()} burned: the land is no longer yours`, b.node, 'alert');
				removeBuilding(b, true, false);
			}
		for (const f of all(st.flags)) if (st.flags[f.id] && f.owner === PLAYER && own[f.node] !== f.owner) removeFlag(f);
		for (const r of roads()) if (st.roads[r.id] && r.path.some((/** @type {number} */ n) => own[n] !== r.owner)) removeRoad(r);
	}

	// ── homes ──
	/** the beds in one of your villages: every house's (a house being enlarged keeps its beds meanwhile); nobody lives in a village center */
	const bedsIn = (/** @type {number} */ v) => mineIn(v).reduce((s, b) => s + (b.type === 'house' && b.level ? HOUSE_BEDS[b.level - 1] : 0), 0);
	const beds = () => myCentres().reduce((s, c) => s + bedsIn(villageAt(c.node)), 0);
	/** the neighbours' cities as they grow: a settlement (a house, two factories) for every full house of people */
	function neighbourTowns() {
		for (let k = 1; k < st.parties.length; k++) {
			const kinds = NEIGHBOURS[k - 1].builds;
			for (const { c, v, pop } of cityShares(k)) {
				const vill = plan.villages[v];
				// the settlements with room for a house first, nearest the center first
				const home = (/** @type {number} */ x) => plan.spots[x][0] >= 0 && st.terrain[plan.spots[x][0]] === GRASS;
				const ring = vill.plots.filter((x) => x !== vill.centre).sort((a, b) => +home(b) - +home(a) || g.dist(plan.centre[a], c.node) - g.dist(plan.centre[b], c.node));
				const count = Math.max(1, Math.min(ring.length, Math.ceil(pop / HOUSE_MOST)));
				let level = 1;
				while (level < HOUSE_TOP && count * HOUSE_BEDS[level - 1] < pop) level++;
				ring.slice(0, count).forEach((plot, x) => {
					const [h, f1, f2] = plan.spots[plot];
					if (h >= 0) {
						const b = buildingAt(h);
						if (!b) {
							if (st.obj[h]) st.obj[h] = null;
							const nb = makeBuilding('house', h, k, true);
							nb.level = level;
							nb.since = -1;
						} else if (b.type === 'house' && b.owner === k && b.level !== level) {
							b.level = level;
							st.objV++;
						}
					}
					for (const [y, spot] of [f1, f2].entries()) {
						if (spot < 0 || buildingAt(spot) || st.road[spot]) continue;
						const type = kinds[(x * 2 + y) % kinds.length];
						if (BUILDINGS[type].on === 'mountain' ? st.terrain[spot] !== MOUNTAIN : st.terrain[spot] === WATER) continue;
						if (st.obj[spot]) st.obj[spot] = null;
						makeBuilding(type, spot, k, true).since = -1;
					}
				});
				cityPaths(k, c, v);
			}
		}
	}

	/** lay a path: trees felled, rocks broken and fields ploughed under, a stop at each end, and a stop wherever it meets
	 * another path or crosses a settlement's middle, so paths join each other there */
	function layPath(/** @type {number[]} */ path, /** @type {number} */ owner) {
		for (const j of path) if (st.obj[j]?.k !== 'flag' && st.obj[j]?.k !== 'bld') clearAround(j, 0);
		const cut = path.map((j, x) => x === 0 || x === path.length - 1 || !!flagAt(j) || !!st.road[j] || plan.centre[plan.plotOf[j]] === j);
		for (const [x, j] of path.entries()) if (cut[x] && !flagAt(j)) makeFlag(j, owner);
		/** @type {any} */
		let r = null;
		for (let x = 0, y = 1; y < path.length; y++)
			if (cut[y]) {
				const seg = path.slice(x, y + 1);
				const fa = flagAt(seg[0]), fb = flagAt(seg[seg.length - 1]);
				if (fa && fb && !joins(fa.id, fb.id)) r = makeRoad(seg, owner);
				x = y;
			}
		return r;
	}
	/** a neighbour's walking paths, laid as yours are: from the middle of each settlement that has a building, hex by
	 * hex to its village center, over the free nodes between the spots */
	function cityPaths(/** @type {number} */ k, /** @type {any} */ c, /** @type {number} */ v) {
		const vill = plan.villages[v];
		const middle = vill.centre;
		const stop = (/** @type {number} */ plot) => (plot === middle ? st.flags[c.flag]?.node ?? -1 : plan.centre[plot]);
		const linked = (/** @type {any} */ fa, /** @type {any} */ fb) => joins(fa.id, fb.id);
		// every hex of the village, by its steps to the middle
		/** @type {Map<number, number>} */
		const toward = new Map([[middle, -1]]);
		const open = [middle];
		while (open.length) {
			const p = /** @type {number} */ (open.shift());
			for (const q of nearPlots(p)) if (!toward.has(q) && vill.plots.includes(q)) (toward.set(q, p), open.push(q));
		}
		for (const plot of vill.plots) {
			if (plot === middle || !plan.spots[plot].some((n) => n >= 0 && buildingAt(n)?.owner === k)) continue;
			for (let p = plot, q = toward.get(plot) ?? -1; q >= 0; p = q, q = toward.get(q) ?? -1) {
				const a = stop(p), b = stop(q);
				if (a < 0 || b < 0 || st.terrain[a] === WATER || st.terrain[b] === WATER) break;
				for (const n of [a, b]) if (!flagAt(n)) {
					if (st.obj[n] && st.obj[n].k !== 'tree') break;
					st.obj[n] = null;
					makeFlag(n, k);
				}
				const fa = flagAt(a), fb = flagAt(b);
				if (!fa || !fb) break;
				if (linked(fa, fb)) continue;
				const meet = (/** @type {number} */ j) => !st.obj[j] || st.obj[j].k === 'tree' || (st.obj[j].k === 'flag' && flagAt(j)?.owner === k);
				const ok = (/** @type {number} */ j) => (plan.plotOf[j] === p || plan.plotOf[j] === q) && (plan.spotOf[j] < 0 || plan.plotOf[j] === middle) && st.terrain[j] !== WATER && meet(j) && (!st.road[j] || st.roads[st.road[j]]?.owner === k);
				const path = findPath(g, a, b, ok, 400);
				if (!path) break;
				layPath(path, k);
			}
		}
	}

	// ── the villages and cities: needs, the neighbours' work ──
	/** the people of one of your villages: those who live in it (its robots are not people) */
	const villagePeople = (/** @type {number} */ v) => {
		let n = 0;
		for (const b of mineIn(v)) if (b.type === 'centre') n += b.settlers;
		return n + (uIndex().folk.get(v) ?? 0);
	};
	/** all your people */
	const yourPeople = () => myCentres().reduce((s, c) => s + villagePeople(villageAt(c.node)), 0);
	/** your villages that have a center standing, with how each lives */
	function yourVillages() {
		return myCentres().map((c) => {
			const v = villageAt(c.node);
			// a new village's cistern starts full: the least a village's tanks hold
			const p = (st.vill[v] ??= { ...party(`Village ${Object.keys(st.vill).length + 1}`, 0), v, litres: CISTERN });
			return { v, c, p };
		});
	}
	/** whether a village is full: a house of the largest size in each of its settlements that can hold one, and every bed taken */
	function fullVillage(/** @type {number} */ v, /** @type {number} */ owner) {
		const vill = plan.villages[v];
		for (const k of vill.plots) {
			if (k === vill.centre) continue;
			const h = plan.spots[k][0];
			if (h < 0 || st.terrain[h] !== GRASS) continue;
			const b = buildingAt(h);
			if (!b || b.owner !== owner || b.type !== 'house' || b.level < HOUSE_TOP || b.stage !== 'live') return false;
		}
		return owner === PLAYER ? villagePeople(v) >= bedsIn(v) : true;
	}
	/** the share of what a village's people eat that its hexes' food forests grow now: each house's hex by its age,
	 * weighed by its beds */
	function forestOf(/** @type {number} */ v) {
		let beds = 0, grown = 0;
		for (const b of mineIn(v))
			if (b.type === 'house' && b.level) {
				const n = HOUSE_BEDS[b.level - 1], k = plan.plotOf[b.node];
				beds += n;
				grown += n * forestShare((st.cal - (st.forest[k] ?? st.cal)) / YEAR);
			}
		return beds ? grown / beds : 0;
	}
	/** litres a day its houses' roofs catch now: each bed's share of its dome's roof, as much as falls this month */
	const rainIn = (/** @type {number} */ v) => bedsIn(v) * RAIN_L * RAIN_MONTH[calendar(st.cal).month - 1];
	/** litres its tanks hold: four weeks of fresh water for each bed (or each person, if more), at least the cistern a
	 * village starts with */
	const tankOf = (/** @type {number} */ v, /** @type {number} */ pop) => Math.max(CISTERN, Math.max(pop, bedsIn(v)) * FRESH_L * 7 * TANK);
	/** whether a village's tanks run dry within so many days: its roofs catch less than it uses, and they hold less
	 * than that many days of it */
	const runsDry = (/** @type {number} */ v, /** @type {any} */ p, /** @type {number} */ days) => p.pop > 0 && (p.litres ?? 0) < p.pop * FRESH_L * days && rainIn(v) < p.pop * FRESH_L;
	/** kWh a day its domes' solar glass makes now: each bed's share, as much as the sun gives this month */
	const sunIn = (/** @type {number} */ v) => bedsIn(v) * sunBedDay(calendar(st.cal).month);
	/** kWh a day a village center's geothermal plant makes, day and night, as much of the time as it runs */
	const wellsDay = (/** @type {any} */ c) => plantOf(c) * ENERGY.wellKw * 24 * ENERGY.uptime;
	/** kWh a day so many people use at home */
	const homeDay = (/** @type {number} */ pop) => (pop * ENERGY.home) / YEAR;
	/** kWh a day a village center uses at its stage (its keep): its hall, its storehouse, its trade routes' lights and
	 * trains; a logistics hub less */
	const centreDay = (/** @type {any} */ c) => (centreStage(levelOf(c)).use.in.energy * 1000) / WEEK;
	/** kWh a day its domes' climate uses: each bed's share, taken or not */
	const climateIn = (/** @type {number} */ v) => (bedsIn(v) * ENERGY.climateBed) / YEAR;
	/**
	 * A while of eating and drinking, in kg and litres (./food.js): each village's forests grow, its people eat from its
	 * store, its roofs catch rain into its tanks, and its people use their fresh water (the crops take
	 * its greywater again). What its store lacks of what they eat it buys as they eat it: first from your villages
	 * joined to it that have more than two weeks put by (5 € a kg, to them), then from the world market (10 € a kg);
	 * tanks share their water along the trade routes, and what they lack of what is used the world market sells
	 * (2 € a m³); what the tanks cannot hold runs off. It buys only with the gold its treasury holds: without, its people go short.
	 * Its energy too: its center's wells and its domes' solar cells make it, its people, domes, center and factories use it; what a
	 * village lacks its joined villages give from what they have over, and the world grid buys what is left over and
	 * sells what is still lacking (8 cents a kWh).
	 * What a village did, a week, is kept in its `flow`.
	 * @param {{ v: number, c: any, p: any }[]} vs @param {number} dd the days of the valley's calendar gone by
	 */
	function eatAndDrink(vs, dd) {
		if (dd <= 0) return;
		const days = dd / DAY, fade = 1 - Math.exp(-dd / (4 * WEEK));
		/** @type {Map<any, Record<string, number>>} */
		const did = new Map();
		const add = (/** @type {any} */ p, /** @type {string} */ k, /** @type {number} */ n) => {
			const d = did.get(p) ?? {};
			d[k] = (d[k] ?? 0) + n;
			did.set(p, d);
		};
		/** what each village eats and drinks meanwhile, kg and litres */
		const want = new Map();
		for (const { v, p } of vs) {
			p.kg ??= 0;
			p.litres ??= 0;
			const need = (p.pop * FOOD_KG * days) / 7, grown = need * forestOf(v), rain = rainIn(v) * days;
			want.set(p, { need, thirst: p.pop * FRESH_L * days });
			p.kg += grown;
			p.litres += rain;
			add(p, 'grown', grown);
			add(p, 'rain', rain);
		}
		// what its store lacks of what its people eat now: from your joined villages with more than two weeks put by,
		// then from the world market
		const keepOf = (/** @type {any} */ p) => p.pop * FOOD_KG * KEEP;
		/** what a treasury can pay, in HEARTs (€): all it needs, borrowing what it lacks */
		const can = (/** @type {any} */ c) => Math.max(0, c.hearts ?? 0) + credit(c);
		for (const x of vs) {
			let short = want.get(x.p).need - x.p.kg;
			if (short <= 0) continue;
			const near = reach(x.c.id);
			for (const y of vs) {
				if (y === x || !near.has(y.c.id)) continue;
				const n = Math.min(short, y.p.kg - keepOf(y.p), can(x.c) / PRICE.village);
				if (n <= 0) continue;
				y.p.kg -= n;
				x.p.kg += n;
				short -= n;
				const eur = n * PRICE.village;
				x.c.hearts = (x.c.hearts ?? 0) - eur;
				y.c.hearts = (y.c.hearts ?? 0) + eur;
				add(x.p, 'fromVillages', n);
				add(x.p, 'spent', eur);
				add(x.p, 'imp', eur);
				add(y.p, 'sold', n);
				add(y.p, 'earned', eur);
				add(y.p, 'exp', eur);
				if (short <= 0) break;
			}
			const n = Math.min(short, can(x.c) / PRICE.world);
			if (n > 0) {
				x.p.kg += n;
				x.c.hearts = (x.c.hearts ?? 0) - n * PRICE.world;
				add(x.p, 'fromWorld', n);
				add(x.p, 'spent', n * PRICE.world);
				add(x.p, 'imp', n * PRICE.world);
				add(x.p, 'wimp', n * PRICE.world);
			}
		}
		// water runs along the trade routes from tanks with more than two weeks to tanks with less
		for (const x of vs) {
			const two = x.p.pop * FRESH_L * 7 * KEEP;
			for (const y of vs) {
				if (x.p.litres >= two) break;
				if (y === x || !reach(x.c.id).has(y.c.id)) continue;
				const n = Math.min(two - x.p.litres, y.p.litres - y.p.pop * FRESH_L * 7 * KEEP);
				if (n > 0) (y.p.litres -= n), (x.p.litres += n);
			}
		}
		for (const x of vs) {
			const { need, thirst } = want.get(x.p);
			// what its rain and the routes leave short of what its people use, the world market sells
			const short = Math.min(thirst - x.p.litres, can(x.c) / WATER_PRICE);
			if (short > 0) {
				x.p.litres += short;
				x.c.hearts = (x.c.hearts ?? 0) - short * WATER_PRICE;
				add(x.p, 'boughtL', short);
				add(x.p, 'waterSpent', short * WATER_PRICE);
				add(x.p, 'imp', short * WATER_PRICE);
				add(x.p, 'wimp', short * WATER_PRICE);
			}
			const p = x.p, eaten = Math.min(p.kg, need), used = Math.min(p.litres, thirst);
			p.kg -= eaten;
			p.litres -= used;
			add(p, 'eaten', eaten);
			add(p, 'used', used);
			// whether they went without: its treasury could not pay for all of it
			p.hungry = eaten < need * 0.999 || used < thirst * 0.999;
			// what its forests grow beyond two weeks put by goes to the world market: an export
			const extra = p.kg - keepOf(p);
			if (extra > 0 && p.pop > 0) {
				p.kg -= extra;
				x.c.hearts = (x.c.hearts ?? 0) + extra * PRICE.world;
				add(p, 'exported', extra);
				add(p, 'earned', extra * PRICE.world);
				add(p, 'exp', extra * PRICE.world);
				add(p, 'wexp', extra * PRICE.world);
			}
			// what a store holds beyond a quarter year spoils
			const most = Math.max(50, p.pop * FOOD_KG * MOST);
			if (p.kg > most) add(p, 'spoiled', p.kg - most), (p.kg = most);
		}
		// what its tanks cannot hold runs off
		for (const { v, p } of vs) p.litres = Math.min(p.litres, tankOf(v, p.pop));
		// energy, kWh: what each village makes less what it uses (its factories booked theirs as they worked, a round at a
		// time), and less what it still owes the grid from before
		/** @type {Map<any, number>} */
		const over = new Map();
		for (const { v, c, p } of vs) {
			const well = wellsDay(c) * days, sun = sunIn(v) * days, home = homeDay(p.pop) * days, climate = climateIn(v) * days, centre = centreDay(c) * days, work = p.pend?.kwhWork ?? 0;
			if (p.pend) delete p.pend.kwhWork;
			add(p, 'kwhWell', well);
			add(p, 'kwhSun', sun);
			add(p, 'kwhHome', home);
			add(p, 'kwhClimate', climate);
			add(p, 'kwhCentre', centre);
			add(p, 'kwhWork', work);
			over.set(p, well + sun - home - climate - centre - work - (p.kwhDue ?? 0));
		}
		// what one lacks, the villages joined to it give from what they have over
		for (const x of vs)
			for (const y of vs) {
				if (/** @type {number} */ (over.get(x.p)) >= 0) break;
				if (y === x || !reach(x.c.id).has(y.c.id)) continue;
				const n = Math.min(-(/** @type {number} */ (over.get(x.p))), /** @type {number} */ (over.get(y.p)));
				if (n > 0) over.set(y.p, /** @type {number} */ (over.get(y.p)) - n), over.set(x.p, /** @type {number} */ (over.get(x.p)) + n);
			}
		// the world grid buys what is left over and sells what is still lacking, while the treasury can pay; a kiln's
		// round takes more at once than a while of the wells makes, so the grid lends up to a day of what the village
		// makes, and its wells pay it back as they run
		for (const { v, c, p } of vs) {
			let n = /** @type {number} */ (over.get(p));
			const lend = Math.min(Math.max(0, -n), wellsDay(c) + sunIn(v));
			p.kwhDue = lend;
			n += lend;
			p.dark = false;
			if (n > 0) {
				const eur = n * GRID_EUR_KWH;
				c.hearts = (c.hearts ?? 0) + eur;
				add(p, 'kwhSold', n);
				add(p, 'gridEarned', eur);
				add(p, 'exp', eur);
				add(p, 'wexp', eur);
			} else if (n < 0) {
				const k = Math.min(-n, can(c) / GRID_EUR_KWH), eur = k * GRID_EUR_KWH;
				c.hearts = (c.hearts ?? 0) - eur;
				add(p, 'kwhBought', k);
				add(p, 'gridSpent', eur);
				add(p, 'imp', eur);
				add(p, 'wimp', eur);
				p.dark = k < -n * 0.999;
			}
		}
		// a week of each, lately: an average over the last month or so, weighed by how much of it the valley has seen yet
		for (const { p } of vs) {
			p.flow ??= {};
			const d = did.get(p) ?? {};
			// and what it traded meanwhile in wares
			for (const [k, n] of Object.entries(p.pend ?? {})) d[k] = (d[k] ?? 0) + n;
			p.pend = {};
			const was = (p.flowW ?? 0) * (1 - fade), w = was + fade;
			for (const k of ['grown', 'eaten', 'fromVillages', 'fromWorld', 'sold', 'exported', 'spoiled', 'spent', 'earned', 'rain', 'boughtL', 'used', 'waterSpent', 'wares', 'imp', 'exp', 'wimp', 'wexp', 'upkeep', 'interest', 'repaid', 'borrowed', 'kwhWell', 'kwhSun', 'kwhHome', 'kwhClimate', 'kwhCentre', 'kwhWork', 'kwhSold', 'kwhBought', 'gridEarned', 'gridSpent'])
				p.flow[k] = ((p.flow[k] ?? 0) * was + (((d[k] ?? 0) * WEEK) / dd) * fade) / w;
			p.flowW = w;
		}
	}
	/**
	 * Each village's loan (./market.js LOAN): what is owed grows by 1% a month, and the treasury pays its monthly
	 * payment, a share of the calendar at a time; what a treasury lacks (it went below nothing paying for something), it
	 * borrows, which adds that borrowing's own payment, fifteen years of it.
	 * @param {{ c: any, p: any }[]} vs @param {number} dd days of the valley's calendar
	 */
	function loans(vs, dd) {
		for (const { c, p } of vs) {
			const L = c.loan;
			if (L) {
				const interest = L.left * (Math.pow(1 + LOAN.rate, dd / MONTH) - 1);
				L.left += interest;
				const due = Math.min(L.left, (L.pay * dd) / MONTH);
				L.left -= due;
				c.hearts = (c.hearts ?? 0) - due;
				(p.pend ??= {}), (p.pend.interest = (p.pend.interest ?? 0) + interest), (p.pend.repaid = (p.pend.repaid ?? 0) + due);
				if (L.left < 1) c.loan = null;
			}
			// what it is behind it borrows, as far as its loan reaches; beyond that it stays behind
			const x = Math.min(-(c.hearts ?? 0), LOAN.perHead * p.pop - (c.loan?.left ?? 0));
			if (x > 0) {
				c.hearts += x;
				c.loan = { left: (c.loan?.left ?? 0) + x, pay: (c.loan?.pay ?? 0) + x * LOAN_PAY, since: c.loan?.since ?? st.cal };
				(p.pend ??= {}), (p.pend.borrowed = (p.pend.borrowed ?? 0) + x);
			}
		}
	}
	/** what a village's homes, factories and center take a week to keep standing, by their keep recipes: their upkeep
	 * in gold, and the energy its factories use to stand, in kWh (its center's comes with its hall's: centreDay; its
	 * homes' with their people's) @param {number} v */
	function upkeepIn(v) {
		let gold = 0, kwh = 0;
		for (const b of mineIn(v)) {
			if (b.type === 'house') {
				if (b.level) gold += HOUSE_KEEP[b.level - 1];
				continue;
			}
			if (b.type === 'centre') {
				if (b.stage === 'live') gold += centreStage(levelOf(b)).keep.in.gold;
				continue;
			}
			const r = RECIPES[b.type] && (b.stage === 'live' || b.level > 0) ? recipe(b.type, levelOf(b)) : null;
			if (!r) continue;
			gold += r.keep.in.gold ?? 0;
			kwh += (r.use.in.energy ?? 0) * 1000;
		}
		return { gold, kwh };
	}
	/** what a village's buildings are worth, €: what they are built of at world prices (their upkeep a week is 2% a year
	 * of it), and the gold of its geothermal plant @param {number} v */
	function worthIn(v) {
		let plant = 0;
		for (const b of mineIn(v)) if (b.type === 'centre' && b.stage === 'live') plant += CENTRE.slice(0, levelOf(b)).reduce((t, x) => t + (x.gold ?? 0), 0) * EUR_GOLD;
		return (upkeepIn(v).gold * EUR_GOLD) / (UPKEEP * WEEK_YEAR) + plant;
	}
	/** @param {number} dt seconds of play @param {number} dd days of the valley's calendar */
	function settlements(dt, dd) {
		const m = st.market;
		// each of your villages lives on what its center holds
		const vs = yourVillages();
		// every settler issues HEARTs into its village center's treasury; what a treasury holds wanes by the year (a debt
		// does not)
		const wane = Math.pow(1 - HEARTS.demurrage, dd / (HEARTS.yearHours * HEARTS.hour));
		for (const { v, c, p } of vs) {
			p.pop = villagePeople(v);
			c.hearts = ((c.hearts ?? 0) > 0 ? c.hearts * wane : c.hearts ?? 0) + (HEARTS.perHour * p.pop * dd) / HEARTS.hour;
		}
		eatAndDrink(vs, dd);
		for (const { v, c, p } of vs) {
			// its homes', factories' and center's upkeep (their keep recipes, a week's) from its treasury, in gold; the
			// energy its factories use to stand from its grid
			const k = upkeepIn(v), eur = (k.gold * EUR_GOLD * dd) / WEEK;
			c.hearts = (c.hearts ?? 0) - eur;
			(p.pend ??= {}), (p.pend.upkeep = (p.pend.upkeep ?? 0) + eur), (p.pend.kwhWork = (p.pend.kwhWork ?? 0) + (k.kwh * dd) / WEEK);
		}
		loans(vs, dd);
		// your city, as the market and the page see it: everyone counted
		const you = st.parties[PLAYER];
		you.pop = vs.reduce((s, x) => s + x.p.pop, 0);
		for (let k = 1; k < st.parties.length; k++) {
			const p = st.parties[k];
			make(p, k, dt);
		}
		// prices across the valley, remembered
		if (st.time >= m.clock.hist) {
			m.clock.hist = st.time + 20;
			for (const w of TRADED) {
				m.hist[w].push(valleyPrice(w));
				if (m.hist[w].length > 30) m.hist[w].shift();
			}
		}
		// requests
		if (st.time >= m.clock.contract) {
			m.clock.contract = st.time + 120 + rand() * 90;
			const req = request(m, st.parties, st.time, rand);
			const what = req && `${req.n} ${WARES[req.w].label.toLowerCase()}`;
			if (req) say(req.reward ? `${st.parties[req.k].name} asks for ${what}: ${req.reward} coins. See the Market.` : `${st.parties[req.k].name} has no coins left and asks for help: ${what}. See the Market.`, cityCentre(req.k)?.node ?? -1, req.reward ? 'info' : 'alert');
		}
		for (const ct of m.contracts)
			if (!ct.gone && ct.got < ct.n && ct.until <= st.time) {
				ct.gone = true;
				if (ct.taken) say(`Too late: ${st.parties[ct.k].name}’s request for ${WARES[ct.w].label.toLowerCase()} ran out`, -1, 'alert');
			}
		m.villages = villageRows().length;
	}
	/** how many people a village holds when it is full: a great dome's worth in every settlement that has room for a house */
	const capOf = (/** @type {number} */ v) =>
		HOUSE_MOST * plan.villages[v].plots.filter((k) => k !== plan.villages[v].centre && plan.spots[k][0] >= 0 && st.terrain[plan.spots[k][0]] === GRASS).length;
	/** every village of the valley: yours by name, then each neighbour city's */
	function villageRows() {
		const row = (/** @type {any} */ r) => r;
		return [
			...yourVillages().map(({ v, c, p }) => row({ name: p.name, city: 'You', pop: p.pop, beds: bedsIn(v), cap: capOf(v), hungry: !!p.hungry, full: fullVillage(v, PLAYER), node: c.node, owner: PLAYER, eur: c.hearts ?? 0 })),
			...st.parties.slice(1).flatMap((/** @type {any} */ p, /** @type {number} */ j) =>
				cityShares(j + 1).map(({ c, v, cap, pop }, x) => row({ name: x ? `${p.name} ${x + 1}` : p.name, city: p.name, pop, beds: cap, cap, hungry: !!p.hungry, full: pop >= cap && fullVillage(v, j + 1), node: c.node, owner: j + 1 }))
			)
		];
	}
	/** a ware's price across the valley: what the neighbours would pay, on average */
	const valleyPrice = (/** @type {string} */ w) => st.parties.slice(1).reduce((/** @type {number} */ s, /** @type {any} */ p) => s + priceIn(p, w), 0) / Math.max(1, st.parties.length - 1);

	// ── time ──
	function grow() {
		let changed = false;
		for (let i = 0; i < N; i++) {
			const o = st.obj[i];
			if (!o) continue;
			if (o.k === 'tree' && o.g < 1) {
				o.g = Math.min(1, o.g + 1 / 110);
				changed = true;
			} else if (o.k === 'field' && !st.buildings[o.b]) {
				st.obj[i] = null;
				changed = true;
			} else if (o.k === 'field' && o.g < 1) {
				o.g = Math.min(1, o.g + 1 / 55);
				changed = true;
			}
		}
		if (changed) st.objV++;
	}
	function step(dt = TICK) {
		st.time += dt;
		st.cal += dt * PACE;
		const c = st.clocks;
		for (const u of units()) {
			if (!st.units[u.id]) continue;
			if (u.wait > 0) {
				u.wait -= dt;
				if (u.wait > 0) continue;
				u.wait = 0;
				if (u.job === 'w-work') workerDone(u);
				else if (u.job === 'c-in') {
					const w = st.wares[u.wareId];
					u.wareId = 0;
					u.ware = '';
					if (w) deliver(w);
					const r = st.roads[u.road];
					if (r) idle(u, r);
					else goHome(u);
				}
				continue;
			}
			if (u.inside || u.job === 'b-work') continue;
			if (u.job === 'c-idle' && carrierJob(u) && u.p === u.tgt) {
				carrierArrive(u);
				continue;
			}
			if (u.job === 'c-wait') {
				carrierArrive(u);
				continue;
			}
			if (u.p !== u.tgt) {
				const dir = Math.sign(u.tgt - u.p);
				u.p += dir * u.speed * dt;
				if ((dir > 0 && u.p >= u.tgt) || (dir < 0 && u.p <= u.tgt)) {
					u.p = u.tgt;
					arrive(u);
				}
			} else if (u.job !== 'c-idle' && u.job !== 'w-in') arrive(u);
		}
		for (const b of blds()) if (st.buildings[b.id] && b.owner === PLAYER) work(b, dt);
		if (st.time >= c.dispatch) {
			c.dispatch = st.time + 0.5;
			dispatch();
		}
		if (st.time >= c.people) {
			c.people = st.time + 1;
			people();
		}
		if (st.time >= c.grow) {
			c.grow = st.time + 1;
			grow();
		}
		if (st.time >= c.pop) {
			c.pop = st.time + 6;
			// newcomers settle in a village with a bed for them while it has the food and water for them; with too few beds,
			// people leave. They come and go a family at a time, one for every 96 beds, so a large village fills as fast as
			// a small one did
			for (const { v, c: ctr, p } of yourVillages()) {
				const people = villagePeople(v), room = bedsIn(v), family = Math.max(1, Math.ceil(room / 96));
				if (people < room && !p.hungry) ctr.settlers += Math.min(family, room - people);
				else if (room > 0 && people > room && ctr.settlers > 0) {
					ctr.settlers -= Math.min(family, people - room, ctr.settlers);
					say(`A settler left ${p.name}: there are not enough beds. Build or enlarge houses.`, ctr.node, 'alert');
				}
			}
		}
		if (st.time >= c.grow2) {
			c.grow2 = st.time + 20;
			// the neighbours grow when they live well, and shrink when they don't
			for (let k = 1; k < st.parties.length; k++) {
				const p = st.parties[k];
				// a family more for each of its villages; once every village is full, it founds the next
				// and the valley grows together: a neighbour stays within a village of your people
				const cap = Math.min(cityCap(k), 6 * HOUSE_MOST + yourPeople()), n = cityVillages(k).length;
				if (!p.hungry && p.pop < cap) p.pop = Math.min(cap, p.pop + 2 * n);
				else if (!p.hungry && p.pop >= cityCap(k) && n < CITY_VILLAGES) cityFounds(k);
				else if (p.hungry && p.pop > 10 && rand() < 0.2) {
					p.pop--;
					if (rand() < 0.3) say(`${p.name} is struggling: a family left the valley`, cityCentre(k)?.node ?? -1, 'alert');
				}
			}
			neighbourTowns();
		}
		if (st.time >= c.trade) {
			c.trade = st.time + 3;
			trade();
		}
		if (st.time >= c.needs) {
			c.needs = st.time + 1;
			settlements(1, st.cal - (c.cal ?? st.cal));
			c.cal = st.cal;
		}
		if (st.fx.length && st.time - st.fx[0].t > 12) st.fx.shift();
	}
	function arrive(/** @type {any} */ u) {
		if (u.kind === 'carrier') return u.job === 'home' ? arriveHome(u) : carrierArrive(u);
		if (u.job === 'home') return arriveHome(u);
		if (u.kind === 'builder') {
			const b = st.buildings[u.bld];
			if (!b || b.stage !== 'site') return goHome(u);
			u.job = 'b-work';
			return;
		}
		if (u.kind === 'worker') return workerArrive(u);
		if (u.kind === 'cart') return cartArrive(u);
	}

	// ── what a player may do ──
	/** why no flag may stand here ('' when one may) @param {number} n */
	function canFlag(n) {
		if (n < 0) return 'Off the map';
		if (st.owner[n] !== PLAYER) return 'Outside your land';
		if (st.terrain[n] === WATER) return 'Water';
		if (plan.centre[plan.plotOf[n]] !== n) return 'Stops stand in the middle of a hex';
		if (st.obj[n]) return 'Something stands here';
		return '';
	}
	/** why this building may not stand here ('' when it may) @param {string} type @param {number} n */
	function canBuild(type, n) {
		const t = BUILDINGS[type];
		if (!t || !t.group) return 'Not something you can build';
		if (n < 0) return 'Off the map';
		const plot = plan.plotOf[n], spot = plan.spotOf[n];
		const v = villageAt(n), vo = st.villageOwner[v] ?? -1, middle = plan.villages[v].centre === plot;
		if (type === 'centre') {
			// it fills the village's middle hex: it stands round the hex's middle, which is its stop
			if (!middle || plan.spots[plot][0] !== n) return 'A village center fills the middle hex of a village';
			if (vo !== -1) return vo === PLAYER ? 'This village has its center' : 'This village is not yours';
			const mid = plan.centre[plot];
			if (st.terrain[n] !== GRASS || st.terrain[mid] !== GRASS) return 'Needs open grass';
			if (st.obj[n]?.k === 'bld' || st.road[n] || st.obj[mid]?.k === 'bld' || st.road[mid]) return 'Something stands here';
			// your first comes with your settlers, wherever there is room for three homes round it
			if (first()) return homesRound(v) >= 3 ? '' : 'Too little open land round it for homes';
			const f = founder(v);
			if (!f) return plan.villages[v].near.some((x) => st.villageOwner[x] === PLAYER) ? 'The village next to it cannot pay for its logistics hub and the trade route to it, fired clay, from what its treasury holds and may borrow' : 'Too far: found villages next to your city';
			return '';
		}
		if (middle) return 'The village center fills the middle of the village';
		if (spot < 0) return 'Buildings stand round the middle of a settlement: pick a marked spot';
		if (type === 'house' && spot !== 0) return 'A house stands on its settlement’s house spot';
		if (type !== 'house' && spot === 0) return 'This spot is for the settlement’s house';
		if (vo !== PLAYER) return first() ? 'Put up your logistics hub first, in the middle hex of a village' : 'Outside your city: found a village with a logistics hub first';
		if (!mineIn(v).some((b) => b.type === 'centre' && b.stage === 'live')) return 'This village’s center is still being founded';
		// a woodcutter, forester or iron mine only stands on a hex of its own kind
		if (t.biome && st.biome[plot] !== t.biome) return `${t.label}s stand on ${BIOMES[t.biome].label.toLowerCase()} hexes`;
		if (type !== 'house') {
			const home = buildingAt(plan.spots[plot][0]);
			if (!home || home.owner !== PLAYER || home.type !== 'house') return 'Build this settlement’s house first';
		}
		// a building clears its own ground: a tree there is felled, a rock broken, a field ploughed under
		if (st.obj[n] && !['tree', 'rock', 'field'].includes(st.obj[n].k)) return 'Something stands here';
		if (st.road[n]) return 'A road runs here';
		if (t.on === 'mountain' ? st.terrain[n] !== MOUNTAIN : t.on === 'any' ? st.terrain[n] === WATER : st.terrain[n] !== GRASS) return t.on === 'mountain' ? 'Mines stand on mountains' : t.on === 'any' ? 'Needs dry land' : 'Needs open grass';
		const c = plan.centre[plan.plotOf[n]];
		if (st.terrain[c] === WATER) return 'The middle of its settlement is water';
		const f = flagAt(c);
		if (f && f.owner !== PLAYER) return 'Not yours';
		if (st.road[c]) return 'A path runs where its stop goes';
		if (t.ore && depositAt(n) <= 0) return 'No iron ore in this rock';
		return '';
	}
	/** whether you have no village yet: your first logistics hub is still to put up */
	const first = () => !blds().some((b) => b.owner === PLAYER && b.type === 'centre');
	/** the hexes round a village's middle with room for a home */
	const homesRound = (/** @type {number} */ v) => plan.villages[v].plots.filter((x) => x !== plan.villages[v].centre && plan.spots[x][0] >= 0 && st.terrain[plan.spots[x][0]] === GRASS).length;
	/** the village center of yours that can found a village: next to it, with what its hub costs and the route */
	function founder(/** @type {number} */ v) {
		const cost = BUILDINGS.centre.cost, mid = plan.centre[plan.villages[v].centre];
		return (
			myCentres()
				.filter((c) => plan.villages[v].near.includes(villageAt(c.node)))
				.filter((c) => payable(c, { ...cost, clay: tunnelCost(c.node, mid) }))
				.sort((a, b) => g.dist(a.node, mid) - g.dist(b.node, mid))[0] ?? null
		);
	}
	/**
	 * The way for a path from a stop to the middle of a hex next to it (the hex a node lies in), or null: always straight
	 * along the grid, from the middle of one hex to the middle of the next, over dry land (a tree or a rock on the way is
	 * cleared). Above ground, paths stay within their village: villages are joined below.
	 * @param {number} from @param {number} to
	 */
	function planRoad(from, to) {
		const start = flagAt(from);
		if (!start || start.owner !== PLAYER || to < 0) return null;
		const pa = plan.plotOf[from], pb = plan.plotOf[to];
		const d = plan.nbr[pa].indexOf(pb);
		if (plan.centre[pa] !== from || d < 0) return null;
		const end = plan.centre[pb], fe = flagAt(end);
		if (fe ? fe.owner !== PLAYER : canFlag(end)) return null;
		if (villageAt(end) !== villageAt(from)) return null;
		const path = spoke(g, plan, pa, d);
		if (!path || path[path.length - 1] !== end) return null;
		for (const j of path.slice(1, -1)) if (st.owner[j] !== PLAYER || st.terrain[j] === WATER || st.road[j] || (st.obj[j] && !['tree', 'rock', 'field'].includes(st.obj[j].k))) return null;
		return path;
	}
	function buildRoad(/** @type {number} */ from, /** @type {number} */ to) {
		const path = planRoad(from, to);
		return path ? layPath(path, PLAYER) : null;
	}
	/** where a hex's paths meet: its middle (the village center's stop, in a village's middle hex) */
	const stopOf = (/** @type {number} */ plot) => plan.centre[plot];
	/** the hexes next to a hex */
	const nearPlots = (/** @type {number} */ plot) => plan.nbr[plot].filter((k) => k >= 0);
	/** join a settlement's middle to its village center: hex by hex, the fewest paths, a stop in every hex it crosses */
	function autoRoad(/** @type {number} */ flagId) {
		const f = st.flags[flagId];
		const hq = f && myCentres().find((c) => villageAt(c.node) === villageAt(f.node));
		if (!f || !hq) return null;
		const joined = route(hq.flag);
		if (joined.has(f.id)) return null;
		const v = villageAt(f.node);
		const start = plan.plotOf[f.node];
		/** @type {Map<number, number>} */
		const prev = new Map([[start, -1]]);
		const open = [start];
		let goal = -1;
		while (open.length && goal < 0) {
			const p = /** @type {number} */ (open.shift());
			for (const q of nearPlots(p)) {
				if (prev.has(q) || plan.villageOf[q] !== v) continue;
				const a = stopOf(p), b = stopOf(q);
				if (a < 0 || b < 0) continue;
				const fa = flagAt(a), fb = flagAt(b);
				// already joined by a path, or a path could run
				const linked = fa && fb && joins(fa.id, fb.id);
				if (!linked && !planBetween(a, b)) continue;
				prev.set(q, p);
				if (fb && joined.has(fb.id)) {
					goal = q;
					break;
				}
				open.push(q);
			}
		}
		if (goal < 0) return null;
		/** @type {any} */
		let last = null;
		for (let q = goal; prev.get(q) !== -1; q = /** @type {number} */ (prev.get(q))) {
			const p = /** @type {number} */ (prev.get(q));
			const a = stopOf(p), b = stopOf(q);
			if (!flagAt(a)) makeFlag(a, PLAYER);
			const fa = flagAt(a), fb = flagAt(b);
			if (fa && fb && joins(fa.id, fb.id)) continue;
			last = buildRoad(a, b) ?? last;
		}
		return last;
	}
	/** the way for a path between two stops, as planRoad finds it, whether or not either has its stop yet */
	function planBetween(/** @type {number} */ a, /** @type {number} */ b) {
		if (flagAt(a)) return planRoad(a, b);
		if (st.obj[a] || st.road[a]) return null;
		st.obj[a] = { k: 'flag', id: -1 };
		st.flags[-1] = { id: -1, node: a, owner: PLAYER, wares: [], bld: 0 };
		const p = planRoad(a, b);
		delete st.flags[-1];
		st.obj[a] = null;
		return p;
	}

	/** a building's energy, kWh a week (see inspect) @param {any} b */
	function power(b) {
		if (b.stage !== 'live' && !(b.level > 0)) return null;
		if (b.type === 'centre') return { made: wellsDay(b) * 7, used: centreDay(b) * 7, next: null };
		if (b.type === 'house' && b.level) {
			const beds = HOUSE_BEDS[b.level - 1];
			return { made: beds * sunBedDay(calendar(st.cal).month) * 7, used: homeDay(beds) * 7 + ((beds * ENERGY.climateBed) / YEAR) * 7, next: null };
		}
		if (!RECIPES[b.type]) return null;
		const k = levelOf(b), use = (/** @type {number} */ l) => ((weekOf(b.type, l).in.energy ?? 0) + (recipe(b.type, l)?.use.in.energy ?? 0)) * 1000;
		return { made: 0, used: use(k), next: k < RECIPES[b.type].stages.length ? use(k + 1) : null };
	}

	return {
		state: st,
		grid: g,
		plan,
		/** every building, as a list kept until one comes or goes: read it, don't change it */
		buildingList: blds,
		step,
		/** a new valley: nothing stands in it; you put up your first logistics hub where you like (the valley was grown
		 * with a good village for it, `home`, where the camera starts) */
		setup(/** @type {import('./map.js').Valley} */ v) {
			st.hq = 0;
			st.home = v.hq;
			st.villages = [];
			territory();
			neighbourTowns();
		},
		/** where your first village is, or would be: its center's node */
		homeNode: () => st.buildings[st.hq]?.node ?? st.home ?? 0,
		canBuild,
		canFlag,
		planRoad,
		/** the spot a building would take when the hex round a node is clicked: its house spot (a village center's, in a
		 * village's middle hex), or the factory spot nearest the node that it may stand on */
		spotFor(/** @type {string} */ type, /** @type {number} */ n) {
			if (n < 0) return -1;
			const [house, ...factories] = plan.spots[plan.plotOf[n]];
			if (type === 'centre' || type === 'house') return house;
			if (factories.includes(n)) return n;
			const ok = factories.filter((j) => j >= 0 && !canBuild(type, j));
			return (ok.length ? ok : factories.filter((j) => j >= 0)).sort((a, b) => g.dist(n, a) - g.dist(n, b))[0] ?? -1;
		},
		/** place a building (its flag comes with it); with `connect`, a road to the network too */
		build(/** @type {string} */ type, /** @type {number} */ n, connect = true) {
			const why = canBuild(type, n);
			if (why) return { ok: false, why };
			// a village center stands on the middle of its hex: what grew there is cleared
			if (type === 'centre')
				clearAround(plan.centre[plan.plotOf[n]], 2);
			// your first logistics hub: your settlers put it up as they come, with what they bring
			if (type === 'centre' && first()) {
				const hq = makeBuilding('centre', n, PLAYER, true);
				hq.stock = { ...START.stock };
				hq.settlers = START.settlers;
				hq.since = 0;
				st.hq = hq.id;
				territory();
				say('Your settlers put up their logistics hub. Build your first hut on a hex round it', n, 'good');
				return { ok: true, id: hq.id, linked: true };
			}
			const b = makeBuilding(type, n, PLAYER);
			b.since = st.time;
			if (type === 'centre') {
				// founded from the village center next to it: its hub, a trade route and four settlers go by cart
				const from = /** @type {any} */ (founder(villageAt(n)));
				payAll(from, b.cost);
				const t = dig(from, b);
				territory();
				const settlers = Math.min(4, from.settlers);
				from.settlers -= settlers;
				sendCart(from, b, {}, { kind: 'found', settlers }, t?.path ?? null);
				b.status = 'Being founded: a cart is on its way';
				return { ok: true, id: b.id, linked: true };
			}
			const home = myCentres().find((c) => villageAt(c.node) === villageAt(n));
			const linked = connect ? autoRoad(b.flag) : null;
			return { ok: true, id: b.id, linked: !!linked || (!!home && route(home.flag).has(b.flag)) };
		},
		flag(/** @type {number} */ n) {
			const why = canFlag(n);
			if (why) return { ok: false, why };
			return { ok: true, id: makeFlag(n, PLAYER).id };
		},
		road(/** @type {number} */ from, /** @type {number} */ to) {
			const r = buildRoad(from, to);
			return r ? { ok: true, id: r.id } : { ok: false, why: 'No way for a road there' };
		},
		autoRoad(/** @type {number} */ flagId) {
			return !!autoRoad(flagId);
		},
		/** tear down what stands at a node: a building, a flag (with its roads), or a road */
		demolish(/** @type {number} */ n) {
			const b = buildingAt(n);
			if (b) {
				if (b.owner !== PLAYER || b.type === 'centre') return { ok: false, why: b.type === 'centre' ? 'A village center stays' : 'Not yours' };
				removeBuilding(b);
				return { ok: true };
			}
			const f = flagAt(n);
			if (f) {
				if (f.owner !== PLAYER || blds().some((x) => x.flag === f.id && x.type === 'centre')) return { ok: false, why: 'This flag stays' };
				removeFlag(f);
				return { ok: true };
			}
			if (st.road[n] && st.roads[st.road[n]]?.owner === PLAYER) {
				removeRoad(st.roads[st.road[n]]);
				return { ok: true };
			}
			return { ok: false, why: 'Nothing to tear down here' };
		},
		/** enlarge a house to its next size, or upgrade your wood or steel: builders bring what it costs, and it goes on
		 * meanwhile */
		upgrade(/** @type {number} */ id) {
			const b = st.buildings[id];
			if (!b || b.owner !== PLAYER || (b.type !== 'house' && !GROWS[b.type])) return { ok: false, why: 'Only your houses and your factories grow' };
			if (b.stage !== 'live') return { ok: false, why: 'It is being built' };
			const grows = GROWS[b.type];
			b.level = levelOf(b);
			if (b.level >= (grows ? grows.levels.length : HOUSE_TOP)) return { ok: false, why: grows ? `It is a ${grows.levels[b.level - 1].label.toLowerCase()} already` : 'It is as large as a house gets' };
			b.cost = { ...(grows ? grows.up : HOUSE_UP)[b.level - 1] };
			for (const w of Object.keys(b.cost)) (b.used[w] = 0), (b.got[w] = 0), (b.inc[w] = 0);
			b.stage = 'site';
			b.status = 'Waiting for a builder';
			st.objV++;
			return { ok: true };
		},
		/** buy wares from the world market for the village a node lies in: its treasury pays, never into debt, and they
		 * are in its storehouse at once */
		buy(/** @type {number} */ node, /** @type {string} */ w, n = 1) {
			const c = myCentres().find((x) => villageAt(x.node) === villageAt(node));
			if (!c) return { ok: false, why: 'Only your villages buy' };
			if (!WORLD[w]) return { ok: false, why: 'The world market does not sell that' };
			const k = worldBuy(c, w, n);
			return k ? { ok: true, n: k } : { ok: false, why: `Its treasury cannot pay ${(WORLD[w].eur / HEARTS.perGold).toLocaleString('en-US')} gold, even borrowing` };
		},
		/** sell wares to the world market from the village a node lies in: an export, into its treasury */
		sell(/** @type {number} */ node, /** @type {string} */ w, n = 1) {
			const c = myCentres().find((x) => villageAt(x.node) === villageAt(node));
			if (!c) return { ok: false, why: 'Only your villages sell' };
			const k = worldSell(c, w, n);
			return k ? { ok: true, n: k } : { ok: false, why: `Its storehouse holds no ${WARES[w]?.label.toLowerCase() ?? w}` };
		},
		/** buy a ware when short, sell (export) its surplus, both, or (null) neither */
		order(/** @type {string} */ w, /** @type {'sell' | 'buy' | 'both' | null} */ o) {
			if (!TRADED.includes(w)) return;
			if (o) st.orders[w] = o;
			else delete st.orders[w];
		},
		/** take (or let go of) a neighbour's request: a cart brings it along the trade routes */
		take(/** @type {number} */ id, on = true) {
			const c = st.market.contracts.find((/** @type {any} */ x) => x.id === id);
			if (c && c.got < c.n && c.until > st.time) c.taken = on;
		},
		/** trade as the Market shows it */
		market() {
			const m = st.market, mine = myCentres();
			const joined = (/** @type {number} */ k) => !!cityCentre(k) && mine.some((c) => reach(c.id).has(cityCentre(k).id));
			const reachable = st.parties.map((/** @type {any} */ _, /** @type {number} */ k) => k > 0 && joined(k));
			return {
				purse: purse(),
				cities: st.parties.slice(1).map((/** @type {any} */ p, /** @type {number} */ j) => ({ k: j + 1, name: p.name, joined: reachable[j + 1], coins: p.coins, node: cityCentre(j + 1)?.node ?? -1 })),
				wares: TRADED.map((w) => {
					const at = st.parties.map((/** @type {any} */ p, /** @type {number} */ k) => (reachable[k] ? priceIn(p, w) : 0)).filter((/** @type {number} */ x) => x > 0);
					const h = m.hist[w], now = valleyPrice(w), was = h[Math.max(0, h.length - 7)] ?? now;
					return { w, price: at.length ? at.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0) / at.length : null, trend: now > was * 1.06 ? 1 : now < was * 0.94 ? -1 : 0, stock: stocked(w), order: st.orders[w] ?? null };
				}),
				contracts: m.contracts.filter((/** @type {any} */ c) => c.got < c.n && c.until > st.time).map((/** @type {any} */ c) => ({ ...c, who: st.parties[c.k].name, left: c.until - st.time, joined: reachable[c.k] })),
				parties: villageRows(),
				sold: m.sold,
				bought: m.bought
			};
		},
		/** the village centers one can join by a trade route, and whether it is joined already */
		links(/** @type {number} */ id) {
			const b = st.buildings[id];
			if (!b || b.type !== 'centre' || b.owner !== PLAYER) return [];
			const r = reach(b.id);
			return centres()
				.filter((c) => c.id !== b.id)
				.map((c) => ({
					id: c.id,
					name: c.owner === PLAYER ? st.vill[villageAt(c.node)]?.name ?? 'Your village' : st.parties[c.owner].name,
					mine: c.owner === PLAYER,
					joined: r.has(c.id),
					cost: tunnelCost(b.node, c.node),
					/** what the world market asks for the blocks your stores lack, € */
					eur: lacking(b, { clay: tunnelCost(b.node, c.node) }),
					node: c.node
				}))
				.sort((x, y) => Number(x.joined) - Number(y.joined) || g.dist(b.node, x.node) - g.dist(b.node, y.node));
		},
		/** dig a trade route from a village center of yours to another, paid in fired clay by yours (what its stores
		 * lack, bought from the world market) */
		connect(/** @type {number} */ from, /** @type {number} */ to) {
			const a = st.buildings[from], b = st.buildings[to];
			if (!a || !b || a.type !== 'centre' || a.owner !== PLAYER || b.stage !== 'live') return { ok: false, why: 'Not a village center' };
			if (reach(a.id).has(b.id)) return { ok: false, why: 'Already joined' };
			const cost = tunnelCost(a.node, b.node);
			if (!payable(a, { clay: cost })) return { ok: false, why: `The route takes ${(cost * LOAD_T).toLocaleString('en-US')} t of fired clay: what your stores lack costs ${Math.round(lacking(a, { clay: cost }) / HEARTS.perGold).toLocaleString('en-US')} gold from the world market` };
			dig(a, b);
			say(`A trade route now runs to ${b.owner === PLAYER ? st.vill[villageAt(b.node)]?.name ?? 'your village' : st.parties[b.owner].name}`, b.node, 'good');
			return { ok: true };
		},
		/** grow a village center of yours to its next stage (./rules.js CENTRE): a logistics hub into the great village
		 * center with its geothermal plant (not upgraded after). Its wares come from the stores joined to it (what they
		 * lack, bought from the world market), its plant's gold from their treasuries (what they
		 * lack, borrowed), and it grows at once */
		grow(/** @type {number} */ id) {
			const c = st.buildings[id];
			if (!c || c.type !== 'centre' || c.owner !== PLAYER || c.stage !== 'live') return { ok: false, why: 'Only your village centers grow here' };
			const next = CENTRE[levelOf(c)];
			if (!next) return { ok: false, why: `It is at its last stage, ${CENTRE.length} of ${CENTRE.length}` };
			const eur = next.gold * HEARTS.perGold;
			if (!payable(c, next.up, eur)) return { ok: false, why: `Growing takes ${(lacking(c, next.up) / HEARTS.perGold + next.gold).toLocaleString('en-US', { maximumFractionDigits: 0 })} gold: more than its treasury holds and may borrow, 125 gold a villager` };
			payAll(c, next.up, eur);
			const p = st.vill[villageAt(c.node)];
			if (p) (p.pend ??= {}), (p.pend.kwhWork = (p.pend.kwhWork ?? 0) + next.build.in.energy * 1000);
			c.level = levelOf(c) + 1;
			st.objV++;
			const name = p?.name ?? 'Your village';
			say(`${name} has its village center, and its geothermal plant: ${(ENERGY.wellKw / 1000).toLocaleString('en-US')} MW`, c.node, 'good');
			return { ok: true };
		},
		/** what stands at a node */
		at(/** @type {number} */ n) {
			if (n < 0) return null;
			const o = st.obj[n];
			if (o?.k === 'bld') return { k: 'building', id: o.id };
			if (o?.k === 'flag') return { k: 'flag', id: o.id };
			if (st.road[n]) return { k: 'road', id: st.road[n] };
			if (o) return { k: o.k };
			return null;
		},
		/** what the page shows: the stock, the people, the news */
		summary() {
			/** @type {Record<string, number>} */
			const stock = {};
			let settlers = 0;
			for (const wh of warehouses()) {
				for (const [w, n] of Object.entries(wh.stock)) stock[w] = (stock[w] ?? 0) + /** @type {number} */ (n);
				settlers += wh.settlers;
			}
			stock.coin = Math.round(purse() * 10) / 10;
			let carriers = 0, workers = 0;
			for (const u of units()) if (u.owner === PLAYER && u.kind !== 'cart') u.kind === 'carrier' ? carriers++ : workers++;
			const m = st.market;
			return {
				time: st.time,
				stock,
				settlers,
				people: yourPeople(),
				beds: beds(),
				villages: st.villageOwner.filter((/** @type {number} */ o) => o === PLAYER).length,
				carriers,
				workers,
				parties: st.parties.map((/** @type {any} */ p) => ({ name: p.name })),
				/** the valley's date and hour of day, its years counted from the one it was started in */
				date: ((c) => ({ ...c, year: st.year0 + c.year - 1 }))(clockOf(st.cal)),
				/** your cashflow, € a week lately: what all your villages took in by exports (exp) to the world market and
				 * paid out for imports (imp) from it; what they trade among themselves cancels out */
				cash: yourVillages().reduce((t, { p }) => ({ exp: t.exp + (p.flow?.wexp ?? 0), imp: t.imp + (p.flow?.wimp ?? 0), upkeep: t.upkeep + (p.flow?.upkeep ?? 0) }), { exp: 0, imp: 0, upkeep: 0 }),
				/** all your villages' food, a week: grown, eaten, and gold spent and earned on it */
				food: yourVillages().reduce((t, { p }) => ({ grown: t.grown + (p.flow?.grown ?? 0), need: t.need + p.pop * FOOD_KG, spent: t.spent + (p.flow?.spent ?? 0), earned: t.earned + (p.flow?.earned ?? 0) }), { grown: 0, need: 0, spent: 0, earned: 0 }),
				msgs: st.msgs.slice(-6)
			};
		},
		/**
		 * Your books, all your villages together, as in the Cashflow game (Samuel, 2026-10-07): what they took in and paid
		 * out a week lately, € (your cashflow is the world market's exports less its imports and your upkeep; the HEARTs
		 * your settlers issue, your loans and demurrage come besides), and their balance sheet now: what they own (their
		 * treasuries, the wares in their stores and their buildings, at world prices) and what they owe.
		 */
		books() {
			const vs = yourVillages();
			const sum = (/** @type {string} */ k) => vs.reduce((t, { p }) => t + (p.flow?.[k] ?? 0), 0);
			const pop = vs.reduce((t, { p }) => t + p.pop, 0);
			const exp = sum('wexp'), imp = sum('wimp'), upkeep = sum('upkeep');
			const food = sum('exported') * PRICE.world, energy = sum('gridEarned');
			const treasury = vs.reduce((t, { c }) => t + (c.hearts ?? 0), 0);
			const left = vs.reduce((t, { c }) => t + (c.loan?.left ?? 0), 0), pay = vs.reduce((t, { c }) => t + (c.loan?.pay ?? 0), 0);
			return {
				exports: { food, energy, wares: Math.max(0, exp - food - energy) },
				imports: { food: sum('fromWorld') * PRICE.world, water: sum('waterSpent'), energy: sum('gridSpent'), wares: sum('wares') },
				upkeep,
				cashflow: exp - imp - upkeep,
				/** what your settlers issue a week, in HEARTs (€) */
				hearts: HEARTS.perHour * 24 * WEEK * pop,
				interest: sum('interest'),
				repaid: sum('repaid'),
				borrowed: sum('borrowed'),
				/** what a week's demurrage takes from what the treasuries hold */
				demurrage: Math.max(0, treasury) * (1 - Math.pow(1 - HEARTS.demurrage, WEEK / YEAR)),
				treasury,
				stores: vs.reduce((t, { c }) => t + Object.entries(c.stock ?? {}).reduce((u, [w, n]) => u + /** @type {number} */ (n) * (WORLD[w]?.eur ?? 0), 0), 0),
				buildings: vs.reduce((t, { v }) => t + worthIn(v), 0),
				/** your loans together: what is owed, what they pay a month, the months left, and the most you may owe */
				loan: { left, pay, months: loanMonths(left, pay), most: LOAN.perHead * pop },
				people: pop,
				beds: beds()
			};
		},
		/**
		 * One of your villages as the panel shows it (the one a node lies in, else your first): its people, what its
		 * storehouse holds, and per ware how well that need is met and what makes it; then what else it lacks.
		 * @param {number} node
		 */
		village(node) {
			const all = yourVillages();
			const here = node >= 0 ? villageAt(node) : -1;
			const it = all.find((x) => x.v === here) ?? all[0];
			if (!it) return null;
			const { v, c, p } = it;
			const pop = villagePeople(v), bed = bedsIn(v), cap = capOf(v), lived = pop > 0;
			const f = p.flow ?? {}, hungry = lived && !!p.hungry;
			// what it buys of water now, a week: what its rain leaves short, while its tanks are dry
			const dry = runsDry(v, p, 1) ? Math.max(0, (pop * FRESH_L - rainIn(v)) * 7) : 0;
			const has = (/** @type {string} */ w) => c.stock[w] ?? 0;
			/** per resource, what its store has against what it wants: a few loads of wood and steel, its sites and its factories */
			const row = (/** @type {string} */ key, /** @type {string} */ label, /** @type {string[]} */ wares, /** @type {boolean} */ short) => ({
				key,
				label,
				have: Math.floor(wares.reduce((t, w) => t + has(w), 0)),
				need: Math.ceil(wares.reduce((t, w) => t + wantAt(c, w), 0)),
				short
			});
			const rows = [
				row('plank', 'Planks', ['plank'], false),
				row('steel', 'Steel', ['steel'], false),
				row('clay', 'Fired clay', ['clay'], false),
				row('glass', 'Glass', ['glass'], false)
			].filter((r) => r.need > 0 || r.have > 0);
			/** @type {{ tone: string, text: string, node: number }[]} */
			const notes = [];
			if (pop >= bed && bed < cap) notes.push({ tone: 'todo', text: bed ? `No free bed: enlarge a house or build one` : `No home yet: build your first hut on a hex round its hub`, node: c.node });
			if (hungry) notes.push({ tone: 'alert', text: `Its treasury cannot pay for all its food and water: no newcomers until it can`, node: c.node });
			if (p.dark) notes.push({ tone: 'alert', text: `Its treasury cannot pay the world grid for all the power it lacks`, node: c.node });
			const cut = blds().find((b) => b.owner === PLAYER && b.stage === 'site' && villageAt(b.node) === v && b.status === 'Not connected by road');
			if (cut) notes.push({ tone: 'alert', text: `A ${T(cut).label.toLowerCase()} site has no path`, node: cut.node });
			return {
				name: p.name,
				node: c.node,
				pop,
				beds: bed,
				cap,
				/** its treasury, in gold, and in HEARTs (€ of real prices, a thousandth of a gold) */
				gold: (c.hearts ?? 0) / HEARTS.perGold,
				eur: c.hearts ?? 0,
				/** its loan, €: what it still owes, what it pays a month (interest and repayment), the months left; and lately,
				 * a week, the interest, what it paid back and what it borrowed */
				loan: c.loan ? { left: c.loan.left, pay: c.loan.pay, months: loanMonths(c.loan.left, c.loan.pay) } : null,
				/** the most it may owe, €: 125 gold a villager */
				loanMost: LOAN.perHead * pop,
				/** what keeping its homes, factories and center up took a week, lately, € */
				upkeep: f.upkeep ?? 0,
				interest: f.interest ?? 0,
				repaid: f.repaid ?? 0,
				borrowed: f.borrowed ?? 0,
				/** what its settlers issue a week, in HEARTs (€) */
				income: HEARTS.perHour * 24 * 7 * pop,
				/** what the world market trades with it, your order for each ware, and what it spent there on wares a week, € */
				world: TRADED.map((w) => ({ w, eur: WORLD[w].eur, unit: WORLD[w].unit, have: Math.floor(has(w)), order: st.orders[w] ?? null })),
				wares: f.wares ?? 0,
				/** its cashflow, € a week lately: what it took in by exports to the world and sales to your other villages,
				 * and what it paid out for imports from them */
				cash: { exp: f.exp ?? 0, imp: f.imp ?? 0, upkeep: f.upkeep ?? 0 },
				/** its food, kg: in store, and as it stands now a week what its people eat, its forests grow and it buys
				 * (and what that costs, at what it paid lately a kg); lately a week, what it sold to your others and earned;
				 * its forests' share of what they eat, and the oldest forest's year */
				food: {
					kg: p.kg ?? 0,
					week: pop * FOOD_KG,
					keep: pop * FOOD_KG * KEEP,
					grown: pop * FOOD_KG * forestOf(v),
					buy: Math.max(0, pop * FOOD_KG * (1 - forestOf(v))),
					exported: Math.max(0, pop * FOOD_KG * (forestOf(v) - 1)),
					perKg: (f.fromVillages ?? 0) + (f.fromWorld ?? 0) > 1 ? (f.spent ?? 0) / ((f.fromVillages ?? 0) + (f.fromWorld ?? 0)) : PRICE.world,
					sold: f.sold ?? 0,
					earned: f.earned ?? 0,
					share: forestOf(v),
					year: Math.floor(Math.max(0, ...mineIn(v).filter((b) => b.type === 'house' && st.forest[plan.plotOf[b.node]] !== undefined).map((b) => st.cal - st.forest[plan.plotOf[b.node]])) / YEAR) + 1,
					short: hungry
				},
				/** its water, litres: in its tanks and what they hold; as it stands now a week the fresh water its people
				 * use, the greywater its crops take again, what its roofs catch this month and what it buys while its
				 * tanks are dry (and the € it pays) */
				water: {
					litres: p.litres ?? 0,
					tank: tankOf(v, pop),
					week: pop * FRESH_L * 7,
					grey: pop * WATER_USE.crops * 7,
					rain: rainIn(v) * 7,
					month: calendar(st.cal).month,
					bought: dry,
					spent: dry * WATER_PRICE,
					short: hungry
				},
				/** its energy, kWh a week: what its center's geothermal plant makes and its domes' solar cells this month, what
				 * its people use at home and its domes' climate, as it stands now; what its factories used, what went to the
				 * world grid and came from it, and the €, lately; and its center's stage and the next */
				power: {
					plant: plantOf(c),
					well: wellsDay(c) * 7,
					sun: sunIn(v) * 7,
					home: homeDay(pop) * 7,
					climate: climateIn(v) * 7,
					centre: centreDay(c) * 7,
					work: f.kwhWork ?? 0,
					sold: f.kwhSold ?? 0,
					bought: f.kwhBought ?? 0,
					earned: f.gridEarned ?? 0,
					spent: f.gridSpent ?? 0,
					month: calendar(st.cal).month,
					/** its center's stage and the stage it grows to next, or null at its last */
					stage: levelOf(c),
					next: CENTRE[levelOf(c)] ?? null,
					short: !!p.dark
				},
				villages: all.map((x) => ({ name: x.p.name, node: x.c.node })),
				rows,
				notes
			};
		},
		/** a building as its card shows it */
		inspect(/** @type {number} */ id) {
			const b = st.buildings[id];
			if (!b) return null;
			const t = T(b);
			const worker = st.units[b.worker];
			return {
				id: b.id,
				type: b.type,
				label: b.type === 'centre' ? centreStage(levelOf(b)).label : GROWS[b.type] && (b.level || b.stage === 'live') ? GROWS[b.type].levels[levelOf(b) - 1].label : t.label,
				about: b.type === 'village' ? NEIGHBOURS[b.owner - 1].about : t.about,
				name: b.type === 'village' ? st.parties[b.owner].name : b.type === 'centre' ? st.vill[villageAt(b.node)]?.name ?? '' : '',
				owner: b.owner,
				node: b.node,
				stage: b.stage,
				status: b.stage === 'site' ? b.status : b.status || (worker?.job === 'w-in' || worker?.inside === false ? 'Working' : ''),
				progress: b.stage === 'site' ? Object.keys(b.cost).reduce((s, w) => s + b.used[w], 0) / Math.max(1, Object.values(b.cost).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n, 0)) : 1,
				cost: Object.keys(b.cost).map((w) => ({ ware: w, need: b.cost[w], have: b.used[w] + b.got[w], coming: b.inc[w] })),
				inputs: (t.inputs ?? []).map((/** @type {string[]} */ types, /** @type {number} */ k) => ({ types, have: b.slots[k].have, coming: b.slots[k].inc, cap: SLOT_CAP })),
				out: t.out ?? '',
				worker: t.worker ?? '',
				hasWorker: !!worker && worker.job !== 'w-go',
				eff: Math.round(b.eff * 100),
				deposit: b.deposit,
				kind: t.kind,
				stock: isWarehouse(b) ? { ...b.stock } : null,
				settlers: b.settlers,
				party: b.type === 'village' ? { ...st.parties[b.owner], stock: { ...st.parties[b.owner].stock } } : b.type === 'centre' && st.vill[villageAt(b.node)] ? { ...st.vill[villageAt(b.node)], beds: bedsIn(villageAt(b.node)) } : null,
				level: GROWS[b.type] && b.stage === 'live' ? levelOf(b) : b.level,
				beds: b.type === 'house' && b.level ? HOUSE_BEDS[b.level - 1] : 0,
				upgrading: (b.type === 'house' || !!GROWS[b.type]) && b.stage === 'site' && b.level > 0,
				up: b.type === 'house' && b.level >= 1 && b.level < HOUSE_TOP ? HOUSE_UP[b.level - 1] : GROWS[b.type] && b.stage === 'live' && levelOf(b) < GROWS[b.type].levels.length ? GROWS[b.type].up[levelOf(b) - 1] : null,
				/** a factory's recipe at its stage, and at the next (./rules.js RECIPES) */
				recipe: RECIPES[b.type] ? recipe(b.type, levelOf(b)) : null,
				next: RECIPES[b.type] ? recipe(b.type, levelOf(b) + 1) ?? null : null,
				/** what it makes a week at its stage and at the next, working all its land gives it */
				week: RECIPES[b.type] ? weekOf(b.type, levelOf(b)) : null,
				nextWeek: RECIPES[b.type] && recipe(b.type, levelOf(b) + 1) ? weekOf(b.type, levelOf(b) + 1) : null,
				stages: RECIPES[b.type]?.stages.length ?? 0,
				rounds: RECIPES[b.type]?.rounds ?? 0,
				/** its energy, kWh a week: what a village center's wells make, a house's solar glass this month and what its
				 * beds use when full, what a factory uses working all its land gives it, and at its next stage */
				power: power(b),
				/** what it made a week, lately (its ware's units) */
				lately: b.span ? (b.lately ?? 0) / b.span : 0,
				village: villageAt(b.node)
			};
		},
		toJSON: () => JSON.stringify(st)
	};
}
