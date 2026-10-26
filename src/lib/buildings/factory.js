// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE SOLAR FACTORY DOME AS A BUILDING — the Buildings' factory from v2 (`buildings/dome-factory@2`), built in the
 * asset box like the tent from its v2: Sandbox 3's factory dome (its v1, raised by that world's own code, ./inside.js)
 * as one object, by the same builders: the geodesic shell and its doors ($lib/sandbox-2/interior/interior.ts) and the
 * five floors of lines round the great lift ($lib/sandbox-2/interior/factory.ts), as they stand in Sandbox 3, without
 * the land round it. Its machines run as the dome's do, by its own clock (`tick`); the lift stands at the ground floor.
 * Walked in from just inside its north door, on the floors its own shape has. What the world adds round it (its sky
 * and sun, the lamps that follow you at night, its sounds, the lift's ↑ and ↓) stays the world's.
 */
import * as THREE from 'three';
import { DOMES, bake, box, geodesic, mats, portal } from '$lib/sandbox-2/interior/interior';
import { buildFactory } from '$lib/sandbox-2/interior/factory';

/** a station's sign, as the factory paints it ($lib/sandbox-2/interior/factory.ts `sign`), and the gap kept round each
 *  in the atlas, in its own dark grey, so a far view's blur takes nothing from the sign beside it */
const SIGN = { w: 768, h: 176, gap: 8, ground: '#23292e' };

/**
 * The signs, on one picture: the factory paints one for each of its stations, 78 pictures, and the box hands back at
 * most 64 ($lib/assets/box/rebuild.js BUDGET). Each sign's material shows its own piece of the atlas instead (its
 * place and size on it, `offset` and `repeat`), as sharp as before, the sign itself unchanged.
 * @param {THREE.Object3D} root
 */
function atlasOfSigns(root) {
	/** each sign's picture and the materials showing it, in the order they are met */
	const signs = new Map();
	root.traverse((o) => {
		if (!o.isMesh) return;
		for (const m of [o.material].flat()) {
			const t = m.map;
			if (!t || t !== m.emissiveMap || t.image?.width !== SIGN.w || t.image?.height !== SIGN.h) continue;
			if (!signs.has(t.image)) signs.set(t.image, new Set());
			signs.get(t.image).add(m);
		}
	});
	if (signs.size < 2) return;
	const cw = SIGN.w + SIGN.gap * 2, ch = SIGN.h + SIGN.gap * 2;
	const cols = Math.min(signs.size, Math.floor(4096 / cw)), rows = Math.ceil(signs.size / cols);
	const canvas = document.createElement('canvas');
	canvas.width = cols * cw;
	canvas.height = rows * ch;
	const x = canvas.getContext('2d');
	x.fillStyle = SIGN.ground;
	x.fillRect(0, 0, canvas.width, canvas.height);
	const atlas = new THREE.CanvasTexture(canvas);
	atlas.colorSpace = THREE.SRGBColorSpace;
	let i = 0;
	for (const [picture, materials] of signs) {
		const col = i % cols, row = Math.floor(i++ / cols);
		x.drawImage(picture, col * cw + SIGN.gap, row * ch + SIGN.gap);
		const t = atlas.clone();
		t.repeat.set(SIGN.w / canvas.width, SIGN.h / canvas.height);
		// (a canvas's picture is turned upright as it is drawn: its top row is the texture's top)
		t.offset.set((col * cw + SIGN.gap) / canvas.width, 1 - (row * ch + SIGN.gap + SIGN.h) / canvas.height);
		for (const m of materials) {
			m.map.dispose();
			m.map = m.emissiveMap = t;
			m.needsUpdate = true;
		}
	}
}

/** The solar factory dome: its shell, its doors and its five floors of lines, the middle of its floor at the origin. */
export function factoryDome() {
	const spec = DOMES.factory;
	const R = spec.diameter / 2;
	const m = mats();
	const g = new THREE.Group();
	g.name = 'solar-factory-dome';
	const shell = geodesic(spec, m, 'factory');
	g.add(shell.group);
	for (const hole of shell.holes) g.add(portal(m, hole, 'factory'));
	const works = buildFactory({ scene: g, R, m, box, bake });
	atlasOfSigns(g);
	g.userData = {
		tick: (t) => works.update(t),
		walk: { x: works.start.x, z: works.start.z, yaw: works.start.look, lamps: [] }
	};
	return g;
}
