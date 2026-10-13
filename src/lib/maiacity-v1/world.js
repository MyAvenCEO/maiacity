// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V1's world, in three.js, and nothing but it: the one settlement hex, standing alone in the sky, with the
 * 2-person dome tent in the middle and the two players beside it, a glow of HEARTS over each, and the Village COOP's
 * four machines (the Assets' pickup, powercube, solar panel and battery pack) spread round it. The COOPs and the pool
 * are not drawn: the page lists them. The sun follows the virtual day (a real day is a month of 28 days). It only draws
 * the game; tapping a player names them (onPick), and every frame the players' labels' places go to onLabels.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { batteryPack, pickup, powercube, solarPanel } from '$lib/models/village.js';

const HEX_R = 34;
const SEAT_COLOUR = { A: 0x3f6f9a, B: 0xd7a53a };
/** the Village COOP's assets (engine COOPS.village, by id) and where each stands on the hex: x, z, turned; the panel faces the sun at −z */
const ASSETS = [
	{ id: 'pickup', make: pickup, at: [-13, 11, 2.2], clear: 6 },
	{ id: 'powercube', make: powercube, at: [12, -6, -0.5], clear: 5 },
	{ id: 'solar', make: solarPanel, at: [-3, -12, Math.PI], clear: 5 },
	{ id: 'battery', make: batteryPack, at: [13, 6, -0.9], clear: 5 }
];

/** a little seeded random, so the trees stand in the same places for everyone */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });

function hexGround() {
	const g = new THREE.Group();
	const land = new THREE.Mesh(new THREE.CylinderGeometry(HEX_R, HEX_R - 1.5, 4, 6, 1), [mat(0x7aa35f), mat(0x8fb26c), mat(0x6b5a44)]);
	land.position.y = -2;
	land.receiveShadow = true;
	g.add(land);
	const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(HEX_R, HEX_R, 0.05, 6)), new THREE.LineBasicMaterial({ color: 0xf4f1e8, transparent: true, opacity: 0.7 }));
	edge.position.y = 0.04;
	g.add(edge);
	return g;
}

function tent() {
	const g = new THREE.Group();
	const r = 4.2;
	const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), mat(0xf1e8d4, { side: THREE.DoubleSide }));
	// keep the upper half only: a geodesic dome
	const pos = shell.geometry.attributes.position;
	for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) pos.setY(i, 0);
	pos.needsUpdate = true;
	shell.geometry.computeVertexNormals();
	shell.castShadow = true;
	g.add(shell);
	const struts = new THREE.LineSegments(new THREE.EdgesGeometry(shell.geometry, 1), new THREE.LineBasicMaterial({ color: 0x6b5236 }));
	g.add(struts);
	const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2, 0.3), mat(0x3b2f24));
	door.position.set(0, 1, r - 0.25);
	g.add(door);
	const deck = new THREE.Mesh(new THREE.CylinderGeometry(r + 1.2, r + 1.2, 0.2, 24), mat(0xb08a5e));
	deck.position.y = 0.05;
	deck.receiveShadow = true;
	g.add(deck);
	return g;
}

function person(seat) {
	const g = new THREE.Group();
	g.name = `player:${seat}`;
	const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.9, 4, 10), mat(SEAT_COLOUR[seat]));
	body.position.y = 0.95;
	body.castShadow = true;
	body.name = g.name;
	const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 10), mat(0xe8c4a0));
	head.position.y = 2.05;
	head.castShadow = true;
	head.name = g.name;
	const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), new THREE.MeshStandardMaterial({ color: 0xe0435a, emissive: 0xe0435a, emissiveIntensity: 0.7 }));
	glow.position.y = 3;
	glow.name = g.name;
	g.add(body, head, glow);
	g.userData.glow = glow;
	return g;
}

function trees(group) {
	const r = rng(42);
	const trunk = mat(0x6b4f35);
	const leaves = [mat(0x3f6e3a), mat(0x4f7f40), mat(0x5d8a45)];
	for (let i = 0; i < 70; i++) {
		const a = r() * Math.PI * 2;
		const d = 9 + r() * (HEX_R - 11);
		const x = Math.cos(a) * d;
		const z = Math.sin(a) * d;
		if (Math.abs(x) < 8 && z > 0 && z < 12) continue;
		if (ASSETS.some(({ at, clear }) => Math.hypot(x - at[0], z - at[1]) < clear)) continue;
		const t = new THREE.Group();
		const h = 1.5 + r() * 2.5;
		const s = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, h, 6), trunk);
		s.position.y = h / 2;
		const crown = r() < 0.5 ? new THREE.Mesh(new THREE.ConeGeometry(1 + r(), 2.5 + r() * 2, 7), leaves[i % 3]) : new THREE.Mesh(new THREE.IcosahedronGeometry(1 + r() * 0.9, 0), leaves[i % 3]);
		crown.position.y = h + 0.9;
		s.castShadow = crown.castShadow = true;
		t.add(s, crown);
		t.position.set(x, 0, z);
		group.add(t);
	}
}

export function createWorld(canvas, { onPick = () => {}, onLabels = () => {} } = {}) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	const scene = new THREE.Scene();
	const sky = new THREE.Color(0xcfe0e6);
	scene.background = sky;
	scene.fog = new THREE.Fog(sky, 140, 320);
	const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 600);
	camera.position.set(52, 44, 64);
	const controls = new OrbitControls(camera, canvas);
	controls.target.set(2, 1, 3);
	controls.enableDamping = true;
	controls.minDistance = 18;
	controls.maxDistance = 120;
	controls.maxPolarAngle = Math.PI * 0.44;
	controls.autoRotate = true;
	controls.autoRotateSpeed = 0.25;
	controls.addEventListener('start', () => (controls.autoRotate = false));

	const hemi = new THREE.HemisphereLight(0xeef4ff, 0x5b6b45, 1.1);
	scene.add(hemi);
	const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
	scene.add(sun, sun.target);

	const world = new THREE.Group();
	scene.add(world);
	world.add(hexGround());
	const theTent = tent();
	world.add(theTent);
	const people = { A: person('A'), B: person('B') };
	people.A.position.set(-5.5, 0, 7);
	people.B.position.set(5.5, 0, 6);
	people.B.rotation.y = -0.4;
	people.A.rotation.y = 0.4;
	world.add(people.A, people.B);
	// the Village COOP's machines; tapping one names it
	for (const { id, make, at } of ASSETS) {
		const a = make();
		a.position.set(at[0], 0, at[1]);
		a.rotation.y = at[2];
		a.traverse((o) => {
			o.name = `asset:${id}`;
			if (o.isMesh) o.castShadow = true;
		});
		world.add(a);
	}
	trees(world);

	// what each label hangs over
	const anchors = {
		'player:A': () => people.A.localToWorld(new THREE.Vector3(0, 3.8, 0)),
		'player:B': () => people.B.localToWorld(new THREE.Vector3(0, 3.8, 0))
	};

	let hour = 11;
	let state = null;
	function update(view, h) {
		state = view;
		if (h != null) hour = h;
		if (!view) return;
		for (const seat of ['A', 'B']) {
			const hearts = view.players[seat].wallet.HEARTS;
			const glow = people[seat].userData.glow;
			glow.visible = hearts > 0.01;
			glow.scale.setScalar(0.5 + Math.min(1.5, hearts / 24));
		}
	}

	// the sun by the virtual hour: up from 6 to 18, low and warm at the ends, a cool night with a moonlight
	function light(t) {
		const day = (hour - 6) / 12;
		const up = Math.sin(Math.PI * Math.min(1, Math.max(0, day)));
		const a = Math.PI * day;
		sun.position.set(Math.cos(a) * 90, 8 + up * 80, -30 + Math.sin(a) * 20);
		sun.intensity = 0.25 + up * 2.1;
		sun.color.setHSL(0.1, 0.6 - up * 0.3, 0.75 + up * 0.15);
		hemi.intensity = 0.35 + up * 0.85;
		const c = new THREE.Color(0x1d2b3d).lerp(new THREE.Color(0xcfe0e6), Math.min(1, up * 1.6));
		scene.background.copy(c);
		scene.fog.color.copy(c);
		for (const seat of ['A', 'B']) {
			const g = people[seat].userData.glow;
			g.rotation.y = t * 1.5;
			g.position.y = 3 + Math.sin(t * 2 + (seat === 'A' ? 0 : 1.5)) * 0.12;
		}
	}

	function resize() {
		const w = canvas.clientWidth || 1;
		const h = canvas.clientHeight || 1;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.fov = w / h < 0.8 ? 58 : 42;
		camera.updateProjectionMatrix();
	}
	const ro = new ResizeObserver(resize);
	ro.observe(canvas);
	resize();
	// upright, the whole hex needs the camera further out
	if (camera.aspect < 0.8) camera.position.set(86, 74, 106);

	// a tap (not a drag) names the thing under it
	const ray = new THREE.Raycaster();
	let down = null;
	const onDown = (e) => (down = [e.clientX, e.clientY]);
	const onUp = (e) => {
		if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
		const r = canvas.getBoundingClientRect();
		ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
		const hit = ray.intersectObjects(world.children, true).find((h) => h.object.name);
		onPick(hit ? hit.object.name : null);
	};
	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointerup', onUp);

	let frame = 0;
	let raf = 0;
	const clock = new THREE.Clock();
	function loop() {
		raf = requestAnimationFrame(loop);
		const t = clock.getElapsedTime();
		controls.update();
		light(t);
		renderer.render(scene, camera);
		if (++frame % 4 === 0) {
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			const out = {};
			for (const [k, f] of Object.entries(anchors)) {
				const p = f().project(camera);
				out[k] = { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, on: p.z < 1 };
			}
			onLabels(out);
		}
	}
	loop();

	return {
		update,
		dispose() {
			cancelAnimationFrame(raf);
			ro.disconnect();
			canvas.removeEventListener('pointerdown', onDown);
			canvas.removeEventListener('pointerup', onUp);
			controls.dispose();
			renderer.dispose();
		}
	};
}
