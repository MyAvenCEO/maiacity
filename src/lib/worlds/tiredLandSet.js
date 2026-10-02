// @ts-nocheck — three.js scene building, as the shot lists always did
// THE TIRED LAND — the world as it was: beyond a city's western edge (x ≈ −390), ploughed fields of one crop to the
// horizon, a highway running north–south through them (x = −470), power lines beside it, dead trees, trucks on it.
// Built once here, for two places: Sandbox 4's film set (src/lib/film/sets.js, `world.props: 'tired-land'`, Day 19)
// and the tired land as a world of its own (./tired-land.ts, the Worlds grid). Its randomness is seeded: the same
// fields every time; `drive(clock)` puts every truck where it is at that second.
import * as THREE from 'three';
import { seededRandom } from '../film/clock.js';
import { truck } from '../models/furniture';

/** The world as it was: beyond the city's western edge (x ≈ −390), ploughed fields of one crop to the horizon, a
 *  highway running north–south through them (x = −470), power lines beside it, trucks on it. */
export function buildTiredLand(seed = 1) {
	const T = THREE;
	const rand = seededRandom(seed);
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

	// the trucks (the model: src/lib/models/furniture.ts): each drives its lane at its speed, `z32` = where it is at
	// 0:32 on the film
	const lorry = (cab, box) => {
		const t = truck({ cab, box });
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
	].map((f) => ({ ...f, body: lorry(f.cab, f.box) }));
	/** the trucks where they are at `clock` seconds (the world's clock, or the shot's) */
	const drive = (clock) => {
		for (const f of fleet) {
			const z = f.z32 + f.dir * f.speed * (clock - 32);
			f.body.position.set(ROAD + (f.dir > 0 ? -2.4 : 2.4), 0, z);
			f.body.rotation.y = f.dir > 0 ? 0 : Math.PI;
		}
	};
	return { set, drive };
}
