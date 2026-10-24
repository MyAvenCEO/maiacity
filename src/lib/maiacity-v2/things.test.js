// @ts-nocheck — version-specific references remain explicit.
import { expect } from 'bun:test';
import { thingsContract } from '../maiacity-testing/things.js';
thingsContract('v2', () => import('./things.js'), {
 checkStake(ref) { expect(ref('Ana Lu', 'pear')).toBe('things/plant-stake@2?name=Ana+Lu&seed=pear'); },
 versionOf: ref => Number(ref.split('@')[1])
});
