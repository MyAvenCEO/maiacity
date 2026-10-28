/**
 * Five friends in the woods: a group with three tents, a camping stove, hand tools, one chainsaw
 * (and one of them with the Motorsägenschein) walks over the hill and puts the camp in the wood
 * above Rosdorf. They mean to build what the wood gives them, by hand and with their tools; for
 * the first days they live from what they carried up.
 */
import { ASSUMPTION, SCENARIO, p } from './sources.ts';

const starter = {
  label: 'Five friends in the woods',
  party: { id: 'waldfreunde', label: 'The five friends', kind: 'group' },
  books: {
    capital: p(3600, 'EUR', SCENARIO, { note: 'scenario: 800 € between the five, and what their tents, bedding, stove, tools and chainsaw are worth (a starter’s things are paid from its capital)' }),
  },
  circle: [
    { name: 'Lena Hartmann', relation: 'member', resident: true, lives: true, daysPerYear: p(365, 'd', SCENARIO, { note: 'herself' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1996, experience: { labour: 600 } },
    { name: 'Tarek Öztürk', relation: 'member', resident: true, lives: true, daysPerYear: p(365, 'd', SCENARIO, { note: 'himself' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1995, certificates: ['chainsaw'], experience: { labour: 500, chainsaw: 240 } },
    { name: 'Mira Bernard', relation: 'member', resident: true, lives: true, daysPerYear: p(365, 'd', SCENARIO, { note: 'herself' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1998, experience: { labour: 300 } },
    { name: 'Paul Krüger', relation: 'member', resident: true, lives: true, daysPerYear: p(365, 'd', SCENARIO, { note: 'himself' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1997, experience: { labour: 350 } },
    { name: 'Finn Jakobi', relation: 'member', resident: true, lives: true, daysPerYear: p(365, 'd', SCENARIO, { note: 'himself' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1999, experience: { labour: 200 } },
  ],
  fleet: [
    { model: 'chainsaw', ownership: 'owned' },
    { model: 'axe', ownership: 'owned' },
    { model: 'axe', ownership: 'owned' },
    { model: 'bowSaw', ownership: 'owned' },
    { model: 'spade', ownership: 'owned' },
    { model: 'shovel', ownership: 'owned' },
    { model: 'hammer', ownership: 'owned' },
    { model: 'knife', ownership: 'owned' },
    { model: 'knife', ownership: 'owned' },
    { model: 'wheelbarrow', ownership: 'owned' },
  ],
  stock: [
    { material: 'kit.tent2', qty: p(3, 'pcs', SCENARIO) },
    { material: 'bedding.bag3season', qty: p(5, 'pcs', SCENARIO) },
    { material: 'bedding.matFoam', qty: p(5, 'pcs', SCENARIO) },
    { material: 'stove.camping', qty: p(1, 'pcs', SCENARIO) },
    { material: 'fuel.propane', qty: p(5, 'kg', SCENARIO, { note: 'one filled 5 kg bottle' }) },
    { material: 'petrol.2t', qty: p(10, 'l', SCENARIO, { note: 'two 5 l canisters of 2-stroke mix for the chainsaw' }) },
    { material: 'food.provisions', qty: p(30, 'kg', SCENARIO, { note: 'bread, pasta, tins, cheese: about 75,000 kcal, the five of them about five days' }) },
    { material: 'water.drinking', qty: p(50, 'l', ASSUMPTION, { confidence: 'low', note: 'carried up the hill in canisters: a couple of days of drinking and cooking for five' }) },
  ],
  /** where they put the camp down: in the wood on a level spot, a little up from the end of the footpath */
  base: { label: 'The friends’ camp', kind: 'stockpile', at: { along: 30, side: -30 } },
};

export const forestFriends = { starters: { forestFriends: starter } };
