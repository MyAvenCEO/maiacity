// @ts-nocheck
import { expect, test } from 'bun:test';
import { travelerSyncOps, TRAVELER_EXCLUDED_GAMES } from './traveler-sync.js';
const w = { mine: 'me', me: 'device', shares: [] };
const traveler = new Set(['Traveler']);
test('traveler uses a native keep restriction, excluding every other known game', () => {
 const ops = travelerSyncOps(w, 'city', traveler, false);
 expect(ops).toEqual([{ op: 'keep', over: 'city', as: 'me', mode: 'never', what: TRAVELER_EXCLUDED_GAMES }]);
 expect(TRAVELER_EXCLUDED_GAMES.any).not.toContainEqual({ tag: 'game:sandbox-4' });
 expect(TRAVELER_EXCLUDED_GAMES.any).toContainEqual({ tag: 'game:maiacity-v2' });
 expect(TRAVELER_EXCLUDED_GAMES.any.every(x => Object.keys(x).join() === 'tag')).toBe(true);
});
test('idempotent, removed on citizenship, never changes someone else’s keep rules', () => {
 const rule = { id:'rule', over:'city', issuer:'me', who:'device', level:'keepNever', slice:{where:TRAVELER_EXCLUDED_GAMES} };
 const world = {...w, shares:[rule]};
 expect(travelerSyncOps(world,'city',traveler,false)).toEqual([]);
 expect(travelerSyncOps(world,'city',new Set(['Citizen','Traveler']),false)).toEqual([{op:'revoke',share:'rule',as:'me'}]);
 expect(travelerSyncOps({...w,shares:[{...rule,issuer:'another'}]},'city',new Set(['Citizen']),false)).toEqual([]);
 expect(travelerSyncOps(w,'city',traveler,true)).toEqual([]);
});
