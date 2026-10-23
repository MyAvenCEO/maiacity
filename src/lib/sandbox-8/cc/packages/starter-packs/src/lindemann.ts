/**
 * The farm that holds the valley (decision 0025): the Lindemann family's fields, meadows and wood.
 * They look after their land by the custom of the place and notice what others do on it.
 */
import { SCENARIO, p } from './sources.ts';

const starter = {
  label: 'Hof Lindemann (the farm that holds the valley)',
  party: { id: 'hofLindemann', label: 'Hof Lindemann (farmer)', kind: 'household' },
  books: {
    capital: p(60_000, 'EUR', SCENARIO, { note: 'scenario: the farm’s working capital' }),
  },
  land: [{ label: 'Hof Lindemann: fields, meadows and wood', basis: 'own', watched: true }],
};

export const lindemann = { starters: { lindemann: starter } };
