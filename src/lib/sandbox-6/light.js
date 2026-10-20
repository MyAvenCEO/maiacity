/**
 * SANDBOX 6 · ONE VILLAGE · THE LIGHT — how much direct sun reaches each dome's south glass (Samuel, 2026-10-08: the
 * living hex puts the tall domes north and the low ones south "for better light").
 *
 * The sun is followed through two days at the village's latitude (Munich, 48.1° N): the winter solstice, when the sun
 * stands lowest (18.4° at noon) and shadows are longest, and the equinox. Every 10 minutes while the sun is over 2°, a
 * ray goes from three points on each dome's south glass (south-east, south and south-west, a third of the way up) toward
 * the sun; the point is in the sun unless another dome or the tower stands in the way. Trees, hedges and the hills
 * round the village are left out. Where the works stand in plain halls (design packages 3–4: ./specs.js DESIGN), a hall
 * is a box as high as its ridge in another's way, and its own three points sit on its south roof, where its solar is.
 * Pure functions, in the browser or in node.
 */
import { sunOverGround } from '$lib/sandbox-kit/universe.js';
import { capOf, KINDS, TOWER, capHeight, siteHall, towerRadius } from './specs.js';

/** the village's latitude */
export const LATITUDE = 48.1;
/** the two days, by the sun's declination */
export const DAYS = { winter: { label: '21 December', decl: -23.44 }, equinox: { label: '21 March', decl: 0 } };
const DEG = Math.PI / 180;
const STEP_MIN = 10;

/** the sun's direction (x east, y up, z south) every 10 minutes of a day while it is over 2°: the universe's own sun
 *  ($lib/sandbox-kit/universe.js `sunOverGround`), seen from the village; its noon is at twelve, the universe's at half
 *  past, so each moment is asked for half an hour later (and a little into its ten minutes) @returns {number[][]} */
function sunPath(/** @type {number} */ decl) {
	/** @type {number[][]} */
	const out = [];
	for (let m = 0; m < 24 * 60; m += STEP_MIN) {
		const s = sunOverGround(m / 60 + 0.5 + STEP_MIN / 120, LATITUDE, decl);
		if (Math.asin(s.y) < 2 * DEG) continue;
		out.push([s.x, s.y, s.z]);
	}
	return out;
}
const PATHS = Object.fromEntries(Object.entries(DAYS).map(([k, d]) => [k, sunPath(d.decl)]));

/**
 * @typedef {{ hex: string, id: string, kind: string, x: number, z: number, factory?: string }} Placed a building where it stands in the village
 */

/** does a ray from p along d hit the cap of a dome at (x, z), D across? */
function hitsDome(/** @type {number[]} */ p, /** @type {number[]} */ d, /** @type {number} */ x, /** @type {number} */ z, /** @type {import('./specs.js').Cap} */ c) {
	const cy = -(c.R - c.h);
	const ox = p[0] - x, oy = p[1] - cy, oz = p[2] - z;
	const b = ox * d[0] + oy * d[1] + oz * d[2];
	const cc = ox * ox + oy * oy + oz * oz - c.R * c.R;
	const disc = b * b - cc;
	if (disc < 0) return false;
	const s = Math.sqrt(disc);
	for (const t of [-b - s, -b + s]) if (t > 0 && p[1] + t * d[1] >= 0) return true;
	return false;
}
/** does a ray from p along d hit a works hall at (x, z), taken as a box as high as its ridge, its long side east to west? */
function hitsHall(/** @type {number[]} */ p, /** @type {number[]} */ d, /** @type {number} */ x, /** @type {number} */ z, /** @type {any} */ h) {
	const lo = [x - h.length / 2, 0, z - h.span / 2], hi = [x + h.length / 2, h.ridge, z + h.span / 2];
	let t0 = 0, t1 = Infinity;
	for (let k = 0; k < 3; k++) {
		if (Math.abs(d[k]) < 1e-9) {
			if (p[k] < lo[k] || p[k] > hi[k]) return false;
			continue;
		}
		const a = (lo[k] - p[k]) / d[k], b = (hi[k] - p[k]) / d[k];
		t0 = Math.max(t0, Math.min(a, b));
		t1 = Math.min(t1, Math.max(a, b));
		if (t0 > t1) return false;
	}
	return true;
}
/** does a ray from p along d hit the tower standing at (x, z)? (marched in 3 m steps up its profile) */
function hitsTower(/** @type {number[]} */ p, /** @type {number[]} */ d, /** @type {number} */ x, /** @type {number} */ z) {
	const R = TOWER.D / 2;
	// the ray's nearest pass by the tower's axis, on the ground plan
	const h = Math.hypot(d[0], d[2]);
	if (h < 1e-6) return false;
	const ux = d[0] / h, uz = d[2] / h;
	const along = (x - p[0]) * ux + (z - p[2]) * uz;
	if (along < -R) return false;
	if (Math.abs((x - p[0]) * uz - (z - p[2]) * ux) > R) return false;
	for (let t = 0; t < 2400; t += 3) {
		const y = p[1] + t * d[1];
		if (y > TOWER.H) return false;
		if (Math.hypot(p[0] + t * d[0] - x, p[2] + t * d[2] - z) < towerRadius(TOWER, y)) return true;
	}
	return false;
}

/**
 * The share of the day each building's south glass has the sun, in winter and at the equinox: for each building, and
 * for each hex's homes and its other domes.
 * @param {Placed[]} placed every building of the village (or of one hex, to see a layout alone)
 *   sites keyed `${hex}/${id}`; hexes by hex: its homes (weighted by their people) and its other domes (food,
 *   utilities, factories); each the share of the sunny day (0–1) for each day
 */
export function sunShares(placed) {
	const halls = placed.map((b) => siteHall(b));
	const caps = placed.map((b, i) => (b.kind === 'tower' || halls[i] ? null : capOf(KINDS[b.kind].D)));
	/** @type {Record<string, Record<string, number>>} */
	const sites = {};
	for (let i = 0; i < placed.length; i++) {
		const b = placed[i], c = caps[i], hl = halls[i];
		if (!c && !hl) continue;
		/** @type {number[][]} */
		let probes;
		if (hl) {
			// three points along the middle of a hall's south roof slope, a little over its panels
			const p = (hl.pitch * Math.PI) / 180;
			probes = [-1 / 3, 0, 1 / 3].map((f) => [b.x + f * hl.length, hl.eaves + (hl.span / 4) * Math.tan(p) + 0.5, b.z + hl.span / 4]);
		} else if (c) {
			// three points on the south glass a third of the way up, a little proud of it
			let r = c.a;
			while (r > 0 && capHeight(c, r) < c.h / 3) r -= 0.25;
			probes = [150, 180, 210].map((deg) => [b.x + (r + 0.3) * Math.sin(deg * DEG), c.h / 3, b.z - (r + 0.3) * Math.cos(deg * DEG)]);
		} else continue;
		// only what stands within reach of a 2° sun can shade it
		const near = placed.map((o, j) => j).filter((j) => j !== i && Math.hypot(placed[j].x - b.x, placed[j].z - b.z) < (caps[j] || halls[j] ? 1800 : 6000));
		/** @type {Record<string, number>} */
		const share = {};
		for (const [day, path] of Object.entries(PATHS)) {
			let lit = 0;
			for (const d of path)
				for (const p of probes) {
					const blocked = near.some((j) => {
						const o = placed[j], oc = caps[j], oh = halls[j];
						return oh ? hitsHall(p, d, o.x, o.z, oh) : oc ? hitsDome(p, d, o.x, o.z, oc) : hitsTower(p, d, o.x, o.z);
					});
					if (!blocked) lit++;
				}
			share[day] = lit / (path.length * probes.length);
		}
		sites[`${b.hex}/${b.id}`] = share;
	}
	/** @type {Record<string, { homes: Record<string, number> | null, domes: Record<string, number> | null }>} */
	const hexes = {};
	/** the share for a set of buildings, each by its weight */
	const mean = (/** @type {Placed[]} */ list, /** @type {(b: Placed) => number} */ w) => {
		const total = list.reduce((a, b) => a + w(b), 0);
		return total ? Object.fromEntries(Object.keys(DAYS).map((day) => [day, list.reduce((a, b) => a + w(b) * sites[`${b.hex}/${b.id}`][day], 0) / total])) : null;
	};
	for (const hex of new Set(placed.map((b) => b.hex))) {
		const here = placed.filter((b) => b.hex === hex && b.kind !== 'tower');
		hexes[hex] = {
			homes: mean(here.filter((b) => KINDS[b.kind].people), (b) => KINDS[b.kind].people),
			domes: mean(here.filter((b) => !KINDS[b.kind].people), () => 1)
		};
	}
	const dayHours = Object.fromEntries(Object.entries(PATHS).map(([k, p]) => [k, (p.length * STEP_MIN) / 60]));
	return { sites, hexes, dayHours };
}

/** every building of a set of hexes, placed @param {{ key: string, plan: import('./layout.js').HexPlan, x: number, z: number }[]} hexes @returns {Placed[]} */
export const placeAll = (hexes) => hexes.flatMap((h) => h.plan.sites.map((s) => ({ hex: h.key, id: s.id, kind: s.kind, x: s.x + h.x, z: s.z + h.z, factory: s.factory })));
