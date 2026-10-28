/**
 * What "a good place" usually means for some purposes when scouting: rules of thumb of settlement
 * and building practice (dry, level, sunny ground near water and roads, out of floods and frost
 * hollows). Starting points, not truths — players edit them or write their own goals.
 */
import { ASSUMPTION } from './sources.ts';

const RULE_OF_THUMB = { ...ASSUMPTION, note: 'rules of thumb for siting (settlement and building practice), weights and limits judged, not from a standard' };

export const sitingGoals = {
  homestead: {
    label: 'Homestead (house, garden, fields)',
    description: 'Fertile, sunny, gentle ground near water but safe from floods and out of frost hollows.',
    terms: [
      { criterion: 'slope', weight: 2, worst: 20, best: 2, max: 15 },
      { criterion: 'aboveWater', weight: 3, worst: 0.5, best: 4, min: 1 },
      { criterion: 'toWater', weight: 2, worst: 600, best: 50 },
      { criterion: 'soilWater', weight: 2, worst: 60, best: 200 },
      { criterion: 'sun', weight: 2, worst: 80, best: 110 },
      { criterion: 'terrainPosition', weight: 1, worst: -6, best: 1 },
      { criterion: 'toRoad', weight: 0.5, worst: 1000, best: 100 },
    ],
    source: RULE_OF_THUMB,
  },
  village: {
    label: 'Village core',
    description: 'Level, firm, well-drained ground with room to grow, water and a road nearby, well above floods.',
    terms: [
      { criterion: 'slope', weight: 2, worst: 12, best: 2, max: 10 },
      { criterion: 'flatArea', weight: 3, worst: 2000, best: 18000 },
      { criterion: 'aboveWater', weight: 3, worst: 1, best: 5, min: 2 },
      { criterion: 'toWater', weight: 1, worst: 800, best: 100 },
      { criterion: 'toRoad', weight: 2, worst: 800, best: 30 },
      { criterion: 'drainage', weight: 1, worst: 0.1, best: 0.5 },
      { criterion: 'sun', weight: 1, worst: 85, best: 105 },
    ],
    source: RULE_OF_THUMB,
  },
  workshop: {
    label: 'Workshop or yard',
    description: 'Level ground right at a road, above floods: room to store, park and turn heavy vehicles.',
    terms: [
      { criterion: 'slope', weight: 3, worst: 8, best: 0, max: 6 },
      { criterion: 'flatArea', weight: 2, worst: 1000, best: 10000 },
      { criterion: 'toRoad', weight: 3, worst: 300, best: 0, max: 400 },
      { criterion: 'aboveWater', weight: 2, worst: 0.5, best: 3, min: 1 },
      { criterion: 'drainage', weight: 1, worst: 0.1, best: 0.5 },
    ],
    source: RULE_OF_THUMB,
  },
  timberCamp: {
    label: 'Timber camp',
    description: 'In reach of plenty of standing timber, with water, on ground a cart or tractor can work.',
    terms: [
      { criterion: 'timber', weight: 3, worst: 20, best: 400 },
      { criterion: 'toWater', weight: 1, worst: 800, best: 100 },
      { criterion: 'slope', weight: 1, worst: 25, best: 5, max: 25 },
      { criterion: 'toRoad', weight: 1, worst: 1500, best: 200 },
      { criterion: 'aboveWater', weight: 1, worst: 0, best: 2, min: 0.5 },
    ],
    source: RULE_OF_THUMB,
  },
};
