// @ts-nocheck — plain JS
// The first trees' plants as MaiaCity V1 reads them (./plants.js) are the Plants' own: every seed a tree may grow
// from, every version of it, its name and its stages' days and names.
// Run: bun test src/lib/maiacity-v1/plants.test.js
import { expect, test } from 'bun:test';
import { pinnedAs } from '$lib/assets/pins.fixture.js';
import { PLANT_IDS, plantOf, plantRef } from './plants.js';
import { plantsContract } from '../maiacity-testing/plants.js';
import { SEEDLINGS } from '../../../game/maiacity-v1/engine.js';

plantsContract('v1', { PLANT_IDS, plantOf }, SEEDLINGS);

test('a tree’s ref names the plant at its version, as the game’s config pins it, its stage and its seed', () => {
	expect(plantRef(plantOf('apple', 1), 3.25, 'Ada B')).toBe('pin:maiacity-v1/apple-1?stage=3.25&seed=Ada%20B');
	expect(pinnedAs(plantRef(plantOf('apple', 1), 3.25, 'Ada B'))).toBe('plants/apple@1');
	expect(pinnedAs(plantRef(plantOf('apple', 2), 9, 'x'))).toBe('plants/apple@2');
});
