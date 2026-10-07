/**
 * SANDBOX 6 · THE MODELS — every building of the valley is a dome, in our own low-poly style: a stone plinth, a dome
 * whose colour says what the building is, a vaulted porch facing its flag, round windows, and a band in its owner's
 * colour. Houses are domes too, and grow as they are enlarged. Each has one thing of its own that says what it does: a tree growing from the forester's dome, the
 * fishery's drying rack and boat, the bakery's oven chimney, the toolmaker's anvil, the tower of a village
 * center. One
 * builder per type (`buildingModel`), the chimneys named so the view can puff them (`smoke`).
 */
import * as THREE from 'three';

/** the owners' colours: yours, the two neighbours', and spares */
export const TEAM = ['#2f6fb3', '#c8642a', '#3d8f5c', '#7a55a8', '#8a7f6e'];

/** @type {Map<string, THREE.MeshStandardMaterial>} */
const mats = new Map();
/** one material per colour, shared by every model */
export const mat = (/** @type {string} */ color, rough = 0.85) => {
	const k = `${color}/${rough}`;
	let m = mats.get(k);
	if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true })));
	return m;
};

const WALL = '#ece2cc', TIMBER = '#6e4b30', STONE = '#9d978c', DARK = '#3d3a36';

/** @param {THREE.BufferGeometry} geo @param {THREE.Material} m @param {number} [x] @param {number} [y] @param {number} [z] */
function part(geo, m, x = 0, y = 0, z = 0) {
	const mesh = new THREE.Mesh(geo, m);
	mesh.position.set(x, y, z);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}
/** the height of a dome's plinth */
const PLINTH = 0.16;
/**
 * A dome on its plinth: radius `r`, rising `h` above the plinth, centred at (x, z); the porch (facing the flag, +z)
 * and the round windows come with it unless `bare`.
 * @param {number} r @param {number} h @param {string} color
 */
function dome(r, h, color, { x = 0, z = 0, rough = 0.75, bare = false, windows = 3, porch = true } = {}) {
	const g = new THREE.Group();
	g.position.set(x, 0, z);
	g.add(part(new THREE.CylinderGeometry(r * 1.06, r * 1.12, PLINTH, 14), mat(STONE), 0, PLINTH / 2, 0));
	const shell = part(new THREE.SphereGeometry(r, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), mat(color, rough), 0, PLINTH, 0);
	shell.scale.y = h / r;
	g.add(shell);
	if (bare) return g;
	// round windows a third of the way up, away from the door
	for (let k = 0; k < windows; k++) {
		const a = Math.PI * 0.55 + (k / Math.max(1, windows - 1)) * Math.PI * 0.9;
		const e = 0.42;
		const w = part(new THREE.CylinderGeometry(0.085, 0.085, 0.04, 8), mat(DARK, 0.4), Math.sin(a) * r * Math.cos(e), PLINTH + h * Math.sin(e), Math.cos(a) * r * Math.cos(e));
		w.lookAt(new THREE.Vector3(Math.sin(a) * r * 3, PLINTH + h * Math.sin(e) * 2, Math.cos(a) * r * 3));
		w.rotateX(Math.PI / 2);
		g.add(w);
	}
	if (porch) g.add(vault(r));
	return g;
}
/** the vaulted porch at a dome's door, facing the flag (+z) @param {number} r */
function vault(r) {
	const g = new THREE.Group();
	g.position.set(0, PLINTH, r * 0.86);
	g.add(part(new THREE.BoxGeometry(0.46, 0.34, 0.4), mat(WALL), 0, 0.17, 0));
	const roof = part(new THREE.CylinderGeometry(0.23, 0.23, 0.4, 10, 1, false, 0, Math.PI), mat(WALL), 0, 0.34, 0);
	roof.rotation.set(Math.PI / 2, Math.PI / 2, 0);
	g.add(roof);
	g.add(part(new THREE.BoxGeometry(0.26, 0.4, 0.04), mat(TIMBER), 0, 0.2, 0.2));
	return g;
}
/** a ring round a dome in its owner's colour (the view recolours it when a building changes hands) */
function band(/** @type {number} */ owner, /** @type {number} */ r, /** @type {number} */ y) {
	const ring = part(new THREE.TorusGeometry(r, 0.045, 5, 24), mat(TEAM[owner], 0.6), 0, y, 0);
	ring.rotation.x = Math.PI / 2;
	ring.name = 'cloth';
	return ring;
}
/** a lantern on a dome's top: a little drum and its own cap @param {number} y @param {string} color */
function lantern(y, color, s = 1) {
	const g = new THREE.Group();
	g.position.y = y;
	g.add(part(new THREE.CylinderGeometry(0.16 * s, 0.18 * s, 0.24 * s, 8), mat(WALL), 0, 0.12 * s, 0));
	const cap = part(new THREE.SphereGeometry(0.18 * s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat(color, 0.5), 0, 0.24 * s, 0);
	g.add(cap);
	g.add(part(new THREE.ConeGeometry(0.04 * s, 0.22 * s, 5), mat(color, 0.5), 0, 0.5 * s, 0));
	return g;
}
/** a chimney that smokes while the building works */
function chimney(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, h = 0.7, color = STONE) {
	const g = new THREE.Group();
	g.add(part(new THREE.CylinderGeometry(0.1, 0.13, h, 7), mat(color), x, y + h / 2, z));
	const smoke = new THREE.Group();
	smoke.name = 'smoke';
	smoke.position.set(x, y + h, z);
	for (let k = 0; k < 4; k++) {
		const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14 + k * 0.04, 0), new THREE.MeshStandardMaterial({ color: '#d8d4cc', transparent: true, opacity: 0.55, flatShading: true }));
		puff.userData.k = k;
		smoke.add(puff);
	}
	smoke.visible = false;
	g.add(smoke);
	return g;
}
function pile(/** @type {string} */ color, /** @type {number} */ x, /** @type {number} */ z, n = 3) {
	const g = new THREE.Group();
	for (let k = 0; k < n; k++) g.add(part(new THREE.BoxGeometry(0.22, 0.18, 0.5), mat(color), x + (k % 2) * 0.24, 0.09 + Math.floor(k / 2) * 0.18, z));
	return g;
}
/** a log lying on the ground, turned `turn` @param {number} x @param {number} z */
function log(x, z, turn = 0, y = 0.09, len = 0.6) {
	const l = part(new THREE.CylinderGeometry(0.09, 0.09, len, 7), mat('#8a5a2b'), x, y, z);
	l.rotation.set(0, turn, Math.PI / 2);
	return l;
}
/** a little tree: a trunk and a crown */
function tree(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, s = 1) {
	const g = new THREE.Group();
	g.add(part(new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.4 * s, 5), mat('#6b4a30'), x, y + 0.2 * s, z));
	g.add(part(new THREE.ConeGeometry(0.3 * s, 0.75 * s, 7), mat('#3f7a3c'), x, y + 0.7 * s, z));
	return g;
}
/**
 * A village center's hall: one shell turned round its axis, in the domes' own faceted cream. It rises from the
 * plinth's outer ring like a dome, sweeps in to a slender tower and closes in a rounded top: one structure, the
 * tallest of its village. Window rings and a band in its owner's colour run round it.
 * @param {number} R radius at the foot @param {number} H height of the shell @param {number} owner
 */
function spire(R, H, owner) {
	const g = new THREE.Group();
	g.add(part(new THREE.CylinderGeometry(R * 1.06, R * 1.12, PLINTH, 16), mat(STONE), 0, PLINTH / 2, 0));
	// the profile, foot to top: a dome's shoulder, the waist curving in, the tower, the rounded cap
	const top = 0.3;
	/** @type {THREE.Vector2[]} */
	const pts = [];
	for (let k = 0; k <= 16; k++) {
		const t = k / 16;
		// the radius narrows smoothly from the foot to the tower (a little flare at the bottom, like the domes)
		const r = top + (R - top) * Math.pow(1 - t, 2.2) * (1 + 0.35 * Math.sin(Math.PI * Math.min(1, t * 2.2)));
		pts.push(new THREE.Vector2(Math.min(R, r), t * (H - top)));
	}
	for (let k = 1; k <= 6; k++) {
		const a = (k / 6) * (Math.PI / 2);
		pts.push(new THREE.Vector2(Math.max(0.001, top * Math.cos(a)), H - top + top * Math.sin(a)));
	}
	const shell = part(new THREE.LatheGeometry(pts, 16), mat('#e6dcc4', 0.75), 0, PLINTH, 0);
	g.add(shell);
	/** the shell's radius at a height */
	const at = (/** @type {number} */ y) => {
		for (let k = 1; k < pts.length; k++) if (pts[k].y >= y) return pts[k - 1].x + ((pts[k].x - pts[k - 1].x) * (y - pts[k - 1].y)) / Math.max(1e-6, pts[k].y - pts[k - 1].y);
		return top;
	};
	// rings of windows up the tower, and the owner's band round the foot
	for (const y of [0.55, 1.6, 2.4, 3.1]) {
		const ring = part(new THREE.TorusGeometry(at(y) + 0.01, 0.035, 4, 16), mat(DARK, 0.4), 0, PLINTH + y, 0);
		ring.rotation.x = Math.PI / 2;
		g.add(ring);
	}
	g.add(band(owner, at(0.3) + 0.03, PLINTH + 0.3));
	// the light at the top
	g.add(part(new THREE.SphereGeometry(0.09, 8, 5), mat('#d9a92e', 0.4), 0, PLINTH + H + 0.05, 0));
	g.add(vault(R));
	return g;
}
/**
 * The model of a building.
 * @param {string} type
 * @param {number} owner
 * @param {number} [level] the wood building's level: a forester (1), a woodcutter (2), a sawmill (3), a timber works (4);
 * or the steel building's: an iron mine (1), a furnace (2), a steelworks (3)
 * @returns {THREE.Group}
 */
export function buildingModel(type, owner, level = 2) {
	const g = new THREE.Group();
	// the wood building starts as a forester, and looks it
	if (type === 'woodcutter' && level === 1) type = 'forester';
	switch (type) {
		case 'centre':
		case 'village': {
			// the village center: storehouse, market and hall in one, nobody lives here. One shell from the dome's foot
			// to a rounded tower top, the tallest of its village; crates and the trade cart at its door
			g.add(spire(1.6, 4.6, owner));
			g.add(pile('#c8a26a', 1.55, 1.05, 4));
			g.add(part(new THREE.BoxGeometry(0.7, 0.28, 0.42), mat(TIMBER), -1.6, 0.32, 0.95));
			for (const sz of [-1, 1]) {
				const wheel = part(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 10), mat(DARK), -1.6, 0.17, 0.95 + sz * 0.24);
				wheel.rotation.x = Math.PI / 2;
				g.add(wheel);
			}
			break;
		}
		case 'house': {
			// a home: a cream dome with round windows, a small chimney and a bench at the door (it grows as it is enlarged)
			g.add(dome(0.9, 0.95, '#efe3c8', { windows: 3 }));
			g.add(part(new THREE.CylinderGeometry(0.08, 0.1, 0.45, 6), mat('#9a5a3a'), -0.35, PLINTH + 0.95, -0.3));
			g.add(part(new THREE.BoxGeometry(0.5, 0.08, 0.16), mat(TIMBER), 0.62, 0.22, 0.75));
			for (const x of [-0.55, 0.55]) g.add(part(new THREE.SphereGeometry(0.12, 7, 4), mat('#6f9a4a'), x, 0.12, 0.95));
			g.add(band(owner, 0.92, PLINTH + 0.15));
			break;
		}
		case 'woodcutter': {
			// logs stacked round the dome, and a stump with its axe
			g.add(dome(0.78, 0.75, '#b98a5a'));
			for (let k = 0; k < 6; k++) {
				const a = Math.PI * 0.75 + (k / 6) * Math.PI * 1.1;
				g.add(log(Math.sin(a) * 0.98, Math.cos(a) * 0.98, a, 0.09 + (k % 2) * 0.17));
			}
			g.add(part(new THREE.CylinderGeometry(0.17, 0.2, 0.25, 7), mat('#a07a4c'), 0.85, 0.12, 0.55));
			const axe = part(new THREE.BoxGeometry(0.04, 0.42, 0.04), mat(TIMBER), 0.85, 0.42, 0.55);
			axe.rotation.z = 0.35;
			g.add(axe);
			g.add(band(owner, 0.8, PLINTH + 0.15));
			// a sawmill: a round saw on its bench and planks stacked; a timber works: a second bench and a taller stack
			for (let k = 0; k < Math.min(2, level - 2); k++) {
				const x = -0.9 + k * 0.3, z = 0.45 - k * 0.75;
				g.add(part(new THREE.BoxGeometry(0.5, 0.2, 0.22), mat(TIMBER), x, 0.1, z));
				const saw = part(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 16), mat('#c9ccd1', 0.3), x, 0.32, z);
				saw.rotation.x = Math.PI / 2;
				g.add(saw);
			}
			for (let k = 0; k < (level - 2) * 2; k++) g.add(part(new THREE.BoxGeometry(0.55, 0.06, 0.16), mat('#e0b46a'), -0.25, 0.04 + k * 0.07, -1.0));
			break;
		}
		case 'forester':
			// a living green dome with a young tree growing from its top
			g.add(dome(0.75, 0.7, '#6f9a4a', { rough: 1 }));
			g.add(tree(0, PLINTH + 0.65, 0, 1.1));
			for (const [x, z] of [[0.95, 0.35], [-0.95, 0.4], [0.75, -0.7]]) g.add(tree(x, 0, z, 0.55));
			g.add(band(owner, 0.77, PLINTH + 0.15));
			break;
		case 'limeworks': {
			// a pale dome of cut stone facets over the pit, with limestone waiting; a kiln: its squat stack glowing at the
			// foot; a block works: a second stack and arch blocks stacked at the door
			const g2 = dome(0.8, 0.75, '#c9c2b0', { porch: true });
			g.add(g2);
			const facets = part(new THREE.IcosahedronGeometry(0.82, 0), mat('#d6d0c0', 0.95), 0, PLINTH, 0);
			facets.scale.set(1, 0.9, 1);
			g.add(facets);
			for (const [x, z, s] of [[0.95, 0.25, 1], [1.05, -0.25, 0.8], [-0.95, 0.45, 0.9]]) g.add(part(new THREE.BoxGeometry(0.3 * s, 0.25 * s, 0.3 * s), mat('#b9b4a6'), x, 0.13 * s, z));
			for (let k = 0; k < Math.min(2, level - 1); k++) {
				const x = -0.55 + k * 0.4, z = -0.45 - k * 0.2;
				g.add(chimney(x, PLINTH + 0.4, z, 0.6 + k * 0.15, '#d8d2c2'));
				g.add(part(new THREE.CylinderGeometry(0.22, 0.26, 0.28, 8), mat('#e8a25a', 0.6), -1.0 + k * 0.1, 0.14, -0.2 - k * 0.45));
			}
			// arch blocks: wedges laid in rows, as they wait for the trade routes
			for (let k = 0; k < (level - 2) * 6; k++) g.add(part(new THREE.BoxGeometry(0.16, 0.12, 0.2), mat('#e4dccb'), 0.5 + (k % 3) * 0.18, 0.06 + Math.floor(k / 3) * 0.12, 0.95));
			g.add(band(owner, 0.82, PLINTH + 0.12));
			break;
		}
		case 'fishery': {
			// a dome glazed like the lake, a drying rack of fish and a boat
			g.add(dome(0.75, 0.75, '#7fb2c4', { rough: 0.45 }));
			for (const x of [0.75, 1.3]) g.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5), mat(TIMBER), x, 0.4, -0.25));
			g.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5), mat(TIMBER), 1.02, 0.75, -0.25).rotateZ(Math.PI / 2));
			for (let k = 0; k < 4; k++) g.add(part(new THREE.BoxGeometry(0.06, 0.22, 0.03), mat('#9cc3d6', 0.5), 0.82 + k * 0.13, 0.6, -0.25));
			const boat = part(new THREE.CylinderGeometry(0.22, 0.22, 0.9, 10, 1, false, Math.PI / 2, Math.PI), mat(TIMBER), -0.95, 0.22, 0.45);
			boat.rotation.set(Math.PI / 2, 0, 0.5);
			g.add(boat);
			g.add(band(owner, 0.77, PLINTH + 0.15));
			break;
		}
		case 'farm': {
			// a wheat-gold dome, a silo beside it and hay at the door
			g.add(dome(0.85, 0.8, '#e2b84a'));
			g.add(part(new THREE.CylinderGeometry(0.32, 0.32, 1.3, 10), mat(WALL), -1.05, 0.65, -0.35));
			const top = part(new THREE.SphereGeometry(0.32, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat('#a64b32', 0.6), -1.05, 1.3, -0.35);
			g.add(top);
			for (const [x, z] of [[0.95, 0.5], [1.05, 0.05]]) {
				const bale = part(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 8), mat('#e8c94a'), x, 0.17, z);
				bale.rotation.x = Math.PI / 2;
				g.add(bale);
			}
			g.add(band(owner, 0.87, PLINTH + 0.15));
			break;
		}
		case 'bakery':
			// a terracotta oven dome, its chimney at the crown, loaves at the door
			g.add(dome(0.85, 0.75, '#c0653a'));
			g.add(chimney(0, PLINTH + 0.68, 0, 0.5, '#9a5a3a'));
			for (let k = 0; k < 3; k++) g.add(part(new THREE.SphereGeometry(0.1, 7, 4), mat('#c47f34'), 0.55 + k * 0.2, 0.08, 1.05));
			g.add(band(owner, 0.87, PLINTH + 0.15));
			break;
		case 'ironmine': {
			// a dark dome over the shaft, a timbered tunnel mouth and a cart of what it digs
			const ore = '#a35b3a';
			g.add(dome(0.85, 0.75, '#6b645a', { porch: false, windows: 0 }));
			g.add(part(new THREE.BoxGeometry(0.6, 0.6, 0.3), mat('#141312'), 0, 0.3, 0.75));
			for (const sx of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.1, 0.72, 0.1), mat(TIMBER), sx * 0.34, 0.36, 0.9));
			g.add(part(new THREE.BoxGeometry(0.85, 0.1, 0.12), mat(TIMBER), 0, 0.74, 0.9));
			g.add(part(new THREE.SphereGeometry(0.14, 8, 5), mat(ore, 0.4), 0, PLINTH + 0.75, 0));
			g.add(part(new THREE.BoxGeometry(0.42, 0.22, 0.3), mat(TIMBER), 0.95, 0.15, 0.45));
			g.add(part(new THREE.BoxGeometry(0.36, 0.1, 0.24), mat(ore, 0.5), 0.95, 0.3, 0.45));
			// a furnace: its stack glowing at the foot; a steelworks: a second stack and steel joints stacked at the door
			for (let k = 0; k < Math.min(2, level - 1); k++) {
				const x = -0.55 + k * 0.4, z = -0.45 - k * 0.2;
				g.add(chimney(x, PLINTH + 0.45, z, 0.75 + k * 0.15));
				g.add(part(new THREE.CylinderGeometry(0.2, 0.24, 0.3, 8), mat('#e0703a', 0.6), -1.0 + k * 0.1, 0.15, -0.2 - k * 0.45));
			}
			for (let k = 0; k < (level - 2) * 3; k++) g.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6).rotateZ(Math.PI / 2), mat('#8796a6', 0.35), -0.2, 0.05 + k * 0.065, 1.05));
			g.add(band(owner, 0.87, PLINTH + 0.12));
			break;
		}
		case 'toolmaker': {
			// a teal dome, an anvil on its block, and the forge chimney
			g.add(dome(0.85, 0.8, '#3f9a92'));
			g.add(part(new THREE.BoxGeometry(0.2, 0.22, 0.2), mat(TIMBER), 1.0, 0.11, 0.35));
			g.add(part(new THREE.BoxGeometry(0.4, 0.12, 0.18), mat(DARK, 0.35), 1.0, 0.28, 0.35));
			g.add(chimney(-0.4, PLINTH + 0.5, -0.35, 0.55));
			g.add(band(owner, 0.87, PLINTH + 0.15));
			break;
		}
		case 'boundary': {
			// a standing stone with a little dome cap in its owner's colour
			g.add(part(new THREE.CylinderGeometry(0.55, 0.65, 0.12, 8), mat(STONE), 0, 0.06, 0));
			g.add(part(new THREE.CylinderGeometry(0.2, 0.26, 1.2, 8), mat('#b9b2a4'), 0, 0.7, 0));
			const cap = part(new THREE.SphereGeometry(0.24, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(TEAM[owner], 0.6), 0, 1.3, 0);
			cap.name = 'cloth';
			g.add(cap);
			break;
		}
		default:
			g.add(dome(0.8, 0.75, '#999'));
	}
	g.userData.height = new THREE.Box3().setFromObject(g).max.y;
	return g;
}

/** a building site's scaffold: a ring of posts round the footprint, and the arches that will carry the dome */
export function scaffold() {
	const g = new THREE.Group();
	for (let k = 0; k < 6; k++) {
		const a = (k / 6) * Math.PI * 2;
		g.add(part(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 5), mat('#b88a52'), Math.sin(a) * 0.95, 0.6, Math.cos(a) * 0.95));
	}
	for (let k = 0; k < 2; k++) {
		const arch = part(new THREE.TorusGeometry(0.95, 0.03, 4, 14, Math.PI), mat('#b88a52'), 0, 0.15, 0);
		arch.rotation.y = (k * Math.PI) / 2;
		g.add(arch);
	}
	return g;
}

/** Puts an owner's colour on a model's banner. */
export function recolour(/** @type {THREE.Object3D} */ model, /** @type {number} */ owner) {
	model.traverse((o) => {
		if (o.name === 'cloth' && o instanceof THREE.Mesh) o.material = mat(TEAM[owner], 0.6);
	});
}
