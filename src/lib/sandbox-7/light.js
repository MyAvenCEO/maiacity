/**
 * SANDBOX 6 · ONE VILLAGE · THE LIGHT — how much direct sun reaches each dome's south glass, so the living layouts can
 * be compared (Samuel, 2026-10-08: layout B puts the tall domes north and the low ones south "for better light").
 *
 * The sun is followed through two days at the village's latitude (Munich, 48.1° N): the winter solstice, when the sun
 * stands lowest (18.4° at noon) and shadows are longest, and the equinox. Every 10 minutes while the sun is over 2°, a
 * ray goes from three points on each dome's south glass (south-east, south and south-west, a third of the way up) toward
 * the sun; the point is in the sun unless another dome or the tower stands in the way. Trees, hedges and the hills
 * round the village are left out. Pure functions, in the browser or in node.
 */
import { capOf, KINDS, TOWER, capHeight, towerRadius } from './specs.js';

/** the village's latitude */
export const LATITUDE = 48.1;
/** the two days, by the sun's declination */
export const DAYS = { winter: { label: '21 December', decl: -23.44 }, equinox: { label: '21 March', decl: 0 } };
const DEG = Math.PI / 180;
const STEP_MIN = 10;

/** the sun's direction (x east, y up, z south) every 10 minutes of a day while it is over 2° @returns {number[][]} */
function sunPath(/** @type {number} */ decl) {
	const phi = LATITUDE * DEG, d = decl * DEG;
	/** @type {number[][]} */
	const out = [];
	for (let m = 0; m < 24 * 60; m += STEP_MIN) {
		const H = ((m / 60 - 12) * 15 + STEP_MIN / 8) * DEG;
		const el = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
		if (el < 2 * DEG) continue;
		// azimuth from north, clockwise
		const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) + Math.PI;
		out.push([Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)]);
	}
	return out;
}
const PATHS = Object.fromEntries(Object.entries(DAYS).map(([k, d]) => [k, sunPath(d.decl)]));

/**
 * @typedef {{ hex: string, id: string, kind: string, x: number, z: number }} Placed a building where it stands in the village
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
	const caps = placed.map((b) => (b.kind === 'tower' ? null : capOf(KINDS[b.kind].D)));
	/** @type {Record<string, Record<string, number>>} */
	const sites = {};
	for (let i = 0; i < placed.length; i++) {
		const b = placed[i], c = caps[i];
		if (!c) continue;
		// three points on the south glass a third of the way up, a little proud of it
		let r = c.a;
		while (r > 0 && capHeight(c, r) < c.h / 3) r -= 0.25;
		const probes = [150, 180, 210].map((deg) => [b.x + (r + 0.3) * Math.sin(deg * DEG), c.h / 3, b.z - (r + 0.3) * Math.cos(deg * DEG)]);
		// only what stands within reach of a 2° sun can shade it
		const near = placed.map((o, j) => j).filter((j) => j !== i && Math.hypot(placed[j].x - b.x, placed[j].z - b.z) < (caps[j] ? 1800 : 6000));
		/** @type {Record<string, number>} */
		const share = {};
		for (const [day, path] of Object.entries(PATHS)) {
			let lit = 0;
			for (const d of path)
				for (const p of probes) {
					const blocked = near.some((j) => {
						const o = placed[j], oc = caps[j];
						return oc ? hitsDome(p, d, o.x, o.z, oc) : hitsTower(p, d, o.x, o.z);
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
export const placeAll = (hexes) => hexes.flatMap((h) => h.plan.sites.map((s) => ({ hex: h.key, id: s.id, kind: s.kind, x: s.x + h.x, z: s.z + h.z })));
