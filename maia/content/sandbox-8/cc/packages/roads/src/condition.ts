/**
 * Road condition and deterioration.
 *
 * Asphalt (HDM-4 / HDM-III forms, daily integration):
 *   ΔRI  = 134·e^(m·AGE)·(1+SNC)^−5·YE4·Δt      structural (traffic) roughness
 *        + 0.0066·ΔACRA + 0.088·ΔRDS + ΔRIp      cracking, rutting, potholes
 *        + m·RI·Δt                               environment (m ≈ 0.06 /a, DE)
 *   cracking initiation ICA = Kcia·4.21·exp(0.139·SNC − 17.1·YE4/SNC²)   [a]
 *   cracking progression: logistic after initiation; potholes grow from wide cracking,
 *   amplified on freeze–thaw days (assumption, documented in data).
 * Gravel (Paterson 1991):
 *   MLA = 3.65·(3.46 + 2.46·MMP·G + KT·ADT) mm/a, KT = max(0, 0.022 + 0.00342·MMP·P075 − 0.0092·MMP·PI − 0.101·MMP)
 *   roughness approaches RImax exponentially with vehicle passes; blading resets it.
 * Grades: ZEB scale 1.0–5.0, piecewise linear between support points (0→1.0, Warnwert 3.5,
 * Schwellenwert 4.5), aggregated by the worst indicator (simplification of the ZEB value tree).
 */
import type { Intervention, RoadClass, RoadCondition, RoadDesign, RoadSettings, SectionCondition } from './contract.ts';

const INCH = 0.0254;

/** AASHTO structural number with layer coefficients + subgrade contribution (HDM-4 SNC). */
export function structuralNumber(cls: RoadClass, design: RoadDesign): number {
  const sec = design.sections[0];
  if (!sec) return 1;
  let sn = 0;
  for (const l of cls.layers) {
    const h = (sec.layerThickness[l.id] ?? 0) / INCH;
    const a = l.kind.startsWith('asphalt') ? 0.4 : l.kind === 'unboundBase' || l.kind === 'unboundSurface' ? 0.14 : 0.11;
    sn += a * h;
  }
  const cbr = 5; // subgrade Ev2 ≈ 45 MPa ≈ CBR 5 %
  const lc = Math.log10(cbr);
  const snsg = 3.51 * lc - 0.85 * lc * lc - 1.43;
  return sn + Math.max(0, snsg);
}

export function initialCondition(cls: RoadClass, design: RoadDesign, settings: RoadSettings, now: number, workmanship = 1): RoadCondition {
  const det = settings.deterioration;
  const wearing = cls.layers.find((l) => l.kind === 'unboundSurface');
  const gravel = wearing ? (wearing.thickness?.value ?? 0) * 1000 : 0;
  const sections: SectionCondition[] = design.sections.map((s) => ({
    s0: s.s0,
    s1: s.s1,
    surface: cls.surface,
    age: 0,
    // a surface finished by unpractised hands starts rougher (HDM-4: roughness at construction follows its quality)
    iri: (cls.surface === 'asphalt' ? det.initialIri.value : det.unpavedRiMin.value) * (1 + det.workmanshipRoughness.value * (1 - Math.max(0, Math.min(1, workmanship)))),
    cracks: 0,
    rut: 0,
    potholes: 0,
    patches: 0,
    crackInitAge: Infinity,
    gravel,
    gravelDesign: gravel,
    passesSinceBlading: 0,
    grade: 1,
  }));
  return { sections, snc: structuralNumber(cls, design), lastUpdate: now };
}

/** value → ZEB grade (1.0 … 5.0), linear through (0,1), (v35,3.5), (v45,4.5), extrapolated */
export function zebGrade(value: number, v35: number, v45: number, higherIsWorse = true): number {
  const v = higherIsWorse ? value : -value;
  const a = higherIsWorse ? v35 : -v35;
  const b = higherIsWorse ? v45 : -v45;
  const zero = higherIsWorse ? 0 : -1e9;
  let g: number;
  if (v <= a) g = 1 + ((v - zero) / (a - zero)) * 2.5;
  else g = 3.5 + ((v - a) / (b - a)) * 1.0;
  return Math.max(1, Math.min(5, g));
}

export function gradeOf(sec: SectionCondition, settings: RoadSettings): number {
  const z = settings.zeb;
  const at = (s: { values: number[] }, i: number) => s.values[i]!;
  if (sec.surface === 'asphalt') {
    return Math.max(
      zebGrade(sec.iri, at(z.iri, 0), at(z.iri, 1)),
      zebGrade(sec.rut, at(z.rut, 0), at(z.rut, 1)),
      zebGrade(sec.cracks, at(z.cracks, 0), at(z.cracks, 1)),
      zebGrade(sec.patches + sec.potholes, at(z.patchesPotholes, 0), at(z.patchesPotholes, 1)),
    );
  }
  const loss = sec.gravelDesign > 0 ? 1 - sec.gravel / sec.gravelDesign : 0;
  return Math.max(zebGrade(sec.iri, at(z.unpavedIri, 0), at(z.unpavedIri, 1)), zebGrade(loss, at(z.gravelLossShare, 0), at(z.gravelLossShare, 1)));
}

export interface DayExposure {
  /** vehicles today on the road */
  vehicles: number;
  /** equivalent 10-t axle passes per day (traffic average) */
  esalPerDay: number;
  precip: number;
  /** monthly precipitation normal (m/month) */
  mmp: number;
  freezeThaw: boolean;
  /** mean absolute gradient (%) */
  gradient: number;
  /** long-run mean ESAL/day since opening */
  meanEsalPerDay?: number;
}

export function deteriorateDay(sec: SectionCondition, snc: number, x: DayExposure, settings: RoadSettings): SectionCondition {
  const det = settings.deterioration;
  const dt = 1 / 365;
  const next = { ...sec, age: sec.age + dt };
  if (sec.surface === 'asphalt') {
    const ye4 = (x.esalPerDay * 365) / 1e6;
    const m = det.envCoefficient.value;
    // initiation age follows the long-run traffic until cracking has started
    if (next.cracks <= 0) {
      const ye4Mean = ((x.meanEsalPerDay ?? x.esalPerDay) * 365) / 1e6;
      next.crackInitAge = det.crackInitKcia.value * 4.21 * Math.exp(0.139 * snc - (17.1 * ye4Mean) / (snc * snc));
    }
    const cracks0 = next.cracks;
    if (next.age >= next.crackInitAge) {
      const c = Math.max(cracks0, 0.5);
      next.cracks = Math.min(100, c + det.crackGrowth.value * c * (1 - c / 100) * dt * (x.freezeThaw ? 3 : 1));
    }
    const rut0 = next.rut;
    next.rut = rut0 + (det.rutBase.value + det.rutPerMesal.value * ye4) * dt;
    const pot0 = next.potholes;
    if (next.cracks > 20) next.potholes = Math.min(100, pot0 + det.potholeGrowth.value * ((next.cracks - 20) / 80) * dt * (x.freezeThaw ? 4 : 1));
    const dRIs = 134 * Math.exp(m * next.age) * (1 + snc) ** -5 * ye4 * dt;
    const dRIc = 0.0066 * (next.cracks - cracks0);
    const dRIr = 0.088 * 0.3 * (next.rut - rut0);
    const dRIp = 0.4 * (next.potholes - pot0);
    const dRIe = m * next.iri * dt;
    next.iri = Math.min(16, next.iri + dRIs + dRIc + dRIr + dRIp + dRIe);
  } else {
    const mmp = x.mmp;
    const kt = Math.max(0, 0.022 + 0.00342 * mmp * det.gravelP075.value - 0.0092 * mmp * det.gravelPI.value - 0.101 * mmp);
    // daily share of MLA = 3.65·(3.46 + 2.46·MMP·G + KT·ADT) mm/a; the traffic term uses today's vehicles
    const loss = (3.65 * (3.46 + 2.46 * mmp * x.gradient)) / 365 + 0.01 * kt * x.vehicles;
    next.gravel = Math.max(0, next.gravel - loss);
    const rate = det.unpavedRate.value * (1 + x.precip / 20);
    next.iri = det.unpavedRiMax.value - (det.unpavedRiMax.value - next.iri) * Math.exp(-rate * x.vehicles);
    // without traffic, rain alone slowly erodes the surface
    if (x.precip > 10) next.iri = Math.min(det.unpavedRiMax.value, next.iri + 0.02 * (x.precip - 10));
    next.passesSinceBlading = sec.passesSinceBlading + x.vehicles;
  }
  next.grade = gradeOf(next, settings);
  return next;
}

export function applyIntervention(sec: SectionCondition, iv: Intervention, settings: RoadSettings): SectionCondition {
  const e = iv.effect;
  const det = settings.deterioration;
  const next = { ...sec };
  // (an intervention never leaves a road worse in what it treats: what it sets is the most that remains)
  if (e.iriFactor !== undefined) next.iri = Math.min(next.iri, Math.max(sec.surface === 'gravel' ? det.unpavedRiMin.value : det.initialIri.value, next.iri * e.iriFactor));
  if (e.iriSet) next.iri = Math.min(next.iri, e.iriSet.value);
  if (e.patchesAdd) next.patches = Math.min(100, next.patches + next.potholes);
  if (e.potholes !== undefined) next.potholes = Math.min(next.potholes, e.potholes);
  if (e.cracks !== undefined) next.cracks = Math.min(next.cracks, e.cracks);
  if (e.rutFactor !== undefined) next.rut *= e.rutFactor;
  // a new wearing course goes on what is left of the old: its thickness, no more
  if (e.laysGravel) next.gravel = next.gravel + (iv.thickness?.value ?? 0) * 1000;
  if (e.resetSurfaceAge) {
    next.age = 0;
    next.crackInitAge = Infinity;
    next.patches = 0;
  }
  if (sec.surface === 'gravel' && (e.iriFactor !== undefined || e.laysGravel)) next.passesSinceBlading = 0;
  next.grade = gradeOf(next, settings);
  return next;
}

/** speed reduction from roughness (assumption: −6 % per m/km above IRI 3, floor 35 %) */
export function speedFactor(iri: number): number {
  return Math.max(0.35, Math.min(1, 1 - 0.06 * Math.max(0, iri - 3)));
}
