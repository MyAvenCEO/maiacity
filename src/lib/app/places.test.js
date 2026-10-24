// @ts-nocheck
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PLACES } from '../../../game/places.js';
import { latestOf, versionsOf } from './versions.js';
import { ADMIN, CITIZEN, TRAVELER, TRAVELER_GAME } from '../avendb/capgroups.js';

// Exercise the merged navigation with real registry/version metadata and explicit group membership.
// Only SvelteKit's base path and the reactive membership accessor are substituted.
const source = readFileSync(new URL('./places.ts', import.meta.url), 'utf8').replace(/^import .*;$/gm, '');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source).replace(/export /g, '');
function places(groups) {
 return new Function('base','latestOf','versionsOf','holdsGroup','ADMIN','CITIZEN','TRAVELER','TRAVELER_GAME','PLACES',
  compiled + '; return {PLAY,WORLDS,CITY,GAME_WORLDS,gameAt,opens};')('',latestOf,versionsOf,group=>groups.has(group),ADMIN,CITIZEN,TRAVELER,TRAVELER_GAME,PLACES);
}
test('consolidated navigation retains Traveler restriction, Citizen worlds and V2/Sandbox8',()=>{
 const traveler=places(new Set([TRAVELER]));
 expect(traveler.GAME_WORLDS.filter(traveler.opens).map(p=>p.game)).toEqual([TRAVELER_GAME]);
 for(const path of ['/app/maiacity-v2/','/app/games/sandbox-8/','/app/chat/','/app/worlds/']){
  expect(traveler.gameAt(path)).toBeTruthy();
  expect(traveler.opens(traveler.gameAt(path))).toBe(false);
  const citizen=places(new Set([CITIZEN,TRAVELER]));
  expect(citizen.opens(citizen.gameAt(path))).toBe(true);
 }
});
