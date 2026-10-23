import { ASSUMPTION, p } from './sources.ts';

/**
 * The kinds of equipment (decision 0025): one continuum from a knife to an excavator. Machines and
 * vehicles have an engine and move under their own power; powered tools have an engine and are
 * carried; hand tools have neither, and wear by use.
 */
export const equipmentClasses = {
  excavator: { label: 'Excavator', kind: 'machine' },
  wheeledExcavator: { label: 'Wheeled excavator', kind: 'machine' },
  miniExcavator: { label: 'Mini excavator', kind: 'machine' },
  wheelLoader: { label: 'Wheel loader', kind: 'machine' },
  dozer: { label: 'Dozer', kind: 'machine' },
  grader: { label: 'Grader', kind: 'machine' },
  soilRoller: { label: 'Soil roller', kind: 'machine' },
  tandemRoller: { label: 'Tandem roller', kind: 'machine' },
  tyreRoller: { label: 'Tyre roller', kind: 'machine' },
  plateCompactor: { label: 'Plate compactor', kind: 'powered' },
  tipper: { label: 'Tipper truck', kind: 'vehicle' },
  articulatedHauler: { label: 'Articulated hauler', kind: 'vehicle' },
  paver: { label: 'Asphalt paver', kind: 'machine' },
  waterTruck: { label: 'Water truck', kind: 'vehicle' },
  lowLoader: { label: 'Low-loader', kind: 'vehicle' },
  mobileCrane: { label: 'Mobile crane', kind: 'vehicle' },
  telehandler: { label: 'Telehandler', kind: 'machine' },
  concreteMixer: { label: 'Truck mixer', kind: 'vehicle' },
  concretePump: { label: 'Concrete pump', kind: 'vehicle' },
  siteDumper: { label: 'Site dumper', kind: 'machine' },
  surveyKit: { label: 'Survey kit (GNSS, level)', kind: 'powered' },
  chainsaw: { label: 'Chainsaw', kind: 'powered' },
  powerStation: { label: 'Power station (battery)', kind: 'hand' },
  solarPanel: { label: 'Solar panel', kind: 'hand' },
  generator: { label: 'Generator', kind: 'powered' },
  lightTower: { label: 'Light tower', kind: 'powered' },
  knife: { label: 'Knife', kind: 'hand' },
  axe: { label: 'Axe', kind: 'hand' },
  spade: { label: 'Spade', kind: 'hand' },
  shovel: { label: 'Shovel', kind: 'hand' },
  saw: { label: 'Hand saw', kind: 'hand' },
  hammer: { label: 'Hammer', kind: 'hand' },
  wheelbarrow: { label: 'Wheelbarrow', kind: 'hand' },
  car: { label: 'Car', kind: 'vehicle' },
  bicycle: { label: 'Bicycle', kind: 'vehicle' },
  // homes on wheels (camp L5): towed behind a car, set up where they stand
  caravan: { label: 'Caravan', kind: 'trailer' },
  siteTrailer: { label: 'Construction trailer (Bauwagen)', kind: 'trailer' },
};

/**
 * The dealers' and hire firms' week (decision 0010: practice). They work Monday to Friday, and a day of hire is owed for
 * each working day a machine is on hire (the hire firms' day rates count working days); their field service is out from
 * 7 to 17, and a breakdown called in after 14:00 is served the next working morning. The days are the usual week of the
 * trade; the hours the pack author's estimate, low confidence.
 */
export const equipmentSettings = {
  workingHours: {
    days: [0, 1, 2, 3, 4],
    from: p(7, 'h', ASSUMPTION, { range: [6, 8], confidence: 'low', note: 'a dealer’s field service sets out early, with the sites' }),
    to: p(17, 'h', ASSUMPTION, { range: [16, 18], confidence: 'low', note: 'the end of the fitters’ day' }),
    cutoff: p(14, 'h', ASSUMPTION, { range: [12, 16], confidence: 'low', note: 'a call taken after this is no longer served the same day: the van comes the next working morning' }),
  },
};
