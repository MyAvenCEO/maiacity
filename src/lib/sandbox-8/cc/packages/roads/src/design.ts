/**
 * Road design: alignment, gradeline, pavement build-up, cross-section earthworks, mass
 * balance and work packages. Pure functions of the read context — used both for live
 * previews while the player draws and for the committed plan.
 */
import type { Finding, RulebookContribution } from '../../rulebooks/src/index.ts';
import { ex, type EntityId, type Explained, type ReadCtx } from '../../kernel/src/index.ts';
import { cumulativeLengths, filletPolyline, leftNormal, nearestOnPolyline, pointAtChainage, resamplePolyline, tangentAtChainage, type Vec2 } from '../../geo/src/index.ts';
import { fellsOf, type PackageSpec } from '../../production/src/index.ts';
import type { RoadClass, RoadDesign, RoadSettings, SectionDesign, Station } from './contract.ts';

const SAMPLE = 0.5; // cross-section sampling step (m)
const MAX_OFFSET = 45; // search limit for daylight points (m)

function classOf(read: ReadCtx, id: string): RoadClass {
  const c = read.data('roadClasses')[id];
  if (!c) throw new Error(`Unknown road class ${id}`);
  return c;
}

function movingAverage(v: number[], w: number): number[] {
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i += 1) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(v.length - 1, i + w); k += 1) {
      sum += v[k]!;
      n += 1;
    }
    out[i] = sum / n;
  }
  return out;
}

/** gradeline: balanced between raise-only and lower-only grade-feasible envelopes, ≥ water minima */
/** what is cleared about a site's yard and stockpile, and either side of the lane to them from the road (m): estimates */
const YARD_CLEAR = 15;
const LANE_CLEAR = 5;

export function designGradeline(ground: number[], minimum: number[], spacing: number, maxGrade: number): number[] {
  const n = ground.length;
  if (n === 0) return [];
  const d = maxGrade * spacing;
  const smooth = movingAverage(movingAverage(ground, Math.max(1, Math.round(15 / spacing))), Math.max(1, Math.round(15 / spacing)));
  // keep ends tied to existing ground (tie-in to connecting roads)
  smooth[0] = ground[0]!;
  smooth[n - 1] = ground[n - 1]!;
  const up = [...smooth];
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 1; i < n; i += 1) up[i] = Math.max(up[i]!, up[i - 1]! - d);
    for (let i = n - 2; i >= 0; i -= 1) up[i] = Math.max(up[i]!, up[i + 1]! - d);
  }
  const lo = [...smooth];
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 1; i < n; i += 1) lo[i] = Math.min(lo[i]!, lo[i - 1]! + d);
    for (let i = n - 2; i >= 0; i -= 1) lo[i] = Math.min(lo[i]!, lo[i + 1]! + d);
  }
  const g = up.map((u, i) => Math.max((u + lo[i]!) / 2, minimum[i]!));
  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 1; i < n; i += 1) g[i] = Math.max(g[i]!, g[i - 1]! - d);
    for (let i = n - 2; i >= 0; i -= 1) g[i] = Math.max(g[i]!, g[i + 1]! - d);
  }
  return g;
}

interface CrossSection {
  cut: number;
  fill: number;
  left: number;
  right: number;
  cutWidth: number;
  fillWidth: number;
}

/** numeric cross-section: flat formation of half-width hf, side slopes 1:slope to daylight */
export function crossSection(groundAt: (o: number) => number, formation: number, hf: number, slope: number): CrossSection {
  let cut = 0;
  let fill = 0;
  let cutWidth = 0;
  let fillWidth = 0;
  const reach: number[] = [];
  for (const side of [1, -1]) {
    let o = 0;
    let edge = hf;
    const gEdge = groundAt(side * hf);
    const isCut = gEdge >= formation;
    for (o = SAMPLE / 2; o < MAX_OFFSET; o += SAMPLE) {
      const g = groundAt(side * o);
      let design: number;
      if (o <= hf) design = formation;
      else {
        design = isCut ? formation + (o - hf) / slope : formation - (o - hf) / slope;
        if ((isCut && design >= g) || (!isCut && design <= g)) {
          edge = o;
          break;
        }
      }
      if (g > design) {
        cut += (g - design) * SAMPLE;
        cutWidth += SAMPLE;
      } else {
        fill += (design - g) * SAMPLE;
        fillWidth += SAMPLE;
      }
      edge = o + SAMPLE / 2;
    }
    reach.push(Math.max(hf, edge));
  }
  return { cut, fill, left: reach[0]!, right: reach[1]!, cutWidth, fillWidth };
}

function frostLayerFor(cls: RoadClass, settings: RoadSettings, frostClass: 'F1' | 'F2' | 'F3', inCut: boolean, highEmbankment: boolean, fixedTotal: number): { thickness: number; explain: Explained } {
  if (!cls.frostSafe) {
    return { thickness: 0, explain: ex.value(0, 'm', 'no frost protection layer (unbound rural road build-up, RLW)') };
  }
  const minLayer = cls.minFrostLayer?.value ?? 0;
  if (frostClass === 'F1') {
    return { thickness: minLayer, explain: ex.value(minLayer, 'm', 'F1 subgrade (not frost-susceptible): bearing-capacity minimum only', cls.minFrostLayer?.source) };
  }
  const base = frostClass === 'F2' ? cls.frostSafe.F2 : cls.frostSafe.F3;
  const zone = settings.frostZoneAddition[settings.frostZone];
  const terms: Explained[] = [ex.param(base, `RStO Tab. 6 frost-safe superstructure (${frostClass}, ${cls.loadClass ?? ''})`), ex.param(zone, `frost zone ${settings.frostZone}`)];
  if (inCut) terms.push(ex.param(settings.cutAddition, 'grade line in cut (+)'));
  if (highEmbankment) terms.push(ex.value(-settings.highEmbankmentDeduction.value, 'm', `embankment > ${settings.highEmbankment.value} m (−)`, settings.highEmbankmentDeduction.source));
  const total = ex.sum('required frost-safe thickness', 'm', ...terms);
  const fss = ex.max('frost protection layer', 'm', ex.sub('frost-safe total − bound/base layers', 'm', total, ex.value(fixedTotal, 'm', 'asphalt/base layers above')), ex.value(minLayer, 'm', 'bearing minimum (Ev2 45 → 120 MPa)', cls.minFrostLayer?.source));
  return { thickness: Math.round(fss.v * 100) / 100, explain: fss };
}

/** the soil a road is planned on: what its party knows of the ground (its test pits, else the soil map; 8d) */
function plannedSoil(read: ReadCtx, party: EntityId | undefined, p: Vec2, depth: number): string {
  return read.hasPort('production') ? read.port('production').knownSoil(party, p, depth).id : read.port('terrain').soilClassAtDepth(p[0], p[1], depth);
}

function worstFrostClass(read: ReadCtx, x: number, z: number, from: number, to: number, party?: EntityId): 'F1' | 'F2' | 'F3' {
  const terrain = read.port('terrain');
  let worst: 'F1' | 'F2' | 'F3' = 'F1';
  for (let d = Math.max(0.05, from); d <= to + 1e-9; d += 0.25) {
    const fc = terrain.soilClass(plannedSoil(read, party, [x, z], d)).frostClass;
    if (fc > worst) worst = fc;
  }
  return worst;
}

/** half the width a road's formation takes (carriageway, shoulders, swales) */
function hfOf(read: ReadCtx, cls: RoadClass): number {
  return cls.carriageway.value / 2 + cls.shoulder.value + (cls.swales ? read.data('roadSettings').swaleWidth.value : 0);
}

/**
 * A section's earthworks measured on the ground (design/physical-state.md §5): the grid vertices its footprint covers,
 * each with the m³ to strip (the topsoil left there), to cut below that to the formation and its side slopes, and to
 * fill up to them, in the order of the chainage. The quantities are the ground's: a field stripped once has nothing
 * left to strip.
 */
export function sectionGround(read: ReadCtx, alignment: Vec2[], stations: readonly Station[], s0: number, s1: number, hf: number, slope: number): { strip: [number, number, number][]; cut: [number, number, number][]; fill: [number, number, number][] } {
  const terrain = read.port('terrain');
  const sts = stations.filter((st) => st.s >= s0 - 1e-6 && st.s <= s1 + 1e-6);
  const out = { strip: [] as [number, number, number][], cut: [] as [number, number, number][], fill: [] as [number, number, number][] };
  if (sts.length < 2) return out;
  const cum = cumulativeLengths(alignment);
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (const st of sts) {
    const n = nearestOnPolyline(alignment, [st.x, st.z], cum);
    const i = Math.min(alignment.length - 2, n.segment);
    const a = alignment[i]!;
    const b = alignment[i + 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (b[1] - a[1]) / l;
    const nz = -(b[0] - a[0]) / l;
    left.push([st.x + nx * st.left, st.z + nz * st.left]);
    right.push([st.x - nx * st.right, st.z - nz * st.right]);
  }
  const formationAt = (sCh: number): number => {
    if (sCh <= sts[0]!.s) return sts[0]!.formation;
    for (let k = 1; k < sts.length; k += 1) {
      const a = sts[k - 1]!;
      const b = sts[k]!;
      if (sCh <= b.s) return a.formation + ((b.formation - a.formation) * (sCh - a.s)) / Math.max(1e-9, b.s - a.s);
    }
    return sts.at(-1)!.formation;
  };
  const rows: { s: number; strip: number; cut: number; fill: number; i: number; j: number }[] = [];
  for (const [i, j, area] of terrain.cover([...left, ...right.reverse()])) {
    const at = terrain.groundAt(i, j);
    const near = nearestOnPolyline(alignment, [at.x, at.z], cum);
    let td = 0;
    for (const l of at.column.layers) {
      if (terrain.soilClass(l.classId).group !== 'topsoil') break;
      td += l.thickness;
    }
    // (under water nothing is stripped or cut: a creek is crossed by its culvert and filled over, not dug deeper)
    if (terrain.waterDepthAt(at.x, at.z) > 0.02) td = 0;
    const h = at.h - td;
    const formation = formationAt(near.s);
    const beyond = Math.max(0, near.distance - hf);
    const cutTo = formation + beyond / slope;
    const fillTo = formation - beyond / slope;
    const wet = terrain.waterDepthAt(at.x, at.z) > 0.02;
    rows.push({ s: near.s, i, j, strip: area * td, cut: !wet && h > cutTo + 0.005 ? area * (h - cutTo) : 0, fill: h < fillTo - 0.005 ? area * (fillTo - h) : 0 });
  }
  rows.sort((a, b) => a.s - b.s || a.j - b.j || a.i - b.i);
  for (const r of rows) {
    if (r.strip > 1e-6) out.strip.push([r.i, r.j, r.strip]);
    if (r.cut > 1e-6) out.cut.push([r.i, r.j, r.cut]);
    if (r.fill > 1e-6) out.fill.push([r.i, r.j, r.fill]);
  }
  return out;
}

export function designRoad(read: ReadCtx, points: Vec2[], classId: string, mine: (holder: EntityId) => boolean = () => false, party?: EntityId): RoadDesign {
  const cls = classOf(read, classId);
  const settings = read.data('roadSettings');
  const terrain = read.port('terrain');
  const problems: string[] = [];
  const warnings: string[] = [];
  const empty = (): RoadDesign => ({
    classId,
    valid: false,
    problems,
    warnings,
    controlPoints: points,
    alignment: points,
    length: 0,
    minRadius: Infinity,
    maxGradeUsed: 0,
    stations: [],
    sections: [],
    totals: { cut: 0, fill: 0, topsoil: 0, suitableCut: 0, spoilTonnes: 0, importFill: 0, trees: 0, culverts: 0, materials: {} },
    stockpile: points[0] ?? [0, 0],
    siteStore: points[0] ?? [0, 0],
    connections: { start: null, end: null },
    estimate: { cost: 0, hours: 0, days: 0, explain: ex.value(0, 'EUR') },
    findings: [],
  });
  if (points.length < 2) {
    problems.push('Place at least two points.');
    return empty();
  }
  const b = terrain.bounds;
  for (const p of points) {
    if (p[0] < b.x0 + 2 || p[0] > b.x1 - 2 || p[1] < b.z0 + 2 || p[1] > b.z1 - 2) {
      problems.push('The road leaves the map.');
      return empty();
    }
  }
  const routing = read.port('routing');
  const spacing = settings.stationSpacing.value;
  // a road that ends near another is laid on to it: the tie is part of it, so what it is said to join it
  // joins (Qwen S374: an end 8 m short was "connected" and was a dead end in the network)
  // (only where the way met lies by that end, not by the road's own course: a road whose far end comes near
  // where it began is not led back to its start)
  const tie = (at: Vec2) => {
    const n = routing.nearest(at, { openOnly: false, maxDistance: settings.connectDistance.value });
    return n && n.distance > 0.5 && nearestOnPolyline(points, n.point).distance >= n.distance - 1e-6 ? n.point : undefined;
  };
  const head = tie(points[0]!);
  const tail = tie(points[points.length - 1]!);
  points = [...(head ? [head] : []), ...points, ...(tail ? [tail] : [])];
  const fillet = filletPolyline(points, cls.minRadius.value, Math.min(2, spacing));
  const alignment = resamplePolyline(fillet.points, spacing);
  const cum = cumulativeLengths(alignment);
  const length = cum[cum.length - 1] ?? 0;
  if (length < 10) {
    problems.push('The road is shorter than 10 m.');
    return empty();
  }

  // ---- ground, water and gradeline
  const ground = alignment.map(([x, z]) => terrain.heightAt(x, z));
  const minimum = alignment.map(([x, z], i) => {
    const w = terrain.waterDepthAt(x, z);
    return w > 0.02 ? ground[i]! + w + (cls.freeboard ?? settings.freeboard).value : -Infinity;
  });
  const maxGrade = cls.maxGrade.value / 100;
  const surface = designGradeline(ground, minimum, spacing, maxGrade);
  let maxGradeUsed = 0;
  for (let i = 1; i < surface.length; i += 1) maxGradeUsed = Math.max(maxGradeUsed, Math.abs(surface[i]! - surface[i - 1]!) / spacing);

  // ---- sections
  const nSections = Math.max(1, Math.min(alignment.length - 1, Math.round(length / settings.sectionLength.value)));
  // section boundaries fall ON stations (shared by neighbours) so no slice is left between them
  const lastIdx = alignment.length - 1;
  const boundary = (k: number) => Math.round((k * lastIdx) / nSections);
  const hf = cls.carriageway.value / 2 + cls.shoulder.value + (cls.swales ? settings.swaleWidth.value : 0);
  const fixedLayers = cls.layers.filter((l) => l.kind !== 'frostProtection');
  const fixedTotal = fixedLayers.reduce((a, l) => a + (l.thickness?.value ?? 0), 0);
  const stations: Station[] = [];
  const sections: SectionDesign[] = [];
  const veg = read.port('vegetation');
  for (let k = 0; k < nSections; k += 1) {
    const i0 = boundary(k);
    const i1 = boundary(k + 1);
    const s0 = cum[i0]!;
    const s1 = cum[i1]!;
    const idx: number[] = [];
    for (let i = i0; i <= i1; i += 1) idx.push(i);
    const midS = (s0 + s1) / 2;
    const mid = pointAtChainage(alignment, midS, cum);
    // provisional cut/fill character from gradeline vs ground
    const meanDiff = idx.reduce((a, i) => a + (surface[i]! - ground[i]!), 0) / Math.max(1, idx.length);
    const maxFillH = Math.max(0, ...idx.map((i) => surface[i]! - ground[i]!));
    const inCut = meanDiff < -0.3;
    const formationDepthMid = Math.max(0.3, -meanDiff + fixedTotal + 0.3);
    const frostClass = worstFrostClass(read, mid[0], mid[1], formationDepthMid - 0.2, formationDepthMid + 1.2, party);
    const frost = frostLayerFor(cls, settings, frostClass, inCut, maxFillH > settings.highEmbankment.value, fixedTotal);
    const layerThickness: Record<string, number> = {};
    for (const l of cls.layers) layerThickness[l.id] = l.kind === 'frostProtection' ? frost.thickness : (l.thickness?.value ?? 0);
    const pavement = Object.values(layerThickness).reduce((a, x) => a + x, 0);

    let cutVol = 0;
    let fillVol = 0;
    let topsoilVol = 0;
    let footprint = 0;
    let maxCut = 0;
    let culvert = 0;
    const leftPts: Vec2[] = [];
    const rightPts: Vec2[] = [];
    let prev: { s: number; cut: number; fill: number; top: number; w: number } | null = null;
    // (the topsoil as the party knows it there: 8d)
    const knownTop = (read.hasPort('production') ? read.port('production').knownColumn(party, mid) : terrain.soilAt(mid[0], mid[1])).layers[0];
    const topsoilDepth = knownTop && terrain.soilClass(knownTop.classId).group === 'topsoil' ? knownTop.thickness : 0;
    for (const i of idx) {
      const sCh = cum[i]!;
      const p = alignment[i]!;
      const tan = tangentAtChainage(alignment, sCh, cum);
      const nrm = leftNormal(tan);
      const formation = surface[i]! - pavement;
      const cs = crossSection((o) => terrain.heightAt(p[0] + nrm[0] * o, p[1] + nrm[1] * o), formation, hf, settings.sideSlope.value);
      const top = (cs.left + cs.right) * topsoilDepth;
      const netCut = Math.max(0, cs.cut - cs.cutWidth * topsoilDepth);
      const fillA = cs.fill + cs.fillWidth * topsoilDepth;
      const water = minimum[i]! > -Infinity;
      if (water) culvert = Math.max(culvert, cs.left + cs.right);
      if (!stations.length || Math.abs(stations[stations.length - 1]!.s - sCh) > 1e-6) stations.push({ s: sCh, x: p[0], z: p[1], ground: ground[i]!, surface: surface[i]!, formation, cut: netCut, fill: fillA, left: cs.left, right: cs.right, water });
      maxCut = Math.max(maxCut, ground[i]! - formation);
      leftPts.push([p[0] + nrm[0] * cs.left, p[1] + nrm[1] * cs.left]);
      rightPts.push([p[0] - nrm[0] * cs.right, p[1] - nrm[1] * cs.right]);
      if (prev) {
        const ds = sCh - prev.s;
        cutVol += ((prev.cut + netCut) / 2) * ds;
        fillVol += ((prev.fill + fillA) / 2) * ds;
        topsoilVol += ((prev.top + top) / 2) * ds;
        footprint += ((prev.w + cs.left + cs.right) / 2) * ds;
      }
      prev = { s: sCh, cut: netCut, fill: fillA, top, w: cs.left + cs.right };
    }
    // (the volumes are the ground's at its vertices, as the work will move them: §5)
    const gw = sectionGround(read, alignment, stations, s0, s1, hf, settings.sideSlope.value);
    const sum = (c: [number, number, number][]) => c.reduce((a, x) => a + x[2], 0);
    cutVol = sum(gw.cut);
    fillVol = sum(gw.fill);
    topsoilVol = sum(gw.strip);
    // (the soils as the party knows them: the topsoil's, else the region's topsoil, and what the cut is dug in, 8d; the
    // work meets the ground as it is at the same depths)
    const topsoilClass = knownTop && terrain.soilClass(knownTop.classId).group === 'topsoil' ? knownTop.classId : read.data('terrainSettings').soil.topsoilClass;
    const cutDepth = Math.max(topsoilDepth + 0.1, maxCut / 2);
    const cutClass = plannedSoil(read, party, mid, cutDepth);
    const polygon = [...leftPts, ...rightPts.reverse()];
    const trees = polygon.length >= 3 ? veg.treesIn(polygon).map((t) => t.id) : [];
    const formationArea = 2 * hf * (s1 - s0);
    const layerQuantity: Record<string, number> = {};
    for (const l of cls.layers) {
      const width = cls.carriageway.value + 2 * l.extraWidth.value;
      const vol = layerThickness[l.id]! * width * (s1 - s0);
      layerQuantity[l.id] = l.kind.startsWith('asphalt') ? vol * l.compactedDensity.value : vol;
    }
    const path = idx.map((i) => alignment[i]!);
    sections.push({
      index: k,
      s0,
      s1,
      length: s1 - s0,
      mid,
      path,
      cut: cutVol,
      fill: fillVol,
      topsoil: topsoilVol,
      topsoilClass,
      cutClass,
      cutDepth,
      cutSuitable: terrain.soilClass(cutClass).suitableFill,
      fillSource: settings.materials.fill,
      footprint,
      formationArea,
      maxCut,
      maxFill: maxFillH,
      frostClass,
      frostLayer: frost.thickness,
      frostExplain: frost.explain,
      layerThickness,
      layerQuantity,
      trees,
      culvert,
    });
  }

  // ---- mass balance
  let suitableT = 0;
  let unsuitableT = 0;
  let densitySum = 0;
  let densityW = 0;
  for (const sec of sections) {
    const sc = terrain.soilClass(sec.cutClass);
    const t = sec.cut * sc.bulkDensity.value;
    if (sec.cutSuitable) {
      suitableT += t;
      densitySum += (sc.bulkDensity.value / sc.compactionFactor.value) * sec.cut;
      densityW += sec.cut;
    } else unsuitableT += t;
  }
  const fillDensity = densityW > 0 ? densitySum / densityW : settings.importFillDensity.value;
  let availableT = suitableT;
  let importT = 0;
  for (const sec of sections) {
    if (sec.fill <= 0) continue;
    const need = sec.fill * fillDensity;
    if (availableT >= need) {
      availableT -= need;
      sec.fillSource = settings.materials.fill;
    } else {
      sec.fillSource = settings.materials.importFill;
      importT += sec.fill * settings.importFillDensity.value;
    }
  }
  const spoilTonnes = unsuitableT + availableT;

  // ---- materials to order (stored aggregates; asphalt is just-in-time)
  const waste = 1 + settings.wasteAllowance.value;
  const materials: Record<string, number> = {};
  const add = (m: string, q: number) => {
    if (q > 0) materials[m] = (materials[m] ?? 0) + q;
  };
  for (const sec of sections) {
    for (const l of cls.layers) {
      if (l.kind.startsWith('asphalt')) continue;
      add(l.material, sec.layerQuantity[l.id]! * l.compactedDensity.value * waste);
    }
    add(cls.shoulderMaterial, 2 * sec.length * cls.shoulderMass.value * waste);
    // (what the class's culvert work takes: a road's concrete pipe, a path's light one)
    if (sec.culvert > 0) {
      const mats = read.port('production').activity(cls.activities?.culvert ?? settings.culvertActivity).materials;
      for (const [m, q] of Object.entries(mats)) add(m, Math.ceil(sec.culvert) * q.value);
    }
  }
  add(settings.materials.importFill, importT * waste);
  for (const k of Object.keys(materials)) materials[k] = Math.ceil(materials[k]!);

  // ---- connections & site layout
  const start = routing.nearest(points[0]!, { openOnly: false, maxDistance: settings.connectDistance.value });
  const end = routing.nearest(points[points.length - 1]!, { openOnly: false, maxDistance: settings.connectDistance.value });
  if (!start && !end) problems.push(`A new road must start or end within ${settings.connectDistance.value} m of an existing or planned road.`);
  // a road cannot be laid on another's surface: joining it or crossing it is a junction, running along it is not
  // (what runs within both surfaces for longer than a junction takes); one of ours it may be laid over (a path made a track)
  const along = new Map<string, number>();
  for (const [, e] of routing.edges()) {
    if (e.geometry.length < 2) continue;
    const owner = e.asset ? read.get('Road', e.asset)?.holder : undefined;
    if (owner && mine(owner)) continue;
    let run = 0;
    let most = 0;
    for (const p of alignment) {
      const near = nearestOnPolyline(e.geometry, p);
      run = near.distance < (e.width + cls.carriageway.value) / 2 ? run + spacing : 0;
      most = Math.max(most, run);
    }
    const label = e.label ? `"${e.label}"` : 'a road';
    if (most > Math.max(15, 3 * Math.max(e.width, cls.carriageway.value))) along.set(label, Math.max(along.get(label) ?? 0, most));
  }
  for (const [label, m] of along) problems.push(`It runs on ${label} for ${Math.round(m)} m: a road cannot be laid on another's surface (join or cross it instead).`);
  // site layout: soil stockpile and material yard beside the road, clear of roads, water and steep ground
  const clampIn = (p: Vec2): Vec2 => [Math.min(b.x1 - 5, Math.max(b.x0 + 5, p[0])), Math.min(b.z1 - 5, Math.max(b.z0 + 5, p[1]))];
  const edgePts: Vec2[] = [];
  for (const [, e] of routing.edges()) for (const p of e.geometry) edgePts.push(p);
  const clearance = (p: Vec2) => {
    let d = Infinity;
    for (const q of edgePts) d = Math.min(d, Math.hypot(q[0] - p[0], q[1] - p[1]));
    for (const q of alignment) d = Math.min(d, Math.hypot(q[0] - p[0], q[1] - p[1]) + 0.01);
    return d;
  };
  const candidates: { p: Vec2; score: number; side: number; base: Vec2 }[] = [];
  for (const sAt of [20, 60, length / 2, length - 30]) {
    const ss = Math.max(0, Math.min(length, sAt));
    const tt = tangentAtChainage(alignment, ss, cum);
    const nn = leftNormal(tt);
    const base = pointAtChainage(alignment, ss, cum);
    for (const side of [1, -1]) {
      for (const off of [hf + 18, hf + 30, hf + 45]) {
        const p = clampIn([base[0] + nn[0] * off * side, base[1] + nn[1] * off * side]);
        const wet = terrain.waterDepthAt(p[0], p[1]) > 0 ? 1000 : 0;
        const steep = terrain.slopeAt(p[0], p[1]) * 200;
        const near = Math.max(0, 22 - clearance(p)) * 50;
        // (clear of trees, where it stands and on the way to it from the road: the lorries get there, S3)
        let wooded = veg.treesNear(p, 10).length;
        for (let k = 1; k < 8; k += 1) wooded += veg.treesNear([base[0] + ((p[0] - base[0]) * k) / 8, base[1] + ((p[1] - base[1]) * k) / 8], 4).length;
        candidates.push({ p, score: wet + steep + near + wooded * 300 + off * 0.5 + ss * 0.05, side, base });
      }
    }
  }
  candidates.sort((a2, b2) => a2.score - b2.score);
  const stockpile = candidates[0]!.p;
  const siteC = candidates.find((c) => Math.hypot(c.p[0] - stockpile[0], c.p[1] - stockpile[1]) > 30) ?? candidates[1] ?? candidates[0]!;
  const siteStore = siteC.p;
  // the yard and the stockpile are cleared with the first section, and a lane to each from the road: the lorries come to
  // them (S3; a site in a wood)
  const felled = new Set(sections.flatMap((sec) => sec.trees));
  const extra: string[] = [];
  const fell = (q: Vec2, r: number) => {
    for (const t of veg.treesNear(q, r)) if (!felled.has(t.id)) (felled.add(t.id), extra.push(t.id));
  };
  for (const c of [candidates[0]!, siteC]) {
    fell(c.p, YARD_CLEAR);
    // (the topsoil stockpile beside its yard)
    if (c === candidates[0]) fell([c.p[0] + 12, c.p[1] + 12], YARD_CLEAR);
    const n = Math.ceil(Math.hypot(c.p[0] - c.base[0], c.p[1] - c.base[1]) / 4);
    for (let k = 0; k <= n; k += 1) fell([c.base[0] + ((c.p[0] - c.base[0]) * k) / n, c.base[1] + ((c.p[1] - c.base[1]) * k) / n], LANE_CLEAR);
  }
  if (extra.length && sections[0]) sections[0] = { ...sections[0], trees: [...sections[0].trees, ...extra.sort()] };
  const trees = sections.reduce((a, s) => a + s.trees.length, 0);
  if (trees > 0) warnings.push(`${trees} trees must be felled.`);
  if (sections.some((s) => s.culvert > 0)) warnings.push('The road crosses water — a culvert is included.');
  if (importT > 0) warnings.push(`Not enough suitable soil from cuts: ${Math.round(importT)} t of fill must be imported.`);

  const design: RoadDesign = {
    classId,
    valid: problems.length === 0,
    problems,
    warnings,
    controlPoints: points,
    alignment,
    length,
    minRadius: fillet.minRadius,
    maxGradeUsed,
    stations,
    sections,
    totals: {
      cut: sections.reduce((a, s) => a + s.cut, 0),
      fill: sections.reduce((a, s) => a + s.fill, 0),
      topsoil: sections.reduce((a, s) => a + s.topsoil, 0),
      suitableCut: suitableT,
      spoilTonnes,
      importFill: importT,
      trees,
      culverts: sections.filter((s) => s.culvert > 0).length,
      materials,
    },
    stockpile,
    siteStore,
    connections: { start, end },
    estimate: { cost: 0, hours: 0, days: 0, explain: ex.value(0, 'EUR') },
    findings: [],
  };
  design.estimate = estimateDesign(read, design, party);
  // codes and standards advise; they do not block (decision 0013)
  if (read.hasPort('rulebooks')) design.findings = read.port('rulebooks').check({ kind: 'road', design });
  return design;
}

export interface Stores {
  site: string;
  soil: string;
  topsoil: string;
  /** where felled wood is piled (a road through trees) */
  wood?: string;
}

/** Work packages for constructing a designed road. */
export function packageSpecs(read: ReadCtx, design: RoadDesign, stores: Stores, road: string): PackageSpec[] {
  const cls = classOf(read, design.classId);
  const settings = read.data('roadSettings');
  const terrain = read.port('terrain');
  // (a class may do a stage its own way: a path built by hand)
  const A = { ...settings.activities, ...(cls.activities ?? {}) } as typeof settings.activities;
  const specs: PackageSpec[] = [];
  const start = design.alignment[0]!;
  specs.push({ key: 'survey', activity: A.survey, label: 'Setting out (survey)', quantity: design.length, pos: start, path: design.alignment, data: { road, stage: 'survey' } });
  const finals: string[] = [];
  for (const sec of design.sections) {
    const p = `s${sec.index}`;
    const where = `km ${(sec.s0 / 1000).toFixed(3)}–${(sec.s1 / 1000).toFixed(3)}`;
    const base = { pos: sec.mid, path: sec.path };
    const data = (stage: string) => ({ road, section: sec.index, stage });
    let prev = 'survey';
    // the ground each stage moves (§5): stripped, cut and filled as the work goes
    const gw = sectionGround(read, design.alignment, design.stations, sec.s0, sec.s1, hfOf(read, cls), settings.sideSlope.value);
    const as = { topsoil: settings.materials.topsoil, fill: settings.materials.fill, spoil: settings.materials.spoil };
    if (sec.trees.length) {
      specs.push({ key: `${p}.clear`, activity: A.clearing, label: `Fell ${sec.trees.length} trees ${where}`, quantity: sec.trees.length, ...base, after: [{ key: prev, type: 'FS' }], ...(stores.wood ? { fells: fellsOf(read, sec.trees, settings.materials, stores.wood, 'tree') } : {}), data: { ...data('clear'), trees: sec.trees } });
      prev = `${p}.clear`;
    }
    if (sec.topsoil > 0.5) {
      const tc = terrain.soilClass(sec.topsoilClass);
      specs.push({
        key: `${p}.topsoil`,
        activity: A.topsoil,
        label: `Strip topsoil ${where}`,
        quantity: sec.topsoil,
        ...base,
        after: [{ key: prev, type: 'FS' }],
        haulTo: design.stockpile,
        soilClass: sec.topsoilClass,
        produces: [{ material: settings.materials.topsoil, perUnit: tc.bulkDensity.value, store: stores.topsoil }],
        ground: { op: 'dig', cells: gw.strip, as, store: stores.topsoil, topsoilOnly: true },
        data: data('topsoil'),
      });
      prev = `${p}.topsoil`;
    }
    if (sec.culvert > 0) {
      specs.push({ key: `${p}.culvert`, activity: cls.activities?.culvert ?? settings.culvertActivity, label: `Culvert ${where}`, quantity: Math.ceil(sec.culvert), ...base, after: [{ key: prev, type: 'FS' }], store: stores.site, data: data('culvert') });
      prev = `${p}.culvert`;
    }
    if (sec.cut > 0.5) {
      const cc = terrain.soilClass(sec.cutClass);
      specs.push({
        key: `${p}.cut`,
        activity: A.excavation,
        label: `Excavate ${where}`,
        quantity: sec.cut,
        ...base,
        after: [{ key: prev, type: 'FS' }],
        haulTo: design.stockpile,
        soilClass: sec.cutClass,
        soilDepth: sec.cutDepth,
        produces: [{ material: sec.cutSuitable ? settings.materials.fill : settings.materials.spoil, perUnit: cc.bulkDensity.value, store: stores.soil }],
        ground: { op: 'dig', cells: gw.cut, as, store: stores.soil },
        data: data('cut'),
      });
      prev = `${p}.cut`;
    }
    if (sec.fill > 0.5) {
      const imported = sec.fillSource === settings.materials.importFill;
      const cc = terrain.soilClass(sec.cutClass);
      const perUnit = imported ? settings.importFillDensity.value : cc.bulkDensity.value / cc.compactionFactor.value;
      specs.push({
        key: `${p}.fill`,
        activity: A.fill,
        label: `Fill & compact ${where}`,
        quantity: sec.fill,
        ...base,
        after: [{ key: prev, type: 'FS' }],
        haulTo: imported ? design.siteStore : design.stockpile,
        soilClass: sec.cutClass,
        soilDepth: sec.cutDepth,
        store: imported ? stores.site : stores.soil,
        consumes: { [sec.fillSource]: perUnit },
        ...(imported ? {} : { substitutes: { [sec.fillSource]: { material: settings.materials.importFill, perUnit: settings.importFillDensity.value, store: stores.site } } }),
        params: { layerThickness: settings.fillLayerThickness.value },
        ground: { op: 'fill', cells: gw.fill, ...(imported ? { cls: settings.importFillClass } : {}), clsOf: { [settings.materials.importFill]: settings.importFillClass } },
        data: data('fill'),
      });
      prev = `${p}.fill`;
    }
    specs.push({ key: `${p}.subgrade`, activity: A.subgrade, label: `${cls.activities?.subgrade ? read.port('production').activity(A.subgrade).label : 'Formation & plate test'} ${where}`, quantity: sec.formationArea, ...base, after: [{ key: prev, type: 'FS' }], soilClass: sec.cutClass, soilDepth: sec.cutDepth, data: data('subgrade') });
    prev = `${p}.subgrade`;
    if (cls.swales) {
      specs.push({ key: `${p}.swale`, activity: A.swale, label: `Swales ${where}`, quantity: 2 * sec.length, ...base, after: [{ key: prev, type: 'FS' }], soilClass: sec.cutClass, soilDepth: sec.cutDepth, data: data('swale') });
      finals.push(`${p}.swale`);
    }
    for (const l of [...cls.layers].reverse()) {
      const q = sec.layerQuantity[l.id]!;
      if (q <= 0.01) continue;
      const width = cls.carriageway.value + 2 * l.extraWidth.value;
      const params: Record<string, number> = { layerThickness: sec.layerThickness[l.id]!, density: l.compactedDensity.value, looseDensity: l.looseDensity.value, width };
      const spec: PackageSpec = { key: `${p}.${l.id}`, activity: l.activity, label: `${l.label} ${where}`, quantity: q, ...base, after: [{ key: prev, type: 'FS' }], params, data: data(l.id) };
      if (!l.kind.startsWith('asphalt')) {
        spec.consumes = { [l.material]: l.compactedDensity.value };
        spec.store = stores.site;
        spec.haulTo = design.siteStore;
      }
      specs.push(spec);
      prev = `${p}.${l.id}`;
    }
    // (a path has no shoulders)
    if (!(cls.shoulder.value > 0 && cls.shoulderMass.value > 0)) {
      finals.push(prev);
      continue;
    }
    specs.push({
      key: `${p}.shoulder`,
      activity: A.shoulder,
      label: `Shoulders ${where}`,
      quantity: 2 * sec.length,
      ...base,
      after: [{ key: prev, type: 'FS' }],
      store: stores.site,
      consumes: { [cls.shoulderMaterial]: cls.shoulderMass.value },
      params: { width: cls.shoulder.value },
      data: data('shoulder'),
    });
    finals.push(`${p}.shoulder`);
  }
  specs.push({ key: 'acceptance', activity: A.acceptance, label: cls.activities?.acceptance ? read.port('production').activity(A.acceptance).label : 'Acceptance inspection (Abnahme)', quantity: 1, pos: design.alignment[design.alignment.length - 1]!, after: finals.map((k) => ({ key: k, type: 'FS' as const })), data: { road, stage: 'acceptance' } });
  return specs;
}

/** cost and duration estimate of a design from production estimates (planning knowledge only: what `party` knows of the ground, else the soil map) */
export function estimateDesign(read: ReadCtx, design: RoadDesign, party?: EntityId): RoadDesign['estimate'] {
  if (design.sections.length === 0) return { cost: 0, hours: 0, days: 0, explain: ex.value(0, 'EUR') };
  const prod = read.port('production');
  const specs = packageSpecs(read, design, { site: 'store?', soil: 'store?', topsoil: 'store?' }, 'road?');
  const costs: Explained[] = [];
  const byActivity = new Map<string, { hours: number; maxSection: number; label: string }>();
  let hours = 0;
  for (const spec of specs) {
    const e = prod.estimate(spec, party);
    hours += e.hours;
    costs.push(ex.note(e.cost, spec.label));
    const a = byActivity.get(spec.activity) ?? { hours: 0, maxSection: 0, label: prod.activity(spec.activity).label };
    a.hours += e.hours;
    a.maxSection = Math.max(a.maxSection, e.hours);
    byActivity.set(spec.activity, a);
  }
  // pipelined crews: the slowest trade sets the pace, others add one section each
  let longest = 0;
  let lead = 0;
  for (const a of byActivity.values()) {
    longest = Math.max(longest, a.hours);
    lead += a.maxSection;
  }
  const workingHours = longest + lead;
  const days = workingHours / 8 / 0.8; // 8 productive h/day, ~20 % weather & disruption allowance
  return {
    cost: costs.reduce((a, c) => a + c.v, 0),
    hours,
    days,
    explain: ex.sum('estimated construction cost (net)', 'EUR', ...costs),
  };
}

/**
 * The road class's own design limits as a rulebook (decision 0013): the minimum curve radius and
 * the maximum gradient its standard sets (practice data). Breaking them is advice, not a blocker.
 */
export function roadClassRulebook(read: ReadCtx): RulebookContribution {
  return {
    label: 'Road class design limits (practice pack)',
    kinds: ['road'],
    check({ design }) {
      const d = design as RoadDesign;
      const cls = read.data('roadClasses')[d.classId];
      if (!cls || d.length <= 0) return [];
      const out: Finding[] = [];
      if (d.minRadius < cls.minRadius.value * 0.98) {
        out.push({ rulebook: cls.standard, code: 'road.radius', severity: 'warning', message: `Curve radius ${d.minRadius.toFixed(0)} m is below the ${cls.minRadius.value} m ${cls.standard} sets for ${cls.label}: vehicles must slow down there, long vehicles may not get round.`, ...(cls.minRadius.source ? { source: cls.minRadius.source } : {}) });
      }
      if (d.maxGradeUsed * 100 > cls.maxGrade.value + 1e-4) {
        out.push({ rulebook: cls.standard, code: 'road.grade', severity: 'warning', message: `Gradient ${(d.maxGradeUsed * 100).toFixed(1)} % exceeds the ${cls.maxGrade.value} % ${cls.standard} sets for ${cls.label}: heavy, loaded vehicles struggle, and water runs down the road.`, ...(cls.maxGrade.source ? { source: cls.maxGrade.source } : {}) });
      }
      return out;
    },
  };
}
