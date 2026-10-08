/**
 * SANDBOX 6 · ONE HEX · THE WORLD — the two hexes in three.js at their real size, a metre a unit: the land painted
 * from its land-use raster (./layout.js), the domes as glazed geodesic caps with their cold north side closed in hemp, the
 * tower with its floors, and what grows on the land and under the glass.
 *
 * Everything an overlay can hide sits in its own group (`layers`), so the page toggles them: the land-use colours,
 * the glass shells, what is inside, the plants, the hex outlines, the dimension lines. Labels are anchors the page
 * draws in HTML (./world.js).
 */
import * as THREE from 'three';
import { capOf, CORE_R, FACADE, KINDS, geodesicOf, towerGridOf, towerLevels, towerRadius } from './specs.js';
import { CELL, HEX_S, HEX_W, POND_BAND, POND_HALF, USES, USE_IDS, corners, footR, landOf } from './layout.js';

/** @type {Map<string, THREE.MeshStandardMaterial>} */
const mats = new Map();
/** one material per colour */
const mat = (/** @type {string} */ color, rough = 0.85, flat = true) => {
	const k = `${color}/${rough}/${flat}`;
	let m = mats.get(k);
	if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: flat })));
	return m;
};
/** the three kinds of panel: clear glass (the plants' daylight), solar panels (dark blue, their cells see-through), white hemp */
const GLASS = new THREE.MeshStandardMaterial({ color: '#d4ecf0', transparent: true, opacity: 0.17, roughness: 0.06, metalness: 0.25, side: THREE.DoubleSide, depthWrite: false });
const SOLAR = new THREE.MeshStandardMaterial({ color: '#1f3a5c', transparent: true, opacity: 0.8, roughness: 0.22, metalness: 0.45, side: THREE.DoubleSide, depthWrite: false });
const HEMP = new THREE.MeshStandardMaterial({ color: '#eee8dc', roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
const STRUT = new THREE.LineBasicMaterial({ color: '#6b5236', transparent: true, opacity: 0.55 });
const DIM = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false });
const STONE = '#9d978c';

/** the colours of the tower's floors, by use (the land-use map's where they match) */
export const FLOOR_COLOURS = { utilities: USES.utilities.map, factory: USES.factory.map, park: '#5fae4a', community: '#e07a5f', offices: '#4a90c2', hotel: '#d9a03f', apartments: '#c2557a', sky: '#f2d16b' };

/** @param {THREE.BufferGeometry} geo @param {THREE.Material} m */
function part(geo, m, x = 0, y = 0, z = 0, shadow = true) {
	const mesh = new THREE.Mesh(geo, m);
	mesh.position.set(x, y, z);
	mesh.castShadow = shadow;
	mesh.receiveShadow = true;
	return mesh;
}

/** a random number generator from a seed */
function rng(seed = 1) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

/**
 * A sector of an annulus standing on the floor, `y0` to `y1`, from bearing `b0` to `b1` (degrees, clockwise from
 * north): galleries of homes, a pond, a crescent of offices.
 */
function sector(/** @type {number} */ rIn, /** @type {number} */ rOut, /** @type {number} */ y0, /** @type {number} */ y1, /** @type {number} */ b0, /** @type {number} */ b1, /** @type {THREE.Material} */ m) {
	// in the shape's plane, angle t sits at bearing 90 − t once the shape is laid down (x east, −z north)
	const t0 = ((90 - b1) * Math.PI) / 180, t1 = ((90 - b0) * Math.PI) / 180;
	const s = new THREE.Shape();
	s.absarc(0, 0, rOut, t0, t1, false);
	s.absarc(0, 0, rIn, t1, t0, true);
	const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.05, y1 - y0), bevelEnabled: false, curveSegments: 24 });
	geo.rotateX(-Math.PI / 2);
	const mesh = part(geo, m, 0, y0, 0);
	return mesh;
}

/**
 * A shell's panels drawn one by one: a mesh for each kind (hemp, glass, solar) and the struts along every panel edge.
 * @param {{ p: number[], kind: 'hemp' | 'glass' | 'solar' }[]} panels
 */
function panelParts(panels) {
	/** @type {Record<string, number[]>} */
	const by = { hemp: [], glass: [], solar: [] };
	/** @type {Set<string>} */
	const seen = new Set();
	/** @type {number[]} */
	const lines = [];
	for (const { p, kind } of panels) {
		by[kind].push(...p);
		for (let e = 0; e < 3; e++) {
			const a = p.slice(e * 3, e * 3 + 3), b = p.slice(((e + 1) % 3) * 3, ((e + 1) % 3) * 3 + 3);
			const ka = a.map((x) => Math.round(x * 100)).join(','), kb = b.map((x) => Math.round(x * 100)).join(',');
			const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
			if (seen.has(key)) continue;
			seen.add(key);
			lines.push(...a, ...b);
		}
	}
	const mesh = (/** @type {number[]} */ pos) => {
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		geo.computeVertexNormals();
		return geo;
	};
	const strutGeo = new THREE.BufferGeometry();
	strutGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
	return { hemp: mesh(by.hemp), glass: mesh(by.glass), solar: mesh(by.solar), struts: strutGeo };
}
/** each dome size's panels, built once @type {Map<number, ReturnType<typeof panelParts>>} */
const domeParts = new Map();
/** the meshes of a shell's panels and struts */
function shellMeshes(/** @type {ReturnType<typeof panelParts>} */ pp) {
	const glass = new THREE.Mesh(pp.glass, GLASS), solar = new THREE.Mesh(pp.solar, SOLAR), hemp = new THREE.Mesh(pp.hemp, HEMP);
	glass.renderOrder = solar.renderOrder = 2;
	hemp.castShadow = hemp.receiveShadow = true;
	return [glass, solar, hemp, new THREE.LineSegments(pp.struts, STRUT)];
}

/** the parts of a building the overlays switch: its shell (glass, hemp, struts), its inside, its dimension lines */
function siteGroups() {
	return { root: new THREE.Group(), shell: new THREE.Group(), inside: new THREE.Group(), dims: new THREE.Group() };
}

/**
 * A geodesic cap D across on its stone plinth, panel by panel: white hemp on its cold north side, glass and solar
 * panels alternating everywhere else.
 * @param {number} D
 */
function domeShell(D) {
	const c = capOf(D);
	const g = siteGroups();
	g.root.add(g.shell, g.inside, g.dims);
	g.root.add(part(new THREE.CylinderGeometry(c.a + 0.5, c.a + 0.9, 1.2, 64, 1, true), mat(STONE), 0, 0.6, 0));
	let pp = domeParts.get(D);
	if (!pp) domeParts.set(D, (pp = panelParts(geodesicOf(D).panels)));
	g.shell.add(...shellMeshes(pp));
	// the dimension lines: across the foot west to east, and up the middle to the crown
	const dimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-c.a, 1.5, 0), new THREE.Vector3(c.a, 1.5, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, c.h, 0)]);
	g.dims.add(new THREE.LineSegments(dimGeo, DIM));
	// the hit volume for picking
	const hit = new THREE.Mesh(new THREE.CylinderGeometry(c.a, c.a, c.h, 24), new THREE.MeshBasicMaterial({ visible: false }));
	hit.position.y = c.h / 2;
	g.root.add(hit);
	return { ...g, hit, height: c.h, r: c.a };
}

/** the homes, the pond and the garden floor of a home dome */
function homeInside(/** @type {any} */ K, /** @type {THREE.Group} */ inside) {
	const c = capOf(K.D);
	const g = K.gallery;
	inside.add(part(new THREE.CircleGeometry(c.a - 0.3, 64).rotateX(-Math.PI / 2), mat('#5e8a3e', 1), 0, 0.08, 0, false));
	inside.add(sector(g.pondIn, g.rIn, 0.06, 0.14, -90, 90, mat('#3f86a6', 0.2)));
	// two storeys of homes in a crescent along the north, a darker band between them
	inside.add(sector(g.rIn, g.rOut, 0, 3.1, -90, 90, mat('#efe3c8')));
	inside.add(sector(g.rIn - 0.2, g.rOut + 0.2, 3.1, 3.4, -90, 90, mat('#8a6a48')));
	inside.add(sector(g.rIn, g.rOut, 3.4, 6.4, -90, 90, mat('#e8dcc0')));
	inside.add(sector(g.rIn - 1.6, g.rOut, 6.4, 6.7, -90, 90, mat('#6e9a4a')));
}

/** a box on the floor of a dome */
const box = (/** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ d, /** @type {string} */ color, /** @type {number} */ x, /** @type {number} */ z, rough = 0.8) => part(new THREE.BoxGeometry(w, h, d), mat(color, rough), x, h / 2, z);

/** the utilities dome: pond, data center, batteries, hydrogen, water works, workshops, the office crescent, stores */
function utilInside(/** @type {THREE.Group} */ inside) {
	const c = capOf(150);
	inside.add(part(new THREE.CircleGeometry(c.a - 0.3, 72).rotateX(-Math.PI / 2), mat('#b9b3a8', 1), 0, 0.08, 0, false));
	inside.add(part(new THREE.CircleGeometry(c.a - 6, 72, Math.PI * 1.1, Math.PI * 0.8).rotateX(-Math.PI / 2), mat('#5e8a3e', 1), 0, 0.1, 0, false));
	inside.add(sector(c.a - 6 - POND_BAND, c.a - 6, 0.06, 0.16, (-POND_HALF * 180) / Math.PI, (POND_HALF * 180) / Math.PI, mat('#3f86a6', 0.2)));
	// the office crescent either side of the pond, two storeys
	for (const s of [-1, 1]) inside.add(sector(c.a - 22, c.a - 8, 0, 7, s > 0 ? 36 : -72, s > 0 ? 72 : -36, mat('#e8dcc0')));
	// the data center: a hall of racks, its dry coolers on the roof
	inside.add(box(28, 7, 25, '#4b4f57', -22, -18, 0.5));
	for (let k = 0; k < 4; k++) inside.add(box(5, 1.6, 4, '#9aa3ad', -32 + k * 7, -18, 0.4).translateY(7));
	// batteries: three 40 ft containers
	for (let k = 0; k < 3; k++) inside.add(box(12.2, 2.6, 2.4, '#e9eef2', 8, -28 + k * 4.2, 0.5));
	// hydrogen: the electrolyser and fuel cell house, and three tanks lying down
	inside.add(box(14, 5, 10, '#d9d9d2', 30, -20));
	for (let k = 0; k < 3; k++) {
		const tank = part(new THREE.CylinderGeometry(1.8, 1.8, 14, 16).rotateX(Math.PI / 2), mat('#f2f2ee', 0.4), 42 + k * 4.2, 1.9, -20);
		inside.add(tank);
	}
	// the water works: the bioreactor's tanks and a planted wetland
	inside.add(box(16, 4, 10, '#c9c2b2', -45, 8));
	inside.add(part(new THREE.BoxGeometry(44, 0.3, 34), mat('#4f8f7a', 0.3), -38, 0.2, 32, false));
	// prototyping workshops: three timber sheds
	for (let k = 0; k < 3; k++) inside.add(box(36, 8, 20, '#b98a5a', -6 + k * 0.1, 14 + k * 23 - 4, 0.9).translateX(20));
	// stores and the parcel hub
	inside.add(box(30, 7, 28, '#a8a196', 0, 52 - 10));
}

/** the machines of a factory dome, in the colours of what it makes */
function factoryInside(/** @type {string} */ id, /** @type {THREE.Group} */ inside) {
	const c = capOf(100);
	inside.add(part(new THREE.CircleGeometry(c.a - 0.3, 64).rotateX(-Math.PI / 2), mat('#a49d90', 1), 0, 0.08, 0, false));
	/** @type {Record<string, string>} */
	const COL = { timber: '#c8955a', hemp: '#b8b06a', bamboo: '#8fb05a', steel: '#6d7782', lime: '#e6e2d6', clay: '#c4734f', glass: '#9fd0dc', recycling: '#7e8f6a' };
	const col = COL[id] ?? '#999';
	// the line down the middle: a long hall, two machines either side, a stack of what it made at the door
	inside.add(box(60, 9, 18, '#d8d2c6', 0, -6));
	for (const s of [-1, 1]) for (let k = 0; k < 2; k++) inside.add(box(10, 6 + k * 3, 10, col, -18 + k * 30, -6 + s * 18, 0.6));
	if (id === 'lime' || id === 'clay' || id === 'steel' || id === 'glass') inside.add(part(new THREE.CylinderGeometry(3.5, 4, 22, 16), mat(col, 0.6), 22, 11, 14));
	for (let k = 0; k < 6; k++) inside.add(box(4, 2 + (k % 3), 6, col, -12 + k * 5, 26));
}

/** the tropical food domes' pond and floor */
function foodInside(/** @type {THREE.Group} */ inside) {
	const c = capOf(150);
	inside.add(part(new THREE.CircleGeometry(c.a - 0.3, 72).rotateX(-Math.PI / 2), mat('#4a7a33', 1), 0, 0.08, 0, false));
	inside.add(sector(c.a - 6 - POND_BAND, c.a - 6, 0.06, 0.16, (-POND_HALF * 180) / Math.PI, (POND_HALF * 180) / Math.PI, mat('#3f86a6', 0.2)));
	inside.add(box(30, 6, 14, '#e8dcc0', 0, -c.a + 14).translateZ(0));
}

/**
 * The tower: its diagrid of panels (white hemp to the north, glass and solar alternating), and inside it the factory floor, the garden
 * deck on its roof, the core and the stack of floors coloured by use.
 * @param {import('./specs.js').Tower} T
 * @param {(x: number, y: number, z: number, kind: string, s?: number) => void} plant
 */
function towerModel(T, plant) {
	const g = siteGroups();
	g.root.add(g.shell, g.inside, g.dims);
	const R = T.D / 2;
	g.root.add(part(new THREE.CylinderGeometry(R + 0.6, R + 1.0, 1.4, 96, 1, true), mat(STONE), 0, 0.7, 0));
	// panel by panel on the diagrid: white hemp on the cold north side up to about where the apartments start, glass
	// and solar panels alternating everywhere else
	g.shell.add(...shellMeshes(panelParts(towerGridOf(T).panels)));
	// inside: the factory hall, the deck on its roof, the core, the floors
	const levels = towerLevels(T);
	const rim0 = towerRadius(T, 12) - FACADE;
	g.inside.add(part(new THREE.CylinderGeometry(rim0, rim0, 12, 96), mat('#cfc6b4'), 0, 6, 0));
	g.inside.add(part(new THREE.RingGeometry(T.stack, rim0, 96).rotateX(-Math.PI / 2), mat('#5fae4a', 1), 0, 12.05, 0, false));
	// a football pitch (105 × 68 m) and an amphitheatre on the deck, south of the stack
	const pitchZ = T.stack + 8 + 34;
	if (pitchZ + 34 < rim0 - 4) {
		g.inside.add(part(new THREE.PlaneGeometry(68, 105).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), mat('#3f9a4a', 1), 0, 12.12, pitchZ, false));
		const lines = new THREE.EdgesGeometry(new THREE.PlaneGeometry(64, 101).rotateX(-Math.PI / 2).rotateY(Math.PI / 2));
		const l = new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: '#ffffff' }));
		l.position.set(0, 12.2, pitchZ);
		g.inside.add(l);
	}
	for (let k = 0; k < 6; k++) {
		const r0 = 14 + k * 3.2;
		const step = sector(r0, r0 + 3.2, 12, 12.6 + k * 0.8, 210, 330, mat('#d9cdb4'));
		step.position.set(-rim0 * 0.55, 0, -rim0 * 0.1);
		g.inside.add(step);
	}
	// trees on the deck, round its edge and between the fields
	const r = rng(T.D);
	for (let k = 0; k < 900; k++) {
		const a = r() * Math.PI * 2, rr = T.stack + 6 + r() * (rim0 - T.stack - 8);
		const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
		if (Math.abs(x) < 40 && z > T.stack + 2 && z < pitchZ + 58) continue;
		if (Math.hypot(x + rim0 * 0.55, z + rim0 * 0.1) < 36) continue;
		plant(x, 12, z, r() < 0.5 ? 'palm' : 'broad', 0.6 + r() * 0.5);
	}
	const top = levels[levels.length - 1];
	const coreTop = top.y + top.n * top.h;
	g.inside.add(part(new THREE.CylinderGeometry(CORE_R, CORE_R, coreTop + 8, 24), mat('#ddd5c6'), 0, (coreTop + 8) / 2 - 8, 0));
	for (const L of levels) {
		if (L.id === 'base' || L.id === 'factory' || L.id === 'deck') continue;
		const col = /** @type {Record<string, string>} */ (FLOOR_COLOURS)[L.use];
		for (let k = 0; k < L.n; k++) {
			const y = L.y + k * L.h;
			const rr = Math.min(T.stack, Math.min(towerRadius(T, y), towerRadius(T, y + L.h)) - FACADE);
			g.inside.add(part(new THREE.CylinderGeometry(rr, rr, 0.45, 40), mat(col, 0.7), 0, y + 0.22, 0));
			// the storey's own glass, tinted by its use
			const wall = new THREE.Mesh(new THREE.CylinderGeometry(rr - 0.4, rr - 0.4, L.h - 0.5, 40, 1, true), new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.32, roughness: 0.3, depthWrite: false, side: THREE.DoubleSide }));
			wall.position.y = y + 0.45 + (L.h - 0.5) / 2;
			g.inside.add(wall);
		}
	}
	const dimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-R, 1.5, 0), new THREE.Vector3(R, 1.5, 0), new THREE.Vector3(R + 12, 0, 0), new THREE.Vector3(R + 12, T.H, 0), new THREE.Vector3(0, T.H, 0), new THREE.Vector3(R + 12, T.H, 0)]);
	g.dims.add(new THREE.LineSegments(dimGeo, DIM));
	const hit = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.6, R, T.H, 24), new THREE.MeshBasicMaterial({ visible: false }));
	hit.position.y = T.H / 2;
	g.root.add(hit);
	return { ...g, hit, height: T.H, r: R };
}

// ── what grows ──────────────────────────────────────────────────────────────────────────────────────────────────

/** the plant kinds: a crown, a trunk, their size in metres and colours */
const PLANTS = {
	broad: { crown: () => new THREE.IcosahedronGeometry(1, 0), trunk: true, h: 7, w: 2.8, colors: ['#4f8a3a', '#5e9a42', '#6aa048', '#7aa84e', '#8bb35a'] },
	orchard: { crown: () => new THREE.IcosahedronGeometry(1, 0), trunk: true, h: 4.5, w: 2.2, colors: ['#6aa048', '#7aa84e', '#9cb04a'] },
	conifer: { crown: () => new THREE.ConeGeometry(1, 1, 7), trunk: true, h: 24, w: 3.4, colors: ['#2f5a33', '#355f38', '#3d6a3c'] },
	palm: { crown: () => new THREE.IcosahedronGeometry(1, 0), trunk: true, h: 9, w: 3.6, colors: ['#3f8f3a', '#4b9a3c', '#2f7d36'] },
	bamboo: { crown: () => new THREE.CylinderGeometry(0.55, 1, 1, 6), trunk: false, h: 10, w: 2.4, colors: ['#7fae4a', '#8fbb52', '#6f9f44'] },
	shrub: { crown: () => new THREE.IcosahedronGeometry(1, 0), trunk: false, h: 1.6, w: 1.3, colors: ['#6aa048', '#86b05a', '#a8b85a', '#c56b4a', '#d9b24a'] },
	hedge: { crown: () => new THREE.IcosahedronGeometry(1, 0), trunk: false, h: 3.5, w: 2.4, colors: ['#4f7f3a', '#5d8a40'] }
};

/** every plant of the world, as instanced meshes, one per kind */
function createPlants() {
	/** @type {Record<string, { x: number, y: number, z: number, s: number }[]>} */
	const list = Object.fromEntries(Object.keys(PLANTS).map((k) => [k, []]));
	return {
		add(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, /** @type {string} */ kind, s = 1) {
			list[kind].push({ x, y, z, s });
		},
		build() {
			const group = new THREE.Group();
			const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
			const c = new THREE.Color();
			const r = rng(7);
			for (const [kind, items] of Object.entries(list)) {
				if (!items.length) continue;
				const P = /** @type {any} */ (PLANTS)[kind];
				const crown = new THREE.InstancedMesh(P.crown(), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), items.length);
				const trunk = P.trunk ? new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 1, 5), mat('#6b4a30'), items.length) : null;
				items.forEach((it, k) => {
					const h = P.h * it.s * (0.8 + r() * 0.4), w = P.w * it.s * (0.8 + r() * 0.4);
					q.setFromAxisAngle(v.set(0, 1, 0), r() * Math.PI * 2);
					if (kind === 'conifer') {
						m.compose(v.set(it.x, it.y + h * 0.62, it.z), q, sc.set(w, h * 0.8, w));
					} else if (kind === 'palm') {
						m.compose(v.set(it.x, it.y + h * 0.92, it.z), q, sc.set(w, w * 0.35, w));
					} else if (kind === 'bamboo') {
						m.compose(v.set(it.x, it.y + h / 2, it.z), q, sc.set(w, h, w));
					} else {
						const ch = P.trunk ? h * 0.42 : h / 2;
						m.compose(v.set(it.x, it.y + (P.trunk ? h - ch : ch), it.z), q, sc.set(w, ch, w));
					}
					crown.setMatrixAt(k, m);
					crown.setColorAt(k, c.set(P.colors[Math.floor(r() * P.colors.length)]));
					if (trunk) {
						const th = kind === 'palm' ? h * 0.9 : kind === 'conifer' ? h * 0.3 : h * 0.62;
						m.compose(v.set(it.x, it.y + th / 2, it.z), q, sc.set(it.s * (kind === 'palm' ? 1.6 : 2.2), th, it.s * (kind === 'palm' ? 1.6 : 2.2)));
						trunk.setMatrixAt(k, m);
					}
				});
				crown.castShadow = true;
				crown.receiveShadow = true;
				group.add(crown);
				if (trunk) {
					trunk.castShadow = true;
					group.add(trunk);
				}
			}
			return group;
		}
	};
}

// ── the land ────────────────────────────────────────────────────────────────────────────────────────────────────

/** paint a hex's land onto a canvas: as it looks, or in the land-use map's colours @param {ReturnType<typeof landOf>} land */
function paint(land, /** @type {boolean} */ asMap) {
	const cv = document.createElement('canvas');
	cv.width = land.nx;
	cv.height = land.nz;
	const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
	const img = ctx.createImageData(land.nx, land.nz);
	const cols = USE_IDS.map((u) => new THREE.Color(asMap ? USES[u].map : USES[u].ground));
	const r = rng(3);
	for (let j = 0; j < land.nz; j++)
		for (let i = 0; i < land.nx; i++) {
			const c = land.cells[j * land.nx + i];
			const o = (j * land.nx + i) * 4;
			if (c === 255) {
				img.data[o + 3] = 0;
				continue;
			}
			const col = cols[c];
			let k = 1;
			if (!asMap) {
				const u = USE_IDS[c];
				k = 0.94 + r() * 0.12;
				// rows: hemp and the market gardens are sown in strips, the orchards in lines
				if (u === 'hemp' && i % 3 === 0) k *= 0.86;
				if (u === 'commercial' && j % 4 === 0) k *= 0.85;
				if (u === 'mine') k *= 0.8 + 0.2 * Math.abs(Math.sin(i * 0.35 + j * 0.2));
			}
			img.data[o] = Math.min(255, col.r * 255 * k);
			img.data[o + 1] = Math.min(255, col.g * 255 * k);
			img.data[o + 2] = Math.min(255, col.b * 255 * k);
			img.data[o + 3] = 255;
		}
	ctx.putImageData(img, 0, 0);
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.magFilter = asMap ? THREE.NearestFilter : THREE.LinearFilter;
	tex.anisotropy = 4;
	return tex;
}

/** a hex of ground with the land painted on it @param {import('./layout.js').HexPlan} plan @param {ReturnType<typeof landOf>} land */
function hexGround(plan, land) {
	const cs = corners(plan.cx, plan.cz);
	const W = land.nx * CELL, H = land.nz * CELL;
	/** @type {number[]} */
	const pos = [];
	/** @type {number[]} */
	const uv = [];
	const at = (/** @type {number} */ x, /** @type {number} */ z) => {
		pos.push(x, 0, z);
		uv.push((x - land.x0) / W, 1 - (z - land.z0) / H);
	};
	for (let k = 0; k < 6; k++) {
		at(plan.cx, plan.cz);
		const [ax, az] = cs[(k + 1) % 6], [bx, bz] = cs[k];
		at(ax, az);
		at(bx, bz);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geo.computeVertexNormals();
	const natural = paint(land, false), map = paint(land, true);
	const m = new THREE.MeshStandardMaterial({ map: natural, roughness: 1, transparent: true, alphaTest: 0.5 });
	const mesh = new THREE.Mesh(geo, m);
	mesh.position.y = 0.04;
	mesh.receiveShadow = true;
	return { mesh, natural, map };
}

/** the outline of a hex, a little over the ground */
function outline(/** @type {number} */ cx, /** @type {number} */ cz, /** @type {string} */ color, opacity = 1) {
	const pts = corners(cx, cz).map(([x, z]) => new THREE.Vector3(x, 0.6, z));
	return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

/** plants on a hex's land, by what it is used for @param {ReturnType<typeof landOf>} land @param {ReturnType<typeof createPlants>} plants */
function sow(land, plants, /** @type {number} */ seed) {
	const r = rng(seed);
	/** @type {Record<string, [number, string, number][]>} spacing, kind, chance */
	const SOW = { foodForest: [[8, 'broad', 0.75], [5, 'shrub', 0.3]], commercial: [[6, 'orchard', 0.9]], woodland: [[5.5, 'conifer', 0.95]], bamboo: [[4, 'bamboo', 0.9]], nature: [[14, 'broad', 0.35], [9, 'shrub', 0.2]], yard: [[30, 'broad', 0.3]], indoorFood: [[5, 'shrub', 0.8], [9, 'broad', 0.35]], tropical: [[7, 'palm', 0.9], [5, 'shrub', 0.4]] };
	const id = Object.fromEntries(USE_IDS.map((u, k) => [k, u]));
	const W = land.nx * CELL, H = land.nz * CELL;
	for (const [use, list] of Object.entries(SOW))
		for (const [sp, kind, chance] of list) {
			const rows = use === 'commercial';
			for (let z = land.z0; z < land.z0 + H; z += sp)
				for (let x = land.x0; x < land.x0 + W; x += sp) {
					const px = x + (rows ? 0 : (r() - 0.5) * sp * 0.8), pz = z + (rows ? 0 : (r() - 0.5) * sp * 0.8);
					const i = Math.floor((px - land.x0) / CELL), j = Math.floor((pz - land.z0) / CELL);
					if (i < 0 || j < 0 || i >= land.nx || j >= land.nz) continue;
					const c = land.cells[j * land.nx + i];
					if (c === 255 || id[c] !== use || r() > chance) continue;
					// under the glass the plants stay small enough for the dome
					const inside = use === 'indoorFood' || use === 'tropical';
					plants.add(px, 0, pz, kind, inside && kind === 'broad' ? 0.7 : 1);
				}
		}
	// a hedge along the hex's edge
	return r;
}

// ── the world ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, plan: import('./layout.js').HexPlan, site: import('./layout.js').Site, x: number, z: number, height: number, r: number, hit: THREE.Object3D, small: boolean }} Built
 */

/**
 * Builds both hexes into the scene (the tower hex once for each tower; one shows at a time).
 * @param {THREE.Scene} scene
 * @param {{ living: import('./layout.js').HexPlan, towers: Record<string, import('./layout.js').HexPlan> }} plans
 * @param {(label: string) => void} [progress]
 */
export function buildWorld(scene, plans, progress) {
	const layers = { land: [], shell: [], inside: [], plants: [], outline: [], dims: [] };
	/** @type {Record<string, { group: THREE.Group, land: ReturnType<typeof landOf>, ground: ReturnType<typeof hexGround>, plan: import('./layout.js').HexPlan, built: Built[], plants: THREE.Group }>} */
	const hexes = {};
	// the valley round the two hexes
	const valley = new THREE.Mesh(new THREE.CircleGeometry(5200, 64).rotateX(-Math.PI / 2), mat('#83a05e', 1));
	valley.receiveShadow = true;
	scene.add(valley);
	const around = new THREE.Group();
	for (let q = -3; q <= 4; q++)
		for (let rr = -3; rr <= 3; rr++) {
			const cx = q * HEX_W + (Math.abs(rr) % 2 ? HEX_W / 2 : 0), cz = rr * HEX_S * 1.5;
			if (Math.hypot(cx - HEX_W / 2, cz) > 2600) continue;
			around.add(outline(cx, cz, '#ffffff', 0.18));
		}
	scene.add(around);

	/** @type {[string, import('./layout.js').HexPlan][]} */
	const all = [['living', plans.living], ...Object.entries(plans.towers)];
	for (const [key, plan] of all) {
		progress?.(key === 'living' ? 'Laying out the living hex' : `Raising ${plan.tower?.label}`);
		const group = new THREE.Group();
		const land = landOf(plan);
		const ground = hexGround(plan, land);
		group.add(ground.mesh);
		const line = outline(plan.cx, plan.cz, '#fff6d8', 0.9);
		group.add(line);
		const plants = createPlants();
		/** @type {Built[]} */
		const built = [];
		for (const site of plan.sites) {
			const K = KINDS[site.kind];
			const b = site.kind === 'tower250' && plan.tower ? towerModel(plan.tower, (x, y, z, kind, s) => plants.add(x + site.x, y, z + site.z, kind, s)) : domeShell(K.D);
			b.root.position.set(site.x, 0, site.z);
			if (site.kind === 'dome50' || site.kind === 'dome100') homeInside(K, b.inside);
			else if (site.kind === 'util150') utilInside(b.inside);
			else if (site.kind === 'food150') foodInside(b.inside);
			else if (site.kind === 'factory100') factoryInside(site.factory ?? '', b.inside);
			group.add(b.root);
			b.hit.userData.site = site.id;
			layers.shell.push(/** @type {never} */ (b.shell));
			layers.inside.push(/** @type {never} */ (b.inside));
			layers.dims.push(/** @type {never} */ (b.dims));
			built.push({ id: site.id, plan, site, x: site.x, z: site.z, height: b.height, r: b.r, hit: b.hit, small: site.kind === 'dome50' });
		}
		sow(land, plants, key === 'living' ? 11 : 23);
		const pg = plants.build();
		group.add(pg);
		layers.plants.push(/** @type {never} */ (pg));
		layers.outline.push(/** @type {never} */ (line));
		scene.add(group);
		hexes[key] = { group, land, ground, plan, built, plants: pg };
	}
	layers.outline.push(/** @type {never} */ (around));

	return {
		hexes,
		/** show one tower hex (the other is hidden) */
		setTower(/** @type {string} */ id) {
			for (const k of Object.keys(plans.towers)) hexes[k].group.visible = k === id;
		},
		/** switch an overlay */
		set(/** @type {string} */ name, /** @type {boolean} */ on) {
			if (name === 'landuse') for (const h of Object.values(hexes)) {
				const m = /** @type {THREE.MeshStandardMaterial} */ (h.ground.mesh.material);
				m.map = on ? h.ground.map : h.ground.natural;
				m.needsUpdate = true;
			}
			const list = /** @type {Record<string, THREE.Object3D[]>} */ (layers)[name];
			if (list) for (const o of list) o.visible = on;
		}
	};
}
