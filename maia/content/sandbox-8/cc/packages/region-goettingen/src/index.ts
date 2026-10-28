/**
 * @cc/region-goettingen: the Göttingen valley (southern Lower Saxony, Leine valley margin) as place
 * physics (decision 0010): climate normals and the fitted weather generator, terrain, soils, trees,
 * the people of the region and recorded datasets. Every number is a parameter with unit, source,
 * range and confidence (decision 0006).
 */
import type { Pack } from '../../areas/src/index.ts';
import { climate } from './climate.ts';
import { dwd01691Daily } from './datasets/dwd-01691-daily.ts';
import { dwd01691WindRose } from './datasets/dwd-01691-windrose.ts';
import { environmentSettings } from './environment.ts';
import { labourSettings } from './people.ts';
import { accesses, hillsideAccesses, soilClasses, terrainSettings, transitLines, treeSpecies } from './terrain.ts';

export { accesses, climate, dwd01691Daily, dwd01691WindRose, environmentSettings, labourSettings, soilClasses, terrainSettings, treeSpecies };
export * as sources from './sources.ts';

/**
 * the pack: place physics speaks for no area, it is the world's own (its law and land-use plan are law-de's,
 * design/modular-split.md §5.3)
 */
export const regionGoettingen: Pack = { role: 'region', catalogs: { climate, soilClasses, treeSpecies, terrainSettings, accesses, transitLines, labourSettings, environmentSettings } };

/** the same hills near Göttingen, reached only by a footpath over the hill (decision 0025, rung 1) */
export const regionGoettingenHillside: Pack = { role: 'region', catalogs: { ...regionGoettingen.catalogs, accesses: hillsideAccesses, transitLines: {} } };

/** recorded datasets of the region (decision 0022): measured and entered series, by id */
export const datasets: Record<string, unknown> = { [dwd01691Daily.id]: dwd01691Daily };
