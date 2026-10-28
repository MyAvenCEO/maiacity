/**
 * @cc/practice-de: German building practice (decision 0010): how work is usually done in Germany.
 * Work activities and their rates and weather limits, road classes and design tables
 * (RStO/RLW/RASt), building element methods (DIN 276), vehicle profiles and axle-load limits, trade
 * qualifications, working hours and the usual week (of the trade, the hire firms and the timetables, the season of
 * leave), how people live and heat, how holders notice what is on their land,
 * and rules of thumb for siting. The pack speaks for Germany (area 'de', design/modular-split.md
 * §5.3). The law is law-de's; catalogs that still mix the two field by field (labourSettings with
 * the leave and working-time law, lettingUses with the BGB's notice, roadDedication with § 6 NStrG,
 * structureSettings with the fire service's fee, buildingSettings with the NBauO clearance) stay
 * here, listed in docs/decisions/deviations.json.
 */
import type { Pack } from '../../areas/src/index.ts';
import { buildingActivities, buildingSettings, buildingTypes } from './buildings.ts';
import { exposureClasses } from './exposure.ts';
import { courses, labourSettings, qualifications } from './labour.ts';
import { materialProperties, workExecution } from './materials.ts';
import { networkSettings, vehicleProfiles } from './network.ts';
import { livingSettings, physiology, sphereStandards } from './needs.ts';
import { detectionSettings } from './land.ts';
import { equipmentClasses, equipmentSettings } from './equipment.ts';
import { activities as roadActivities, handling, productionSettings } from './production.ts';
import { roadClasses, roadDedication, roadInterventions, roadSettings } from './roads.ts';
import { sitingGoals } from './siting.ts';
import { lettingUses } from './letting.ts';
import { supplierWeek } from './trade.ts';
import { structureActivities, structureSettings, structureTemplates } from './structures.ts';

const activities = { ...roadActivities, ...buildingActivities, ...structureActivities };
export { activities, courses, buildingSettings, exposureClasses, materialProperties, workExecution, buildingTypes, labourSettings, networkSettings, productionSettings, qualifications, roadClasses, roadDedication, roadInterventions, roadSettings, sitingGoals, lettingUses, vehicleProfiles, physiology, sphereStandards, livingSettings, detectionSettings, equipmentClasses, equipmentSettings, handling, structureTemplates, structureSettings, supplierWeek };
export * as sources from './sources.ts';

/** the pack: German practice, for Germany */
export const practiceDe: Pack = { role: 'practice', area: 'de', catalogs: { courses, vehicleProfiles, networkSettings, qualifications, labourSettings, activities, productionSettings, roadClasses, roadSettings, roadInterventions, roadDedication, buildingTypes, buildingSettings, exposureClasses, materialProperties, workExecution, sitingGoals, lettingUses, physiology, sphereStandards, livingSettings, detectionSettings, equipmentClasses, equipmentSettings, handling, structureTemplates, structureSettings, supplierWeek } };
