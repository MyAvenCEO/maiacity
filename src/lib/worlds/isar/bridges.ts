/*
 * THE TWO BRIDGES — the ends of the Isar world.
 *
 * The Wittelsbacherbrücke (north, 1903–05, Theodor Fischer): four flat three-hinged arches of rammed concrete clad in
 * shell limestone, 44, 28, 27 and 26 m from the west bank, across the river, its gravel island and the east meadow;
 * its piers' bays round out from its faces, small pavilions stand on two of them, and on the third, high over the
 * island on the upstream side, Otto von Wittelsbach rides in bronze (Georg Wrba, 1905) on his pillar. Its deck is
 * walked: the road between its two broad pavements, the parapets, the lamps. Its plan is OpenStreetMap's outline (the
 * bays where it bulges, the statue where it stands); the heights are the survey's at either end; the arches' rise, the
 * bays' pavilions and the pillar's height are measured from photos, estimates all.
 *
 * The Braunauer Eisenbahnbrücke (south, 1871, Heinrich Gerber; rebuilt 1958): three spans of about 48.5 m on stone
 * piers, the two tracks on solid steel girders, and on its downstream side the old lattice truss that was kept; the
 * catenary over the tracks. Where its piers stand is estimated from the survey's ground and its length.
 *
 * And on the west bank by the railway bridge, Hefner-Alteneck-Straße crosses the Westermühlbach's mouth on a plain
 * concrete bridge, sprayed along its face to the river: the riverside way on the west bank runs over it.
 *
 * Each is built in its own frame (t along it from its west end, c across it, y up) and handed to the world with what
 * the walker needs: the decks' height where one may walk on them, and where the ground under a bridge is no place to
 * stand (a pier, an abutment, or too little headroom under an arch).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ACROSS, MAP, nOf, points, sOf } from './map';
import { ashlar, graffiti, gravel, road } from './surfaces';
import { bridgeLamp, equestrianStatue, limestoneMaterial } from '$lib/models/outdoor';
import { instances } from './green';

type P2 = [number, number];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** one geometry of many: boxes and cylinders are indexed, extrusions not, so all go unindexed when any is */
const merge = (list: THREE.BufferGeometry[]) => mergeGeometries(list.some((g) => !g.index) ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list)!;

/** a bridge's own frame: t along it from its origin, c across it (to its left, upstream for both bridges), y up */
function frame(o: P2, along: P2) {
	const len = Math.hypot(along[0], along[1]);
	const a: P2 = [along[0] / len, along[1] / len];
	const c: P2 = [-a[1], a[0]];
	const matrix = new THREE.Matrix4().makeBasis(new THREE.Vector3(a[0], 0, a[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(c[0], 0, c[1]));
	matrix.setPosition(o[0], 0, o[1]);
	return {
		matrix,
		t: (x: number, z: number) => (x - o[0]) * a[0] + (z - o[1]) * a[1],
		c: (x: number, z: number) => (x - o[0]) * c[0] + (z - o[1]) * c[1]
	};
}

/** a box from p to q in the bridge's plan (t, c), its foot at y0, h high and w thick, as geometry */
function wallPiece(p: P2, q: P2, y0: number, h: number, w: number) {
	const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
	const g = new THREE.BoxGeometry(len + w * 0.6, h, w);
	g.rotateY(-Math.atan2(q[1] - p[1], q[0] - p[0]));
	g.translate((p[0] + q[0]) / 2, y0 + h / 2, (p[1] + q[1]) / 2);
	return g;
}

/** a bay's outline in plan: out from the face at c0, round to `depth`, back to the face, between ta and tb */
function bay(ta: number, tb: number, c0: number, depth: number, side: 1 | -1, steps = 10): P2[] {
	const pts: P2[] = [];
	for (let k = 0; k <= steps; k++) {
		const u = k / steps;
		pts.push([ta + (tb - ta) * u, side * (c0 + depth * Math.sin(Math.PI * u))]);
	}
	return pts;
}

/** a flat prism standing on its plan outline, from y0 to y1 */
function prism(outline: P2[], y0: number, y1: number) {
	const shape = new THREE.Shape(outline.map(([t, c]) => new THREE.Vector2(t, -c)));
	const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
	g.rotateX(-Math.PI / 2);
	g.translate(0, y0, 0);
	return g;
}

export type Bridges = {
	group: THREE.Group;
	/** the height of a deck where one may walk on it (the Wittelsbacherbrücke's road and pavements, the canal mouth's
	 *  street), else null */
	deckAt: (x: number, z: number) => number | null;
	/** whether the ground at x, z is clear to stand on for someone whose feet are at y (no pier, headroom under an arch) */
	clear: (x: number, z: number, y: number) => boolean;
	/** the bridge's lamps, lit by the hour (night 0…1) and a shot's `lamps` (k) */
	light: (night: number, k?: number, color?: string) => void;
	dispose: () => void;
};

export function buildBridges(groundAt: (x: number, z: number) => number): Bridges {
	const group = new THREE.Group();
	group.name = 'the bridges';
	const disposables: { dispose: () => void }[] = [];
	const keep = <T extends { dispose: () => void }>(v: T) => (disposables.push(v), v);

	/* ══ THE WITTELSBACHERBRÜCKE ═════════════════════════════════════════════════════════════════════════════════ */
	const WB = MAP.bridges.wittelsbacher;
	const roadLine = points(WB.road);
	const o = roadLine[0]!, e = roadLine[roadLine.length - 1]!;
	const L = Math.hypot(e[0] - o[0], e[1] - o[1]);
	const F = frame(o, [e[0] - o[0], e[1] - o[1]]);
	const tS = WB.statue ? F.t(...WB.statue) : 48.1;
	const cS = WB.statue ? F.c(...WB.statue) : 13.2;
	/** the faces stand 10.1 m either side of the road's middle line (OpenStreetMap's outline) */
	const HALF = 10.1;
	const [endW, endE] = WB.ends;
	/** the road's height along the bridge: from street to street, a little humped */
	const deckY = (t: number) => endW + (endE - endW) * clamp01(t / L) + 0.22 * Math.sin(Math.PI * clamp01(t / L));
	const KERB = 0.14;
	const ARCHES = [
		{ t0: tS - 46.75, t1: tS - 2.75, spring: 0.9 },
		{ t0: tS + 2.75, t1: tS + 30.75, spring: 0.9 },
		{ t0: tS + 34.25, t1: tS + 61.25, spring: 1.5 },
		{ t0: tS + 64.75, t1: tS + 90.75, spring: 1.5 }
	].map((a) => {
		const crown = deckY((a.t0 + a.t1) / 2) - 0.95;
		const half = (a.t1 - a.t0) / 2, f = crown - a.spring;
		const R = (half * half + f * f) / (2 * f);
		return { ...a, crown, R, mid: (a.t0 + a.t1) / 2, yc: crown - R };
	});
	const intrados = (a: (typeof ARCHES)[number], t: number) => a.yc + Math.sqrt(Math.max(0, a.R * a.R - (t - a.mid) ** 2));
	const PIERS: [number, number][] = [
		[tS - 2.75, tS + 2.75],
		[tS + 30.75, tS + 34.25],
		[tS + 61.25, tS + 64.75]
	];
	const eastFace = ARCHES[3]!.t1, westFace = ARCHES[0]!.t0;

	const wb = new THREE.Group();
	wb.name = 'Wittelsbacherbrücke';
	wb.matrixAutoUpdate = false;
	wb.matrix.copy(F.matrix);
	group.add(wb);

	const stone = ashlar();
	stone.repeat.set(0.25, 0.25);
	const faceMat = keep(new THREE.MeshStandardMaterial({ map: stone, color: '#ece6da', roughness: 0.9 }));
	const soffitMat = keep(new THREE.MeshStandardMaterial({ map: stone, color: '#b9b2a6', roughness: 0.92 }));

	// the body: the elevation, its four arches cut through it, carried across the bridge's whole width
	const body = new THREE.Shape();
	const T0 = -12, T1 = L + 12, FOOT = -6;
	body.moveTo(T0, FOOT);
	for (let t = T0; t < T1; t += 2) body.lineTo(t, deckY(t) - 0.03);
	body.lineTo(T1, deckY(T1) - 0.03);
	body.lineTo(T1, FOOT);
	body.closePath();
	// each opening traced the other way round from the outline, as a hole must be, or its vault faces inwards
	for (const a of ARCHES) {
		const hole = new THREE.Path();
		hole.moveTo(a.t1, FOOT + 1);
		hole.lineTo(a.t1, a.spring);
		const steps = 28;
		for (let k = steps - 1; k > 0; k--) {
			const t = a.t0 + ((a.t1 - a.t0) * k) / steps;
			hole.lineTo(t, intrados(a, t));
		}
		hole.lineTo(a.t0, a.spring);
		hole.lineTo(a.t0, FOOT + 1);
		hole.closePath();
		body.holes.push(hole);
	}
	const bodyGeo = keep(new THREE.ExtrudeGeometry(body, { depth: 2 * HALF, bevelEnabled: false, curveSegments: 1 }));
	bodyGeo.translate(0, 0, -HALF);
	const bodyMesh = new THREE.Mesh(bodyGeo, [faceMat, soffitMat]);
	bodyMesh.castShadow = bodyMesh.receiveShadow = true;
	wb.add(bodyMesh);

	// each arch's ring of voussoirs, standing a hand's breadth proud of the faces
	const rings: THREE.BufferGeometry[] = [];
	for (const a of ARCHES) {
		const ring = new THREE.Shape();
		const steps = 28, thick = 0.75;
		const outer: P2[] = [], inner: P2[] = [];
		for (let k = 0; k <= steps; k++) {
			const t = a.t0 + ((a.t1 - a.t0) * k) / steps;
			const y = intrados(a, t);
			// along the radius out from the arch's centre
			const dx = t - a.mid, dy = y - a.yc, len = Math.hypot(dx, dy);
			inner.push([t, y]);
			outer.push([t + (dx / len) * thick, y + (dy / len) * thick]);
		}
		ring.moveTo(inner[0]![0], inner[0]![1]);
		for (const p of inner.slice(1)) ring.lineTo(p[0], p[1]);
		for (const p of outer.reverse()) ring.lineTo(p[0], p[1]);
		ring.closePath();
		for (const side of [-1, 1]) {
			const g = new THREE.ExtrudeGeometry(ring, { depth: 0.12, bevelEnabled: false });
			g.translate(0, 0, side > 0 ? HALF - 0.02 : -HALF - 0.1);
			rings.push(g);
		}
	}
	const ringMesh = new THREE.Mesh(keep(merge(rings)), faceMat);
	ringMesh.castShadow = ringMesh.receiveShadow = true;
	wb.add(ringMesh);

	// the piers' bays, rounding out of both faces from the water (or the meadow) up to the pavements: the pier noses
	// and the balconies on them (their depths from OpenStreetMap's outline)
	const BAYS: { t: number; w: number; side: 1 | -1; depth: number; top: number }[] = [
		{ t: tS + 0.1, w: 7.6, side: 1, depth: Math.max(4, cS + 4.0 - HALF), top: deckY(tS) - 2.4 },
		{ t: tS - 0.5, w: 7.0, side: -1, depth: 3.1, top: deckY(tS) + KERB },
		{ t: (PIERS[1]![0] + PIERS[1]![1]) / 2, w: 4.2, side: 1, depth: 2.4, top: deckY(tS + 32.5) + KERB },
		{ t: (PIERS[1]![0] + PIERS[1]![1]) / 2, w: 4.0, side: -1, depth: 1.5, top: deckY(tS + 32.5) + KERB },
		{ t: (PIERS[2]![0] + PIERS[2]![1]) / 2, w: 4.6, side: 1, depth: 2.8, top: deckY(tS + 63) + KERB },
		{ t: (PIERS[2]![0] + PIERS[2]![1]) / 2, w: 4.8, side: -1, depth: 1.7, top: deckY(tS + 63) + KERB }
	];
	const noses: THREE.BufferGeometry[] = [];
	for (const b of BAYS) {
		const outline = bay(b.t - b.w / 2, b.t + b.w / 2, HALF - 0.4, b.depth + 0.4, b.side);
		noses.push(prism(outline, -3, b.top));
		// a cornice round the bay's edge, under the parapet
		noses.push(prism(bay(b.t - b.w / 2 - 0.15, b.t + b.w / 2 + 0.15, HALF - 0.4, b.depth + 0.55, b.side), b.top - 0.35, b.top - 0.1));
	}
	const noseMesh = new THREE.Mesh(keep(merge(noses)), faceMat);
	noseMesh.castShadow = noseMesh.receiveShadow = true;
	wb.add(noseMesh);

	// the parapets: stone walls following the faces and round the bays, a coping on top
	const parapet: THREE.BufferGeometry[] = [];
	const PH = 1.1, PW = 0.45;
	const run = (path: P2[], foot: (t: number) => number, h = PH) => {
		for (let k = 0; k + 1 < path.length; k++) {
			const p = path[k]!, q = path[k + 1]!;
			const y0 = foot((p[0] + q[0]) / 2);
			parapet.push(wallPiece(p, q, y0, h, PW));
			parapet.push(wallPiece(p, q, y0 + h, 0.13, PW + 0.12));
		}
	};
	const pavement = (t: number) => deckY(t) + KERB;
	for (const side of [1, -1] as const) {
		const path: P2[] = [[-1.5, side * (HALF - PW / 2)]];
		for (const b of BAYS.filter((b) => b.side === side).sort((x, y) => x.t - y.t)) {
			// the statue's bay is below the road: there the parapet runs straight on
			if (b.top < deckY(b.t)) continue;
			for (const p of bay(b.t - b.w / 2, b.t + b.w / 2, HALF - PW / 2, b.depth, side)) path.push(p);
		}
		path.push([L + 1.5, side * (HALF - PW / 2)]);
		run(path, pavement);
	}
	// the statue's platform below the road: its own low parapet round its edge
	const statueBay = BAYS[0]!;
	run(bay(statueBay.t - statueBay.w / 2, statueBay.t + statueBay.w / 2, HALF, statueBay.depth - PW / 2, 1), () => statueBay.top, 0.95);
	const parapetMesh = new THREE.Mesh(keep(merge(parapet)), faceMat);
	parapetMesh.castShadow = parapetMesh.receiveShadow = true;
	wb.add(parapetMesh);

	// the deck: the road between two broad pavements and their granite kerbs, from street to street
	const deckGeo = (c0: number, c1: number, lift: number, uvAcross: (c: number) => number, uvAlong: number) => {
		const pos: number[] = [], uv: number[] = [], idx: number[] = [];
		const STEP = 2;
		const n = Math.ceil((L + 12) / STEP);
		for (let k = 0; k <= n; k++) {
			const t = -6 + k * STEP;
			for (const c of [c0, c1]) {
				pos.push(t, deckY(t) + lift, c);
				uv.push(uvAcross(c), t / uvAlong);
			}
			if (k) {
				const b = (k - 1) * 2;
				idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
			}
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
		g.setIndex(idx);
		g.computeVertexNormals();
		return keep(g);
	};
	const roadMat = keep(new THREE.MeshStandardMaterial({ map: road(), roughness: 0.88 }));
	const roadMesh = new THREE.Mesh(deckGeo(-6.2, 6.2, 0.0, (c) => (c + 6.2) / 12.4, 6), roadMat);
	roadMesh.receiveShadow = true;
	wb.add(roadMesh);
	const paveMat = keep(new THREE.MeshStandardMaterial({ map: gravel(), color: '#d6d1c6', roughness: 0.85 }));
	for (const side of [1, -1]) {
		const m = new THREE.Mesh(deckGeo(side * 6.2, side * (HALF - PW + 0.02), KERB, (c) => c / 3, 3), paveMat);
		m.receiveShadow = true;
		wb.add(m);
	}
	const kerbs: THREE.BufferGeometry[] = [];
	for (const side of [1, -1]) for (let t = -6; t < L + 6; t += 4) kerbs.push(wallPiece([t, side * 6.25], [t + 4, side * 6.25], deckY(t + 2) - 0.05, KERB + 0.05, 0.16));
	const kerbMesh = new THREE.Mesh(keep(merge(kerbs)), keep(new THREE.MeshStandardMaterial({ color: '#b7b4ad', roughness: 0.7 })));
	kerbMesh.receiveShadow = true;
	wb.add(kerbMesh);

	// the pavilions on the bays of the two eastern piers: little open aediculae of the same stone, a copper roof
	const copper = keep(new THREE.MeshStandardMaterial({ color: '#5e8a76', roughness: 0.6, metalness: 0.35 }));
	const pav: THREE.BufferGeometry[] = [];
	const roofs: THREE.BufferGeometry[] = [];
	for (const b of BAYS.slice(2)) {
		const ct = b.t, cc = b.side * (HALF + b.depth * 0.42), y0 = b.top;
		const W = 2.4, D = Math.max(1.3, b.depth * 0.75), H = 3.1;
		for (const dt of [-1, 1]) for (const dc of [-1, 1]) pav.push(wallPiece([ct + dt * (W / 2 - 0.2) - 0.2, cc + dc * (D / 2 - 0.2)], [ct + dt * (W / 2 - 0.2) + 0.2, cc + dc * (D / 2 - 0.2)], y0, H, 0.4));
		const arch = new THREE.Shape();
		arch.moveTo(-W / 2, 0);
		arch.lineTo(-W / 2, 0.9);
		arch.lineTo(W / 2, 0.9);
		arch.lineTo(W / 2, 0);
		arch.lineTo(W / 2 - 0.4, 0);
		for (let k = 0; k <= 12; k++) {
			const a = (k / 12) * Math.PI;
			arch.lineTo(Math.cos(a) * (W / 2 - 0.4), Math.sin(a) * 0.62 - 0.0);
		}
		arch.lineTo(-W / 2, 0);
		for (const dc of [-1, 1]) {
			const g = new THREE.ExtrudeGeometry(arch, { depth: 0.4, bevelEnabled: false });
			g.translate(ct, y0 + H - 0.9, cc + dc * (D / 2 - 0.2) - 0.2);
			pav.push(g);
		}
		pav.push(wallPiece([ct - W / 2 - 0.15, cc], [ct + W / 2 + 0.15, cc], y0 + H, 0.3, D + 0.3));
		const roof = new THREE.ConeGeometry(Math.hypot(W, D) / 2 + 0.2, 1.1, 4, 1);
		roof.rotateY(Math.PI / 4);
		roof.scale(W / Math.hypot(W, D) * 1.05, 1, D / Math.hypot(W, D) * 1.05);
		roof.translate(ct, y0 + H + 0.3 + 0.55, cc);
		roofs.push(roof);
	}
	const pavMesh = new THREE.Mesh(keep(merge(pav)), faceMat);
	pavMesh.castShadow = pavMesh.receiveShadow = true;
	wb.add(pavMesh);
	const roofMesh = new THREE.Mesh(keep(merge(roofs)), copper);
	roofMesh.castShadow = true;
	wb.add(roofMesh);

	// Otto von Wittelsbach's pillar, rising from the upstream nose of the island's pier past the road, the rider on top
	const pillar: THREE.BufferGeometry[] = [];
	const top = 13.6;
	const block = (w: number, y0: number, y1: number, d = w) => {
		const g = new THREE.BoxGeometry(w, y1 - y0, d);
		g.translate(tS, (y0 + y1) / 2, cS);
		pillar.push(g);
	};
	block(4.6, -2.5, statueBay.top);
	block(3.5, statueBay.top, statueBay.top + 0.8);
	const shaft = new THREE.CylinderGeometry(1.25 * Math.SQRT2, 1.45 * Math.SQRT2, top - statueBay.top - 0.8, 4, 1);
	shaft.rotateY(Math.PI / 4);
	shaft.translate(tS, (statueBay.top + 0.8 + top) / 2, cS);
	pillar.push(shaft);
	block(3.3, top, top + 0.55);
	block(2.9, top + 0.55, top + 0.75);
	const pillarMesh = new THREE.Mesh(keep(merge(pillar)), faceMat);
	pillarMesh.castShadow = pillarMesh.receiveShadow = true;
	wb.add(pillarMesh);
	// he rides west, towards the town
	const rider = equestrianStatue();
	wb.add(instances(rider, [new THREE.Matrix4().compose(new THREE.Vector3(tS, top + 0.75, cS), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2), new THREE.Vector3(1.15, 1.15, 1.15))]));

	// the lamps along both parapets, between the bays
	const lampLights: THREE.PointLight[] = [];
	const lampAt = [6, 24, 38, 60, 72, 89, 100, 121, 133];
	const lampModel = bridgeLamp();
	const lampMats = [lampModel.userData.glass as THREE.MeshStandardMaterial];
	const lampPlaces: THREE.Matrix4[] = [];
	for (const side of [1, -1]) for (const t of lampAt) lampPlaces.push(new THREE.Matrix4().makeTranslation(t, pavement(t) + PH + 0.13, side * (HALF - PW / 2)));
	wb.add(instances(lampModel, lampPlaces));
	// a few of them light the pavement for real (the rest glow): enough for a night shot without a light for each
	for (const [t, side] of [[38, 1], [72, -1], [100, 1], [133, -1]] as const) {
		const l = new THREE.PointLight('#ffc98a', 0, 26, 1.6);
		l.position.set(t, pavement(t) + PH + 4.7, side * (HALF - 1.2));
		wb.add(l);
		lampLights.push(l);
	}

	// spray paint on the noses of the meadow's piers, where the path passes under
	const sprayMat = keep(new THREE.MeshStandardMaterial({ map: graffiti(), transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
	for (const b of BAYS.slice(2)) {
		const g = new THREE.PlaneGeometry(b.w * 0.9, 2.4);
		const m = new THREE.Mesh(keep(g), sprayMat);
		const ground = groundAt(...(toWorld(F.matrix, b.t, b.side * (HALF + b.depth + 0.04))));
		m.position.set(b.t, ground + 1.3, b.side * (HALF + b.depth + 0.04));
		m.rotation.y = b.side > 0 ? 0 : Math.PI;
		wb.add(m);
	}

	/* ══ THE BRAUNAUER EISENBAHNBRÜCKE ═══════════════════════════════════════════════════════════════════════════ */
	const BR = MAP.bridges.braunauer;
	const rails = BR.rails.map(points);
	const ra = rails[0]![0]!, rb = rails[0]![rails[0]!.length - 1]!;
	const R = frame(ra, [rb[0] - ra[0], rb[1] - ra[1]]);
	const RL = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]);
	const railY = BR.ends ? (BR.ends[0] + BR.ends[1]) / 2 : 10.45;
	// the two tracks' middles across the bridge (from its rails), and the deck's edges
	const trackC = rails.map((r) => r.reduce((s, p) => s + R.c(...p), 0) / r.length).sort((a, b) => b - a);
	const TRACKS = trackC.length > 1 ? [trackC[0]!, trackC[0]! - 4.2] : [0, -4.2];
	const MAIN = { c0: TRACKS[1]! - 2.7, c1: TRACKS[0]! + 2.7 };
	const TRUSS = { c0: MAIN.c0 - 6.3, c1: MAIN.c0 - 0.6 };
	const SPAN = 48.5;
	const W_ABUT = 27, PIER_W = 3;
	const RPIERS: [number, number][] = [
		[W_ABUT + SPAN, W_ABUT + SPAN + PIER_W],
		[W_ABUT + 2 * SPAN + PIER_W, W_ABUT + 2 * SPAN + 2 * PIER_W]
	];
	const E_ABUT = W_ABUT + 3 * SPAN + 2 * PIER_W;
	const GIRDER = 3.0, DECK = 0.55;
	const deckTop = railY - 0.62, girderFoot = deckTop - DECK - GIRDER;

	const rb2 = new THREE.Group();
	rb2.name = 'Braunauer Eisenbahnbrücke';
	rb2.matrixAutoUpdate = false;
	rb2.matrix.copy(R.matrix);
	group.add(rb2);
	const steel = keep(new THREE.MeshStandardMaterial({ color: '#4c544e', roughness: 0.62, metalness: 0.45 }));
	const oldSteel = keep(new THREE.MeshStandardMaterial({ color: '#4d4740', roughness: 0.75, metalness: 0.35 }));
	const masonry = keep(new THREE.MeshStandardMaterial({ map: limestoneMaterial().map, color: '#9a958b', roughness: 0.92 }));
	const concrete = keep(new THREE.MeshStandardMaterial({ color: '#9b978f', roughness: 0.9 }));
	const ballastMat = keep(new THREE.MeshStandardMaterial({ color: '#6b655c', roughness: 1 }));
	const box = (list: THREE.BufferGeometry[], t0: number, t1: number, y0: number, y1: number, c0: number, c1: number) => {
		const g = new THREE.BoxGeometry(t1 - t0, y1 - y0, c1 - c0);
		g.translate((t0 + t1) / 2, (y0 + y1) / 2, (c0 + c1) / 2);
		list.push(g);
	};
	const mesh = (list: THREE.BufferGeometry[], m: THREE.Material, cast = true) => {
		const x = new THREE.Mesh(keep(merge(list)), m);
		x.castShadow = cast;
		x.receiveShadow = true;
		rb2.add(x);
		return x;
	};

	// the piers and abutments: stone, pointed at both ends against the water
	const piers: THREE.BufferGeometry[] = [];
	for (const [t0, t1] of RPIERS) {
		const c0 = TRUSS.c0 - 1.2, c1 = MAIN.c1 + 1.2, mid = (t0 + t1) / 2;
		piers.push(prism([[t0, c0], [mid, c0 - 2.4], [t1, c0], [t1, c1], [mid, c1 + 2.4], [t0, c1]], -3, girderFoot - 0.6));
		box(piers, t0 - 0.25, t1 + 0.25, girderFoot - 0.6, girderFoot, c0 - 0.3, c1 + 0.3);
	}
	for (const [t0, t1] of [[W_ABUT - 5, W_ABUT], [E_ABUT, E_ABUT + 6]] as const) box(piers, t0, t1, -2, girderFoot, TRUSS.c0 - 2, MAIN.c1 + 2);
	// the short span over Hefner-Alteneck-Straße, from the embankment to the west abutment
	box(piers, 6, 9, 2, girderFoot, TRUSS.c0 - 1, MAIN.c1 + 1);
	mesh(piers, masonry);

	// the main bridge: the tracks on a deck carried by two deep plate girders, stiffened along their length
	const girders: THREE.BufferGeometry[] = [];
	const t0 = 6, t1 = E_ABUT + 3;
	for (const c of [MAIN.c0 + 0.9, (TRACKS[0]! + TRACKS[1]!) / 2, MAIN.c1 - 0.9]) {
		box(girders, t0, t1, girderFoot, deckTop - DECK, c - 0.03, c + 0.03);
		box(girders, t0, t1, girderFoot, girderFoot + 0.06, c - 0.32, c + 0.32);
		box(girders, t0, t1, deckTop - DECK - 0.06, deckTop - DECK, c - 0.32, c + 0.32);
		for (let t = t0 + 1.2; t < t1; t += 2.4) for (const s of [-1, 1]) box(girders, t - 0.02, t + 0.02, girderFoot + 0.06, deckTop - DECK - 0.06, c + s * 0.03, c + s * 0.18);
	}
	box(girders, t0, t1, deckTop - DECK, deckTop, MAIN.c0, MAIN.c1);
	// a railing along its upstream edge
	for (let t = t0; t < t1; t += 2) box(girders, t, t + 0.06, deckTop, deckTop + 1.1, MAIN.c1 - 0.1, MAIN.c1 - 0.04);
	for (const y of [deckTop + 0.55, deckTop + 1.08]) box(girders, t0, t1, y, y + 0.05, MAIN.c1 - 0.11, MAIN.c1 - 0.03);
	mesh(girders, steel);

	// the tracks: ballast, sleepers, rails
	const ballast: THREE.BufferGeometry[] = [];
	box(ballast, t0 - 20, t1 + 20, deckTop, railY - 0.33, MAIN.c0 + 0.2, MAIN.c1 - 0.3);
	mesh(ballast, ballastMat, false);
	const sleepers: THREE.BufferGeometry[] = [];
	const railBars: THREE.BufferGeometry[] = [];
	for (const c of TRACKS) {
		for (let t = t0 - 20; t < t1 + 20; t += 0.65) box(sleepers, t - 0.13, t + 0.13, railY - 0.36, railY - 0.18, c - 1.3, c + 1.3);
		for (const g of [-0.7175, 0.7175]) box(railBars, t0 - 20, t1 + 20, railY - 0.18, railY, c + g - 0.035, c + g + 0.035);
	}
	mesh(sleepers, concrete, false);
	mesh(railBars, keep(new THREE.MeshStandardMaterial({ color: '#7a746c', roughness: 0.35, metalness: 0.8 })), false);

	// the overhead line: masts on the upstream edge, their arms over both tracks, the wires
	const masts: THREE.BufferGeometry[] = [];
	const wireY = railY + 5.5;
	for (let t = t0 + 6; t < t1; t += 26) {
		box(masts, t - 0.15, t + 0.15, deckTop, wireY + 1.6, MAIN.c1 + 0.1, MAIN.c1 + 0.4);
		box(masts, t - 0.06, t + 0.06, wireY + 1.1, wireY + 1.22, TRACKS[1]! - 1.2, MAIN.c1 + 0.3);
		for (const c of TRACKS) box(masts, t - 0.03, t + 0.03, wireY, wireY + 1.1, c - 0.03, c + 0.03);
	}
	for (const c of TRACKS) {
		box(masts, t0 - 20, t1 + 20, wireY - 0.012, wireY + 0.012, c - 0.012, c + 0.012);
		box(masts, t0 - 20, t1 + 20, wireY + 1.1 - 0.01, wireY + 1.1 + 0.01, c - 0.01, c + 0.01);
	}
	mesh(masts, steel, false);

	// the old truss on the downstream side (Gerber's, kept when the bridge was rebuilt): two lattice walls, panels of
	// 4.85 m, braced across the top and closed by a portal at each end of each span
	const truss: THREE.BufferGeometry[] = [];
	const TB = deckTop - 0.4, TT = TB + 6.2, PANEL = SPAN / 10;
	const member = (a: [number, number, number], b: [number, number, number], w: number) => {
		const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
		const len = va.distanceTo(vb);
		const g = new THREE.BoxGeometry(w, len, w);
		g.translate(0, len / 2, 0);
		g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
		g.translate(va.x, va.y, va.z);
		truss.push(g);
	};
	const spans: [number, number][] = [[W_ABUT, RPIERS[0]![0]], [RPIERS[0]![1], RPIERS[1]![0]], [RPIERS[1]![1], E_ABUT]];
	for (const [s0, s1] of spans) {
		const panels = Math.round((s1 - s0) / PANEL), p = (s1 - s0) / panels;
		for (const c of [TRUSS.c0 + 0.3, TRUSS.c1 - 0.3]) {
			box(truss, s0, s1, TB, TB + 0.55, c - 0.25, c + 0.25);
			box(truss, s0 + p * 0.5, s1 - p * 0.5, TT - 0.5, TT, c - 0.28, c + 0.28);
			for (let k = 0; k <= panels; k++) {
				const t = s0 + k * p;
				const tt = Math.min(s1 - p * 0.5, Math.max(s0 + p * 0.5, t));
				member([t, TB + 0.5, c], [tt, TT - 0.4, c], 0.22);
				if (k < panels) {
					// the lattice: a diagonal each way in every panel
					member([t, TB + 0.5, c], [Math.min(s1 - p * 0.5, t + p), TT - 0.4, c], 0.16);
					member([t + p, TB + 0.5, c], [Math.max(s0 + p * 0.5, t), TT - 0.4, c], 0.16);
				}
			}
		}
		for (let k = 1; k < panels; k++) {
			const t = s0 + k * p;
			member([t, TT - 0.2, TRUSS.c0 + 0.3], [t, TT - 0.2, TRUSS.c1 - 0.3], 0.14);
			if (k + 1 < panels) member([t, TT - 0.2, TRUSS.c0 + 0.3], [t + p, TT - 0.2, TRUSS.c1 - 0.3], 0.08);
		}
		// its own floor
		box(truss, s0, s1, TB - 0.5, TB, TRUSS.c0, TRUSS.c1);
	}
	mesh(truss, oldSteel);

	/* ══ HEFNER-ALTENECK-STRASSE OVER THE WESTERMÜHLBACH'S MOUTH ═════════════════════════════════════════════════ */
	// a concrete slab from street to street over the channel's mouth, its kerbed pavements and steel railings, its face
	// to the river sprayed (the photos, July 2023)
	const mouthWay = MAP.paths.find((p) => p.b && p.hw === 'residential' && points(p.pts).every(([x, z]) => sOf(x, z) > -300 && sOf(x, z) < -180 && nOf(x, z) < -20));
	let mouthDeck: (x: number, z: number) => number | null = () => null;
	let mouthClear: (x: number, z: number, y: number) => boolean = () => true;
	if (mouthWay) {
		const mp = points(mouthWay.pts);
		const ma = mp[0]!, mb = mp[mp.length - 1]!;
		const ML = Math.hypot(mb[0] - ma[0], mb[1] - ma[1]);
		const MF = frame(ma, [mb[0] - ma[0], mb[1] - ma[1]]);
		const MHALF = 4.9;
		const dir: P2 = [(mb[0] - ma[0]) / ML, (mb[1] - ma[1]) / ML];
		// the street's height a little beyond either end, the deck straight between them
		const y0 = groundAt(ma[0] - dir[0] * 6, ma[1] - dir[1] * 6), y1 = groundAt(mb[0] + dir[0] * 6, mb[1] + dir[1] * 6);
		const streetY = (t: number) => y0 + (y1 - y0) * clamp01((t + 6) / (ML + 12));
		// which face looks to the river (east, across it)
		const riverSide = MF.c(ma[0] + ACROSS.x, ma[1] + ACROSS.z) - MF.c(ma[0], ma[1]) > 0 ? 1 : -1;
		const mb3 = new THREE.Group();
		mb3.name = 'Hefner-Alteneck-Straße over the Westermühlbach';
		mb3.matrixAutoUpdate = false;
		mb3.matrix.copy(MF.matrix);
		group.add(mb3);
		const slab: THREE.BufferGeometry[] = [];
		const slabBox = (t0: number, t1: number, ya: number, yb: number, c0: number, c1: number) => {
			const g = new THREE.BoxGeometry(t1 - t0, yb - ya, c1 - c0);
			g.translate((t0 + t1) / 2, (ya + yb) / 2, (c0 + c1) / 2);
			slab.push(g);
		};
		const deckTopAt = streetY(ML / 2);
		slabBox(-1.5, ML + 1.5, deckTopAt - 0.85, deckTopAt - 0.05, -MHALF, MHALF);
		// the abutments down into the channel, and the wing walls along the bank
		for (const [t0, t1] of [[-2.5, 2.5], [ML - 2.5, ML + 2.5]] as const) slabBox(t0, t1, -1.5, deckTopAt - 0.85, -MHALF - 0.4, MHALF + 0.4);
		const mouthConcrete = keep(new THREE.MeshStandardMaterial({ color: '#a7a49c', roughness: 0.9 }));
		const slabMesh = new THREE.Mesh(keep(merge(slab)), mouthConcrete);
		slabMesh.castShadow = slabMesh.receiveShadow = true;
		mb3.add(slabMesh);
		// the street and its pavements
		const street: THREE.BufferGeometry[] = [];
		const strip = (c0: number, c1: number, lift: number) => {
			const g = new THREE.BoxGeometry(ML + 3, 0.1, c1 - c0);
			g.translate(ML / 2, deckTopAt - 0.05 + lift, (c0 + c1) / 2);
			street.push(g);
		};
		strip(-3.5, 3.5, 0);
		const streetMesh = new THREE.Mesh(keep(merge(street)), keep(new THREE.MeshStandardMaterial({ color: '#4c4c4a', roughness: 0.9 })));
		streetMesh.receiveShadow = true;
		mb3.add(streetMesh);
		const walks: THREE.BufferGeometry[] = [];
		const strip2 = (c0: number, c1: number) => {
			const g = new THREE.BoxGeometry(ML + 3, 0.25, c1 - c0);
			g.translate(ML / 2, deckTopAt + 0.03, (c0 + c1) / 2);
			walks.push(g);
		};
		strip2(3.5, MHALF);
		strip2(-MHALF, -3.5);
		const walkMesh = new THREE.Mesh(keep(merge(walks)), keep(new THREE.MeshStandardMaterial({ map: gravel(), color: '#cfcac0', roughness: 0.85 })));
		walkMesh.receiveShadow = true;
		mb3.add(walkMesh);
		// steel railings along both edges: posts every two metres, a handrail and a middle rail
		const rail: THREE.BufferGeometry[] = [];
		for (const side of [1, -1]) {
			const c = side * (MHALF - 0.12);
			for (let t = -1; t <= ML + 1; t += 2) {
				const g = new THREE.BoxGeometry(0.06, 1.05, 0.06);
				g.translate(t, deckTopAt + 0.15 + 0.52, c);
				rail.push(g);
			}
			for (const y of [0.55, 1.1]) {
				const g = new THREE.BoxGeometry(ML + 2, 0.05, 0.05);
				g.translate(ML / 2, deckTopAt + 0.15 + y, c);
				rail.push(g);
			}
		}
		const railMesh = new THREE.Mesh(keep(merge(rail)), steel);
		railMesh.castShadow = true;
		mb3.add(railMesh);
		// the spray paint along its face to the river
		const face = new THREE.Mesh(keep(new THREE.PlaneGeometry(ML + 2, 0.8)), sprayMat);
		face.position.set(ML / 2, deckTopAt - 0.45, riverSide * (MHALF + 0.03));
		face.rotation.y = riverSide > 0 ? 0 : Math.PI;
		mb3.add(face);
		// on the slab (beyond it the street itself, at the survey's height)
		mouthDeck = (x, z) => {
			const t = MF.t(x, z), c = MF.c(x, z);
			if (t < -1.5 || t > ML + 1.5 || Math.abs(c) > MHALF - 0.45) return null;
			return deckTopAt + (Math.abs(c) > 3.5 ? 0.15 : 0);
		};
		mouthClear = (x, z, y) => {
			const t = MF.t(x, z), c = MF.c(x, z);
			if (Math.abs(c) > MHALF + 0.9 || y > deckTopAt - 1) return true;
			// in the channel under the slab one may wade, but not into its abutments
			return !((t > -3 && t < 3) || (t > ML - 3 && t < ML + 3));
		};
	}

	/* ══ what the walker needs ═════════════════════════════════════════════════════════════════════════════════ */
	const deckAt = (x: number, z: number) => {
		const t = F.t(x, z), c = F.c(x, z);
		// the Wittelsbacherbrücke's deck, and the street at either end of it, level with it
		if (t >= -6 && t <= L + 6 && Math.abs(c) <= HALF - PW - 0.25) return deckY(t) + (Math.abs(c) > 6.25 ? KERB : 0);
		return mouthDeck(x, z);
	};
	const clear = (x: number, z: number, y: number) => {
		// under the Wittelsbacherbrücke: never into a pier or its nose, and only where an arch leaves headroom
		const t = F.t(x, z), c = F.c(x, z);
		if (t > westFace - 2 && t < L + 2) {
			for (const b of BAYS) if (Math.abs(t - b.t) < b.w / 2 + 0.3 && b.side * c > HALF - 1 && b.side * c < HALF + b.depth + 0.5 && y < b.top) return false;
			if (Math.abs(c) < HALF + 0.35 && y < deckY(t) - 1.0) {
				if (t > eastFace || t < westFace) return false;
				for (const [p0, p1] of PIERS) if (t > p0 - 0.35 && t < p1 + 0.35) return false;
				const a = ARCHES.find((a) => t >= a.t0 && t <= a.t1);
				if (!a || intrados(a, t) - y < 2.05) return false;
			}
		}
		// under the railway bridge: its piers and abutments
		const rt = R.t(x, z), rc = R.c(x, z);
		if (rc > TRUSS.c0 - 4 && rc < MAIN.c1 + 4 && rt > 0 && rt < RL) {
			for (const [p0, p1] of RPIERS) if (rt > p0 - 0.4 && rt < p1 + 0.4 && rc > TRUSS.c0 - 3.8 && rc < MAIN.c1 + 3.8) return false;
			if ((rt > W_ABUT - 6 && rt < W_ABUT + 0.4) || (rt > E_ABUT - 0.4 && rt < E_ABUT + 7)) return false;
		}
		return mouthClear(x, z, y);
	};
	const light = (night: number, k = 1, color?: string) => {
		for (const m of lampMats) {
			m.emissiveIntensity = (0.15 + 2.6 * night) * k;
			if (color) m.emissive.set(color);
		}
		for (const l of lampLights) {
			l.intensity = 18 * night * k;
			if (color) l.color.set(color);
		}
	};
	light(0);

	return {
		group,
		deckAt,
		clear,
		light,
		dispose() {
			for (const d of disposables) d.dispose();
		}
	};
}

/** a point in a bridge's frame, in the world's x, z */
function toWorld(m: THREE.Matrix4, t: number, c: number): [number, number] {
	const v = new THREE.Vector3(t, 0, c).applyMatrix4(m);
	return [v.x, v.z];
}
