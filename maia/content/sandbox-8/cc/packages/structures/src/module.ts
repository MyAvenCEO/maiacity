/**
 * Structures on the ground (decisions 0025, 0026). A party builds one from a template: a planner
 * draws the plan (the site work and the elements), the plan becomes a project, and every element
 * finished is recorded (and does to the site what it does: trees felled, ground levelled). It
 * stands on someone's land, shelters people (a tent), is answered by its physics every day, ages
 * element by element through the durability contract at each element's place, is inspected and
 * renewed, and stands on its holder's books. A kit is taken down and packed away again.
 */
import { command, DAY, defineModule, ex, HOUR, s, tolerance, wholeIfNear, type EntityId, type Explained, type ReadCtx, type Remedy, type WriteCtx } from '../../kernel/src/index.ts';
import { closerThan, roadWithin, type Vec2 } from '../../geo/src/index.ts';
import { ACCOUNTS, acct } from '../../economy/src/index.ts';
import { actorOf, partyLabel } from '../../parties/src/index.ts';
import type { Fells, GroundWork, PackageSpec, Produce } from '../../production/src/index.ts';
import type {} from '../../land/src/index.ts';
import type {} from '../../needs/src/index.ts';
import type {} from '../../terrain/src/index.ts';
import type {} from '../../weather/src/index.ts';
import type {} from '../../space/src/index.ts';
import type {} from '../../environment/src/index.ts';
import type {} from '../../materials/src/index.ts';
import { unitMass } from '../../inventory/src/index.ts';
import type {} from '../../agreements/src/index.ts';
import type {} from '../../equipment/src/index.ts';
import { StructureSettingsSchema, StructureTemplateSchema, type Built, type ElementCondition, type Plan, type PlanElement, type PlanSpec, type Planner, type Structure, type StructureCondition, type TemplateInfo } from './contract.ts';

/** how far from their store people go to sleep (m) */
const NEAR = 40;
const YEAR = 365.25 * DAY;
/** the reference life of an element that names none (a) */
const DEFAULT_LIFE = 80;

// ------------------------------------------------------------------ the kit and wall planner

/** tents, frame tents and walls: one element of work (after a pad, if asked), from the practice pack's templates */
/**
 * The structures that take ground: standing, being built, come down, or given up with something of
 * them built (a half-built hut stands where it was left until it is taken down)
 */
export function occupying(read: ReadCtx): [EntityId, Readonly<Structure>][] {
  return [...read.all('Structure')].filter(([, st]) => {
    if (st.status === 'building' || st.status === 'standing' || st.status === 'collapsed') return true;
    if (st.status !== 'cancelled') return false;
    const pr = st.project ? read.get('Project', st.project) : undefined;
    return st.done.length > 0 || (pr?.packages ?? []).some((pid) => (read.get('WorkPackage', pid)?.accounted ?? 0) > 1e-9);
  });
}

/** what a footprint would overlap: a road's surface (physical; how far to keep from it is practice), or a structure that takes ground */
export function overlapsOf(read: ReadCtx, at: { pos: Vec2; rotation: number; length: number; width: number; self?: EntityId; on?: EntityId }): string[] {
  const out: string[] = [];
  const hl = at.length / 2;
  const hw = at.width / 2;
  for (const [, e] of read.port('routing').edges()) {
    if (roadWithin(at.pos, at.rotation, hl, hw, e.geometry, e.width / 2)) {
      out.push(`Overlaps ${e.label ? `"${e.label}"` : 'a road'}.`);
      break;
    }
  }
  for (const [id, other] of occupying(read)) {
    // (itself revised; a vehicle it is set up on)
    if (id === at.self || id === at.on) continue;
    if (closerThan(at.pos, at.rotation, hl, hw, { pos: other.plan.pos, rotation: other.plan.rotation, length: other.plan.length, width: other.plan.width }, 0)) out.push(`Overlaps "${other.label}".`);
  }
  return out;
}

export const kitPlanner: Planner = {
  id: 'kit',
  templates: (read) => Object.fromEntries(Object.entries(read.data('structureTemplates')).map(([id, t]): [string, TemplateInfo] => [id, { label: t.label, form: t.form, length: t.length.value, width: t.width.value, height: t.height.value }])),
  plan(read, spec) {
    const tpl = read.data('structureTemplates')[spec.template]!;
    // (a vehicle is the size it is; so is what is built as a whole: only work by the face, a wall, is built to a length.
    // Qwen S154: a log hut took a length at its build that changed nothing of its work, and no revision of it)
    const sized = !tpl.vehicle && tpl.build.per === 'face';
    const length = sized ? (spec.length ?? tpl.length.value) : tpl.length.value;
    const height = tpl.form === 'wall' ? (spec.height ?? tpl.height.value) : tpl.height.value;
    const fixed = (['length', 'width', 'height'] as const).filter((k) => spec[k] !== undefined && Math.abs(spec[k]! - ({ length, width: tpl.width.value, height } as const)[k]) > 1e-9);
    const label = spec.label ?? tpl.label;
    const pos: Vec2 = [spec.pos[0], spec.pos[1]];
    const elements: PlanElement[] = [];
    if (spec.prepare) elements.push({ id: 'pad', label: `${label}: level and drain the pad`, activity: 'hand.dig', quantity: Math.max(0.2, length * tpl.width.value * 0.1), after: [], part: false, stage: 'site' });
    const material = tpl.elements.find((e) => e.material)?.material;
    elements.push({
      id: 'build',
      label: `${label}: ${tpl.vehicle ? 'set up' : tpl.form === 'tent' && tpl.kit ? 'put up' : 'build'}`,
      activity: tpl.build.activity,
      quantity: tpl.build.per === 'face' ? length * height : 1,
      after: spec.prepare ? ['pad'] : [],
      part: true,
      stage: 'shell',
      ...(material ? { material } : {}),
      ...(tpl.life ? { life: tpl.life.value } : {}),
    });
    const t = read.port('terrain');
    const b = t.bounds;
    const problems = pos[0] < b.x0 || pos[0] > b.x1 || pos[1] < b.z0 || pos[1] > b.z1 ? ['It is outside the map.'] : [];
    // a tent or a dry wall cannot be put up in standing water (found by an agent: a tent in the pond passed)
    const wet = problems.length ? 0 : t.waterDepthAt(pos[0], pos[1]);
    if (wet > 0) problems.push(`It would stand in water ${wet.toFixed(2)} m deep.`);
    // (two things cannot stand in one place: not on a road's surface, nor on another structure)
    if (!problems.length) problems.push(...overlapsOf(read, { pos, rotation: spec.rotation ?? 0, length, width: tpl.width.value, ...(spec.self ? { self: spec.self } : {}), ...(spec.on ? { on: spec.on } : {}) }));
    return {
      planner: 'kit',
      template: spec.template,
      label,
      pos,
      rotation: spec.rotation ?? 0,
      length,
      width: tpl.width.value,
      height,
      kit: tpl.kit,
      physics: { form: tpl.form, width: tpl.width, mass: tpl.mass, ...(tpl.anchorage ? { anchorage: tpl.anchorage } : {}), rating: tpl.rating, maxSlope: tpl.ground.maxSlope, ...(tpl.ground.embed ? { embed: tpl.ground.embed } : {}), ...(tpl.shelter ? { shelter: { ...(tpl.shelter.open ? { open: true } : {}), sleeps: tpl.shelter.sleeps, quality: tpl.shelter.quality, warming: tpl.shelter.warming, ...(tpl.shelter.envelope ? { envelope: tpl.shelter.envelope } : {}) } } : {}), ...(tpl.catchment ? { catchment: tpl.catchment } : {}), ...(tpl.fire ? { fire: tpl.fire } : {}) },
      // what catches rain keeps it in its own barrel (a store where it stands)
      stores: tpl.catchment ? [{ key: 'catch', label: 'water', pos, holds: [tpl.catchment.material] }] : [],
      elements,
      estimate: estimateOf(read, elements, pos, spec.store, spec.party),
      valid: problems.length === 0,
      problems,
      warnings: fixed.length ? [`${tpl.label} is the size it is (${length} × ${tpl.width.value} m, ${height} m high): its ${fixed.join(', ')} cannot be chosen.`] : [],
      findings: [],
    };
  },
};

/** cost and hours of a plan's elements, with the days if they follow each other (on what `party` knows of the ground: 8d) */
export function estimateOf(read: ReadCtx, elements: PlanElement[], pos: Vec2, store?: EntityId, party?: EntityId): Plan['estimate'] {
  const prod = read.port('production');
  const costs: Explained[] = [];
  let hours = 0;
  for (const el of elements) {
    if (el.quantity <= 1e-9) continue;
    const e = prod.estimate({ activity: el.activity, quantity: el.quantity, pos, ...(store ? { store } : {}), ...(el.site?.haulTo ? { haulTo: el.site.haulTo } : {}), ...(el.site?.soilClass ? { soilClass: el.site.soilClass } : {}) }, party);
    costs.push(ex.note(e.cost, el.label));
    hours += e.hours;
  }
  const cost = ex.sum('estimated cost', 'EUR', ...costs);
  return { cost: cost.v, hours, days: hours / 8 / 0.85, explain: cost };
}

// ------------------------------------------------------------------ planners, plans

function planners(read: ReadCtx): Planner[] {
  return read.contributions('planners').map((c) => c.impl);
}

function templatesOf(read: ReadCtx): Record<string, TemplateInfo & { planner: string }> {
  const out: Record<string, TemplateInfo & { planner: string }> = {};
  for (const p of planners(read)) for (const [id, t] of Object.entries(p.templates(read))) out[id] = { ...t, planner: p.id };
  return out;
}

function planOf(read: ReadCtx, spec0: PlanSpec): Plan | null {
  const p = planners(read).find((x) => x.templates(read)[spec0.template]);
  if (!p) return null;
  // (whose plan: said, or the holder of the structure it revises; 8d)
  const party = spec0.party ?? (spec0.self ? read.get('Structure', spec0.self)?.holder : undefined);
  const spec: PlanSpec = { ...spec0, ...(party ? { party } : {}) };
  const plan = p.plan(read, spec);
  if (!spec.drop?.length) return plan;
  // elements left out: the estimate is of what remains
  const elements = withoutElements(plan.elements, spec.drop);
  return { ...plan, elements, estimate: plan.planner === 'kit' || !plan.detail ? estimateOf(read, elements, plan.pos, spec.store, spec.party) : { ...plan.estimate, ...scaled(read, plan, elements, spec.store, spec.party) } };
}

/** a planner's own estimate less the elements left out (their estimated cost and hours) */
function scaled(read: ReadCtx, plan: Plan, kept: PlanElement[], store?: EntityId, party?: EntityId): Pick<Plan['estimate'], 'cost' | 'hours' | 'days'> {
  const gone = plan.elements.filter((e) => !kept.some((k) => k.id === e.id));
  const less = estimateOf(read, gone, plan.pos, store, party);
  const cost = plan.estimate.cost - less.cost;
  const hours = plan.estimate.hours - less.hours;
  return { cost, hours, days: plan.estimate.days * (plan.estimate.hours > 0 ? hours / plan.estimate.hours : 1) };
}

const isDone = (st: Readonly<Structure>, element: string) => st.done.includes(element);

/** a catcher taken down or given up: what its barrel held runs out on the ground (back to the world's water) */
function pourOut(ctx: WriteCtx, st: Readonly<Structure>): void {
  const barrel = st.stores?.catch;
  const hold = ctx.port('holdings');
  // (what it is for: the water)
  if (barrel) for (const [mat, q] of Object.entries(hold.contents(barrel))) if (q > 1e-9 && hold.accepts(barrel, mat)) ctx.command('inventory.release', { from: barrel, material: mat, qty: q, to: 'ground', why: `poured out: ${st.label} taken down` });
}

// ------------------------------------------------------------------ shelter

/** the pad a structure stands on: how much lower than the ground around it is (m; water gathers in a hollow) */
function hollow(read: ReadCtx, pos: Vec2): number {
  const t = read.port('terrain');
  const h = t.heightAt(pos[0], pos[1]);
  const around = [[5, 0], [-5, 0], [0, 5], [0, -5]].map(([dx, dz]) => t.heightAt(pos[0] + dx!, pos[1] + dz!));
  return around.reduce((a, x) => a + x, 0) / around.length - h;
}

/** how worn a structure is: the condition of its worst element (1 as new) */
function wear(read: ReadCtx, id: EntityId): number {
  const c = read.get('StructureCondition', id);
  return c?.elements.length ? Math.min(...c.elements.map((e) => e.condition)) : 1;
}

/** the rain fallen from `from` up to now (mm), hour by hour (the hour under way as far as it has gone) */
function rainSince(read: ReadCtx, from: number): number {
  const w = read.port('weather');
  let mm = 0;
  // (no rain fell before the world began: nothing reads before its first hour)
  for (let t = Math.max(0, Math.floor(from / HOUR) * HOUR); t < read.now; t += HOUR) mm += w.hour(t).precip * Math.min(1, (read.now - Math.max(t, from)) / HOUR);
  return mm;
}

/** how well a person sleeps in the shelter of a structure tonight, explained (null: no shelter near them) */
type Envelope = { volume: number; airChange: number; loss: number; flue: boolean };

function shelterFor(read: ReadCtx, person: EntityId): { quality: number; explain: Explained; warming: number; place: EntityId; envelope?: Envelope; open?: boolean } | null {
  const r = read.get('Resident', person);
  if (!r) return null;
  const home = read.port('holdings').where(r.store);
  if (!home) return null;
  const set = read.data('structureSettings');
  // the places to sleep near their store, best first; those living there take them in turn
  const places: { quality: number; explain: Explained; sleeps: number; warming: number; place: EntityId; envelope?: Envelope; open?: boolean }[] = [];
  for (const [id, st] of read.all('Structure')) {
    const sh = st.plan.physics.shelter;
    if (st.status !== 'standing' || ownerOf(read, id, st) !== r.party || !sh || sh.sleeps <= 0) continue;
    const pos = st.plan.pos;
    if (Math.hypot(pos[0] - home[0], pos[1] - home[1]) > NEAR) continue;
    const pad = isDone(st, 'pad');
    const slope = read.port('terrain').slopeAt(pos[0], pos[1]);
    const steep = pad ? 0 : Math.max(0, slope - st.plan.physics.maxSlope.value);
    const slopeF = Math.max(0.3, 1 - set.slopePenalty.value * (steep / 0.1));
    // the rain of the last day, hour by hour up to now (what has fallen runs into a hollow; what is to come is not known)
    const rain = rainSince(read, read.now - DAY);
    const wet = !pad && rain >= set.leak.rain.value && hollow(read, pos) >= set.leak.hollow.value;
    const wetF = wet ? 1 - set.leak.penalty.value : 1;
    // the night's cold is the sleepers' bedding against the night inside (living composes it)
    const worn = wear(read, id);
    const quality = sh.quality.value * slopeF * wetF * worn;
    const explain = ex.mul(
      `sleeping in the ${st.label}`,
      '1',
      ex.param(sh.quality, 'shelter'),
      ex.value(slopeF, '1', pad ? 'on a levelled pad' : `on a slope of ${Math.round(slope * 100)} %`, set.slopePenalty.source),
      ex.value(wetF, '1', wet ? `${Math.round(rain)} mm of rain run into it in a hollow` : 'dry', set.leak.penalty.source),
      ex.value(worn, '1', worn < 0.999 ? `worn: ${Math.round(worn * 100)} % of its condition left` : 'in good condition'),
    );
    places.push({ quality, explain, sleeps: sh.sleeps, warming: sh.warming.value, place: id, ...(sh.open ? { open: true } : {}), ...(sh.envelope ? { envelope: { volume: sh.envelope.volume.value, airChange: sh.envelope.airChange.value, loss: sh.envelope.loss.value, flue: sh.envelope.flue } } : {}) });
  }
  places.sort((a, b) => b.quality - a.quality);
  const housemates = [...read.all('Resident')].filter(([, o]) => o.store === r.store && o.party === r.party).map(([id]) => id).sort();
  let turn = housemates.indexOf(person);
  for (const pl of places) {
    if (turn < pl.sleeps) return { quality: pl.quality, explain: pl.explain, warming: pl.warming, place: pl.place, ...(pl.envelope ? { envelope: pl.envelope } : {}), ...(pl.open ? { open: true } : {}) };
    turn -= pl.sleeps;
  }
  return null;
}

// ------------------------------------------------------------------ in service

/** condition grade 1.0 (new) … 5.0 (failed): reaches ≈ 3.5 at the end of the service life */
export function elementGrade(age: number, life: number, shape: number): number {
  const x = Math.max(0, age) / Math.max(1e-6, life);
  return Math.min(5, 1 + 4 * (1 - Math.exp(-(x ** shape))));
}

/**
 * The life of an element of a known material through the durability contract at its placements —
 * the worst of them, over a full past year of exposure (never the future, decision 0004; a whole
 * year, so the season of completion does not matter). Null when there is no such year yet.
 */
function durabilityLife(read: ReadCtx, id: EntityId, el: { id: string; material?: string }, from: number): { life: number; explain: ElementCondition['lifeExplain'] } | null {
  const to = from + 365 * DAY;
  if (!el.material || !read.hasPort('durability') || !read.hasPort('environment') || !read.hasPort('space') || from < 0 || to > read.now) return null;
  const done = read.get('Structure', id)?.workmanship?.[el.id];
  const work = done !== undefined ? { workmanship: done } : undefined;
  const lives = read.port('space').where(id, el.id).map((w) => read.port('durability').serviceLife(el.material!, read.port('environment').exposure(w.in, from, to), work));
  const worst = lives.reduce<(typeof lives)[number] | undefined>((a, l) => (!a || l.years < a.years ? l : a), undefined);
  return worst ? { life: worst.years, explain: worst.explain } : null;
}

/** the parts of a structure that age: those with a life or a material */
const ageing = (st: Readonly<Structure>) => st.plan.elements.filter((e) => e.part && (e.life !== undefined || e.material !== undefined));

/**
 * The condition of a finished structure's elements. An element of a known material ages through the
 * durability contract (from the last full year, or provisionally from its reference life until a
 * year of its own exposure has passed); other elements keep their reference life.
 */
function initialCondition(read: ReadCtx, id: EntityId, st: Readonly<Structure>): StructureCondition {
  const elements: ElementCondition[] = ageing(st).map((el) => {
    const base = { id: el.id, label: el.label, age: 0, condition: 1, grade: 1 };
    const d = durabilityLife(read, id, el, read.now - 365 * DAY);
    if (d) return { ...base, life: d.life, lifeFrom: 'durability' as const, ...(d.explain ? { lifeExplain: d.explain } : {}) };
    return { ...base, life: el.life ?? DEFAULT_LIFE, lifeFrom: el.material && read.hasPort('durability') ? ('provisional' as const) : ('reference' as const) };
  });
  return { elements, lastUpdate: read.now };
}

/** whose a structure is to live in and act on: its holder's; one on wheels (a caravan) is its vehicle's user's (lent: the borrower's; asked back: its holder's again) */
function ownerOf(read: ReadCtx, id: EntityId, st: Readonly<Structure>): EntityId {
  if (!read.get('Machine', id) || !read.hasPort('equipment')) return st.holder;
  const eq = read.port('equipment');
  const m = read.require('Machine', id);
  return eq.usableBy(id, st.holder) ? st.holder : eq.usableBy(id, m.holder) ? m.holder : (read.contributions('machineUser').map((c) => c.impl(read, id)).find((x): x is EntityId => Boolean(x)) ?? m.holder);
}

/** a player acts only on its own party's structures */
function mustHold(ctx: WriteCtx, id: EntityId): Readonly<Structure> {
  const st = ctx.require('Structure', id);
  if (ctx.caller === 'client' && ownerOf(ctx, id, st) !== actorOf(ctx)) ctx.reject('structures.notOurs', { structure: st.label, party: partyLabel(ctx, actorOf(ctx)) });
  return st;
}

/**
 * The work of a structure given up: a kit half put up is packed away again, whole (what was built in
 * goes back with what was not, design/camp.md C3); what else is built stays. A structure that stood
 * before (a revision given up) stands as it was; one never finished is cancelled.
 */
function abandon(ctx: WriteCtx, id: EntityId): void {
  const st = ctx.require('Structure', id);
  if (st.status !== 'building') return;
  const pr = st.project ? ctx.get('Project', st.project) : undefined;
  // a kit half put up comes down where it stands: what of it was put up is set down there, packed (not carried off
  // to the store it came from by itself, finding 27); the pieces still at the work front lie there too
  if (st.plan.kit && pr) offBuilt(ctx, id, st, `${st.label} packed away unfinished`);
  const { demolishing: _d, before, ...rest } = st;
  // a home on wheels not set up after all is a vehicle again
  if (ctx.get('Machine', id) && !before) ctx.command('equipment.setUp', { machine: id, on: false });
  // a revision given up that has built a part beyond what it was, or taken one off: what it added comes off
  // again and what it took off goes back on, by our work; then it is as it was (0001: the bricks laid are there
  // until taken off). A taking back given up in turn, or a taking down given up, leaves it as it is built.
  const back = (pr?.packages ?? []).length > 0 && pr!.packages.every((pid) => ctx.get('WorkPackage', pid)?.key.endsWith('.back'));
  const eps = (q: number) => Math.max(1e-6, q * 1e-6);
  if (before && before.status === 'standing' && !back && !st.demolishing) {
    const was = new Map(before.plan.elements.filter((e) => e.part).map((e) => [e.id, e]));
    const parts = [...st.plan.elements.filter((e) => e.part), ...before.plan.elements.filter((e) => e.part && !st.plan.elements.some((x) => x.id === e.id))];
    const excess0 = parts.map((el) => ({ el, keep: was.get(el.id)?.quantity ?? 0, built: builtOf(ctx, id, el.id) })).filter((x) => x.built > x.keep + eps(x.keep));
    const short0 = [...was.values()].map((el) => ({ el, built: builtOf(ctx, id, el.id) })).filter((x) => x.built < x.el.quantity - eps(x.el.quantity));
    // what is built resting on a part that comes off or goes back on comes off whole and goes back on whole
    // (a roof over walls lowered, a roof half laid on walls to be raised again)
    const lifted = new Set([...excess0, ...short0].flatMap((x) => [...dependents(before.plan.elements, x.el.id)]).filter((y) => was.has(y) && builtOf(ctx, id, y) > eps(was.get(y)!.quantity)));
    const excess = excess0.filter((x) => !lifted.has(x.el.id));
    const short = short0.filter((x) => !lifted.has(x.el.id));
    const redo = [...lifted].sort().map((y) => was.get(y)!);
    if (excess.length || short.length || redo.length) {
      const pos = before.plan.pos;
      const off = orderRemovals([...excess.map((x) => removalSpec(ctx, id, x.el, x.built - x.keep, x.keep <= 1e-9, x.keep, pos, `${x.el.id}.back`)), ...redo.map((el) => removalSpec(ctx, id, el, builtOf(ctx, id, el.id), true, 0, pos, `${el.id}.back`))], before.plan.elements);
      const onKey = (x: string) => `${x}.on.back`;
      const back = [...short.map((x) => ({ el: x.el, q: x.el.quantity - x.built, extension: x.built > eps(x.el.quantity) })), ...redo.map((el) => ({ el, q: el.quantity, extension: false }))];
      const backIds = new Set(back.map((x) => x.el.id));
      // (after all that comes off, and after everything it rests on that goes back on, directly or not)
      const ancestors = (x: string, seen = new Set<string>()): Set<string> => {
        for (const a of was.get(x)?.after ?? before.plan.elements.find((e) => e.id === x)?.after ?? []) if (!seen.has(a)) (seen.add(a), ancestors(a, seen));
        return seen;
      };
      const on: PackageSpec[] = back.map((x) => {
        const after = [...off.map((o) => o.key), ...[...ancestors(x.el.id)].filter((a) => backIds.has(a)).map(onKey)];
        return { key: onKey(x.el.id), activity: x.el.activity, label: `${x.el.label} (back on)`, quantity: x.q, pos, ...(after.length ? { after: after.map((k) => ({ key: k, type: 'FS' as const })) } : {}), data: { structure: id, element: x.el.id, ...(x.extension ? { extension: true } : {}) } };
      });
      const r = ctx.command('production.createProject', { label: `Take back ${st.label}`, owner: 'structures', ref: id, party: st.holder, priority: 0, site: pos, ...(st.store ? { store: st.store } : {}), packages: [...off, ...on] });
      if (r.ok) {
        ctx.set('Structure', id, { ...rest, plan: before.plan, spec: before.spec, status: 'building', project: r.value.project, before });
        const what = [...(excess.length ? [`what it added (${excess.map((x) => x.el.label).join(', ')}) comes off again`] : []), ...(short.length ? [`what it took off (${short.map((x) => x.el.label).join(', ')}) goes back on`] : []), ...(redo.length ? [`what rests on them (${redo.map((el) => el.label).join(', ')}) comes off and goes back on whole`] : [])];
        ctx.log('info', `${st.label}: the work on it is given up; ${what.join(', and ')}, then it is as it was.`, [id]);
        return;
      }
    }
  }
  // a revision given up with nothing to take back, or a taking back or down given up: as it is built
  if (before) {
    // nothing of it left built (a taking down given up at its very end): it is gone (Qwen S153: not a standing nothing)
    const parts = [...before.plan.elements, ...st.plan.elements].filter((e) => e.part);
    if (parts.length && parts.every((e) => builtOf(ctx, id, e.id) <= eps(e.quantity))) {
      gone(ctx, id, { ...rest, plan: before.plan, spec: before.spec, status: before.status }, `${st.label}: the work on it is given up with nothing of it left standing: it is gone.`);
      return;
    }
    const asBuilt = asBuiltPlan(ctx, id, before.plan, st.plan);
    const differ = asBuilt.elements.filter((e) => e.part && Math.abs(e.quantity - (before.plan.elements.find((x) => x.id === e.id)?.quantity ?? 0)) > eps(e.quantity));
    const done = [...new Set([...st.done.filter((x) => !asBuilt.elements.some((e) => e.id === x && e.part && e.quantity <= 1e-9)), ...asBuilt.elements.filter((e) => e.part && e.quantity > 1e-9).map((e) => e.id)])];
    // (parts short of what its plan has them whole: it stands, not whole; not let as a home)
    const whole = planOf(ctx, { ...before.spec, label: st.label, self: id, ...(st.store ? { store: st.store } : {}) }) ?? before.plan;
    const unfinished = whole.elements.filter((e) => e.part && builtOf(ctx, id, e.id) < e.quantity - eps(e.quantity)).map((e) => e.id);
    const { unfinished: _u, ...rest2 } = rest;
    ctx.set('Structure', id, { ...rest2, plan: asBuilt, spec: before.spec, status: before.status, done, ...(unfinished.length ? { unfinished } : {}) });
    if (differ.length) ctx.log('warn', `${st.label}: the work on it is given up; it stands as it is built, not as it was planned: ${differ.map((e) => `${e.label} ${Math.round(e.quantity * 100) / 100} (was ${Math.round((before.plan.elements.find((x) => x.id === e.id)?.quantity ?? 0) * 100) / 100})`).join(', ')}.`, [id]);
    else ctx.log('info', `${st.label}: the work on it is given up; it is as it was.`, [id]);
    return;
  }
  ctx.set('Structure', id, { ...rest, status: 'cancelled' });
  // (said of the structure, as a revision given up is: Qwen S224; and nothing built is said so, not "what is built
  // stays": S509 read it as a half-built thing left ownerless; what is built is taken down by structures.demolish)
  const any = st.plan.elements.some((e) => e.part && builtOf(ctx, id, e.id) > 1e-9);
  if (!st.plan.kit) ctx.log('info', any ? `${st.label}: the work on it is given up; what is built of it stays as it is (to take it down: structures.demolish).` : `${st.label}: nothing of it is built yet; the work on it is called off.`, [id]);
  ctx.emit('structures.cancelled', { structure: id });
}

/** the latest package that built an element of a structure (any project of it) */
function lastPackageOf(read: ReadCtx, id: EntityId, element: string): EntityId | undefined {
  let out: EntityId | undefined;
  for (const [, pr] of read.all('Project')) {
    if (pr.owner !== 'structures' || pr.ref !== id) continue;
    for (const pid of pr.packages) {
      const d = read.get('WorkPackage', pid)?.data as { element?: string; removal?: boolean } | undefined;
      if (d?.element === element && !d.removal) out = pid;
    }
  }
  return out;
}

/** an element done: what its work does to the site, its workmanship, and said (the buildings place a part) */
function partDone(ctx: WriteCtx, id: EntityId, el: PlanElement, pkg: EntityId): void {
  const st = ctx.require('Structure', id);
  const w = ctx.port('production').workmanship(pkg);
  ctx.set('Structure', id, { ...st, done: [...new Set([...st.done, el.id])], ...(el.part && w !== null ? { workmanship: { ...st.workmanship, [el.id]: w } } : {}) });
  ctx.emit('structures.elementDone', { structure: id, element: el.id, package: pkg });
}

/** a plan with its parts at what is built (a revision given up half way): the parts it had, and parts added since that are built */
function asBuiltPlan(read: ReadCtx, id: EntityId, plan: Plan, revised: Plan): Plan {
  const parts = plan.elements.map((e) => (e.part ? { ...e, quantity: builtOf(read, id, e.id) } : e));
  const added = revised.elements.filter((e) => e.part && !plan.elements.some((x) => x.id === e.id)).map((e) => ({ ...e, quantity: builtOf(read, id, e.id) })).filter((e) => e.quantity > 1e-9);
  return { ...plan, elements: [...parts, ...added] };
}

/** whether any of it has been built (an element done, or work on one under way) */
function begun(read: ReadCtx, st: Readonly<Structure>): boolean {
  if (st.builtAt !== undefined || st.done.length > 0) return true;
  const pr = st.project ? read.get('Project', st.project) : undefined;
  // (work under way counts what it has laid this hour too)
  return (pr?.packages ?? []).some((pid) => {
    const w = read.get('WorkPackage', pid);
    return w && (w.accounted > 1e-9 || (w.status === 'active' && read.port('production').progress(pid) > 1e-9));
  });
}

/** a structure taken down altogether: gone from the land, and off its holder's books */
function gone(ctx: WriteCtx, id: EntityId, st: Readonly<Structure>, message: string): void {
  if ((st.bookValue ?? 0) > 0) ctx.ledger.post({ from: acct(st.holder, ACCOUNTS.buildings), to: acct(st.holder, ACCOUNTS.assetLoss), amount: st.bookValue!, memo: `${st.label}: taken down, written off`, category: ACCOUNTS.assetLoss, refs: [id] });
  const { demolishing: _d, ...rest } = st;
  ctx.set('Structure', id, { ...rest, status: 'demolished', done: [], ...(st.bookValue !== undefined ? { bookValue: 0 } : {}) });
  ctx.blockers.clear(id);
  ctx.emit('structures.demolished', { structure: id });
  ctx.log('warn', message, [id]);
}

/** the packages of a structure's running project, by element (the latest not cancelled) */
function packagesByElement(read: ReadCtx, st: Readonly<Structure>): Map<string, EntityId> {
  const out = new Map<string, EntityId>();
  const pr = st.project ? read.get('Project', st.project) : undefined;
  if (!pr || (pr.status !== 'active' && pr.status !== 'paused')) return out;
  for (const id of pr.packages) {
    const pkg = read.get('WorkPackage', id);
    const el = (pkg?.data as { element?: string; removal?: boolean } | undefined);
    if (!pkg || !el?.element || el.removal || pkg.status === 'cancelled') continue;
    out.set(el.element, id);
  }
  return out;
}

/** a plan without some elements: what followed them follows what they followed */
function withoutElements(elements: PlanElement[], drop: string[]): PlanElement[] {
  const gone = new Map(elements.filter((e) => drop.includes(e.id)).map((e) => [e.id, e]));
  const inherit = (ids: string[]): string[] => [...new Set(ids.flatMap((a) => (gone.has(a) ? inherit(gone.get(a)!.after) : [a])))];
  return elements.filter((e) => !gone.has(e.id)).map((e) => ({ ...e, after: inherit(e.after) }));
}

/** every element that rests on `id` in a plan (follows it, directly or not) */
function dependents(elements: PlanElement[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (x: string) => {
    for (const e of elements) if (e.after.includes(x) && !out.has(e.id)) (out.add(e.id), walk(e.id));
  };
  walk(id);
  return out;
}

/**
 * The work a revised plan asks for, against what is built and under way. Elements added are built;
 * those not begun are dropped or redrawn; built elements no longer wanted (or wanted smaller) are
 * taken down; built elements that grow are extended; and what rests on an element that changes (a
 * roof on walls that rise) comes off first and goes back on after.
 */
function revisionWork(ctx: WriteCtx, id: EntityId, st: Readonly<Structure>, next: Plan, round: number) {
  const old = new Map(st.plan.elements.map((e) => [e.id, e]));
  const neu = new Map(next.elements.map((e) => [e.id, e]));
  const pkgs = packagesByElement(ctx, st);
  const done = (x: string) => st.done.includes(x);
  const pr = st.project ? ctx.get('Project', st.project) : undefined;
  const running = pr && (pr.status === 'active' || pr.status === 'paused');
  // every open piece of work on an element (building it, extending it, taking it off)
  const openOf = (x: string): EntityId[] =>
    running
      ? pr!.packages.filter((pid) => {
          const w = ctx.get('WorkPackage', pid);
          return w && w.status !== 'done' && w.status !== 'cancelled' && (w.data as { element?: string } | undefined)?.element === x;
        })
      : [];
  const eps = (q: number) => Math.max(1e-6, q * 1e-6);
  const changed = new Set<string>();
  for (const [x, e] of neu) {
    const o = old.get(x);
    if (!o || Math.abs(e.quantity - o.quantity) > eps(o.quantity)) changed.add(x);
  }
  for (const x of old.keys()) if (!neu.has(x)) changed.add(x);
  // built parts resting on a changed part come off and go back on
  const redo = new Set<string>();
  for (const x of changed) if (old.get(x)?.part) for (const y of dependents(st.plan.elements, x)) if (done(y) && old.get(y)?.part && neu.has(y) && !changed.has(y)) redo.add(y);
  const add: PackageSpec[] = [];
  const cancel: EntityId[] = [];
  const keyOf = new Map<string, string>();
  const key = (x: string, what: string) => `${x}.${what}.${round}`;
  const removal = (el: PlanElement, q: number, full: boolean, keep = 0): string => {
    const k = key(el.id, 'off');
    add.push(removalSpec(ctx, id, el, q, full, keep, next.pos, k));
    return k;
  };
  const removals: string[] = [];
  // parts that are built at their new size once what is under way stops
  const finished: string[] = [];
  let removed = 0;
  let redrawn = 0;
  // what changes, or comes off to go on again, has its open work stopped: the new work is sized from what is built
  // (a build, an extension or a taking off under way, of this round or an earlier one)
  for (const x of old.keys()) {
    if (!changed.has(x) && !redo.has(x)) continue;
    const open = openOf(x);
    cancel.push(...open);
    if (open.some((pid) => !(ctx.require('WorkPackage', pid).data as { removal?: boolean }).removal && ctx.require('WorkPackage', pid).accounted <= 1e-9 && ctx.require('WorkPackage', pid).status !== 'active') && neu.has(x)) redrawn += 1;
  }
  // take down first: what is no longer wanted, what is built beyond its new size, what rests on a change
  for (const [x, o] of old) {
    if (!o.part) continue;
    const e = neu.get(x);
    const built = builtOf(ctx, id, x);
    if (!e) {
      if (built > eps(o.quantity)) (removals.push(removal(o, built, true)), (removed += 1));
    } else if (redo.has(x)) {
      removals.push(removal(o, Math.max(o.quantity, built), true));
      removed += 1;
    } else if (changed.has(x) && built > e.quantity + eps(e.quantity)) {
      // (at its new size once this comes off: it is built)
      removals.push(removal(o, built - e.quantity, false, e.quantity));
      removed += 1;
      finished.push(x);
    }
  }
  // then build: what is new, what is short of its new size, what is redrawn, what goes back on
  const builds: { el: PlanElement; q: number; what: string; extension: boolean }[] = [];
  for (const [x, e] of neu) {
    const o = old.get(x);
    if (!o) builds.push({ el: e, q: e.quantity, what: 'new', extension: false });
    else if (redo.has(x)) builds.push({ el: e, q: e.quantity, what: 'again', extension: false });
    else if (e.site?.ground && (changed.has(x) || !openOf(x).length)) {
      // (earthworks: the plan revised measured what is left on the ground as it is now, r40: the pit already dug is
      // not dug again, the new end of the plot is stripped)
      if (e.quantity > 0.5 && !openOf(x).length) builds.push({ el: e, q: e.quantity, what: done(x) ? 'more' : 'new', extension: done(x) });
    } else if (changed.has(x) || (!done(x) && !openOf(x).length)) {
      // (changed, or left short by work given up with nothing under way now: what is built is reckoned)
      const built = builtOf(ctx, id, x);
      if (e.quantity - built > eps(e.quantity)) builds.push({ el: e, q: e.quantity - built, what: built > eps(e.quantity) ? 'more' : 'new', extension: built > eps(e.quantity) });
      else if (built > 1e-9 && !done(x)) finished.push(x);
    }
  }
  for (const b of builds) keyOf.set(b.el.id, key(b.el.id, b.what));
  // work planned and not begun that follows a part drawn anew waits for it: drawn anew after it in turn
  // (a roof on walls redrawn would otherwise follow what the old walls followed)
  for (let more = true; more; ) {
    more = false;
    for (const [y, e] of neu) {
      if (keyOf.has(y) || !e.after.some((a) => keyOf.has(a))) continue;
      const open = openOf(y).filter((pid) => !(ctx.require('WorkPackage', pid).data as { removal?: boolean }).removal && !cancel.includes(pid));
      const begunOne = open.some((pid) => {
        const w = ctx.require('WorkPackage', pid);
        return w.status === 'active' || w.status === 'hold' || w.accounted > 1e-9;
      });
      if (!open.length || begunOne) continue;
      cancel.push(...open);
      const built = builtOf(ctx, id, y);
      if (e.quantity - built <= eps(e.quantity)) continue;
      const extension = built > eps(e.quantity);
      builds.push({ el: e, q: e.quantity - built, what: 'after', extension });
      keyOf.set(y, key(y, 'after'));
      redrawn += 1;
      more = true;
    }
  }
  const existingKey = (x: string) => {
    const pid = pkgs.get(x);
    const w = pid ? ctx.get('WorkPackage', pid) : undefined;
    return w && !cancel.includes(pid!) ? w.key : undefined;
  };
  for (const b of builds) {
    if (b.q <= 1e-9) continue;
    const after = [...new Set([...b.el.after.map((a) => keyOf.get(a) ?? existingKey(a)).filter((k): k is string => Boolean(k)), ...(changed.has(b.el.id) || redo.has(b.el.id) ? removals : [])])];
    // (laid alongside what is laid with it in this revision: r41)
    const alongside = (b.el.with ?? []).map((a) => keyOf.get(a)).filter((k): k is string => Boolean(k) && !after.includes(k!));
    add.push({
      key: keyOf.get(b.el.id)!,
      activity: b.el.activity,
      label: b.extension ? `${b.el.label} (more)` : b.what === 'again' ? `${b.el.label} (again)` : b.el.label,
      quantity: b.q,
      pos: next.pos,
      ...(after.length || alongside.length ? { after: [...after.map((k) => ({ key: k, type: 'FS' as const })), ...alongside.map((k) => ({ key: k, type: 'SS' as const }))] } : {}),
      ...(b.el.site?.haulTo ? { haulTo: b.el.site.haulTo } : {}),
      ...(b.el.site?.soilClass ? { soilClass: b.el.site.soilClass } : {}),
      ...(b.el.site?.soilDepth !== undefined ? { soilDepth: b.el.site.soilDepth } : {}),
      ...producesOf(b.el.site, st.stores),
      data: { structure: id, element: b.el.id, ...(b.extension ? { extension: true } : {}) },
    });
  }
  return { add: orderRemovals(add, st.plan.elements), cancel: [...new Set(cancel)], removed, redrawn, finished };
}

/** removals in order: a part comes off after what rests on it (the roof before the walls under it) */
function orderRemovals(specs: PackageSpec[], elements: PlanElement[]): PackageSpec[] {
  const offKey = new Map(specs.filter((x) => (x.data as { removal?: boolean } | undefined)?.removal).map((x) => [(x.data as { element: string }).element, x.key]));
  return specs.map((x) => {
    const d = x.data as { removal?: boolean; element?: string } | undefined;
    if (!d?.removal || !d.element) return x;
    const on = [...dependents(elements, d.element)].map((y) => offKey.get(y)).filter((k): k is string => Boolean(k) && k !== x.key);
    if (!on.length) return x;
    const after = [...(x.after ?? []), ...on.filter((k) => !(x.after ?? []).some((a) => a.key === k)).map((k) => ({ key: k, type: 'FS' as const }))];
    return { ...x, after };
  });
}

/** taking a part off (q: how much is expected to come off, for the hours; keep: how much of it stays: what comes off is reckoned when the work is done, from what is built then) */
function removalSpec(ctx: WriteCtx, id: EntityId, el: PlanElement, q: number, full: boolean, keep: number, pos: Vec2, key: string): PackageSpec {
  const set = ctx.data('structureSettings');
  const hours = q > 1e-9 ? ctx.port('production').estimate({ activity: el.activity, quantity: q, pos }, ctx.get('Structure', id)?.holder).hours : 0;
  return { key, activity: set.removal.activity, label: `Take down ${el.label}${full ? '' : ' (part)'}`, quantity: Math.max(0.1, set.removal.share.value * hours), pos, data: { structure: id, element: el.id, removal: true, full, keep, built: el.activity } };
}

/** what an element's work produces, into the structure's heaps (by their keys) */
function producesOf(site: PlanElement['site'], stores: Record<string, EntityId>): { produces?: Produce[]; fells?: Fells; ground?: GroundWork; consumes?: Record<string, number>; store?: EntityId; params?: Record<string, number>; substitutes?: Record<string, { material: string; perUnit: number }> } {
  const out = (site?.produces ?? []).filter((o) => stores[o.store]).map((o) => ({ material: o.material, perUnit: o.perUnit, store: stores[o.store]! }));
  const fells = site?.fells && stores[site.fells.store] ? { ...site.fells, store: stores[site.fells.store]! } : undefined;
  // (the ground it digs or fills, its heap by key; what it lays drawn from a heap of the structure's)
  const g = site?.ground;
  const { store: key, ...rest } = g ?? { op: 'dig' as const, cells: [] };
  const ground: GroundWork | undefined = g?.cells.length ? { ...rest, ...(key && stores[key] ? { store: stores[key]! } : {}) } : undefined;
  const from = site?.from ? stores[site.from] : undefined;
  return { ...(out.length ? { produces: out } : {}), ...(fells ? { fells } : {}), ...(ground ? { ground } : {}), ...(site?.consumes ? { consumes: site.consumes } : {}), ...(from ? { store: from } : {}), ...(site?.params ? { params: site.params } : {}), ...(site?.substitutes ? { substitutes: site.substitutes } : {}) };
}

/** the key of an element's lift (its last under the element's own key: what follows the whole follows it) */
const liftKey = (el: PlanElement, i: number): string => (!el.lifts || i === el.lifts.length - 1 ? el.id : `${el.id}.${i + 1}`);

/**
 * the work of a plan as production packages: an element built in lifts as one package a lift (H1), each after its lift
 * below and on the highest lift of what it stands on (`on`, and `after` among lifted elements) that tops out at or
 * below its foot; laid alongside the lift of the same levels. What follows a lifted element follows its last lift.
 */
function packagesOf(plan: Plan, structure: EntityId, stores: Record<string, EntityId>): PackageSpec[] {
  const live = plan.elements.filter((el) => el.quantity > 1e-9);
  const byId = new Map(live.map((el) => [el.id, el]));
  // (the lift of `other` a lift with its foot at `foot` follows; none when all of it is above)
  const below = (other: PlanElement, foot: number): string | undefined => {
    if (!other.lifts) return other.id;
    let found: number | undefined;
    other.lifts.forEach((l, i) => {
      if (l.to <= foot + 1e-9) found = i;
    });
    return found === undefined ? undefined : liftKey(other, found);
  };
  return live.flatMap((el) => {
    const lifts = el.lifts ?? [undefined];
    return lifts.map((lift, i) => {
      const after: { key: string; type: 'FS' | 'SS' }[] = [];
      const add = (key: string | undefined, type: 'FS' | 'SS') => {
        if (key && !after.some((a) => a.key === key)) after.push({ key, type });
      };
      if (i > 0) add(liftKey(el, i - 1), 'FS');
      for (const a of el.after) {
        const o = byId.get(a);
        if (!o) continue;
        // (the whole after a lifted one: after its last; a lift after what is below its foot; the first lift after the rest)
        if (lift && o.lifts) add(below(o, lift.from), 'FS');
        else if (i === 0) add(o.id, 'FS');
      }
      for (const a of lift ? (el.on ?? []) : []) {
        const o = byId.get(a);
        if (o) add(below(o, lift!.from), 'FS');
      }
      for (const a of el.with ?? []) {
        const o = byId.get(a);
        if (!o) continue;
        const j = lift && o.lifts ? o.lifts.findIndex((l) => Math.abs(l.from - lift.from) < 1e-9 && Math.abs(l.to - lift.to) < 1e-9) : -1;
        if (j >= 0) add(liftKey(o, j), 'SS');
        else if (!lift || !o.lifts) add(o.id, 'SS');
      }
      return {
        key: liftKey(el, i),
        activity: el.activity,
        label: lift ? `${el.label} (${lift.label})` : el.label,
        quantity: el.quantity / lifts.length,
        pos: plan.pos,
        ...(after.length ? { after } : {}),
        ...(el.site?.haulTo ? { haulTo: el.site.haulTo } : {}),
        ...(el.site?.soilClass ? { soilClass: el.site.soilClass } : {}),
        ...(el.site?.soilDepth !== undefined ? { soilDepth: el.site.soilDepth } : {}),
        ...producesOf(el.site, stores),
        data: { structure, element: el.id, ...(lift && i < lifts.length - 1 ? { lift: i + 1 } : {}) },
      };
    });
  });
}

/**
 * The ground settles under a structure that presses it harder than it carries without harm: what
 * stands on the walls and in the ground cracks, the more the harder (its grade rises to at least
 * 1 + 3 × the excess), legibly.
 */
function settle(ctx: WriteCtx, id: EntityId, st: Readonly<Structure>, u: number): void {
  const cracked = Math.min(4.5, 1 + 3 * (u - 1));
  const cond = ctx.get('StructureCondition', id);
  const onIt = new Set(st.plan.elements.filter((e) => e.place?.on === 'walls' || e.place?.on === 'ground').map((e) => e.id));
  if (cond) {
    const elements = cond.elements.map((x) => (onIt.has(x.id) && x.grade < cracked ? { ...x, grade: cracked, condition: 1 - (cracked - 1) / 4 } : x));
    if (elements.some((x, i) => x !== cond.elements[i])) ctx.set('StructureCondition', id, { ...cond, elements });
  }
  const first = !ctx.blockersOf(id).some((b) => b.code === 'structures.settling');
  ctx.blockers.set(id, [{ code: 'structures.settling', severity: 'warn', params: { structure: st.label, pressure: Math.round(u * 100) } }]);
  if (first) ctx.log('warn', `${st.label} settles: the ground under it carries ${Math.round(100 / u)} % of what it presses; its walls crack.`, [id]);
}

// ------------------------------------------------------------------ the module

/** the administrator packs up what stands on wheels of a party being wound up (the machine is then offered) */
function packUpForSale(ctx: WriteCtx, party: EntityId): void {
  // (on the party's own vehicles, whoever set them up: a caravan lent and set up by the borrower too, once it is asked back)
  for (const [id, st] of [...ctx.all('Structure')]) if (st.status === 'standing' && ctx.get('Machine', id)?.holder === party && ownerOf(ctx, id, st) === party) ctx.command('structures.strike', { structure: id });
}

/**
 * Frost heave: frost below a peg's or post's foot in wet, frost-susceptible ground (its frost class at that
 * depth) grips and lifts it a little each day; it does not settle back. Said as it comes out by quarters.
 */
function frostHeave(ctx: WriteCtx, id: EntityId, st: Readonly<Structure>): Pick<Structure, 'heaved' | 'heaveDays' | 'heaveClass'> | undefined {
  const embed = st.plan.physics.embed?.value;
  const heave = ctx.data('structureSettings').frostHeave;
  if (!embed || !heave || !ctx.hasPort('soil-state')) return undefined;
  const soil = ctx.port('soil-state');
  const [x, z] = st.plan.pos;
  // ice lenses grow while the ground freezes: a day of frost (not a thaw drawing the frost back), reaching below the foot, in wet ground
  if (!(ctx.port('weather').day(ctx.now - DAY).tMean < 0) || soil.frostDepthAt(x, z) <= embed || soil.moistureAt(x, z) < heave.wet.value) return undefined;
  const terrain = ctx.port('terrain');
  // (the ground at the foot as it is now: the strata below the surface after a cut or a fill, §5)
  const depth = Math.max(0.01, embed);
  const cls = terrain.soilClass(terrain.soilClassAtDepth(x, z, depth)).frostClass;
  const rate = heave.perDay[cls]?.value ?? 0;
  if (!(rate > 0)) return undefined;
  const was = st.heaved ?? 0;
  const now = Math.min(embed, was + rate);
  const quarter = (h: number) => Math.floor((h / embed) * 4 + 1e-9);
  // (said when it first begins, and as they come out by quarters)
  if (was === 0 || quarter(now) > quarter(was)) {
    const out = now >= embed - 1e-9;
    // what they are and how they go back: a kit's pegs are pitched again; a built thing's posts dug in again by taking it down and building it again
    const what = st.plan.kit ? 'pegs' : 'posts';
    const way = st.plan.kit ? 'struck and pitched again, they hold fully' : 'taken down and built again, its posts are dug in once more';
    ctx.log('warn', out ? `Frost has lifted the ${what} of ${st.label} out of the ground: nothing holds it against the wind now (${way}).` : `Frost has lifted the ${what} of ${st.label} by ${Math.round(now * 100)} cm of ${Math.round(embed * 100)}: they hold ${Math.round((1 - now / embed) * 100)} % of what they did (${way}).`, [id]);
  }
  return { heaved: now, heaveDays: (st.heaveDays ?? 0) + 1, heaveClass: cls };
}

/** how much of a part is built: what its work did (in every project of the structure; work given up half way too), less what was taken off again */
function builtOf(read: ReadCtx, id: EntityId, element: string): number {
  let built = 0;
  for (const [, pr] of read.all('Project')) {
    if (pr.owner !== 'structures' || pr.ref !== id) continue;
    for (const pid of pr.packages) {
      const w = read.get('WorkPackage', pid);
      const d = w?.data as { structure?: EntityId; element?: string; removal?: boolean } | undefined;
      // (work under way counts what it has laid so far, this hour too)
      if (w && d?.element === element && !d.removal) built += w.status === 'active' && w.process ? Math.max(w.accounted, read.port('production').progress(pid) * w.quantity) : w.accounted;
    }
  }
  return Math.max(0, built - (read.get('Structure', id)?.taken?.[element] ?? 0));
}

/** how much of each element is built (I8: what stands is answered for as it is built, whatever its status); an element of nothing is there */
function builtShares(read: ReadCtx, id: EntityId): Built {
  const st = read.require('Structure', id);
  // (and what it is losing, taken down or revised away, while it stands: r41)
  const gone = (st.before?.plan.elements ?? []).filter((e) => !st.plan.elements.some((x) => x.id === e.id));
  return Object.fromEntries([...st.plan.elements, ...gone].map((e) => [e.id, e.quantity > 1e-9 ? Math.min(1, builtOf(read, id, e.id) / e.quantity) : 1]));
}

/**
 * Walls going up blown over (r41): only they come down, the storeys below standing braced. What they were built of lies
 * by it, broken; the work lays them again (after the walls under way, when there is work on it).
 */
function wallsFall(ctx: WriteCtx, id: EntityId, st: Readonly<Structure>, height: number, why: string): boolean {
  const b = st.plan.physics.bearing;
  const u = b?.unbraced;
  const el = u ? st.plan.elements.find((e) => e.id === u.walls) : undefined;
  if (!b || !u || !el || !b.storey) return false;
  const q = Math.min(builtOf(ctx, id, el.id), (el.quantity / b.floors) * (height / b.storey));
  if (!(q > 1e-6)) return false;
  salvage(ctx, id, st, materialsOf(ctx, el.activity, q), st.builtAt);
  ctx.patch('Structure', id, { taken: { ...(st.taken ?? {}), [el.id]: (st.taken?.[el.id] ?? 0) + q } });
  const pr = st.project ? ctx.get('Project', st.project) : undefined;
  if (pr && (pr.status === 'active' || pr.status === 'paused')) {
    const running = pr.packages.map((pid) => ctx.get('WorkPackage', pid)).find((w) => w && (w.data as { element?: string } | undefined)?.element === el.id && w.status !== 'done' && w.status !== 'cancelled');
    ctx.command('production.extendProject', { project: st.project!, packages: [{ key: `${el.id}.again.${Math.floor(ctx.now)}`, activity: el.activity, label: `${el.label} (laid again)`, quantity: q, pos: st.plan.pos, ...(running ? { after: [{ key: running.key, type: 'FS' as const }] } : {}), data: { structure: id, element: el.id } }] });
  }
  ctx.log('error', `The storey being laid on ${st.label} has come down in the wind while it was being built: ${why}; ${Math.round(q * 10) / 10} ${ctx.data('activities')[el.activity]?.unit ?? ''} of ${el.label.toLowerCase()} lie broken by it${pr && (pr.status === 'active' || pr.status === 'paused') ? ' and are laid again' : ''}.`, [id]);
  return true;
}

/** since when a part has stood, by what its work laid (each piece from when its work was done): what seasons in it (brash rots) is as old */
function builtSince(read: ReadCtx, id: EntityId, element: string): number | undefined {
  let q = 0;
  let t = 0;
  for (const [, pr] of read.all('Project')) {
    if (pr.owner !== 'structures' || pr.ref !== id) continue;
    for (const pid of pr.packages) {
      const w = read.get('WorkPackage', pid);
      const d = w?.data as { element?: string; removal?: boolean } | undefined;
      if (!w || d?.element !== element || d.removal || !(w.accounted > 0)) continue;
      q += w.accounted;
      t += w.accounted * (w.completedAt ?? w.cancelledAt ?? read.now);
    }
  }
  return q > 0 ? Math.round(t / q) : undefined;
}

/** the materials so much of a part's work is made of: what the work draws, and what a firm's trade brings (its deliveries, r41) */
const materialsOf = (read: ReadCtx, activity: string, q: number): Record<string, number> => {
  const a = read.data('activities')[activity];
  const out: Record<string, number> = Object.fromEntries(Object.entries(a?.materials ?? {}).map(([mat, per]) => [mat, per.value * q]));
  const d = a?.subcontract?.deliveries;
  if (d) out[d.material] = (out[d.material] ?? 0) + (d.perUnit.value * q * 1000) / unitMass(read.port('holdings').material(d.material));
  return out;
};

/** where what comes off a structure is set down: a store of its holder by it that takes it all (not a vessel for one thing), or a heap made there */
function offStore(ctx: WriteCtx, id: EntityId, st: Readonly<Structure>, materials: string[]): EntityId | undefined {
  const hold = ctx.port('holdings');
  const reach = ctx.hasData('handling') ? (ctx.data('handling')?.reach.value ?? 15) : 15;
  const [x, z] = st.plan.pos;
  const by = hold.ofParty(st.holder, { kind: ['depot', 'stockpile', 'site'] }).find((s0) => hold.near(s0, [x, z], reach) && materials.every((m) => hold.accepts(s0, m)));
  if (by) return by;
  const made = ctx.command('inventory.createStore', { holder: st.holder, label: `${st.label}: what came off`, kind: 'stockpile', pos: [x, z] });
  return made.ok ? (made.value as EntityId) : undefined;
}

/**
 * A kit packed up, or half put up and given up: all that is built into it comes off where it stands (design/
 * physical-state.md I1: it is not carried back to where it came from by itself), a good that keeps its age as
 * old as it now is.
 */
function offBuilt(ctx: WriteCtx, id: EntityId, st: Readonly<Structure>, why: string, age?: number): void {
  const hold = ctx.port('holdings');
  // what is put up of it, and its pieces still lying at its work fronts: packed together
  const from = hold.ofWork(id).filter((sid) => hold.kind(sid) === 'built' || hold.kind(sid) === 'front');
  const goods = new Map<string, number>();
  for (const sid of from) for (const [m, q] of Object.entries(hold.contents(sid))) if (q > 1e-9) goods.set(m, (goods.get(m) ?? 0) + q);
  if (!goods.size) return;
  const store = offStore(ctx, id, st, [...goods.keys()]);
  if (!store) return;
  for (const sid of from) {
    for (const [mat, qty] of Object.entries(hold.contents(sid))) {
      if (qty > 1e-9) ctx.command('inventory.transfer', { from: sid, to: store, material: mat, qty, why, ...(age !== undefined && hold.material(mat).keepsAge ? { age } : {}) });
    }
    if (hold.kind(sid) === 'front') {
      ctx.blockers.clear(sid);
      ctx.command('inventory.closeStore', { store: sid });
    }
  }
  ctx.log('info', `${why}: ${[...goods].map(([m, q]) => `${Math.round(q * 100) / 100} ${hold.material(m).unit} ${hold.material(m).label}`).join(', ')} set down at ${hold.label(store)}.`, [id, store]);
}

/**
 * What comes off a part taken down: what it was built of, out of what is built into the structure (design/
 * physical-state.md I1): the share of each material that can be used again whole, the rest broken (as what it
 * breaks into, by mass, or as mixed rubble where nothing is said of it: never nothing), set down by the structure
 */
function salvage(ctx: WriteCtx, id: EntityId, st: Readonly<Structure>, materials: Record<string, number>, builtAt?: number): void {
  const hold = ctx.port('holdings');
  const built = hold.ofWork(id, 'built')[0];
  if (!built) return;
  const there = hold.contents(built);
  const rubble = ctx.data('materials')['waste.construction'] ? 'waste.construction' : undefined;
  const parts: { material: string; qty: number; whole: number; rest?: string; restQty: number }[] = [];
  for (const [mat, want] of Object.entries(materials)) {
    // (all of it when what would be left is a rounding residue)
    const all = there[mat] ?? 0;
    const qty = all - Math.min(want, all) <= tolerance(all) ? all : want;
    if (!(qty > 1e-9)) continue;
    const m = hold.material(mat);
    const share = m.salvage?.share ?? 0;
    const whole = m.unit === 'pcs' ? Math.floor(qty * share + 1e-9) : qty * share;
    const rest = m.salvage?.rest ?? rubble;
    const restQty = rest ? ((qty - whole) * unitMass(m)) / unitMass(hold.material(rest)) : 0;
    parts.push({ material: mat, qty, whole, ...(rest ? { rest } : {}), restQty });
  }
  if (!parts.length) return;
  const store = offStore(ctx, id, st, [...new Set(parts.flatMap((p) => [p.material, ...(p.rest ? [p.rest] : [])]))]);
  if (!store) return;
  const said: string[] = [];
  for (const p of parts) {
    const m = hold.material(p.material);
    if (p.whole > 1e-9) {
      ctx.command('inventory.transfer', { from: built, to: store, material: p.material, qty: p.whole, why: `${st.label}: taken down` });
      said.push(`${Math.round(p.whole * 100) / 100} ${m.unit} ${m.label.toLowerCase()}`);
    }
    // (what is left of it in the built holding: rounding never takes more than is there)
    const broken = Math.min(p.qty - p.whole, hold.stock(built, p.material));
    if (broken > 1e-9 && p.rest && p.restQty > 1e-9) {
      p.restQty = (broken * unitMass(hold.material(p.material))) / unitMass(hold.material(p.rest));
      // broken: what it breaks into, by mass (a transform where it was built), then set down with the rest
      // (when it was built in: what it breaks into is as old as it, and goes on as it would have where it lay)
      const since = hold.sinceIn(built, p.material) ?? builtAt;
      const t = ctx.command('inventory.transform', { at: built, take: [{ material: p.material, qty: broken }], give: [{ material: p.rest, qty: p.restQty, ...(since !== undefined ? { since } : {}) }], why: `${st.label}: taken down (broken)` });
      if (!t.ok) throw new Error(`salvage ${st.label}: ${JSON.stringify(t.reasons)}`);
      ctx.command('inventory.transfer', { from: built, to: store, material: p.rest, qty: p.restQty, why: `${st.label}: taken down (broken)` });
      const r = hold.material(p.rest);
      said.push(`${Math.round(p.restQty * 100) / 100} ${r.unit} ${r.label.toLowerCase()} (broken)`);
    }
  }
  if (said.length) ctx.log('info', `Taken off ${st.label}: ${said.join(', ')}, onto ${hold.label(store) ?? store}.`, [id, store]);
}

/**
 * The part of the day just past a structure stood through, if it was put up in it: the rain (mm) and the snow
 * (kg/m², as water) that fell since, and the mean wind of those hours. Undefined: it stood all day.
 */
function stoodThrough(ctx: ReadCtx, st: Readonly<Structure>, day: { wind: number }): { rain: number; snow: number; wind: number } | undefined {
  const start = ctx.now - DAY;
  if (st.builtAt === undefined || st.builtAt <= start) return undefined;
  const w = ctx.port('weather');
  let rain = 0;
  let snow = 0;
  let wind = 0;
  let n = 0;
  for (let t = Math.floor(st.builtAt / HOUR) * HOUR; t < ctx.now; t += HOUR) {
    const h = w.hour(t);
    const f = Math.min(1, (Math.min(ctx.now, t + HOUR) - Math.max(t, st.builtAt)) / HOUR);
    if (h.snow) snow += h.precip * f;
    else rain += h.precip * f;
    wind += h.wind * f;
    n += f;
  }
  return { rain, snow, wind: n > 0 ? wind / n : day.wind };
}

/**
 * Fire (8h, VISION "Fire is one process"): what is alight now, each hour. A fire being tended (rubbish, a brush pile) or
 * a structure burning sets alight what burns within its reach and the thing's own catching distance, farther downwind
 * (sparks); never by chance. What burns burns at its rate, to the air, until it is burnt out (it comes down) or put out.
 */
function fires(ctx: WriteCtx): void {
  const set = ctx.data('structureSettings').fire;
  if (!set) return;
  const acts = ctx.data('activities');
  // what was on fire in the hour just past, and for how long of it (h): fires of goods being burnt (their heat's reach),
  // however short (a brush pile burnt down in 52 minutes between two hours: S504), and structures burning (as large as
  // they are, all the hour)
  const sources: { pos: Vec2; half: number; reach: number; hours: number; until: number; label: string; by?: EntityId; offence?: boolean }[] = [];
  const seen = ctx.state('structures').fires;
  const alight: Record<EntityId, number> = {};
  for (const [id, w] of ctx.all('WorkPackage')) {
    const f = acts[w.activity]?.fire;
    if (!f || w.status === 'waiting' || w.status === 'ready') continue;
    // (the hours it has burnt: those booked, and those since; one not alight at the last reckoning burnt only since it,
    // if it started since)
    const burnt = w.workedHours + (w.activeSince !== undefined ? (ctx.now - w.activeSince) / HOUR : 0);
    if (w.status === 'active') alight[id] = burnt;
    if (seen[id] === undefined && !((w.startedAt ?? -Infinity) > ctx.now - HOUR)) continue;
    const hours = Math.min(1, burnt - (seen[id] ?? 0));
    const until = w.status === 'active' ? ctx.now : (w.completedAt ?? w.cancelledAt ?? ctx.now);
    if (hours > 1e-6) sources.push({ pos: w.pos, half: 0, reach: f.reach.value, hours, until, label: w.label, by: ctx.get('Project', w.project)?.party, offence: Boolean(acts[w.activity]?.offence) });
  }
  if (Object.keys(seen).length || Object.keys(alight).length) ctx.setState('structures', { fires: alight });
  const burning = [...ctx.all('Structure')].filter(([, st]) => st.burning);
  for (const [, st] of burning) sources.push({ pos: st.plan.pos, half: Math.max(st.plan.length, st.plan.width) / 2, reach: st.plan.physics.fire?.catches.value ?? 2, hours: 1, until: ctx.now, label: st.label, ...(st.burning!.by ? { by: st.burning!.by } : {}), ...(st.burning!.offence ? { offence: true } : {}) });
  if (!sources.length) return;
  // the wind now: which way the sparks go, and how far
  const h = ctx.port('weather').hour(ctx.now);
  const toward: Vec2 = [-Math.sin((h.windDir * Math.PI) / 180), Math.cos((h.windDir * Math.PI) / 180)];
  for (const [id, st] of [...ctx.all('Structure')]) {
    const f = st.plan.physics.fire;
    if (!f || st.burning || (st.status !== 'standing' && st.status !== 'building' && st.status !== 'cancelled')) continue;
    // (what burns of it: what is built into it, and a unit's own body; nothing built, nothing burns)
    const load = fireLoad(ctx, id, st);
    if (!(load > 1e-6)) continue;
    const half = Math.max(st.plan.length, st.plan.width) / 2;
    for (const src of sources) {
      const d: Vec2 = [st.plan.pos[0] - src.pos[0], st.plan.pos[1] - src.pos[1]];
      const dist = Math.hypot(d[0], d[1]);
      if (dist < 1e-6) continue;
      const gap = dist - half - src.half;
      const downwind = (d[0] * toward[0] + d[1] * toward[1]) / dist > Math.SQRT1_2;
      // within the reach of its heat it catches; beyond, as far as sparks and embers carry, it may (a chance an hour,
      // for as long of the hour as the fire burnt)
      const still = src.reach + f.catches.value;
      const sparks = still + (downwind ? set.windReach.value * h.wind : 0);
      if (gap > sparks) continue;
      // (put out in the hour: only what burnt on after that counts)
      const hours = st.putOut !== undefined ? Math.min(src.hours, Math.max(0, (src.until - st.putOut) / HOUR)) : src.hours;
      if (!(hours > 1e-6)) continue;
      if (gap > src.reach && !ctx.rng(`fire:${id}:${Math.floor(ctx.now / HOUR)}`).chance(1 - (1 - set.spark.value) ** hours)) continue;
      ctx.patch('Structure', id, { burning: { since: ctx.now, left: load, from: src.label, ...(src.by ? { by: src.by } : {}), ...(src.offence ? { offence: true } : {}) } });
      ctx.blockers.set(id, [{ code: 'structures.onFire', severity: 'block', params: { structure: st.label, from: src.label }, remedies: fightRemedies(ctx, id) }]);
      // (the wind is named only when it carried the sparks farther than they go on a still day)
      const how = gap <= src.reach ? '' : gap <= still ? ' (its sparks)' : ` (its sparks: the wind, ${Math.round(h.wind)} m/s, carries them)`;
      ctx.log('error', `${st.label} has caught fire from ${src.label}${how}.`, [id]);
      break;
    }
  }
  // what burns, burns at its rate: to the air as smoke, its ash and what does not burn left where it stood
  for (const [id] of burning) {
    const st = ctx.require('Structure', id);
    const f = st.plan.physics.fire!;
    const now = Math.min(st.burning!.left, f.rate.value);
    burn(ctx, id, now);
    const left = Math.max(0, st.burning!.left - now);
    if (left > 1e-6) {
      ctx.patch('Structure', id, { burning: { ...ctx.require('Structure', id).burning!, left } });
      continue;
    }
    burnedDown(ctx, id, 'and burnt down');
  }
}

/** what of a structure burns (kg): what is built into it that burns (its goods' `burns`), and a unit's own body (a caravan's) */
function fireLoad(read: ReadCtx, id: EntityId, st: Readonly<Structure>): number {
  const hold = read.port('holdings');
  let kg = read.get('Machine', id) ? (st.plan.physics.fire?.load?.value ?? 0) : 0;
  const built = hold.ofWork(id, 'built')[0];
  if (built) for (const [m, q] of Object.entries(hold.contents(built))) {
    const mat = hold.material(m);
    if (mat.burns && q > 0) kg += q * unitMass(mat) * mat.burns.share.value;
  }
  return kg;
}

/** the cheapest price of a good on offer (€ a unit), as what it is worth to replace */
const worth = (read: ReadCtx, material: string): number => Math.min(...read.port('trade').offers(material).map((o) => o.price), Infinity);

/**
 * `kg` of a structure burnt: of what is built into it that burns, its share (a piece of a kit burnt whole, the rest of
 * it fire debris), its ash left (wood ash, or with the debris), the rest gone to the air; a unit's own body burns to the
 * air with it. What was lost is reckoned at what it costs to replace
 */
function burn(ctx: WriteCtx, id: EntityId, kg: number): void {
  const st = ctx.require('Structure', id);
  const hold = ctx.port('holdings');
  const built = hold.ofWork(id, 'built')[0];
  if (!built || !(kg > 1e-9)) return;
  const contents = hold.contents(built);
  const own = ctx.get('Machine', id) ? (st.plan.physics.fire?.load?.value ?? 0) : 0;
  const goods = Object.entries(contents).map(([m, q]) => ({ m, q, mat: hold.material(m) })).filter((g) => g.mat.burns && g.q > 1e-9);
  const total = goods.reduce((a, g) => a + g.q * unitMass(g.mat) * g.mat.burns!.share.value, 0);
  if (!(total > 1e-9)) return;
  // (of the hour's burning, the share that falls on what is built in: the rest is the unit's own body)
  const r = Math.min(1, (kg * (total / (total + own))) / total);
  const take: { material: string; qty: number }[] = [];
  const left: Record<string, number> = {};
  let lost = 0;
  let pieces = false;
  for (const g of goods) {
    const um = unitMass(g.mat);
    const kgBurnt = g.q * um * g.mat.burns!.share.value * r;
    const ashAs = g.mat.burns!.ashAs ?? 'waste.fireDebris';
    left[ashAs] = (left[ashAs] ?? 0) + kgBurnt * g.mat.burns!.ash.value;
    if (g.mat.unit === 'pcs') {
      // (a piece of a kit burnt is a piece lost: what of it does not burn is fire debris)
      const n = Math.min(g.q, Math.ceil(g.q * r - 1e-9));
      take.push({ material: g.m, qty: n });
      left['waste.fireDebris'] = (left['waste.fireDebris'] ?? 0) + Math.max(0, n * um - kgBurnt);
      lost += n * (Number.isFinite(worth(ctx, g.m)) ? worth(ctx, g.m) : 0);
      pieces = true;
    } else {
      take.push({ material: g.m, qty: kgBurnt / um });
      lost += (kgBurnt / um) * (Number.isFinite(worth(ctx, g.m)) ? worth(ctx, g.m) : 0);
    }
  }
  const give = Object.entries(left).filter(([, q]) => q > 1e-9).map(([material, q]) => ({ material, qty: q / unitMass(hold.material(material)), into: built }));
  ctx.command('inventory.transform', { at: built, take, give, sink: 'air', why: `${st.label} burning` });
  const b = ctx.require('Structure', id).burning;
  if (b) ctx.patch('Structure', id, { burning: { ...b, lost: (b.lost ?? 0) + lost, ...(pieces ? { ruined: true } : {}) } });
}

/** burnt down, or put out ruined: it has come down, and one who set it alight with another's fire pays for it */
function burnedDown(ctx: WriteCtx, id: EntityId, how: string): void {
  const st = ctx.require('Structure', id);
  const b = st.burning!;
  const { burning: _b, ...rest } = st;
  ctx.set('Structure', id, rest);
  collapse(ctx, id, ctx.require('Structure', id), 'in a fire', `it caught fire from ${b.from} ${how}`, 'burnt out');
  liable(ctx, id, st, b, true);
}

/**
 * Whose fire set alight what is another's answers for it (§ 823 Abs. 1 BGB: property damaged by negligence, a fire lit
 * too near): a private claim of the holder for what it costs to replace what burnt, and to put it up again
 */
function liable(ctx: WriteCtx, id: EntityId, st: Readonly<Structure>, b: NonNullable<Structure['burning']>, rebuild: boolean): void {
  const owner = ownerOf(ctx, id, st);
  if (!b.by || b.by === owner || !ctx.get('Party', owner) || !ctx.hasData('claimLaw') || !ctx.data('claimLaw')?.private || !ctx.port('prices').hasBooks(b.by)) return;
  const amount = Math.round(((b.lost ?? 0) + (rebuild ? st.plan.estimate.cost : 0)) * 100) / 100;
  if (!(amount > 0)) return;
  ctx.command('agreements.contract', { instrument: 'claim', label: `Damages for ${st.label}, burnt by a fire of ${partyLabel(ctx, b.by)}`, holder: b.by, party: owner, role: 'debtor', terms: { kind: 'private', basis: '§ 823 Abs. 1 BGB (property damaged by negligence: a fire lit too near another’s)', about: id }, amount });
}

/** the water within a few steps of a fire (m) */
const FIRE_WATER = 30;

/** our people at a fire (within some 100 m, at work or about) */
function fighters(read: ReadCtx, party: EntityId, st: Readonly<Structure>): EntityId[] {
  const wf = read.port('workforce');
  const moves = read.port('moves');
  return wf.staff(party).filter((x) => {
    const w = moves.where(x);
    return wf.present(x) && w !== undefined && Math.hypot(w[0] - st.plan.pos[0], w[1] - st.plan.pos[1]) <= 100;
  });
}

/** the ways to fight a fire: our people at it with the water at hand, or the fire brigade (112) */
function fightRemedies(read: ReadCtx, id: EntityId): Remedy[] {
  return [
    { label: 'Put it out with the water at hand (our people there, buckets and canisters)', command: { type: 'structures.extinguish', payload: { structure: id } } },
    { label: 'Call the fire brigade (112)', command: { type: 'structures.callBrigade', payload: { structure: id } } },
  ];
}

/** the water within a few steps of a place, in a party's stores where they are now (litres), and where */
function waterAt(read: ReadCtx, party: EntityId, pos: Vec2, reach: number): { store: EntityId; material: string; litres: number; per: number }[] {
  const hold = read.port('holdings');
  const out: { store: EntityId; material: string; litres: number; per: number }[] = [];
  for (const sid of hold.ofParty(party)) {
    if (hold.kind(sid) === 'built' || hold.kind(sid) === 'front' || !hold.near(sid, pos, reach)) continue;
    for (const [m, q] of Object.entries(hold.contents(sid))) {
      const w = hold.material(m).water?.value ?? 0;
      if (w > 0 && q > 1e-9) out.push({ store: sid, material: m, litres: q * w, per: w });
    }
  }
  return out;
}

/** the fires of goods being burnt that set a structure alight, within their reach of it: put out with it (what was not burnt is left) */
function dousedWith(ctx: WriteCtx, id: EntityId, party?: EntityId): void {
  const st = ctx.require('Structure', id);
  const acts = ctx.data('activities');
  const half = Math.max(st.plan.length, st.plan.width) / 2;
  for (const [, w] of [...ctx.all('WorkPackage')]) {
    const f = w.status === 'active' ? acts[w.activity]?.fire : undefined;
    const by = ctx.get('Project', w.project)?.party;
    if (!f || (party && by !== party)) continue;
    const gap = Math.hypot(w.pos[0] - st.plan.pos[0], w.pos[1] - st.plan.pos[1]) - half;
    if (gap > f.reach.value + (st.plan.physics.fire?.catches.value ?? 2)) continue;
    ctx.command('production.cancelProject', { project: w.project });
    ctx.log('info', `${w.label}: put out with the fire at ${st.label}.`, [id]);
  }
}

/** a fire put out: said, and its blocker gone; a piece of it burnt, it is ruined all the same */
function putOut(ctx: WriteCtx, id: EntityId, how: string): void {
  const st = ctx.require('Structure', id);
  if (!st.burning) return;
  if (st.burning.ruined) {
    ctx.log('warn', `The fire at ${st.label} is out (${how}), too late to save it.`, [id]);
    return burnedDown(ctx, id, 'and was put out ruined');
  }
  const { burning: _b, ...rest } = st;
  ctx.set('Structure', id, { ...rest, putOut: ctx.now });
  ctx.blockers.clear(id);
  ctx.log('success', `The fire at ${st.label} is out (${how}).`, [id]);
  liable(ctx, id, st, st.burning, false);
}

/** a structure come down, whatever brought it down: a home on wheels with it is a wrecked vehicle too */
function collapse(ctx: WriteCtx, id: EntityId, st: Readonly<Structure>, how: string, why: string, wreck: string): void {
  ctx.set('Structure', id, { ...st, status: 'collapsed' });
  if (ctx.get('Machine', id)) ctx.command('equipment.wreck', { machine: id, why: wreck });
  // come down while it was being built: the work on it stops (what it laid lies where it fell, in its built holding)
  const open = st.project ? ctx.get('Project', st.project)?.status : undefined;
  if (open === 'active' || open === 'paused') ctx.command('production.cancelProject', { project: st.project! });
  // what is left is cleared away by taking it down (what can be used again is set down by it, the rest as rubble)
  const clear = st.plan.kit ? [] : [{ label: `Clear away what is left of ${st.label} (what can be used again is set down by it)`, command: { type: 'structures.demolish', payload: { structure: id } } }];
  ctx.blockers.set(id, [{ code: 'structures.collapsed', severity: 'block', params: { structure: st.label, why }, ...(clear.length ? { remedies: clear } : {}) }]);
  ctx.log('error', `${st.label} has come down ${how}: ${why}.`, [id]);
}

export const structuresModule = defineModule({
  id: 'structures',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Machine', 'Party', 'Project', 'WorkPackage'],
  label: 'Structures',
  description: 'Everything built: tents, walls, houses and halls, each built to a plan by work, standing on the land, answered by its physics, ageing element by element.',
  requires: ['production', 'holdings', 'trade', 'terrain', 'vegetation', 'weather', 'structural', 'parties'],
  provides: ['structures'],
  state: { initial: () => ({ fires: {} }) },
  // a structure's condition is the world's truth: known only by an inspection (StructureInspection), decision 0023
  observe: { StructureCondition: 'hidden' },
  components: {
    Structure: s.object({ holder: s.ref('party'), template: s.string(), label: s.string(), status: s.enum(['building', 'standing', 'collapsed', 'struck', 'cancelled', 'demolished']), done: s.array(s.string()) }, { passthrough: true }),
    StructureCondition: s.object({ lastUpdate: s.number() }, { passthrough: true }),
    StructureInspection: s.object({ at: s.number(), worst: s.number() }, { passthrough: true }),
  },
  data: { structureTemplates: s.record(StructureTemplateSchema), structureSettings: StructureSettingsSchema },
  events: { 'structures.elementDone': s.any(), 'structures.elementRemoved': s.any(), 'structures.completed': s.any(), 'structures.cancelled': s.any(), 'structures.demolished': s.any() },
  blockers: {
    'structures.unknownTemplate': 'No structure {template} (templates: {templates})',
    'structures.invalidPlan': 'It cannot be built there: {problems}',
    'structures.notOurs': '{structure} is not held by {party}',
    'structures.notStanding': '{structure} is not standing',
    'structures.notAKit': '{structure} is not a kit to be packed away: taking it down is work (plan revisions, decision 0026)',
    'structures.notBuilding': '{structure} is not under construction',
    'structures.collapsed': '{structure} has come down: {why}',
    'structures.onFire': '{structure} is on fire (from {from})',
    'structures.notOnFire': '{structure} is not on fire',
    'structures.nobodyAtFire': 'none of ours is at {structure} to fight the fire',
    'structures.notEnoughWater': 'too much fire at {structure} for the water at hand: some {need} l needed, {have} l there',
    'structures.foughtAlready': 'our people are fighting the fire at {structure} already (until about {until})',
    'structures.cannotCall': 'nobody of {party} who sees the fire at {structure} has a phone that works to call 112',
    'structures.settling': '{structure} settles and cracks: it presses the ground to {pressure} % of what the ground carries without harm',
    'structures.aKit': '{structure} is a kit: strike it',
    'structures.needsVehicle': 'A {template} is set up on a {vehicle} of ours: name it (on)',
    'structures.vehicleBusy': 'The {vehicle} cannot be set up now ({status})',
    'structures.notOnVehicle': 'A {template} is not set up on a vehicle',
    'structures.nothingToRenew': 'Nothing of {structure} needs renewal{known}',
    'structures.noSurvey': '{structure} has no condition survey in its plan',
    'structures.unknownElement': '{structure} has no element {elements} (elements: {known})',
    'structures.nothingChanges': 'The revision changes nothing of {structure}',
  },
  commands: {
    'structures.build': command(
      s.object({ template: s.string(), pos: s.point(), rotation: s.number().optional(), length: s.number({ min: 0.5 }).optional(), width: s.number({ min: 0.1 }).optional(), height: s.number({ min: 0.1, max: 30 }).optional(), floors: s.int({ min: 1 }).optional(), prepare: s.boolean().optional(), drop: s.array(s.string()).optional(), label: s.string().optional(), store: s.ref('store').optional(), priority: s.number().optional(), on: s.ref('machine').optional() }),
      (ctx, p) => {
        const holder = actorOf(ctx);
        // a home on wheels is set up on the vehicle itself, where it stands (camp C7: one thing in two roles)
        const vehicle = ctx.data('structureTemplates')[p.template]?.vehicle;
        if (vehicle) {
          const eq = ctx.port('equipment');
          // (ours to use: ours and not lent out, or lent to us)
          const ours = (v: EntityId) => Boolean(ctx.get('Machine', v)) && eq.usableBy(v, holder) && eq.modelOf(v).class === vehicle;
          if (!p.on || !ours(p.on)) {
            const remedies = [...ctx.all('Machine')].filter(([v]) => ours(v) && eq.ready(v)).map(([v]) => ({ label: `Set it up on the ${eq.modelOf(v).label} where it stands`, command: { type: 'structures.build', payload: { ...p, pos: eq.positionAt(v, ctx.now), on: v } } }));
            ctx.reject('structures.needsVehicle', { template: p.template, vehicle: ctx.data('equipmentClasses')[vehicle]?.label ?? vehicle }, remedies);
          }
          if (!eq.ready(p.on!)) ctx.reject('structures.vehicleBusy', { vehicle: eq.modelOf(p.on!).label, status: ctx.require('Machine', p.on!).status });
          if (ctx.require('Machine', p.on!).listing) ctx.reject('structures.vehicleBusy', { vehicle: eq.modelOf(p.on!).label, status: 'offered for sale' }, [{ label: `Withdraw it from sale`, command: { type: 'equipment.withdrawListing', payload: { machine: p.on! } } }]);
          const at = eq.positionAt(p.on!, ctx.now);
          p = { ...p, pos: [at[0], at[1]] };
        } else if (p.on) ctx.reject('structures.notOnVehicle', { template: p.template });
        // its work draws its goods from a store of ours: the one named, or else the nearest that holds them, or the
        // nearest (Qwen S379: none named, the goods bought for it lay in the yard and the work did not draw on them
        // until told). One not named is the work's, not the structure's: a kit struck goes back where it came from.
        const needs = p.store ? [] : [...new Set((planOf(ctx, { ...(p as PlanSpec), party: holder })?.elements ?? []).flatMap((e) => Object.keys(ctx.data('activities')[e.activity]?.materials ?? {})))];
        const hold = ctx.port('holdings');
        const nearest = needs.length ? (needs.map((m) => hold.ofParty(holder, { kept: true, near: p.pos as Vec2, has: m, accepts: m })[0]).find((x): x is EntityId => Boolean(x)) ?? hold.ofParty(holder, { kept: true, general: true, near: p.pos as Vec2 })[0]) : undefined;
        const plan = planOf(ctx, { ...(p as PlanSpec), party: holder, ...(nearest ? { store: nearest } : {}) });
        if (!plan) ctx.reject('structures.unknownTemplate', { template: p.template, templates: Object.keys(templatesOf(ctx)).join(', ') });
        if (!plan!.valid) ctx.reject('structures.invalidPlan', { problems: plan!.problems.join(' ') });
        const label = p.label ?? `${plan!.label} ${ctx.count('Structure') + 1}`;
        const id = p.on ?? ctx.spawn('structure', { name: label });
        if (p.on) ctx.command('equipment.setUp', { machine: p.on, on: true });
        // the heaps the work needs (soil won on the plot)
        const stores: Record<string, EntityId> = {};
        for (const h of plan!.stores) {
          const r = ctx.command('inventory.createStore', { holder, label: `${label}: ${h.label}`, kind: 'stockpile', pos: h.pos, ...(h.holds ? { holds: h.holds } : {}) });
          if (!r.ok) ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
          else stores[h.key] = r.value;
        }
        const pr = ctx.command('production.createProject', { label: `Build ${label}`, owner: 'structures', ref: id, party: holder, priority: p.priority ?? 0, site: plan!.pos, ...(p.store ?? nearest ? { store: p.store ?? nearest! } : {}), packages: packagesOf(plan!, id, stores) });
        if (!pr.ok) ctx.reject(pr.reasons[0]!.code, pr.reasons[0]!.params);
        const { store: _store, priority: _priority, ...spec } = p;
        ctx.set('Structure', id, { holder, template: p.template, label, spec: spec as PlanSpec, plan: { ...plan!, label }, status: 'building', done: [], ...(p.store ? { store: p.store } : {}), stores, ...(pr.ok ? { project: pr.value.project } : {}), createdAt: ctx.now });
        ctx.log('info', `Planned ${label}: est. ${Math.round(plan!.estimate.cost).toLocaleString('en')} € and ${plan!.estimate.hours < 1 ? `${Math.max(1, Math.round(plan!.estimate.hours * 60))} minutes` : `${Math.round(plan!.estimate.hours)} hours`} of work.`, [id]);
        if (nearest) ctx.log('info', `${label} draws its goods from ${hold.label(nearest)}, the nearest store of ours (another is named with store).`, [id, nearest]);
        // what the plan does not take as asked is said at the build too, not only in its preview (Review r34)
        for (const w of plan!.warnings) ctx.log('info', w.startsWith(plan!.label) ? w : `${label}: ${w}`, [id]);
        return { structure: id, project: pr.ok ? pr.value.project : '' };
      },
      { label: 'Build a structure', description: 'Build from a template (structures.templates: a tent, a wall, a house, a hall …) at a place [x, z] with a rotation (degrees, counter-clockwise from +x); length, width, height and floors where the template allows. A kit or wall is built from what is in `store` (carried there by hand if out of reach); prepare: level and drain the ground first. See the plan first with the projection structures.preview.' },
    ),
    'structures.cancel': command(
      s.object({ structure: s.ref('structure') }),
      (ctx, p) => {
        const st = mustHold(ctx, p.structure);
        if (st.status !== 'building') ctx.reject('structures.notBuilding', { structure: st.label });
        // its work is cancelled, and with it what it was building (production.projectCancelled)
        if (st.project && ctx.get('Project', st.project)?.status !== 'cancelled') ctx.command('production.cancelProject', { project: st.project });
        else abandon(ctx, p.structure);
      },
      { label: 'Cancel a structure under construction', description: 'Stop building it: the work not yet done is not done. A kit is packed away again, whole; what else is built stays where it is.' },
    ),
    'structures.strike': command(
      s.object({ structure: s.ref('structure') }),
      (ctx, p) => {
        const st = mustHold(ctx, p.structure);
        if (!st.plan.kit) ctx.reject('structures.notAKit', { structure: st.label });
        // (a kit on fire is not packed away whole)
        if (st.burning) ctx.reject('structures.onFire', { structure: st.label, from: st.burning.from }, fightRemedies(ctx, p.structure));
        // half put up: the putting up is given up, and what was put up packed away
        if (st.status === 'building') {
          ctx.command('structures.cancel', { structure: p.structure });
          return;
        }
        if (st.status !== 'standing' && st.status !== 'collapsed') ctx.reject('structures.notStanding', { structure: st.label });
        // a kit is packed up where it stands (design/physical-state.md I1: carried to a store as a move of its own), as
        // old as it is: the age it has had in use (its oldest part's, its ageing brought up to now)
        const cond = ctx.get('StructureCondition', p.structure);
        const since = cond ? Math.max(0, ctx.now - cond.lastUpdate) / YEAR : 0;
        const oldest = Math.max(0, ...(cond?.elements.map((x) => x.age + (st.status === 'standing' ? since : 0)) ?? [0]));
        offBuilt(ctx, p.structure, st, `${st.label} struck`, oldest);
        // what its barrel held is poured out: the barrel goes back with the kit
        pourOut(ctx, st);
        ctx.set('Structure', p.structure, { ...st, status: 'struck' });
        ctx.blockers.clear(p.structure);
        // a home on wheels packed up is a vehicle again
        if (ctx.get('Machine', p.structure)) ctx.command('equipment.setUp', { machine: p.structure, on: false });
        ctx.log('info', `${st.label} is taken down and packed away.`, [p.structure]);
      },
      { label: 'Take a tent down', description: 'Strike a tent or another kit: it is packed up and goes back to its store.' },
    ),
    'structures.revise': command(
      s.object({ structure: s.ref('structure'), length: s.number({ min: 0.5 }).optional(), width: s.number({ min: 0.1 }).optional(), height: s.number({ min: 0.1, max: 30 }).optional(), floors: s.int({ min: 1 }).optional(), drop: s.array(s.string()).optional() }),
      (ctx, p) => {
        const st = mustHold(ctx, p.structure);
        // a kit is struck and pitched again, not revised (its parts would vanish)
        if (st.plan.kit) ctx.reject('structures.aKit', { structure: st.label });
        // (what has come down is cleared away by the same work, when it is taken down altogether)
        if (st.status !== 'building' && st.status !== 'standing' && !((st.status === 'collapsed' || st.status === 'cancelled') && ctx.caller !== 'client')) ctx.reject('structures.notStanding', { structure: st.label });
        const { structure: _s, drop, ...changes } = p;
        const drops = [...new Set([...(st.spec.drop ?? []), ...(drop ?? [])])];
        const spec: PlanSpec = { ...st.spec, ...changes, label: st.label, self: p.structure, ...(drops.length ? { drop: drops } : {}) };
        // its goods come from where its work drew them: named at the build, or named for the work (Qwen S154: a
        // revision of a structure supplied by production.supplyFrom had to be told again)
        const pr0 = st.project ? ctx.get('Project', st.project) : undefined;
        const supplied = st.store ?? (pr0?.packages ?? []).map((pid) => ctx.get('WorkPackage', pid)).map((w) => w?.store ?? Object.values(w?.supply ?? {})[0]).find((x): x is EntityId => Boolean(x && ctx.port('holdings').exists(x))) ?? pr0?.store;
        const from = supplied ? { store: supplied } : {};
        const whole = planOf(ctx, { ...spec, drop: [], ...from });
        if (!whole) ctx.reject('structures.unknownTemplate', { template: st.template, templates: Object.keys(templatesOf(ctx)).join(', ') });
        const unknown = (drop ?? []).filter((x) => !whole!.elements.some((e) => e.id === x));
        if (unknown.length) ctx.reject('structures.unknownElement', { structure: st.label, elements: unknown.join(', '), known: whole!.elements.filter((e) => e.part).map((e) => e.id).join(', ') });
        const drawn = planOf(ctx, { ...spec, ...from })!;
        if (!drawn.valid) ctx.reject('structures.invalidPlan', { problems: drawn.problems.join(' ') });
        const next: Plan = { ...drawn, label: st.label };
        const round = (st.revisions ?? 0) + 1;
        // the heaps the revised work needs that the plan had not (soil won, wood felled on the new ground)
        const stores = { ...st.stores };
        for (const h of next.stores.filter((x) => !stores[x.key])) {
          const r = ctx.command('inventory.createStore', { holder: st.holder, label: `${st.label}: ${h.label}`, kind: 'stockpile', pos: h.pos, ...(h.holds ? { holds: h.holds } : {}) });
          if (!r.ok) ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
          else stores[h.key] = r.value;
        }
        const work = revisionWork(ctx, p.structure, { ...st, stores, ...from }, next, round);
        // the added work draws its goods there too, not only the plan (Qwen S224: the redrawn piece had no store)
        const needs = (a: (typeof work.add)[number]) => Object.keys(a.consumes ?? {}).length > 0 || Object.keys(ctx.data('activities')[a.activity]?.materials ?? {}).length > 0;
        if (supplied) work.add = work.add.map((a) => (a.store || !needs(a) ? a : { ...a, store: supplied }));
        if (!work.add.length && !work.cancel.length) ctx.reject('structures.nothingChanges', { structure: st.label });
        let project = st.project;
        const running = project ? ctx.get('Project', project) : undefined;
        if (work.add.length) {
          if (running && (running.status === 'active' || running.status === 'paused')) {
            const r = ctx.command('production.extendProject', { project: project!, packages: work.add });
            if (!r.ok) ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
          } else {
            const r = ctx.command('production.createProject', { label: `Revise ${st.label}`, owner: 'structures', ref: p.structure, party: st.holder, priority: 0, site: next.pos, ...from, packages: work.add });
            if (!r.ok) ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
            else project = r.value.project;
          }
        }
        // the revised plan stands before packages are dropped (dropping the last open one completes the project)
        const { self: _self, ...kept } = spec;
        // what it was, should this work be given up (a revision of what stood or lay there)
        const before = st.before ?? (st.status !== 'building' && work.add.length ? { plan: st.plan, spec: st.spec, status: st.status } : undefined);
        ctx.set('Structure', p.structure, { ...st, ...from, stores, spec: kept, plan: next, revisions: round, status: work.add.length ? 'building' : st.status, ...(project ? { project } : {}), ...(before ? { before } : {}) });
        // parts at their new size by what is built: done, with all that follows from it (placed, the site levelled)
        for (const x of work.finished) {
          const el = next.elements.find((e) => e.id === x);
          const pid = lastPackageOf(ctx, p.structure, x);
          if (el && pid && !ctx.require('Structure', p.structure).done.includes(x)) partDone(ctx, p.structure, el, pid);
        }
        for (const pid of work.cancel) ctx.command('production.cancelPackage', { package: pid });
        const added = work.add.filter((a) => !(a.data as { removal?: boolean }).removal).length;
        ctx.log('info', `${st.label} revised: ${added} pieces of work added (${work.redrawn} of them redrawn), ${work.cancel.length - work.redrawn} dropped, ${work.removed} to take down.`, [p.structure]);
        return { added, redrawn: work.redrawn, dropped: work.cancel.length - work.redrawn, removed: work.removed };
      },
      { label: 'Revise a structure’s plan', description: 'Change a structure while it is built or later (length, width, height, floors; drop: elements no longer wanted). The difference is work: new elements are built, elements not begun are dropped, built elements no longer wanted are taken down, and what rests on a changed element comes off first and goes back on.' },
    ),
    'structures.demolish': command(
      s.object({ structure: s.ref('structure') }),
      (ctx, p) => {
        const st = mustHold(ctx, p.structure);
        if (st.plan.kit) ctx.reject('structures.aKit', { structure: st.label });
        // being taken down already: so it goes on
        if (st.demolishing) return { removed: 0 };
        // (built: done, or laid by work given up)
        const built = st.plan.elements.filter((e) => e.part && (st.done.includes(e.id) || builtOf(ctx, p.structure, e.id) > 1e-9));
        // what was left half-built (cancelled) is taken down too; what came down is cleared away
        if (st.status !== 'building' && st.status !== 'standing' && st.status !== 'collapsed' && !(st.status === 'cancelled' && built.length)) ctx.reject('structures.notStanding', { structure: st.label });
        // nothing begun of a first build: the work is called off (what is half laid is taken down)
        if (st.status === 'building' && !st.before && !begun(ctx, st)) {
          ctx.command('structures.cancel', { structure: p.structure });
          return { removed: 0 };
        }
        // every part comes off (a revision without them), then it is gone
        const r = ctx.command('structures.revise', { structure: p.structure, drop: st.plan.elements.filter((e) => e.part).map((e) => e.id) });
        if (!r.ok) return ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
        ctx.patch('Structure', p.structure, { demolishing: true });
        // and no handover of what is to be gone: the work that is not taking it down is called off
        const now = ctx.require('Structure', p.structure);
        const pr = now.project ? ctx.get('Project', now.project) : undefined;
        for (const pid of pr?.packages ?? []) {
          const w = ctx.get('WorkPackage', pid);
          if (w && w.status !== 'done' && w.status !== 'cancelled' && !(w.data as { removal?: boolean } | undefined)?.removal) ctx.command('production.cancelPackage', { package: pid });
        }
        ctx.log('info', `${st.label} is to be taken down: ${r.value.removed} parts come off.`, [p.structure]);
        return { removed: r.value.removed };
      },
      { label: 'Take a structure down', description: 'Take a built structure down altogether by our own work (a kit is struck instead): every built part comes off, unbegun work is dropped, and what can be used again of its material (logs, brash, bricks) is put on a store by it, the broken rest as what it breaks into; other material is lost. When the work is done the structure is gone and leaves the books.' },
    ),
    'structures.extinguish': command(
      s.object({ structure: s.ref('structure') }),
      (ctx, p) => {
        // our people at the fire throw the water at hand on it: it takes them the time it takes (some 10 l a minute each),
        // the fire burning on meanwhile; enough water then puts it out, and the fire that set it alight with it
        const st = ctx.require('Structure', p.structure);
        if (!st.burning) ctx.reject('structures.notOnFire', { structure: st.label });
        if (st.burning!.fighting) ctx.reject('structures.foughtAlready', { structure: st.label, until: ctx.calendar.format(st.burning!.fighting.until) });
        const party = actorOf(ctx);
        const set = ctx.data('structureSettings').fire!;
        const there = fighters(ctx, party, st);
        if (!there.length) ctx.reject('structures.nobodyAtFire', { structure: st.label }, [{ label: 'Call the fire brigade (112)', command: { type: 'structures.callBrigade', payload: { structure: p.structure } } }]);
        const need = st.burning!.left * set.water.value;
        const have = waterAt(ctx, party, st.plan.pos, FIRE_WATER).reduce((a, w) => a + w.litres, 0);
        if (have < need - 1e-6) ctx.reject('structures.notEnoughWater', { structure: st.label, need: Math.round(need), have: Math.round(have) }, [{ label: 'Call the fire brigade (112)', command: { type: 'structures.callBrigade', payload: { structure: p.structure } } }]);
        const until = ctx.now + Math.max(2, need / (there.length * set.pour.value)) * 60;
        ctx.patch('Structure', p.structure, { burning: { ...st.burning!, fighting: { by: party, until } } });
        ctx.at(until, 'doused', { structure: p.structure, party });
        ctx.log('warn', `${there.length} of ours fight the fire at ${st.label} with buckets and canisters: out by about ${ctx.calendar.format(until, 'time')}, if the water holds.`, [p.structure]);
        return { until };
      },
      { label: 'Put out a fire', description: 'Our people there (within some 100 m) throw the water at hand (stores within some 30 m) on a fire at a structure: about a litre a kg still burning, some 10 l a minute each, the fire burning on meanwhile; the fire of goods that set it alight is put out with it. Too much fire for the water at hand: call the fire brigade.' },
    ),
    'structures.callBrigade': command(
      s.object({ structure: s.ref('structure') }),
      (ctx, p) => {
        // 112 is a call someone makes: one of ours who sees the fire, with a phone that works. The brigade comes within its
        // help time and puts it out; free, unless the fire was caused on purpose or by gross negligence (§ 29 NBrandSchG)
        const st = ctx.require('Structure', p.structure);
        if (!st.burning) ctx.reject('structures.notOnFire', { structure: st.label });
        const party = actorOf(ctx);
        const set = ctx.data('structureSettings').fire!;
        const wf = ctx.port('workforce');
        const moves = ctx.port('moves');
        const caller = wf.staff(party).find((x) => {
          const w = moves.where(x);
          return w && Math.hypot(w[0] - st.plan.pos[0], w[1] - st.plan.pos[1]) <= set.call.value && wf.phone(x) > 0;
        });
        if (!caller) ctx.reject('structures.cannotCall', { structure: st.label, party: partyLabel(ctx, party) }, fightRemedies(ctx, p.structure).slice(0, 1));
        const at = ctx.now + set.brigade.response.value * 60;
        ctx.at(at, 'brigade', { structure: p.structure, caller: caller!, ...(st.burning!.by ? { by: st.burning!.by } : {}), ...(st.burning!.offence ? { offence: true } : {}) });
        ctx.log('warn', `${wf.name(caller!)} calls 112: the fire brigade comes to ${st.label}, there in about ${Math.round(set.brigade.response.value)} minutes.`, [p.structure]);
        return { at };
      },
      { label: 'Call the fire brigade', description: 'One of ours who sees the fire (within some 200 m) calls 112 with a phone that works: the fire brigade comes within its help time and puts the fire out, and the fire that set it alight. Fighting fires is free of charge, unless the fire was caused on purpose or by gross negligence (rubbish burnt in the open beside a tent): then its costs are charged.' },
    ),
    'structures.inspect': command(
      s.object({ structure: s.ref('structure') }),
      (ctx, p) => {
        const st = mustHold(ctx, p.structure);
        if (st.status !== 'standing') ctx.reject('structures.notStanding', { structure: st.label });
        if (!st.plan.inspection) ctx.reject('structures.noSurvey', { structure: st.label });
        const r = ctx.command('production.createProject', { label: `Condition survey ${st.label}`, owner: 'structures', ref: p.structure, party: st.holder, priority: 5, site: st.plan.pos, packages: [{ key: 'inspect', activity: st.plan.inspection!.activity, label: `Condition survey ${st.label}`, quantity: st.plan.inspection!.quantity, pos: st.plan.pos, data: { structure: p.structure, inspection: true } }] });
        if (!r.ok) ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
        return r.ok ? r.value.project : '';
      },
      { label: 'Condition survey', description: 'Commission a condition survey of a standing structure: every element is graded.' },
    ),
    'structures.renew': command(
      s.object({ structure: s.ref('structure'), elements: s.array(s.string()).optional() }),
      (ctx, p) => {
        const st = mustHold(ctx, p.structure);
        if (st.status !== 'standing') ctx.reject('structures.notStanding', { structure: st.label });
        // by default those the last survey graded worn (what we know, not the structure's truth: decision 0023)
        const survey = ctx.get('StructureInspection', p.structure);
        const wanted = p.elements ?? survey?.elements.filter((e) => e.grade >= 3.5).map((e) => e.id) ?? [];
        const packages: PackageSpec[] = [];
        for (const id of wanted) {
          const el = st.plan.elements.find((e) => e.id === id);
          if (!el?.renewal || el.renewal.quantity <= 0) continue;
          packages.push({ key: id, activity: el.renewal.activity, label: `${el.renewal.label} — ${st.label}`, quantity: el.renewal.quantity, pos: st.plan.pos, data: { structure: p.structure, renewal: id } });
        }
        if (!packages.length) ctx.reject('structures.nothingToRenew', { structure: st.label, known: survey ? ` (by the survey of ${ctx.calendar.format(survey.at, 'day')})` : ' that a survey has found: none has been made' }, survey ? [] : [{ label: `Survey ${st.label}`, command: { type: 'structures.inspect', payload: { structure: p.structure } } }]);
        const r = ctx.command('production.createProject', { label: `Renewal ${st.label}`, owner: 'structures', ref: p.structure, party: st.holder, priority: 3, site: st.plan.pos, packages });
        if (!r.ok) ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
        return r.ok ? r.value.project : '';
      },
      { label: 'Renew elements', description: 'Renew elements of a structure (by default those graded 3.5 or worse in the last survey) through a renewal project.' },
    ),
  },
  timers: {
    // the fire brigade arrives and puts it out, and the fire that set it alight; its costs charged to whoever caused the
    // fire on purpose or by gross negligence (§ 29 NBrandSchG), whether or not anything was left to save
    brigade(ctx, payload: { structure: EntityId; caller: EntityId; by?: EntityId; offence?: boolean }) {
      const st = ctx.get('Structure', payload.structure);
      if (!st) return;
      const set = ctx.data('structureSettings').fire!;
      dousedWith(ctx, payload.structure);
      if (st.burning) putOut(ctx, payload.structure, 'the fire brigade');
      else ctx.log('info', `The fire brigade arrives at ${st.label}: nothing left to save.`, [payload.structure]);
      const by = payload.by;
      if (payload.offence && by && ctx.hasPort('prices') && ctx.port('prices').hasBooks(by) && ctx.hasData('claimLaw') && ctx.data('claimLaw')?.public) {
        if (!ctx.get('Party', 'feuerwehr')) ctx.command('parties.add', { id: 'feuerwehr', label: 'Gemeinde (Freiwillige Feuerwehr)', kind: 'public' });
        ctx.command('agreements.contract', { instrument: 'claim', label: `The fire brigade's costs: ${st.label}`, holder: by, party: 'feuerwehr', role: 'debtor', terms: { kind: 'public', basis: '§ 29 NBrandSchG (a fire caused by gross negligence: its costs)', about: payload.structure }, amount: set.brigade.fee.value * ctx.port('prices').index(ctx.now) });
      }
    },
    // our people's water on the fire: enough of it there now puts it out, and our fire that set it alight
    doused(ctx, payload: { structure: EntityId; party: EntityId }) {
      const st = ctx.get('Structure', payload.structure);
      if (!st?.burning || st.burning.fighting?.by !== payload.party) return;
      const set = ctx.data('structureSettings').fire!;
      const { fighting: _f, ...b } = st.burning;
      ctx.patch('Structure', payload.structure, { burning: b });
      const need = b.left * set.water.value;
      const water = waterAt(ctx, payload.party, st.plan.pos, FIRE_WATER);
      const have = water.reduce((a, w) => a + w.litres, 0);
      if (!fighters(ctx, payload.party, st).length || have < need - 1e-6) {
        ctx.log('error', `The fire at ${st.label} is not out: ${!fighters(ctx, payload.party, st).length ? 'nobody of ours is at it any more' : `the water ran short (${Math.round(have)} of some ${Math.round(need)} l)`}.`, [payload.structure]);
        return;
      }
      let left = need;
      for (const w of water) {
        if (left <= 1e-9) break;
        const qty = Math.min(w.litres, left) / w.per;
        ctx.command('inventory.release', { from: w.store, material: w.material, qty, to: 'ground', why: `putting out the fire at ${st.label}`, usedUp: true });
        left -= qty * w.per;
      }
      dousedWith(ctx, payload.structure, payload.party);
      putOut(ctx, payload.structure, `our people, with ${Math.round(need)} l of water`);
    },
  },
  on: {
    'production.packageCompleted': (ctx, e) => {
      if (e.owner !== 'structures') return;
      const d = e.data as { structure?: EntityId; element?: string; inspection?: boolean; renewal?: string; removal?: boolean; full?: boolean; extension?: boolean; lift?: number } | undefined;
      if (!d?.structure) return;
      const st = ctx.get('Structure', d.structure);
      if (!st) return;
      if (d.inspection) {
        const cond = ctx.get('StructureCondition', d.structure);
        if (!cond) return;
        const worst = Math.max(1, ...cond.elements.map((x) => x.grade));
        ctx.set('StructureInspection', d.structure, { at: ctx.now, elements: cond.elements.map((x) => ({ id: x.id, label: x.label, grade: x.grade })), worst });
        ctx.log(worst >= 3.5 ? 'warn' : 'info', `Condition survey ${st.label}: worst element grade ${worst.toFixed(1)}`, [d.structure]);
        return;
      }
      if (d.renewal) {
        const cond = ctx.get('StructureCondition', d.structure);
        if (cond) ctx.set('StructureCondition', d.structure, { ...cond, elements: cond.elements.map((x) => (x.id === d.renewal ? { ...x, age: 0, condition: 1, grade: 1 } : x)) });
        // (renewed: the one who renewed it knows it is new; the last survey says so of that element from now)
        const survey = ctx.get('StructureInspection', d.structure);
        if (survey) ctx.set('StructureInspection', d.structure, { ...survey, elements: survey.elements.map((x) => (x.id === d.renewal ? { ...x, grade: 1 } : x)), worst: Math.max(1, ...survey.elements.map((x) => (x.id === d.renewal ? 1 : x.grade))) });
        return;
      }
      if (st.status !== 'building' || !d.element) return;
      // taken down: no longer built; what comes off it that can be used again is put on a store by it (the rest, broken, too)
      if (d.removal) {
        const r = e.data as { keep?: number; built?: string };
        const built = builtOf(ctx, d.structure, d.element);
        const off = Math.max(0, built - (r.keep ?? 0));
        if (off > 0 && r.built) {
          const now0 = ctx.require('Structure', d.structure);
          ctx.set('Structure', d.structure, { ...now0, taken: { ...(now0.taken ?? {}), [d.element]: (now0.taken?.[d.element] ?? 0) + off } });
          salvage(ctx, d.structure, st, materialsOf(ctx, r.built, off), builtSince(ctx, d.structure, d.element));
        }
        const st2 = ctx.require('Structure', d.structure);
        if (d.full) {
          ctx.set('Structure', d.structure, { ...st2, done: st2.done.filter((x) => x !== d.element) });
          ctx.emit('structures.elementRemoved', { structure: d.structure, element: d.element });
        }
        return;
      }
      const el = st.plan.elements.find((x) => x.id === d.element);
      if (!el) return;
      // an extension done of a part done already: it is built at its new size; of one not yet done (the rest of
      // work stopped short), the part is done now, with all that follows from it
      if (d.extension && st.done.includes(el.id)) return;
      // (a lift below the top: the part is done with its last lift, H1)
      if (d.lift !== undefined) return;
      partDone(ctx, d.structure, el, e.package);
    },
    'production.projectCancelled': (ctx, e) => {
      if (e.owner !== 'structures' || !e.ref) return;
      // (given up while being built; one that came down is a wreck, not work given up)
      const st = ctx.get('Structure', e.ref);
      if (st?.project === e.project && st.status !== 'collapsed') abandon(ctx, e.ref);
    },
    'production.projectCompleted': (ctx, e) => {
      if (e.owner !== 'structures' || !e.ref) return;
      const found = ctx.get('Structure', e.ref);
      if (!found || found.status !== 'building' || found.project !== e.project) return;
      // the work done: what it was before is past
      const { before: _before, ...st } = found;
      // taken down altogether: gone, and off the books (what it was still worth is a loss)
      if (st.demolishing) {
        gone(ctx, e.ref, st, `${st.label} has been taken down.`);
        return;
      }
      // an asset on its holder's books (own work capitalised), to be depreciated; a kit is a good already bought
      // (taking back a revision given up is not an alteration: an expense)
      const takeBack = ctx.require('Project', e.project).packages.every((pid) => ctx.get('WorkPackage', pid)?.key.endsWith('.back'));
      const cost = takeBack ? 0 : Math.round(ctx.port('production').projectCost(e.project) * 100) / 100;
      if (st.plan.depreciation !== undefined && cost > 0) ctx.ledger.post({ from: acct(st.holder, ACCOUNTS.ownWork), to: acct(st.holder, ACCOUNTS.buildings), amount: cost, memo: `${st.label}: ${st.builtAt === undefined ? 'own construction' : 'alterations'} capitalised`, category: ACCOUNTS.buildings, refs: [e.ref] });
      const books = st.plan.depreciation !== undefined ? { cost: Math.round(((st.cost ?? 0) + cost) * 100) / 100, bookValue: Math.round(((st.bookValue ?? 0) + cost) * 100) / 100 } : {};
      const { unfinished: _unfinished, ...whole } = st;
      ctx.set('Structure', e.ref, { ...whole, status: 'standing', builtAt: st.builtAt ?? ctx.now, ...books });
      // what this work built (or built again) is new; the rest keeps its age
      const before = ctx.get('StructureCondition', e.ref);
      const fresh = new Set(ctx.require('Project', e.project).packages.map((pid) => ctx.get('WorkPackage', pid)).filter((w) => w?.status === 'done' && !(w.data as { removal?: boolean } | undefined)?.removal).map((w) => (w!.data as { element?: string } | undefined)?.element));
      const made0 = initialCondition(ctx, e.ref, ctx.require('Structure', e.ref));
      // a kit put up again is as old as it was when it was packed away (its age came with it from the store)
      const kitAge = st.plan.kit ? ctx.port('holdings').ageIn(ctx.port('holdings').ofWork(e.ref, 'built')[0]) : 0;
      const shape = ctx.data('structureSettings').ageingShape.value;
      const made = kitAge > 0 && st.plan.kit ? { ...made0, elements: made0.elements.map((x) => ({ ...x, age: kitAge, grade: elementGrade(kitAge, x.life, shape), condition: 1 - (elementGrade(kitAge, x.life, shape) - 1) / 4 })) } : made0;
      const cond = before ? { ...made, elements: made.elements.map((x) => (fresh.has(x.id) ? x : (before.elements.find((b) => b.id === x.id) ?? x))) } : made;
      ctx.set('StructureCondition', e.ref, cond);
      // as it is: a kit put up again is not new
      ctx.set('StructureInspection', e.ref, { at: ctx.now, elements: cond.elements.map((x) => ({ id: x.id, label: x.label, grade: x.grade })), worst: Math.max(1, ...cond.elements.map((x) => x.grade)) });
      ctx.emit('structures.completed', { structure: e.ref });
      ctx.log('success', `${st.label} stands${st.plan.floorArea ? ` (${Math.round(st.plan.floorArea)} m² of floor)` : ''}.`, [e.ref]);
    },
    // insolvency proceedings opened: a home on wheels set up as the party's (a site office) is packed up, to be sold
    'economy.insolvencyOpened': (ctx, e) => packUpForSale(ctx, e.party),
    'land.vacate': (ctx, e) => {
      const st = ctx.get('Structure', e.subject);
      if (!st || (st.status !== 'standing' && st.status !== 'collapsed' && st.status !== 'building' && st.status !== 'cancelled')) return;
      const open = st.project ? ctx.get('Project', st.project)?.status : undefined;
      if (st.plan.kit) {
        // a kit is struck; one half put up is packed away again (its project cancelled)
        if (st.status === 'building' && (open === 'active' || open === 'paused')) ctx.command('production.cancelProject', { project: st.project! });
        else if (st.status !== 'building' && st.status !== 'cancelled') ctx.command('structures.strike', { structure: e.subject });
        return;
      }
      // ended by force: what is built is torn down by those who enforce it (at the cost the law's step charged)
      if (e.evicted) {
        if (open === 'active' || open === 'paused') ctx.command('production.cancelProject', { project: st.project! });
        // what was built is set down by it (the authority's firm stacks it; storage is in the clearance's cost)
        const now0 = ctx.require('Structure', e.subject);
        const off: Record<string, number> = {};
        for (const el of now0.plan.elements.filter((x0) => x0.part)) for (const [mat, q] of Object.entries(materialsOf(ctx, el.activity, builtOf(ctx, e.subject, el.id)))) off[mat] = (off[mat] ?? 0) + q;
        salvage(ctx, e.subject, now0, off, now0.builtAt);
        gone(ctx, e.subject, ctx.require('Structure', e.subject), `${st.label} has been torn down by order.`);
      }
    },
  },
  systems: [
    // fire: what is alight, each hour (only while something burns)
    { id: 'fire', every: HOUR, offset: 0, phase: 'physical', run: (ctx) => fires(ctx) },
    // the administrator goes on packing up what was set up again or could not be packed up at the opening
    { id: 'windUp', every: DAY, offset: 8 * HOUR, phase: 'agents', run: (ctx) => (ctx.hasPort('prices') ? ctx.port('prices').woundUp() : []).forEach((p) => packUpForSale(ctx, p)) },
    {
      // the wind of the day just past against what holds each structure, its snow and its frost (the day is
      // judged when it is over: never on the evening still to come, design/physical-state.md I7)
      id: 'weather',
      every: DAY,
      offset: 0,
      phase: 'physical',
      run(ctx) {
        if (ctx.now < DAY) return;
        const day = ctx.port('weather').day(ctx.now - DAY);
        // the snow on the roofs falls and melts as on the ground
        const soil = ctx.hasPort('soil-state') ? ctx.port('soil-state') : undefined;
        const keeps = ctx.data('structureSettings').roofSnow.value;
        for (const [id, st0] of [...ctx.all('Structure')]) {
          if (st0.status !== 'standing') {
            // down or put away: what lay on it is gone with it, and its pegs or posts are out of the ground (one left
            // half built stands as it is: r41)
            const gone = st0.status !== 'building' && st0.status !== 'cancelled';
            if (gone && (st0.roofSnow !== undefined || st0.heaved !== undefined)) {
              const { roofSnow: _, heaved: _h, heaveDays: _d, heaveClass: _c, ...rest } = st0;
              ctx.set('Structure', id, rest);
            }
            // being built or revised, it meets the wind as it is built (I8: status exempts nothing); a kit is
            // put up within the hour and packed when given up
            if (gone || st0.plan.kit) continue;
            const built = builtShares(ctx, id);
            if (!Object.values(built).some((x) => x > 1e-9)) continue;
            const gusts = (day.wind * ctx.data('structureSettings').gustFactor.value).toFixed(0);
            let a = ctx.port('structural').assess(id, { wind: day.wind }, built);
            // walls standing on their own blown over: only they come down; then what is left meets the same wind
            if (a.unbraced && a.unbraced.utilisation >= 1 && wallsFall(ctx, id, st0, a.unbraced.height, `gusts of ${gusts} m/s (walls going up, ${a.unbraced.height.toFixed(2)} m standing on their own ${a.unbraced.utilisation.toFixed(2)})`)) {
              a = ctx.port('structural').assess(id, { wind: day.wind }, builtShares(ctx, id));
            }
            if (a.utilisation >= 1) {
              const why = `gusts of ${gusts} m/s on it as it was built (${a.explain.label ?? 'utilisation'} ${a.utilisation.toFixed(2)})`;
              collapse(ctx, id, ctx.require('Structure', id), 'in the wind while it was being built', why, `overturned in ${why}`);
            }
            continue;
          }
          // the part of the day it stood through: one put up in the day meets only the hours since (not the rain,
          // snow or wind before it stood)
          const part = stoodThrough(ctx, st0, day);
          // the snow on its roof: what fell since it stood (not what lay on the ground before)
          const roof = part ? (st0.roofSnow ?? 0) + part.snow : soil ? soil.snowAfter(st0.roofSnow ?? 0, ctx.now - DAY) : 0;
          const heave = frostHeave(ctx, id, st0);
          const st = roof > 0 || st0.roofSnow !== undefined || heave ? { ...st0, ...(roof > 0 || st0.roofSnow !== undefined ? { roofSnow: roof } : {}), ...(heave ?? {}) } : st0;
          if (st !== st0) ctx.set('Structure', id, st);
          const snow = roof * keeps;
          const bears = st.plan.physics.rating.snow?.value;
          if (bears !== undefined && snow > bears) {
            collapse(ctx, id, st, 'under the snow', `${Math.round(snow)} kg of snow on each m² of its roof, more than the ${Math.round(bears)} kg it bears`, 'crushed under the snow');
            continue;
          }
          const wind = part ? part.wind : day.wind;
          // (as it is: a part taken off and not put back is not there)
          const a = ctx.port('structural').assess(id, { wind }, st.taken && Object.values(st.taken).some((x) => x > 1e-9) ? builtShares(ctx, id) : undefined);
          if (a.utilisation < 1) {
            if (a.settlement && a.settlement.utilisation > 1) settle(ctx, id, st, a.settlement.utilisation);
            continue;
          }
          const why = `gusts of ${(wind * ctx.data('structureSettings').gustFactor.value).toFixed(0)} m/s (utilisation ${a.utilisation.toFixed(2)})`;
          collapse(ctx, id, st, 'in the wind', why, `overturned in ${why}`);
        }
        // the day's rain on what catches it runs into its barrel, as much as it holds (camp L2); snow lies on the
        // tarp and is lost to it (a thaw running into the barrel is not modelled)
        for (const [id, st] of [...ctx.all('Structure')]) {
          const c = st.plan.physics.catchment;
          const barrel = st.stores?.catch;
          if (!c || !barrel || st.status !== 'standing') continue;
          // (the rain since it stood; snow lies on the tarp and is lost to it)
          const part = stoodThrough(ctx, st, day);
          const rain = part ? part.rain : day.snow ? 0 : day.precip;
          if (rain <= 0) continue;
          const hold = ctx.port('holdings');
          // the room left: whatever water is in it already, in litres
          const held = Object.entries(hold.contents(barrel)).reduce((a, [m, q]) => a + q * (hold.material(m).water?.value ?? 0), 0);
          const room = c.capacity.value - held;
          const litres = Math.min(room, rain * c.area.value * c.efficiency.value);
          // (rain is the sky's: drawn by the catcher, as much as falls on it)
          if (litres > 1e-6) ctx.command('inventory.extract', { from: 'rain', into: barrel, material: c.material, qty: Math.round(litres * 1000) / 1000, why: `rain on the ${st.label}` });
        }
      },
    },
    {
      // straight-line depreciation of the structures on the books (monthly at the turn of the month)
      id: 'depreciation',
      every: DAY,
      offset: 0,
      phase: 'accounting',
      run: (ctx: WriteCtx) => {
        if (ctx.calendar.at(ctx.now).day !== 1) return;
        const byHolder = new Map<EntityId, { total: number; refs: string[] }>();
        for (const [id, st] of [...ctx.all('Structure')]) {
          const rate = st.plan.depreciation;
          if (st.status !== 'standing' || rate === undefined || !st.cost || !st.bookValue) continue;
          const monthly = Math.min(st.bookValue, Math.round(((st.cost * rate) / 12) * 100) / 100);
          if (monthly <= 0) continue;
          ctx.set('Structure', id, { ...st, bookValue: Math.round((st.bookValue - monthly) * 100) / 100 });
          const h = byHolder.get(st.holder) ?? { total: 0, refs: [] };
          h.total += monthly;
          h.refs.push(id);
          byHolder.set(st.holder, h);
        }
        for (const holder of [...byHolder.keys()].sort()) {
          const { total, refs } = byHolder.get(holder)!;
          ctx.ledger.post({ from: acct(holder, ACCOUNTS.buildings), to: acct(holder, ACCOUNTS.depreciation), amount: Math.round(total * 100) / 100, memo: `Depreciation of ${refs.length} structure${refs.length > 1 ? 's' : ''}`, category: ACCOUNTS.depreciation, refs });
        }
      },
    },
    {
      // every element ages against its life (weekly is plenty for processes of years)
      id: 'ageing',
      every: DAY,
      offset: DAY / 2,
      phase: 'physical',
      run: (ctx: WriteCtx) => {
        const shape = ctx.data('structureSettings').ageingShape.value;
        for (const [id, st] of [...ctx.all('Structure')]) {
          // (being revised, its elements built before go on ageing: I8)
          if (st.status !== 'standing' && st.status !== 'building') continue;
          const cond = ctx.get('StructureCondition', id);
          if (!cond) continue;
          const dtYears = (ctx.now - cond.lastUpdate) / YEAR;
          if (dtYears < 7 / 365) continue;
          const elements = cond.elements.map((x) => {
            const age = x.age + dtYears;
            // a provisional life is replaced once the element has a year of its own exposure behind it
            let re: Partial<ElementCondition> = {};
            if (x.lifeFrom === 'provisional' && st.builtAt !== undefined) {
              const d = durabilityLife(ctx, id, st.plan.elements.find((e) => e.id === x.id) ?? { id: x.id }, st.builtAt);
              if (d) re = { life: d.life, lifeFrom: 'durability', ...(d.explain ? { lifeExplain: d.explain } : {}) };
            }
            const life = re.life ?? x.life;
            const grade = elementGrade(age, life, shape);
            return { ...x, ...re, age, grade, condition: 1 - (grade - 1) / 4 };
          });
          ctx.set('StructureCondition', id, { elements, lastUpdate: ctx.now });
        }
      },
    },
  ],
  contributes: {
    planners: () => kitPlanner,
    // what stands on the land
    landUse: () => (read: ReadCtx) =>
      [...read.all('Structure')]
        // what stands, is being built, has come down, or was left half-built
        .filter(([, st]) => st.status === 'standing' || st.status === 'building' || st.status === 'collapsed' || (st.status === 'cancelled' && !st.plan.kit && st.done.length > 0))
        .map(([id, st]) => ({
          subject: id,
          party: st.holder,
          label: st.label,
          pos: [st.plan.pos[0], st.plan.pos[1]] as Vec2,
          area: st.plan.length * st.plan.width,
          people: 0,
          // built in place (a kit is struck and pitched again): since its work began, its size, finished or not
          // (a plan nobody has begun is no building yet)
          ...(st.plan.kit || !begun(read, st) ? {} : { built: { since: st.createdAt, volume: st.plan.length * st.plan.width * st.plan.height, finished: st.builtAt !== undefined } }),
        })),
    shelter: () => (read: ReadCtx, person: EntityId) => shelterFor(read, person),
    // a structure gone (taken down, come down, struck): what is agreed about it ends
    gone: () => (read: ReadCtx, id: EntityId) => {
      const st = read.get('Structure', id);
      if (!st) return null;
      // (a caravan packed up is a vehicle again: there, not gone)
      return st.status === 'demolished' ? `${st.label} has been taken down` : st.status === 'collapsed' ? `${st.label} has come down` : st.status === 'struck' && !read.get('Machine', id) ? `${st.label} is packed away` : null;
    },
    // a finished structure with floors can be let: its template, floor area and condition
    lettables: () => (read: ReadCtx, id: EntityId) => {
      const st = read.get('Structure', id);
      // (not one left short of parts: a house without its roof is no home)
      if (!st || st.status !== 'standing' || !st.plan.floorArea || st.unfinished?.length) return null;
      const cond = read.get('StructureCondition', id);
      const condition = cond?.elements.length ? cond.elements.reduce((a, e) => a + e.condition, 0) / cond.elements.length : 1;
      return { label: st.label, type: st.template, area: st.plan.floorArea, condition, holder: st.holder };
    },
  },
  ports: {
    structures: (read) => ({
      templates: () => templatesOf(read),
      plan: (spec) => {
        const p = planOf(read, spec);
        if (!p) throw new Error(`no template ${spec.template}`);
        return p;
      },
      built: (id) => builtShares(read, id),
    }),
  },
  projections: {
    'structures.list': {
      label: 'Structures: tents, walls, houses and halls, where they stand and how they are',
      compute: (read: ReadCtx) =>
        [...read.all('Structure')].map(([id, st]) => ({
          id,
          label: st.label,
          holder: partyLabel(read, st.holder),
          template: st.template,
          status: st.status,
          ...(st.plan.kit ? { kit: true } : {}),
          pos: st.plan.pos,
          floorArea: st.plan.floorArea,
          // given up: what it cost, not what it was to cost (Qwen S156: a half-built one read as a live asset)
          ...(st.status === 'cancelled' ? { spent: st.project ? read.port('production').projectCost(st.project) : 0 } : { estimate: st.plan.estimate.cost }),
          project: st.project,
          pad: isDone(st, 'pad'),
          worst: read.get('StructureInspection', id)?.worst,
          inspectedAt: read.get('StructureInspection', id)?.at,
        })),
    },
    'structures.templates': {
      label: 'What can be built: every template, its kind and default size',
      compute: (read: ReadCtx) => templatesOf(read),
    },
    'structures.preview': {
      label: 'A plan before it is built: elements, estimate, problems and advice',
      description: 'args: template, pos [x, z], rotation?, length?, width?, height?, floors?, prepare?, store? (where its goods come from: hand work carries from it), party? (whose plan: reckoned on what it knows of the ground; none: the soil map)',
      compute: (read: ReadCtx, args: Record<string, unknown> = {}) => {
        const spec = args as unknown as PlanSpec;
        if (!spec?.template || !Array.isArray(spec.pos)) return null;
        return planOf(read, spec);
      },
    },
  },
});
