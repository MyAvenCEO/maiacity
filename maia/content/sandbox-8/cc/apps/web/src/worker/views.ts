/**
 * Read models for the client, built from the runtime's read context. Pure functions of state —
 * the worker decides when to send them.
 */
import type { Goal } from '../../../../packages/siting/src/index.ts';
import { DAY, type EntityId, type ReadCtx, type Runtime } from '../../../../packages/kernel/src/index.ts';
import { fbm2, type Vec2 } from '../../../../packages/geo/src/index.ts';
import { accessesOf, type Route } from '../../../../packages/network/src/index.ts';
import type { BuildingDesign } from '../../../../packages/buildings/src/index.ts';
import type { Structure } from '../../../../packages/structures/src/index.ts';
import { workFront } from '../../../../packages/production/src/index.ts';
import { expectedDaysToSell } from '../../../../packages/equipment/src/index.ts';
import { seatParty } from '../../../../packages/settlement/src/index.ts';
import { BUILDING_STAGES, type BuildingStageView, type BuildingStatic } from '../protocol.ts';
import type { Frame, MachineView, OverlayLayer, PersonView, RoadStatic, StaticWorld, StoreView, WorldInfo, TreeArrays, WorkfrontView, EdgeView, InspectResult } from '../protocol.ts';

const MACHINE_COLORS: Record<string, string> = {
  excavator: '#f2b705',
  wheeledExcavator: '#f2b705',
  miniExcavator: '#f2b705',
  wheelLoader: '#f2a900',
  dozer: '#e8a317',
  grader: '#f5c400',
  soilRoller: '#e4572e',
  tandemRoller: '#e4572e',
  tipper: '#d9d9d9',
  paver: '#f2a900',
  surveyKit: '#ffffff',
  chainsaw: '#ff7f11',
  lowLoader: '#3d5a80',
  waterTruck: '#4f9dde',
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function groundColors(read: ReadCtx): Uint8Array {
  const terrain = read.port('terrain');
  const g = terrain.grid;
  const h = terrain.heights();
  const out = new Uint8Array(g.nx * g.nz * 3);
  const grass: [number, number, number] = [96, 126, 58];
  const meadow: [number, number, number] = [122, 140, 70];
  const cache = new Map<string, [number, number, number]>();
  const soilRgb = (id: string) => {
    let c = cache.get(id);
    if (!c) {
      c = hexToRgb(terrain.soilClass(id).color);
      cache.set(id, c);
    }
    return c;
  };
  for (let j = 0; j < g.nz; j += 1) {
    for (let i = 0; i < g.nx; i += 1) {
      const k = j * g.nx + i;
      const x = g.x0 + i * g.cell;
      const z = g.z0 + j * g.cell;
      const h0 = terrain.originalHeightAt(x, z);
      const dh = h[k]! - h0;
      let c: [number, number, number];
      // (dug or laid: what is at the surface now, by the strata the terrain keeps)
      if (Math.abs(dh) > 0.05) c = soilRgb(terrain.soilClassAtDepth(x, z, 0.01));
      else {
        const slope = terrain.slopeAt(x, z);
        // organic meadow variation (no periodic stripes): two scales of fBm noise
        const noise = Math.min(1, Math.max(0, 0.5 + 0.45 * fbm2(7, x / 140, z / 140, { octaves: 4 }) + 0.15 * fbm2(19, x / 25, z / 25, { octaves: 2 })));
        const t = Math.min(1, noise * 0.8 + slope * 2);
        c = [grass[0] + (meadow[0] - grass[0]) * t, grass[1] + (meadow[1] - grass[1]) * t, grass[2] + (meadow[2] - grass[2]) * t];
        if (slope > 0.35) {
          const r = soilRgb(terrain.soilClassAtDepth(x, z, 0.5));
          const f = Math.min(1, (slope - 0.35) * 2);
          c = [c[0] * (1 - f) + r[0] * f, c[1] * (1 - f) + r[1] * f, c[2] * (1 - f) + r[2] * f];
        }
      }
      if (terrain.waterDepthAt(x, z) > 0.02) c = [92, 84, 66];
      out[k * 3] = c[0];
      out[k * 3 + 1] = c[1];
      out[k * 3 + 2] = c[2];
    }
  }
  return out;
}

export function treeArrays(read: ReadCtx): TreeArrays {
  const veg = read.port('vegetation');
  const trees = veg.trees();
  const data = new Float32Array(trees.length * 4);
  const kind = new Uint8Array(trees.length);
  const species = new Uint8Array(trees.length);
  const speciesIds: string[] = [];
  const speciesColors: string[] = [];
  trees.forEach((t, i) => {
    data[i * 4] = t.x;
    data[i * 4 + 1] = t.z;
    data[i * 4 + 2] = t.height;
    data[i * 4 + 3] = t.crownRadius;
    const sp = veg.species(t.species);
    kind[i] = sp.kind === 'conifer' ? 1 : 0;
    let idx = speciesIds.indexOf(t.species);
    if (idx < 0) {
      idx = speciesIds.length;
      speciesIds.push(t.species);
      speciesColors.push(sp.color);
    }
    species[i] = idx;
  });
  return { revision: veg.revision(), data, kind, species, speciesColors };
}

export function edgeViews(read: ReadCtx): EdgeView[] {
  const terrain = read.port('terrain');
  const out: EdgeView[] = [];
  for (const [id, e] of read.port('routing').edges()) {
    const v: EdgeView = { id, points: e.geometry.map((p) => [p[0], p[1]] as Vec2), heights: e.geometry.map((p) => terrain.heightAt(p[0], p[1])), width: e.width, surface: e.surface, open: e.open };
    if (e.asset) v.asset = e.asset;
    if (e.label) v.label = e.label;
    out.push(v);
  }
  return out;
}

export function roadStatics(read: ReadCtx): RoadStatic[] {
  const classes = read.data('roadClasses');
  const out: RoadStatic[] = [];
  for (const [id, r] of read.all('Road')) {
    if (r.status === 'cancelled') continue;
    const cls = classes[r.classId]!;
    out.push({
      id,
      label: r.label,
      classId: r.classId,
      classLabel: cls.label,
      surface: cls.surface,
      carriageway: cls.carriageway.value,
      shoulder: cls.shoulder.value,
      status: r.status,
      color: cls.color,
      design: { alignment: r.design.alignment, stations: r.design.stations, sections: r.design.sections, length: r.design.length, stockpile: r.design.stockpile, siteStore: r.design.siteStore },
    });
  }
  return out;
}

export interface Revisions {
  heights: number;
  trees: number;
  edges: number;
  roads: number;
  buildings: number;
}

/** the structures as the 3D view draws them: a building from its design, camp structures by their template and actual plan dimensions */
export function buildingStatics(read: ReadCtx): BuildingStatic[] {
  const types = read.data('buildingTypes');
  const templates = read.port('structures').templates();
  const terrain = read.port('terrain');
  const out: BuildingStatic[] = [];
  for (const [id, st] of read.all('Structure')) {
    if (st.status === 'cancelled' || st.status === 'struck' || st.status === 'demolished') continue;
    const p = st.plan;
    const a = (p.rotation * Math.PI) / 180;
    const at = (u: number, v: number): Vec2 => [p.pos[0] + u * Math.cos(a) - v * Math.sin(a), p.pos[1] + u * Math.sin(a) + v * Math.cos(a)];
    const common = { id, label: st.label, type: st.template, typeLabel: templates[st.template]?.label ?? st.template, status: st.status, center: [p.pos[0], p.pos[1]] as Vec2, rotation: p.rotation };
    if (p.planner === 'building') {
      const t = types[st.template]!;
      const g = (p.detail as BuildingDesign).geometry;
      out.push({ ...common, corners: g.corners.map((c) => [c[0], c[1]] as Vec2), length: g.length, width: g.width, floors: g.floors, storeyHeight: g.storeyHeight, height: g.height, roofStyle: t.roofStyle, roofPitch: g.roofPitch, platform: g.platform, wallColor: t.wallColor, roofColor: t.roofColor });
      continue;
    }
    // a tent: low walls under a steep ridge; a wall: a block of brick
    const tent = p.physics.form === 'tent';
    const eaves = tent ? 0.3 : p.height;
    const corners = [at(-p.length / 2, -p.width / 2), at(p.length / 2, -p.width / 2), at(p.length / 2, p.width / 2), at(-p.length / 2, p.width / 2)];
    out.push({ ...common, corners, length: p.length, width: p.width, floors: 1, storeyHeight: eaves, height: p.height, roofStyle: tent ? 'gable' : 'flat', roofPitch: tent ? (Math.atan2(p.height - eaves, p.width / 2) * 180) / Math.PI : 0, platform: terrain.heightAt(p.pos[0], p.pos[1]), wallColor: tent ? '#4f7a3a' : '#b5532f', roofColor: tent ? '#5f8a46' : '#b5532f', form: p.physics.form, ...(st.spec.on ? { on: st.spec.on } : {}) });
  }
  return out;
}

/** completed construction stages per structure from its finished elements and the active package of its project */
export function buildingStages(read: ReadCtx): Record<string, BuildingStageView> {
  const out: Record<string, BuildingStageView> = {};
  const prod = read.port('production');
  for (const [id, st] of read.all('Structure')) {
    if (st.status === 'cancelled' || st.status === 'struck' || st.status === 'demolished') continue;
    if (st.status !== 'building') {
      out[id] = { stages: [...BUILDING_STAGES], elements: [...st.done] };
      continue;
    }
    const done = new Set(st.done);
    const project = st.project ? read.get('Project', st.project) : undefined;
    // packages per stage (platform earthworks count as 'site')
    const stageOf = (element: string) => {
      const s = st.plan.elements.find((e) => e.id === element)?.stage;
      return s === 'platform' ? 'site' : s;
    };
    const byStage = new Map<string, { total: number; done: number }>();
    let active: BuildingStageView['active'];
    for (const pkgId of project?.packages ?? []) {
      const pkg = read.get('WorkPackage', pkgId);
      const stage = stageOf((pkg?.data as { element?: string } | undefined)?.element ?? '');
      if (!pkg || !stage || pkg.status === 'cancelled') continue;
      const e = byStage.get(stage) ?? { total: 0, done: 0 };
      e.total += 1;
      if (pkg.status === 'done' || pkg.status === 'hold') e.done += 1;
      byStage.set(stage, e);
      if (pkg.status === 'active') {
        const progress = prod.progress(pkgId);
        if (!active || progress > active.progress) active = { stage, progress };
      }
    }
    const stages: string[] = [];
    BUILDING_STAGES.forEach((s) => {
      const pk = byStage.get(s);
      const els = st.plan.elements.filter((e) => e.part && e.stage === s);
      const complete = pk ? pk.done === pk.total : els.length > 0 && els.every((e) => done.has(e.id));
      if (complete) stages.push(s);
    });
    const v: BuildingStageView = { stages, elements: [...st.done] };
    if (active) v.active = active;
    out[id] = v;
  }
  return out;
}

export function revisions(read: ReadCtx): Revisions {
  return { heights: read.port('terrain').revision(), trees: read.port('vegetation').revision(), edges: read.revision('NetEdge') + read.revision('NetNode'), roads: read.revision('Road'), buildings: read.revision('Structure') };
}

export function buildStatic(rt: Runtime, world: WorldInfo, worlds: StaticWorld['worlds'] = []): StaticWorld {
  const read = rt.read;
  const terrain = read.port('terrain');
  const rev = revisions(read);
  const weather = read.port('weather');
  return {
    world,
    worlds,
    grid: terrain.grid,
    heights: new Float32Array(terrain.heights()),
    heightsRevision: rev.heights,
    groundColors: groundColors(read),
    water: terrain.waterBodies(),
    trees: treeArrays(read),
    edges: edgeViews(read),
    edgesRevision: rev.edges,
    roads: roadStatics(read),
    roadsRevision: rev.roads,
    buildings: buildingStatics(read),
    buildingsRevision: rev.buildings,
    // the building planner's templates (the building tool draws houses and halls)
    buildingTypes: Object.entries(read.data('buildingTypes')).map(([id, t]) => ({ id, label: t.label, description: t.description, category: t.category, length: t.length.value, width: t.width.value, floors: t.floors })),
    location: { name: weather.location.name, lat: weather.location.lat, lon: weather.location.lon },
    accesses: accessesOf(read).map((a) => ({ point: a.point, inward: a.inward, label: a.label, mode: a.mode })),
    siting: { criteria: read.port('siting').criteria().map((c) => ({ id: c.id, label: c.label, unit: c.unit, description: c.description, knowledge: c.knowledge })), goals: read.port('siting').goals() },
    roadClasses: Object.entries(read.data('roadClasses')).map(([id, c]) => ({
      id,
      label: c.label,
      description: c.description,
      standard: c.standard,
      surface: c.surface,
      carriageway: c.carriageway.value,
      color: c.color,
      shoulder: c.shoulder.value,
      minRadius: c.minRadius.value,
      maxGrade: c.maxGrade.value,
      designSpeed: c.designSpeed.value,
      ...(c.loadClass ? { loadClass: c.loadClass } : {}),
      layers: c.layers.map((l) => ({ id: l.id, label: l.label, kind: l.kind, material: l.material, ...(l.thickness ? { thickness: l.thickness.value } : {}) })),
    })),
    interventions: Object.entries(read.data('roadInterventions')).map(([id, iv]) => ({ id, label: iv.label, surface: iv.surface, description: iv.description, basis: iv.basis })),
    jobs: Object.entries(read.data('jobs')).map(([id, j]) => ({ id, label: j.label, wage: j.hourlyWage.value, applicantDays: j.market.meanApplicantInterval.value, noticeDays: j.market.noticePeriod.value, advertCost: j.market.advertCost.value, qualifications: [...j.qualifications] })),
    machineModels: Object.entries(read.data('machineModels')).map(([id, m]) => ({
      id,
      label: m.label,
      class: m.class,
      rentalPerDay: m.rentalPerDay?.value ?? 0,
      purchasePrice: m.purchasePrice.value,
      enginePower: m.engine?.power.value ?? 0,
      operatingWeight: m.operatingWeight.value,
      fuelUse: m.engine?.fuelUse.value ?? 0,
    })),
    materials: Object.entries(read.data('materials')).map(([id, m]) => {
      const v: StaticWorld['materials'][number] = { id, label: m.label, unit: m.unit, category: m.category, density: m.density.value };
      if (m.color) v.color = m.color;
      return v;
    }),
    activities: Object.entries(read.data('activities')).map(([id, a]) => ({ id, label: a.label, unit: a.unit, category: a.category, ...(a.color ? { color: a.color } : {}) })),
    qualifications: Object.entries(read.data('qualifications')).map(([id, q]) => ({ id, label: q.label })),
    roadSettings: { connectDistance: read.data('roadSettings').connectDistance.value, frostZone: read.data('roadSettings').frostZone },
    depotPos: read.state('settlement').depotPos,
    ...(read.state('settlement').depot ? { depotStore: read.state('settlement').depot! } : {}),
    calendar: { epochDay: read.calendar.epochDay, locale: read.calendar.locale },
  };
}

/** Changed parts of the static world since `last` (mutates `last`). */
export function staticPatch(rt: Runtime, last: Revisions): Partial<StaticWorld> | null {
  const read = rt.read;
  const now = revisions(read);
  const patch: Partial<StaticWorld> = {};
  if (now.heights !== last.heights) {
    patch.heights = new Float32Array(read.port('terrain').heights());
    patch.heightsRevision = now.heights;
    patch.groundColors = groundColors(read);
  }
  if (now.trees !== last.trees) patch.trees = treeArrays(read);
  if (now.edges !== last.edges || now.heights !== last.heights) {
    patch.edges = edgeViews(read);
    patch.edgesRevision = now.edges;
  }
  if (now.buildings !== last.buildings) {
    patch.buildings = buildingStatics(read);
    patch.buildingsRevision = now.buildings;
  }
  if (now.roads !== last.roads) {
    patch.roads = roadStatics(read);
    patch.roadsRevision = now.roads;
  }
  Object.assign(last, now);
  return Object.keys(patch).length ? patch : null;
}

// ------------------------------------------------------------------ frames

const haulRoutes = new Map<string, { key: string; route: Route | null }>();

function haulRoute(read: ReadCtx, pkg: EntityId, from: Vec2, to: Vec2, profile: string): Route | null {
  const key = `${Math.round(from[0] / 10)},${Math.round(from[1] / 10)}→${Math.round(to[0])},${Math.round(to[1])}:${profile}:${read.revision('NetEdge')}`;
  const hit = haulRoutes.get(pkg);
  if (hit && hit.key === key) return hit.route;
  const route = read.port('routing').route(from, to, profile, { maxOffroad: 5000, openOnly: true });
  haulRoutes.set(pkg, { key, route });
  return route;
}

export function buildFrame(rt: Runtime, speed: number): Frame {
  const read = rt.read;
  const t = read.now;
  const eq = read.port('equipment');
  const wf = read.port('workforce');
  const moves = read.port('moves');
  const inv = read.port('holdings');
  const settlement = read.state('settlement');
  const depot = settlement.depotPos;
  const party = seatParty(read);

  // work fronts
  const workfronts: WorkfrontView[] = [];
  const fronts = new Map<EntityId, Vec2>();
  const acts = read.data('activities');
  for (const [id, pkg] of read.all('WorkPackage')) {
    if (pkg.status !== 'active' && pkg.status !== 'hold' && !(pkg.status === 'ready' && read.blockersOf(id).length)) continue;
    const proc = pkg.process ? read.process(pkg.process) : undefined;
    const progress = pkg.status === 'hold' ? 1 : proc ? proc.done / proc.total : 0;
    const front = workFront(pkg, progress);
    fronts.set(id, front);
    const blockers = read.blockersOf(id).filter((b) => b.severity !== 'info');
    const data = pkg.data as { road?: string; section?: number } | undefined;
    const v: WorkfrontView = {
      id,
      project: pkg.project,
      label: pkg.label,
      activity: pkg.activity,
      x: front[0],
      z: front[1],
      progress,
      rate: proc?.rate ?? 0,
      unit: pkg.unit,
      status: pkg.status,
      blocked: blockers.some((b) => b.severity === 'block'),
      color: acts[pkg.activity]?.color ?? '#ffffff',
    };
    if (blockers[0]) v.blocker = read.formatBlocker(blockers[0]);
    if (data?.road) v.road = data.road;
    if (data?.section !== undefined) v.section = data.section;
    workfronts.push(v);
  }

  // machines
  const machines: MachineView[] = [];
  const perPkgIndex = new Map<string, number>();
  for (const [id, m] of read.all('Machine')) {
    // (beyond the map: at the dealer's, in town with its rider: not drawn on it, r36)
    if (moves.whereAt(id, t) === undefined) continue;
    const model = eq.model(m.model);
    let pos = eq.positionAt(id, t);
    let heading = 0;
    let working = false;
    let haul: MachineView['haul'];
    const a = read.get('Assignment', id);
    const pkgId = a?.package;
    if (m.status === 'travelling' && m.move) {
      const p = moves.positionAt(m.move, t);
      if (p) {
        pos = p.pos;
        heading = p.heading;
      }
    } else if (pkgId && fronts.has(pkgId)) {
      const pkg = read.get('WorkPackage', pkgId)!;
      const front = fronts.get(pkgId)!;
      const idx = perPkgIndex.get(pkgId) ?? 0;
      perPkgIndex.set(pkgId, idx + 1);
      working = pkg.rate > 0;
      const isTruck = model.class === 'tipper';
      if (isTruck && pkg.haulTo && working) {
        const route = haulRoute(read, pkgId, front, pkg.haulTo, model.transport?.vehicleProfile ?? 'van');
        if (route && route.duration > 0) {
          // the tipper's own loaded pace (its carrier class), as the haul cycle reckons it
          const pace = read.port('routing').profile(model.transport?.vehicleProfile ?? 'van').loadedSpeed?.value ?? 1;
          const cycle = route.duration * (1 + 1 / pace) + 240;
          const trucks = pkg.machines.filter((x) => eq.modelOf(x).class === 'tipper');
          const k = Math.max(0, trucks.indexOf(id));
          const tc = (t + (k * cycle) / Math.max(1, trucks.length)) % cycle;
          const loadT = 120;
          const outT = route.duration / pace;
          if (tc < loadT) {
            pos = front;
            haul = { phase: tc / cycle, loaded: false };
          } else if (tc < loadT + outT) {
            const p = moves.positionOnRoute(route, (tc - loadT) * pace);
            pos = p.pos;
            heading = p.heading;
            haul = { phase: tc / cycle, loaded: true };
          } else if (tc < loadT + outT + 120) {
            pos = pkg.haulTo;
            haul = { phase: tc / cycle, loaded: true };
          } else {
            const back = Math.max(0, route.duration - (tc - loadT - outT - 120));
            const p = moves.positionOnRoute(route, back);
            pos = p.pos;
            heading = p.heading + Math.PI;
            haul = { phase: tc / cycle, loaded: false };
          }
        }
      } else {
        // spread machines around the work front along the road direction
        const ang = idx * 2.1;
        const r = 6 + idx * 4;
        pos = [front[0] + Math.cos(ang) * r, front[1] + Math.sin(ang) * r];
        heading = ang + Math.PI / 2;
      }
    }
    const v: MachineView = { id, model: m.model, label: model.label, cls: model.class, x: pos[0], z: pos[1], heading, status: m.status, working, color: model.color ?? MACHINE_COLORS[model.class] ?? '#f2b705' };
    if (haul) v.haul = haul;
    if (pkgId) v.pkg = pkgId;
    machines.push(v);
  }

  // carriers under way: suppliers' lorries, vans, low-loaders (with the machine they carry); a machine
  // under its own power draws itself
  const trips: Frame['trips'] = [];
  for (const [id, move] of moves.underway()) {
    const p = moves.positionAt(id, t);
    if (!p || p.offMap) continue;
    const carrier = move.legs[p.leg]!.carrier;
    if (carrier.unit) continue;
    trips.push({ id, profile: carrier.class, x: p.pos[0], z: p.pos[1], heading: p.heading, loaded: move.legs[p.leg]!.loaded, purpose: move.purpose, ...(p.stopped ? { stopped: p.stopped } : {}) });
  }

  // people: where the moves keep them (design/physical-state.md I2); those standing at one spot are spread a little to be seen
  const people: PersonView[] = [];
  const atSpot = new Map<string, number>();
  for (const pid of read.port('workforce').staff()) {
    const person = read.get('Person', pid);
    const emp = read.get('Employment', pid);
    const helper = read.get('Helper', pid);
    if (!person) continue;
    const present = wf.present(pid);
    const a = read.get('Assignment', pid);
    // each person keeps the working time of whoever they work for (a firm's shifts, a household's own day)
    const theirShift = wf.onShift(t, wf.worksFor(pid) ?? party);
    // (off their working time on the map they are there all the same: at their tent, by the fire, asleep)
    let state: PersonView['state'] = !present ? 'absent' : !theirShift ? 'resting' : a ? 'working' : 'idle';
    const at = moves.whereAt(pid, t);
    const on = moves.placeOf(pid)?.on;
    const moving = on !== undefined && Boolean(read.get('Move', on)?.legs.some((l) => l.depart <= t && t < l.arrive));
    let pos: Vec2 = depot;
    // (beyond the map: not drawn)
    if (!at) state = state === 'absent' ? 'absent' : 'off';
    // (ill or on leave at their tent on the map: there, resting)
    else if (state === 'absent') state = 'resting';
    else if (moving) {
      pos = at;
      state = 'travelling';
    } else {
      const key = `${Math.round(at[0])},${Math.round(at[1])}`;
      const idx = atSpot.get(key) ?? 0;
      atSpot.set(key, idx + 1);
      const ang = idx * 1.3 + 0.7;
      pos = idx ? [at[0] + Math.cos(ang) * (1 + idx * 0.6), at[1] + Math.sin(ang) * (1 + idx * 0.6)] : at;
      const pkg = a ? read.get('WorkPackage', a.package) : undefined;
      if (pkg && pkg.rate <= 0) state = present && theirShift ? 'waiting' : state;
    }
    const v: PersonView = { id: pid, name: person.name, job: emp?.job ?? helper?.relation ?? 'helper', x: pos[0], z: pos[1], state };
    if (a) v.pkg = a.package;
    people.push(v);
  }

  // stores
  const stores: StoreView[] = [];
  for (const [id, st] of read.all('Store')) {
    let tonnes = 0;
    let volume = 0;
    const contents: StoreView['contents'] = [];
    let main = '';
    let mainT = 0;
    for (const [mat, qty] of Object.entries(st.contents)) {
      if (qty <= 1e-6) continue;
      const m = inv.material(mat);
      const tt = m.unit === 't' ? qty : m.unit === 'm3' ? qty * m.density.value : 0;
      tonnes += tt;
      volume += tt / Math.max(0.5, m.density.value);
      contents.push({ material: mat, label: m.label, qty, unit: m.unit, ...(tt > 0 ? { m3: tt / Math.max(0.5, m.density.value) } : {}) });
      if (tt > mainT) {
        mainT = tt;
        main = m.color ?? '#a08060';
      }
    }
    // another party's heap is seen by its size, not weighed or counted (design/physical-state.md I7)
    const own = st.holder === party;
    // (where it is now: one riding with someone or something where they are, none beyond the map; S504)
    const at = inv.where(id);
    if (at) stores.push({ id, label: st.label, kind: st.kind, x: at[0], z: at[1], tonnes: own ? tonnes : 0, volume, contents: own ? contents : [], color: main || '#a08060' });
  }

  const roadProgress: Frame['roadProgress'] = {};
  const roadGrades: Frame['roadGrades'] = {};
  const roads = read.port('roads');
  for (const [id, r] of read.all('Road')) {
    if (r.status === 'construction') roadProgress[id] = roads.progress(id);
    const insp = read.get('RoadInspection', id);
    if (insp) roadGrades[id] = insp.mean;
  }
  const hud = rt.project('settlement.hud', { party: seatParty(rt.read) }) as Frame['hud'];
  const alerts = rt.project('settlement.alerts', { party: seatParty(rt.read) }) as unknown[];
  const deaths: Frame['deaths'] = [...read.all('Person')]
    .filter(([, p]) => p.died)
    .map(([id, p]) => ({ id, name: p.name, cause: p.died!.cause, at: p.died!.at, ...(p.died!.where ? { x: p.died!.where[0], z: p.died!.where[1] } : {}) }))
    .sort((a, b) => a.at - b.at);
  return { t, speed, hud, machines, trips, people, stores, workfronts, roadProgress, roadGrades, buildingStages: buildingStages(read), log: rt.log(40), alertCount: alerts.length, deaths };
}

// ------------------------------------------------------------------ queries

/** what the seat's party may see of an entity (design/physical-state.md I7): its components as that party observes them */
export function inspect(rt: Runtime, id: string, viewer: string = seatParty(rt.read)): InspectResult | null {
  const read = rt.read;
  const meta = read.entity(id);
  if (!meta) return null;
  const blockers = read.blockersOf(id).map((b) => ({ ...b, message: read.formatBlocker(b) }));
  const components = rt.observedComponents(id, viewer);
  const processes = read.listProcesses({ subject: id });
  const details: Record<string, unknown> = {};
  if (components.Road) {
    details.progress = read.port('roads').progress(id);
    const road = components.Road as { project?: string };
    if (road.project) details.schedule = read.port('production').schedule(road.project);
  }
  if (components.Structure) {
    const b = components.Structure as Structure;
    details.typeLabel = read.port('structures').templates()[b.template]?.label ?? b.template;
    details.stages = buildingStages(read)[id] ?? { stages: [] };
    if (b.project) details.schedule = read.port('production').schedule(b.project);
    details.elements = b.plan.elements.filter((e) => e.part).map((e) => ({ id: e.id, label: e.label, stage: e.stage, serviceLife: e.life, renewal: e.renewal?.label }));
    // letting it: what it could be let for, what is offered, who has it
    if (read.hasPort('letting')) {
      const tenure = read.get('Tenure', id);
      const offered = read.get('Letting', id);
      details.letting = {
        options: read.port('letting').options(id),
        ...(offered ? { offered: { use: offered.use, ask: offered.ask, since: offered.since } } : {}),
        ...(tenure ? { lease: read.port('agreements').agreements().find((a) => a.id === tenure.agreement) } : {}),
      };
    }
  }
  // where its parts sit (decision 0014)
  if (components.Placed) details.placement = read.port('space').where(id);
  if (components.Project) details.schedule = read.port('production').schedule(id);
  if (components.WorkPackage) {
    // (another party's work is seen without its crew lists and costs: what the observe rule leaves)
    const pkg = components.WorkPackage as { project: string; crew?: string[]; machines?: string[]; front?: string };
    details.crew = (pkg.crew ?? []).map((p) => ({ id: p, name: read.get('Person', p)?.name ?? p, role: read.get('Assignment', p)?.role }));
    details.machines = (pkg.machines ?? []).map((m) => ({ id: m, label: read.port('equipment').modelOf(m).label, role: read.get('Assignment', m)?.role, status: read.get('Machine', m)?.status }));
    // the goods at its front (its holding there)
    if (pkg.front) details.staged = read.get('Store', pkg.front)?.contents ?? {};
    const wp = components.WorkPackage as { activity: string; process?: string };
    details.activityLabel = read.data('activities')[wp.activity]?.label ?? wp.activity;
    details.projectLabel = read.get('Project', pkg.project)?.label ?? pkg.project;
    details.progress = read.port('production').progress(id);
    if (wp.process) {
      const proc = read.process(wp.process);
      if (proc?.rateExplain) details.rateExplain = proc.rateExplain;
      if (proc) details.eta = proc.eta;
    }
  }
  if (components.Assignment) {
    const a = components.Assignment as { package: string; role: string };
    details.assignment = { package: a.package, role: a.role, label: read.get('WorkPackage', a.package)?.label ?? a.package };
  }
  if (components.Machine) {
    // what is in its tank, for the one who may see it (the observe rule: its holder or user)
    if ((components.Machine as { tank?: string }).tank) details.fuel = read.port('equipment').fuel(id);
    details.model = read.port('equipment').modelOf(id);
    details.hourlyCost = read.port('equipment').hourlyCost(id);
    details.hourlyCostExplain = read.port('equipment').hourlyCostExplain(id);
    // what the used-plant market would pay for one of ours, and how long a sale takes at that
    const m = components.Machine as { ownership: string; status: string; listing?: { ask: number } };
    if (m.ownership === 'owned' && m.status !== 'arriving' && read.hasPort('usedPlant')) {
      const v = read.port('usedPlant').value(id);
      details.marketValue = { value: v.value, explain: v.explain, provenance: v.provenance, expectedDays: Math.round(expectedDaysToSell(read, id, m.listing?.ask ?? v.value)) };
    }
  }
  // (another party's person, or one of ours gone: what the observe rule leaves is a name, nothing of wages or practice)
  if (components.Person && (components.Person as { certificates?: string[] }).certificates) {
    details.hourlyCost = read.port('workforce').hourlyCost(id);
    details.present = read.port('workforce').present(id);
    details.hourlyCostExplain = read.port('workforce').hourlyCostExplain(id);
    const emp = components.Employment as { job: string } | undefined;
    if (emp) details.jobLabel = read.data('jobs')[emp.job]?.label ?? emp.job;
    const person = components.Person as { certificates: string[]; experience: Record<string, number> };
    const quals = read.data('qualifications');
    const wf = read.port('workforce');
    details.qualificationLabels = person.certificates.map((q) => quals[q]?.label ?? q);
    // what they may do and how practised they are (their knack shows only in their work: rate explains)
    details.skills = [...new Set([...wf.skills(id), ...Object.keys(person.experience)])]
      .map((q) => ({ id: q, label: quals[q]?.label ?? q, hours: person.experience[q] ?? 0, level: wf.level(id, q), allowed: wf.canDo(id, q), certificate: quals[q]?.certificate ?? false }))
      .sort((a, b) => b.hours - a.hours);
    // courses on offer here that lead to certificates
    const courses = read.hasData('courses') ? read.data('courses') : undefined;
    const offers = read.hasData('courseOffers') ? read.data('courseOffers') : undefined;
    if (courses && offers) {
      const index = read.port('prices').index(read.now);
      details.courses = Object.entries(courses)
        .filter(([c]) => offers[c])
        .map(([c, k]) => {
          const no = wf.enrolBlocker(id, c);
          return { id: c, label: k.label, grants: k.grants.map((q) => quals[q]?.label ?? q), held: k.grants.every((q) => person.certificates.includes(q)), workdays: k.workdays.value, price: offers[c]!.price.value * index, leadTime: offers[c]!.leadTime.value, ...(no ? { why: read.formatBlocker({ module: 'workforce', code: no.code, severity: 'block', params: no.params }) } : {}) };
        });
    }
    const enrolment = read.get('Enrolment', id);
    if (enrolment) details.enrolment = { ...enrolment, label: courses?.[enrolment.course]?.label ?? enrolment.course };
  }
  if (components.Project) {
    const p = components.Project as { packages?: string[] };
    details.packages = (p.packages ?? []).map((x) => {
      const w = read.get('WorkPackage', x);
      return { id: x, label: w?.label ?? x, status: w?.status, blocked: read.blockersOf(x).some((b) => b.severity === 'block') };
    });
  }
  const res: InspectResult = { meta: { ...meta }, components, blockers, processes, details };
  return res;
}

export function pick(rt: Runtime, x: number, z: number, radius: number): { id: string; kind: string; label: string; distance: number }[] {
  const read = rt.read;
  const out: { id: string; kind: string; label: string; distance: number }[] = [];
  const frame = buildFrame(rt, 0);
  const consider = (id: string, kind: string, label: string, px: number, pz: number, r = radius) => {
    const d = Math.hypot(px - x, pz - z);
    if (d <= r) out.push({ id, kind, label, distance: d });
  };
  for (const m of frame.machines) consider(m.id, 'machine', m.label, m.x, m.z);
  for (const p of frame.people) if (p.state !== 'off' && p.state !== 'absent') consider(p.id, 'person', p.name, p.x, p.z, radius * 0.6);
  for (const s of frame.stores) consider(s.id, 'store', s.label, s.x, s.z, radius + Math.cbrt(s.volume + 1));
  for (const w of frame.workfronts) consider(w.id, 'workPackage', w.label, w.x, w.z);
  for (const [id, r] of read.all('Road')) {
    if (r.status === 'cancelled') continue;
    let best = Infinity;
    for (const st of r.design.stations) best = Math.min(best, Math.hypot(st.x - x, st.z - z));
    if (best <= radius + 4) out.push({ id, kind: 'road', label: r.label, distance: best + 2 });
  }
  for (const [id, b] of read.all('Structure')) {
    if (b.status === 'cancelled' || b.status === 'struck' || b.status === 'demolished') continue;
    const sp = b.plan;
    const a = (sp.rotation * Math.PI) / 180;
    const dx = x - sp.pos[0];
    const dz = z - sp.pos[1];
    // into the building frame (u along length, v across)
    const u = dx * Math.cos(a) + dz * Math.sin(a);
    const v = -dx * Math.sin(a) + dz * Math.cos(a);
    const du = Math.max(0, Math.abs(u) - sp.length / 2);
    const dv = Math.max(0, Math.abs(v) - sp.width / 2);
    const d = Math.hypot(du, dv);
    if (d <= radius) out.push({ id, kind: 'structure', label: b.label, distance: d });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

export function overlay(rt: Runtime, layer: OverlayLayer, goal?: Goal): { nx: number; nz: number; x0: number; z0: number; cell: number; values: Float32Array; min: number; max: number; unit: string; label: string } | null {
  const read = rt.read;
  const terrain = read.port('terrain');
  if (layer === 'none') return null;
  if (layer.startsWith('crit:') || layer.startsWith('goal:')) {
    // scouting: a criterion, or a goal's suitability (0..1, NaN where ruled out); grids are cell-centred
    const siting = read.port('siting');
    const id = layer.slice(5);
    const g = layer.startsWith('crit:') ? siting.grid(id) : siting.score(id === 'custom' && goal ? goal : id);
    return { nx: g.nx, nz: g.nz, x0: g.x0 + g.cell / 2, z0: g.z0 + g.cell / 2, cell: g.cell, values: new Float32Array(g.values), min: layer.startsWith('goal:') ? 0 : g.min, max: layer.startsWith('goal:') ? 1 : g.max, unit: g.unit === '1' ? '' : g.unit, label: layer.startsWith('goal:') ? `${g.label}: suitability (grey = ruled out by a hard limit)` : g.label };
  }
  if (layer === 'moisture' || layer === 'frost') {
    const g = read.port('soil-state').grid();
    const vals = new Float32Array(layer === 'moisture' ? g.moisture : g.frostDepth);
    return { nx: g.nx, nz: g.nz, x0: g.x0, z0: g.z0, cell: g.cell, values: vals, min: 0, max: layer === 'moisture' ? 1.2 : 1, unit: layer === 'moisture' ? 'rel.' : 'm', label: layer === 'moisture' ? 'Soil moisture (1 = field capacity)' : 'Frost depth' };
  }
  const step = 4;
  const g = terrain.grid;
  const nx = Math.floor((g.nx - 1) / step) + 1;
  const nz = Math.floor((g.nz - 1) / step) + 1;
  const values = new Float32Array(nx * nz);
  const soilIds = Object.keys(read.data('soilClasses'));
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const x = g.x0 + i * step * g.cell;
      const z = g.z0 + j * step * g.cell;
      // (the soil as the player's party knows it: its test pits, else the region's soil map, decision 0017)
      values[j * nx + i] = layer === 'slope' ? terrain.slopeAt(x, z) * 100 : layer === 'soil' ? soilIds.indexOf(read.port('production').knownSoil(seatParty(read), [x, z], 0.8).id) : 0;
    }
  }
  if (layer === 'condition' || layer === 'traffic') {
    // rasterise inspected ZEB grades / traffic volumes along roads; NaN = no data (transparent)
    values.fill(NaN);
    const cell = g.cell * step;
    const stamp = (x: number, z: number, v: number, r: number) => {
      const ci = Math.round((x - g.x0) / cell);
      const cj = Math.round((z - g.z0) / cell);
      const rc = Math.max(1, Math.ceil(r / cell));
      for (let j = cj - rc; j <= cj + rc; j += 1) {
        for (let i = ci - rc; i <= ci + rc; i += 1) {
          if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
          const k = j * nx + i;
          const cur = values[k]!;
          values[k] = Number.isNaN(cur) ? v : Math.max(cur, v);
        }
      }
    };
    const along = (pts: Vec2[], v: number, r: number) => {
      for (let n = 1; n < pts.length; n += 1) {
        const a = pts[n - 1]!;
        const b = pts[n]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(len / (cell * 0.5)));
        for (let q = 0; q <= steps; q += 1) stamp(a[0] + ((b[0] - a[0]) * q) / steps, a[1] + ((b[1] - a[1]) * q) / steps, v, r);
      }
    };
    if (layer === 'condition') {
      for (const [id, r] of read.all('Road')) {
        const insp = read.get('RoadInspection', id);
        if (!insp) continue;
        for (const sec of insp.sections) {
          const pts = r.design.stations.filter((st) => st.s >= sec.s0 - 1e-6 && st.s <= sec.s1 + 1e-6).map((st) => [st.x, st.z] as Vec2);
          along(pts, sec.grade, 6);
        }
      }
      return { nx, nz, x0: g.x0, z0: g.z0, cell, values, min: 1, max: 5, unit: 'ZEB', label: 'Condition grade from the last inspection (1 very good – 5 very poor)' };
    }
    const tr = read.port('traffic');
    let max = 10;
    for (const [id, e] of read.port('routing').edges()) {
      const t = tr.edge(id);
      const v = t ? Math.max(t.vehPerDay, t.recent[t.recent.length - 1]?.veh ?? 0) : 0;
      if (v <= 0) continue;
      max = Math.max(max, v);
      along(e.geometry.map((p) => [p[0], p[1]] as Vec2), v, Math.max(4, e.width));
    }
    return { nx, nz, x0: g.x0, z0: g.z0, cell, values, min: 0, max: Math.ceil(max), unit: 'veh/d', label: 'Traffic (vehicles per day, 30-day average)' };
  }
  if (layer === 'slope') return { nx, nz, x0: g.x0, z0: g.z0, cell: g.cell * step, values, min: 0, max: 20, unit: '%', label: 'Slope' };
  if (layer === 'soil') return { nx, nz, x0: g.x0, z0: g.z0, cell: g.cell * step, values, min: 0, max: soilIds.length - 1, unit: '', label: `Subsoil at 0.8 m: ${soilIds.join(', ')}` };
  return null;
}

/** the seat's books: its accounts and postings, named by the chart (without the party prefix) */
export function ledger(rt: Runtime, since?: number): unknown {
  const party = seatParty(rt.read);
  const prefix = `${party}:`;
  const own = (id: string) => id.startsWith(prefix);
  const chart = (id: string) => (own(id) ? id.slice(prefix.length) : id);
  const entries = rt
    .ledgerEntries({ since: since ?? Math.max(0, rt.now - 30 * DAY) })
    .filter((e) => own(e.from) || own(e.to))
    .map((e) => ({ ...e, from: chart(e.from), to: chart(e.to) }));
  const accounts = rt.read.accounts(party).map((a) => ({ ...a, id: chart(a.id) }));
  return { accounts, entries: entries.slice(-400), cashflow: rt.project('economy.cashflow', { party }) };
}
