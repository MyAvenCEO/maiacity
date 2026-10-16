// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * A PLANT'S EARTH ON THE STAGE — the round of soil a plant stands in, as the plants viewer has always shown it: as deep
 * as its roots, wide round them, its near side and its top see-through (we look in through them), its far wall solid,
 * so the roots show against the earth behind them from whichever side we look. The stage's floor is its foot.
 */
import * as THREE from 'three';

/** a speckled earth, drawn once */
function grainOf() {
	const c = document.createElement('canvas');
	c.width = c.height = 256;
	const x = c.getContext('2d');
	x.fillStyle = '#9c7a58';
	x.fillRect(0, 0, 256, 256);
	let s = 7;
	const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
	for (let i = 0; i < 2600; i++) {
		const r = rnd() * 2.6 + 0.4;
		const tone = rnd();
		x.fillStyle = tone < 0.55 ? `rgba(40,26,16,${0.25 + rnd() * 0.4})` : tone < 0.9 ? `rgba(120,92,62,${0.3 + rnd() * 0.4})` : `rgba(214,200,170,${0.35 + rnd() * 0.4})`;
		x.beginPath();
		x.arc(rnd() * 256, rnd() * 256, r, 0, Math.PI * 2);
		x.fill();
	}
	const t = new THREE.CanvasTexture(c);
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

/** the earth: `group` to add to a scene, `fit(box)` to size it to a plant's bounds (its depth, under 0) */
export function soilOf() {
	const grain = grainOf(), top = grain.clone();
	const walls = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, false), new THREE.MeshStandardMaterial({ color: '#c09a74', map: grain, roughness: 1, side: THREE.BackSide }));
	walls.receiveShadow = true;
	const sides = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), new THREE.MeshStandardMaterial({ color: '#a07a56', map: grain, roughness: 1, transparent: true, opacity: 0.1, depthWrite: false }));
	const face = new THREE.Mesh(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#b08860', map: top, roughness: 1, transparent: true, opacity: 0.32, depthWrite: false }));
	// its see-through top takes no shadow: on a face that thin a shadow map draws stripes, not leaves
	const ring = (y) => {
		const pts = [];
		for (let k = 0; k <= 96; k++) pts.push(new THREE.Vector3(Math.cos((k / 96) * Math.PI * 2), y, Math.sin((k / 96) * Math.PI * 2)));
		return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#4a3424', transparent: true, opacity: 0.4 }));
	};
	const group = new THREE.Group();
	group.add(walls, sides, face, ring(0.5), ring(-0.5));
	// the stage keeps its studio things out of a part's pick and its x-ray
	group.traverse((o) => (o.userData.studio = true));
	return {
		group,
		/** sized to a plant: as deep as its roots and a little more, wide round them; its depth (m) @param {THREE.Box3} b */
		fit(b) {
			const below = Math.max(0, -b.min.y);
			const half = Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
			const r = Math.max(below * 1.1, half * 1.6 + Math.max(below, half) * 0.15) + 0.02;
			const d = below * 1.12 + 0.02;
			group.scale.set(r, d, r);
			group.position.y = -d / 2;
			grain.repeat.set(Math.max(1, (r * Math.PI * 2) / 0.06), Math.max(1, d / 0.06));
			top.repeat.set(Math.max(1, (r * 2) / 0.06), Math.max(1, (r * 2) / 0.06));
			return d;
		},
		dispose() {
			group.traverse((o) => {
				o.geometry?.dispose();
				o.material?.dispose();
			});
			grain.dispose();
			top.dispose();
		}
	};
}
