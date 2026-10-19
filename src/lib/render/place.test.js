// @ts-nocheck — plain JS
// Placing only what is seen (./core.js `place`): the same world matrices three.js works out, hidden ones placed once shown.
// Run: bun test src/lib/render/place.test.js
import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { place } from './core.js';

describe('placing what is seen', () => {
	test('a visible tree is placed as three.js places it', () => {
		const a = new THREE.Scene(), b = a.clone(true);
		const build = (s) => {
			const g = new THREE.Group();
			g.position.set(3, 1, -2);
			g.rotation.y = 0.7;
			const m = new THREE.Object3D();
			m.position.set(0, 2, 5);
			m.scale.setScalar(2);
			g.add(m);
			s.add(g);
			return m;
		};
		const ma = build(a), mb = build(b);
		a.updateMatrixWorld();
		place(b, false);
		expect(mb.matrixWorld.elements).toEqual(ma.matrixWorld.elements);
	});

	test('a hidden one is skipped, and placed where it belongs once shown', () => {
		const s = new THREE.Scene();
		const g = new THREE.Group(), m = new THREE.Object3D();
		g.add(m);
		s.add(g);
		m.position.set(1, 0, 0);
		m.visible = false;
		place(s, false);
		g.position.set(10, 0, 0);
		place(s, false);
		expect(m.matrixWorld.elements[12]).toBe(0);
		m.visible = true;
		place(s, false);
		expect(m.matrixWorld.elements[12]).toBe(11);
	});

	test('one placed by hand (no auto update) under a moved parent is placed again once shown', () => {
		const s = new THREE.Scene();
		const g = new THREE.Group(), m = new THREE.Object3D();
		m.position.set(2, 0, 0);
		m.updateMatrix();
		m.matrixAutoUpdate = false;
		g.add(m);
		s.add(g);
		place(s, false);
		m.visible = false;
		g.position.set(5, 0, 0);
		place(s, false);
		m.visible = true;
		place(s, false);
		expect(m.matrixWorld.elements[12]).toBe(7);
	});

	test("a skinned mesh's bind follows it, as three.js's own placing has it (else drawn where it stood when built)", () => {
		const s = new THREE.Scene();
		const bone = new THREE.Bone();
		const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
		mesh.add(bone);
		mesh.bind(new THREE.Skeleton([bone]));
		s.add(mesh);
		mesh.position.set(48, 0, 75);
		place(s, false);
		const want = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
		expect(mesh.bindMatrixInverse.elements).toEqual(want.elements);
	});

	test("a camera's view follows it", () => {
		const s = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
		s.add(cam);
		cam.position.set(3, 4, 5);
		place(s, false);
		expect(cam.matrixWorldInverse.elements[12]).toBe(-3);
	});
});
