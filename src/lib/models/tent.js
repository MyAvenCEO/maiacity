// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE DOME TENT — the Tribe COOP's tent, and the bag it comes in. A 4 m geodesic dome, 2 m high at its middle: a
 * frame of 20 mm steel tubes on round hub plates (a 4-frequency dome, its tubes 0.51 – 0.65 m long, so they pack),
 * a canvas cover over it, a door panel zipped into the cover at its front (+z), a round groundsheet under it, a
 * lantern hanging from its top; on a round timber deck 5.6 m across.
 *
 * It is pitched step by step (domeTent's setPitch, k from 0 to 1): nothing; the groundsheet unrolled from the door to
 * the back and its folded sides laid out flat (0 – 0.2); the frame raised ring by ring from the floor up, the bottom
 * ring first, each ring's tubes put in one after another round it, then its hubs, then the tubes along it (0.2 –
 * 0.75); the cover drawn up from the back over the top (0.75 – 0.94); the door panel let down into its frame (0.94 –
 * 1). The deck is there all along: the tent is pitched on it.
 *
 * The bag (packedTent) is a roll of olive canvas 0.9 m long and 0.4 m thick, two straps buckled round it; set down
 * and unrolled (setOpen), it lies flat with what is in it: the groundsheet rolled, the cover rolled, the frame's tubes
 * in a bundle and the hubs in a sack.
 *
 * THE STORAGE TENT (storageTent, v2 of the Models' tent, Samuel 2026-10-14) is the same dome twice the size, to keep
 * things in (and later taken to the tribe camp): 8 m across and 4 m high, its tubes 40 mm and 1.02 – 1.3 m long
 * (each in two halves joined by a sleeve, so they still pack), a door 1.8 m wide and 3.1 m high to carry things in,
 * on a deck 11.2 m across and as high as the dome tent's; pitched in the same steps. Its bag (storageTentBag) is 1 m
 * long and 0.7 m thick.
 *
 * Each at its real measure (./units.js), standing on the ground at its origin; the tent's door towards +z, the bag
 * along x.
 */
import * as THREE from 'three';
import { std } from './parts';
import { canvasTexture } from './textures';

const m = {
	tube: std('#a9afb3', 0.4, { metalness: 0.7 }),
	hub: std('#55595d', 0.5, { metalness: 0.6 }),
	zip: std('#26282a', 0.7),
	cord: std('#2a2a2a', 0.8),
	bulb: std('#fff1d6', 0.3, { emissive: '#ffcf8a', emissiveIntensity: 0.6 }),
	bag: std('#6b6a48', 0.92),
	strap: std('#1e1f1f', 0.75),
	buckle: std('#111213', 0.45),
	sack: std('#4b4a33', 0.95),
	wood: std('#9a7a52', 0.85)
};

/** the tent's measures: the dome's radius and the deck's, how high the deck's top is, the tubes, the door; and the
 *  parts of its pitching (setPitch: from, to) */
export const DOME_TENT = {
	r: 2,
	deck: 2.8,
	deckTop: 0.15,
	tube: 0.01,
	door: { w: 0.9, h: 1.55, round: 0.28 },
	floor: [0, 0.2],
	frame: [0.2, 0.75],
	cover: [0.75, 0.94],
	doorIn: [0.94, 1]
};

/** the storage tent's measures: the dome tent's, twice the size (the deck as high), pitched in the same steps */
export const STORAGE_TENT = {
	...DOME_TENT,
	r: 4,
	deck: 5.6,
	tube: 0.02,
	door: { w: 1.8, h: 3.1, round: 0.56 }
};

const clamp = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => x * x * (3 - 2 * x);
const span = (k, [a, b]) => clamp((k - a) / (b - a));

/* ── the canvas, the groundsheet and the deck ───────────────────────────────────────────────────────────────── */

/** the groundsheet seen from above (u across x, v from the door to the back): heavy grey-green PVC, a darker hem
 *  round its edge, welded seams across it */
const floorTex = () =>
	canvasTexture('dome-tent-floor', 512, 512, (x, r) => {
		x.fillStyle = '#56604f';
		x.fillRect(0, 0, 512, 512);
		for (let i = 0; i < 2600; i++) {
			x.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.04})`;
			x.fillRect(r() * 512, r() * 512, 2, 2);
		}
		x.strokeStyle = 'rgba(0,0,0,0.18)';
		x.lineWidth = 3;
		for (const v of [0.34, 0.66]) (x.beginPath(), x.moveTo(0, v * 512), x.lineTo(512, v * 512), x.stroke());
		x.strokeStyle = '#3c4337';
		x.lineWidth = 14;
		x.beginPath();
		x.arc(256, 256, 249, 0, Math.PI * 2);
		x.stroke();
	});

/** the deck's boards from above (the cylinder's cap: u, v across it): 14 cm larch boards, their joints staggered */
const deckTex = () =>
	canvasTexture('dome-tent-deck', 512, 512, (x, r) => {
		const n = 40;
		const w = 512 / n;
		for (let i = 0; i < n; i++) {
			const l = 52 + r() * 12;
			x.fillStyle = `hsl(31, 34%, ${l}%)`;
			x.fillRect(i * w, 0, w, 512);
			x.fillStyle = 'rgba(60,40,20,0.12)';
			for (let k = 0; k < 6; k++) x.fillRect(i * w + r() * w, 0, 1, 512);
			x.fillStyle = 'rgba(40,26,12,0.55)';
			x.fillRect(i * w, 0, 1.4, 512);
			const j = r() * 512;
			x.fillRect(i * w, j, w, 1.4);
		}
	});

/* ── the frame: a 4V geodesic hemisphere ──────────────────────────────────────────────────────────────────────── */

/** the door's outline in the front view (x across, y up), counter-clockwise: from under the floor up its sides and
 *  round its top corners */
function doorOutline({ w, h, round }) {
	const a = w / 2;
	const pts = [
		[-a, -0.2],
		[a, -0.2]
	];
	for (let i = 0; i <= 6; i++) {
		const t = (i / 6) * (Math.PI / 2);
		pts.push([a - round + round * Math.cos(t), h - round + round * Math.sin(t)]);
	}
	for (let i = 0; i <= 6; i++) {
		const t = Math.PI / 2 + (i / 6) * (Math.PI / 2);
		pts.push([-a + round + round * Math.cos(t), h - round + round * Math.sin(t)]);
	}
	return pts;
}
/** each tent's door outline, made once */
const outlines = new Map();
const outlineOf = (T) => outlines.get(T) ?? (outlines.set(T, doorOutline(T.door)), outlines.get(T));
/** whether a point is in the doorway of a tent whose door's outline is O: in front, and inside it seen from the front */
function inDoor(p, O) {
	if (p.z <= 0) return false;
	for (let i = 0; i < O.length; i++) {
		const [ax, ay] = O[i];
		const [bx, by] = O[(i + 1) % O.length];
		if ((bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax) < 0) return false;
	}
	return true;
}
/** a point of the door's outline on the dome (x, y as seen from the front), pushed out to radius rr */
const onDome = (x, y, rr) => new THREE.Vector3(x, Math.max(0, y), Math.sqrt(Math.max(0, rr * rr - x * x - Math.max(0, y) ** 2)));

/** the hemisphere of a 4-frequency icosahedron of radius r, a hub at its top: its hubs, its tubes (each a pair of hub
 *  indices), its faces (three hub indices), and the ring of each hub counted from the floor (0) up */
function net(r) {
	const ico = new THREE.IcosahedronGeometry(r, 3);
	const t = (1 + Math.sqrt(5)) / 2;
	ico.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, t, 0).normalize(), new THREE.Vector3(0, 1, 0)));
	// turned so one of the five tubes off the top runs down to the front: the frame is the same on both sides of the door
	const p = ico.attributes.position;
	let best = null;
	for (let i = 0; i < p.count; i++) {
		const y = p.getY(i) / r;
		if (Math.abs(y - 0.968) < 0.01) {
			const az = Math.atan2(p.getX(i), p.getZ(i));
			if (!best || Math.abs(az) < Math.abs(best)) best = az;
		}
	}
	ico.rotateY(-best);
	const hubs = [];
	const index = new Map();
	const at = (i) => {
		const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
		if (Math.abs(v.y) < 1e-4) v.y = 0;
		const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
		if (!index.has(key)) (index.set(key, hubs.length), hubs.push(v));
		return index.get(key);
	};
	const faces = [];
	const tubes = new Map();
	for (let i = 0; i < p.count; i += 3) {
		if (Math.min(p.getY(i), p.getY(i + 1), p.getY(i + 2)) < -1e-4 * r) continue;
		const f = [at(i), at(i + 1), at(i + 2)];
		faces.push(f);
		for (let k = 0; k < 3; k++) {
			const a = f[k], b = f[(k + 1) % 3];
			tubes.set(a < b ? `${a}:${b}` : `${b}:${a}`, a < b ? [a, b] : [b, a]);
		}
	}
	ico.dispose();
	// the rings: the hubs on the floor, then each hub one tube further up from those below it
	const ring = hubs.map((v) => (v.y === 0 ? 0 : -1));
	const next = hubs.map(() => []);
	for (const [a, b] of tubes.values()) (next[a].push(b), next[b].push(a));
	for (let n = 0, grew = true; grew; n++) {
		grew = false;
		hubs.forEach((_, i) => {
			if (ring[i] !== n) return;
			for (const j of next[i]) if (ring[j] < 0) ((ring[j] = n + 1), (grew = true));
		});
	}
	return { hubs, tubes: [...tubes.values()], faces, ring };
}

/** the parts of a tube a→b outside the doorway, each [from, to] along it (0 … 1) */
function outsideDoor(a, b, O) {
	const N = 40;
	const out = [];
	let from = null;
	for (let i = 0; i <= N; i++) {
		const t = i / N;
		const o = !inDoor(a.clone().lerp(b, t), O);
		if (o && from === null) from = t;
		if ((!o || i === N) && from !== null) {
			const to = o ? t : (i - 0.5) / N;
			if (to - from > 0.04) out.push([from, to]);
			from = null;
		}
	}
	return out;
}

/** a tube along a path, shown up to how far along it (count of its segments): for the door's frame and its zip */
function pathTube(pts, radius, mat) {
	const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
	const segs = pts.length * 3;
	const geo = new THREE.TubeGeometry(curve, segs, radius, 6, false);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = true;
	const ys = Array.from({ length: segs + 1 }, (_, i) => curve.getPointAt(i / segs).y);
	/** shown up to the point where it first reaches past height y (rising), or a part of it (0 … 1) */
	mesh.userData.show = (k) => {
		const n = Math.round(clamp(k) * segs);
		geo.setDrawRange(0, n * 6 * 6);
		mesh.visible = n > 0;
	};
	mesh.userData.upTo = (y) => {
		let n = 0;
		while (n < segs && ys[n + 1] <= y + 1e-6) n++;
		mesh.userData.show(n / segs);
	};
	return mesh;
}

/* ── the cover: the frame's faces, each cut in sixteen, pulled out over the tubes ──────────────────────────────── */

/** a convex polygon (front view) cut by one side of a line: keep where the side test is >= 0 (inside) or <= 0 */
function clipBy(poly, a, b, keepInside) {
	const s = (p) => ((b[0] - a[0]) * (p.y - a[1]) - (b[1] - a[1]) * (p.x - a[0])) * (keepInside ? 1 : -1);
	const out = [];
	for (let i = 0; i < poly.length; i++) {
		const p = poly[i], q = poly[(i + 1) % poly.length];
		const sp = s(p), sq = s(q);
		if (sp >= 0) out.push(p);
		if (sp >= 0 !== sq >= 0) out.push(p.clone().lerp(q, sp / (sp - sq)));
	}
	return out;
}
/** a small triangle split at the door's outline (front view): its parts outside the door, and its part in it */
function splitAtDoor(tri, T) {
	const O = outlineOf(T);
	if (tri.every((p) => p.z <= 0) || tri.every((p) => !inDoor(p, O) && Math.abs(p.x) > T.door.w)) return { out: [tri], in: [] };
	const outside = [];
	let rest = tri;
	for (let i = 0; i < O.length && rest.length >= 3; i++) {
		const a = O[i], b = O[(i + 1) % O.length];
		const piece = clipBy(rest, a, b, false);
		if (piece.length >= 3) outside.push(piece);
		rest = clipBy(rest, a, b, true);
	}
	return { out: outside, in: rest.length >= 3 ? [rest] : [] };
}
/** triangles (fans of polygons) into one geometry: a facet's own normal blended with the dome's, so its panels show
 *  but it reads round; its order kept */
function panelGeometry(polys, rr, r) {
	const pos = [], nor = [];
	const n = new THREE.Vector3();
	for (const poly of polys) {
		n.copy(poly[1]).sub(poly[0]).cross(poly[2].clone().sub(poly[0])).normalize();
		for (let i = 1; i + 1 < poly.length; i++)
			for (const p of [poly[0], poly[i], poly[i + 1]]) {
				const q = p.clone().multiplyScalar(rr / r);
				pos.push(q.x, q.y, q.z);
				const b = n.clone().multiplyScalar(0.6).addScaledVector(q.clone().normalize(), 0.4).normalize();
				nor.push(b.x, b.y, b.z);
			}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	return geo;
}

/* ── the tent ───────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The Tribe COOP's dome tent, pitched as far as k (0 nothing, 1 pitched): setPitch(k) moves it on. userData: shell
 * (the cover, its material warm when lit from within: emissiveIntensity), door (the door panel, of the same canvas),
 * lamp (the light in it, off), deck, floor, frame ({ tubes, hubs, arch }), pitch (how far), setPitch, and work(k):
 * where the work is at k, in the tent's frame (the groundsheet's roll, the tube going in, the cover's edge, the door).
 */
export function domeTent({ pitch = 1, deck = true } = {}) {
	return pitched(DOME_TENT, { pitch, deck });
}

/** The storage tent (the dome tent twice the size), pitched as far as `pitch`: userData as domeTent's. */
export function storageTent({ pitch = 1, deck = true } = {}) {
	return pitched(STORAGE_TENT, { pitch, deck });
}

/**
 * A dome tent of the measures T (DOME_TENT, STORAGE_TENT), pitched as far as `pitch`: the frame, the cover, the door,
 * the groundsheet and the lantern all at T's size (S: how many times the dome tent's), the deck as high as T says.
 */
function pitched(T, { pitch = 1, deck = true } = {}) {
	const { r, tube } = T;
	const S = r / DOME_TENT.r;
	const O = outlineOf(T);
	const g = new THREE.Group();
	const base = deck ? T.deckTop : 0;

	// the deck: larch boards on a ring of posts, its rim
	let deckMesh = null;
	if (deck) {
		const top = new THREE.MeshStandardMaterial({ map: deckTex(), roughness: 0.85 });
		deckMesh = new THREE.Mesh(new THREE.CylinderGeometry(T.deck, T.deck, 0.2, 48), [m.wood(), top, m.wood()]);
		deckMesh.position.y = base - 0.1;
		deckMesh.receiveShadow = deckMesh.castShadow = true;
		g.add(deckMesh);
	}

	// the dome stands on the groundsheet, its floor ring of tubes and hubs resting on it
	const dome = new THREE.Group();
	dome.position.y = base + 0.004 + tube;
	g.add(dome);
	const { hubs, tubes, faces, ring } = net(r);
	const rings = Math.max(...ring) + 1;
	const ringY = Array.from({ length: rings }, (_, n) => Math.max(...hubs.filter((_, i) => ring[i] === n).map((v) => v.y)));
	const az = (v) => (Math.atan2(v.x, v.z) + Math.PI * 2) % (Math.PI * 2); // round from the door, to its left

	// the tubes: each part of a tube outside the doorway, in the ring of its upper hub; a tube up to a ring is put in
	// before those along it
	const pieces = [];
	for (const [a, b] of tubes) {
		const [lo, hi] = hubs[a].y <= hubs[b].y ? [a, b] : [b, a];
		const along = ring[lo] === ring[hi];
		for (const [t0, t1] of outsideDoor(hubs[lo], hubs[hi], O)) {
			const p0 = hubs[lo].clone().lerp(hubs[hi], t0), p1 = hubs[lo].clone().lerp(hubs[hi], t1);
			pieces.push({ p0, p1, ring: ring[hi], along, az: az(p0.clone().add(p1)) });
		}
	}
	const kept = hubs.map((v, i) => ({ v, i, ring: ring[i], az: az(v) })).filter((h) => !inDoor(h.v, O));
	// when each goes in, as a part of the frame's time (0 … 1): ring by ring; in a ring, round from the door
	const slot = 1 / rings;
	for (let n = 0; n < rings; n++) {
		const up = pieces.filter((s) => s.ring === n && !s.along).sort((a, b) => a.az - b.az);
		const al = pieces.filter((s) => s.ring === n && s.along).sort((a, b) => a.az - b.az);
		const hs = kept.filter((h) => h.ring === n).sort((a, b) => a.az - b.az);
		const t0 = n * slot;
		up.forEach((s, i) => ((s.at = t0 + slot * 0.45 * (i / Math.max(1, up.length))), (s.dur = slot * 0.2)));
		hs.forEach((h, i) => ((h.at = t0 + slot * (n === 0 ? 0 : 0.2) + slot * 0.45 * (i / Math.max(1, hs.length))), (h.dur = slot * 0.08)));
		al.forEach((s, i) => ((s.at = t0 + slot * 0.5 + slot * 0.35 * (i / Math.max(1, al.length))), (s.dur = slot * 0.15)));
	}

	const tubeGeo = new THREE.CylinderGeometry(tube, tube, 1, 8, 1, true).translate(0, 0.5, 0);
	const tubeMesh = new THREE.InstancedMesh(tubeGeo, m.tube(), pieces.length);
	const hubGeo = new THREE.CylinderGeometry(0.036 * S, 0.036 * S, 0.024 * S, 12);
	const hubMesh = new THREE.InstancedMesh(hubGeo, m.hub(), kept.length);
	tubeMesh.castShadow = hubMesh.castShadow = true;
	tubeMesh.frustumCulled = hubMesh.frustumCulled = false;
	dome.add(tubeMesh, hubMesh);
	const UP = new THREE.Vector3(0, 1, 0);
	const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3();
	for (const s of pieces) ((s.len = s.p0.distanceTo(s.p1)), (s.q = new THREE.Quaternion().setFromUnitVectors(UP, s.p1.clone().sub(s.p0).normalize())));
	for (const h of kept) h.q = new THREE.Quaternion().setFromUnitVectors(UP, h.v.clone().normalize());

	// the door's frame: a bent tube round the doorway, on the dome, put up from the floor as the rings rise
	const half = (sx, rr) => {
		const { w, h, round } = T.door;
		const a = w / 2;
		const pts = [];
		for (let i = 0; i <= 6; i++) pts.push([a, ((h - round) * i) / 6]); // up its side
		for (let i = 1; i <= 6; i++) pts.push([a - round + round * Math.cos((i / 6) * (Math.PI / 2)), h - round + round * Math.sin((i / 6) * (Math.PI / 2))]);
		pts.push([(a - round) / 2, h], [0, h]);
		return pts.map(([x, y]) => onDome(sx * x, y, rr));
	};
	const arch = new THREE.Group();
	for (const sx of [-1, 1]) arch.add(pathTube(half(sx, r), 0.016 * S, m.tube()));
	dome.add(arch);

	// the cover and its door: every face cut in sixteen, the parts in the doorway the door panel
	const shellMat = new THREE.MeshStandardMaterial({ color: 0xf1e8d4, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffb15e, emissiveIntensity: 0 });
	const outside = [], inside = [];
	const N = 4;
	for (const [a, b, c] of faces) {
		const A = hubs[a], B = hubs[b], C = hubs[c];
		const P = (i, j) => A.clone().addScaledVector(B.clone().sub(A), i / N).addScaledVector(C.clone().sub(A), j / N);
		for (let i = 0; i < N; i++)
			for (let j = 0; j < N - i; j++) {
				const tris = [[P(i, j), P(i + 1, j), P(i, j + 1)]];
				if (i + j < N - 1) tris.push([P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]);
				for (const tri of tris) {
					const cut = splitAtDoor(tri, T);
					outside.push(...cut.out);
					inside.push(...cut.in);
				}
			}
	}
	// drawn up from the back over the top: the cover's parts in the order the edge reaches them
	const over = (p) => Math.atan2(p.y, -p.z);
	const mid = (poly) => poly.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(poly.length);
	outside.sort((a, b) => over(mid(a)) - over(mid(b)));
	inside.sort((a, b) => mid(b).y - mid(a).y); // let down from the top
	const COVER_R = r + 0.03 * S;
	const shellGeo = panelGeometry(outside, COVER_R, r);
	const shell = new THREE.Mesh(shellGeo, shellMat);
	shell.castShadow = true;
	const doorPanel = new THREE.Mesh(panelGeometry(inside, COVER_R + 0.004 * S, r), shellMat);
	doorPanel.castShadow = true;
	dome.add(shell, doorPanel);
	const tris = (geo) => geo.attributes.position.count / 3;
	const coverAt = Array.from({ length: tris(shellGeo) }, (_, i) => {
		const pa = shellGeo.attributes.position;
		return over(new THREE.Vector3(pa.getX(i * 3) + pa.getX(i * 3 + 1) + pa.getX(i * 3 + 2), pa.getY(i * 3) + pa.getY(i * 3 + 1) + pa.getY(i * 3 + 2), pa.getZ(i * 3) + pa.getZ(i * 3 + 1) + pa.getZ(i * 3 + 2)));
	});
	const rest = shellGeo.attributes.position.array.slice();
	const restAt = Array.from({ length: shellGeo.attributes.position.count }, (_, i) => over(new THREE.Vector3(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2])));
	// the zip round the door panel, closed from the top down
	const zip = new THREE.Group();
	for (const sx of [-1, 1]) zip.add(pathTube(half(sx, COVER_R + 0.006 * S).reverse(), 0.007 * S, m.zip()));
	dome.add(zip);

	// the lantern hung from the top hub on its cord, the light in it
	const lantern = new THREE.Group();
	const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.42 * S, 4), m.cord());
	cord.position.y = r - 0.21 * S;
	const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05 * S, 14, 10), m.bulb());
	bulb.position.y = r - 0.47 * S;
	const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * S, 0.03 * S, 0.04 * S, 10), m.hub());
	cap.position.y = r - 0.43 * S;
	lantern.add(cord, bulb, cap);
	dome.add(lantern);
	const lamp = new THREE.PointLight(0xffb36a, 0, 14 * S, 1.6);
	lamp.position.set(0, r - 0.47 * S, 0);
	dome.add(lamp);

	// the groundsheet: rows from the door (s = 0) to the back (s = 2R), folded in three along its length and rolled up
	const FR = r + 0.02 * S;
	const COLS = 30, ROWS = 120;
	const fgeo = new THREE.PlaneGeometry(1, 1, COLS, ROWS);
	const flat = [];
	for (let j = 0; j <= ROWS; j++) {
		const s = (j / ROWS) * 2 * FR;
		const w = Math.sqrt(Math.max(0, FR * FR - (FR - s) ** 2));
		for (let i = 0; i <= COLS; i++) flat.push([Math.min(w, Math.max(-w, FR - (2 * FR * i) / COLS)), s]);
	}
	// PlaneGeometry's vertices run row by row from its top: row j of ours is its row j
	const fuv = fgeo.attributes.uv;
	flat.forEach(([x, s], i) => fuv.setXY(i, x / (2 * FR) + 0.5, 1 - s / (2 * FR)));
	const floorMat = new THREE.MeshStandardMaterial({ map: floorTex(), roughness: 0.75, side: THREE.DoubleSide });
	const floor = new THREE.Mesh(fgeo, floorMat);
	floor.receiveShadow = true;
	floor.castShadow = true;
	floor.frustumCulled = false;
	floor.position.y = base;
	g.add(floor);
	const FOLD = FR / 3, SHEET = 0.004, CORE = 0.025, THICK = 0.012;
	/** the groundsheet as far as k of its part: unrolled (0 … 0.65), its folded sides opened out (… 1) */
	function layFloor(k) {
		const u = 2 * FR * ease(clamp(k / 0.65)); // how far it is unrolled from the door
		const open = ease(clamp((k - 0.65) / 0.35));
		const ang = Math.PI * (1 - open);
		const L = 2 * FR - u;
		const R = Math.sqrt(CORE * CORE + (THICK * L) / Math.PI); // the roll: what is left of it, wound up
		const z0 = FR - u;
		const pa = fgeo.attributes.position;
		flat.forEach(([x, s], i) => {
			// folded: each side over the middle third, the left one over the right
			let fx = x, fy = 0;
			const d = Math.abs(x) - FOLD;
			if (d > 0) {
				const sx = Math.sign(x);
				fx = sx * (FOLD + d * Math.cos(ang));
				fy = d * Math.sin(ang) + (1 - open) * SHEET * (sx < 0 ? 2 : 1);
			}
			if (s <= u) return pa.setXYZ(i, fx, fy + 0.002, FR - s);
			// rolled: wound inwards from the roll's outside, each turn a sheet's thickness smaller
			const dd = s - u;
			const rho = Math.sqrt(Math.max(CORE * CORE, R * R - (THICK * dd) / Math.PI));
			const th = ((2 * Math.PI) / THICK) * (R - rho);
			const rr = rho - fy;
			pa.setXYZ(i, fx, R - rr * Math.cos(th) + 0.002, z0 - rr * Math.sin(th));
		});
		pa.needsUpdate = true;
		fgeo.computeVertexNormals();
		fgeo.boundingBox = fgeo.boundingSphere = null;
		return { roll: new THREE.Vector3(0, base + R, z0), R };
	}

	let at = -1;
	let lifted = false;
	/** how far the tent is pitched: 0 nothing, 1 standing, its door in */
	function setPitch(k) {
		k = clamp(k);
		if (k === at) return;
		at = k;
		g.userData.pitch = k;
		// the groundsheet
		const fk = span(k, T.floor);
		floor.visible = k > 0;
		if (floor.visible) g.userData.roll = layFloor(fk);
		// the frame, ring by ring
		const f = span(k, T.frame);
		pieces.forEach((s, i) => {
			const grow = f >= 1 ? 1 : ease(clamp((f - s.at) / s.dur));
			if (grow <= 0) mx.makeScale(0, 0, 0);
			else mx.compose(s.p0, s.q, s3.set(1, s.len * grow, 1));
			tubeMesh.setMatrixAt(i, mx);
		});
		kept.forEach((h, i) => {
			const pop = f >= 1 ? 1 : ease(clamp((f - h.at) / h.dur));
			if (pop <= 0) mx.makeScale(0, 0, 0);
			else mx.compose(h.v, h.q, s3.setScalar(pop));
			hubMesh.setMatrixAt(i, mx);
		});
		tubeMesh.instanceMatrix.needsUpdate = hubMesh.instanceMatrix.needsUpdate = true;
		tubeMesh.boundingBox = tubeMesh.boundingSphere = hubMesh.boundingBox = hubMesh.boundingSphere = null;
		tubeMesh.visible = hubMesh.visible = f > 0;
		// the door's frame as high as the rings are up
		const n = Math.min(rings - 1, Math.floor(f * rings));
		const top = f >= 1 ? r : THREE.MathUtils.lerp(n > 0 ? ringY[n - 1] : 0, ringY[n], clamp((f * rings - n) / 0.45));
		for (const a of arch.children) a.userData.upTo(f > 0 ? top : -1);
		lantern.visible = f >= 1;
		// the cover drawn up from the back over the top; where it has just come it lifts off the tubes and settles
		const c = span(k, T.cover);
		const edge = -0.05 + (Math.PI + 0.4) * ease(c);
		let on = 0;
		while (on < coverAt.length && coverAt[on] <= edge) on++;
		shellGeo.setDrawRange(0, on * 3);
		shell.visible = on > 0;
		const settle = c > 0 && c < 1;
		if (settle || lifted) {
			const pa = shellGeo.attributes.position;
			for (let i = 0; i < pa.count; i++) {
				const l = 1 + (settle ? 0.09 * S * (1 - clamp((edge - restAt[i]) / 0.35)) : 0) / COVER_R;
				pa.setXYZ(i, rest[i * 3] * l, rest[i * 3 + 1] * l, rest[i * 3 + 2] * l);
			}
			pa.needsUpdate = true;
			lifted = settle;
		}
		// the door panel let down from the top, its zip closed after it
		const d = span(k, T.doorIn);
		const dn = Math.round(ease(d) * tris(doorPanel.geometry));
		doorPanel.geometry.setDrawRange(0, dn * 3);
		doorPanel.visible = dn > 0;
		for (const z of zip.children) z.userData.show(ease(d));
	}
	/** where the work is at k, in the tent's frame: the groundsheet's roll, the tube going in, the cover's edge at the
	 *  top of its sweep, the door */
	function work(k) {
		k = clamp(k);
		if (k <= T.floor[1]) {
			const R = g.userData.roll?.R ?? 0.1;
			const u = 2 * FR * ease(clamp(span(k, T.floor) / 0.65));
			return new THREE.Vector3(0, base + R, FR - u);
		}
		const off = dome.position;
		if (k <= T.frame[1]) {
			const f = span(k, T.frame);
			const s = pieces.filter((p) => p.at <= f).sort((a, b) => b.at - a.at)[0] ?? pieces[0];
			return s.p1.clone().add(off);
		}
		if (k <= T.cover[1]) {
			const e = Math.min(Math.PI, -0.05 + (Math.PI + 0.4) * ease(span(k, T.cover)));
			return new THREE.Vector3(0, Math.sin(e) * COVER_R, -Math.cos(e) * COVER_R).add(off);
		}
		return onDome(0, T.door.h, COVER_R).add(off);
	}

	g.userData = { shell, door: doorPanel, lamp, deck: deckMesh, floor, frame: { tubes: tubeMesh, hubs: hubMesh, arch }, pitch, setPitch, work };
	setPitch(pitch);
	return g;
}

/* ── the bag ────────────────────────────────────────────────────────────────────────────────────────────────── */

/** the bag's measures: its length and its radius rolled up */
export const TENT_BAG = { len: 0.9, r: 0.2 };

/**
 * The tent's bag: olive canvas rolled round what is in it, two straps buckled over its top; open (0 rolled … 1 lying
 * flat), its straps undone and the canvas unrolled, what was in it settled on it. userData: setOpen, open, parts
 * ({ floor, cover, tubes, hubs }: the groundsheet's roll, the cover's roll, the tubes' bundle, the hubs' sack, to be
 * taken off it as the tent is pitched).
 */
export function packedTent({ open = 0 } = {}) {
	return bagged(TENT_BAG, { open });
}

/** the storage tent's bag: its length and its radius rolled up */
export const STORAGE_TENT_BAG = { len: 1, r: 0.35 };

/** The storage tent's bag, open as far as `open`: userData as packedTent's. */
export function storageTentBag({ open = 0 } = {}) {
	return bagged(STORAGE_TENT_BAG, { open });
}

/** the bag of measures B (TENT_BAG, STORAGE_TENT_BAG): what is in it as much thicker as it is (fr) and as much longer
 *  (fl) as the dome tent's */
function bagged(B, { open = 0 } = {}) {
	const { len, r } = B;
	const fr = r / TENT_BAG.r, fl = len / TENT_BAG.len;
	const g = new THREE.Group();
	const W = 2 * Math.PI * r; // the canvas's width round the roll
	/** a sheet of the canvas (x0 … x1 along the bag) at radius rr round its middle, as open as k */
	const sheet = (x0, x1, rr, mat, cols, rows) => {
		const geo = new THREE.PlaneGeometry(1, 1, cols, rows);
		const mesh = new THREE.Mesh(geo, mat);
		mesh.castShadow = true;
		mesh.frustumCulled = false;
		mesh.userData.lay = (k) => {
			const pa = geo.attributes.position;
			const bend = (1 - k) / r; // how curved the canvas still is
			for (let j = 0; j <= rows; j++) {
				const a = (j / rows - 0.5) * W * (rr / r); // along the canvas round the roll, from its middle underneath
				for (let i = 0; i <= cols; i++) {
					const x = x1 - ((x1 - x0) * i) / cols; // so its face is outwards
					const idx = j * (cols + 1) + i;
					if (bend < 1e-4) pa.setXYZ(idx, x, 0.002 - (rr - r) * 0.25, a);
					else {
						const rho = 1 / bend + (rr - r);
						const b = a / rho;
						pa.setXYZ(idx, x, 0.002 + 1 / bend - rho * Math.cos(b), rho * Math.sin(b));
					}
				}
			}
			pa.needsUpdate = true;
			geo.computeVertexNormals();
			geo.boundingBox = geo.boundingSphere = null;
		};
		return mesh;
	};
	const bagMat = m.bag().clone();
	bagMat.side = THREE.DoubleSide;
	const canvas = sheet(-len / 2, len / 2, r, bagMat, 10, 40);
	g.add(canvas);
	const straps = [-0.26 * fl, 0.26 * fl].map((x) => sheet(x - 0.02 * fr, x + 0.02 * fr, r + 0.004, m.strap(), 1, 40));
	g.add(...straps);
	const buckles = [-0.26 * fl, 0.26 * fl].map((x) => {
		const b = new THREE.Mesh(new THREE.BoxGeometry(0.05 * fr, 0.012, 0.04 * fr), m.buckle());
		b.position.set(x, 2 * r + 0.006, 0);
		g.add(b);
		return b;
	});
	// a carry handle lying along its top, sewn to one edge of the canvas at both its ends
	const handle = new THREE.Mesh(new THREE.BoxGeometry(0.3 * fl, 0.006, 0.035 * fr), m.strap());
	handle.position.set(0, 2 * r + 0.003, 0.015 * fr);
	g.add(handle);

	// what is in it: where it lies rolled up (in the roll's section: z across, y up) and where it settles on the open
	// canvas
	const floorTexture = floorTex();
	const roll = (rad, l, mat) => {
		const o = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, l, 18).rotateZ(Math.PI / 2), mat);
		o.castShadow = true;
		return o;
	};
	const floorRoll = roll(0.075 * fr, 0.86 * fl, new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.75 }));
	const coverRoll = roll(0.075 * fr, 0.84 * fl, std('#e6dcc4', 0.9)());
	const tubes = new THREE.Group();
	for (let i = 0; i < 19; i++) {
		const ringN = i === 0 ? 0 : i < 7 ? 1 : 2;
		const a = ringN === 1 ? ((i - 1) / 6) * Math.PI * 2 : ((i - 7) / 12) * Math.PI * 2 + 0.26;
		const t = new THREE.Mesh(new THREE.CylinderGeometry(0.01 * fr, 0.01 * fr, 0.62 * fl, 8).rotateZ(Math.PI / 2), m.tube());
		t.position.set(0, Math.sin(a) * 0.021 * fr * ringN, Math.cos(a) * 0.021 * fr * ringN);
		t.castShadow = true;
		tubes.add(t);
	}
	for (const x of [-0.2 * fl, 0.2 * fl]) {
		const tie = new THREE.Mesh(new THREE.TorusGeometry(0.052 * fr, 0.006, 6, 18).rotateY(Math.PI / 2), m.strap());
		tie.position.x = x;
		tubes.add(tie);
	}
	const hubSack = new THREE.Group();
	const sackBody = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * fr, 0.05 * fr, 0.16 * fl, 12).rotateZ(Math.PI / 2), m.sack());
	const sackTie = new THREE.Mesh(new THREE.TorusGeometry(0.026 * fr, 0.005, 6, 12).rotateY(Math.PI / 2), m.cord());
	sackTie.position.x = 0.085 * fl;
	hubSack.add(sackBody, sackTie);
	sackBody.castShadow = true;
	const parts = { floor: floorRoll, cover: coverRoll, tubes, hubs: hubSack };
	const places = {
		floor: [new THREE.Vector3(0, 0.12, -0.08), new THREE.Vector3(0, 0.078, -0.22)],
		cover: [new THREE.Vector3(0, 0.12, 0.08), new THREE.Vector3(0, 0.078, 0.0)],
		tubes: [new THREE.Vector3(-0.11, 0.275, 0), new THREE.Vector3(-0.11, 0.058, 0.2)],
		hubs: [new THREE.Vector3(0.32, 0.27, 0), new THREE.Vector3(0.32, 0.053, 0.2)]
	};
	for (const ends of Object.values(places)) for (const v of ends) v.set(v.x * fl, v.y * fr, v.z * fr);
	for (const o of Object.values(parts)) g.add(o);

	let at = -1;
	function setOpen(k) {
		k = clamp(k);
		if (k === at) return;
		at = k;
		g.userData.open = k;
		const lay = ease(clamp((k - 0.12) / 0.88));
		for (const s of [canvas, ...straps]) s.userData.lay(lay);
		for (const b of buckles) b.visible = k < 0.08;
		handle.visible = lay < 0.02;
		for (const [name, [from, to]] of Object.entries(places)) parts[name].position.lerpVectors(from, to, ease(clamp((k - 0.3) / 0.7)));
	}
	g.userData = { open, setOpen, parts };
	setOpen(open);
	return g;
}
