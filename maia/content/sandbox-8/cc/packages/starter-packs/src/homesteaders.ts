/**
 * Five on inherited land (decision 0025): five friends — three men, two women — take over a piece
 * of land one of them inherited. Nothing may be built on it; what they bring stands unfastened or
 * on wheels: three dome tents, a used frame tent for kitchen and sitting, hand tools, food and
 * water for the first days and the money they pooled. The plan is to live there and grow what they
 * eat, so the world starts in April and the first season is not lost.
 */
import { ASSUMPTION, SCENARIO, p } from './sources.ts';

const starter = {
  label: 'Five on inherited land',
  party: { id: 'homestead', label: 'The five on the inherited land', kind: 'group' },
  books: {
    capital: p(15_000, 'EUR', SCENARIO, { note: 'scenario: what the five pooled; the shelters and tools are paid from it' }),
  },
  land: [{ label: 'The inherited land', basis: 'own' }],
  circle: [
    { name: 'Lukas Brandt', relation: 'member', resident: true, lives: true, daysPerYear: p(365, 'd', SCENARIO, { note: 'himself' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1996, experience: { labour: 1000 } },
    { name: 'Eike Fehr', relation: 'member', resident: true, lives: true, daysPerYear: p(365, 'd', SCENARIO, { note: 'herself' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1993, experience: { labour: 1600 } },
    { name: 'Paul Wenzel', relation: 'member', resident: true, lives: true, daysPerYear: p(365, 'd', SCENARIO, { note: 'himself' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1990, certificates: ['chainsaw'], experience: { labour: 2200, chainsaw: 400 } },
    { name: 'Nina Hartlich', relation: 'member', resident: true, lives: true, daysPerYear: p(365, 'd', SCENARIO, { note: 'herself' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1995, experience: { labour: 800 } },
    { name: 'Marie Kessler', relation: 'member', resident: true, lives: true, daysPerYear: p(365, 'd', SCENARIO, { note: 'herself' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1998, experience: { labour: 600 } },
  ],
  fleet: [
    { model: 'knife', ownership: 'owned' },
    { model: 'axe', ownership: 'owned' },
    { model: 'spade', ownership: 'owned' },
    { model: 'spade', ownership: 'owned' },
    { model: 'bowSaw', ownership: 'owned' },
    { model: 'wheelbarrow', ownership: 'owned' },
    { model: 'wheelbarrow', ownership: 'owned' },
  ],
  stock: [
    { material: 'kit.tent2', qty: p(3, 'pcs', SCENARIO, { note: 'two tents for two people each, one for the fifth' }) },
    { material: 'kit.kitchenTent', qty: p(15, 'pcs', SCENARIO, { note: 'a used frame tent, in its 15 pack pieces: kitchen and sitting room' }) },
    { material: 'food.provisions', qty: p(35, 'kg', SCENARIO, { note: 'five people for about five days (≈ 1.4 kg a day, the first week without a shop run settled)' }) },
    { material: 'water.drinking', qty: p(80, 'l', ASSUMPTION, { confidence: 'low', note: 'what the car brought in canisters and crates; a spring or a well must follow' }) },
  ],
  /** where they make their camp: the little clearing at the end of the way in */
  base: { label: 'The camp (clearing at the end of the way in)', kind: 'stockpile', clear: true, at: { along: 0, side: 35 } },
};

export const homesteaders = { starters: { homesteaders: starter } };
