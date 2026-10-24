// @ts-nocheck — Bun test runtime, outside the browser type environment
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { timberCoop, timberHutch, playground } from './timber.v1.js';
import * as world from '../sandbox-2/interior/spaces';

/** @param {import('three').Object3D} root */
function fingerprint(root) {
	const hash = createHash('sha256');
	const write = (value) => hash.update(JSON.stringify(value, (key, item) => typeof item === 'number' ? Math.round(item * 1e5) / 1e5 : item));
	root.updateMatrixWorld(true);
	root.traverse((object) => {
		write([object.type, object.matrixWorld.elements, object.castShadow, object.receiveShadow]);
		const mesh = /** @type {import('three').Mesh} */ (object);
		if (mesh.geometry) {
			const geometry = mesh.geometry;
			for (const key of Object.keys(geometry.attributes).sort()) write(Array.from(geometry.attributes[key].array));
			if (geometry.index) write(Array.from(geometry.index.array));
			write(geometry.groups);
		}
		for (const material of [mesh.material].flat().filter(Boolean)) {
			const surface = /** @type {import('three').MeshStandardMaterial} */ (material);
			write([surface.type, surface.color?.getHex(), surface.roughness, surface.metalness, surface.opacity, surface.side, surface.transparent, surface.depthWrite]);
		}
	});
	return hash.digest('hex');
}

test('historical geometry, transforms and materials match the pre-move fingerprints', () => {
	expect(fingerprint(timberCoop())).toBe('a83b228dee1ec549b0583a4bbc58438b154bd36a38aaf48606832d57f4af602b');
	expect(fingerprint(timberHutch())).toBe('ae4d9bc8bd153d22a4412feb7b731c92c85619238ef61d7897c91f3370c2df75');
	expect(fingerprint(playground(7).group)).toBe('1cdd13eb8cf15a1840f10fe488aa0f3b04ba508ac9edccf007215078c4ae4064');
	expect(world.timberCoop).toBe(timberCoop);
	expect(world.timberHutch).toBe(timberHutch);
	expect(world.playground).toBe(playground);
});
