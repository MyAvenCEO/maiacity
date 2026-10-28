/**
 * One person and a tent (decision 0025, rung 1): Jonas comes over the hill on foot with a tent,
 * a knife, food and water for a few days and a little money, to a valley that is somebody else's.
 * No company, no road, no machine.
 */
import { ASSUMPTION, SCENARIO, p } from './sources.ts';

const starter = {
  label: 'One person and a tent',
  party: { id: 'jonas', label: 'Jonas Weber', kind: 'person' },
  books: {
    capital: p(785, 'EUR', SCENARIO, { note: 'scenario: 400 € left in the account at the end of the month, and what his tent, sleeping bag and mat, headlamp, knife, food and water are worth (a starter’s things are paid from its capital)' }),
  },
  circle: [
    { name: 'Jonas Weber', relation: 'member', resident: true, lives: true, daysPerYear: p(365, 'd', SCENARIO, { note: 'himself' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1997, experience: { labour: 400 } },
  ],
  fleet: [{ model: 'knife', ownership: 'owned' }],
  stock: [
    { material: 'kit.tent2', qty: p(1, 'pcs', SCENARIO) },
    // the tent does not keep him warm: his bedding does (camp C6)
    { material: 'bedding.bag3season', qty: p(1, 'pcs', SCENARIO) },
    { material: 'bedding.matInsulated', qty: p(1, 'pcs', SCENARIO) },
    // (and a headlamp: the evenings are dark at a camp, S7)
    { material: 'light.headlamp', qty: p(1, 'pcs', SCENARIO) },
    { material: 'food.provisions', qty: p(5, 'kg', SCENARIO, { note: 'bread, pasta, tins, cheese: about 12,500 kcal, four days of walking and pitching' }) },
    { material: 'water.drinking', qty: p(12, 'l', ASSUMPTION, { confidence: 'low', note: 'what one carries in canisters besides a pack: two to three days' }) },
  ],
  /** where he puts his pack down: a little off the end of the footpath */
  base: { label: 'Jonas’s pack', kind: 'stockpile', at: { along: 0, side: 25 } },
};

export const camper = { starters: { camper: starter } };
