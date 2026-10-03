/*
 * THE PERGOLA AND ITS TERRACE — in front of the old workshop: a roof of clear corrugated polycarbonate on white rafters,
 * held by grey steel (a beam south of the workshop, a corner post, a long diagonal strut from the roof's south edge
 * down to the workshop's corner, a fat round column with its pipe braces on the north) and by a frame of fresh larch in
 * front (sills on the paving, posts — the south ones leaning out — and a header carrying the rolled-up side awning and
 * the brown gutter, whose pipe runs back diagonally to the house's corner). Two sand-coloured sails sag under the roof.
 * Under it the terrace: flagstones, two steel plates over the cellar's light well, the leather sofa, the bamboo table,
 * the bistro set in the corner, the white planters and their herbs, the olive tree, the bird of paradise, the passion
 * flower up its wire trellis, the paper lanterns, the festoon lights and the two toys on the neighbour's ledge.
 */
import * as THREE from 'three';
import { type Builder, sized } from './kit';
import { corrugated, polycarbonate, type Lamp } from './buildings';
import { ANNEX, BIG_WINDOW, COLUMN, NEIGHBOUR, INSET, POSTS, ROOF, SLIM, STRUT, TERRACE, roofAt, type Rect } from './layout';
import { SIZE, flagstones, sailcloth, treadPlate } from './surfaces';
import { bambooTable, bistroChair, bistroTable, clubSofa, festoonLights, ficusTree, geraniumPot, monstera, oliveTree, paperLantern, ribbedPlanter, strelitzia, terracottaPot, toyBee, toyMonkey, type Herb } from '$lib/models/terrace';
import { ashtray } from '$lib/models/yard';
import { bar, v3 } from '$lib/models/parts';
import { pine } from '$lib/models/textures';
import { stems } from '$lib/models/outdoor';

export type Obstacle = { x: number; z: number; r: number };
export type Pergola = { solid: Rect[]; round: Obstacle[]; lamps: Lamp[]; sets: Record<string, [number, number, number, number]>; sails: THREE.MeshStandardMaterial };

/** the rafters' depth, the purlins' on them: the roof's sheets lie on the purlins */
const RAFTER = 0.14, PURLIN = 0.04;
/** the slope's angle: the roof falls to the front */
const SLOPE = Math.atan2(ROOF.back - ROOF.front, ROOF.z1);
const underRafters = (z: number) => roofAt(z) - 0.012 - PURLIN - RAFTER;

export function buildPergola(b: Builder, scene: THREE.Scene): Pergola {
	const larchTex = pine().clone();
	larchTex.needsUpdate = true;
	larchTex.repeat.set(2, 2);
	const mat = {
		steel: new THREE.MeshStandardMaterial({ color: '#8f8d88', roughness: 0.55, metalness: 0.25 }),
		larch: new THREE.MeshStandardMaterial({ map: larchTex, color: '#f0b679', roughness: 0.66 }),
		rafter: new THREE.MeshStandardMaterial({ color: '#ecebe5', roughness: 0.62 }),
		// the sun shines through the cloth: it glows from beneath by day (its emissive, set with the hour)
		sail: new THREE.MeshStandardMaterial({ map: sailcloth(), color: '#d7bf95', roughness: 0.96, side: THREE.DoubleSide, emissive: '#c9a46a', emissiveIntensity: 0 }),
		gutter: new THREE.MeshStandardMaterial({ color: '#5b3b2c', roughness: 0.38, metalness: 0.35, side: THREE.DoubleSide }),
		tarp: new THREE.MeshStandardMaterial({ color: '#b0a690', roughness: 0.7 }),
		strap: new THREE.MeshStandardMaterial({ color: '#7a766e', roughness: 0.7 }),
		flags: new THREE.MeshStandardMaterial({ map: sized(flagstones(), SIZE.flags), bumpMap: sized(flagstones(), SIZE.flags), bumpScale: 0.8, roughness: 0.8 }),
		plate: new THREE.MeshStandardMaterial({ map: sized(treadPlate(), SIZE.plate), bumpMap: sized(treadPlate(), SIZE.plate), bumpScale: 1.2, roughness: 0.6, metalness: 0.1 }),
		angle: new THREE.MeshStandardMaterial({ color: '#4b4d4f', roughness: 0.5, metalness: 0.5 }),
		wire: new THREE.MeshStandardMaterial({ color: '#b9bcbe', roughness: 0.35, metalness: 0.8 }),
		galv: new THREE.MeshStandardMaterial({ color: '#b3b4b1', roughness: 0.45, metalness: 0.5 }),
		strapBlack: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.8 })
	};
	const roofMat = polycarbonate();
	(roofMat.map as THREE.Texture).repeat.set(1 / 1.05, 1 / 1.35);
	(roofMat.map as THREE.Texture).offset.set(0, 0.35);
	const solid: Rect[] = [];
	const round: Obstacle[] = [];
	const lamps: Lamp[] = [];
	/** a box along a line from a to b, `w` × `d` across it */
	const beam = (a: THREE.Vector3, c: THREE.Vector3, w: number, d: number, m: THREE.Material) => {
		const len = a.distanceTo(c);
		const o = b.box(w, len, d, m, (a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2);
		o.quaternion.setFromUnitVectors(v3(0, 1, 0), c.clone().sub(a).normalize());
		return o;
	};

	/* ── the roof: rafters, purlins, the corrugated sheets ─────────────────── */
	const rafterXs = Array.from({ length: 11 }, (_, i) => ROOF.x0 + (i * (ROOF.x1 - ROOF.x0)) / 10);
	for (const x of rafterXs) {
		const z0 = x > INSET.x0 + 0.2 ? INSET.z0 : ROOF.z0 + 0.1, z1 = ROOF.z1 - 0.06;
		const zm = (z0 + z1) / 2;
		const r = b.box(0.06, RAFTER, z1 - z0, mat.rafter, x, underRafters(zm) + RAFTER / 2, zm);
		r.rotation.x = SLOPE;
	}
	for (const [z, x0] of [[0.18, ROOF.x0], [1.5, ROOF.x0], [2.85, ROOF.x0], [4.08, ROOF.x0], [-1.2, INSET.x0], [-0.55, INSET.x0]] as const) {
		const p = b.box(ROOF.x1 - x0 + 0.1, PURLIN, 0.05, mat.rafter, (x0 + ROOF.x1) / 2, roofAt(z) - 0.012 - PURLIN / 2, z);
		p.rotation.x = SLOPE;
	}
	const sheet = (x0: number, x1: number, z0: number, z1: number) => {
		const s = corrugated(x1 - x0, (z1 - z0) / Math.cos(SLOPE), roofMat);
		s.rotation.x = SLOPE - Math.PI / 2;
		s.position.set((x0 + x1) / 2, roofAt((z0 + z1) / 2), (z0 + z1) / 2);
		s.renderOrder = 2;
		b.group.add(s);
	};
	sheet(ROOF.x0 - 0.05, ROOF.x1 + 0.05, ROOF.z0 - 0.02, ROOF.z1 + 0.06);
	sheet(INSET.x0 - 0.05, ROOF.x1 + 0.05, INSET.z0 - 0.1, ROOF.z0 - 0.02);

	/* ── the steel ─────────────────────────────────────────────────────────── */
	// the rafters' back ends rest on the workshop's cornice; south of it on a beam out from its corner, and over the
	// corner behind its north end on a beam along the neighbour's wall
	const backTop = underRafters(0.14);
	b.span(ROOF.x0 - 0.05, ANNEX.x0 + 0.05, backTop - 0.16, backTop, 0.1, 0.18, mat.steel);
	b.span(INSET.x0, ROOF.x1 + 0.05, underRafters(INSET.z0 + 0.05) - 0.16, underRafters(INSET.z0 + 0.05), INSET.z0, INSET.z0 + 0.08, mat.steel);
	// the edge beams along the roof's south and north sides, under the rafters, falling with them
	for (const [x, z0] of [[ROOF.x0, 0.1], [ROOF.x1 - 0.04, INSET.z0]] as const) {
		const zm = (z0 + ROOF.z1) / 2;
		const e = b.box(0.1, 0.16, ROOF.z1 - z0, mat.steel, x, underRafters(zm) - 0.08, zm);
		e.rotation.x = SLOPE;
	}
	// the corner post against the workshop's corner, and the long strut from the south edge down to its foot
	const foot = v3(...STRUT.foot), top = v3(...STRUT.top);
	b.span(ANNEX.x0 - 0.16, ANNEX.x0 - 0.04, 0, backTop - 0.16, 0.06, 0.16, mat.steel);
	beam(foot, top, 0.1, 0.12, mat.steel);
	b.box(0.34, 0.02, 0.3, mat.steel, (foot.x + ANNEX.x0 - 0.1) / 2, 0.01, 0.22);
	// the fat round column, its collar, its slimmer top; the slim column at the back; the two pipe braces
	const C = COLUMN;
	b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, C.collar, 28), mat.steel)).position.set(C.x, C.collar / 2, C.z);
	b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.16, 28), mat.steel)).position.set(C.x, C.collar + 0.02, C.z);
	const cTop = underRafters(C.z) - 0.16;
	b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, cTop - C.collar, 20), mat.steel)).position.set(C.x, (C.collar + cTop) / 2, C.z);
	b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, underRafters(SLIM.z) - 0.16, 18), mat.steel)).position.set(SLIM.x, (underRafters(SLIM.z) - 0.16) / 2, SLIM.z);
	const pipeEnd = v3(ANNEX.x1 - 0.12, 2.95, 0.06);
	bar(b.group, v3(C.x, C.collar + 0.02, C.z), pipeEnd, 0.055, mat.steel);
	bar(b.group, v3(C.x, C.collar + 0.06, C.z), v3(4.2, underRafters(INSET.z0 + 0.05) - 0.16, INSET.z0 + 0.06), 0.05, mat.steel);
	b.box(0.12, 0.12, 0.02, mat.steel, pipeEnd.x, pipeEnd.y, 0.01);
	// the black strap hanging from a hook at the brace's end
	b.box(0.026, 0.95, 0.006, mat.strapBlack, pipeEnd.x, pipeEnd.y - 0.52, 0.1);
	const loop = b.add(new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 6, 18), mat.strapBlack));
	loop.position.set(pipeEnd.x, pipeEnd.y - 1.03, 0.1);
	round.push({ x: C.x, z: C.z, r: 0.2 }, { x: SLIM.x, z: SLIM.z, r: 0.12 }, { x: foot.x, z: foot.z, r: 0.18 });

	/* ── the larch: sills, posts, the header; the awning rolled up on it, the gutter ────────────────────────── */
	const T = TERRACE, L = 0.12;
	b.span(T.x0 - L / 2, T.x1 - 0.06, 0, L, T.z1 - L / 2, T.z1 + L / 2, mat.larch);
	b.span(T.x0 - L / 2, T.x0 + L / 2, 0, L, 0.28, T.z1 - L / 2, mat.larch);
	const headY = underRafters(T.z1 + 0.05);
	for (const [fx, fz, tx] of POSTS) {
		const lean = fx !== tx;
		beam(v3(fx, L, fz), v3(tx, lean && fz < 2 ? underRafters(fz) - 0.16 : headY - 0.2, fz), L, L, mat.larch);
		// eye bolts up its face, for the side awning's ties
		for (const t of [0.2, 0.42, 0.64, 0.86]) {
			const at = new THREE.Vector3().lerpVectors(v3(fx, L, fz), v3(tx, headY - 0.2, fz), t);
			const ring = b.add(new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 6, 12), mat.galv));
			ring.position.set(at.x, at.y, at.z + 0.075);
		}
		// a steel shoe at its foot
		b.box(0.16, 0.08, 0.004, mat.galv, fx, L + 0.04, fz + 0.062);
		round.push({ x: fx, z: fz, r: 0.1 });
	}
	b.span(ROOF.x0 + 0.02, ROOF.x1 - 0.05, headY - 0.2, headY, T.z1 - L / 2 + 0.03, T.z1 + L / 2 + 0.03, mat.larch);
	// the side awning rolled up along the header, strapped every metre
	const awning = b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, ROOF.x1 - ROOF.x0 - 0.1, 24).rotateZ(Math.PI / 2), mat.tarp));
	awning.position.set((ROOF.x0 + ROOF.x1) / 2, headY - 0.3, T.z1 + 0.2);
	for (let x = ROOF.x0 + 0.4; x < ROOF.x1 - 0.2; x += 0.95) {
		const s = b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.101, 0.101, 0.035, 24).rotateZ(Math.PI / 2), mat.strap));
		s.position.set(x, headY - 0.3, T.z1 + 0.2);
		b.box(0.035, 0.32, 0.01, mat.strap, x, headY - 0.12, T.z1 + 0.105);
	}
	// the gutter along the roof's front, its pipe down at the south end and back diagonally to the house's corner
	const gz = ROOF.z1 + 0.12, gy = roofAt(ROOF.z1) - 0.05;
	const gutter = b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, ROOF.x1 - ROOF.x0 + 0.1, 14, 1, true, Math.PI, Math.PI).rotateZ(Math.PI / 2), mat.gutter));
	gutter.position.set((ROOF.x0 + ROOF.x1) / 2, gy, gz);
	for (const x of [ROOF.x0 - 0.05, ROOF.x1 + 0.05]) {
		const cap = b.add(new THREE.Mesh(new THREE.CircleGeometry(0.07, 14, Math.PI, Math.PI).rotateY(Math.PI / 2), mat.gutter));
		cap.position.set(x, gy, gz);
	}
	const down = v3(ROOF.x0, gy - 0.02, gz), bend = v3(ROOF.x0, gy - 0.3, gz), corner = v3(-2.72, 1.55, -1.12);
	bar(b.group, down, bend, 0.042, mat.gutter);
	bar(b.group, bend, corner, 0.042, mat.gutter);
	for (const t of [0.25, 0.55, 0.85]) {
		const at = new THREE.Vector3().lerpVectors(bend, corner, t);
		b.box(0.02, 0.1, 0.02, mat.galv, at.x, at.y + 0.08, at.z);
	}

	/* ── the sails: sand-coloured cloth sagging under the rafters, from the workshop's front to a purlin ────────── */
	const sail = (x0: number, x1: number) => {
		const z0 = 0.24, z1 = 2.98, nx = 24, nz = 28;
		const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
		const p = geo.attributes.position!;
		for (let i = 0; i < p.count; i++) {
			const u = (p.getX(i) + (x1 - x0) / 2) / (x1 - x0), w = 1 - (p.getY(i) + (z1 - z0) / 2) / (z1 - z0);
			const z = z0 + w * (z1 - z0), x = x0 + u * (x1 - x0);
			const y = underRafters(z) - 0.04 - 0.36 * 4 * w * (1 - w) - 0.07 * Math.sin(Math.PI * u) * Math.sin(Math.PI * w) + 0.012 * Math.sin(17 * u + 3 * w) * Math.sin(Math.PI * w);
			p.setXYZ(i, x, y, z);
		}
		geo.computeVertexNormals();
		const m = b.add(new THREE.Mesh(geo, mat.sail));
		m.castShadow = true;
		for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as const) {
			const eye = b.add(new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.004, 5, 12).rotateX(Math.PI / 2), mat.galv));
			eye.position.set(x, underRafters(z) - 0.04, z);
		}
	};
	sail(-2.45, 1.42);
	sail(1.58, 4.6);

	/* ── the terrace's floor ───────────────────────────────────────────────── */
	b.patch([[T.x0 + L / 2, 0], [INSET.x0, 0], [INSET.x0, INSET.z0], [T.x1, INSET.z0], [T.x1, T.z1 - L / 2], [T.x0 + L / 2, T.z1 - L / 2]], mat.flags, 0.02);
	// the steel plates over the cellar's light well, in a frame of angle
	for (const x of [-0.375, 0.795]) b.box(1.15, 0.012, 1.2, mat.plate, x, 0.026, 1.4, 0, false);
	for (const [w, d, x, z] of [[2.38, 0.03, 0.21, 0.79], [2.38, 0.03, 0.21, 2.01], [0.03, 1.25, -0.97, 1.4], [0.03, 1.25, 1.39, 1.4], [0.03, 1.25, 0.21, 1.4]] as const) b.box(w, 0.016, d, mat.angle, x, 0.028, z, 0, false);

	/* ── the wire trellis on the workshop's front by its corner, the passion flower up it ────────────────────── */
	const tx0 = ANNEX.x0 + 0.1, tx1 = BIG_WINDOW.x0 - 0.2, ty0 = 0.9, ty1 = 2.95, tz = 0.07;
	const wires: THREE.BufferGeometry[] = [];
	for (let x = tx0; x <= tx1 + 1e-6; x += (tx1 - tx0) / 5) wires.push(new THREE.CylinderGeometry(0.003, 0.003, ty1 - ty0, 4).translate(x, (ty0 + ty1) / 2, tz));
	for (let y = ty0; y <= ty1 + 1e-6; y += 0.15) wires.push(new THREE.CylinderGeometry(0.003, 0.003, tx1 - tx0, 4).rotateZ(Math.PI / 2).translate((tx0 + tx1) / 2, y, tz));
	for (const w of wires) b.add(new THREE.Mesh(w, mat.wire), false, false);
	const pot = b.place(terracottaPot({ d: 0.36, h: 0.42, seed: 3 }), -2.25, 0.42);
	const vines: [THREE.Vector3, THREE.Vector3][] = [];
	for (let i = 0; i < 6; i++) vines.push([v3(-2.3 + i * 0.03, 0.42, 0.42), v3(tx0 + 0.05 + i * 0.1, ty1 - (i % 3) * 0.3, tz + 0.03)]);
	for (let i = 0; i < 3; i++) vines.push([v3(tx0 + 0.1 + i * 0.15, ty1, tz + 0.03), new THREE.Vector3().lerpVectors(foot, top, 0.45 + i * 0.12).add(v3(0, 0.05, 0))]);
	b.add(stems(vines, { card: 0.16, per: 16, tint: '#c1cf78', seed: 41, spread: 0.07 }));
	b.add(stems(vines.slice(0, 3), { card: 0.14, per: 5, tint: '#f0c94a', seed: 42, spread: 0.1 }));
	round.push({ x: pot.position.x, z: pot.position.z, r: 0.24 });

	/* ── the furniture and the plants ──────────────────────────────────────── */
	const sofa = b.place(clubSofa(), 0.15, 0.47);
	b.place(bambooTable(), -0.35, 1.45, 0.06);
	solid.push([-0.85, 1.15, 0, 0.95], [-0.72, 0.02, 1.2, 1.7]);
	b.place(monstera(), 1.7, 0.02, 0.4, BIG_WINDOW.sill);
	// the bistro set in the corner, the geranium on its table
	const bt = { x: 4.3, z: -0.55 };
	b.place(bistroTable(), bt.x, bt.z);
	const chairs: [number, number][] = [[3.8, -0.95], [4.25, 0.12], [4.95, -0.6]];
	for (const [x, z] of chairs) b.place(bistroChair(), x, z, Math.atan2(bt.x - x, bt.z - z));
	b.place(geraniumPot(), bt.x + 0.08, bt.z - 0.07, 0, 0.73);
	b.place(ashtray(), bt.x - 0.14, bt.z + 0.1, 0, 0.73);
	round.push({ x: bt.x, z: bt.z, r: 0.72 });
	// the planters, the olive, the bird of paradise, the pots
	const planters: [number, number, number, number, Herb, number][] = [
		[-1.45, 3.7, 0.4, 0.82, 'mint', 1],
		[-0.62, 3.72, 0.45, 0.95, 'lavender', 2],
		[-1.95, 1.3, 0.4, 0.75, 'rosemary', 3],
		[-1.5, 0.82, 0.38, 0.68, 'trailing', 4],
		[INSET.x0 + 0.24, INSET.z0 + 0.24, 0.36, 0.8, 'oregano', 5],
		[4.7, 3.55, 0.45, 0.9, 'rosemary in flower', 6]
	];
	for (const [x, z, w, h, plant, seed] of planters) {
		b.place(ribbedPlanter({ w, h, plant, seed }), x, z, (seed * 0.37) % 0.3);
		round.push({ x, z, r: w * 0.75 });
	}
	b.place(oliveTree(), -2.4, 3.3, 0.4);
	b.place(terracottaPot({ d: 0.22, h: 0.18, plant: 'lavender', seed: 7 }), -2.85, 3.86);
	b.place(strelitzia(), -1.12, 0.33, 0.2);
	b.place(terracottaPot({ d: 0.28, h: 0.25, plant: 'shrub', seed: 8 }), -1.72, 0.32);
	b.place(ficusTree(), 4.95, 4.6, 0.3);
	b.place(terracottaPot({ d: 0.62, h: 0.24, plant: 'shrub', seed: 9 }), 5.0, 5.45);
	round.push({ x: -2.4, z: 3.3, r: 0.5 }, { x: -1.12, z: 0.33, r: 0.3 }, { x: -1.72, z: 0.32, r: 0.2 }, { x: 4.95, z: 4.6, r: 0.3 }, { x: 5.0, z: 5.45, r: 0.35 });
	// on the neighbour's ledge: the toys, the festoon lights along it, ivy hanging over it
	const ledgeY = NEIGHBOUR.low + 0.12;
	b.place(toyMonkey(), 4.55, INSET.z0 - 0.06, 0.15, ledgeY);
	b.place(toyBee(), 4.86, INSET.z0 - 0.05, -0.2, ledgeY);
	const festoon = b.place(festoonLights({ length: 2.05, sag: 0.1, bulbs: 8 }), INSET.x0 + 0.1, INSET.z0 - 0.1, 0, ledgeY + 0.22);
	const ivy: [THREE.Vector3, THREE.Vector3][] = [];
	for (let i = 0; i < 7; i++) ivy.push([v3(3.75 + i * 0.07, ledgeY, INSET.z0 + 0.02), v3(3.7 + i * 0.09, ledgeY - 0.5 - (i % 3) * 0.25, INSET.z0 + 0.06)]);
	for (let i = 0; i < 8; i++) ivy.push([v3(NEIGHBOUR.x - 0.02, ledgeY, 1.3 + i * 0.13), v3(NEIGHBOUR.x - 0.06, ledgeY - 0.6 - (i % 4) * 0.2, 1.25 + i * 0.15)]);
	b.add(stems(ivy, { card: 0.1, per: 26, tint: '#7d9a62', seed: 51, spread: 0.04, face: v3(0, 0, 1) }));

	/* ── the paper lanterns: two big ones under the roof, a cluster by the trellis hung from the strut ───────── */
	let paper: THREE.MeshStandardMaterial | undefined;
	const lanternAt = (d: number, x: number, z: number, hook: number, drop: number) => {
		const l = b.place(paperLantern({ d, drop }), x, z, (x * 7) % 3, hook);
		paper = l.userData.glass as THREE.MeshStandardMaterial;
		return l.position.clone().add(l.userData.light as THREE.Vector3);
	};
	const big1 = lanternAt(0.42, 1.5, 3.12, underRafters(3.12), 0.5);
	const big2 = lanternAt(0.32, 3.3, 3.12, underRafters(3.12), 0.32);
	const cluster: THREE.Vector3[] = [];
	for (const [d, t, drop] of [[0.3, 0.16, 0.06], [0.26, 0.22, 0.32], [0.32, 0.29, 0.05], [0.24, 0.35, 0.25], [0.28, 0.42, 0.06], [0.25, 0.26, 0.62]] as const) {
		const at = new THREE.Vector3().lerpVectors(top, foot, t);
		cluster.push(lanternAt(d, at.x, at.z + 0.06, at.y - 0.06, drop));
	}
	cluster.push(lanternAt(0.3, -2.3, 0.3, ty1, 0.3), lanternAt(0.26, -2.0, 0.34, ty1, 0.62), lanternAt(0.22, -2.42, 0.62, 1.75, 0.3));
	const glow = (at: THREE.Vector3, reach: number) => {
		const l = new THREE.PointLight('#ffc985', 0, reach, 2);
		l.position.copy(at);
		scene.add(l);
		return l;
	};
	const mid = cluster.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(cluster.length);
	lamps.push({ lights: [{ light: glow(big1, 7), share: 1.5 }, { light: glow(big2, 6), share: 1.1 }, { light: glow(mid, 6), share: 1.8 }], glass: paper, glow: 1.8 });
	const fest = glow(festoon.position.clone().add(festoon.userData.light as THREE.Vector3), 3.2);
	fest.color.set('#ffd7a0');
	lamps.push({ lights: [{ light: fest, share: 0.7 }], glass: festoon.userData.glass as THREE.MeshStandardMaterial, glow: 2.2 });

	// where the stand-ins sit: on the sofa, at the bistro table (x, z, facing, how far below a 0.5 m edge its seat is)
	const sets: Pergola['sets'] = {
		'stand-in sofa': [sofa.position.x - 0.3, sofa.position.z + 0.36, 0, -0.07],
		'stand-in bistro': [chairs[1]![0], chairs[1]![1] - 0.12, Math.atan2(bt.x - chairs[1]![0], bt.z - chairs[1]![1]), -0.04]
	};
	return { solid, round, lamps, sets, sails: mat.sail };
}
