/**
 * Where a building's elements sit (decision 0014): the building makes its spaces (the building,
 * its storeys, the roof space) and faces (façades, roof planes, ground floor, floors) when its
 * first element is realised, and places each finished element where its type says
 * (`element.place`, practice data). Nothing here branches on element ids.
 */
import type { EntityId, ReadCtx, WriteCtx } from '../../kernel/src/index.ts';
import { RAINDROP_FALL_SPEED, type ExposureContribution } from '../../environment/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import type { PlacementIn } from '../../space/src/index.ts';
import type { PlanElement, Structure } from '../../structures/src/index.ts';
import type { BuildingDesign, BuildingShell } from './contract.ts';

const STOREY = ['Ground floor', '1st floor', '2nd floor', '3rd floor', '4th floor', '5th floor'];

function must<T>(r: { ok: true; value: T } | { ok: false; reasons: unknown[] }, what: string): T {
  if (!r.ok) throw new Error(`buildings: ${what} failed: ${JSON.stringify(r.reasons)}`);
  return r.value;
}

const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

/** the building's spaces and faces, made once */
export function ensureShell(ctx: WriteCtx, id: EntityId, b: Readonly<Structure>): BuildingShell {
  const made = ctx.get('Shell', id);
  if (made) return made;
  const g = (b.plan.detail as BuildingDesign).geometry;
  const pitched = g.roofPitch > 1;
  const wallHeight = g.floors * g.storeyHeight;
  const building = must(ctx.command('space.create', { kind: 'building', label: b.label, owner: id, volume: g.footprint * wallHeight }), 'building space');
  const storeys = Array.from({ length: g.floors }, (_, i) => must(ctx.command('space.create', { kind: 'storey', label: `${b.label}: ${STOREY[i] ?? `floor ${i}`}`, owner: id, parent: building, volume: g.footprint * g.storeyHeight }), 'storey'));
  const ridge = pitched ? (g.width / 2) * Math.tan((g.roofPitch * Math.PI) / 180) : 0;
  const roofSpace = pitched ? must(ctx.command('space.create', { kind: 'roof space', label: `${b.label}: roof space`, owner: id, parent: building, volume: (g.footprint * ridge) / 2 }), 'roof space') : null;
  const top = storeys[storeys.length - 1]!;
  // façades: one per edge of the footprint, outward from the centre
  const c = g.corners;
  const centre: Vec2 = [(c[0]![0] + c[2]![0]) / 2, (c[0]![1] + c[2]![1]) / 2];
  const walls: EntityId[] = [];
  for (let i = 0; i < 4; i += 1) {
    const a = c[i]!;
    const e = c[(i + 1) % 4]!;
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
    let n: Vec2 = [(e[1] - a[1]) / len, -(e[0] - a[0]) / len];
    const mid: Vec2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
    if (n[0] * (mid[0] - centre[0]) + n[1] * (mid[1] - centre[1]) < 0) n = [-n[0], -n[1]];
    const area = (g.wallGross * len) / g.perimeter;
    walls.push(must(ctx.command('space.addFace', { kind: 'façade', label: `${b.label}: façade ${i + 1}`, owner: id, area, normal: unit(n[0], 0, n[1]), between: [building, 'outside'] }), 'façade'));
  }
  // roof: two planes falling to the long sides (ridge along the length), or one flat plane
  const roof: EntityId[] = [];
  const under = roofSpace ?? top;
  if (pitched) {
    const lx = c[1]![0] - c[0]![0];
    const lz = c[1]![1] - c[0]![1];
    const ll = Math.hypot(lx, lz);
    const perp: Vec2 = [lz / ll, -lx / ll];
    const sin = Math.sin((g.roofPitch * Math.PI) / 180);
    const cos = Math.cos((g.roofPitch * Math.PI) / 180);
    for (const [k, sign] of [[1, 1], [2, -1]] as const) {
      roof.push(must(ctx.command('space.addFace', { kind: 'roof plane', label: `${b.label}: roof plane ${k}`, owner: id, area: g.roofArea / 2, normal: unit(sign * perp[0] * sin, cos, sign * perp[1] * sin), between: [under, 'outside'] }), 'roof plane'));
    }
  } else {
    roof.push(must(ctx.command('space.addFace', { kind: 'roof', label: `${b.label}: roof`, owner: id, area: g.roofArea, normal: [0, 1, 0], between: [under, 'outside'] }), 'roof'));
  }
  const groundFloor = must(ctx.command('space.addFace', { kind: 'ground floor', label: `${b.label}: ground floor`, owner: id, area: g.footprint, normal: [0, -1, 0], between: [storeys[0]!, 'ground'] }), 'ground floor');
  const floors: EntityId[] = [];
  for (let i = 0; i + 1 < storeys.length; i += 1) {
    floors.push(must(ctx.command('space.addFace', { kind: 'floor', label: `${b.label}: floor over ${STOREY[i] ?? `floor ${i}`}`, owner: id, area: g.footprint, normal: [0, 1, 0], between: [storeys[i]!, storeys[i + 1]!] }), 'floor'));
  }
  if (roofSpace) floors.push(must(ctx.command('space.addFace', { kind: 'top floor', label: `${b.label}: top floor`, owner: id, area: g.footprint, normal: [0, 1, 0], between: [top, roofSpace] }), 'top floor'));
  const shell: BuildingShell = { building, storeys, roofSpace, walls, roof, groundFloor, floors };
  ctx.set('Shell', id, shell);
  return shell;
}

/** where an element of the building's type sits on its shell */
export function placementsOf(el: Pick<PlanElement, 'place'> & { place: NonNullable<PlanElement['place']> }, shell: BuildingShell, excavationDepth: number): PlacementIn[] {
  const side = (inside: boolean): 0 | 1 => (inside ? 0 : 1);
  const inside = el.place.side === 'inside';
  switch (el.place.on) {
    case 'walls':
      return shell.walls.map((face) => ({ face, side: side(inside) }));
    case 'roof':
      return shell.roof.map((face) => ({ face, side: side(inside) }));
    case 'groundFloor':
      return [{ face: shell.groundFloor, side: el.place.side === 'outside' ? 1 : 0 }];
    case 'floors':
      // a floor is walked on from above: side 1 of a floor face is the storey above
      return shell.floors.length ? shell.floors.map((face) => ({ face, side: 1 as const })) : [{ face: shell.groundFloor, side: 0 }];
    case 'interior':
      return shell.storeys.map((space) => ({ space }));
    case 'ground':
      return [{ medium: 'ground', depth: 0, thickness: excavationDepth, under: shell.groundFloor }];
  }
}

/** place a finished element of a building (making the shell first if needed) */
export function placeElement(ctx: WriteCtx, id: EntityId, b: Readonly<Structure>, elementId: string): void {
  const el = b.plan.elements.find((e) => e.id === elementId);
  if (!el?.part || !el.place) return;
  const shell = ensureShell(ctx, id, b);
  must(ctx.command('space.place', { owner: id, part: el.id, label: el.label, in: placementsOf({ place: el.place }, shell, ctx.data('buildingSettings').excavationDepth.value) }), 'placing an element');
}

/**
 * Stage 2 of the environment (decision 0014): the roof overhang shelters the façades. Rain falls at
 * the slant of the wind towards the wall against the drops' fall speed, so an overhang o keeps
 * dry the top o·w/v of the wall (w: fall speed, v: wind towards the wall); the sheltered share of a
 * wall of height H is min(1, o·w/(v·H)). Calm rain does not reach a vertical wall at all.
 */
export function overhangShelter(read: ReadCtx): ExposureContribution {
  // contributions are created once per world: look the façade's building up at each call
  return {
    stage: 'passive',
    label: 'Roof overhang over the façade',
    hour(at, h) {
      if (!('face' in at) || at.side !== 1 || h.rain <= 0) return null;
      const face = read.get('Face', at.face);
      const shell = face ? read.get('Shell', face.owner) : undefined;
      const b = face ? read.get('Structure', face.owner) : undefined;
      if (!b || !shell?.walls.includes(at.face)) return null;
      const overhang = read.data('buildingTypes')[b.template]?.roofOverhang.value ?? 0;
      if (overhang <= 0) return null;
      const g = (b.plan.detail as BuildingDesign).geometry;
      const height = g.floors * g.storeyHeight;
      const sheltered = h.windNormal > 0 ? Math.min(1, (overhang * RAINDROP_FALL_SPEED) / (h.windNormal * height)) : 1;
      return { ...h, rain: h.rain * (1 - sheltered), wet: h.wet * (1 - sheltered) };
    },
  };
}
