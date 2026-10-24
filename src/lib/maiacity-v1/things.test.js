// @ts-nocheck — version-specific references remain explicit.
import { expect } from 'bun:test';
import { thingsContract } from '../maiacity-testing/things.js';
import { pinnedAs } from '$lib/assets/pins.fixture.js';
thingsContract('v1', () => import('./things.js'), {
 checkStake(ref) { expect(ref('Ana Lu', 'pear')).toBe('pin:maiacity-v1/stake?name=Ana+Lu&seed=pear'); expect(pinnedAs(ref('Ana Lu', 'pear'))).toBe('things/plant-stake@2'); },
 versionOf: ref => Number(/@(\d+)/.exec(pinnedAs(ref))[1])
});
