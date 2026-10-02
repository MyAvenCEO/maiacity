/*
 * THE ISAR'S MAP — everything the Isar world is built from, in the world's metres (scripts/worlds/isar-map.py makes it
 * from OpenStreetMap and the Bavarian survey's 1 m terrain model): the river and its gravel, the meadows, woods, paths
 * and benches, both bridges, the town round them, and the ground's heights on the world's grid (./ground.bin).
 *
 * The world's axes: x east, z south, y up, from a point on the river midway between the Wittelsbacherbrücke and the
 * railway bridge; y 0 is the water's surface there. The river's own frame: s along it, downstream (north-east, the
 * way it flows), n across it, towards the east bank. The Wittelsbacherbrücke crosses at s ≈ 340, the railway bridge
 * at s ≈ −340.
 */
import data from './map.json';
import groundUrl from './ground.bin?url';

/** a line or a ring: x0, z0, x1, z1, … */
export type Ring = number[];
export type PathKind = 'gravel' | 'asphalt' | 'dirt' | 'steps';
export type IsarMap = {
	source: string;
	origin: { e: number; n: number; zone: string; datum: number };
	frame: { u: [number, number]; v: [number, number] };
	river: { slope: number };
	grid: { s: number[]; n: number[] };
	water: Ring[];
	islands: Ring[];
	shingle: Ring[];
	grass: Ring[];
	wood: Ring[];
	scrub: Ring[];
	pitch: Ring[];
	paths: { k: PathKind; hw: string; w: number; b: number; pts: Ring }[];
	rail: Ring[];
	bridges: {
		wittelsbacher: { outline: Ring; road: Ring; statue: [number, number] | null; ends: [number, number] };
		braunauer: { outline: Ring; rails: Ring[]; ends?: [number, number] };
	};
	trees: [number, number][];
	treeRows: Ring[];
	benches: [number, number][];
	buildings: { pts: Ring; y: number; h: number; roof?: 'hipped' | 'gabled'; rh?: number; min?: number; glass?: number }[];
	landmarks: {
		chimneys: { at: [number, number]; r: number; h: number; y: number }[];
		tanks: { at: [number, number]; r: number; h: number; y: number }[];
		maximilian?: { pts: Ring; y: number };
		plant?: { pts: Ring; y: number; h: number }[];
	};
};

/** the map (its `source` names who made it: credit it wherever the world is shown) */
export const MAP = data as unknown as IsarMap;

const [ux, uz] = MAP.frame.u;
const [vx, vz] = MAP.frame.v;
/** along the river (downstream) and across it (towards the east bank), from x, z */
export const sOf = (x: number, z: number) => x * ux + z * uz;
export const nOf = (x: number, z: number) => x * vx + z * vz;
export const xOf = (s: number, n: number) => s * ux + n * vx;
export const zOf = (s: number, n: number) => s * uz + n * vz;
/** the way the river flows, and across it to the east bank, as world directions */
export const DOWNSTREAM = { x: ux, z: uz };
export const ACROSS = { x: vx, z: vz };
/** the river's surface at s: it falls about a metre between the bridges */
export const waterAt = (s: number) => MAP.river.slope * s;

/** the points of a ring, as pairs */
export function points(r: Ring): [number, number][] {
	const p: [number, number][] = [];
	for (let i = 0; i + 1 < r.length; i += 2) p.push([r[i]!, r[i + 1]!]);
	return p;
}

/** Whether a point lies in a ring (even–odd). */
export function inRing(r: Ring, x: number, z: number) {
	let inside = false;
	for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
		const xi = r[i]!, zi = r[i + 1]!, xj = r[j]!, zj = r[j + 1]!;
		if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
	}
	return inside;
}

/** The ground's heights on the grid, as the script wrote them (Int16, centimetres, s the fast axis). */
export async function loadHeights(): Promise<Float32Array> {
	const res = await fetch(groundUrl);
	if (!res.ok) throw new Error(`the ground's heights did not load (${res.status})`);
	const cm = new Int16Array(await res.arrayBuffer());
	const h = new Float32Array(cm.length);
	for (let i = 0; i < cm.length; i++) h[i] = cm[i]! / 100;
	return h;
}
