// @ts-nocheck — executed by bun:test
import { expect, test } from 'bun:test';
import { Box3, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { growthFrame } from './tree-camera.js';

for (const aspect of [16 / 9, 9 / 16]) {
	for (const height of [0.08, 1, 25]) {
		test(`watering close-up fits a ${height}m tree at aspect ${aspect}`, () => {
			const bounds = new Box3(new Vector3(-height / 4, 0, -height / 4), new Vector3(height / 4, height, height / 4));
			const transform = new Matrix4().makeTranslation(20, 0, -10);
			const { eye, target } = growthFrame(bounds, transform, new Vector3(25, 3, -15), aspect);
			const camera = new PerspectiveCamera(42, aspect, 0.01, 1000);
			camera.position.copy(eye); camera.lookAt(target); camera.updateMatrixWorld();
			for (const x of [bounds.min.x, bounds.max.x]) for (const y of [0, height]) for (const z of [bounds.min.z, bounds.max.z]) {
				const p = new Vector3(x, y, z).applyMatrix4(transform).project(camera);
				expect(Math.abs(p.x)).toBeLessThan(1);
				expect(Math.abs(p.y)).toBeLessThan(1);
				expect(p.z).toBeGreaterThan(-1);
				expect(p.z).toBeLessThan(1);
			}
		});
	}
}

for (const aspect of [16 / 9, 9 / 16]) {
 test(`watering frames the person above ground even from a distant camera (${aspect})`, () => {
  const bounds = new Box3(new Vector3(-0.02, 0, -0.02), new Vector3(0.02, 0.08, 0.02));
  const transform = new Matrix4().makeTranslation(20, 0, -10);
  for (const previous of [new Vector3(2000, -5, 1000), new Vector3(20, 0, -10)]) {
   const {eye, target} = growthFrame(bounds, transform, previous, aspect);
   expect(eye.y).toBeGreaterThan(1.9);
   const camera = new PerspectiveCamera(42, aspect, 0.01, 1000);
   camera.position.copy(eye); camera.lookAt(target); camera.updateMatrixWorld();
   for (const x of [-0.55, 0.55]) for (const y of [0, 1.9]) for (const z of [-1.1, 0.4]) {
    const p = new Vector3(x, y, z).applyMatrix4(transform).project(camera);
    expect(Math.abs(p.x)).toBeLessThan(1); expect(Math.abs(p.y)).toBeLessThan(1);
    expect(p.z).toBeGreaterThan(-1); expect(p.z).toBeLessThan(1);
   }
  }
 });
}
