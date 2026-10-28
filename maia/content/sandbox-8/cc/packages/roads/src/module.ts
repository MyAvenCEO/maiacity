/**
 * Roads module: plans roads as production projects, turns completed work into physical
 * change (felled trees, excavated/filled terrain, opened network edges), deteriorates roads
 * in service and maintains them through inspections and interventions.
 */
import { command, DAY, defineModule, HOUR, s, type EntityId, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';
import { cumulativeLengths, nearestOnPolyline, verticesInPolygon, type Vec2 } from '../../geo/src/index.ts';
import type { PackageSpec } from '../../production/src/index.ts';
import { applyIntervention, deteriorateDay, gradeOf, initialCondition, speedFactor } from './condition.ts';
import { InterventionSchema, RoadClassSchema, RoadDedicationSchema, RoadSettingsSchema, type Road, type RoadClass, type RoadCondition, type RoadDesign, type RoadInspection, type SectionProgress } from './contract.ts';
import { designRoad, packageSpecs, roadClassRulebook } from './design.ts';
import type { PlacementIn } from '../../space/src/index.ts';
import { actorOf, partyLabel } from '../../parties/src/index.ts';

interface PackageData {
  road: EntityId;
  section?: number;
  stage?: string;
  trees?: string[];
  intervention?: string;
  inspection?: boolean;
}

function surfaceAt(design: RoadDesign, s: number): { surface: number; formation: number } {
  const st = design.stations;
  if (st.length === 0) return { surface: 0, formation: 0 };
  let lo = 0;
  let hi = st.length - 1;
  if (s <= st[0]!.s) return st[0]!;
  if (s >= st[hi]!.s) return st[hi]!;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (st[mid]!.s <= s) lo = mid;
    else hi = mid;
  }
  const a = st[lo]!;
  const b = st[hi]!;
  const f = (s - a.s) / Math.max(1e-9, b.s - a.s);
  return { surface: a.surface + (b.surface - a.surface) * f, formation: a.formation + (b.formation - a.formation) * f };
}

function sectionProgress(read: ReadCtx, roadId: EntityId): SectionProgress[] {
  const road = read.get('Road', roadId);
  if (!road) return [];
  const out: SectionProgress[] = road.design.sections.map((s) => ({ index: s.index, s0: s.s0, s1: s.s1, done: [...(road.stages[String(s.index)] ?? [])] }));
  if (road.status === 'open') {
    for (const p of out) p.done.push('open');
    return out;
  }
  if (!road.project) return out;
  const project = read.get('Project', road.project);
  if (!project) return out;
  const prod = read.port('production');
  for (const pkgId of project.packages) {
    const pkg = read.get('WorkPackage', pkgId);
    if (!pkg || pkg.status !== 'active') continue;
    const d = pkg.data as PackageData | undefined;
    if (d?.section === undefined || !d.stage) continue;
    const row = out[d.section];
    if (row && (!row.active || prod.progress(pkgId) > 0)) row.active = { stage: d.stage, progress: prod.progress(pkgId) };
  }
  return out;
}

/** network edges realising a road — looked up by asset, since junctions may split edges later */
function edgesOf(read: ReadCtx, roadId: EntityId): EntityId[] {
  const out: EntityId[] = [];
  for (const [id, e] of read.port('routing').edges()) if (e.asset === roadId) out.push(id);
  return out;
}

function roadEdgesTraffic(read: ReadCtx, roadId: EntityId): { vehicles: number; esalPerDay: number } {
  const tr = read.port('traffic');
  let vehicles = 0;
  let esal = 0;
  for (const e of edgesOf(read, roadId)) {
    const t = tr.edge(e);
    if (!t) continue;
    const last = t.recent[t.recent.length - 1];
    vehicles = Math.max(vehicles, last?.veh ?? 0);
    esal = Math.max(esal, t.esalPerDay);
  }
  return { vehicles, esalPerDay: esal };
}

function meanGradient(design: RoadDesign): number {
  let sum = 0;
  for (let i = 1; i < design.stations.length; i += 1) {
    const a = design.stations[i - 1]!;
    const b = design.stations[i]!;
    sum += Math.abs(b.surface - a.surface) / Math.max(1e-6, b.s - a.s);
  }
  return design.stations.length > 1 ? (100 * sum) / (design.stations.length - 1) : 0;
}

function inspectionFrom(cond: Readonly<RoadCondition>, at: number): RoadInspection {
  const sections = cond.sections.map((s) => ({ s0: s.s0, s1: s.s1, grade: s.grade, iri: s.iri, cracks: s.cracks, rut: s.rut, potholes: s.potholes, gravel: s.gravel }));
  const len = sections.reduce((a, s) => a + (s.s1 - s.s0), 0) || 1;
  return { at, sections, worst: Math.max(1, ...sections.map((s) => s.grade)), mean: sections.reduce((a, s) => a + s.grade * (s.s1 - s.s0), 0) / len };
}

function interventionQuantity(read: ReadCtx, roadId: EntityId, road: Readonly<Road>, section: number, intervention: string): number {
  const iv = read.data('roadInterventions')[intervention]!;
  const sec = road.design.sections[section]!;
  const cls = read.data('roadClasses')[road.classId]!;
  const area = cls.carriageway.value * sec.length;
  const c = read.get('RoadCondition', roadId)?.sections[section];
  switch (iv.basis) {
    case 'area':
      return area;
    case 'length':
      return sec.length;
    case 'surfaceLayerVolume':
      return area * (iv.thickness?.value ?? 0.04);
    case 'surfaceLayerMass':
      return area * (iv.thickness?.value ?? 0.04) * (iv.density?.value ?? 2.45);
    case 'cracks':
      // crack length ≈ cracked area share × area × 2 m of crack per m² (assumption)
      return Math.max(1, ((c?.cracks ?? 0) / 100) * area * 2);
    case 'patches':
      return Math.max(1, ((c?.potholes ?? 0) / 100) * area);
  }
}

const V2 = s.point();

/**
 * Where a road's parts sit (decision 0014): its surface is a face between the ground and the open
 * air; its layers lie in the ground below it, top-down at their depths, the top layer forming the
 * surface.
 */
function placeLayers(ctx: WriteCtx, id: EntityId, road: Road, cls: RoadClass): void {
  const width = cls.carriageway.value;
  const r = ctx.command('space.addFace', { kind: 'road surface', label: `${road.label}: surface`, owner: id, area: road.design.length * width, normal: [0, 1, 0], between: ['ground', 'outside'] });
  if (!r.ok) throw new Error(`roads: surface face failed: ${JSON.stringify(r.reasons)}`);
  const face = r.value;
  // layer depths vary along the road (the frost protection layer follows the subgrade): one
  // placement per distinct depth and thickness, to the centimetre
  const at: Record<string, PlacementIn[]> = {};
  for (const sec of road.design.sections) {
    let depth = 0;
    for (const l of cls.layers) {
      const thickness = Math.round((sec.layerThickness[l.id] ?? 0) * 100) / 100;
      const list = (at[l.id] ??= []);
      if (!list.some((x) => 'medium' in x && x.depth === depth && x.thickness === thickness)) list.push({ medium: 'ground', depth, thickness, under: face });
      depth = Math.round((depth + thickness) * 100) / 100;
    }
  }
  cls.layers.forEach((l, i) => {
    const placements = [...(i === 0 ? [{ face, side: 1 as const }] : []), ...(at[l.id] ?? [])];
    const placed = ctx.command('space.place', { owner: id, part: l.id, label: l.label, in: placements });
    if (!placed.ok) throw new Error(`roads: placing ${l.id} failed`);
  });
}

/** the least change of roughness worth a job (m/km): less is hardly felt in driving (an estimate) */
const SMOOTHER = 0.25;
/** ruts worth an overlay for (mm): less is hardly felt (an estimate) */
const RUTTED = 5;

/** a player acts only on its own party's roads */
function mustHoldRoad(ctx: WriteCtx, road: EntityId): void {
  const r = ctx.get('Road', road);
  if (ctx.caller === 'client' && r && r.holder !== actorOf(ctx)) ctx.reject('roads.notOurs', { road: r.label, party: partyLabel(ctx, actorOf(ctx)) });
}

/**
 * Whether ways lead from a road to a public one (a way of the world, not a player's road, or one the authority
 * holds): open ways only, or those being built too (`planned`).
 */
function joinedToPublic(read: ReadCtx, road: Readonly<Road>, authority: EntityId | undefined, planned = false): boolean {
  const own = new Set(road.edges);
  const byNode = new Map<EntityId, EntityId[]>();
  for (const [eid, e0] of read.all('NetEdge')) {
    if ((!e0.open && !planned) || own.has(eid)) continue;
    for (const n of [e0.a, e0.b]) byNode.set(n, [...(byNode.get(n) ?? []), eid]);
  }
  const isPublic = (eid: EntityId) => {
    const asset = read.get('NetEdge', eid)?.asset;
    const r0 = asset ? read.get('Road', asset) : undefined;
    return !r0 || (authority !== undefined && r0.holder === authority);
  };
  const seen = new Set<EntityId>();
  const queue = road.edges.flatMap((eid) => {
    const e0 = read.get('NetEdge', eid);
    return e0 ? [e0.a, e0.b] : [];
  });
  const visited = new Set<EntityId>(queue);
  while (queue.length) {
    const n = queue.shift()!;
    for (const eid of byNode.get(n) ?? []) {
      if (seen.has(eid)) continue;
      seen.add(eid);
      if (isPublic(eid)) return true;
      const e0 = read.get('NetEdge', eid)!;
      for (const m of [e0.a, e0.b]) if (!visited.has(m)) (visited.add(m), queue.push(m));
    }
  }
  return false;
}

/** how a road is joined to the ways out: by open ways, only by ways being built, or not at all */
const joinedBy = (read: ReadCtx, road: Readonly<Road>): 'open' | 'planned' | 'none' => (joinedToPublic(read, road, undefined) ? 'open' : joinedToPublic(read, road, undefined, true) ? 'planned' : 'none');

/** a road under construction given up: off the network, cancelled; a road joined only by it says so (Qwen S181) */
function abandonRoad(ctx: WriteCtx, id: EntityId): void {
  const road = ctx.require('Road', id);
  if (road.status !== 'construction') return;
  const others = [...ctx.all('Road')].filter(([rid, r]) => rid !== id && (r.status === 'construction' || r.status === 'open') && joinedToPublic(ctx, r, undefined, true));
  ctx.command('network.removeEdges', { edges: edgesOf(ctx, id) });
  ctx.patch('Road', id, { status: 'cancelled', edges: [] });
  ctx.log('warn', `Cancelled ${road.label}`, [id]);
  for (const [rid, r] of others) {
    if (!joinedToPublic(ctx, r, undefined, true)) ctx.log('warn', `${r.label} no longer joins any way out: ${road.label}, given up, was its only link: nothing reaches it by an open road until a road joins it again.`, [rid, id]);
  }
}

/**
 * When the authority decides on a road offered to it: when its council has met, some working day within its
 * days (drawn, not told; Qwen S179/S180). Kept in the module's state, not on the road: a client does not read it.
 */
function drawHandover(ctx: WriteCtx, road: EntityId, from: number, decideAt: number): void {
  let at = ctx.calendar.startOfDay(from + Math.round((decideAt - from) * (0.4 + 0.6 * ctx.rng('roads.handover').next()))) + 10 * HOUR;
  while (ctx.calendar.at(at).weekday > 4 && at + DAY < decideAt) at += DAY;
  at = Math.max(ctx.now, Math.min(at, decideAt));
  ctx.setState('roads', { handover: { ...ctx.state('roads').handover, [road]: at } });
  ctx.at(at, 'handoverDecided', { road, at });
}

/**
 * The sections of roads under construction made firm (formation accepted or gravel laid), and those whose corridor is
 * cleared of trees (felled, or none stood in it), with their bounds; kept for each world (by its routing port: one a
 * runtime) until a road changes (review S3 #4)
 */
type GroundSection = { path: Vec2[]; half: number; x0: number; x1: number; z0: number; z1: number };
const groundCaches = new WeakMap<object, { rev: number; firm: GroundSection[]; cleared: GroundSection[] }>();
function roadGround(read: ReadCtx): { firm: GroundSection[]; cleared: GroundSection[] } {
  const world = read.port('routing') as object;
  const rev = read.revision('Road');
  const kept = groundCaches.get(world);
  if (kept?.rev === rev) return kept;
  const roads = [...read.all('Road')].filter(([, r]) => r.status === 'construction');
  const firm: GroundSection[] = [];
  const cleared: GroundSection[] = [];
  const of = (path: Vec2[], half: number): GroundSection => {
    const xs = path.map((q) => q[0]);
    const zs = path.map((q) => q[1]);
    return { path, half, x0: Math.min(...xs) - half, x1: Math.max(...xs) + half, z0: Math.min(...zs) - half, z1: Math.max(...zs) + half };
  };
  for (const [, road] of roads) {
    const cls = read.data('roadClasses')[road.classId];
    if (!cls) continue;
    const layers = new Set(['subgrade', ...cls.layers.map((l) => l.id)]);
    const half = cls.carriageway.value / 2 + cls.shoulder.value;
    for (const sec of road.design.sections) {
      if (sec.path.length < 2) continue;
      const done = road.stages[String(sec.index)] ?? [];
      if (done.some((st) => layers.has(st))) firm.push(of(sec.path, half));
      // (its corridor, with the working room beside the road, once felled or where no tree stood in it)
      if (!sec.trees.length || done.includes('clear')) cleared.push(of(sec.path, half + CORRIDOR_ROOM));
    }
  }
  const out = { rev, firm, cleared };
  groundCaches.set(world, out);
  return out;
}
/** the working room either side of a road's shoulders cleared with its corridor (m): an estimate */
const CORRIDOR_ROOM = 2;
const within = (list: GroundSection[], x: number, z: number) => {
  for (const f of list) {
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
    if (nearestOnPolyline(f.path, [x, z]).distance <= f.half) return true;
  }
  return false;
};

export const roadsModule = defineModule({
  id: 'roads',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['NetEdge', 'Party', 'Project', 'WorkPackage'],
  commandDocs: {
    "roads.plan": {
      description:
        'Design and build a road from control points (≥ 2 points [x, z]) with a road class id (see roads.list / roads.preview). The design is checked (radius, grade, connection to an existing or planned road within 15 m); materials are ordered and a construction project with work packages per section starts. Use projection roads.preview with the same points first to see cost, duration, earthworks and problems.',
    },
    "roads.cancel": {
      description: 'Cancel a road under construction: work stops, open orders are cancelled, the planned network edges are removed.',
    },
    "roads.inspect": {
      description: 'Commission a visual condition survey of an open road; condition grades (ZEB 1.0–5.0) are only known after surveys.',
    },
    "roads.maintain": {
      description: 'Start a maintenance intervention (e.g. grading, regravel, crackSeal, patching, surfaceTreatment, overlay) on all or selected sections of an open road.',
    },
    "roads.handOver": {
      description: 'Offer an open road of ours to the public body that keeps the streets (dedication to public use and handover): it decides after its days, taking it if it is of a class it takes, in good enough condition and joined to the network; then it is theirs to keep, and no longer ours. Declined, it says why.',
    },
  },
  label: 'Roads',
  provides: ['roads'],
  requires: ['terrain', 'vegetation', 'routing', 'traffic', 'production', 'holdings', 'weather', 'soil-state', 'space', 'parties'],
  // a road's condition is the world's truth: known only by a survey (RoadInspection), decision 0023
  observe: { RoadCondition: 'hidden' },
  state: { initial: () => ({ handover: {} }) },
  components: {
    Road: s.object({ holder: s.ref('party'), label: s.string(), classId: s.string(), status: s.enum(['construction', 'open', 'closed', 'cancelled']) }, { passthrough: true }),
    RoadCondition: s.object({ snc: s.number(), lastUpdate: s.number() }, { passthrough: true }),
    RoadInspection: s.object({ at: s.number(), worst: s.number(), mean: s.number() }, { passthrough: true }),
  },
  data: { roadClasses: s.record(RoadClassSchema), roadSettings: RoadSettingsSchema, roadInterventions: s.record(InterventionSchema), roadDedication: RoadDedicationSchema.optional() },
  events: {
    'roads.opened': s.object({ road: s.string() }),
    'roads.inspected': s.object({ road: s.string(), worst: s.number() }),
    'roads.handedOver': s.object({ road: s.string(), from: s.string(), to: s.string() }),
  },
  blockers: {
    'roads.notOurs': '{road} is not held by {party}',
    'roads.invalidDesign': 'Road design not buildable: {problems}',
    'roads.unknownClass': 'Unknown road class {classId}',
    'roads.notOpen': 'Road is not in service',
    'roads.wrongSurface': '{intervention} is for {surface} roads',
    'roads.unknownIntervention': 'Unknown intervention {intervention}',
    'roads.unknownSection': 'Section {section} does not exist (road has {count} sections)',
    'roads.noDedication': 'There is no public body here that takes over roads',
    'roads.handoverPending': '{road} is offered to {authority}: it decides by {date}',
    'roads.handoverDeclined': '{authority} does not take {road} over: {why}',
  },
  commands: {
    'roads.plan': command(s.object({ points: s.array(V2), classId: s.string(), label: s.string().optional(), priority: s.number().optional(), supply: s.object({ mode: s.enum(['upfront', 'justInTime']), bufferHours: s.number({ min: 0 }).optional(), coverDays: s.number({ min: 0.5 }).optional() }).optional() }), (ctx, p) => {
      if (!ctx.data('roadClasses')[p.classId]) ctx.reject('roads.unknownClass', { classId: p.classId });
      const cls = ctx.data('roadClasses')[p.classId]!;
      const holder = actorOf(ctx);
      const design = designRoad(ctx, p.points as Vec2[], p.classId, (h) => h === holder, holder);
      if (!design.valid) ctx.reject('roads.invalidDesign', { problems: design.problems.join(' ') });
      const n = ctx.count('Road') + 1;
      const label = p.label ?? `${cls.label} ${n}`;
      const road = ctx.spawn('road', { name: label });
      const store = (lbl: string, kind: 'site' | 'stockpile', pos: Vec2) => {
        const r = ctx.command('inventory.createStore', { holder, label: lbl, kind, pos });
        if (!r.ok) throw new Error(`createStore failed: ${r.reasons.map((x) => x.code).join()}`);
        return r.value;
      };
      const stores = {
        site: store(`${label}: material yard`, 'site', design.siteStore),
        soil: store(`${label}: soil stockpile`, 'stockpile', design.stockpile),
        topsoil: store(`${label}: topsoil stockpile`, 'stockpile', [design.stockpile[0] + 12, design.stockpile[1] + 12]),
        ...(design.sections.some((sc) => sc.trees.length) ? { wood: store(`${label}: felled wood`, 'stockpile', [design.stockpile[0] - 12, design.stockpile[1] + 12]) } : {}),
      };
      const net = ctx.command('network.addPolyline', {
        points: design.alignment.filter((_, i, a) => i % 2 === 0 || i === a.length - 1),
        open: false,
        surface: cls.networkSurface ?? cls.surface,
        width: cls.carriageway.value,
        speedLimit: cls.speedLimit.value,
        asset: road,
        label,
      });
      if (!net.ok) throw new Error(`network.addPolyline failed: ${net.reasons.map((x) => ctx.formatBlocker(x)).join('; ')}`);
      const specs: PackageSpec[] = packageSpecs(ctx, design, stores, road);
      // the materials are ordered by the project: all up front unless asked just in time
      const pr = ctx.command('production.createProject', { label: `Build ${label}`, owner: 'roads', ref: road, priority: p.priority ?? 0, site: design.alignment[0]!, store: stores.site, supply: p.supply ?? { mode: 'upfront' }, packages: specs });
      if (!pr.ok) ctx.reject(pr.reasons[0]!.code, pr.reasons[0]!.params);
      const project = pr.ok ? pr.value.project : undefined;
      ctx.set('Road', road, {
        holder,
        label,
        classId: p.classId,
        status: 'construction',
        design,
        ...(project ? { project } : {}),
        edges: net.value.edges,
        stores,
        createdAt: ctx.now,
        stages: {},
      });
      ctx.log('info', `Planned ${label}: ${(design.length / 1000).toFixed(2)} km, est. ${Math.round(design.estimate.cost / 1000)} k€, ~${Math.ceil(design.estimate.days)} working days`, [road]);
      return { road, project: project! };
    }),
    'roads.cancel': command(s.object({ road: s.ref('road') }), (ctx, p) => {
      mustHoldRoad(ctx, p.road);
      const road = ctx.require('Road', p.road);
      if (road.status !== 'construction') ctx.reject('roads.notOpen');
      // its work is cancelled, and with it the road (projectCancelled)
      if (road.project && ctx.get('Project', road.project)?.status !== 'cancelled') ctx.command('production.cancelProject', { project: road.project });
      else abandonRoad(ctx, p.road);
    }),
    'roads.inspect': command(s.object({ road: s.ref('road') }), (ctx, p) => {
      mustHoldRoad(ctx, p.road);
      const road = ctx.require('Road', p.road);
      if (road.status !== 'open') ctx.reject('roads.notOpen');
      const settings = ctx.data('roadSettings');
      const r = ctx.command('production.createProject', {
        label: `Condition survey ${road.label}`,
        owner: 'roads',
        ref: p.road,
        priority: 5,
        site: road.design.alignment[0]!,
        packages: [{ key: 'inspect', activity: ctx.data('roadClasses')[road.classId]?.activities?.inspection ?? settings.activities.inspection, label: `Visual condition survey ${road.label}`, quantity: road.design.length, pos: road.design.alignment[0]!, path: road.design.alignment, data: { road: p.road, inspection: true } }],
      });
      if (!r.ok) ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
      return r.ok ? r.value.project : '';
    }),
    'roads.handOver': command(s.object({ road: s.ref('road') }), (ctx, p) => {
      mustHoldRoad(ctx, p.road);
      const road = ctx.require('Road', p.road);
      if (road.status !== 'open') ctx.reject('roads.notOpen');
      const law = ctx.hasData('roadDedication') ? ctx.data('roadDedication') : undefined;
      if (!law || !ctx.get('Party', law.authority)) return ctx.reject('roads.noDedication', {});
      if (road.handover) ctx.reject('roads.handoverPending', { road: road.label, authority: partyLabel(ctx, law.authority), date: ctx.calendar.format(road.handover.decideAt, 'day') });
      const decideAt = ctx.now + Math.round(law.days.value * DAY);
      ctx.set('Road', p.road, { ...road, handover: { at: ctx.now, decideAt } });
      drawHandover(ctx, p.road, ctx.now, decideAt);
      ctx.blockers.set(p.road, [...ctx.blockersOf(p.road).filter((b) => !b.code.startsWith('roads.handover')), { code: 'roads.handoverPending', severity: 'info', params: { road: road.label, authority: partyLabel(ctx, law.authority), date: ctx.calendar.format(decideAt, 'day') } }]);
      ctx.log('info', `${road.label} is offered to ${partyLabel(ctx, law.authority)} for dedication and handover (${law.rule}); it decides by ${ctx.calendar.format(decideAt, 'day')}.`, [p.road]);
      return { decideAt };
    }),
    'roads.maintain': command(s.object({ road: s.ref('road'), intervention: s.string(), sections: s.array(s.int({ min: 0 })).optional() }), (ctx, p) => {
      mustHoldRoad(ctx, p.road);
      const road = ctx.require('Road', p.road);
      if (road.status !== 'open') ctx.reject('roads.notOpen');
      const iv = ctx.data('roadInterventions')[p.intervention];
      if (!iv) ctx.reject('roads.unknownIntervention', { intervention: p.intervention });
      const cls = ctx.data('roadClasses')[road.classId]!;
      if (iv!.surface !== cls.surface) ctx.reject('roads.wrongSurface', { intervention: iv!.label, surface: iv!.surface });
      const sections = p.sections ?? road.design.sections.map((s) => s.index);
      for (const i of sections) if (!road.design.sections[i]) ctx.reject('roads.unknownSection', { section: i, count: road.design.sections.length });
      // (a class may do it its own way: a path raked by hand, not graded; gravel laid by hand is drawn from the road's yard, as when it was built)
      const activity = cls.activities?.[p.intervention] ?? iv!.activity;
      const act = ctx.port('production').activity(activity);
      const wearing = cls.layers.find((l) => l.kind === 'unboundSurface');
      const drawn = iv!.basis === 'surfaceLayerVolume' && wearing && !Object.keys(act.materials).length && !act.directSupply ? { consumes: { [wearing.material]: wearing.compactedDensity.value }, store: road.stores.site } : {};
      const packages: PackageSpec[] = sections.map((i) => {
        const sec = road.design.sections[i]!;
        return {
          key: `s${i}`,
          activity,
          ...drawn,
          label: `${iv!.label} km ${(sec.s0 / 1000).toFixed(3)}–${(sec.s1 / 1000).toFixed(3)}`,
          quantity: interventionQuantity(ctx, p.road, road, i, p.intervention),
          pos: sec.mid,
          path: sec.path,
          params: { layerThickness: iv!.thickness?.value ?? 0.04, width: cls.carriageway.value, density: iv!.density?.value ?? 2.4, looseDensity: (iv!.density?.value ?? 2.4) / 1.3 },
          data: { road: p.road, section: i, intervention: p.intervention },
        };
      });
      const r = ctx.command('production.createProject', { label: `${iv!.label}: ${road.label}`, owner: 'roads', ref: p.road, priority: 3, site: road.design.alignment[0]!, packages });
      if (!r.ok) ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
      // what the last survey says the work can gain (what we know, not the road's truth): little, said so
      const survey = ctx.get('RoadInspection', p.road);
      if (survey) {
        const det = ctx.data('roadSettings').deterioration;
        const e = iv!.effect;
        const floor = cls.surface === 'gravel' ? det.unpavedRiMin.value : det.initialIri.value;
        const wearing = (cls.layers.find((l) => l.kind === 'unboundSurface')?.thickness?.value ?? 0) * 1000;
        const little = sections.filter((i) => {
          const sv = survey.sections[i];
          if (!sv) return false;
          // (gravel against the class's wearing course: what the survey measured is short of it; a surface renewed counts where it is worn)
          const gains = (e.iriFactor !== undefined && sv.iri - Math.max(floor, sv.iri * e.iriFactor) > SMOOTHER) || (e.iriSet !== undefined && sv.iri - e.iriSet.value > SMOOTHER) || (e.cracks !== undefined && sv.cracks > e.cracks) || (e.potholes !== undefined && sv.potholes > e.potholes) || (Boolean(e.laysGravel) && sv.gravel < wearing * 0.9) || (e.rutFactor !== undefined && sv.rut > RUTTED);
          return !gains;
        });
        if (little.length) ctx.log('warn', `${iv!.label} on ${road.label}: the survey of ${ctx.calendar.format(survey.at, 'day')} found ${little.length === sections.length ? 'every section' : `${little.length} of the ${sections.length} sections`} with little for it to mend (roughness, cracks or potholes already at what it leaves): the work may change little there.`, [p.road]);
      }
      return r.ok ? r.value.project : '';
    }),
  },
  on: {
    'production.packageCompleted': (ctx, e) => {
      if (e.owner !== 'roads') return;
      const d = e.data as PackageData | undefined;
      if (!d?.road) return;
      const road = ctx.get('Road', d.road);
      if (!road) return;
      if (d.inspection) {
        const cond = ctx.get('RoadCondition', d.road);
        if (cond) {
          const insp = inspectionFrom(cond, ctx.now);
          ctx.set('RoadInspection', d.road, insp);
          ctx.emit('roads.inspected', { road: d.road, worst: insp.worst });
          ctx.log(insp.worst >= 4.5 ? 'warn' : 'info', `Condition survey ${road.label}: worst grade ${insp.worst.toFixed(1)}, mean ${insp.mean.toFixed(1)} (ZEB)`, [d.road]);
        }
        return;
      }
      if (d.intervention !== undefined && d.section !== undefined) {
        const cond = ctx.get('RoadCondition', d.road);
        const iv = ctx.data('roadInterventions')[d.intervention];
        if (cond && iv) {
          const settings = ctx.data('roadSettings');
          const sections = cond.sections.map((sc, i) => (i === d.section ? applyIntervention(sc, iv, settings) : sc));
          ctx.set('RoadCondition', d.road, { ...cond, sections });
        }
        return;
      }
      if (d.section === undefined || !d.stage) return;
      if (road.status !== 'construction') return;
      const key = String(d.section);
      const stages = { ...road.stages, [key]: [...(road.stages[key] ?? []), d.stage] };
      ctx.patch('Road', d.road, { stages });
    },
    'production.projectCancelled': (ctx, e) => {
      if (e.owner !== 'roads' || !e.ref) return;
      if (ctx.get('Road', e.ref)?.project === e.project) abandonRoad(ctx, e.ref);
    },
    'production.projectCompleted': (ctx, e) => {
      if (e.owner !== 'roads' || !e.ref) return;
      const road = ctx.get('Road', e.ref);
      if (!road || road.status !== 'construction' || road.project !== e.project) return;
      const cls = ctx.data('roadClasses')[road.classId]!;
      const settings = ctx.data('roadSettings');
      ctx.patch('Road', e.ref, { status: 'open', openedAt: ctx.now });
      placeLayers(ctx, e.ref, road, cls);
      ctx.command('network.updateEdges', { edges: edgesOf(ctx, e.ref), patch: { open: true, speedFactor: 1 } });
      // how well the riding surface was built: the formation and the pavement layers (not the survey, felling or culverts)
      const ride = new Set(['subgrade', ...cls.layers.map((l) => l.id)]);
      const workmanship = ctx.port('production').projectWorkmanship(e.project, (d) => ride.has((d as { stage?: string } | undefined)?.stage ?? '')) ?? 1;
      const cond = initialCondition(cls, road.design, settings, ctx.now, workmanship);
      ctx.set('RoadCondition', e.ref, cond);
      ctx.set('RoadInspection', e.ref, inspectionFrom(cond, ctx.now));
      // surplus soil stays on its stockpile until the player decides (dispose, or reuse elsewhere)
      const hold = ctx.port('holdings');
      const surplus = [settings.materials.spoil, settings.materials.fill, settings.materials.topsoil].reduce((acc, m) => acc + hold.stock(road.stores.soil, m) + hold.stock(road.stores.topsoil, m), 0);
      if (surplus > 1) ctx.log('info', `${road.label}: ${Math.round(surplus)} t of surplus soil remain on the stockpiles — dispose of them or reuse them.`, [road.stores.soil, road.stores.topsoil]);
      const wood = road.stores.wood;
      const logs = wood ? hold.stock(wood, settings.materials.logs) : 0;
      if (wood && logs > 0.1) ctx.log('info', `${road.label}: ${logs.toFixed(1)} t of logs and ${hold.stock(wood, settings.materials.brash).toFixed(1)} t of brash from the felling lie on their heap.`, [wood]);
      ctx.emit('roads.opened', { road: e.ref });
      ctx.log('success', `${road.label} is open to traffic (${(road.design.length / 1000).toFixed(2)} km ${cls.label})`, [e.ref]);
      const joined = joinedBy(ctx, ctx.require('Road', e.ref));
      if (joined !== 'open') ctx.log('warn', `${road.label} is open, but no open way joins it to a way out${joined === 'planned' ? ' yet (one is being built)' : ''}: nothing reaches it by road.`, [e.ref]);
    },
  },
  timers: {
    // the public body decides on a road offered to it: of a class it takes, in condition, joined to the network
    handoverDecided(ctx, payload: { road: EntityId; at?: number }) {
      // (a fork drew the day again: the earlier draw is not the world's any more)
      if (payload.at !== undefined && ctx.state('roads').handover[payload.road] !== payload.at) return;
      const { [payload.road]: _done, ...left } = ctx.state('roads').handover;
      ctx.setState('roads', { handover: left });
      const road = ctx.get('Road', payload.road);
      const law = ctx.hasData('roadDedication') ? ctx.data('roadDedication') : undefined;
      if (!road?.handover || !law) return;
      const { handover: _h, ...rest } = road;
      const others = ctx.blockersOf(payload.road).filter((b) => !b.code.startsWith('roads.handover'));
      const why: string[] = [];
      if (road.status !== 'open') why.push('it is not in service');
      if (!law.classes.includes(road.classId)) why.push(`it takes streets of the classes ${law.classes.map((c) => ctx.data('roadClasses')[c]?.label ?? c).join(', ')}, not a ${(ctx.data('roadClasses')[road.classId]?.label ?? road.classId).toLowerCase()}`);
      // (its own survey at the handover: the condition as it is)
      const cond = ctx.get('RoadCondition', payload.road);
      const poor = (cond?.sections ?? []).map((x, i) => ({ i, g: x.grade })).filter((x) => x.g > law.worstGrade.value + 1e-9);
      if (poor.length) why.push(`${poor.length === cond!.sections.length ? 'every section' : `${poor.length} of its ${cond!.sections.length} sections`} graded worse than ${law.worstGrade.value} (worst ${Math.max(...poor.map((x) => x.g)).toFixed(1)}): to be mended first`);
      // (joined as the network is now: open ways lead from it to a public one: a way not built by a player, or the municipality's)
      if (!joinedToPublic(ctx, road, law.authority)) why.push('no open way leads from it to a public road');
      const authority = partyLabel(ctx, law.authority);
      if (why.length) {
        ctx.set('Road', payload.road, rest);
        // (what can be mended is a way on: a survey to see what, and the offer again; a road of another class is not taken)
        const mendable = poor.length > 0 && law.classes.includes(road.classId) && road.status === 'open';
        const remedies = mendable ? [{ label: `Have a condition survey of ${road.label} made`, command: { type: 'roads.inspect', payload: { road: payload.road } } }, { label: `Offer ${road.label} again, once mended`, command: { type: 'roads.handOver', payload: { road: payload.road } } }] : [];
        ctx.blockers.set(payload.road, [...others, { code: 'roads.handoverDeclined', severity: 'warn', params: { authority, road: road.label, why: why.join('; ') }, remedies }]);
        ctx.log('warn', `${authority} does not take ${road.label} over: ${why.join('; ')}.`, [payload.road]);
        return;
      }
      // dedicated to public use and handed over: theirs to keep from now (it was never on our books)
      ctx.set('Road', payload.road, { ...rest, holder: law.authority });
      ctx.blockers.set(payload.road, others);
      ctx.emit('roads.handedOver', { road: payload.road, from: road.holder, to: law.authority });
      ctx.log('success', `${road.label} is dedicated to public use and handed over to ${authority} (${law.rule}): theirs to keep from now.`, [payload.road]);
    },
  },
  systems: [
    {
      id: 'deterioration',
      every: DAY,
      offset: HOUR / 2,
      phase: 'physical',
      run: (ctx: WriteCtx) => {
        // nothing has aged before the world began, and only open roads age
        if (ctx.now < DAY || ![...ctx.all('Road')].some(([, r]) => r.status === 'open')) return;
        const settings = ctx.data('roadSettings');
        const weather = ctx.port('weather');
        const yesterday = weather.day(ctx.now - DAY);
        const mmp = weather.normals(ctx.calendar.at(ctx.now).month).precip / 1000;
        for (const [id, road] of ctx.all('Road')) {
          if (road.status !== 'open') continue;
          const cond = ctx.get('RoadCondition', id);
          if (!cond) continue;
          const tr = roadEdgesTraffic(ctx, id);
          const exposure = { vehicles: tr.vehicles, esalPerDay: tr.esalPerDay, precip: yesterday.precip, mmp, freezeThaw: yesterday.tMin < 0 && yesterday.tMax > 0, gradient: meanGradient(road.design) };
          const days = (cond.daysInService ?? 0) + 1;
          const meanEsal = (cond.meanEsalPerDay ?? 0) + (tr.esalPerDay - (cond.meanEsalPerDay ?? 0)) / days;
          const sections = cond.sections.map((sc) => deteriorateDay(sc, cond.snc, { ...exposure, meanEsalPerDay: meanEsal }, settings));
          ctx.set('RoadCondition', id, { ...cond, sections, lastUpdate: ctx.now, daysInService: days, meanEsalPerDay: meanEsal });
          const meanIri = sections.reduce((a, sc) => a + sc.iri * (sc.s1 - sc.s0), 0) / Math.max(1, road.design.length);
          const sf = Math.round(speedFactor(meanIri) * 100) / 100;
          const edges = edgesOf(ctx, id);
          const edge = edges[0] ? ctx.get('NetEdge', edges[0]) : undefined;
          if (edge && Math.abs(edge.speedFactor - sf) >= 0.03) ctx.command('network.updateEdges', { edges, patch: { speedFactor: sf } });
        }
      },
    },
  ],
  contributes: {
    rulebook: roadClassRulebook,
    // a road under construction is firm ground for the site's traffic where its formation is accepted (compacted and
    // proven by the plate test: what construction traffic drives on) or a layer of its gravel is laid (S3)
    firmGround: () => ({ at: (read: ReadCtx, x: number, z: number) => within(roadGround(read).firm, x, z), revision: (read: ReadCtx) => read.revision('Road') }),
    // and the corridor felled for it: no stand there for the site's traffic, whatever stands at its edges (S3)
    clearedGround: () => ({ at: (read: ReadCtx, x: number, z: number) => within(roadGround(read).cleared, x, z), revision: (read: ReadCtx) => read.revision('Road') }),
  },
  /** a fork does not know when the authority decides: every pending handover is drawn again */
  branch(ctx) {
    for (const id of Object.keys(ctx.state('roads').handover).sort()) {
      const road = ctx.get('Road', id);
      if (road?.handover) drawHandover(ctx, id, ctx.now, road.handover.decideAt);
    }
  },
  ports: {
    roads: (read) => ({
      classes: () => read.data('roadClasses'),
      design: (points, classId) => designRoad(read, points, classId),
      progress: (road) => sectionProgress(read, road),
    }),
  },
  projections: {
    'roads.list': {
      label: 'Roads',
      compute: (read) =>
        [...read.all('Road')].map(([id, r]) => {
          const insp = read.get('RoadInspection', id);
          const cls = read.data('roadClasses')[r.classId]!;
          return {
            id,
            label: r.label,
            classId: r.classId,
            classLabel: cls.label,
            surface: cls.surface,
            status: r.status,
            length: r.design.length,
            estimate: r.design.estimate,
            project: r.project,
            inspectedAt: insp?.at,
            worstGrade: insp?.worst,
            meanGrade: insp?.mean,
            // whose it is (a road handed over is the municipality's), and an offer pending
            holder: r.holder,
            holderLabel: partyLabel(read, r.holder),
            ...(r.handover ? { handover: { offered: r.handover.at, decides: r.handover.decideAt } } : {}),
            // joined to the ways out by open ways, only by ways being built, or not at all
            ...(r.status === 'construction' || r.status === 'open' ? { joined: joinedBy(read, r) } : {}),
          };
        }),
    },
    'roads.preview': {
      label: 'Road design preview',
      compute: (read, args) => {
        const pts = (args.points as Vec2[]) ?? [];
        const classId = String(args.classId ?? '');
        if (!read.data('roadClasses')[classId]) return null;
        // a straight road has no smallest radius: null, not Infinity (which no reader of JSON can use)
        // (args.party: whose roads it may be laid over; none said: any not a public body's)
        const d = designRoad(read, pts, classId, (h) => (typeof args.party === 'string' ? h === args.party : read.get('Party', h)?.kind !== 'public'), typeof args.party === 'string' ? args.party : undefined);
        return Number.isFinite(d.minRadius) ? d : { ...d, minRadius: null };
      },
    },
    'roads.progress': { compute: (read, args) => sectionProgress(read, String(args.road ?? '')) },
  },
});

export { gradeOf };
