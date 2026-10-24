// @ts-nocheck
import { expect, test } from 'bun:test';
import { travelerSyncOps, TRAVELER_EXCLUDED_GAMES } from './traveler-sync.js';
const w = { mine: 'me', me: 'device', shares: [] };
const traveler = new Set(['Traveler']);
test('traveler uses a native keep restriction, excluding every other known game', () => {
 const ops = travelerSyncOps(w, 'city', traveler, false);
 expect(ops).toEqual([{ op: 'keep', over: 'city', as: 'me', mode: 'never', what: TRAVELER_EXCLUDED_GAMES }]);
 expect(TRAVELER_EXCLUDED_GAMES.any.map(x => x.all[0].tag)).not.toContain('game:sandbox-4');
 expect(TRAVELER_EXCLUDED_GAMES.any.map(x => x.all[0].tag)).toContain('game:maiacity-v2');
 for (const clause of TRAVELER_EXCLUDED_GAMES.any) {
  expect(clause.all[1].type).not.toContain('story');
  expect(clause.all[1].type).not.toContain('post:inspire');
  expect(clause.all[1].type).not.toContain('recipe');
 }
});
test('idempotent, removed on citizenship, never changes someone else’s keep rules', () => {
 const rule = { id:'rule', over:'city', issuer:'me', who:'device', level:'keepNever', slice:{where:TRAVELER_EXCLUDED_GAMES} };
 const world = {...w, shares:[rule]};
 expect(travelerSyncOps(world,'city',traveler,false)).toEqual([]);
 expect(travelerSyncOps(world,'city',new Set(['Citizen','Traveler']),false)).toEqual([{op:'revoke',share:'rule',as:'me'}]);
 expect(travelerSyncOps({...w,shares:[{...rule,issuer:'another'}]},'city',new Set(['Citizen']),false)).toEqual([]);
 expect(travelerSyncOps(w,'city',traveler,true)).toEqual([]);
});
