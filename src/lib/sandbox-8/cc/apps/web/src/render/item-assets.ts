/** Blender-authored meshes. Metres, +X forward, +Y up, grounded at Y=0. No runtime I/O. */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import data from '../../assets/items.json';
import { FIN } from './finish.ts';

export type ItemAsset = keyof typeof data;
const cache = new Map<ItemAsset, BufferGeometry>();
const equipment: Record<string, ItemAsset> = {
  spade: 'spade', shovel: 'shovel', hammer: 'hammer',
  chainsaw: 'chainsaw', wheelbarrow: 'wheelbarrow',
};

export function equipmentAsset(model: string, cls: string): ItemAsset | undefined {
  return model === 'cargoBike' ? 'cargoBike' : equipment[cls];
}

export function assetSize(name: ItemAsset): readonly number[] {
  return data[name].size;
}

interface PartData { positions: number[]; normals: number[]; colors: number[]; indices: number[]; origin: number[] }
const partCache = new Map<string, BufferGeometry>();

export function itemParts(name: ItemAsset): { id: string; geometry: BufferGeometry; origin: readonly number[] }[] {
  return Object.entries(data[name].parts as Record<string, PartData>).map(([id, p]) => {
    const key = `${name}:${id}`;
    let geometry = partCache.get(key);
    if (!geometry) {
      geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(p.positions, 3));
      geometry.setAttribute('normal', new Float32BufferAttribute(p.normals, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(p.colors, 3));
      const finish = /wheel|grip|tyre/i.test(id) ? FIN.rubber : /shaft|handle/i.test(id) ? FIN.wood : /sheet|tarp|fly|floor/i.test(id) ? FIN.fabric : /blade|tray|frame|engine|head/i.test(id) ? FIN.metal : FIN.paint;
      const fin = new Float32Array(p.positions.length);
      for (let i = 0; i < fin.length; i += 3) fin.set(finish, i);
      geometry.setAttribute('fin', new Float32BufferAttribute(fin, 3));
      geometry.setIndex(p.indices);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      partCache.set(key, geometry);
    }
    return { id, geometry, origin: p.origin };
  });
}

/** Shared complete geometry for static kit rendering. Equipment retains the separate parts. */
export function itemGeometry(name: ItemAsset): BufferGeometry {
  const hit = cache.get(name);
  if (hit) return hit;
  const parts = itemParts(name).map((p) => p.geometry.clone().translate(p.origin[0]!, p.origin[1]!, p.origin[2]!));
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  cache.set(name, g);
  return g;
}

/** Nominal plan dimensions exclude guy lines, drawbars and the hut's flue. */
export const campAssets: Record<string, { asset: ItemAsset; dimensions: readonly [number, number, number] }> = {
  tent2: { asset: 'tent2', dimensions: [2.1, 1.1, 1.5] },
  rainCatcher: { asset: 'rainCatcher', dimensions: [4, 1.8, 3] },
  kitchenTent: { asset: 'kitchenTent', dimensions: [12, 3, 6] },
  caravan: { asset: 'caravan', dimensions: [5.5, 2.5, 2.2] },
  siteTrailer: { asset: 'siteTrailer', dimensions: [6, 3, 2.5] },
};

export function equipmentLabelHeight(model: string, cls: string): number {
  const name = equipmentAsset(model, cls);
  const heights: Record<string, number> = { knife: .04, axe: .05, saw: .04, bicycle: 1.05, caravan: 2.75, siteTrailer: 3.65, car: 1.6, surveyKit: 1.4, powerStation: .35, solarPanel: .55, generator: .55, lightTower: 6 };
  return name ? assetSize(name)[1]! + .18 : (heights[cls] ?? 3.8) + .18;
}

export function equipmentFocusDistance(model: string, cls: string): number {
  const name = equipmentAsset(model, cls);
  const spans: Record<string, number> = { knife: .3, axe: .85, saw: .8, bicycle: 1.8, caravan: 7, siteTrailer: 7.5, car: 5, surveyKit: 1.4, powerStation: .4, solarPanel: 1.2, generator: .6, lightTower: 6 };
  return name ? Math.max(1, Math.max(...assetSize(name)) * 3) : Math.max(1, (spans[cls] ?? 11.5) * 3);
}

/** Travel profiles describe the carrier. A journey's purpose does not change its shape. */
export function carrierVisual(profile: string): { cls: string; model: string } {
  const cls: Record<string, string> = { foot: 'foot', cargoBike: 'bicycle', bicycle: 'bicycle', car: 'car', tipper3: 'tipper', tipper4: 'tipper', lowLoader: 'lowLoader', flatbed: 'flatbed', tanker: 'waterTruck', van: 'van', crawler: 'excavator', wheeledPlant: 'wheeledExcavator', roller: 'soilRoller', paver: 'paver', mixer: 'mixer' };
  return { cls: cls[profile] ?? 'unknown', model: profile };
}
