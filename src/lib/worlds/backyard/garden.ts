/*
 * THE COURTYARD AND THE GARDEN — the ground and everything that grows or stands on it: grey pavers in a herringbone
 * from wall to wall and out along the driveway; the garden corner's pale gravel in its curb of granite setts, the teak
 * table and its five chairs on it; the beds of bark mulch along the walls with their hedges, rhododendrons, honeysuckle
 * and the ivy cone, the privet and the corkscrew willow by the west wall and the climber up it, the little maple by the
 * front door, the old lilac in front of the shed; the bike before the steel window, the letterbox, the window boxes,
 * pots; on the shed the insect hotel, two floodlights, the rain barrel under its pipe, the sapling in its pot; ivy over
 * the driveway's wall. See ./layout.ts for where.
 */
import * as THREE from 'three';
import { type Builder, sized } from './kit';
import { BEDS, COURT, DRIVE, GRAVEL, HOUSE, HOUSE_GROUND, SHED, SOUTH_WALL, TABLE, WEST_WALL, type Rect } from './layout';
import { SIZE, fallenLeaves, gravel, mulch, pavers, setts, treadPlate } from './surfaces';
import { seeded } from '$lib/models/outdoor';
import type { Obstacle } from './pergola';
import { ashtray, cityBike, floodlight, foldingChair, hedge, insectHotel, ivyCone, mailboxPost, rainBarrel, redTin, stonewareCrock, teakRecliner, teakTable, windowBox } from '$lib/models/yard';
import { terracottaPot } from '$lib/models/terrace';
import { bush, stems, tree } from '$lib/models/outdoor';
import { bar, v3 } from '$lib/models/parts';

export type Garden = { solid: Rect[]; round: Obstacle[]; sets: Record<string, [number, number, number, number]> };

export function buildGarden(b: Builder): Garden {
	const mat = {
		pavers: new THREE.MeshStandardMaterial({ map: sized(pavers(), SIZE.pavers), bumpMap: sized(pavers(), SIZE.pavers), bumpScale: 1.4, roughness: 0.9, color: '#f6efe4' }),
		gravel: new THREE.MeshStandardMaterial({ map: sized(gravel(), SIZE.gravel), bumpMap: sized(gravel(), SIZE.gravel), bumpScale: 1.6, roughness: 1 }),
		mulch: new THREE.MeshStandardMaterial({ map: sized(mulch(), SIZE.mulch), roughness: 1 }),
		setts: new THREE.MeshStandardMaterial({ map: sized(setts(), [SIZE.setts, 0.1]), roughness: 0.75 }),
		plate: new THREE.MeshStandardMaterial({ map: sized(treadPlate(), SIZE.plate), bumpMap: sized(treadPlate(), SIZE.plate), bumpScale: 1.2, roughness: 0.55, metalness: 0.25 }),
		ground: new THREE.MeshStandardMaterial({ color: '#77746d', roughness: 1 }),
		grate: new THREE.MeshStandardMaterial({ color: '#3a3b3c', roughness: 0.55, metalness: 0.6 }),
		coir: new THREE.MeshStandardMaterial({ color: '#9c7445', roughness: 1 }),
		rubber: new THREE.MeshStandardMaterial({ color: '#1d1d1d', roughness: 0.9 }),
		copper: new THREE.MeshStandardMaterial({ color: '#5d8c78', roughness: 0.5, metalness: 0.4 }),
		iron: new THREE.MeshStandardMaterial({ color: '#2e2d2b', roughness: 0.6, metalness: 0.5 }),
		pebble: new THREE.MeshStandardMaterial({ color: '#efede6', roughness: 0.6 }),
		label: new THREE.MeshStandardMaterial({ color: '#f0c419', roughness: 0.5 }),
		blue: new THREE.MeshStandardMaterial({ color: '#2b5aa8', roughness: 0.35 }),
		tub: new THREE.MeshStandardMaterial({ color: '#1c1c1c', roughness: 0.7 })
	};
	const solid: Rect[] = [];
	const round: Obstacle[] = [];

	/* ── the ground ────────────────────────────────────────────────────────── */
	b.plane(140, 140, mat.ground, 0, -0.02, 0, 0, true);
	const [cx0, cx1, cz0, cz1] = COURT;
	b.plane(cx1 - cx0, cz1 - cz0 + 0.4, mat.pavers, (cx0 + cx1) / 2, 0, (cz0 + cz1) / 2 + 0.2, 0, true);
	b.plane(DRIVE.x1 - DRIVE.x0, 30.5 - DRIVE.z0, mat.pavers, (DRIVE.x0 + DRIVE.x1) / 2, 0, (DRIVE.z0 + 30.5) / 2, 0, true);
	// the gravel's outline, its corners rounded into the curve the setts follow
	const outline = new THREE.CatmullRomCurve3(GRAVEL.map(([x, z]) => v3(x, 0, z)), true, 'centripetal', 0.5).getSpacedPoints(72).slice(0, -1).map((p) => [p.x, p.z] as [number, number]);
	b.patch(outline, mat.gravel, 0.016);
	for (const [x0, x1, z0, z1] of Object.values(BEDS)) b.patch([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], mat.mulch, 0.05);
	// the curbs of granite setts: round the gravel, along the beds' open edges
	const curb = (a: [number, number], c: [number, number]) => {
		const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
		b.box(len + 0.1, 0.1, 0.1, mat.setts, (a[0] + c[0]) / 2, 0.05, (a[1] + c[1]) / 2, -Math.atan2(c[1] - a[1], c[0] - a[0]));
	};
	for (let i = 0; i < outline.length; i++) curb(outline[i]!, outline[(i + 1) % outline.length]!);
	const { house, south, shed } = BEDS as Record<string, Rect>;
	curb([house![0], house![3]], [house![1], house![3]]);
	curb([house![1], house![2]], [house![1], house![3]]);
	curb([south![1], south![2]], [south![0], south![2]]);
	curb([south![1], south![2]], [south![1], shed![2]]);
	curb([south![1], shed![2]], [shed![1], shed![2]]);
	curb([shed![1], shed![2]], [shed![1], shed![3]]);
	solid.push(house!, BEDS.west!, south!, shed!);
	// a manhole cover in the courtyard's paving
	const cover = b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.012, 32), mat.iron));
	cover.position.set(-2.4, 0.006, 7.4);
	for (let i = -2; i <= 2; i++) b.box(0.5 - Math.abs(i) * 0.08, 0.006, 0.02, mat.grate, -2.4, 0.014, 7.4 + i * 0.1);

	/* ── the trees, the hedges, the shrubs ─────────────────────────────────── */
	const plant = (o: THREE.Object3D, x: number, z: number, r: number, rotY = 0) => {
		b.place(o, x, z, rotY);
		if (r) round.push({ x, z, r });
	};
	plant(tree('lilac', 3), -10.3, 9.65, 0.3, 0.8);
	plant(tree('corkscrew', 2), -14.35, 3.7, 0.25, 2.1);
	plant(tree('privet', 4), -14.4, 0.55, 0.2, 0.3);
	plant(tree('maple', 5), -11.55, -0.62, 0.15, 1.2);
	b.place(hedge({ w: 3.1, h: 0.76, d: 0.8, seed: 1 }), -13.4, -0.76);
	b.place(bush({ w: 0.9, h: 0.6, cards: 110, card: 0.14, leaf: 'broad', tint: '#86a564', seed: 12 }), -10.95, -0.72);
	// the west bed: rhododendrons under the trees, the climber up the wall between them
	for (const [z, s] of [[1.9, 1], [4.9, 2], [5.85, 3]] as const) b.place(bush({ w: 1.2, h: 1.15, d: 0.9, cards: 300, card: 0.2, leaf: 'broad', tint: '#557a48', seed: 20 + s }), -14.5, z, s);
	const climb: [THREE.Vector3, THREE.Vector3][] = [];
	for (let i = 0; i < 12; i++) climb.push([v3(WEST_WALL.x + 0.05, 0.05, 1.3 + i * 0.2), v3(WEST_WALL.x + 0.06, 2.0 + (i % 4) * 0.3, 0.9 + i * 0.27)]);
	b.add(stems(climb, { card: 0.2, per: 10, tint: '#7e9d5c', seed: 61, spread: 0.08, face: v3(1, 0, 0) }));
	// the south bed: honeysuckle mounds and the ivy cone; the shed's bed: more of them, a young shrub and its label
	b.place(ivyCone({ h: 1.3, r: 0.55, seed: 2 }), -12.65, 6.95);
	round.push({ x: -12.65, z: 6.95, r: 0.55 });
	for (const [x, z, w, h, s] of [[-14.1, 7.3, 1.7, 0.75, 1], [-13.2, 8.7, 1.3, 0.6, 2], [-11.75, 7.25, 1.0, 0.55, 3], [-14.3, 9.6, 1.2, 0.7, 4], [-12.4, 9.95, 1.2, 0.6, 5], [-9.0, 9.95, 1.6, 0.55, 6], [-6.85, 9.95, 1.0, 0.5, 7]] as const)
		b.place(bush({ w, h, d: Math.min(1.2, w * 0.8), cards: Math.round(w * 130), card: 0.15, leaf: 'broad', tint: '#7d9b5c', seed: 30 + s }), x, z, s);
	b.place(bush({ w: 0.6, h: 0.7, cards: 40, card: 0.14, leaf: 'narrow', tint: '#d2dd93', seed: 40 }), -8.15, 9.85);
	bar(b.group, v3(-7.95, 0.05, 9.55), v3(-7.95, 0.3, 9.52), 0.006, mat.iron);
	b.box(0.08, 0.11, 0.005, mat.label, -7.95, 0.33, 9.52);

	/* ── the garden table and its chairs on the gravel ─────────────────────── */
	const T = TABLE;
	b.place(teakTable(), T.x, T.z, Math.PI / 2);
	solid.push([T.x - 0.5, T.x + 0.5, T.z - 0.82, T.z + 0.82]);
	const chairs: [THREE.Object3D, number, number, number][] = [
		[teakRecliner(), T.x + 0.85, T.z + 0.35, -Math.PI / 2],
		[teakRecliner(), T.x + 0.1, T.z + 1.2, Math.PI],
		[teakRecliner({ weathered: true }), T.x + 0.2, T.z - 1.2, -0.17],
		[foldingChair(), T.x - 0.85, T.z + 0.35, Math.PI / 2],
		[foldingChair(), T.x - 0.8, T.z - 0.7, 0.85]
	];
	for (const [o, x, z, r] of chairs) plant(o, x, z, 0.32, r);
	b.place(redTin(), T.x + 0.12, T.z - 0.35, 0.3, 0.739);
	b.place(ashtray(), T.x - 0.05, T.z + 0.25, 0, 0.739);
	plant(stonewareCrock(), -13.85, 0.95, 0.2);

	/* ── along the house: the letterbox, the bike, the window boxes, pots, the step and the grating ───────── */
	const G = HOUSE_GROUND, Hz = HOUSE.z;
	plant(mailboxPost(), -10.55, 0.32, 0.15);
	b.place(cityBike(), -6.75, -0.45, -Math.PI / 2);
	solid.push([-7.7, -5.8, -0.75, -0.15]);
	for (const x of [-7.05, -5.95]) b.place(windowBox({ length: 0.85, seed: x < -6 ? 1 : 2 }), x, Hz + 0.02, 0, G.steelWindow.sill);
	plant(terracottaPot({ d: 0.38, h: 0.3, plant: 'shrub', seed: 11 }), -5.75, -0.82, 0.22);
	const grey = terracottaPot({ d: 0.4, h: 0.34, plant: 'none', seed: 12 });
	grey.traverse((o) => {
		const m = o as THREE.Mesh;
		if (m.isMesh && (m.material as THREE.MeshStandardMaterial).color?.getHexString() === 'b4623c') m.material = mat.iron;
	});
	plant(grey, -8.05, -0.85, 0.22);
	const wd = G.workshopDoor;
	b.box(wd.x1 - wd.x0 + 0.3, 0.08, 0.4, mat.plate, (wd.x0 + wd.x1) / 2, 0.04, Hz + 0.2);
	b.box(1.3, 0.012, 0.5, mat.grate, (wd.x0 + wd.x1) / 2 + 0.1, 0.006, Hz + 0.65);
	for (let i = 0; i < 12; i++) b.box(0.012, 0.016, 0.5, mat.iron, (wd.x0 + wd.x1) / 2 - 0.5 + i * 0.1, 0.01, Hz + 0.65);
	b.box(0.8, 0.018, 0.42, mat.coir, (wd.x0 + wd.x1) / 2 + 0.35, 0.017, Hz + 0.65);
	b.box(0.75, 0.012, 0.42, mat.rubber, (G.frontDoor.x0 + G.frontDoor.x1) / 2, 0.006, Hz + 0.62);

	/* ── on the shed: the insect hotel, two floodlights, the rain barrel under its pipe, the sapling ──────── */
	const S = SHED;
	b.place(insectHotel(), -9.3, S.z0, Math.PI, 2.25);
	for (const x of [-6.75, -11.3]) b.place(floodlight(), x, S.z0, Math.PI, 2.5);
	plant(rainBarrel(), -11.55, S.z0 - 0.4, 0.32, 0.4);
	const pot = terracottaPot({ d: 0.42, h: 0.34, plant: 'none', seed: 13 });
	plant(pot, -7.7, 9.95, 0.24);
	b.place(tree('sapling', 6), -7.7, 9.95, 0, 0.31);
	for (let i = 0; i < 7; i++) {
		const p = b.add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat.pebble));
		p.position.set(-7.7 + Math.cos(i * 2.4) * 0.11, 0.33, 9.95 + Math.sin(i * 2.4) * 0.11);
		p.scale.y = 0.7;
	}
	bar(b.group, v3(-6.55, 0.1, S.z0 - 0.06), v3(-6.6, 0.05, 9.35), 0.04, mat.copper);
	// on the gate's low wall: a blue pot, a black tub
	b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.16, 20), mat.blue)).position.set(-13.65, 1.19, 10.7);
	b.box(0.42, 0.16, 0.32, mat.tub, -13.25, 1.19, 10.7);

	/* ── ivy over the driveway's east wall and the courtyard's south wall ──────────────────────────────────── */
	b.place(hedge({ w: DRIVE.z1 - DRIVE.z0, h: 2.55, d: 0.42, seed: 7 }), DRIVE.x1 + 0.08, (DRIVE.z0 + DRIVE.z1) / 2, Math.PI / 2);
	b.place(hedge({ w: 3.6, h: 2.9, d: 0.4, seed: 8 }), SOUTH_WALL.x0 + 1.8, SOUTH_WALL.z - 0.1);
	solid.push([DRIVE.x1 - 0.15, DRIVE.x1 + 0.3, DRIVE.z0, DRIVE.z1], [DRIVE.x0 - 0.3, DRIVE.x0, S.z1, DRIVE.z1], [SOUTH_WALL.x0, SOUTH_WALL.x0 + 3.6, SOUTH_WALL.z - 0.35, SOUTH_WALL.z]);

	/* ── fallen leaves: on the paving under the trees, on the gravel, a few on the terrace's stones ─────────── */
	const leafMat = new THREE.MeshStandardMaterial({ map: fallenLeaves(), alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide });
	const r = seeded(1003);
	const quads: THREE.BufferGeometry[] = [];
	for (const [cx, cz, spread, n] of [[-10.3, 9.0, 2.6, 70], [-11.6, 0.4, 1.6, 40], [-13.6, 2.2, 2.2, 60], [-8.0, 6.5, 4.5, 40], [0.8, 2.6, 2.6, 22], [-2.5, 5.5, 3.0, 26]] as const)
		for (let i = 0; i < n; i++) {
			const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread, s = 0.05 + r() * 0.04;
			const q = new THREE.PlaneGeometry(s, s);
			const cell = Math.floor(r() * 4), uv = q.attributes.uv!;
			for (let k = 0; k < uv.count; k++) uv.setXY(k, (cell % 2) * 0.5 + uv.getX(k) * 0.5, Math.floor(cell / 2) * 0.5 + uv.getY(k) * 0.5);
			q.rotateX(-Math.PI / 2 + (r() - 0.5) * 0.5).rotateY(r() * Math.PI * 2).translate(cx + Math.cos(a) * d, 0.03 + r() * 0.01, cz + Math.sin(a) * d);
			quads.push(q);
		}
	for (const q of quads) b.add(new THREE.Mesh(q, leafMat), false, true);

	// where a stand-in sits: in the nearest red recliner at the garden table (x, z, facing, its seat under a 0.5 m edge)
	const sets: Garden['sets'] = { 'stand-in garden': [T.x + 0.72, T.z + 0.35, -Math.PI / 2, -0.1] };
	return { solid, round, sets };
}
