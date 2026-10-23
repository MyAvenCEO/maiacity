/**
 * Whether a structure stands (decisions 0015, 0026): two implementations of the structural contract.
 * Mechanics: the gust's pressure on its face against what holds it — pegs and guy lines for a
 * tent, its own weight about the toe for a free-standing wall; a building's weight on the ground
 * under its foundation (or its walls, without one) against the soil's presumptive bearing pressure,
 * and its weight against the wind's overturning moment. Rules of thumb: a tent's wind rating, a
 * wall's slenderness, a building's load per storey against the ground its kind of soil carries.
 */
import { defineModule, ex, type EntityId, type ModelDescriptor, type ReadCtx } from '../../kernel/src/index.ts';
import type { Assessment, Built, Plan, StructuralPort } from './contract.ts';

const G = 9.81;

/** the share of an element there is (as planned when nothing is said of what is built) */
const shareOf = (built: Built | undefined, element: string): number => (built ? Math.min(1, Math.max(0, built[element] ?? 0)) : 1);

/**
 * How much of a building's weight is there: its elements by what their trades bring per unit (the deliveries' tonnes),
 * each as far as it is built
 */
function massShare(read: ReadCtx, plan: Plan, built: Built | undefined): number {
  if (!built) return 1;
  const acts = read.data('activities');
  let all = 0;
  let there = 0;
  for (const e of plan.elements) {
    const per = acts[e.activity]?.subcontract?.deliveries?.perUnit.value ?? 0;
    all += per * e.quantity;
    there += per * e.quantity * shareOf(built, e.id);
  }
  if (all > 0) return there / all;
  const parts = plan.elements.filter((e) => e.part);
  return parts.length ? parts.reduce((a, e) => a + shareOf(built, e.id), 0) / parts.length : 1;
}

/**
 * The height of a building's walls standing on their own now: storeys of walls laid above what braces them, the slab
 * over a storey (the top one: the roof) or the storey's cross walls laid with it (the plan reckons each as one element,
 * laid storey after storey; r41)
 */
function unbracedHeight(plan: Plan, built: Built | undefined): number {
  const b = plan.physics.bearing;
  const u = b?.unbraced;
  if (!b || !u || !built || !b.storey) return 0;
  const storeys = shareOf(built, u.walls) * b.floors;
  const bySlabs = shareOf(built, u.slabs) * (b.floors - 1) + (storeys >= b.floors - 1e-9 ? shareOf(built, u.roof) : 0);
  const braced = Math.min(storeys, Math.max(bySlabs, shareOf(built, u.cross) * b.floors));
  return b.storey * Math.max(0, storeys - braced);
}

/** a structure's elements as built: its plan's, and those it is losing (taken down or revised away) while they stand (r41) */
function asBuilt(st: { plan: Plan; before?: { plan: Plan } }): Plan {
  const gone = (st.before?.plan.elements ?? []).filter((e) => !st.plan.elements.some((x) => x.id === e.id));
  return gone.length ? { ...st.plan, elements: [...st.plan.elements, ...gone] } : st.plan;
}

function facts(read: ReadCtx, id: EntityId, built?: Built) {
  const st = read.require('Structure', id);
  const p = built ? asBuilt(st as unknown as { plan: Plan; before?: { plan: Plan } }) : st.plan;
  // a wall as high as it is laid (its parts as far as they are built)
  const parts = p.elements.filter((e) => e.part);
  const laid = built && parts.length ? parts.reduce((a, e) => a + shareOf(built, e.id), 0) / parts.length : 1;
  // pegs or posts lifted by frost hold only with what is still in the ground: the frost class's rate a day, the days of frost below their foot, at most how deep they went
  const set = read.data('structureSettings');
  const embed = p.physics.embed;
  const rate = st.heaveClass ? set.frostHeave?.perDay[st.heaveClass] : undefined;
  const lifted = embed && st.heaved && rate ? ex.min('lifted by frost', 'm', ex.mul(undefined, 'm', ex.param(rate, `frost heave in ${st.heaveClass} ground a day`), ex.value(st.heaveDays ?? 0, 'd', 'days of frost below the foot')), ex.param(embed, 'how deep they go')) : undefined;
  const inGroundEx = lifted && embed ? ex.sum('share still in the ground', '1', ex.value(1, '1', 'all of it'), ex.mul(undefined, '1', ex.div(undefined, '1', lifted, ex.param(embed, 'how deep they go')), ex.value(-1, '1', 'less what is out'))) : undefined;
  const inGround = inGroundEx ? Math.max(0, inGroundEx.v) : 1;
  return { st: { length: p.length, height: p.height * laid, inGround, inGroundEx, heaved: st.heaved ?? 0 }, tpl: p.physics, set, plan: p };
}

/** where a building bears on the ground: on its foundation (when its plan has one) or with its walls, at what depth, on what soil */
function ground(read: ReadCtx, plan: Plan) {
  const b = plan.physics.bearing!;
  const founded = plan.elements.some((e) => e.id === b.foundation);
  const dug = plan.elements.some((e) => e.id === 'excavation');
  const depth = founded || dug ? b.depth : 0.3;
  const t = read.port('terrain');
  // (the founding depth is from the ground as it was; what is dug out of it already, the pit, is not above the foot any more)
  const dug0 = Math.max(0, t.originalHeightAt(plan.pos[0], plan.pos[1]) - t.heightAt(plan.pos[0], plan.pos[1]));
  const soil = t.soilClass(t.soilClassAtDepth(plan.pos[0], plan.pos[1], Math.max(0, depth - dug0) + 0.05));
  const area = founded ? ex.value(b.footprint, 'm2', 'on its foundation: the footprint') : ex.mul('without a foundation: its walls on the ground', 'm2', ex.value(b.perimeter, 'm', 'perimeter'), ex.param(b.bearer, 'bearing width'));
  return { b, founded, depth, soil, area };
}

export const MECHANICS_MODEL: ModelDescriptor = {
  contract: 'structural',
  implementation: 'mechanics',
  kind: 'model',
  label: 'Hand mechanics: gust pressure (½ρv² × drag × face) against anchorage (tents) or the overturning resistance of its own weight (free-standing walls, bodies such as a caravan)',
  validity: { notes: 'Static checks on a whole structure; no dynamic effects; frost heave only as pegs or posts lifted out of the ground (no leaning); no snow (reckoned by the structures module against the rating).' },
  resolution: 'per structure and day',
  confidence: 'low',
  sources: [{ title: 'practice pack: structureSettings (EN 1991-1-4 wind pressure principles)' }],
};

function mechanics(read: ReadCtx, id: EntityId, wind: number, built?: Built): Assessment {
  const { st, tpl, set, plan } = facts(read, id, built);
  if (tpl.form === 'building') return buildingMechanics(read, plan, wind, built);
  const gust = ex.mul('gust', 'm/s', ex.value(wind, 'm/s', 'mean wind of the day'), ex.param(set.gustFactor, 'gust factor'));
  const q = ex.mul('wind pressure ½ρv²', 'Pa', ex.value(0.5, ''), ex.param(set.airDensity, 'air density'), ex.value(gust.v ** 2, 'm2/s2', `(${gust.v.toFixed(1)} m/s)²`));
  if (tpl.form === 'tent') {
    const area = st.length * st.height;
    const force = ex.mul('wind load on the tent', 'kN', q, ex.param(set.drag, 'drag'), ex.value(area, 'm2', 'face across the wind'), ex.value(0.001, 'kN/N'));
    const pegs = tpl.anchorage ? ex.param(tpl.anchorage, 'pegs and guy lines') : ex.value(1e-6, 'kN', 'nothing holds it');
    const hold = st.inGround < 1 && st.inGroundEx ? ex.mul('what still holds', 'kN', pegs, ex.max(undefined, '1', st.inGroundEx, ex.value(1e-6, '1', 'nothing'))) : pegs;
    const u = ex.div('utilisation of the anchorage', '1', force, hold);
    return { utilisation: u.v, explain: u, provenance: { kind: 'model', source: 'mechanics', confidence: 'low' } };
  }
  // a body standing on its own weight (a caravan on its jacks): the wind on its side about the leeward wheels against its whole weight
  if (tpl.form === 'body') {
    const wm = ex.mul('wind moment', 'N', q, ex.param(set.drag, 'drag'), ex.value(st.length * st.height, 'm2', 'side across the wind'), ex.value(st.height / 2, 'm', 'lever (half the height)'));
    const rm = ex.mul('resisting moment', 'N', ex.param(tpl.mass, 'its mass'), ex.value(G, 'm/s2'), ex.value(tpl.width.value / 2, 'm', 'lever (half the width)'));
    const u = ex.div('utilisation against overturning', '1', wm, rm);
    return { utilisation: u.v, explain: u, provenance: { kind: 'model', source: 'mechanics', confidence: 'low' } };
  }
  // a free-standing wall, per metre: the wind's moment about the toe against its weight's
  const h = st.height;
  const t = tpl.width.value;
  const wm = ex.mul('wind moment per metre', 'N', q, ex.param(set.drag, 'drag'), ex.value(h, 'm', 'height'), ex.value(h / 2, 'm', 'lever (half the height)'));
  const rm = ex.mul('resisting moment per metre', 'N', ex.param(tpl.mass, 'mass per m² of face'), ex.value(h, 'm', 'height'), ex.value(G, 'm/s2'), ex.value(t / 2, 'm', 'lever (half the thickness)'));
  const u = ex.div('utilisation against overturning', '1', wm, rm);
  return { utilisation: u.v, explain: u, provenance: { kind: 'model', source: 'mechanics', confidence: 'low' } };
}

function buildingMechanics(read: ReadCtx, plan: Plan, wind: number, built?: Built): Assessment {
  const set = read.data('structureSettings');
  const { b, soil, area } = ground(read, plan);
  const there = massShare(read, plan, built);
  if (!(there > 1e-9)) {
    const none = ex.value(0, '1', 'nothing of it is built yet');
    return { utilisation: 0, explain: none, provenance: { kind: 'model', source: 'mechanics', confidence: 'low' }, settlement: { utilisation: 0, explain: none } };
  }
  const built0 = ex.value(there, '1', built ? 'the share of its weight built' : 'as planned');
  const load = ex.mul('its weight and what it carries', 'kN', ex.sum(undefined, 'kN/m2', ex.param(b.dead, 'permanent'), ex.param(b.imposed, 'imposed')), ex.value(b.floorArea, 'm2', 'floor area'), built0);
  const pressure = ex.div('pressure on the ground', 'kPa', load, area);
  const settle = ex.div('settlement: pressure against the presumptive bearing pressure', '1', pressure, ex.param(soil.bearing, soil.label));
  const bearing = ex.div('bearing failure: pressure against twice the presumptive', '1', pressure, ex.mul(undefined, 'kPa', ex.value(2, '1', 'presumptive values keep about half of the failure load'), ex.param(soil.bearing, soil.label)));
  // the day's gust against its own weight about the leeward edge
  const gust = wind * set.gustFactor.value;
  const q = 0.5 * set.airDensity.value * gust ** 2;
  // (as high as it stands: its walls as far as they are up, the roof once on)
  const ub0 = b.unbraced;
  const height = built && ub0 && b.storey ? shareOf(built, ub0.walls) * b.floors * b.storey + shareOf(built, ub0.roof) * Math.max(0, plan.height - b.floors * b.storey) : plan.height * there;
  const moment = ex.value(q * set.drag.value * plan.length * height * (height / 2) / 1000, 'kNm', `wind on a face of ${Math.round(plan.length)} × ${height.toFixed(1)} m, gusts ${gust.toFixed(1)} m/s`, set.drag.source);
  const resist = ex.mul('its weight about the leeward edge', 'kNm', ex.param(b.dead, 'permanent'), ex.value(b.floorArea, 'm2', 'floor area'), ex.value(plan.width / 2, 'm', 'half its width'), built0);
  const overturn = ex.div('overturning', '1', moment, resist);
  // the storey under way, standing on its own: per metre, the gust's moment about its foot against its weight's
  const h = unbracedHeight(plan, built);
  const ub = b.unbraced;
  const alone =
    h > 1e-6 && ub
      ? ex.div(
          `walls going up, ${h.toFixed(2)} m standing on their own`,
          '1',
          ex.value((q * set.drag.value * h * h) / 2, 'N', `wind moment per metre (gusts ${gust.toFixed(1)} m/s)`, set.drag.source),
          ex.mul('resisting moment per metre', 'N', ex.param(ub.mass, 'weight per m² of face'), ex.value(h, 'm', 'height'), ex.value(G, 'm/s2'), ex.value(ub.thickness.value / 2, 'm', 'lever (half the thickness)')),
        )
      : undefined;
  const u = [bearing, overturn, ...(alone ? [alone] : [])].reduce((a, x) => (x.v > a.v ? x : a));
  return { utilisation: u.v, explain: u, provenance: { kind: 'model', source: 'mechanics', confidence: 'low' }, settlement: { utilisation: settle.v, explain: settle }, ...(alone ? { unbraced: { height: h, utilisation: alone.v } } : {}) };
}

export const mechanicsModule = defineModule({
  id: 'structural-mechanics',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Structure'],
  label: 'Structural response (mechanics)',
  provides: ['structural'],
  models: [MECHANICS_MODEL],
  ports: { structural: (read: ReadCtx): StructuralPort => ({ assess: (id, day, built) => mechanics(read, id, day.wind, built) }) },
});

export const RULES_MODEL: ModelDescriptor = {
  contract: 'structural',
  implementation: 'rules',
  kind: 'model',
  label: 'Rules of thumb: a tent up to its rated wind; a dry wall up to its slenderness limit, less as the wind rises',
  validity: { notes: 'Ratings and limits of the practice pack; nothing in between is reckoned, but a tent whose pegs frost has lifted holds against its rating only with what is still in the ground.' },
  resolution: 'per structure and day',
  confidence: 'low',
  sources: [{ title: 'practice pack: structureTemplates (ratings)' }],
};

function rules(read: ReadCtx, id: EntityId, wind: number, built?: Built): Assessment {
  const { st, tpl, set, plan } = facts(read, id, built);
  if (tpl.form === 'building') return buildingRules(read, plan, wind, built);
  const gust = wind * set.gustFactor.value;
  const rated = tpl.rating.wind?.value ?? 1e-6;
  const byWind0 = ex.value((gust / rated) ** 2, '1', `gusts ${gust.toFixed(1)} m/s against a rating of ${rated} m/s`, tpl.rating.wind?.source);
  // (a tent's rating is for pegs fully in the ground: lifted by frost, it holds that much less)
  const byWind = tpl.form === 'tent' && st.inGround < 1 && st.inGroundEx ? ex.div('against what still holds', '1', byWind0, ex.max(undefined, '1', st.inGroundEx, ex.value(1e-6, '1', 'nothing'))) : byWind0;
  if (tpl.form === 'wall' && tpl.rating.slenderness) {
    const u = ex.mul('utilisation (slenderness × wind)', '1', ex.value(st.height / tpl.width.value / tpl.rating.slenderness.value, '1', `height/thickness ${(st.height / tpl.width.value).toFixed(1)} against a limit of ${tpl.rating.slenderness.value}`, tpl.rating.slenderness.source), byWind);
    return { utilisation: u.v, explain: u, provenance: { kind: 'model', source: 'rules', confidence: 'low' } };
  }
  return { utilisation: byWind.v, explain: byWind, provenance: { kind: 'model', source: 'rules', confidence: 'low' } };
}

function buildingRules(read: ReadCtx, plan: Plan, wind: number, built?: Built): Assessment {
  const set = read.data('structureSettings');
  const r = set.rules;
  const { b, soil, area } = ground(read, plan);
  const allowable = r.allowable[soil.group];
  const there = massShare(read, plan, built);
  if (!(there > 1e-9)) {
    const none = ex.value(0, '1', 'nothing of it is built yet');
    return { utilisation: 0, explain: none, provenance: { kind: 'model', source: 'rules', confidence: 'low' }, settlement: { utilisation: 0, explain: none } };
  }
  const load = ex.mul('a storey’s rule-of-thumb load × storeys × footprint', 'kN', ex.param(r.storeyLoad, 'per m² and storey'), ex.value(b.floors, '1', 'storeys'), ex.value(b.footprint, 'm2', 'footprint'), ex.value(there, '1', built ? 'the share of its weight built' : 'as planned'));
  const pressure = ex.div('pressure on the ground', 'kPa', load, area);
  const settle = allowable && allowable.value > 0 ? ex.div(`settlement: against what ${soil.group} ground carries`, '1', pressure, ex.param(allowable, `${soil.group} ground`)) : ex.value(99, '1', `${soil.group} ground: no building on it by the rules`);
  const fail = ex.mul('bearing failure (half the settlement measure)', '1', settle, ex.value(0.5, '1'));
  // the storey under way, on its own: its slenderness against the rule's, as the gusts near its rating
  const h = unbracedHeight(plan, built);
  const ub = b.unbraced;
  const gust = wind * set.gustFactor.value;
  const alone =
    h > 1e-6 && ub
      ? ex.mul(`walls going up, ${h.toFixed(2)} m standing on their own (slenderness × wind)`, '1', ex.div(undefined, '1', ex.value(h / ub.thickness.value, '1', 'height/thickness'), ex.param(ub.slenderness, 'the rule’s slenderness')), ex.value((gust / ub.gust.value) ** 2, '1', `gusts ${gust.toFixed(1)} m/s against ${ub.gust.value} m/s`, ub.gust.source))
      : undefined;
  const u = alone && alone.v > fail.v ? alone : fail;
  return { utilisation: u.v, explain: u, provenance: { kind: 'model', source: 'rules', confidence: 'low' }, settlement: { utilisation: settle.v, explain: settle }, ...(alone ? { unbraced: { height: h, utilisation: alone.v } } : {}) };
}

export const rulesModule = defineModule({
  id: 'structural-rules',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Structure'],
  label: 'Structural response (rules of thumb)',
  provides: ['structural'],
  models: [RULES_MODEL],
  ports: { structural: (read: ReadCtx): StructuralPort => ({ assess: (id, day, built) => rules(read, id, day.wind, built) }) },
});
