/*
 * THE BACKYARD'S BUILDINGS — the house on the courtyard's west side in apricot render, its ground floor an old
 * workshop's (the front door under its canopy, the steel window, the brown doors); the single-storey workshop built out
 * in front of its north end in saffron, its big steel window onto a studio; the neighbour's saffron wall and its
 * polycarbonate along the terrace; the boundary walls streaked green, the shed, the gate under its glass canopy with
 * the station clock; and the neighbours' houses over the walls. See ./layout.ts for where.
 */
import * as THREE from 'three';
import { type Builder, planeGeo, sized } from './kit';
import { ANNEX, BIG_WINDOW, DRIVE, NEIGHBOUR, GATE, HOUSE, HOUSE_AXES, HOUSE_GROUND, INSET, SHED, EAST_WALL, UPPER_WINDOW, SOUTH_WALL, type Rect } from './layout';
import { SIZE, curtainedGlass, grime, plaque, roofTiles, roughcast, stainedWall, weathered, windowBays } from './surfaces';
import { barnLamp, casementWindow, doorCanopy, entranceDoor, stationClock, steelWindow, workshopDoor } from '$lib/models/yard';
import { bistroChair } from '$lib/models/terrace';
import { canvasPrint } from '$lib/models/hallway';
import { edisonBulb } from '$lib/models/furniture';
import { bar, v3 } from '$lib/models/parts';
import { pine } from '$lib/models/textures';
import { stems } from '$lib/models/outdoor';

/** a render: the wall's colour, its tone weathered over metres, its coarse grain as a bump */
export const render = (color: string, bump = 1.6) =>
	new THREE.MeshStandardMaterial({ color, map: sized(weathered(), SIZE.tone), bumpMap: sized(roughcast(), SIZE.render), bumpScale: bump, roughness: 0.95 });

/**
 * A sheet of corrugated polycarbonate `w` × `h` in its own x, y (the corrugations running up y), 76 mm from crest to
 * crest: milky, the sky and what is behind it showing through, grime along its supports.
 */
export function corrugated(w: number, h: number, mat: THREE.Material): THREE.Mesh {
	const seg = Math.max(2, Math.round((w / 0.076) * 6));
	const g = planeGeo(w, h, seg, 1);
	const p = g.attributes.position!;
	for (let i = 0; i < p.count; i++) p.setZ(i, 0.009 * Math.sin((p.getX(i) / 0.076) * Math.PI * 2));
	g.computeVertexNormals();
	const m = new THREE.Mesh(g, mat);
	m.receiveShadow = true;
	return m;
}
/** the sheets' material: grimy along its supports (a roof), or clean (a wall) */
export const polycarbonate = (grimy = true) =>
	new THREE.MeshStandardMaterial({ color: '#eef2f0', ...(grimy ? { map: sized(grime(), 1.05) } : {}), roughness: 0.28, transparent: true, opacity: grimy ? 0.46 : 0.5, side: THREE.DoubleSide, depthWrite: false });

export type Lamp = { lights: { light: THREE.PointLight | THREE.SpotLight; share: number }[]; glass?: THREE.MeshStandardMaterial; glow: number };
export type Buildings = { solid: Rect[]; lamps: Lamp[]; polycarbonate: THREE.Material };

export function buildBuildings(b: Builder, scene: THREE.Scene): Buildings {
	const mat = {
		house: render('#f6c090'),
		plinth: render('#e9ab76', 0.9),
		annex: render('#f3a136'),
		annexPlinth: render('#df8d2a', 0.9),
		surround: new THREE.MeshStandardMaterial({ color: '#a9a8a2', roughness: 0.85, bumpMap: sized(roughcast(), 0.25), bumpScale: 0.5 }),
		sill: new THREE.MeshStandardMaterial({ color: '#9c9b95', roughness: 0.6 }),
		gutter: new THREE.MeshStandardMaterial({ color: '#5b3b2c', roughness: 0.38, metalness: 0.35, side: THREE.DoubleSide }),
		roof: (() => {
			const t = sized(roofTiles(), SIZE.tiles);
			t.rotation = Math.PI / 2; // the courses along the ridge
			return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
		})(),
		boundary: new THREE.MeshStandardMaterial({ map: sized(stainedWall(), [SIZE.stains, 3]), color: '#f1e8d6', bumpMap: sized(roughcast(), SIZE.render), bumpScale: 1.2, roughness: 0.95 }),
		coping: new THREE.MeshStandardMaterial({ color: '#b8b2a6', roughness: 0.8 }),
		shed: render('#f4ddb0'),
		dark: new THREE.MeshStandardMaterial({ color: '#45403b', roughness: 0.85 }),
		white: new THREE.MeshStandardMaterial({ color: '#f2f0ea', roughness: 0.9 }),
		floor: new THREE.MeshStandardMaterial({ color: '#9b9893', roughness: 0.7 }),
		steel: new THREE.MeshStandardMaterial({ color: '#8f8d88', roughness: 0.55, metalness: 0.25 }),
		galv: new THREE.MeshStandardMaterial({ color: '#b3b4b1', roughness: 0.45, metalness: 0.5 }),
		frame: new THREE.MeshStandardMaterial({ color: '#e7e5df', roughness: 0.6 }),
		ledge: new THREE.MeshStandardMaterial({ color: '#d6d3cb', roughness: 0.7 }),
		glass: new THREE.MeshPhysicalMaterial({ color: '#e9f0f2', roughness: 0.04, transparent: true, opacity: 0.18, depthWrite: false }),
		tube: new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.5 }),
		oak: (() => {
			const t = pine().clone();
			t.needsUpdate = true;
			return new THREE.MeshStandardMaterial({ map: t, color: '#efd2a8', roughness: 0.6 });
		})(),
		curtained: new THREE.MeshStandardMaterial({ map: curtainedGlass(), roughness: 0.14, metalness: 0.15 }),
		// a window lit at night: its curtains glowing from the room behind them
		lit: new THREE.MeshStandardMaterial({ map: curtainedGlass(), roughness: 0.14, metalness: 0.15, emissive: '#ffc982', emissiveMap: curtainedGlass(), emissiveIntensity: 0 }),
		street: new THREE.MeshBasicMaterial({ color: '#c9cfd2' }),
		sign: new THREE.MeshStandardMaterial({ map: plaque(), roughness: 0.4 })
	};
	const poly = polycarbonate(false);
	const solid: Rect[] = [];
	const lamps: Lamp[] = [];

	/* ── the house ─────────────────────────────────────────────────────────── */
	const H = HOUSE, W = H.x1 - H.x0, top = H.eaves, ox = -H.x0;
	const g = HOUSE_GROUND;
	const sw = g.smallWindow, fd = g.frontDoor, stw = g.steelWindow, wd = g.workshopDoor;
	const STEP = 0.1; // the front door's stone step
	const holes: [number, number, number, number][] = [
		[sw.x0 + ox, sw.x1 + ox, sw.sill, sw.top],
		[fd.x0 - 0.08 + ox, fd.x1 + 0.08 + ox, 0, STEP + fd.top],
		[stw.x0 + ox, stw.x1 + ox, stw.sill, stw.top],
		[wd.x0 - 0.07 + ox, wd.x1 + 0.07 + ox, 0, wd.top]
	];
	const floorAt = [H.floors[0], H.floors[0] + H.floors[1]];
	for (const ax of HOUSE_AXES) for (const f of floorAt) holes.push([ax - UPPER_WINDOW.w / 2 + ox, ax + UPPER_WINDOW.w / 2 + ox, f + UPPER_WINDOW.sill, f + UPPER_WINDOW.sill + UPPER_WINDOW.h]);
	// its face: an L, cut away low at its north end where the workshop is built against it
	const notch = ANNEX.x0 + ox;
	const face = b.wall(W, top, 0.45, holes, mat.house, [[0, 0], [notch, 0], [notch, ANNEX.h], [W, ANNEX.h], [W, top], [0, top]]);
	face.position.set(H.x0, 0, H.z);
	// its body behind its face: the ground floor's north end is the workshop's
	b.span(H.x0, ANNEX.x0, 0, top, H.back, H.z - 0.45, mat.house);
	b.span(ANNEX.x0, H.x1, ANNEX.h, top, H.back, H.z - 0.45, mat.house);
	b.span(ANNEX.x0, H.x1, 0, ANNEX.h, H.back, ANNEX.back, mat.house);
	// the plinth, the eaves' cornice, the gutter and its pipes down the face
	for (const [x0, x1] of [[H.x0, fd.x0 - 0.08], [fd.x1 + 0.08, wd.x0 - 0.07], [wd.x1 + 0.07, ANNEX.x0]] as const) b.span(x0, x1, 0, 0.45, H.z, H.z + 0.025, mat.plinth);
	b.span(H.x0, H.x1, top - 0.22, top, H.z, H.z + 0.26, mat.surround);
	const gutter = (x0: number, x1: number, y: number, z: number, r = 0.075) => {
		const gg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, x1 - x0, 14, 1, true, Math.PI, Math.PI), mat.gutter);
		gg.rotation.z = Math.PI / 2;
		gg.position.set((x0 + x1) / 2, y, z);
		gg.castShadow = true;
		b.group.add(gg);
	};
	gutter(H.x0, H.x1, top + 0.04, H.z + 0.34);
	const pipe = (from: THREE.Vector3, to: THREE.Vector3, r = 0.045) => bar(b.group, from, to, r, mat.gutter);
	for (const x of [H.x0 + 0.25, -2.72]) {
		pipe(v3(x, top + 0.02, H.z + 0.34), v3(x, top - 0.25, H.z + 0.08));
		pipe(v3(x, top - 0.25, H.z + 0.08), v3(x, 0.12, H.z + 0.08));
		pipe(v3(x, 0.12, H.z + 0.08), v3(x, 0.02, H.z + 0.22));
	}
	// the roof: tiles up to the ridge and down behind, the gable ends in render; three dormers on its front
	const eave = H.z + 0.35, ridgeZ = (eave + H.back - 0.35) / 2;
	b.prism([[eave, top], [ridgeZ, H.ridge], [H.back - 0.35, top]], H.x0, H.x1, [mat.house, mat.roof]);
	const slopeY = (z: number) => top + ((H.ridge - top) * (eave - z)) / (eave - ridgeZ);
	for (const dx of [-12.6, -8.6, -4.6]) {
		const fz = -2.55, base = slopeY(fz) - 0.5, wDormer = 1.5;
		const df = b.wall(wDormer, 1.55, 0.12, [[0.3, 1.2, 0.35, 1.35]], mat.house);
		df.position.set(dx - wDormer / 2, base, fz);
		b.span(dx - wDormer / 2, dx - wDormer / 2 + 0.12, base, base + 1.55, fz - 2.2, fz - 0.12, mat.house);
		b.span(dx + wDormer / 2 - 0.12, dx + wDormer / 2, base, base + 1.55, fz - 2.2, fz - 0.12, mat.house);
		// its roof, one slope from over its window back up into the house's roof
		const dr = b.box(wDormer + 0.24, 0.07, 2.7, mat.roof, dx, base + 1.82, fz - 1.1);
		dr.rotation.x = -Math.atan2(0.55, 2.6);
		b.place(casementWindow({ w: 0.9, h: 1.0, light: 0.26 }), dx, fz - 0.06, 0, base + 0.35);
	}
	// the windows of the upper floors in their reveals, grey surrounds, stone sills; some lit at night
	let k = 0;
	for (const ax of HOUSE_AXES)
		for (const f of floorAt) {
			const sill = f + UPPER_WINDOW.sill, wh = UPPER_WINDOW.h, ww = UPPER_WINDOW.w;
			const n = k++, lit = [2, 5, 8].includes(n);
			b.place(casementWindow({ w: ww, h: wh, glass: lit ? mat.lit : n % 3 === 0 ? mat.curtained : undefined }), ax, H.z - 0.14, 0, sill);
			b.span(ax - ww / 2 - 0.14, ax + ww / 2 + 0.14, sill + wh, sill + wh + 0.14, H.z, H.z + 0.03, mat.surround);
			b.span(ax - ww / 2 - 0.14, ax - ww / 2, sill, sill + wh, H.z, H.z + 0.03, mat.surround);
			b.span(ax + ww / 2, ax + ww / 2 + 0.14, sill, sill + wh, H.z, H.z + 0.03, mat.surround);
			b.span(ax - ww / 2 - 0.08, ax + ww / 2 + 0.08, sill - 0.05, sill, H.z - 0.14, H.z + 0.1, mat.sill);
		}
	// the ground floor: the small window, the front door on its step under the canopy and the lamp, the steel window,
	// the workshop's door on its plate of steel
	const surround = (x0: number, x1: number, y0: number, y1: number, sill: boolean) => {
		b.span(x0 - 0.15, x1 + 0.15, y1, y1 + 0.15, H.z, H.z + 0.03, mat.surround);
		b.span(x0 - 0.15, x0, y0, y1, H.z, H.z + 0.03, mat.surround);
		b.span(x1, x1 + 0.15, y0, y1, H.z, H.z + 0.03, mat.surround);
		if (sill) b.span(x0 - 0.06, x1 + 0.06, y0 - 0.05, y0, H.z - 0.15, H.z + 0.22, mat.sill);
	};
	b.place(steelWindow({ w: sw.x1 - sw.x0, h: sw.top - sw.sill, cols: 4, rows: 6, color: '#e6e3dc', frosted: 0.04, seed: 8 }), (sw.x0 + sw.x1) / 2, H.z - 0.15, 0, sw.sill);
	surround(sw.x0, sw.x1, sw.sill, sw.top, true);
	b.span(fd.x0 - 0.2, fd.x1 + 0.2, 0, STEP, H.z - 0.3, H.z + 0.3, mat.sill);
	b.place(entranceDoor(), (fd.x0 + fd.x1) / 2, H.z - 0.22, 0, STEP);
	surround(fd.x0 - 0.08, fd.x1 + 0.08, 0, STEP + fd.top, false);
	b.place(doorCanopy({ w: 1.8, d: 0.95 }), (fd.x0 + fd.x1) / 2, H.z, 0, STEP + fd.top + 0.22);
	const lamp = b.place(barnLamp(), fd.x1 - 0.2, H.z, 0, STEP + fd.top + 0.08);
	b.box(0.07, 0.1, 0.05, mat.white, fd.x1 + 0.35, 2.45, H.z + 0.025); // the motion sensor
	b.box(0.09, 0.24, 0.015, mat.galv, fd.x1 + 0.3, 1.32, H.z + 0.008); // the bell plate, its buttons
	for (let i = 0; i < 4; i++) b.box(0.025, 0.025, 0.012, mat.tube, fd.x1 + 0.3, 1.23 + i * 0.055, H.z + 0.02);
	b.box(0.16, 0.21, 0.002, mat.white, (fd.x0 + fd.x1) / 2 + 0.33, 1.62, H.z - 0.2); // a note taped inside the glass
	b.place(steelWindow({ w: stw.x1 - stw.x0, h: stw.top - stw.sill, cols: 6, rows: 7, color: '#3c2a23', frosted: 0.1, seed: 2 }), (stw.x0 + stw.x1) / 2, H.z - 0.15, 0, stw.sill);
	surround(stw.x0, stw.x1, stw.sill, stw.top, true);
	b.place(workshopDoor(), (wd.x0 + wd.x1) / 2, H.z - 0.12, 0, 0);
	surround(wd.x0 - 0.07, wd.x1 + 0.07, 0, wd.top, false);
	// the entrance's lamp: down from its shade
	const entrance = new THREE.SpotLight('#ffcf94', 0, 9, 1.0, 0.8, 2);
	entrance.position.copy(lamp.position).add(lamp.userData.light as THREE.Vector3);
	entrance.target.position.copy(entrance.position).add(v3(0, -2, 1.2));
	scene.add(entrance, entrance.target);
	lamps.push({ lights: [{ light: entrance, share: 3.2 }], glass: lamp.userData.glass as THREE.MeshStandardMaterial, glow: 1.4 });
	lamps.push({ lights: [], glass: mat.lit, glow: 0.9 });
	solid.push([H.x0, ANNEX.x0, H.back, H.z + 0.05], [fd.x0 - 0.2, fd.x1 + 0.2, H.z, H.z + 0.3]);

	/* ── the workshop (the annex) ──────────────────────────────────────────── */
	const A = ANNEX, B = BIG_WINDOW, aw = A.x1 - A.x0;
	const front = b.wall(aw, A.h, A.wall, [[B.x0 - A.x0, B.x1 - A.x0, B.sill, B.top]], mat.annex);
	front.position.set(A.x0, 0, A.z);
	const inX0 = A.x0 + A.wall, inX1 = A.x1 - A.wall, inZ0 = A.back + A.wall, inZ1 = A.z - A.wall, ceil = A.h - 0.15;
	b.span(A.x0, inX0, 0, A.h, H.z, inZ1, mat.annex); // its south end, against the house
	b.span(A.x0, inX0, 0, ceil, A.back, H.z, mat.white);
	b.span(inX1, A.x1, 0, A.h, A.back, inZ1, mat.annex);
	b.span(inX0, inX1, 0, ceil, A.back, inZ0, mat.white);
	b.plane(inZ1 - H.z, ceil, mat.white, inX0 + 0.002, ceil / 2, (H.z + inZ1) / 2, Math.PI / 2);
	b.plane(inZ1 - inZ0, ceil, mat.white, inX1 - 0.002, ceil / 2, (inZ0 + inZ1) / 2, -Math.PI / 2);
	// its roof, flat, a skylight over the studio
	const sky = { x0: -1.0, x1: 1.9, z0: -5.6, z1: -1.8 };
	for (const [x0, x1, z0, z1] of [[A.x0, A.x1, A.back, sky.z0], [A.x0, A.x1, sky.z1, A.z], [A.x0, sky.x0, sky.z0, sky.z1], [sky.x1, A.x1, sky.z0, sky.z1]] as const) b.span(x0, x1, ceil, A.h, z0, z1, mat.white);
	b.span(sky.x0, sky.x1, A.h, A.h + 0.22, sky.z0, sky.z0 + 0.08, mat.steel);
	b.span(sky.x0, sky.x1, A.h, A.h + 0.22, sky.z1 - 0.08, sky.z1, mat.steel);
	for (let i = 0; i <= 4; i++) b.span(sky.x0 + i * ((sky.x1 - sky.x0 - 0.06) / 4), sky.x0 + i * ((sky.x1 - sky.x0 - 0.06) / 4) + 0.06, A.h + 0.1, A.h + 0.22, sky.z0, sky.z1, mat.steel);
	b.plane(sky.x1 - sky.x0, sky.z1 - sky.z0, mat.glass, (sky.x0 + sky.x1) / 2, A.h + 0.2, (sky.z0 + sky.z1) / 2, 0, true).castShadow = false;
	// its cornice and the black tubes under its lip, its plinth, the window's surround and stone sill, the window
	b.span(A.x0 - 0.1, A.x1 + 0.1, A.h - 0.24, A.h, A.z - 0.05, A.z + 0.1, mat.annex);
	for (let i = 0; i < 11; i++) {
		const t = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.14, 10).rotateX(Math.PI / 2), mat.tube);
		t.position.set(A.x0 + 0.35 + i * ((aw - 0.7) / 10), A.h - 0.18, A.z + 0.13);
		b.group.add(t);
	}
	b.span(A.x0, A.x1, 0, 0.32, A.z, A.z + 0.02, mat.annexPlinth);
	b.span(B.x0 - 0.15, B.x1 + 0.15, B.top, B.top + 0.15, A.z, A.z + 0.025, mat.surround);
	b.span(B.x0 - 0.15, B.x0, B.sill, B.top, A.z, A.z + 0.025, mat.surround);
	b.span(B.x1, B.x1 + 0.15, B.sill, B.top, A.z, A.z + 0.025, mat.surround);
	b.span(B.x0 - 0.18, B.x1 + 0.18, B.sill - 0.06, B.sill, A.z - 0.12, A.z + 0.13, mat.sill);
	b.place(steelWindow({ w: B.x1 - B.x0, h: B.top - B.sill, cols: B.cols, rows: B.rows, color: '#4b2923', frosted: 0.07, glass: 'clear', seed: 5 }), (B.x0 + B.x1) / 2, A.z - 0.13, 0, B.sill);
	// the studio behind it: a concrete floor, a long table and its benches, chairs, a radiator, prints on the wall, bulbs
	b.plane(inX1 - inX0, inZ1 - inZ0, mat.floor, (inX0 + inX1) / 2, 0.004, (inZ0 + inZ1) / 2, 0, true);
	b.span(-1.3, 1.7, 0.73, 0.77, -3.75, -2.85, mat.oak);
	for (const x of [-1.05, 1.45]) {
		b.span(x - 0.04, x + 0.04, 0, 0.73, -3.7, -2.9, mat.oak);
		b.span(x - 0.04, x + 0.04, 0.12, 0.18, -3.7, -2.9, mat.oak);
	}
	for (const z of [-4.2, -2.4]) b.span(-1.1, 1.5, 0.43, 0.47, z - 0.15, z + 0.15, mat.oak);
	for (const z of [-4.2, -2.4]) for (const x of [-0.95, 1.35]) b.span(x - 0.03, x + 0.03, 0, 0.43, z - 0.12, z + 0.12, mat.oak);
	for (const [x, z, r] of [[2.3, -1.4, 2.4], [2.4, -2.4, 1.9], [-1.7, -1.5, -2.2]] as const) b.place(bistroChair(), x, z, r);
	b.span(-1.5, 1.8, 0.2, 0.75, inZ1 - 0.12, inZ1 - 0.05, mat.white);
	for (const [x, w, h] of [[-1.2, 0.6, 0.8], [-0.2, 0.9, 0.6], [0.9, 0.5, 0.7], [1.8, 0.7, 0.5]] as const) b.place(canvasPrint({ w, h }), x, inZ0 + 0.02, 0, 1.5);
	b.span(inX1 - 0.4, inX1, 0, 2.0, -6.4, -4.4, mat.oak);
	const bulbs: THREE.MeshStandardMaterial[] = [];
	const studio: { light: THREE.PointLight; share: number }[] = [];
	for (const x of [-0.6, 0.2, 1.0]) {
		const bulb = b.place(edisonBulb({ drop: 1.3 }), x, -3.3, 0, ceil);
		bulbs.push(bulb.userData.glass as THREE.MeshStandardMaterial);
	}
	for (const z of [-3.3, -5.6]) {
		const l = new THREE.PointLight('#ffb867', 0, 7, 2);
		l.position.set(0.3, 1.9, z);
		scene.add(l);
		studio.push({ light: l, share: 1.6 });
	}
	lamps.push({ lights: studio, glass: bulbs[0], glow: 0.7 });
	solid.push([A.x0, A.x1, A.back, A.z]);

	/* ── the neighbour's wall along the terrace: saffron, a ledge, polycarbonate over it ─────────────────────── */
	const E = NEIGHBOUR, I = INSET;
	b.span(I.x0, E.x + 0.3, 0, E.low, I.z0 - 0.3, I.z0, mat.annex);
	b.span(E.x, E.x + 0.3, 0, E.low, I.z0 - 0.3, E.z1, mat.annex);
	b.span(I.x0, E.x + 0.34, E.low, E.low + 0.06, I.z0 - 0.34, I.z0 + 0.04, mat.coping);
	b.span(E.x - 0.04, E.x + 0.34, E.low, E.low + 0.06, I.z0 - 0.34, E.z1 + 0.04, mat.coping);
	b.span(I.x0, E.x + 0.05, E.low + 0.06, E.low + 0.12, I.z0 - 0.15, I.z0 + 0.03, mat.ledge);
	b.span(E.x - 0.03, E.x + 0.15, E.low + 0.06, E.low + 0.12, I.z0 - 0.15, E.z1, mat.ledge);
	// a raised panel in the low wall behind the bistro table
	for (const [x0, x1, y0, y1] of [[3.55, 5.1, 0.35, 0.39], [3.55, 5.1, 1.41, 1.45], [3.55, 3.59, 0.35, 1.45], [5.06, 5.1, 0.35, 1.45]] as const) b.span(x0, x1, y0, y1, I.z0, I.z0 + 0.03, mat.annex);
	const ph = E.high - E.low - 0.12;
	const back = corrugated(E.x - I.x0 + 0.1, ph, poly);
	back.position.set((I.x0 + E.x + 0.1) / 2, E.low + 0.12 + ph / 2, I.z0 - 0.1);
	b.group.add(back);
	const side = corrugated(E.z1 - I.z0 + 0.1, ph, poly);
	side.rotation.y = -Math.PI / 2;
	side.position.set(E.x + 0.1, E.low + 0.12 + ph / 2, (I.z0 + E.z1) / 2 - 0.05);
	b.group.add(side);
	for (const x of [I.x0 + 0.03, 4.3, E.x + 0.02]) b.span(x - 0.03, x + 0.03, E.low + 0.12, E.high, I.z0 - 0.14, I.z0 - 0.05, mat.frame);
	for (const z of [I.z0 - 0.1, -0.3, 0.8, 1.9, 3.0, 4.1, E.z1 - 0.03]) b.span(E.x + 0.05, E.x + 0.14, E.low + 0.12, E.high, z - 0.03, z + 0.03, mat.frame);
	b.span(I.x0, E.x + 0.14, E.high - 0.06, E.high, I.z0 - 0.14, I.z0 - 0.05, mat.frame);
	b.span(E.x + 0.05, E.x + 0.14, E.high - 0.06, E.high, I.z0 - 0.14, E.z1, mat.frame);
	for (const [z0, z1] of [[-0.3, 0.8], [1.9, 3.0]] as const) {
		const len = Math.hypot(z1 - z0, ph);
		const d = b.box(0.05, len, 0.05, mat.frame, E.x + 0.1, E.low + 0.12 + ph / 2, (z0 + z1) / 2);
		d.rotation.x = Math.atan2(z1 - z0, ph);
	}
	// behind it, the neighbour's covered yard, light through its own roof of the same sheets; vines pressed against them
	const yard = new THREE.MeshStandardMaterial({ color: '#d9d4c9', roughness: 0.9 });
	b.span(E.x + 0.3, E.x + 4.5, 0, 0.02, I.z0 - 0.3, E.z1, yard);
	b.span(E.x + 4.2, E.x + 4.5, 0, E.high, I.z0 - 3, E.z1, yard);
	b.span(I.x0 - 0.5, E.x + 4.5, 0, E.high, I.z0 - 3.0, I.z0 - 2.7, yard);
	const vines: [THREE.Vector3, THREE.Vector3][] = [];
	for (let i = 0; i < 9; i++) vines.push([v3(E.x + 0.25, E.low + 0.15, -0.9 + i * 0.62), v3(E.x + 0.22, E.high - 0.1, -1.0 + i * 0.6 + 0.3)]);
	for (let i = 0; i < 4; i++) vines.push([v3(3.5 + i * 0.5, E.low + 0.15, I.z0 - 0.25), v3(3.7 + i * 0.5, E.high - 0.15, I.z0 - 0.22)]);
	b.group.add(stems(vines, { card: 0.2, per: 9, tint: '#9bb37a', seed: 31, spread: 0.12, face: v3(-1, 0, 0) }));
	// its roof, the same sheets, flat over it
	const lid = corrugated(4.4, E.z1 - I.z0 + 3, poly);
	lid.rotation.x = -Math.PI / 2;
	lid.position.set(E.x + 2.3, E.high + 0.02, (I.z0 - 3 + E.z1) / 2);
	b.group.add(lid);

	/* ── the boundary walls, the shed, the gate ────────────────────────────── */
	const wall = (x0: number, x1: number, z0: number, z1: number, h = 3.0) => {
		b.span(x0, x1, 0, h, z0, z1, mat.boundary);
		b.span(x0 - 0.04, x1 + 0.04, h, h + 0.06, z0 - 0.04, z1 + 0.04, mat.coping);
	};
	wall(SOUTH_WALL.x - 0.3, SOUTH_WALL.x, SOUTH_WALL.z0, SOUTH_WALL.z1);
	wall(EAST_WALL.x0, EAST_WALL.x1 + 0.3, EAST_WALL.z, EAST_WALL.z + 0.3);
	wall(E.x, E.x + 0.3, E.z1, EAST_WALL.z);
	wall(DRIVE.x0 - 0.3, DRIVE.x0, SHED.z1, DRIVE.z1, 2.6);
	solid.push([SOUTH_WALL.x - 0.3, SOUTH_WALL.x, SOUTH_WALL.z0, SOUTH_WALL.z1], [EAST_WALL.x0, EAST_WALL.x1, EAST_WALL.z, EAST_WALL.z + 0.3], [E.x, E.x + 0.3, I.z0 - 0.3, EAST_WALL.z]);
	// the shed: render over a mono-pitch roof, its gutter along the courtyard, two pipes down
	const S = SHED;
	b.span(S.x0, S.x1, 0, S.eaves, S.z0, S.z1, mat.shed);
	b.prism([[S.z0, S.eaves], [S.z1, S.eaves], [S.z1, S.top]], S.x0, S.x1, mat.shed);
	const roof = b.box(S.x1 - S.x0 + 0.3, 0.08, Math.hypot(S.z1 - S.z0, S.top - S.eaves) + 0.4, mat.dark, (S.x0 + S.x1) / 2, (S.eaves + S.top) / 2 + 0.05, (S.z0 + S.z1) / 2);
	roof.rotation.x = -Math.atan2(S.top - S.eaves, S.z1 - S.z0);
	gutter(S.x0 - 0.15, S.x1 + 0.15, S.eaves - 0.02, S.z0 - 0.22, 0.06);
	for (const [x, to] of [[-11.55, 1.05], [-6.55, 0.08]] as const) {
		pipe(v3(x, S.eaves - 0.04, S.z0 - 0.22), v3(x, S.eaves - 0.3, S.z0 - 0.06), 0.04);
		pipe(v3(x, S.eaves - 0.3, S.z0 - 0.06), v3(x, to, S.z0 - 0.06), 0.04);
	}
	solid.push([S.x0, S.x1, S.z0, S.z1]);
	// the gate: a low wall, the steel gate in it and its padlocks; the glass canopy over it on four posts, the clock
	const G = GATE;
	b.span(G.x0, -14.75, 0, 1.05, G.z - 0.05, G.z + 0.2, mat.boundary);
	b.span(-13.85, G.x1, 0, 1.05, G.z - 0.05, G.z + 0.2, mat.boundary);
	b.span(G.x0, G.x1, 1.05, 1.11, G.z - 0.08, G.z + 0.23, mat.coping);
	b.span(-14.72, -13.88, 0.04, 0.08, G.z + 0.05, G.z + 0.09, mat.galv);
	b.span(-14.72, -13.88, 0.96, 1.0, G.z + 0.05, G.z + 0.09, mat.galv);
	for (let i = 0; i <= 8; i++) b.span(-14.72 + i * 0.1, -14.7 + i * 0.1, 0.04, 1.0, G.z + 0.06, G.z + 0.08, mat.galv);
	for (const y of [0.72, 0.86]) b.box(0.05, 0.07, 0.03, mat.dark, -13.95, y, G.z + 0.12);
	for (const [x, z] of [[G.x1 - 0.04, G.canopy], [G.x0 + 0.04, G.canopy], [G.x1 - 0.04, G.z - 0.08], [G.x0 + 0.04, G.z - 0.08]] as const) b.span(x - 0.03, x + 0.03, 0, 2.6, z - 0.03, z + 0.03, mat.galv);
	b.span(G.x0, G.x1, 2.55, 2.62, G.canopy - 0.03, G.canopy + 0.03, mat.galv);
	b.span(G.x0, G.x1, 2.66, 2.72, G.z - 0.11, G.z - 0.05, mat.galv);
	const cr = b.box(G.x1 - G.x0, 0.012, G.z - G.canopy, mat.glass, (G.x0 + G.x1) / 2, 2.66, (G.canopy + G.z) / 2 - 0.04, 0, false);
	cr.rotation.x = -Math.atan2(0.1, G.z - G.canopy);
	for (const x of [G.x0 + 0.5, G.x0 + 1.0, G.x0 + 1.5]) b.span(x - 0.02, x + 0.02, 2.6, 2.68, G.canopy, G.z - 0.08, mat.galv);
	b.place(stationClock({ reach: 0.3 }), G.x1 - 0.04, G.canopy - 0.03, Math.PI, 2.42);
	// the oval plaque on the canopy's back post, facing the courtyard
	const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 32).rotateX(Math.PI / 2), mat.sign);
	sign.scale.set(1.25, 0.8, 1);
	sign.position.set(G.x1 - 0.42, 1.62, G.z - 0.12);
	b.group.add(sign);
	solid.push([G.x0, G.x1, G.z - 0.1, G.z + 0.25]);

	/* ── the neighbours' houses over the walls, and the passage out under the front house ──────────────────── */
	const bays = (color: string) => new THREE.MeshStandardMaterial({ map: sized(windowBays(), 3), color, roughness: 0.92 });
	const cream = bays('#ece3d0'), white = bays('#f2ede3'), sand = bays('#e6dfcf');
	b.span(-36, -24, 0, 17.2, -15, 14, cream);
	// their balconies: a slab, a railing of steel bars
	for (const y of [3, 6, 9, 12])
		for (const z of [-7.5, -1.5, 4.5, 10.5]) {
			b.span(-24, -22.7, y - 0.16, y, z - 1.5, z + 1.5, mat.coping);
			for (const ry of [y + 0.12, y + 0.98]) b.span(-22.76, -22.7, ry - 0.03, ry, z - 1.5, z + 1.5, mat.galv);
			for (let i = 0; i <= 15; i++) b.span(-22.75, -22.72, y, y + 0.96, z - 1.5 + i * 0.2 - 0.01, z - 1.5 + i * 0.2 + 0.01, mat.galv);
			for (const zz of [z - 1.5, z + 1.5]) b.span(-24, -22.7, y + 0.95, y + 0.98, zz - 0.015, zz + 0.015, mat.galv);
		}
	b.span(-31, DRIVE.x0, 0, 18, DRIVE.z1, 31, white);
	b.span(DRIVE.x1, 22, 0, 18, DRIVE.z1, 31, white);
	b.span(DRIVE.x0, DRIVE.x1, 3.6, 18, DRIVE.z1, 31, white);
	b.span(DRIVE.x0, DRIVE.x0 + 0.05, 0, 3.6, DRIVE.z1, 30.5, mat.dark);
	b.span(DRIVE.x1 - 0.05, DRIVE.x1, 0, 3.6, DRIVE.z1, 30.5, mat.dark);
	b.span(DRIVE.x0, DRIVE.x1, 3.55, 3.6, DRIVE.z1, 30.5, mat.dark);
	b.plane(DRIVE.x1 - DRIVE.x0, 3.6, mat.street, (DRIVE.x0 + DRIVE.x1) / 2, 1.8, 30.45, Math.PI);
	b.span(15, 28, 0, 10, -15, DRIVE.z1, sand);
	b.span(-0.6, 9.5, 0, 7.5, -17, -9, sand);
	return { solid, lamps, polycarbonate: poly };
}
