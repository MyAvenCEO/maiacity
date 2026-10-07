/**
 * SANDBOX 6 · THE MODELS — every building of the valley is a dome, in our own low-poly style: a stone plinth, a dome
 * whose colour says what the building is, a vaulted porch facing its flag, round windows, and a band in its owner's
 * colour. Each has one thing of its own that says what it does: a tree growing from the forester's dome, the
 * fishery's drying rack and boat, the bakery's oven chimney, the toolmaker's anvil, the market hall's awning. One
 * builder per type (`buildingModel`), the chimneys named so the view can puff them (`smoke`).
 */
import * as THREE from 'three';

/** the owners' colours: yours, the two neighbours', (a spare), the fair's */
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
/** a banner on a pole in the owner's colour */
function banner(/** @type {number} */ owner, /** @type {number} */ h, x = 0, z = 0) {
	const g = new THREE.Group();
	g.add(part(new THREE.CylinderGeometry(0.03, 0.03, h, 5), mat(TIMBER), x, h / 2, z));
	const cloth = part(new THREE.BoxGeometry(0.42, 0.28, 0.02), mat(TEAM[owner], 0.6), x + 0.22, h - 0.18, z);
	cloth.name = 'cloth';
	g.add(cloth);
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
/** an open canopy: a shallow dome on posts @param {number} r @param {string} color */
function canopy(r, color, x = 0, z = 0, h = 0.9, posts = 4) {
	const g = new THREE.Group();
	g.position.set(x, 0, z);
	for (let k = 0; k < posts; k++) {
		const a = (k / posts) * Math.PI * 2 + Math.PI / posts;
		g.add(part(new THREE.CylinderGeometry(0.035, 0.035, h, 5), mat(TIMBER), Math.sin(a) * r * 0.85, h / 2, Math.cos(a) * r * 0.85));
	}
	const cap = part(new THREE.SphereGeometry(r, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(color, 0.7), 0, h, 0);
	cap.scale.y = 0.55;
	g.add(cap);
	return g;
}

/**
 * The model of a building.
 * @param {string} type
 * @param {number} owner
 * @returns {THREE.Group}
 */
export function buildingModel(type, owner) {
	const g = new THREE.Group();
	switch (type) {
		case 'hq': {
			// three domes, the great one crowned with a golden lantern
			g.add(dome(1.25, 1.35, '#e3d6bb', { windows: 4 }));
			g.add(dome(0.62, 0.7, '#d8c7a4', { x: -1.35, z: -0.55, windows: 2, porch: false }));
			g.add(dome(0.62, 0.7, '#d8c7a4', { x: 1.35, z: -0.55, windows: 2, porch: false }));
			g.add(band(owner, 1.27, PLINTH + 0.45));
			g.add(lantern(PLINTH + 1.35, '#d9a92e', 1.4));
			g.add(banner(owner, 3.4, -1.35, -0.55));
			break;
		}
		case 'storehouse': {
			// a wide low dome held by ribs, crates at its door
			g.add(dome(1.05, 0.85, '#c9a77a', { windows: 2 }));
			for (let k = 0; k < 3; k++) {
				const rib = part(new THREE.TorusGeometry(1.06, 0.04, 4, 16, Math.PI), mat(TIMBER), 0, PLINTH, 0);
				rib.scale.y = 0.85 / 1.06;
				rib.rotation.y = (k / 3) * Math.PI + Math.PI / 6;
				g.add(rib);
			}
			g.add(pile('#c8a26a', 0.85, 0.75, 4));
			g.add(band(owner, 1.07, PLINTH + 0.2));
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
			break;
		}
		case 'forester':
			// a living green dome with a young tree growing from its top
			g.add(dome(0.75, 0.7, '#6f9a4a', { rough: 1 }));
			g.add(tree(0, PLINTH + 0.65, 0, 1.1));
			for (const [x, z] of [[0.95, 0.35], [-0.95, 0.4], [0.75, -0.7]]) g.add(tree(x, 0, z, 0.55));
			g.add(band(owner, 0.77, PLINTH + 0.15));
			break;
		case 'quarry': {
			// a dome of cut stone facets, with blocks waiting
			const g2 = dome(0.8, 0.75, '#a7a297', { porch: true });
			g.add(g2);
			const facets = part(new THREE.IcosahedronGeometry(0.82, 0), mat('#b5b1a6', 0.95), 0, PLINTH, 0);
			facets.scale.set(1, 0.9, 1);
			g.add(facets);
			for (const [x, z, s] of [[0.95, 0.25, 1], [1.05, -0.25, 0.8], [-0.95, 0.45, 0.9], [0.75, 0.75, 0.7]]) g.add(part(new THREE.BoxGeometry(0.3 * s, 0.25 * s, 0.3 * s), mat('#c4c0b5'), x, 0.13 * s, z));
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
		case 'well':
			// an open dome over the water, on four posts
			g.add(part(new THREE.CylinderGeometry(0.45, 0.5, 0.4, 12), mat(STONE), 0, 0.2, 0));
			g.add(part(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 12), mat('#3c7fa6', 0.3), 0, 0.4, 0));
			g.add(canopy(0.62, '#5a8fb3', 0, 0, 1.0));
			g.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), mat(TIMBER), 0, 0.75, 0));
			g.add(part(new THREE.BoxGeometry(0.14, 0.14, 0.14), mat(TIMBER), 0, 0.5, 0));
			g.add(band(owner, 0.5, 0.38));
			break;
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
		case 'market': {
			// an amber dome ringed with a striped awning, the trader's cart waiting
			g.add(dome(1.0, 0.9, '#d29a3c', { windows: 2 }));
			for (let k = 0; k < 10; k++) {
				const a = (k / 10) * Math.PI * 2;
				const flap = part(new THREE.BoxGeometry(0.6, 0.03, 0.3), mat(k % 2 ? '#f2e6c8' : '#b8442e', 0.7), Math.sin(a) * 1.08, 0.66, Math.cos(a) * 1.08);
				flap.rotation.y = a;
				flap.rotateX(0.6);
				g.add(flap);
			}
			g.add(part(new THREE.BoxGeometry(0.7, 0.28, 0.42), mat(TIMBER), -1.45, 0.32, 0.6));
			for (const sz of [-1, 1]) {
				const wheel = part(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 10), mat(DARK), -1.45, 0.17, 0.6 + sz * 0.24);
				wheel.rotation.x = Math.PI / 2;
				g.add(wheel);
			}
			g.add(lantern(PLINTH + 0.9, '#b8442e'));
			g.add(band(owner, 1.02, PLINTH + 0.12));
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
		case 'village': {
			// a cluster of homes, each its own little dome, round a well and the village banner
			const roofs = ['#c28a62', '#b5946a', '#a87a58', '#cfa073'];
			[[-1.15, -0.45], [1.05, -0.7], [-0.9, 1.0], [1.2, 0.85]].forEach(([x, z], k) => {
				g.add(dome(0.55, 0.55, roofs[k], { x, z, windows: 1, porch: false }));
				const b = band(owner, 0.56, PLINTH + 0.1);
				b.position.x = x;
				b.position.z = z;
				g.add(b);
			});
			g.add(part(new THREE.CylinderGeometry(0.3, 0.34, 0.35, 10), mat(STONE), 0, 0.18, 0.1));
			g.add(banner(owner, 3.0, 0.1, -0.2));
			break;
		}
		case 'fair': {
			// open stalls under coloured canopies, round a pole with pennants
			const colours = [TEAM[1], TEAM[2], TEAM[0], '#d9b44a'];
			for (let k = 0; k < 4; k++) {
				const a = (k / 4) * Math.PI * 2 + 0.4;
				const x = Math.cos(a) * 1.35, z = Math.sin(a) * 1.35;
				g.add(canopy(0.45, colours[k], x, z, 0.8, 3));
				g.add(part(new THREE.BoxGeometry(0.5, 0.35, 0.3), mat(TIMBER), x, 0.18, z));
			}
			g.add(part(new THREE.CylinderGeometry(0.05, 0.06, 3.2, 6), mat(TIMBER), 0, 1.6, 0));
			for (let k = 0; k < 4; k++) {
				const pennant = part(new THREE.ConeGeometry(0.12, 0.4, 3), mat(colours[k], 0.6), 0.2, 3.0 - k * 0.32, 0);
				pennant.rotation.z = -Math.PI / 2;
				g.add(pennant);
			}
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
