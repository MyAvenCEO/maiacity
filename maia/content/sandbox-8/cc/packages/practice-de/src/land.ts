/**
 * Land and those who hold it (decision 0025): how holders of land come to notice what is on it. What
 * they may do about it is law (law-de: trespass, buildingLaw).
 */
import { ASSUMPTION, p } from './sources.ts';

/** how holders notice what is on their land */
export const detectionSettings = {
  complaint: p(0.5, '1', ASSUMPTION, { range: [0.2, 0.8], confidence: 'low', note: 'a smell, no toilet or waste about a camp: someone tells the farmer or the office, and it is found sooner (to be sourced)' }),
  visits: {
    meanDays: p(7, 'd', ASSUMPTION, { range: [1, 30], confidence: 'low', note: 'a farmer passes a field about once a week outside the busy seasons' }),
    notice: p(0.3, '1', ASSUMPTION, { range: [0.05, 0.9], confidence: 'low', note: 'the chance a pass notices a reference use (a small camp by a track)' }),
  },
  rounds: {
    everyDays: p(14, 'd', ASSUMPTION, { range: [3, 60], confidence: 'low', note: 'a forester or warden walking a woodland round' }),
    notice: p(0.5, '1', ASSUMPTION, { range: [0.1, 0.9], confidence: 'low' }),
  },
  reference: {
    area: p(12, 'm2', ASSUMPTION, { confidence: 'low', note: 'a small camp' }),
    distance: p(150, 'm', ASSUMPTION, { range: [50, 500], confidence: 'low', note: 'from a way or track people use: much further away, little is seen' }),
  },
};
