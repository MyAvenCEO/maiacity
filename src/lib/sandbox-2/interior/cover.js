/*
 * A FLOOR'S COVER, DRAWN BY THE RENDERER — a biome's cover ($lib/biomes) on a sandbox's floor, as the Biomes explorer
 * draws it: each kind built in the asset box at its seed (`biomes/cover@1:<kind>?seed=<n>`, $lib/biomes/built.js), and
 * every plant of it one more copy of that kind (./drawn.js), each at its finest shape however small, casting no shadow
 * (as the cover streamed on a sandbox's floor never has).
 *
 * Where the plants stand is the stream's ($lib/biomes/stream.js): laid out in tiles round the eye as it goes (`coverTile`,
 * each tile from its place alone, a tile or so a frame, the tiles left behind let go), all of it near the eye and less
 * and less further off, each plant growing up out of the ground as the eye comes and sinking back as it goes, by the
 * stream's own sums (`coverLaid`'s, for an eye that moves): worked out again whenever the eye has gone half a metre, a
 * tile came or a tile went.
 *
 * `createCover({ drawn, recipe, open, … })` → `{ update(x, z, budget), show(on), count(), dispose() }`: `update` with
 * where the eye is (in the floor's own ground) every frame.
 */
import * as THREE from 'three';
import { coverRef } from '$lib/biomes/built.js';
import { coverSeed } from '$lib/biomes/index.js';
import { coverTile } from '$lib/biomes/stream.js';

/** how far the eye goes before the cover is worked out again (m) */
const STEP = 0.5;

/**
 * @param {{
 *   drawn: { use: (ref: string, shadows?: boolean, picture?: boolean) => any, take: (k: any, at: THREE.Matrix4) => any, move: (c: any, at: THREE.Matrix4) => void, give: (c: any) => void },
 *   recipe: import('$lib/biomes/index.js').Recipe,
 *   open?: (x: number, z: number) => boolean,
 *   tile?: number, reach?: number, near?: number, thin?: number, perFrame?: number, seed?: number, density?: number,
 *   origin?: [number, number], at?: [number, number, number], hidden?: boolean
 * }} o
 *   the stream's options (`coverStream`), and: drawn, the renderer it is drawn by; at, where the floor's own ground lies
 *   in the world it draws (a dome's floor, off the village's middle); hidden, none of it drawn until it is shown
 */
export function createCover(o) {
	const tile = o.tile ?? 12, reach = o.reach ?? 30, perFrame = o.perFrame ?? 1, seed = o.seed ?? 1;
	const near = o.near ?? Math.min(10, reach * 0.4), thin = o.thin ?? 0.3;
	const [ox, oz] = o.origin ?? [0, 0];
	const [ax, ay, az] = o.at ?? [0, 0, 0];
	const { recipe, drawn } = o;
	/** how much of the cover stands at distance d: all of it near, `thin` of it at the reach (the stream's sum) */
	const keep = (/** @type {number} */ d) => (d <= near ? 1 : 1 - (1 - thin) * Math.min(1, (d - near) / Math.max(1e-3, reach - near)));
	const smooth = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ v) => {
		const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
		return t * t * (3 - 2 * t);
	};
	/** each kind of the cover, in its order: drawn finely however small, so never as a picture */
	const kinds = recipe.cover.map((c, i) => drawn.use(coverRef(c.kind, coverSeed(i, c.kind)), false, false));
	/** @type {Map<string, { ix: number, iz: number, kinds: import('$lib/biomes/stream.js').TileKinds }>} */
	const tiles = new Map();
	/** the copies of each kind standing now */
	const copies = kinds.map(() => /** @type {any[]} */ ([]));
	let gathered = { x: Infinity, z: Infinity }, changed = true, hidden = !!o.hidden;
	const m = new THREE.Matrix4();

	/** every plant of the tiles round x, z put down as far as it grows there; the copies over put away */
	const gather = (/** @type {number} */ x, /** @type {number} */ z) => {
		gathered = { x, z };
		changed = false;
		const counts = kinds.map(() => 0);
		if (!hidden)
			for (const t of tiles.values()) {
				// as many of the tile as the stream gathers (by its nearest point, a little nearer still)…
				const dx = Math.max(t.ix * tile - x, 0, x - (t.ix + 1) * tile), dz = Math.max(t.iz * tile - z, 0, z - (t.iz + 1) * tile);
				const td = Math.hypot(dx, dz) - 3;
				const kk = td > reach ? 0 : keep(Math.max(0, td));
				if (kk <= 0) continue;
				t.kinds.forEach(({ m: M, rank }, k) => {
					const list = /** @type {any[]} */ (copies[k]);
					for (let i = 0; i < rank.length && /** @type {number} */ (rank[i]) < kk + 0.02; i++) {
						// …each grown as far as the stream's shader grows it where it stands
						const px = /** @type {number} */ (M[i * 16 + 12]), pz = /** @type {number} */ (M[i * 16 + 14]);
						const d = Math.hypot(px - x, pz - z);
						const grow = Math.min(1, Math.max(0, (keep(d) - /** @type {number} */ (rank[i])) / 0.08)) * (1 - smooth(reach - 4, reach, d));
						if (!(grow > 0)) continue;
						m.fromArray(M, i * 16);
						const e = m.elements;
						for (let j = 0; j < 12; j++) if (j % 4 < 3) e[j] *= grow;
						e[12] += ax;
						e[13] += ay;
						e[14] += az;
						const n = counts[k]++;
						if (n < list.length) drawn.move(list[n], m);
						else list.push(drawn.take(kinds[k], m));
					}
				});
			}
		copies.forEach((list, k) => {
			while (list.length > /** @type {number} */ (counts[k])) drawn.give(list.pop());
		});
	};

	return {
		/** where the eye is: the tiles near it built (the nearest first, `budget` a frame), the far ones let go */
		update(/** @type {number} */ x, /** @type {number} */ z, budget = perFrame) {
			if (hidden) return;
			// built out past where the cover shows, so a tile is ready before it is seen
			const out = reach + tile * 0.75;
			const ix = Math.floor(x / tile), iz = Math.floor(z / tile), n = Math.ceil(out / tile);
			/** @type {[number, number, number][]} */
			const want = [];
			for (let dx = -n; dx <= n; dx++)
				for (let dz = -n; dz <= n; dz++) {
					const cx = (ix + dx + 0.5) * tile, cz = (iz + dz + 0.5) * tile;
					const d = Math.hypot(cx - x, cz - z) - tile * 0.71;
					if (d < out && !tiles.has(`${ix + dx},${iz + dz}`)) want.push([d, ix + dx, iz + dz]);
				}
			want.sort((a, b) => a[0] - b[0]);
			for (const [, tx, tz] of want.slice(0, budget)) {
				tiles.set(`${tx},${tz}`, { ix: tx, iz: tz, kinds: coverTile(recipe, tx, tz, { tile, seed, density: o.density, open: o.open, origin: [ox, oz] }) });
				changed = true;
			}
			for (const [key, t] of tiles) if (Math.hypot((t.ix + 0.5) * tile - x, (t.iz + 0.5) * tile - z) - tile * 0.71 > out + tile && tiles.delete(key)) changed = true;
			if (changed || Math.hypot(x - gathered.x, z - gathered.z) > STEP) gather(x, z);
		},
		/** none of it drawn (a dome's floor while its inside is not shown), or drawn again from the next update @param {boolean} on */
		show(on) {
			if (hidden === !on) return;
			hidden = !on;
			if (hidden) gather(gathered.x, gathered.z);
			changed = true;
		},
		/** how many plants of it stand now, for a look at its weight */
		count: () => copies.reduce((a, list) => a + list.length, 0),
		/** every copy handed back to the renderer's keeping */
		dispose() {
			hidden = true;
			gather(0, 0);
			tiles.clear();
		}
	};
}
/** @typedef {ReturnType<typeof createCover>} Cover */
