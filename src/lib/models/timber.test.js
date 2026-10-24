// @ts-nocheck — Bun test runtime, outside the browser type environment
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { timberCoop, timberHutch, playground } from './timber.v1.js';
import * as world from '../sandbox-2/interior/spaces';

/** @param {import('three').Object3D} root */
function fingerprint(root) {
	const hash = createHash('sha256');
	root.updateMatrixWorld(true);
	root.traverse((object) => {
		hash.update(JSON.stringify([object.type, object.matrixWorld.elements, object.castShadow, object.receiveShadow]));
		const mesh = /** @type {import('three').Mesh} */ (object);
		if (mesh.geometry) {
			const geometry = mesh.geometry;
			for (const key of Object.keys(geometry.attributes).sort()) hash.update(Buffer.from(geometry.attributes[key].array.buffer));
			if (geometry.index) hash.update(Buffer.from(geometry.index.array.buffer));
			hash.update(JSON.stringify(geometry.groups));
		}
		for (const material of [mesh.material].flat().filter(Boolean)) {
			const surface = /** @type {import('three').MeshStandardMaterial} */ (material);
			hash.update(JSON.stringify([surface.type, surface.color?.getHex(), surface.roughness, surface.metalness, surface.opacity, surface.side, surface.transparent, surface.depthWrite]));
		}
	});
	return hash.digest('hex');
}

test('historical geometry, transforms and materials match the pre-move fingerprints', () => {
	expect(fingerprint(timberCoop())).toBe('cccebdceb36ee717a8a804ca6764ff0376e14bd6a3850bdc7b2a4f3b14b24181');
	expect(fingerprint(timberHutch())).toBe('bd50de1c5620fc4c56b8f02803c4db1a35a4c83d913f2ca11c183ddf5a1637ca');
	expect(fingerprint(playground(7).group)).toBe('94a9b226aba7dbc070e0114929363763ae38b3fb1ce985a638463f771e0f52ec');
	expect(world.timberCoop).toBe(timberCoop);
	expect(world.timberHutch).toBe(timberHutch);
	expect(world.playground).toBe(playground);
});
