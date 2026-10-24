// @ts-nocheck — plain JS
// The first trees' plants as MaiaCity V2 reads them (./plants.js) are the Plants' own: every seed a tree may grow
// from, every version of it, its name and its stages' days and names.
// Run: bun test src/lib/maiacity-v2/plants.test.js
import { expect, test } from 'bun:test';
import { PLANT_IDS, plantOf, plantRef } from './plants.js';
import { plantsContract } from '../maiacity-testing/plants.js';
import { SEEDLINGS } from '../../../game/maiacity-v2/engine.js';

plantsContract('v2', { PLANT_IDS, plantOf }, SEEDLINGS);

test('a tree’s ref names the plant, its version, its stage and its seed', () => {
	expect(plantRef(plantOf('apple', 1), 3.25, 'Ada B')).toBe('plants/apple@1?stage=3.25&seed=Ada%20B');
});
