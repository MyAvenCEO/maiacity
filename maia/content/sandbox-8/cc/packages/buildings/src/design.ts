/**
 * Building design: geometry, site platform, element quantities (cost groups), estimates, and the
 * plan they make (decision 0026). Pure functions of the read context — used for live previews and
 * for the plan a structure is built to.
 */
import type { Finding, RulebookContribution } from '../../rulebooks/src/index.ts';
import { ex, type Explained, type ReadCtx } from '../../kernel/src/index.ts';
import { closerThan, footprintCorners, roadWithin, toWorld, type Vec2 } from '../../geo/src/index.ts';
import { fellsOf } from '../../production/src/index.ts';
import { occupying, overlapsOf, type Plan, type PlanElement, type Planner, type PlanSpec } from '../../structures/src/index.ts';
import type { BuildingDesign, BuildingSpec, BuildingType, ElementBasis, ElementQuantity, Geometry } from './contract.ts';

function typeOf(read: ReadCtx, id: string): BuildingType {
  const t = read.data('buildingTypes')[id];
  if (!t) throw new Error(`Unknown building type ${id}`);
  return t;
}


/** how far to look for a road for a building's access (m): beyond this, no delivery reaches the site anyway */
const ACCESS_SEARCH = 400;






export function basisValue(g: Geometry, basis: ElementBasis): number {
  switch (basis) {
    case 'topsoil':
      return g.topsoil;
    case 'excavation':
      return g.excavation;
    case 'footprint':
      return g.footprint;
    case 'perimeter':
      return g.perimeter;
    case 'wallNet':
      return g.wallNet;
    case 'windowArea':
      return g.windowArea;
    case 'roofArea':
      return g.roofArea;
    case 'slabArea':
      return g.slabArea;
    case 'gfa':
      return g.gfa;
    case 'count':
      return 1;
  }
}

export function designBuilding(read: ReadCtx, spec: BuildingSpec): BuildingDesign {
  const type = typeOf(read, spec.type);
  const settings = read.data('buildingSettings');
  const terrain = read.port('terrain');
  const problems: string[] = [];
  const warnings: string[] = [];
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const length = clamp(spec.length ?? type.length.value, type.minLength.value, type.maxLength.value);
  const width = clamp(spec.width ?? type.width.value, type.minWidth.value, type.maxWidth.value);
  const floors = clamp(Math.round(spec.floors ?? type.floors), 1, type.maxFloors);
  if (spec.length !== undefined && Math.abs(spec.length - length) > 0.01) warnings.push(`Length limited to ${length} m for ${type.label}.`);
  if (spec.width !== undefined && Math.abs(spec.width - width) > 0.01) warnings.push(`Width limited to ${width} m for ${type.label}.`);
  const rot = spec.rotation;
  const hl = length / 2;
  const hw = width / 2;
  const corners: Vec2[] = [toWorld(spec.center, rot, -hl, -hw), toWorld(spec.center, rot, hl, -hw), toWorld(spec.center, rot, hl, hw), toWorld(spec.center, rot, -hl, hw)];
  const b = terrain.bounds;
  if (corners.some((c) => c[0] < b.x0 + 5 || c[0] > b.x1 - 5 || c[1] < b.z0 + 5 || c[1] > b.z1 - 5)) problems.push('The building is outside the map.');

  // ---- platform: level pad at the mean ground of the footprint + working space
  const ws = settings.workingSpace.value;
  const step = 1;
  let sum = 0;
  let n = 0;
  let hmin = Infinity;
  let hmax = -Infinity;
  let wet = false;
  const samples: { h: number }[] = [];
  for (let u = -hl - ws; u <= hl + ws + 1e-9; u += step) {
    for (let v = -hw - ws; v <= hw + ws + 1e-9; v += step) {
      const p = toWorld(spec.center, rot, u, v);
      const h = terrain.heightAt(p[0], p[1]);
      if (terrain.waterDepthAt(p[0], p[1]) > 0.02) wet = true;
      samples.push({ h });
      sum += h;
      n += 1;
      hmin = Math.min(hmin, h);
      hmax = Math.max(hmax, h);
    }
  }
  if (wet) problems.push('The footprint touches water.');
  // (the level of the stripped ground: the platform is cut and filled below the topsoil, r40)
  // (a building revised keeps the level it was set out at: its pit is not measured from the ground it dug, r40)
  const was = spec.self ? (read.get('Structure', spec.self)?.plan.detail as BuildingDesign | undefined)?.geometry.platform : undefined;
  const platform = was ?? (n ? platformLevel(read, { center: spec.center, rotation: rot, length, width }) : 0);
  let cut = 0;
  let fill = 0;
  for (const s of samples) {
    if (s.h > platform) cut += (s.h - platform) * step * step;
    else fill += (platform - s.h) * step * step;
  }
  const span = Math.hypot(length + 2 * ws, width + 2 * ws);
  const slope = span > 0 ? ((hmax - hmin) / span) * 100 : 0;
  if (slope > settings.maxSlope.value) warnings.push(`Sloping plot (${slope.toFixed(1)} %): ${Math.round(cut)} m³ cut / ${Math.round(fill)} m³ fill for the building platform.`);
  // (the volumes the work will move are the ground's at its vertices: §5)
  const gw = groundOfBuilding(read, { center: spec.center, rotation: rot, length, width }, platform);
  const vol = (c: [number, number, number][]) => c.reduce((a, x) => a + x[2], 0);

  const pitch = type.roofPitch.value; // degrees (the schema converts into its declared unit)
  const pitchRad = type.roofStyle === 'flat' ? 0 : (pitch * Math.PI) / 180;
  const o = type.roofOverhang.value;
  const g: Geometry = {
    length,
    width,
    floors,
    storeyHeight: type.storeyHeight.value,
    height: floors * type.storeyHeight.value + (type.roofStyle === 'gable' ? (width / 2 + o) * Math.tan(pitchRad) : 0.6),
    roofPitch: type.roofStyle === 'flat' ? 0 : pitch,
    footprint: length * width,
    perimeter: 2 * (length + width),
    wallGross: 2 * (length + width) * type.storeyHeight.value * floors,
    windowArea: 0,
    wallNet: 0,
    roofArea: ((length + 2 * o) * (width + 2 * o)) / Math.cos(pitchRad),
    slabArea: length * width * (floors - 1),
    gfa: length * width * floors,
    corners,
    platform,
    platformCut: vol(gw.cut),
    platformFill: vol(gw.fill),
    topsoil: vol(gw.strip),
    excavation: vol(gw.pit),
    trees: read.port('vegetation').treesIn([toWorld(spec.center, rot, -hl - ws - 2, -hw - ws - 2), toWorld(spec.center, rot, hl + ws + 2, -hw - ws - 2), toWorld(spec.center, rot, hl + ws + 2, hw + ws + 2), toWorld(spec.center, rot, -hl - ws - 2, hw + ws + 2)]).map((tr) => tr.id),
  };
  if (g.trees.length) warnings.push(`${g.trees.length} trees on the plot must be felled.`);
  g.windowArea = g.wallGross * type.windowShare.value;
  g.wallNet = g.wallGross - g.windowArea;

  // ---- conflicts & access
  // roads and tracks are network edges (planned or open) — no dependency on the roads pack
  const routing = read.port('routing');
  // a road's surface and another structure are physical obstacles; how far to keep from them is practice (a rulebook finding)
  problems.push(...overlapsOf(read, { pos: spec.center, rotation: rot, length: 2 * hl, width: 2 * hw, ...(spec.self ? { self: spec.self } : {}) }));
  // the nearest road (for the access rulebook and the site's logistics)
  let access: BuildingDesign['access'] = null;
  for (const c of [spec.center, ...corners]) {
    const nr = routing.nearest(c, { openOnly: false, maxDistance: ACCESS_SEARCH + Math.max(hl, hw) });
    if (nr && (!access || nr.distance < access.distance)) access = { distance: nr.distance, point: nr.point };
  }

  // ---- elements
  const prod = read.port('production');
  const elements: ElementQuantity[] = [];
  const costs: Explained[] = [];
  let hours = 0;
  for (const el of type.elements) {
    const quantity = basisValue(g, el.basis) * el.factor;
    if (quantity <= 1e-6) continue;
    const activity = prod.activity(el.activity);
    const e = prod.estimate({ activity: el.activity, quantity, pos: spec.center }, spec.party);
    const row: ElementQuantity = { id: el.id, label: el.label, din276: el.din276, activity: el.activity, quantity, unit: activity.unit, cost: e.cost.v, hours: e.hours };
    if (el.serviceLife) row.serviceLife = el.serviceLife.value;
    elements.push(row);
    costs.push(ex.note(e.cost, `KG ${el.din276} ${el.label}`));
    hours += e.hours;
  }
  const site: Explained[] = [];
  for (const [label, activity, q] of [
    ['Tree felling', settings.activities.clearing, g.trees.length],
    ['Topsoil', settings.activities.topsoil, g.topsoil],
    ['Platform cut', settings.activities.platform, cut],
    ['Excavation', settings.activities.excavation, g.excavation],
  ] as const) {
    if (q <= 1) continue;
    const e = prod.estimate({ activity, quantity: q, pos: spec.center, haulTo: spec.center }, spec.party);
    site.push(ex.note(e.cost, `KG 310 ${label}`));
    hours += e.hours;
  }
  const cost = ex.sum('estimated construction cost (net, KG 300 + 400)', 'EUR', ...site, ...costs);
  // duration: element chain is mostly sequential (trades follow each other); subcontractor booking runs in parallel
  const chainHours = elements.reduce((a, e) => a + (prod.activity(e.activity).subcontract ? e.hours : e.hours), 0);
  const days = chainHours / 8 / 0.85 + 5;
  const stockpile = toWorld(spec.center, rot, 0, hw + ws + 10);
  const design: BuildingDesign = {
    type: spec.type,
    valid: problems.length === 0,
    problems,
    warnings,
    spec: { type: spec.type, center: spec.center, rotation: rot, length, width, floors, label: spec.label ?? type.label },
    geometry: g,
    elements,
    access,
    estimate: { cost: cost.v, costPerM2: cost.v / g.gfa, hours, days, explain: cost },
    stockpile,
    findings: [],
  };
  // codes and standards advise; they do not block (decision 0013)
  if (read.hasPort('rulebooks')) design.findings = read.port('rulebooks').check({ kind: 'building', design });
  return design;
}

/**
 * The practice pack's site rules as a rulebook (decision 0013): road access within a distance
 * (Erschließung) and the clearance to other buildings. Ignoring them is allowed; then deliveries
 * cross open ground (and beyond reach, nothing arrives), and neighbours stand close.
 */
const rot0 = (d: BuildingDesign) => d.spec.rotation;

export function siteRulebook(read: ReadCtx): RulebookContribution {
  return {
    label: 'Building site rules (practice pack)',
    kinds: ['building'],
    check({ design }) {
      const d = design as BuildingDesign;
      const settings = read.data('buildingSettings');
      const out: Finding[] = [];
      const rule = settings.accessDistance.source?.title ?? 'site rules';
      if (!d.access || d.access.distance > settings.accessDistance.value) {
        out.push({ rulebook: rule, code: 'building.access', severity: 'warning', message: `No road within ${settings.accessDistance.value} m (nearest ${d.access ? `${Math.round(d.access.distance)} m` : `more than ${ACCESS_SEARCH} m`}): deliveries and machines must cross open ground.`, ...(settings.accessDistance.source ? { source: settings.accessDistance.source } : {}) });
      }
      for (const [, e] of read.port('routing').edges()) {
        if (roadWithin(d.spec.center, rot0(d), d.spec.length / 2, d.spec.width / 2, e.geometry, e.width / 2 + settings.clearance.value) && !roadWithin(d.spec.center, rot0(d), d.spec.length / 2, d.spec.width / 2, e.geometry, e.width / 2)) {
          out.push({ rulebook: settings.clearance.source?.title ?? 'site rules', code: 'building.roadClearance', severity: 'advice', message: `Closer than ${settings.clearance.value} m to the edge of a road.`, ...(settings.clearance.source ? { source: settings.clearance.source } : {}) });
          break;
        }
      }
      const rot = d.spec.rotation;
      const hl = d.spec.length / 2;
      const hw = d.spec.width / 2;
      for (const [, other] of occupying(read)) {
        if (closerThan(d.spec.center, rot, hl, hw, other.plan, settings.clearance.value) && !closerThan(d.spec.center, rot, hl, hw, other.plan, 0)) {
          out.push({ rulebook: settings.clearance.source?.title ?? 'site rules', code: 'building.clearance', severity: 'advice', message: `Closer than ${settings.clearance.value} m to "${other.label}".`, ...(settings.clearance.source ? { source: settings.clearance.source } : {}) });
        }
      }
      return out;
    },
  };
}

/** the topsoil at the top of the ground at a cell of the ground's grid (m) */
function topsoilAt(read: ReadCtx, fi: number, fj: number): number {
  const terrain = read.port('terrain');
  let td = 0;
  for (const l of terrain.groundAt(fi, fj).column.layers) {
    if (terrain.soilClass(l.classId).group !== 'topsoil') break;
    td += l.thickness;
  }
  return td;
}

/** a rectangle round a building's footprint, `m` m wider on every side */
function rectOf(spec: { center: Vec2; rotation: number; length: number; width: number }, m: number): Vec2[] {
  const hl = spec.length / 2 + m;
  const hw = spec.width / 2 + m;
  return [toWorld(spec.center, spec.rotation, -hl, -hw), toWorld(spec.center, spec.rotation, hl, -hw), toWorld(spec.center, spec.rotation, hl, hw), toWorld(spec.center, spec.rotation, -hl, hw)];
}

/** the platform's level: the mean of the ground over the footprint and its working space once stripped (r40) */
export function platformLevel(read: ReadCtx, spec: { center: Vec2; rotation: number; length: number; width: number }): number {
  const ws = read.data('buildingSettings').workingSpace.value;
  const terrain = read.port('terrain');
  const cells = terrain.cover(rectOf(spec, ws));
  const a = cells.reduce((x, c) => x + c[2], 0);
  return a > 0 ? cells.reduce((x, [fi, fj, ar]) => x + (terrain.groundAt(fi, fj).h - topsoilAt(read, fi, fj)) * ar, 0) / a : terrain.heightAt(spec.center[0], spec.center[1]);
}

/**
 * A building's earthworks measured on the ground (design/physical-state.md §5), each as the cells of the ground's grid
 * and the m³ there: the topsoil left on the plot (footprint, working space and 2 m) stripped; the pit over the
 * footprint and its working space dug from the stripped ground to the excavation's depth below the platform; the ring
 * round it cut down and filled up to the platform. Measured on the ground as it is: a plan revised digs only what is
 * left (r40: never the pit again, nor a fill dug out again).
 */
export function groundOfBuilding(read: ReadCtx, spec: { center: Vec2; rotation: number; length: number; width: number }, platform: number): { strip: [number, number, number][]; cut: [number, number, number][]; fill: [number, number, number][]; pit: [number, number, number][] } {
  const settings = read.data('buildingSettings');
  const ws = settings.workingSpace.value;
  const terrain = read.port('terrain');
  const bottom = platform - settings.excavationDepth.value;
  const inPit = new Set(terrain.cover(rectOf(spec, ws)).map(([fi, fj]) => `${fi},${fj}`));
  const out = { strip: [] as [number, number, number][], cut: [] as [number, number, number][], fill: [] as [number, number, number][], pit: [] as [number, number, number][] };
  for (const [fi, fj, a] of terrain.cover(rectOf(spec, ws + 2))) {
    const td = topsoilAt(read, fi, fj);
    if (td * a > 1e-6) out.strip.push([fi, fj, td * a]);
    const h = terrain.groundAt(fi, fj).h - td;
    if (inPit.has(`${fi},${fj}`)) {
      if (h > bottom + 0.005) out.pit.push([fi, fj, (h - bottom) * a]);
    } else if (h > platform + 0.005) out.cut.push([fi, fj, (h - platform) * a]);
    else if (h < platform - 0.005) out.fill.push([fi, fj, (platform - h) * a]);
  }
  return out;
}

const floorName = (i: number): string => (i === 0 ? 'ground floor' : i === 1 ? '1st floor' : i === 2 ? '2nd floor' : i === 3 ? '3rd floor' : `${i}th floor`);

/** an element's lifts in a building of `floors` storeys (H1): a storey's walls from its floor to its top; a slab over each storey but the top one */
function liftsOf(by: 'storeys' | 'slabs' | undefined, floors: number): { from: number; to: number; label: string }[] | undefined {
  if (by === 'storeys' && floors > 1) return Array.from({ length: floors }, (_, i) => ({ from: i, to: i + 1, label: floorName(i) }));
  if (by === 'slabs' && floors > 1) return Array.from({ length: floors - 1 }, (_, i) => ({ from: i + 1, to: i + 1, label: `over the ${floorName(i)}` }));
  return undefined;
}

/**
 * The plan of a building (decision 0026): the site work (setting out, felling, topsoil, the
 * platform, the excavation), then the type's elements in their order, then the acceptance. The
 * design rides along in the plan's detail.
 */
export function buildingPlan(read: ReadCtx, spec: PlanSpec): Plan {
  const design = designBuilding(read, { type: spec.template, center: spec.pos, rotation: spec.rotation ?? 0, ...(spec.self ? { self: spec.self } : {}), ...(spec.party ? { party: spec.party } : {}), ...(spec.length !== undefined ? { length: spec.length } : {}), ...(spec.width !== undefined ? { width: spec.width } : {}), ...(spec.floors !== undefined ? { floors: spec.floors } : {}), ...(spec.label ? { label: spec.label } : {}) });
  const type = typeOf(read, design.type);
  const settings = read.data('buildingSettings');
  const terrain = read.port('terrain');
  const g = design.geometry;
  const c = design.spec.center;
  const elements: PlanElement[] = [];
  const site = (id: string, label: string, activity: string, quantity: number, stage: string, extra: Partial<PlanElement> = {}) => {
    const after = elements.length ? [elements[elements.length - 1]!.id] : [];
    elements.push({ id, label, activity, quantity, after, part: false, stage, ...extra });
  };
  site('survey', 'Setting out the building', settings.activities.survey, g.perimeter + 20, 'site');
  if (g.trees.length) site('clear', `Fell ${g.trees.length} trees on the plot`, settings.activities.clearing, g.trees.length, 'site', { site: { trees: g.trees, fells: fellsOf(read, g.trees, settings.materials, 'wood', 'tree') } });
  // the ground as the work moves it (§5): stripped, levelled to the platform (cut, then filled from what was cut), the pit dug
  const gw = groundOfBuilding(read, design.spec, g.platform);
  const as = { topsoil: settings.materials.topsoil, fill: settings.materials.soil, spoil: settings.materials.spoil };
  // (the soils as the party knows them, 8d: its test pit's, else the soil map's; the work meets the ground as it is)
  const known = read.port('production').knownColumn(spec.party, c).layers[0]?.classId;
  const top = known && terrain.soilClass(known).group === 'topsoil' ? known : read.data('terrainSettings').soil.topsoilClass;
  if (g.topsoil > 1) site('topsoil', 'Strip topsoil (building plot)', settings.activities.topsoil, g.topsoil, 'site', { site: { haulTo: design.stockpile, ...(top ? { soilClass: top } : {}), produces: [{ material: settings.materials.topsoil, perUnit: top ? terrain.soilClass(top).bulkDensity.value : 1.4, store: 'topsoil' }], ground: { op: 'dig', cells: gw.strip, as, store: 'topsoil', topsoilOnly: true } } });
  const sub = read.port('production').knownSoil(spec.party, c, 0.8).id;
  const subClass = terrain.soilClass(sub);
  const won = [{ material: subClass.suitableFill ? settings.materials.soil : settings.materials.spoil, perUnit: subClass.bulkDensity.value, store: 'soil' }];
  // the pit first (its soil fills the ring round it), then the ring levelled to the platform
  if (g.excavation > 0.5) site('excavation', 'Excavate foundation', settings.activities.excavation, g.excavation, 'platform', { site: { haulTo: design.stockpile, soilClass: sub, soilDepth: 0.8, produces: won, ground: { op: 'dig', cells: gw.pit, as, store: 'soil' } } });
  if (g.platformCut > 1) site('platform', 'Level the building platform', settings.activities.platform, g.platformCut, 'platform', { site: { haulTo: design.stockpile, soilClass: sub, soilDepth: 0.8, produces: won, ground: { op: 'dig', cells: gw.cut, as, store: 'soil' } } });
  if (g.platformFill > 1) site('platformFill', 'Fill and compact the building platform', settings.activities.fill, g.platformFill, 'platform', { site: { soilClass: sub, soilDepth: 0.8, ground: { op: 'fill', cells: gw.fill, clsOf: { [settings.materials.importFill]: settings.importFillClass } }, consumes: { [settings.materials.soil]: subClass.bulkDensity.value / subClass.compactionFactor.value }, substitutes: { [settings.materials.soil]: { material: settings.materials.importFill, perUnit: settings.importFillDensity.value } }, from: 'soil', params: { layerThickness: settings.fillLayerThickness.value } } });
  // (the building begins on the ground as the site work leaves it: the pit dug, the platform levelled and filled, H1)
  const ground = elements.length ? elements[elements.length - 1]!.id : undefined;
  for (const el of type.elements) {
    const quantity = basisValue(g, el.basis) * el.factor;
    if (quantity <= 1e-6) continue;
    const after = el.after.length ? el.after.filter((k) => type.elements.some((x) => x.id === k)) : ground ? [ground] : [];
    const lifts = liftsOf(el.lifts, g.floors);
    elements.push({
      id: el.id,
      label: el.label,
      activity: el.activity,
      quantity,
      after,
      ...(el.with?.length ? { with: el.with.filter((k) => type.elements.some((x) => x.id === k)) } : {}),
      ...(lifts ? { lifts } : {}),
      ...(lifts && el.on?.length ? { on: el.on.filter((k) => type.elements.some((x) => x.id === k)) } : {}),
      part: true,
      stage: el.stage,
      place: el.place,
      life: el.serviceLife?.value ?? 80,
      ...(el.material ? { material: el.material } : {}),
      ...(el.renewal ? { renewal: { activity: el.renewal.activity, quantity: basisValue(g, el.basis) * el.renewal.factor, label: el.renewal.label } } : {}),
    });
  }
  const leaves = type.elements.filter((el) => elements.some((x) => x.id === el.id) && !type.elements.some((o) => o.after.includes(el.id))).map((el) => el.id);
  elements.push({ id: 'acceptance', label: 'Acceptance & handover', activity: settings.activities.acceptance, quantity: 1, after: leaves.length ? leaves : ['excavation'], part: false, stage: 'handover' });
  const mass = (p: number) => ({ value: p, unit: 'kg', source: type.structure.dead.source });
  return {
    planner: 'building',
    template: design.type,
    label: design.spec.label,
    pos: [c[0], c[1]],
    rotation: design.spec.rotation,
    length: design.spec.length,
    width: design.spec.width,
    height: g.height,
    floorArea: g.gfa,
    kit: false,
    physics: {
      form: 'building',
      width: { value: design.spec.width, unit: 'm' },
      mass: mass((type.structure.dead.value * g.gfa * 1000) / 9.81),
      rating: {},
      maxSlope: { value: settings.maxSlope.value / 100, unit: '1', source: settings.maxSlope.source },
      bearing: { dead: type.structure.dead, imposed: type.structure.imposed, bearer: type.structure.bearer, floorArea: g.gfa, footprint: g.footprint, perimeter: g.perimeter, floors: g.floors, foundation: type.structure.foundation, depth: settings.excavationDepth.value, storey: type.storeyHeight.value, ...(type.structure.unbraced ? { unbraced: type.structure.unbraced } : {}) },
    },
    stores: [
      { key: 'soil', label: 'soil heap', pos: design.stockpile },
      { key: 'topsoil', label: 'topsoil heap', pos: [design.stockpile[0] + 8, design.stockpile[1] + 8] },
      ...(g.trees.length ? [{ key: 'wood', label: 'felled wood', pos: [design.stockpile[0] - 8, design.stockpile[1] + 8] as Vec2 }] : []),
    ],
    elements,
    estimate: { cost: design.estimate.cost, hours: design.estimate.hours, days: design.estimate.days, explain: design.estimate.explain },
    inspection: { activity: settings.activities.inspection, quantity: Math.max(50, g.perimeter * 2) },
    depreciation: settings.depreciation.value,
    valid: design.valid,
    problems: design.problems,
    warnings: design.warnings,
    findings: design.findings,
    detail: design,
  };
}

/** houses, halls and the other building types of the practice pack */
export const buildingPlanner: Planner = {
  id: 'building',
  templates: (read) => Object.fromEntries(Object.entries(read.data('buildingTypes')).map(([id, t]) => [id, { label: t.label, description: t.description, form: 'building' as const, category: t.category, length: t.length.value, width: t.width.value, floors: t.floors }])),
  plan: buildingPlan,
};
