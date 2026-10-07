/**
 * SANDBOX 6 · THE MODELS — every building of the valley, made of a few simple shapes in our own low-poly style:
 * whitewashed walls and timber, a roof whose colour says what the building is, and a banner in its owner's colour.
 * One builder per type (`buildingModel`), the moving parts named so the view can turn them (`sails`, `blade`) and
 * puff them (`smoke`).
 */
import * as THREE from 'three';

/** the owners' colours: yours, the rival's */
export const TEAM = ['#2f6fb3', '#b8392f'];

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

/** a gable roof: a prism along x @param {number} w @param {number} d @param {number} h */
function gable(w, d, h) {
	const s = new THREE.Shape();
	s.moveTo(-d / 2, 0);
	s.lineTo(d / 2, 0);
	s.lineTo(0, h);
	s.closePath();
	const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
	g.translate(0, 0, -w / 2);
	g.rotateY(Math.PI / 2);
	return g;
}
/** @param {THREE.BufferGeometry} geo @param {THREE.Material} m @param {number} [x] @param {number} [y] @param {number} [z] */
function part(geo, m, x = 0, y = 0, z = 0) {
	const mesh = new THREE.Mesh(geo, m);
	mesh.position.set(x, y, z);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}
/** a house: walls and a gable roof @param {number} w @param {number} d @param {number} h @param {string} roof */
function house(w, d, h, roof) {
	const g = new THREE.Group();
	g.add(part(new THREE.BoxGeometry(w, h, d), mat(WALL), 0, h / 2, 0));
	// timber corners
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.1, h, 0.1), mat(TIMBER), (sx * w) / 2, h / 2, (sz * d) / 2));
	const r = part(gable(w + 0.25, d + 0.3, h * 0.75), mat(roof, 0.7), 0, h, 0);
	g.add(r);
	// a door facing the flag (south-east, +z +x)
	g.add(part(new THREE.BoxGeometry(0.34, 0.55, 0.05), mat(TIMBER), w * 0.15, 0.28, d / 2 + 0.01));
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
function chimney(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, h = 0.7) {
	const g = new THREE.Group();
	g.add(part(new THREE.BoxGeometry(0.22, h, 0.22), mat(STONE), x, y + h / 2, z));
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
			const hall = house(2.6, 1.8, 1.4, '#a64b32');
			g.add(hall);
			for (const sx of [-1, 1]) {
				g.add(part(new THREE.BoxGeometry(0.8, 2.6, 0.8), mat(STONE), sx * 1.5, 1.3, -0.3));
				g.add(part(new THREE.ConeGeometry(0.62, 0.9, 4), mat('#7d3426', 0.7), sx * 1.5, 3.05, -0.3).rotateY(Math.PI / 4));
			}
			g.add(banner(owner, 4.2, 1.5, -0.3));
			break;
		}
		case 'storehouse': {
			g.add(house(2.2, 1.5, 1.1, '#8a5a3b'));
			g.add(part(new THREE.BoxGeometry(0.7, 0.8, 0.05), mat(TIMBER), -0.3, 0.4, 0.76));
			g.add(pile('#c8a26a', 1.05, 0.5, 4));
			g.add(banner(owner, 2.4, -1.0, -0.6));
			break;
		}
		case 'woodcutter':
			g.add(house(1.3, 1.1, 0.8, '#7b6a3a'));
			g.add(pile('#8a5a2b', 0.85, 0.2, 3));
			g.add(part(new THREE.CylinderGeometry(0.18, 0.2, 0.25, 7), mat('#a07a4c'), -0.85, 0.12, 0.45));
			break;
		case 'forester':
			g.add(house(1.2, 1.0, 0.8, '#4f7a3a'));
			for (const [x, z] of [[0.9, 0.3], [-0.9, 0.5], [0.8, -0.6]]) g.add(part(new THREE.ConeGeometry(0.16, 0.45, 6), mat('#4d8a3a'), x, 0.23, z));
			break;
		case 'quarry':
			g.add(house(1.2, 1.0, 0.8, '#77756f'));
			for (const [x, z] of [[0.9, 0.2], [0.95, -0.25], [-0.85, 0.4]]) g.add(part(new THREE.BoxGeometry(0.3, 0.25, 0.3), mat('#b5b1a6'), x, 0.13, z));
			break;
		case 'sawmill': {
			g.add(house(2.0, 1.2, 0.95, '#a3683c'));
			const blade = part(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 14), mat('#c9ccd0', 0.4), 1.2, 0.55, 0.1);
			blade.rotation.x = Math.PI / 2;
			blade.name = 'blade';
			g.add(blade);
			g.add(pile('#e0b46a', -1.2, 0.3, 4));
			break;
		}
		case 'fishery':
			g.add(house(1.2, 1.0, 0.8, '#3f7f9a'));
			for (const x of [0.8, 1.15]) g.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5), mat(TIMBER), x, 0.4, -0.2));
			g.add(part(new THREE.BoxGeometry(0.4, 0.3, 0.02), mat('#d9d0b8', 0.95), 0.97, 0.5, -0.2));
			break;
		case 'farm':
			g.add(house(1.5, 1.1, 0.9, '#c9973a'));
			g.add(part(new THREE.BoxGeometry(1.0, 0.8, 0.9), mat('#9a4a32'), -1.25, 0.4, -0.2));
			g.add(part(gable(1.05, 1.0, 0.5), mat('#6b3a28', 0.7), -1.25, 0.8, -0.2));
			break;
		case 'well': {
			g.add(part(new THREE.CylinderGeometry(0.45, 0.5, 0.45, 10), mat(STONE), 0, 0.23, 0));
			g.add(part(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 10), mat('#3c7fa6', 0.3), 0, 0.44, 0));
			for (const sx of [-1, 1]) g.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 5), mat(TIMBER), sx * 0.42, 0.6, 0));
			g.add(part(gable(1.0, 0.8, 0.35), mat('#a64b32', 0.7), 0, 1.02, 0));
			break;
		}
		case 'mill': {
			g.add(part(new THREE.CylinderGeometry(0.55, 0.8, 2.0, 8), mat(WALL), 0, 1.0, 0));
			g.add(part(new THREE.ConeGeometry(0.7, 0.8, 8), mat('#8a5a3b', 0.7), 0, 2.4, 0));
			const sails = new THREE.Group();
			sails.name = 'sails';
			sails.position.set(0, 1.8, 0.75);
			for (let k = 0; k < 4; k++) {
				const arm = part(new THREE.BoxGeometry(0.22, 1.25, 0.03), mat('#e8dcc0', 0.95), 0, 0.68, 0);
				const holder = new THREE.Group();
				holder.rotation.z = (k * Math.PI) / 2;
				holder.add(arm);
				sails.add(holder);
			}
			g.add(sails);
			break;
		}
		case 'bakery':
			g.add(house(1.5, 1.1, 0.85, '#b5673a'));
			g.add(part(new THREE.SphereGeometry(0.42, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat('#a8866a'), 1.05, 0, 0.2));
			g.add(chimney(-0.4, 1.1, -0.2));
			break;
		case 'livestock': {
			g.add(house(1.6, 1.1, 0.8, '#8b4f6b'));
			const fence = mat(TIMBER);
			for (let k = 0; k < 5; k++) g.add(part(new THREE.BoxGeometry(0.05, 0.3, 0.05), fence, 1.0 + (k % 3) * 0.3, 0.15, -0.4 + Math.floor(k / 3) * 0.8));
			for (const [x, z] of [[1.2, -0.1], [1.45, 0.25]]) g.add(part(new THREE.BoxGeometry(0.3, 0.2, 0.18), mat('#e9a7a3'), x, 0.12, z));
			break;
		}
		case 'coalmine':
		case 'ironmine':
		case 'goldmine': {
			const ore = type === 'coalmine' ? '#2a2a2c' : type === 'ironmine' ? '#a35b3a' : '#e2b93b';
			g.add(part(new THREE.BoxGeometry(1.3, 1.0, 0.9), mat('#5d564d'), 0, 0.5, -0.25));
			g.add(part(new THREE.BoxGeometry(0.62, 0.7, 0.1), mat('#141312'), 0, 0.35, 0.22));
			for (const sx of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.1, 0.85, 0.1), mat(TIMBER), sx * 0.38, 0.42, 0.26));
			g.add(part(new THREE.BoxGeometry(0.95, 0.1, 0.12), mat(TIMBER), 0, 0.86, 0.26));
			g.add(part(new THREE.BoxGeometry(0.42, 0.22, 0.3), mat(TIMBER), 0.9, 0.15, 0.4));
			g.add(part(new THREE.BoxGeometry(0.36, 0.1, 0.24), mat(ore, 0.5), 0.9, 0.3, 0.4));
			break;
		}
		case 'smelter':
			g.add(part(new THREE.BoxGeometry(1.4, 0.9, 1.1), mat(STONE), 0, 0.45, 0));
			g.add(part(gable(1.5, 1.2, 0.5), mat(DARK, 0.7), 0, 0.9, 0));
			g.add(part(new THREE.BoxGeometry(0.35, 0.3, 0.05), mat('#ff8a3c', 0.3), 0.3, 0.25, 0.56));
			g.add(chimney(-0.45, 0.9, -0.2, 1.2));
			break;
		case 'toolmaker':
			g.add(house(1.4, 1.1, 0.85, '#2f8a84'));
			g.add(part(new THREE.BoxGeometry(0.4, 0.25, 0.2), mat(DARK, 0.4), 1.0, 0.3, 0.2));
			g.add(part(new THREE.BoxGeometry(0.18, 0.18, 0.18), mat(TIMBER), 1.0, 0.09, 0.2));
			g.add(chimney(-0.4, 1.0, -0.2, 0.5));
			break;
		case 'armourer':
			g.add(house(1.4, 1.1, 0.85, '#4a5260'));
			for (const [x, z] of [[1.0, 0.0], [1.0, 0.45]]) {
				const shield = part(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 8), mat(TEAM[owner], 0.5), x, 0.35, z);
				shield.rotation.z = Math.PI / 2;
				g.add(shield);
			}
			g.add(chimney(-0.4, 1.0, -0.2, 0.6));
			break;
		case 'mint':
			g.add(part(new THREE.BoxGeometry(1.4, 1.0, 1.1), mat(WALL), 0, 0.5, 0));
			g.add(part(new THREE.ConeGeometry(1.05, 0.7, 4), mat('#d9a92e', 0.4), 0, 1.35, 0).rotateY(Math.PI / 4));
			g.add(part(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 10), mat('#ffd23f', 0.3), 0.85, 0.05, 0.3));
			break;
		case 'guardhut':
			g.add(part(new THREE.BoxGeometry(1.1, 1.3, 1.1), mat(STONE), 0, 0.65, 0));
			for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.24, 0.24, 0.24), mat(STONE), sx * 0.43, 1.42, sz * 0.43));
			g.add(banner(owner, 2.3, 0, 0));
			break;
		case 'watchtower':
			g.add(part(new THREE.CylinderGeometry(0.6, 0.75, 2.6, 8), mat(STONE), 0, 1.3, 0));
			g.add(part(new THREE.ConeGeometry(0.85, 0.9, 8), mat(owner ? '#6b2a24' : '#2a4a72', 0.7), 0, 3.05, 0));
			g.add(banner(owner, 4.2, 0, 0));
			break;
		case 'keep': {
			g.add(part(new THREE.BoxGeometry(2.0, 2.4, 2.0), mat('#8e877c'), 0, 1.2, 0));
			for (const sx of [-1, 1])
				for (const sz of [-1, 1]) {
					g.add(part(new THREE.CylinderGeometry(0.45, 0.5, 3.0, 8), mat(STONE), sx * 1.05, 1.5, sz * 1.05));
					g.add(part(new THREE.ConeGeometry(0.58, 0.8, 8), mat(TEAM[owner], 0.7), sx * 1.05, 3.4, sz * 1.05));
				}
			g.add(banner(owner, 4.4, 0, 0));
			break;
		}
		default:
			g.add(house(1.2, 1.0, 0.8, '#999'));
	}
	g.userData.height = new THREE.Box3().setFromObject(g).max.y;
	return g;
}

/** a building site's scaffold: four posts and two beams round the footprint */
export function scaffold() {
	const g = new THREE.Group();
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(part(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 5), mat('#b88a52'), sx * 0.8, 0.65, sz * 0.65));
	for (const sz of [-1, 1]) g.add(part(new THREE.BoxGeometry(1.7, 0.06, 0.06), mat('#b88a52'), 0, 1.1, sz * 0.65));
	return g;
}

/** Puts the owner's colour on a model taken from the rival (or back). */
export function recolour(/** @type {THREE.Object3D} */ model, /** @type {number} */ owner) {
	model.traverse((o) => {
		if (o.name === 'cloth' && o instanceof THREE.Mesh) o.material = mat(TEAM[owner], 0.6);
	});
}
