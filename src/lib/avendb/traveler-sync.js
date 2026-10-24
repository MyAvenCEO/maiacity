// @ts-nocheck
// Native keep shares enforce the demo's game scope. They grant no read access.
// Public assets/posts and personal profile data retain their existing native rights.
import { GAMES, gameTag } from '../../../game/games.js';
import { ADMIN, CITIZEN, TRAVELER, TRAVELER_GAME } from './capgroups.js';
export const TRAVELER_EXCLUDED_GAMES = { any: GAMES.filter(g => g.id !== TRAVELER_GAME).map(g => ({ tag: gameTag(g.id) })) };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function travelerSyncOps(world, city, groups, owner) {
 if (!world?.mine || !world?.me || !city) return [];
 const demo = !owner && groups.has(TRAVELER) && !groups.has(CITIZEN) && !groups.has(ADMIN);
 const ours = world.shares.filter(s => s.over === city && s.issuer === world.mine && s.who === world.me && s.level === 'keepNever' && same(s.slice?.where, TRAVELER_EXCLUDED_GAMES));
 if (!demo) return ours.map(s => ({ op: 'revoke', share: s.id, as: world.mine }));
 if (ours.length) return [];
 return [{ op: 'keep', over: city, as: world.mine, mode: 'never', what: TRAVELER_EXCLUDED_GAMES }];
}
