// @ts-nocheck — three.js scene building through window.__world (Sandbox 4), as the shot lists always did
// Sets for the film, built into Sandbox 4's scene while it is filmed (never in the game itself). A shot names its set
// (world.props: 'tired-land'); the film camera (src/lib/film) builds it once, then moves what moves on the world's
// own clock (`window.__props(clock)`), so a truck is exactly where the shot expects it at every frame.
// Its randomness is seeded (the shot's world.seed): the same fields every time.
import { seededRandom } from './clock.js';

/** The world as it was: beyond the city's western edge (x ≈ −390), ploughed fields of one crop to the horizon, a
 *  highway running north–south through them (x = −470), power lines beside it, trucks on it. */
export function tiredLand(seed = 1) {
	if (window.__props) return;
	const rand = seededRandom(seed);
	const v = window.__world ?? window.__village, T = v.THREE, scene = v.scene;
	const set = new T.Group();
	set.name = 'tired-land';

	// the fields: patches of one crop, the rows ploughed this way or that, dull ochre and tired green
	const c = document.createElement('canvas');
	c.width = c.height = 1024;
	const g = c.getContext('2d');
	const tones = ['#8c7d50', '#7b6d44', '#948758', '#6f6a45', '#857a4c', '#7a7550'];
	for (let px = 0; px < 4; px++)
		for (let pz = 0; pz < 4; pz++) {
			const x0 = px * 256, z0 = pz * 256, tone = tones[(px * 3 + pz * 5) % tones.length], across = (px + pz) % 2;
			g.fillStyle = tone;
			g.fillRect(x0, z0, 256, 256);
			g.fillStyle = 'rgba(40,32,18,0.28)';
			for (let r = 0; r < 256; r += 6) across ? g.fillRect(x0 + r, z0, 2, 256) : g.fillRect(x0, z0 + r, 256, 2);
			g.fillStyle = 'rgba(52,44,28,0.9)'; // the tracks between fields
			g.fillRect(x0, z0, 256, 3);
			g.fillRect(x0, z0, 3, 256);
		}
	for (let i = 0; i < 9000; i++) {
		g.fillStyle = `rgba(${50 + rand() * 40},${40 + rand() * 30},20,${rand() * 0.25})`;
		g.fillRect(rand() * 1024, rand() * 1024, 2, 2);
	}
	const tex = new T.CanvasTexture(c);
	tex.wrapS = tex.wrapT = T.RepeatWrapping;
	tex.repeat.set(8, 8);
	tex.colorSpace = T.SRGBColorSpace;
	tex.anisotropy = 16;
	const fields = new T.Mesh(new T.PlaneGeometry(2600, 2600), new T.MeshStandardMaterial({ map: tex, roughness: 1 }));
	fields.rotation.x = -Math.PI / 2;
	fields.position.set(-398 - 1300, 0.05, 0);
	fields.receiveShadow = true;
	set.add(fields);

	// the highway: asphalt, a dashed line, a pale verge
	const ROAD = -470;
	const road = new T.Mesh(new T.PlaneGeometry(10, 2600), new T.MeshStandardMaterial({ color: '#3a3a39', roughness: 0.92 }));
	road.rotation.x = -Math.PI / 2;
	road.position.set(ROAD, 0.1, 0);
	road.receiveShadow = true;
	set.add(road);
	for (const side of [-6.2, 6.2]) {
		const verge = new T.Mesh(new T.PlaneGeometry(2.4, 2600), new T.MeshStandardMaterial({ color: '#9a9272', roughness: 1 }));
		verge.rotation.x = -Math.PI / 2;
		verge.position.set(ROAD + side, 0.09, 0);
		set.add(verge);
	}
	const dash = new T.InstancedMesh(new T.PlaneGeometry(0.25, 4), new T.MeshStandardMaterial({ color: '#e8e4d8', roughness: 0.8 }), 220);
	const m = new T.Matrix4(), q = new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0)), one = new T.Vector3(1, 1, 1);
	for (let i = 0; i < 220; i++) dash.setMatrixAt(i, m.compose(new T.Vector3(ROAD, 0.12, -1300 + i * 12), q, one));
	set.add(dash);

	// power lines beside it: poles every 45 m, three wires
	const wood = new T.MeshStandardMaterial({ color: '#4d4336', roughness: 1 });
	const POLES = 58, poles = new T.InstancedMesh(new T.CylinderGeometry(0.16, 0.22, 11, 6), wood, POLES);
	const arms = new T.InstancedMesh(new T.BoxGeometry(2.6, 0.14, 0.14), wood, POLES);
	for (let i = 0; i < POLES; i++) {
		const z = -1300 + i * 45;
		poles.setMatrixAt(i, m.compose(new T.Vector3(ROAD - 9, 5.5, z), new T.Quaternion(), one));
		arms.setMatrixAt(i, m.compose(new T.Vector3(ROAD - 9, 10.4, z), new T.Quaternion(), one));
	}
	poles.castShadow = arms.castShadow = true;
	set.add(poles, arms);
	for (const dx of [-1.2, 0, 1.2]) {
		const wire = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 2600, 4), new T.MeshBasicMaterial({ color: '#222' }));
		wire.rotation.x = Math.PI / 2;
		wire.position.set(ROAD - 9 + dx, 10.5, 0);
		set.add(wire);
	}

	// a few dead trees in the fields
	const bark = new T.MeshStandardMaterial({ color: '#5a5044', roughness: 1 });
	for (const [x, z, s] of [[-520, -60, 1], [-610, 90, 1.3], [-455, 150, 0.9], [-700, -140, 1.1], [-560, 230, 1]]) {
		const tree = new T.Group();
		const trunk = new T.Mesh(new T.CylinderGeometry(0.25 * s, 0.4 * s, 6 * s, 6), bark);
		trunk.position.y = 3 * s;
		tree.add(trunk);
		for (let k = 0; k < 5; k++) {
			const b = new T.Mesh(new T.CylinderGeometry(0.05 * s, 0.14 * s, 3.2 * s, 5), bark);
			b.position.set(0, (4 + k * 0.5) * s, 0);
			b.rotation.set(0.9 * Math.cos(k * 2.4), k * 1.3, 0.9 * Math.sin(k * 2.4));
			b.translateY(1.4 * s);
			tree.add(b);
		}
		tree.position.set(x, 0, z);
		tree.traverse((o) => (o.castShadow = true));
		set.add(tree);
	}

	// the trucks: a cab and a box trailer; each drives its lane at its speed, `z32` = where it is at 0:32 on the film
	const paint = (color) => new T.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
	const tyre = new T.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 });
	const glass = new T.MeshStandardMaterial({ color: '#223038', roughness: 0.15, metalness: 0.4 });
	const truck = (cab, box) => {
		const t = new T.Group();
		const trailer = new T.Mesh(new T.BoxGeometry(2.55, 3.1, 12), paint(box));
		trailer.position.set(0, 2.45, -1.2);
		const c = new T.Mesh(new T.BoxGeometry(2.5, 2.6, 2.4), paint(cab));
		c.position.set(0, 2.1, 6.2);
		const w = new T.Mesh(new T.BoxGeometry(2.3, 1.0, 0.05), glass);
		w.position.set(0, 2.7, 7.42);
		const chassis = new T.Mesh(new T.BoxGeometry(2.3, 0.5, 15), tyre);
		chassis.position.set(0, 0.7, 0);
		t.add(trailer, c, w, chassis);
		for (const z of [-5.8, -4.6, 3.4, 6.4])
			for (const x of [-1.15, 1.15]) {
				const wheel = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 0.4, 12), tyre);
				wheel.rotation.z = Math.PI / 2;
				wheel.position.set(x, 0.5, z);
				t.add(wheel);
			}
		t.traverse((o) => (o.castShadow = true));
		set.add(t);
		return t;
	};
	const fleet = [
		{ dir: 1, speed: 22, z32: 5, cab: '#c8c4bc', box: '#dcdad4' }, // the one the camera rides beside (0:32)
		{ dir: -1, speed: 21, z32: 180, cab: '#8a2d24', box: '#cfcac0' },
		{ dir: -1, speed: 23, z32: 330, cab: '#2e4a6a', box: '#b9b6ae' },
		{ dir: -1, speed: 20, z32: 520, cab: '#d8d2c4', box: '#8f8b82' },
		{ dir: 1, speed: 21, z32: -160, cab: '#5b5f63', box: '#d6d3cb' },
		{ dir: 1, speed: 24, z32: 120, cab: '#a33a2a', box: '#e0ddd6' },
		{ dir: -1, speed: 22, z32: -40, cab: '#3d4a3a', box: '#c4c0b6' },
		{ dir: 1, speed: 20, z32: -420, cab: '#c8c4bc', box: '#9a968c' }
	].map((f) => ({ ...f, body: truck(f.cab, f.box) }));
	window.__props = (clock) => {
		for (const f of fleet) {
			const z = f.z32 + f.dir * f.speed * (clock - 32);
			f.body.position.set(ROAD + (f.dir > 0 ? -2.4 : 2.4), 0, z);
			f.body.rotation.y = f.dir > 0 ? 0 : Math.PI;
		}
	};
	scene.add(set);
	// the film shows a set only in the shots that name it (src/lib/film/index.js)
	(window.__sets ??= {})['tired-land'] = set;
}

export const sets = { 'tired-land': tiredLand };
