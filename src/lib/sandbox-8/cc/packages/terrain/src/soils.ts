/**
 * Mapping soil classes to landscape positions (Catena).
 *
 * Central German hill country follows a textbook soil catena: loess loam (Lösslehm, UL/TL)
 * blankets plateaus and gentle slopes; steeper slopes carry thinner, stonier slope deposits
 * (Hangschutt / Fließerden, mixed-grained); valley floors fill with fine alluvial loam/clay
 * (Auelehm) over the creek's sand and gravel (Niederterrassen-Kies), which crops out right
 * along the channel. Data packs may state this explicitly through `SoilClass.landscape`;
 * otherwise positions are inferred from the class group as described in `inferLandscape`.
 */
import type { SoilClass, TerrainSettings } from './contract.ts';

export type Landscape = 'upland' | 'slope' | 'valleyFloor' | 'waterside';
export const LANDSCAPES: readonly Landscape[] = ['upland', 'slope', 'valleyFloor', 'waterside'];

export interface SoilRoles {
  /** class ids, index = value stored in the per-vertex Uint8 arrays */
  classIds: string[];
  topsoil: number;
  rock: number;
  /** candidate subsoil class indices per landscape position (never empty) */
  byLandscape: Record<Landscape, number[]>;
}

/** Fallback when a class has no explicit `landscape` hint. */
function inferLandscape(id: string, cls: SoilClass, cohesiveOrder: string[]): Landscape[] {
  switch (cls.group) {
    case 'granular':
      return ['waterside'];
    case 'mixed':
      return ['slope'];
    case 'rock':
      return ['slope'];
    case 'topsoil':
      return ['upland'];
    case 'cohesive': {
      // first listed cohesive class = upland loam, second = valley-floor clay
      if (cohesiveOrder.length === 1) return ['upland', 'slope', 'valleyFloor'];
      return cohesiveOrder.indexOf(id) === 0 ? ['upland', 'slope'] : ['valleyFloor'];
    }
  }
}

export function resolveSoilRoles(settings: TerrainSettings, classes: Record<string, SoilClass>): SoilRoles {
  const need = (id: string, what: string): SoilClass => {
    const c = classes[id];
    if (!c) throw new Error(`terrainSettings.soil.${what} references unknown soil class "${id}" (known: ${Object.keys(classes).join(', ')})`);
    return c;
  };
  need(settings.soil.topsoilClass, 'topsoilClass');
  need(settings.soil.rockClass, 'rockClass');
  if (settings.soil.subsoilClasses.length === 0) throw new Error('terrainSettings.soil.subsoilClasses must not be empty');
  settings.soil.subsoilClasses.forEach((id, i) => need(id, `subsoilClasses[${i}]`));
  if (settings.soil.subsoilClasses.length + 2 > 255) throw new Error('too many soil classes');

  const classIds: string[] = [];
  const indexOf = (id: string): number => {
    const k = classIds.indexOf(id);
    if (k >= 0) return k;
    classIds.push(id);
    return classIds.length - 1;
  };
  const topsoil = indexOf(settings.soil.topsoilClass);
  const cohesiveOrder = settings.soil.subsoilClasses.filter((id) => classes[id]!.group === 'cohesive' && !classes[id]!.landscape);
  const byLandscape: Record<Landscape, number[]> = { upland: [], slope: [], valleyFloor: [], waterside: [] };
  for (const id of settings.soil.subsoilClasses) {
    const cls = classes[id]!;
    const k = indexOf(id);
    for (const l of cls.landscape ?? inferLandscape(id, cls, cohesiveOrder)) if (!byLandscape[l].includes(k)) byLandscape[l].push(k);
  }
  const rock = indexOf(settings.soil.rockClass);
  // fill gaps along the catena: waterside → valley floor → upland; slope → upland; upland → first subsoil
  const first = classIds.indexOf(settings.soil.subsoilClasses[0]!);
  if (byLandscape.upland.length === 0) byLandscape.upland = byLandscape.slope.length ? [...byLandscape.slope] : [first];
  if (byLandscape.slope.length === 0) byLandscape.slope = [...byLandscape.upland];
  if (byLandscape.valleyFloor.length === 0) byLandscape.valleyFloor = [...byLandscape.upland];
  if (byLandscape.waterside.length === 0) byLandscape.waterside = [...byLandscape.valleyFloor];
  return { classIds, topsoil, rock, byLandscape };
}
