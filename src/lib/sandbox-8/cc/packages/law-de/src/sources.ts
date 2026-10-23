/**
 * Provenance shared within the law pack (decision 0006). The laws themselves are cited where they are used; where a
 * value is not fixed by a law (a deadline a letter sets, the costs of a clearance) it cites `ASSUMPTION` with low
 * confidence, and the note says so. The values came over from practice-de as they were (design/modular-split.md §5.4).
 */
import type { Source } from '../../kernel/src/index.ts';

export { param as p } from '../../kernel/src/index.ts';

export const ASSUMPTION: Source = {
  title: 'Assumption of the data-pack author (no source in research/de)',
  publisher: 'Constructible City law-de',
  year: 2026,
};
