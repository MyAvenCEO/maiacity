/**
 * SANDBOX 6 · THE SIMULATION — the whole game as plain data and the rules that move it on, without a pixel: the page
 * draws it (./view.js), and a script can play it headless (./autoplay.js).
 *
 * The state is one JSON object (save it, load it, it goes on where it was). Every 0.1 s of game time:
 *   · carriers walk their roads: each road has one, who takes a ware from the flag at one end to the flag at the
 *     other; at its last flag the ware goes into the building that asked for it;
 *   · every half second the economy matches wares to who needs them: a site its planks and stone, a workshop its
 *     inputs; a ware nobody needs goes to its village center; what a village center holds is sent out to whoever in
 *     its village asks, nearest first; a ware finds its way flag by flag along the shortest roads;
 *   · every second the people follow: a settler from a village center becomes the carrier of a new road, the builder
 *     of a site, the worker of a finished building (a worker takes tools along);
 *   · buildings work: workshops turn inputs into wares, gatherers go out into the land (trees, rocks, fish, fields);
 *   · carts run the trade routes under the ground between village centers: your villages share what they have, and
 *     the cities trade by the orders you set and by what the neighbours have spare and lack (./market.js);
 *   · every village eats, drinks and keeps its homes, and the valley's abundance follows how well they all live.
 */
import { ABUNDANT, BIOMES, BUILDINGS, FOOD, GRASS, HOLD, HOUSE_BEDS, HOUSE_UP, IRON, MOUNTAIN, START, WARES, WATER, holdsLand } from './rules.js';
import { CART, HEARTS, NEEDS, NEIGHBOURS, TRADED, heartsFor, abundance, keepOf, live, make, newMarket, orderRule, party, priceIn, request, shortIn, spareIn } from './market.js';
import { SE, STEP, findPath, makeGrid } from './hex.js';
import { makePlan, spoke } from './plots.js';
import { growValley } from './map.js';

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
/** a neighbour city's people when its village is full: six houses of sixteen */
/** the villages a city needs before the valley can win, and the most a neighbour founds */
const CITY_VILLAGES = 5;
/** a building rests while the storehouses hold this much of what it makes */
const ENOUGH = 40;

/**
 * A new game in a valley grown from a seed.
 * @param {number} [seed]
 */
export function newGame(seed = 7) {
	const v = growValley(seed);
	const N = v.W * v.H;
	const st = {
		v: 9,
		seed,
		time: 0,
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
		/** @type {Record<string, any>} */ flags: {},
		/** @type {Record<string, any>} */ roads: {},
		/** @type {Record<string, any>} */ buildings: {},
		/** @type {Record<string, any>} */ units: {},
		/** @type {Record<string, any>} */ wares: {},
		nextId: 1,
		/** @type {Record<string, number>} */ made: {},
		/** @type {{ t: number, text: string, node: number, tone: string, n: number }[]} */ msgs: [],
		msgSeq: 0,
		/** @type {null | 'won'} */ result: null,
		/** what changed, for whoever draws it */
		netV: 1,
		objV: 1,
		terV: 1,
		/** when the slower rules next run */
		clocks: { dispatch: 0, people: 0, grow: 0, fish: 20, pop: 18, needs: 0, trade: 5, grow2: 60 },
		hq: 0,
		/** the neighbours' village centers (building ids) */
		/** @type {number[]} */ villages: [],
		...newMarket(),
		/** your orders: sell or buy, by ware @type {Record<string, 'sell' | 'buy'>} */
		orders: {},
		/** buildings burning, for a while */
		/** @type {{ node: number, t: number }[]} */ fx: [],
		/** whether the valley was won once (you may keep building after) */
		won: false
	};
	const sim = createSim(st);
	sim.setup(v);
	return sim;
}

/** A game from its saved state. @param {string | object} saved */
export function loadGame(saved) {
	const st = typeof saved === 'string' ? JSON.parse(saved) : saved;
	if (!st || st.v !== 9 || !Array.isArray(st.terrain)) throw new Error('Not a Sandbox 6 game of this kind');
	return createSim(st);
}

/** @typedef {ReturnType<typeof createSim>} Sim */

/** the settlement plan of a valley's size, made once (it is only read) @type {Map<string, ReturnType<typeof makePlan>>} */
const plans = new Map();

/** @param {any} st */
export function createSim(st) {
	const g = makeGrid(st.W, st.H);
	const N = g.N;
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
			else if (u.owner === PLAYER) folk.set(u.vil, (folk.get(u.vil) ?? 0) + 1);
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
			timer: 0, out: 0, paused: false, status: live ? '' : 'Waiting for a builder', eff: 0,
			stock: /** @type {Record<string, number>} */ ({}), settlers: 0, deposit: 0, fields: 0, level: 0,
			/** a village center's: what is on its way to it along the trade routes */
			coming: /** @type {Record<string, number>} */ ({}),
			/** a village center's treasury, in HEARTs (its settlers issue them) */
			hearts: 0
		};
		for (const w of Object.keys(b.cost)) (b.used[w] = 0), (b.got[w] = 0), (b.inc[w] = 0);
		if (t.kind === 'mine') b.deposit = depositAt(node);
		flag.bld ||= b.id;
		st.obj[node] = { k: 'bld', id: b.id };
		st.buildings[b.id] = b;
		bldList = null;
		st.objV++;
		return b;
	}
	/** how much ore a mine at a node can dig: what the rock round it holds */
	function depositAt(/** @type {number} */ node) {
		let n = 0;
		for (const j of g.within(node, 3)) if (st.terrain[j] === MOUNTAIN && st.ore[j] === IRON) n += st.amount[j];
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
	/** a unit with nothing left to do walks to the nearest storehouse (a neighbour's to its village) */
	function goHome(/** @type {any} */ u) {
		const here = nodeOf(u);
		const mine = warehouses().filter((b) => villageAt(b.node) === u.vil);
		const homes = u.owner === PLAYER ? (mine.length ? mine : warehouses()) : blds().filter((b) => b.type === 'village' && b.owner === u.owner);
		homes.sort((a, b) => g.dist(here, a.node) - g.dist(here, b.node));
		for (const h of homes.slice(0, 3)) {
			const path = findPath(g, here, h.node, walkable);
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
			h.settlers++;
			if (u.ware && isWarehouse(h)) h.stock[u.ware] = (h.stock[u.ware] ?? 0) + 1;
			// a worker sent home brings its tools back
			if (u.tool && isWarehouse(h)) h.stock.tools = (h.stock.tools ?? 0) + 1;
		}
		removeUnit(u);
	}

	/** a city of under eight people: one builder at a time, carrying what it builds with */
	let smallAt = -1, smallWas = false;
	const small = () => (smallAt === st.time ? smallWas : ((smallAt = st.time), (smallWas = yourPeople() < 8)));
	/** whether a site has what it is built of: at the site, or (a small city's builder brings it) in a store */
	function ready(/** @type {any} */ b, /** @type {boolean} */ few) {
		const left = /** @type {[string, number][]} */ (Object.keys(b.cost).map((w) => [w, b.cost[w] - (b.got[w] ?? 0) - (b.used[w] ?? 0)]));
		if (left.every(([, n]) => n <= 0)) return true;
		const wh = few && nearestWarehouse(b.flag, () => true);
		return !!wh && left.every(([w, n]) => (wh.stock[w] ?? 0) >= n);
	}
	/** settlers become builders, carriers and workers, in that order: with few people, building comes first */
	function people() {
		// while the city is small, one builder at a time, so someone is left to carry
		let builders = units().filter((u) => u.owner === PLAYER && u.kind === 'builder').length;
		const few = small();
		for (const b of blds()) {
			if (b.owner !== PLAYER || b.stage !== 'site' || b.builder || b.type === 'centre') continue;
			if (few && builders >= 1) {
				b.status = 'Waiting for a builder';
				continue;
			}
			// a builder sets out once it can build: its planks and stone are at the site (or, in a small city, in store
			// for it to bring), so nobody stands idle at a site while the woodcutter has no one
			if (!ready(b, few)) continue;
			const wh = nearestWarehouse(b.flag, (w) => w.settlers > 0);
			const walk = wh && roadWalk(wh.flag, b.flag);
			if (!wh || !walk) {
				b.status = wh ? 'Not connected by road' : 'No settlers free';
				continue;
			}
			wh.settlers--;
			const u = spawn('builder', PLAYER, [wh.node, ...walk, b.node], 'b-go', { bld: b.id, vil: villageAt(wh.node) });
			b.builder = u.id;
			b.status = 'A builder is on the way';
			builders++;
			// in a small city the builder brings what the site needs, so no road waits on a carrier nobody can spare
			if (few)
				for (const [w, need] of Object.entries(b.cost)) {
					const n = Math.min(need - (b.got[w] ?? 0) - (b.inc[w] ?? 0), Math.floor(wh.stock[w] ?? 0));
					if (n <= 0) continue;
					wh.stock[w] -= n;
					b.got[w] = (b.got[w] ?? 0) + n;
				}
		}
		// a site waits for a builder, or a path for its bus, and nobody is free: a worker with nothing to do (its goods
		// are stocked up, or its land has nothing left) goes home to take it
		const waiting = blds().some((x) => x.owner === PLAYER && x.stage === 'site' && !x.builder && x.type !== 'centre' && ready(x, few));
		// at most half the people drive the buses, so the other half can work (food first)
		let drivers = units().filter((u) => u.owner === PLAYER && u.kind === 'carrier').length;
		const most = Math.max(2, Math.ceil(yourPeople() / 2));
		const unmanned = roads().some((r) => r.owner === PLAYER && !r.carrier && (drivers < most || (st.flags[r.a]?.wares.length ?? 0) + (st.flags[r.b]?.wares.length ?? 0) > 0));
		if ((unmanned || (waiting && !(few && builders >= 1))) && !warehouses().some((w) => w.owner === PLAYER && w.settlers > 0)) {
			const idle = blds().find((x) => x.owner === PLAYER && x.stage === 'live' && st.units[x.worker]?.job === 'w-in' && /^Resting|full|^No |growing/.test(x.status ?? ''));
			if (idle) {
				const u = st.units[idle.worker];
				idle.worker = 0;
				idle.status = 'Its worker went to build';
				u.bld = 0;
				goHome(u);
			}
		}
		// a path with wares waiting at its ends gets its bus first, whatever the count
		const busy = (/** @type {any} */ r) => (st.flags[r.a]?.wares.length ?? 0) + (st.flags[r.b]?.wares.length ?? 0);
		// (each road's count taken once, then a stable sort: the same order as counting in the comparison)
		const byBusy = roads().map((r) => /** @type {[number, any]} */ ([busy(r), r])).sort((x, y) => y[0] - x[0]).map(([, r]) => r);
		for (const r of byBusy) {
			if (r.carrier || r.owner !== PLAYER) continue;
			if (drivers >= most && !busy(r)) break;
			const wh = nearestWarehouse(r.a, (w) => w.settlers > 0);
			const walk = wh && roadWalk(wh.flag, r.a);
			if (!wh || !walk) continue;
			wh.settlers--;
			const u = spawn('carrier', PLAYER, [wh.node, ...walk], 'c-go', { road: r.id, vil: villageAt(wh.node) });
			u.speed = WALK;
			r.carrier = u.id;
			drivers++;
		}
		// more buses than half the people while a workplace stands empty: a bus waiting on a quiet path goes home
		if (drivers > most && !warehouses().some((w) => w.owner === PLAYER && w.settlers > 0) && blds().some((x) => x.owner === PLAYER && x.stage === 'live' && T(x).worker && !x.worker)) {
			const r = roads().find((x) => x.owner === PLAYER && x.carrier && !busy(x) && st.units[x.carrier]?.job === 'c-idle' && !st.units[x.carrier].ware);
			if (r) {
				const u = st.units[r.carrier];
				r.carrier = 0;
				goHome(u);
			}
		}
		for (const b of blds()) {
			if (b.owner !== PLAYER) continue;
			const t = T(b);
			if (b.stage === 'live' && t.worker && !b.worker) {
				// the last free settler is kept for a building site that waits for its builder
				const keep = waiting ? 1 : 0;
				const wh = nearestWarehouse(b.flag, (w) => w.settlers > keep && (!t.tools || (w.stock.tools ?? 0) > 0));
				const walk = wh && roadWalk(wh.flag, b.flag);
				if (!wh || !walk) {
					const any = nearestWarehouse(b.flag, () => true);
					const noTools = t.tools && (any?.stock.tools ?? 0) <= 0;
					b.status = !any ? 'Not connected by road' : noTools ? 'Waiting for tools (build a toolmaker)' : 'Waiting for a settler';
					if (any && noTools && st.time - (st.toolsWarned ?? -999) > 300) {
						st.toolsWarned = st.time;
						say('Out of tools: a toolmaker makes them from planks and iron ore, which comes only from an iron hex.', b.node, 'alert');
					}
					continue;
				}
				wh.settlers--;
				if (t.tools) wh.stock.tools--;
				const u = spawn('worker', PLAYER, [wh.node, ...walk, b.node], 'w-go', { bld: b.id, vil: villageAt(wh.node), tool: !!t.tools });
				b.worker = u.id;
				b.status = `A ${t.worker?.toLowerCase()} is on the way`;
			}
		}
	}

	// ── the economy: who needs what, and where it comes from ──
	function requestsOf(/** @type {any} */ b) {
		const t = T(b);
		if (b.stage === 'site' && b.type === 'centre') return [];
		// a small city's builders bring their own planks and stone (see people)
		if (b.stage === 'site' && b.owner === PLAYER && small()) return [];
		if (b.stage === 'site') return Object.keys(b.cost).map((w) => ({ types: [w], slot: -1, n: b.cost[w] - b.used[w] - b.got[w] - b.inc[w] }));
		if (b.stage !== 'live') return [];
		if (b.paused || !b.worker) return [];
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
				const j = near.find((n) => st.obj[n]?.k === 'tree' && st.obj[n].g >= 1 && !st.obj[n].r);
				return j === undefined ? null : [j, j];
			}
			case 'quarry': {
				const j = near.find((n) => st.obj[n]?.k === 'rock' && !st.obj[n].r);
				if (j === undefined) return null;
				// stand beside the rock
				for (let d = 0; d < 6; d++) {
					const s = g.nb(j, d);
					if (s >= 0 && walkable(s) && st.obj[s]?.k !== 'rock') return [j, s];
				}
				return null;
			}
			case 'fishery': {
				for (const j of near) {
					if (st.terrain[j] !== WATER || st.fish[j] <= 0) continue;
					for (let d = 0; d < 6; d++) {
						const s = g.nb(j, d);
						if (s >= 0 && st.terrain[s] !== WATER && walkable(s)) return [j, s];
					}
				}
				return null;
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
			case 'farm': {
				const ripe = near.find((n) => st.obj[n]?.k === 'field' && st.obj[n].b === b.id && st.obj[n].g >= 1 && !st.obj[n].r);
				if (ripe !== undefined) return [ripe, ripe];
				if (b.fields >= 7) return null;
				const j = near.find((n) => freeSpot(n));
				return j === undefined ? null : [j, j];
			}
		}
		return null;
	}
	const NOTHING = /** @type {Record<string, string>} */ ({ woodcutter: 'No grown trees nearby', quarry: 'No rocks nearby', fishery: 'No fish nearby', forester: 'The forest round it is full', farm: 'Fields are growing' });

	/** how much of a ware the storehouses hold */
	const stocked = (/** @type {string} */ ware) => warehouses().reduce((s, w) => s + (w.stock[ware] ?? 0), 0);
	function work(/** @type {any} */ b, /** @type {number} */ dt) {
		const t = T(b);
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
			} else b.status = 'Waiting for materials';
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
					for (let k = 0; k < (t.yield ?? 1); k++) {
						b.out++;
						made(/** @type {string} */ (t.out));
					}
					if (t.kind === 'mine') b.deposit--;
				}
			}
			if (b.out > 0 && !flushOutput(b, /** @type {string} */ (t.out))) b.status = 'Its stop is full';
			else if (b.timer > 0) b.status = 'Working';
			else if (b.paused) b.status = 'Paused';
			else if (t.kind === 'mine' && b.deposit <= 0) b.status = 'The vein is used up';
			else if (stocked(/** @type {string} */ (t.out)) >= ENOUGH) b.status = 'Resting: the storehouses are full of it';
			else {
				const missing = b.slots.findIndex((/** @type {any} */ s) => s.have < 1);
				if (missing >= 0) b.status = `Waiting for ${/** @type {string[][]} */ (t.inputs)[missing].map((w) => WARES[w].label.toLowerCase()).join(' or ')}`;
				else {
					for (const s of b.slots) s.have--;
					b.timer = /** @type {number} */ (t.time);
					b.status = 'Working';
					busy = true;
				}
			}
		} else if (u.inside) {
			// a gatherer: rest, then out into the land
			if (b.out > 0 && !flushOutput(b, /** @type {string} */ (t.out))) b.status = 'Its stop is full';
			else if (b.timer > 0) b.timer -= dt;
			else if (b.paused) b.status = 'Paused';
			else if (t.out && stocked(t.out) >= ENOUGH) {
				b.status = 'Resting: the storehouses are full of it';
				b.timer = 3;
			} else {
				const target = findTarget(b);
				const path = target && findPath(g, b.node, target[1], walkable, 1500);
				if (!target || !path) {
					b.status = NOTHING[b.type] ?? 'Nothing to do';
					b.timer = 3;
				} else {
					const plant = (b.type === 'farm' && st.obj[target[0]]?.k !== 'field') || b.type === 'forester';
					if (st.obj[target[0]] && !plant) st.obj[target[0]].r = u.id;
					Object.assign(u, { inside: false, path, p: 0, tgt: path.length - 1, job: 'w-out', target: target[0] });
					b.status = 'Working';
					busy = true;
				}
			}
		} else busy = true;
		b.eff += ((busy ? 1 : 0) - b.eff) * Math.min(1, dt / 40);
	}
	function finish(/** @type {any} */ b) {
		// a village center that opens joins the trade routes dug to it
		if (b.type === 'centre') st.tunV++;
		if (b.type === 'house') {
			const was = b.level;
			b.level = Math.max(1, b.level + (b.level ? 1 : 0));
			b.cost = {};
			if (was) {
				b.stage = 'live';
				b.status = '';
				const u = st.units[b.builder];
				b.builder = 0;
				if (u) goHome(u);
				say(`A house now holds ${HOUSE_BEDS[b.level - 1]} settlers`, b.node, 'good');
				st.objV++;
				return;
			}
		}
		b.stage = 'live';
		b.timer = 0;
		b.since = st.time;
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
				if (o?.k === 'tree') {
					st.obj[j] = null;
					u.ware = 'plank';
					st.objV++;
				}
				break;
			case 'quarry':
				if (o?.k === 'rock') {
					o.n--;
					if (o.n <= 0) st.obj[j] = null;
					u.ware = 'stone';
					st.objV++;
				}
				break;
			case 'fishery':
				if (st.fish[j] > 0) {
					st.fish[j]--;
					u.ware = 'fish';
				}
				break;
			case 'forester':
				if (!st.obj[j] && !st.road[j]) {
					st.obj[j] = { k: 'tree', g: 0.04 };
					st.objV++;
				}
				break;
			case 'farm':
				if (o?.k === 'field' && o.g >= 1) {
					st.obj[j] = null;
					b.fields = Math.max(0, b.fields - 1);
					u.ware = 'grain';
					st.objV++;
				} else if (!o && !st.road[j]) {
					st.obj[j] = { k: 'field', g: 0, b: b.id };
					b.fields++;
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
	const rule = (/** @type {string} */ w) => orderRule(w, st.parties[PLAYER].pop ?? 0);
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
	const pooled = (/** @type {any} */ a, /** @type {Record<string, number>} */ cost) => Object.entries(cost).every(([w, n]) => pool(a).reduce((s, c) => s + (c.stock[w] ?? 0), 0) >= n);
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
	/** a village center's stop: the middle of its hex, where its trade routes start */
	const stopAt = (/** @type {any} */ c) => st.flags[c.flag]?.node ?? c.node;
	/** what a trade route between two village centers costs: a stone for every four world units */
	const tunnelCost = (/** @type {number} */ a, /** @type {number} */ b) => Math.ceil((g.dist(a, b) * STEP) / 4);
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
		if (pay) payPooled(a, { stone: tunnelCost(an, bn) });
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
			if (giver) giver.hearts = (giver.hearts ?? 0) + d.hearts;
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
	/** what a village of yours wants to hold of a ware: food and water for its people, wood and stone for its sites, what its factories work with */
	function wantAt(/** @type {any} */ c, /** @type {string} */ w) {
		const v = villageAt(c.node);
		const pop = villagePeople(v);
		const need = /** @type {Record<string, number>} */ (NEEDS)[w] ?? (FOOD.includes(w) ? NEEDS.food / 2 : 0);
		let want = need * pop * 10;
		for (const b of mineIn(v)) {
			if (b.stage === 'site') want += Math.max(0, (b.cost[w] ?? 0) - (b.used[w] ?? 0) - (b.got[w] ?? 0) - (b.inc[w] ?? 0));
			else if ((T(b).inputs ?? []).some((/** @type {string[]} */ s) => s.includes(w))) want += 4;
			else if (w === 'tools' && T(b).tools && !b.worker) want += 1;
		}
		if (w === 'plank' || w === 'stone') want = Math.max(want, 6);
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
			// as much as evens them out, and as the taker's treasury can pay for: in gold, to the giver, on delivery
			const even = (donor.have + recv.have + (comingTo(recv.c)[w] ?? 0)) / (donor.want + recv.want);
			const each = heartsFor(w);
			const n = Math.min(CART, Math.floor(donor.have - even * donor.want), Math.ceil(even * recv.want - recv.have - (comingTo(recv.c)[w] ?? 0)), Math.floor((recv.c.hearts ?? 0) / each));
			if (n < 1) continue;
			donor.c.stock[w] -= n;
			recv.c.hearts -= n * each;
			sendCart(donor.c, recv.c, { [w]: n }, { kind: 'move', hearts: n * each, from: donor.c.id });
		}
		// and settlers move to where there are beds for them
		for (const c of mine) {
			const v = villageAt(c.node);
			// to fill new beds, or to build when a site there waits for a builder
			const waits = mineIn(v).some((b) => b.stage === 'site' && !b.builder && b.type !== 'centre');
			if (c.settlers > 0 || (villagePeople(v) >= bedsIn(v) && !waits)) continue;
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
	/** the neighbours' cities as they grow: a settlement (a house, two factories) for every sixteen or so people */
	function neighbourTowns() {
		for (let k = 1; k < st.parties.length; k++) {
			const kinds = NEIGHBOURS[k - 1].builds;
			for (const { c, v, pop } of cityShares(k)) {
				const vill = plan.villages[v];
				// the settlements with room for a house first, nearest the center first
				const home = (/** @type {number} */ x) => plan.spots[x][0] >= 0 && st.terrain[plan.spots[x][0]] === GRASS;
				const ring = vill.plots.filter((x) => x !== vill.centre).sort((a, b) => +home(b) - +home(a) || g.dist(plan.centre[a], c.node) - g.dist(plan.centre[b], c.node));
				const count = Math.max(1, Math.min(ring.length, Math.ceil(pop / 16)));
				let level = 1;
				while (level < 4 && count * HOUSE_BEDS[level - 1] < pop) level++;
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

	// ── the villages and cities: needs, the neighbours' work, abundance ──
	/** the people of one of your villages: in its center and out at work */
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
			const p = (st.vill[v] ??= { ...party(`Village ${Object.keys(st.vill).length + 1}`, 0), v });
			return { v, c, p };
		});
	}
	/** whether a village is full: a house of 16 in each of its settlements that can hold one, and every bed taken */
	function fullVillage(/** @type {number} */ v, /** @type {number} */ owner) {
		const vill = plan.villages[v];
		for (const k of vill.plots) {
			if (k === vill.centre) continue;
			const h = plan.spots[k][0];
			if (h < 0 || st.terrain[h] !== GRASS) continue;
			const b = buildingAt(h);
			if (!b || b.owner !== owner || b.type !== 'house' || b.level < 4 || b.stage !== 'live') return false;
		}
		return owner === PLAYER ? villagePeople(v) >= bedsIn(v) : true;
	}
	function settlements(/** @type {number} */ dt) {
		const m = st.market;
		// each of your villages lives on what its center holds
		const vs = yourVillages();
		// every settler issues HEARTs into its village center's treasury; what a treasury holds wanes by the year
		const wane = Math.pow(1 - HEARTS.demurrage, dt / (HEARTS.yearHours * HEARTS.hour));
		for (const { v, c, p } of vs) {
			p.pop = villagePeople(v);
			c.hearts = (c.hearts ?? 0) * wane + (HEARTS.perHour * p.pop * dt) / HEARTS.hour;
			live(
				p,
				p.pop,
				dt,
				(w) => ((c.stock[w] ?? 0) >= 1 ? ((c.stock[w] -= 1), true) : false),
				(w) => c.stock[w] ?? 0
			);
		}
		// your city, as the market and the page see it: everyone counted, happiness the people's average
		const you = st.parties[PLAYER];
		you.pop = vs.reduce((s, x) => s + x.p.pop, 0);
		const weigh = (/** @type {(p: any) => number} */ f) => vs.reduce((s, x) => s + f(x.p) * Math.max(1, x.p.pop), 0) / Math.max(1, vs.reduce((s, x) => s + Math.max(1, x.p.pop), 0));
		you.wb = weigh((p) => p.wb);
		you.reserve = weigh((p) => p.reserve);
		for (const n of Object.keys(you.sat)) you.sat[n] = weigh((p) => p.sat[n]);
		for (let k = 1; k < st.parties.length; k++) {
			const p = st.parties[k];
			make(p, k, dt);
			live(
				p,
				p.pop,
				dt,
				(w) => ((p.stock[w] ?? 0) >= 1 ? ((p.stock[w] -= 1), true) : false),
				(w) => p.stock[w] ?? 0
			);
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
		// abundance: every village counts, yours and the neighbours'
		const rows = villageRows();
		m.abundance = abundance(rows.map((r) => ({ wb: r.score })));
		m.thriving = rows.filter((r) => r.wb >= ABUNDANT && r.full).length;
		m.villages = rows.length;
		// every city needs its five villages first: you and each neighbour
		m.cities = [{ name: 'You', n: myCentres().length }, ...st.parties.slice(1).map((/** @type {any} */ p, /** @type {number} */ j) => ({ name: p.name, n: cityVillages(j + 1).length }))];
		const grown = m.cities.every((/** @type {any} */ c) => c.n >= CITY_VILLAGES);
		if (grown && m.thriving === rows.length) {
			if (m.since < 0) {
				m.since = st.time;
				say(`Every village is full and lives well (abundance ${Math.round(m.abundance)}). Hold it for ten minutes!`, -1, 'good');
			}
			if (st.time - m.since >= HOLD && !st.won && !st.goals?.abundance) {
				st.result = 'won';
				st.won = true;
				say('Ten minutes of abundance for the whole valley. Everyone lives well!', -1, 'good');
			}
		} else if (m.since >= 0) {
			m.since = -1;
			const who = rows.find((r) => r.wb < ABUNDANT || !r.full) ?? m.cities.find((/** @type {any} */ c) => c.n < CITY_VILLAGES);
			say(`${who?.name ?? 'A village'} slipped below ${ABUNDANT}, or is no longer full`, -1, 'alert');
		}
	}
	/** every village of the valley as the abundance panel shows it: yours by name, then each neighbour city's */
	/** how many people a village holds when it is full: 16 in every settlement that has room for a house */
	const capOf = (/** @type {number} */ v) =>
		16 * plan.villages[v].plots.filter((k) => k !== plan.villages[v].centre && plan.spots[k][0] >= 0 && st.terrain[plan.spots[k][0]] === GRASS).length;
	/**
	 * Every village of the valley as the abundance panel shows it: yours by name, then each neighbour city's. Its
	 * abundance is how well its people live (wellbeing) times how full it is: a hamlet that lives well is not yet abundant.
	 */
	function villageRows() {
		const row = (/** @type {any} */ r) => ({ ...r, score: r.wb * Math.min(1, r.pop / Math.max(1, r.cap)) });
		return [
			...yourVillages().map(({ v, c, p }) => row({ name: p.name, city: 'You', pop: p.pop, beds: bedsIn(v), cap: capOf(v), wb: p.wb, sat: { ...p.sat }, reserve: p.reserve, full: fullVillage(v, PLAYER), node: c.node, owner: PLAYER })),
			...st.parties.slice(1).flatMap((/** @type {any} */ p, /** @type {number} */ j) =>
				cityShares(j + 1).map(({ c, v, cap, pop }, x) => row({ name: x ? `${p.name} ${x + 1}` : p.name, city: p.name, pop, beds: cap, cap, wb: p.wb, sat: { ...p.sat }, reserve: p.reserve, full: pop >= cap && fullVillage(v, j + 1), node: c.node, owner: j + 1 }))
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
		if (st.time >= c.fish) {
			c.fish = st.time + 20;
			for (let i = 0; i < N; i++) if (st.terrain[i] === WATER && st.fish[i] < 4 && rand() < 0.35) st.fish[i]++;
		}
		if (st.time >= c.pop) {
			c.pop = st.time + 6;
			// newcomers settle in a village that lives well and has a bed for them; with too few beds, people leave
			for (const { v, c: ctr, p } of yourVillages()) {
				const people = villagePeople(v), room = bedsIn(v);
				if (people < room && p.wb >= 60) ctr.settlers++;
				else if (room > 0 && people > room && ctr.settlers > 0) {
					ctr.settlers--;
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
				// and the valley grows together: a neighbour stays within a village (96) of your people
				const cap = Math.min(cityCap(k), 96 + yourPeople()), n = cityVillages(k).length;
				if (p.wb >= 72 && p.reserve >= 0.45 && p.pop < cap) p.pop = Math.min(cap, p.pop + 2 * n);
				else if (p.wb >= 72 && p.reserve >= 0.45 && p.pop >= cityCap(k) && n < CITY_VILLAGES) cityFounds(k);
				else if (p.wb < 40 && p.pop > 10 && rand() < 0.2) {
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
			c.needs = st.time + 2;
			settlements(2);
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
			const f = founder(v);
			if (!f) return plan.villages[v].near.some((x) => st.villageOwner[x] === PLAYER) ? 'The village center next to it needs more planks and stone' : 'Too far: found villages next to your city';
			return '';
		}
		if (middle) return 'The village center fills the middle of the village';
		if (spot < 0) return 'Buildings stand round the middle of a settlement: pick a marked spot';
		if (type === 'house' && spot !== 0) return 'A house stands on its settlement’s house spot';
		if (type !== 'house' && spot === 0) return 'This spot is for the settlement’s house';
		if (vo !== PLAYER) return 'Outside your city: found a village center first';
		if (!mineIn(v).some((b) => b.type === 'centre' && b.stage === 'live')) return 'This village’s center is still being founded';
		// a woodcutter, forester, quarry, iron mine or fishery only stands on a hex of its own kind
		if (t.biome && st.biome[plot] !== t.biome) return `${t.label}s stand on ${BIOMES[t.biome].label.toLowerCase()} hexes`;
		if (type !== 'house') {
			const home = buildingAt(plan.spots[plot][0]);
			if (!home || home.owner !== PLAYER || home.type !== 'house') return 'Build this settlement’s house first';
		}
		// a building clears its own ground: a tree there is felled, a rock broken, a field ploughed under
		if (st.obj[n] && !['tree', 'rock', 'field'].includes(st.obj[n].k)) return 'Something stands here';
		if (st.road[n]) return 'A road runs here';
		if (t.on === 'mountain' ? st.terrain[n] !== MOUNTAIN : st.terrain[n] !== GRASS) return t.on === 'mountain' ? 'Mines stand on mountains' : 'Needs open grass';
		const c = plan.centre[plan.plotOf[n]];
		if (st.terrain[c] === WATER) return 'The middle of its settlement is water';
		const f = flagAt(c);
		if (f && f.owner !== PLAYER) return 'Not yours';
		if (st.road[c]) return 'A path runs where its stop goes';
		if (type === 'fishery' && !g.within(n, 6).some((j) => st.terrain[j] === WATER)) return 'Needs water nearby';
		if (t.kind === 'mine' && depositAt(n) <= 0) return 'No iron ore in this rock';
		return '';
	}
	/** the village center of yours that can found a village: next to it, with what it costs and the route */
	function founder(/** @type {number} */ v) {
		const cost = BUILDINGS.centre.cost, mid = plan.centre[plan.villages[v].centre];
		return (
			myCentres()
				.filter((c) => plan.villages[v].near.includes(villageAt(c.node)))
				.filter((c) => pooled(c, { plank: /** @type {number} */ (cost.plank), stone: /** @type {number} */ (cost.stone) + tunnelCost(c.node, mid) }))
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

	return {
		state: st,
		grid: g,
		plan,
		/** every building, as a list kept until one comes or goes: read it, don't change it */
		buildingList: blds,
		step,
		setup(/** @type {import('./map.js').Valley} */ v) {
			const hq = makeBuilding('centre', v.hq, PLAYER, true);
			hq.stock = { ...START.stock };
			hq.settlers = START.settlers;
			hq.hearts = 0;
			hq.since = 0;
			st.hq = hq.id;
			st.villages = [];
			// the first houses round your village center, nearest first
			const ring = plan.villages[villageAt(hq.node)].plots.filter((k) => k !== plan.plotOf[hq.node]).sort((a, b) => g.dist(plan.centre[a], hq.node) - g.dist(plan.centre[b], hq.node));
			START.houses.forEach((level, x) => {
				const h = plan.spots[ring[x]][0];
				if (h < 0) return;
				const b = makeBuilding('house', h, PLAYER, true);
				b.level = level;
				b.since = 0;
			});
			territory();
			for (const b of blds()) if (b.type === 'house') autoRoad(b.flag);
			neighbourTowns();
			say('Welcome to your valley: a village center and one house of two. Every hex holds a house and two factories in a triangle round its middle, and paths run straight from middle to middle. Woods, rocks, water and iron lie on their own hexes, so found villages where they are and join them. Build homes first, then a woodcutter and a quarry.', hq.node);
		},
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
			const b = makeBuilding(type, n, PLAYER);
			b.since = st.time;
			if (type === 'centre') {
				// founded from the village center next to it: the cost, a trade route and four settlers go by cart
				const from = /** @type {any} */ (founder(villageAt(n)));
				payPooled(from, b.cost);
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
		/** enlarge a house to its next size: builders bring what it costs, and its settlers stay meanwhile */
		upgrade(/** @type {number} */ id) {
			const b = st.buildings[id];
			if (!b || b.owner !== PLAYER || b.type !== 'house') return { ok: false, why: 'Only your houses grow' };
			if (b.stage !== 'live') return { ok: false, why: 'It is being built' };
			if (b.level >= 4) return { ok: false, why: 'It is as large as a house gets' };
			b.cost = { ...HOUSE_UP[b.level - 1] };
			for (const w of Object.keys(b.cost)) (b.used[w] = 0), (b.got[w] = 0), (b.inc[w] = 0);
			b.stage = 'site';
			b.status = 'Waiting for a builder';
			st.objV++;
			return { ok: true };
		},
		pause(/** @type {number} */ id, /** @type {boolean} */ paused) {
			const b = st.buildings[id];
			if (b && b.owner === PLAYER) b.paused = paused;
		},
		/** sell or buy a ware, or (null) neither */
		order(/** @type {string} */ w, /** @type {'sell' | 'buy' | null} */ o) {
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
				abundance: m.abundance,
				since: m.since,
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
					node: c.node
				}))
				.sort((x, y) => Number(x.joined) - Number(y.joined) || g.dist(b.node, x.node) - g.dist(b.node, y.node));
		},
		/** dig a trade route from a village center of yours to another, paid in stone by yours */
		connect(/** @type {number} */ from, /** @type {number} */ to) {
			const a = st.buildings[from], b = st.buildings[to];
			if (!a || !b || a.type !== 'centre' || a.owner !== PLAYER || b.stage !== 'live') return { ok: false, why: 'Not a village center' };
			if (reach(a.id).has(b.id)) return { ok: false, why: 'Already joined' };
			const cost = tunnelCost(a.node, b.node);
			if (!pooled(a, { stone: cost })) return { ok: false, why: `The route needs ${cost} stone` };
			dig(a, b);
			say(`A trade route now runs to ${b.owner === PLAYER ? st.vill[villageAt(b.node)]?.name ?? 'your village' : st.parties[b.owner].name}`, b.node, 'good');
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
				abundance: m.abundance,
				/** settlements living well with enough people */
				thriving: m.thriving ?? 0,
				/** seconds the valley has been abundant, or -1 */
				held: m.since >= 0 ? st.time - m.since : -1,
				allVillages: m.villages ?? 0,
				/** how many villages each city has, against the five the valley needs */
				cities: (m.cities ?? []).map((/** @type {any} */ c) => ({ ...c })),
				need: CITY_VILLAGES,
				parties: st.parties.map((/** @type {any} */ p) => ({ name: p.name, wb: p.wb })),
				result: st.result,
				msgs: st.msgs.slice(-6)
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
			const s = p.sat;
			const noTools = blds().some((b) => b.owner === PLAYER && villageAt(b.node) === v && /tools/.test(b.status ?? ''));
			const has = (/** @type {string} */ w) => c.stock[w] ?? 0;
			/** per resource, what its store has against what it needs: its people's ten minutes (more with each settler), its sites and its factories; short when its people go without */
			const row = (/** @type {string} */ key, /** @type {string} */ label, /** @type {string[]} */ wares, /** @type {boolean} */ short) => ({
				key,
				label,
				have: Math.floor(wares.reduce((t, w) => t + has(w), 0)),
				need: Math.ceil(wares.reduce((t, w) => t + wantAt(c, w), 0)),
				short
			});
			const rows = [
				row('food', 'Food', FOOD, lived && s.food < 0.8),
				row('water', 'Water', ['water'], lived && s.water < 0.8),
				row('plank', 'Planks', ['plank'], lived && s.plank < 0.8),
				row('stone', 'Stone', ['stone'], lived && s.stone < 0.8),
				row('grain', 'Grain', ['grain'], false),
				row('ore', 'Iron ore', ['ore'], false),
				row('tools', 'Tools', ['tools'], noTools)
			].filter((r) => r.need > 0 || r.have > 0);
			/** @type {{ tone: string, text: string, node: number }[]} */
			const notes = [];
			if (pop >= bed && bed < cap) notes.push({ tone: 'todo', text: `No free bed: enlarge a house or build one`, node: c.node });
			const cut = blds().find((b) => b.owner === PLAYER && b.stage === 'site' && villageAt(b.node) === v && b.status === 'Not connected by road');
			if (cut) notes.push({ tone: 'alert', text: `A ${T(cut).label.toLowerCase()} site has no path`, node: cut.node });
			return {
				name: p.name,
				node: c.node,
				pop,
				beds: bed,
				cap,
				wb: p.wb,
				/** its treasury, in gold */
				gold: (c.hearts ?? 0) / HEARTS.perGold,
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
				label: t.label,
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
				paused: b.paused,
				eff: Math.round(b.eff * 100),
				deposit: b.deposit,
				kind: t.kind,
				stock: isWarehouse(b) ? { ...b.stock } : null,
				settlers: b.settlers,
				party: b.type === 'village' ? { ...st.parties[b.owner], stock: { ...st.parties[b.owner].stock } } : b.type === 'centre' && st.vill[villageAt(b.node)] ? { ...st.vill[villageAt(b.node)], beds: bedsIn(villageAt(b.node)) } : null,
				level: b.level,
				beds: b.type === 'house' && b.level ? HOUSE_BEDS[b.level - 1] : 0,
				upgrading: b.type === 'house' && b.stage === 'site' && b.level > 0,
				up: b.type === 'house' && b.level >= 1 && b.level < 4 ? HOUSE_UP[b.level - 1] : null,
				village: villageAt(b.node)
			};
		},
		toJSON: () => JSON.stringify(st)
	};
}
