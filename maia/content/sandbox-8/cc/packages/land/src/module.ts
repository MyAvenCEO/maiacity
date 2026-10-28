/**
 * Parcels, and the holders of land who notice and react (decision 0025). Nothing here refuses an
 * act: a camp can be pitched and a hut built on anyone's land. Each day every use of another
 * party's land is looked at: once its holder notices (when, the detection contract draws, hidden),
 * the holder acts by the law of the place, step by step, with the time each step gives. A party
 * can leave, or get the holder's permission (an agreement about the parcel).
 */
import { command, DAY, defineModule, HOUR, s, type Blocker, type EntityId, type ModelDescriptor, type ReadCtx, type Remedy, type WriteCtx } from '../../kernel/src/index.ts';
import { polygonContains, type Vec2 } from '../../geo/src/index.ts';
import { actorOf, partyLabel } from '../../parties/src/index.ts';
import { ACCOUNTS, acct, pay, receive } from '../../economy/src/index.ts';
import type {} from '../../agreements/src/index.ts';
import type {} from '../../network/src/index.ts';
import { charge, relent } from './charge.ts';
import { BASES, BuildingLawSchema, DetectionSettingsSchema, LeaseEndSchema, ParcelDataSchema, TrespassSchema, ZoningSchema, type DetectionPort, type Encounter, type Held, type LandPort, type LandState, type LandUse, type LawStep, type UseView } from './contract.ts';

/** the parcel at a place: a drawn outline first, else the rest of the map */
function parcelAt(read: ReadCtx, pos: Vec2): EntityId | null {
  let rest: EntityId | null = null;
  for (const [id, p] of read.all('Parcel')) {
    if (!p.polygon) {
      rest ??= id;
      continue;
    }
    if (polygonContains(p.polygon, pos)) return id;
  }
  return rest;
}

/** may this party use this parcel (for a kind of use a permission must name: felling): it holds it, or an agreement about it that allows it */
function permitted(read: ReadCtx, party: EntityId, parcel: EntityId, kind?: string): boolean {
  const p = read.get('Parcel', parcel);
  if (!p || p.holder === party || p.basis === 'none') return true;
  return leaveFor(read, party, parcel, kind) !== undefined;
}

/** what a product lets its holder do: what it permits ('stay': being there); without a word, staying there only */
const allows = (permits: string[] | undefined, kind?: string) => (permits ? permits.includes(kind ?? 'stay') : !kind);

/** the agreement of ours, begun, that lets us do this on the parcel (with `at`: that did then) */
const leaveFor = (read: ReadCtx, party: EntityId, parcel: EntityId, kind?: string, at?: number) => read.port('agreements').permitting(party, parcel, kind, at);

/**
 * The trees a felling has brought down on another's land with their leave are bought, not taken: each
 * day, the trees felled since are looked at once, and those felled under an agreement that lets us fell
 * there are paid for at its royalty (by the tonne of logs) and never claimed as damages.
 */
function buyWood(ctx: WriteCtx, was: LandState['wood']): LandState['wood'] {
  const out: LandState['wood'] = {};
  const owed = new Map<EntityId, { party: EntityId; work: EntityId; t: number }>();
  for (const [id, w] of ctx.all('WorkPackage')) {
    const at = w.fells ? (w.felledAt ?? []) : [];
    const party = ctx.get('Project', w.project)?.party;
    const prev = was[id] ?? { seen: 0, bought: [], claimed: [] };
    if (!party || (!at.length && !was[id])) continue;
    // (each tree is looked at once: nothing new, nothing to do)
    if (prev.seen >= at.length) {
      out[id] = prev;
      continue;
    }
    const bought = [...prev.bought];
    for (let i = prev.seen; i < at.length; i += 1) {
      const [x, z, t, when] = at[i]!;
      const p = parcelAt(ctx, [x, z]);
      if (!p || ctx.get('Parcel', p)?.holder === party) continue;
      // (with leave when it came down, whether the leave has ended since or not; felled before it began, it was taken)
      const a = leaveFor(ctx, party, p, 'felling', when);
      if (!a) continue;
      bought.push(i);
      const k = `${a}|${id}`;
      owed.set(k, { party, work: id, t: (owed.get(k)?.t ?? 0) + t });
    }
    out[id] = { seen: at.length, bought, claimed: prev.claimed };
  }
  for (const [k, o] of [...owed].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const a = ctx.get('Agreement', k.split('|')[0]!)!;
    const amount = o.t * Number(a.terms.royalty ?? 0) * ctx.port('prices').index(ctx.now);
    if (!(amount > 0.005)) continue;
    if (ctx.port('prices').hasBooks(o.party)) {
      pay(ctx, o.party, ACCOUNTS.materials, amount, `${a.label}: ${o.t.toFixed(2)} t of logs felled`, [o.work, k.split('|')[0]!]);
      // (into the books of the one whose wood it was, where it keeps them: its wood sold standing)
      if (a.party !== o.party && ctx.port('prices').hasBooks(a.party)) ctx.ledger.post({ from: acct(a.party, ACCOUNTS.sales), to: acct(a.party, ACCOUNTS.cash), amount: Math.round(amount * 100) / 100, memo: `${a.label}: ${o.t.toFixed(2)} t of logs felled, from ${partyLabel(ctx, o.party)}`, category: ACCOUNTS.sales, refs: [o.work, k.split('|')[0]!] });
    }
    ctx.log('info', `${partyLabel(ctx, a.party)} is paid ${Math.round(amount)} € for ${o.t.toFixed(1)} t of logs felled on their land (${a.label}).`, [o.work]);
  }
  return out;
}

const landPort = (read: ReadCtx): LandPort => ({ parcelAt: (pos) => parcelAt(read, pos), permitted: (party, parcel, kind) => permitted(read, party, parcel, kind) });

/** how easily a use is noticed: its size, people living there, and how near a way it is */
function visibility(read: ReadCtx, use: LandUse): number {
  const ref = read.data('detectionSettings').reference;
  const near = read.port('routing').nearest(use.pos, { openOnly: false, maxDistance: 5000 });
  const d = near ? Math.hypot(near.point[0] - use.pos[0], near.point[1] - use.pos[1]) : 5000;
  return Math.sqrt(Math.max(1, use.area) / ref.area.value) * (use.people > 0 ? 1.5 : 1) * Math.exp(-d / ref.distance.value);
}

function uses(read: ReadCtx): UseView[] {
  const out: UseView[] = [];
  for (const c of read.contributions('landUse')) for (const u of c.impl(read)) out.push({ ...u, visibility: visibility(read, u) });
  return out.sort((a, b) => (a.subject < b.subject ? -1 : 1));
}

/** a use that is work (felling): ended, the work stops (what was done is done) */
function stopWork(ctx: WriteCtx, subject: EntityId): void {
  const w = ctx.get('WorkPackage', subject);
  if (!w || w.status === 'done' || w.status === 'cancelled') return;
  // a road's or a building's felling stopped: the work cannot go on through the trees left; it is given up (its owner answers)
  const pr = ctx.get('Project', w.project);
  if (pr && pr.owner !== 'production' && pr.status !== 'cancelled' && pr.status !== 'complete') ctx.command('production.cancelProject', { project: w.project });
  else ctx.command('production.cancelPackage', { package: subject });
}

/** felling work under way: where its trees stand that are still to fall */
function fellingUses(read: ReadCtx): LandUse[] {
  const out: LandUse[] = [];
  const veg = read.port('vegetation');
  for (const [id, w] of read.all('WorkPackage')) {
    // (felling begun: someone at work there, or trees down already; a plan is no use of the land)
    if (!w.fells || w.status === 'done' || w.status === 'cancelled' || (w.status !== 'active' && !(w.accounted > 0) && !(w.felled ?? 0))) continue;
    const party = read.get('Project', w.project)?.party;
    if (!party) continue;
    const left = w.fells.trees.slice(w.felled ?? 0).map((t) => veg.tree(t.id)).filter((t): t is NonNullable<typeof t> => Boolean(t));
    if (!left.length) continue;
    // where it is: the trees on another's land without their leave, if any (the first such parcel), else all
    const foreign = new Map<EntityId, typeof left>();
    for (const t of left) {
      const p = parcelAt(read, [t.x, t.z]);
      if (p && read.get('Parcel', p)!.holder !== party && !permitted(read, party, p, 'felling')) foreign.set(p, [...(foreign.get(p) ?? []), t]);
    }
    const first = [...foreign.keys()].sort()[0];
    const at = first ? foreign.get(first)! : left;
    out.push({ subject: id, party, label: w.label, pos: [at.reduce((a, t) => a + t.x, 0) / at.length, at.reduce((a, t) => a + t.z, 0) / at.length], area: at.length * 20, people: 0, kind: 'felling', leave: `stop ${w.label.charAt(0).toLowerCase()}${w.label.slice(1)}` });
  }
  return out;
}

/** what a party can do about it: leave, or ask the holder's permission (what the holder offers about the parcel) */
function wayOut(read: ReadCtx, use: UseView, parcel: EntityId): Remedy[] {
  const out: Remedy[] = [{ label: `Leave: ${use.leave ?? `strike ${use.label} and go`}`, command: { type: 'land.leave', payload: { subject: use.subject } } }];
  const holder = read.require('Parcel', parcel).holder;
  for (const o of read.port('agreements').offers()) {
    const product = read.hasData('products') ? read.data('products')?.[o.id] : undefined;
    // (not one already asked for: it begins shortly)
    const asked = read.port('agreements').applied(use.party, parcel, use.kind);
    if (asked && read.get('Agreement', asked)?.product === o.id) continue;
    if (product?.subjectKind === 'parcel' && read.state('agreements').parties[product.party] === holder && allows(product.permits, use.kind)) out.push({ label: `Ask ${partyLabel(read, holder)}: ${o.label}`, command: { type: 'agreements.open', payload: { product: o.id, subject: parcel } } });
  }
  return out;
}

/** the zone at a place: one whose outline holds it, else the one without (the rest of the map) */
function zoneAt(read: ReadCtx, pos: Vec2): { id: string; label: string; dwelling: boolean; building: boolean } | undefined {
  const zones = read.hasData('zoning') ? read.data('zoning')?.zones : undefined;
  let rest: { id: string; label: string; dwelling: boolean; building: boolean } | undefined;
  for (const [id, z] of Object.entries(zones ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!z.polygon) {
      rest ??= { id, label: z.label, dwelling: z.dwelling, building: z.building };
      continue;
    }
    if (polygonContains(z.polygon.map((x) => [x[0], x[1]] as Vec2), pos)) return { id, label: z.label, dwelling: z.dwelling, building: z.building };
  }
  return rest;
}

/** one who watches a use, by its law: what the matter is, its steps, and the ways out */
/** who watches a use: the matter's key (the holder's per use; the authority's per household and zone, wherever in it they pitch) */
type Watcher = { key: string; law: Encounter['law']; by: EntityId; parcel?: EntityId; why: string; steps: LawStep[]; ways: Remedy[]; kept?: Encounter['kept'] };

/**
 * Things let to a party and kept after their let ended (Qwen S503/S508: the yard store with 3,000 l of diesel stood on the
 * landlord's yard five months after the lease, unnoticed): a store of the former tenant's with goods in it or people
 * living from it. The lessor knows the day its let ends, and asks for it back at once (§ 546 BGB): its matter, with
 * the ways to give it back (the goods moved to a store of the tenant's own, or the thing rented again).
 */
function keptLets(read: ReadCtx, all: UseView[]): { use: UseView; w: Watcher }[] {
  const law = read.hasData('leaseEnd') ? read.data('leaseEnd') : undefined;
  if (!law) return [];
  const out: { use: UseView; w: Watcher }[] = [];
  for (const l of read.port('agreements').lets()) {
    if (l.live || l.ended === undefined) continue;
    const hold = read.port('holdings');
    const at = hold.where(l.subject);
    if (!at || hold.holder(l.subject) !== l.lessee) continue;
    // (the lessor put in possession by a clearance with the goods left there, § 885a ZPO: kept no longer)
    if (Object.values(read.state('land').held ?? {}).some((h) => h.from === l.subject && h.stage === 'left')) continue;
    const camp = all.find((u) => u.subject === l.subject);
    const goods = Object.entries(hold.contents(l.subject)).filter(([, q]) => q > 1e-6).sort(([a], [b]) => (a < b ? -1 : 1));
    if (!goods.length && !camp) continue;
    const use: UseView = camp ?? { subject: l.subject, party: l.lessee, label: hold.label(l.subject)!, pos: [at[0], at[1]], area: 0, people: 0, visibility: 0 };
    // where the goods could go: the nearest other store of the tenant's own (not one it rents, not a road's or a work's)
    const lets = read.port('agreements').lets();
    const other = hold.ofParty(l.lessee, { kind: ['depot', 'stockpile', 'site'], near: at, except: l.subject }).find((id) => !hold.work(id) && !hold.meantFor(id) && !lets.some((y) => y.subject === id && y.lessee === l.lessee));
    const ways: Remedy[] = other ? goods.slice(0, 6).map(([material, qty]) => ({ label: `Have the ${Math.round(qty * 100) / 100} ${material} moved to ${hold.label(other)} (a van with its driver)`, command: { type: 'production.moveGoods', payload: { from: l.subject, to: other, material, qty, by: 'service' } } })) : [];
    if (camp) ways.push({ label: `Leave: ${camp.leave ?? `strike ${camp.label} and go`}`, command: { type: 'land.leave', payload: { subject: l.subject } } });
    if (l.product) ways.push({ label: `Ask ${partyLabel(read, l.lessor)} to let it again`, command: { type: 'agreements.open', payload: { product: l.product, subject: l.subject } } });
    // (kept again after it was given back once: the days from then)
    const since = Math.max(l.ended, read.state('land').keptClaimed?.[l.agreement] ?? 0);
    out.push({ use, w: { key: `lease:${l.subject}`, law: 'lease', by: l.lessor, why: `kept after its let ended on ${read.calendar.format(l.ended, 'day')} (${law.rule})`, steps: law.steps, ways, kept: { agreement: l.agreement, since, perDay: l.rentPerDay } } });
  }
  return out;
}

/** a thing let, given back (or cleared) after it was kept: the rent of the days it was kept, claimed (§ 546a BGB) */
function claimKept(ctx: WriteCtx, e: Encounter): void {
  const law = ctx.hasData('leaseEnd') ? ctx.data('leaseEnd') : undefined;
  if (!law || !e.kept) return;
  const days = Math.max(0, Math.ceil((ctx.now - e.kept.since) / DAY));
  ctx.setState('land', { ...ctx.state('land'), keptClaimed: { ...(ctx.state('land').keptClaimed ?? {}), [e.kept.agreement]: ctx.now } });
  const amount = Math.round(days * e.kept.perDay * 100) / 100;
  const who = partyLabel(ctx, e.by);
  const what = ctx.port('holdings').label(e.subject) ?? e.subject;
  ctx.log('info', `${who} has ${what} back, ${days} days after its let ended${e.kept.since > (ctx.port('agreements').lets().find((l) => l.agreement === e.kept!.agreement)?.ended ?? e.kept.since) ? ' (or since it was last given back)' : ''}.`, [e.subject]);
  if (amount < 0.01) return;
  charge(ctx, { debtor: e.party, creditor: e.by, kind: 'private', label: `${who}: ${what} kept ${days} days after its let ended`, basis: law.compensation, amount, refs: [e.subject] });
  ctx.log('warn', `${who} claims ${Math.round(amount)} € for the ${days} days ${what} was kept after its let ended (${law.compensation}).`, [e.subject]);
}

/** a household living in a zone without homes: since when, and when last seen there (a move within it goes on counting) */
const dwellingKey = (party: EntityId, zone: string) => `${party}|${zone}`;

/**
 * Who watches a use today: the holder of land it stands on without permission (if they look after it),
 * and the building authority where it is lived in for good, longer than a stay, in a zone that allows
 * no dwellings (decision 0025: nothing refuses it; the law's institutions answer with consequences).
 */
function watchers(ctx: ReadCtx, use: UseView, dwelt: LandState['dwelt']): Watcher[] {
  const out: Watcher[] = [];
  const parcel = parcelAt(ctx, use.pos);
  const leave: Remedy = { label: `Leave: ${use.leave ?? `strike ${use.label} and go`}`, command: { type: 'land.leave', payload: { subject: use.subject } } };
  if (parcel && !permitted(ctx, use.party, parcel, use.kind) && ctx.require('Parcel', parcel).watched) {
    const p = ctx.require('Parcel', parcel);
    out.push({ key: `trespass:${use.subject}`, law: 'trespass', by: p.holder, parcel, why: 'on their land', steps: ctx.data('trespass').steps, ways: wayOut(ctx, use, parcel) });
  }
  const zoning = ctx.hasData('zoning') ? ctx.data('zoning') : undefined;
  const law = ctx.hasData('buildingLaw') ? ctx.data('buildingLaw') : undefined;
  const zone = use.dwelling || use.built ? zoneAt(ctx, use.pos) : undefined;
  const since = zone && use.dwelling ? dwelt[dwellingKey(use.party, zone.id)]?.since : undefined;
  const permits = ctx.state('land').permits ?? {};
  if (zoning && law && zone && !zone.dwelling && since !== undefined && ctx.now - since >= law.tolerance.value * DAY && permits[dwellingKey(use.party, zone.id)] === undefined) {
    out.push({ key: `zoning:${dwellingKey(use.party, zone.id)}`, law: 'zoning', by: zoning.authority, why: `lived in for good in the ${zone.label}, where a home needs a permit (${law.rule})`, steps: law.steps, ways: [leave, ...askWays(ctx, use)] });
  }
  // built in place without a permit where nothing may be built: the authority's matter from the first day (no stay to tolerate)
  if (zoning && law && zone && !zone.building && use.built && use.built.volume > law.building.free.value && permits[use.subject] === undefined) {
    const way: Remedy = { label: `Take ${use.label} down`, command: { type: 'structures.demolish', payload: { structure: use.subject } } };
    out.push({ key: `building:${use.subject}`, law: 'building', by: zoning.authority, why: `built without a permit in the ${zone.label} (${law.building.rule})`, steps: law.building.steps, ways: [way, ...askWays(ctx, use)] });
  }
  return out;
}

/** asking the building authority about a use (VISION "Asking the authority is a deed too"): an enquiry, an application after the fact */
function askWays(read: ReadCtx, use: UseView): Remedy[] {
  const apps = read.hasData('buildingLaw') ? read.data('buildingLaw')?.applications : undefined;
  if (!apps) return [];
  const asked = Object.values(read.state('land').applications ?? {}).some((a) => a.subject === use.subject && a.answer === undefined);
  if (asked) return [];
  return (['enquiry', 'permit'] as const).map((kind) => {
    const a = apps[kind];
    const cost = Math.round(a.fee.value + (a.designer?.value ?? 0));
    return { label: `Ask the authority: ${a.label} (some ${cost} € with ${a.designer ? 'the drafter’s fee' : 'its fee'}; answered in about ${Math.round(a.days.value)} days)`, command: { type: 'land.apply', payload: { subject: use.subject, kind } } };
  });
}

/**
 * What of a party's the building authority can be asked about (one fact for land.apply, its remedies and its refusal):
 * a camp or a structure of theirs on the land now, and the subject of a matter of the authority's that waits for a
 * household gone from the zone for less than a stay (struck for a night, the order stands: Qwen S513, the notice's
 * own remedy refused hours after the household went to a lodging).
 */
function askable(read: ReadCtx, party: EntityId): UseView[] {
  const all = uses(read).filter((u) => u.party === party);
  const out = all.filter((u) => read.port('holdings').exists(u.subject) || read.has('Structure', u.subject));
  const st = read.state('land');
  for (const [key, e] of Object.entries(st.encounters)) {
    if (e.party !== party || e.law !== 'zoning' || e.stage === 'unseen' || e.stage === 'clearance' || out.some((u) => u.subject === e.subject)) continue;
    const at = read.port('holdings').where(e.subject);
    const dwelt = st.dwelt[key.slice('zoning:'.length)];
    if (!at || !dwelt) continue;
    out.push({ subject: e.subject, party, label: read.port('holdings').label(e.subject)!, pos: [at[0], at[1]], area: 0, people: 0, dwelling: { since: dwelt.since }, visibility: 0 });
  }
  return out;
}

/** the authority answers what it was asked, when its time has come: by the zone's law (a use it does not allow is refused, the rule named) */
function answer(ctx: WriteCtx): void {
  const st = ctx.state('land');
  const law = ctx.hasData('buildingLaw') ? ctx.data('buildingLaw') : undefined;
  const zoning = ctx.hasData('zoning') ? ctx.data('zoning') : undefined;
  if (!st.applications || !law?.applications || !zoning) return;
  let changed = false;
  const apps = { ...st.applications };
  const permits = { ...(st.permits ?? {}) };
  for (const [id, a] of Object.entries(apps)) {
    if (a.answer || a.decideAt > ctx.now) continue;
    const zone = zoning.zones[a.zone];
    const allowed = Boolean(zone && (a.about === 'dwelling' ? zone.dwelling : zone.building));
    const why = allowed ? 'the zone allows it' : law.applications.refusal[a.about];
    // (an enquiry is answered, not granted: it says whether the use could be permitted, a preliminary decision that
    // permits nothing itself (§ 73 NBauO); only an application is granted: Qwen S505)
    apps[id] = { ...a, answer: allowed ? (a.kind === 'permit' ? 'granted' : 'could be permitted') : 'refused', why };
    changed = true;
    const what = law.applications[a.kind].label;
    if (allowed && a.kind === 'permit') permits[a.about === 'dwelling' ? dwellingKey(a.party, a.zone) : a.subject] = ctx.now;
    ctx.log(allowed ? 'success' : 'warn', `${partyLabel(ctx, zoning.authority)} answers ${partyLabel(ctx, a.party)}'s ${what} about ${a.label}: ${allowed ? (a.kind === 'permit' ? 'granted' : 'it could be permitted') : `refused (${why})`}.`, [a.subject]);
  }
  if (changed) ctx.setState('land', { ...ctx.state('land'), applications: apps, permits });
}

/** what a step of the law says on the use, while it stands */
function stepBlocker(ctx: ReadCtx, e: Encounter, w: Watcher, use: UseView): Blocker | null {
  const st = w.steps[e.step];
  if (!st || st.act === 'clearance') return null;
  const params = { who: partyLabel(ctx, w.by), use: use.label, why: w.why, rule: st.label, date: e.deadline !== undefined ? ctx.calendar.format(e.deadline, 'day') : '', next: w.steps[e.step + 1]?.label ?? 'nothing more' };
  const code = st.act === 'notice' ? 'land.notice' : st.act === 'order' ? 'land.order' : 'land.fined';
  return { code, severity: st.act === 'notice' ? 'warn' : 'block', params, remedies: w.ways };
}

/**
 * The wood taken from a holder's land is theirs (§ 953 BGB): its value claimed as damages, each time they
 * act and when the matter ends, for the logs of the trees that stood on their parcel, felled since the last
 * claim. Returns the logs claimed for so far (undefined: nothing of it).
 */
function claimWood(ctx: WriteCtx, e: Encounter): number | undefined {
  const work = ctx.get('WorkPackage', e.subject);
  const wood = e.law === 'trespass' && work?.fells && e.parcel ? ctx.data('trespass').wood : undefined;
  if (!wood) return undefined;
  // (any parcel of theirs the felling reached)
  const rec = ctx.state('land').wood[e.subject] ?? { seen: 0, bought: [], claimed: [] };
  // (the trees looked at so far: theirs, not felled with their leave, and not claimed for already, by this matter or one before)
  const skip = new Set([...rec.bought, ...rec.claimed]);
  const now: number[] = [];
  let due = 0;
  (work!.felledAt ?? []).slice(0, rec.seen).forEach(([x, z, t], i) => {
    const p = parcelAt(ctx, [x, z]);
    if (p === null || ctx.get('Parcel', p)?.holder !== e.by || skip.has(i)) return;
    now.push(i);
    due += t;
  });
  if (due <= 1e-6) return e.claimed;
  ctx.setState('land', { ...ctx.state('land'), wood: { ...ctx.state('land').wood, [e.subject]: { ...rec, claimed: [...rec.claimed, ...now] } } });
  const theirs = (e.claimed ?? 0) + due;
  const who = partyLabel(ctx, e.by);
  const amount = due * wood.value.value * ctx.port('prices').index(ctx.now);
  charge(ctx, { debtor: e.party, creditor: e.by, kind: 'private', label: `${who}: the wood taken (${due.toFixed(1)} t of logs)`, basis: wood.rule, amount, refs: [e.subject] });
  ctx.log('warn', `${who} claims ${Math.round(amount)} € for the wood taken from their land (${due.toFixed(1)} t of logs, ${wood.rule}).`, [e.subject]);
  return theirs;
}

const LAND = 'land';

/** the removal firm sent for the goods in a thing cleared (§ 885 Abs. 3 ZPO): in by the way in, to them, and out again with them */
function removeGoods(ctx: WriteCtx, id: string, h: Held): Held {
  const g = ctx.data('leaseEnd')!.goods;
  const where = ctx.port('holdings').where(h.from);
  const ext = ctx.port('routing').externalNodes()[0];
  const tries = (h.tries ?? 0) + 1;
  const at = where ? ([where[0], where[1]] as Vec2) : undefined;
  const r = at && ext !== undefined ? ctx.command('moves.dispatch', { legs: [{ carrier: { class: g.vehicle }, from: at, to: at, externalNode: ext, loads: [] }, { carrier: { class: g.vehicle }, from: at, to: at, externalDestination: ext, loads: [] }], purpose: 'clearance', ref: id, requester: LAND }) : null;
  const { move: _m, ...rest } = h;
  if (!r?.ok) {
    ctx.log('warn', `The removal firm the bailiff sent cannot get to the goods in ${ctx.port('holdings').label(h.from) ?? h.from} (${r ? r.reasons.map((b) => ctx.formatBlocker(b)).join('; ') : 'no way in'}); it tries again (${tries} of ${Math.round(g.tries.value)}).`, [h.from]);
    return { ...rest, tries };
  }
  return { ...rest, tries, move: r.value as EntityId };
}

const goodsSaid = (ctx: ReadCtx, goods: Record<string, number>): string =>
  Object.entries(goods)
    .map(([m, q]) => `${Math.round(q * 100) / 100} ${ctx.port('holdings').material(m).unit} ${ctx.port('holdings').material(m).label}`)
    .join(', ');

/** the clearance's costs still owed by the former tenant (its goods are handed back only once they are paid, § 885 Abs. 4 ZPO) */
function clearanceOwed(read: ReadCtx, h: Held): { agreement: EntityId; owed: number }[] {
  const step = read.data('leaseEnd')?.steps.find((x) => x.act === 'clearance');
  if (!step) return [];
  const out: { agreement: EntityId; owed: number }[] = [];
  for (const [id, a] of read.all('Agreement')) {
    if (a.instrument !== 'claim' || a.holder !== h.party || a.terms.about !== h.from || !a.label.startsWith(step.label) || a.status === 'ended') continue;
    const owed = a.open.filter((o) => o.payer === 'holder').reduce((x, o) => x + o.amount - o.paid, 0);
    if (owed > 0.005) out.push({ agreement: id, owed });
  }
  return out;
}

/** a party's own stores on the map goods held for it could go to, nearest the place they were taken from first */
function ownStores(read: ReadCtx, h: Held): [EntityId, string][] {
  const from = read.port('holdings').where(h.from) ?? [0, 0];
  const lets = read.port('agreements').lets();
  const hold = read.port('holdings');
  return hold
    .ofParty(h.party, { kind: ['depot', 'stockpile', 'site'], kept: true, near: [from[0], from[1]], except: h.from })
    .filter((id) => !hold.work(id) && !hold.meantFor(id) && !lets.some((y) => y.subject === id && y.lessee === h.party && !y.live))
    .map((id) => [id, hold.label(id)!]);
}

/**
 * The removal firm's way in from beyond the map to a point, as its lorry is sent (`moves.dispatch` routes it so): the
 * one function for whether it gets there, asked by the remedies offered and the command alike (decision 0028 rule 4;
 * review y: a store it could not reach was offered), or null
 */
function firmWayIn(read: ReadCtx, at: Vec2) {
  const routing = read.port('routing');
  const ext = routing.externalNodes()[0];
  return ext !== undefined ? routing.routeFromExternal(ext, at, read.data('leaseEnd')!.goods.vehicle) : null;
}

/** where the goods held for a party could be brought back to: its own stores on the map the removal firm's lorry gets to */
function homesFor(read: ReadCtx, h: Held): [EntityId, string][] {
  return ownStores(read, h).filter(([id]) => firmWayIn(read, read.port('holdings').where(id)!) !== null);
}

/**
 * no store of the party's to have the goods in (or none the removal firm's lorry gets to, `lorry`): one to set up by the
 * way nearest the place they were taken from, where that lorry gets to (0028 rule 3: what would give a way)
 */
function storeByTheWay(read: ReadCtx, h: Held, lorry: boolean): Remedy[] {
  const from = read.port('holdings').where(h.from);
  const near = from ? read.port('routing').nearest([from[0], from[1]], { openOnly: true, ...(lorry ? { profile: read.data('leaseEnd')!.goods.vehicle } : {}) }) : null;
  if (!near) return [];
  const at: Vec2 = [Math.round(near.point[0]), Math.round(near.point[1])];
  if (lorry && firmWayIn(read, at) === null) return [];
  return [{ label: `Set up a store of ours by the road at (${at[0]}, ${at[1]})${lorry ? ', where the removal firm\'s lorry gets to' : ', to move them to'}`, command: { type: 'inventory.createStore', payload: { holder: h.party, label: 'Store by the road', kind: 'stockpile', pos: at } } }];
}

/** the removal firm's lorry sent to bring the goods held back into a store (by the way in, out empty): its move, or why not */
function bringBack(ctx: WriteCtx, id: string, h: Held, to: EntityId): { move: EntityId } | { why: string } {
  const g = ctx.data('leaseEnd')!.goods;
  const hold = ctx.port('holdings');
  const where = hold.where(to);
  const ext = ctx.port('routing').externalNodes()[0];
  if (!where || ext === undefined) return { why: !where ? 'the store is gone' : 'no way into the map' };
  const at = [where[0], where[1]] as Vec2;
  const loads = Object.entries(h.goods).map(([material, qty]) => ({ goods: { material, qty, unit: hold.material(material).unit, holder: h.party } }));
  const r = ctx.command('moves.dispatch', { legs: [{ carrier: { class: g.vehicle }, from: at, to: at, externalNode: ext, loads }], purpose: 'goods back', ref: id, requester: LAND, returnEmpty: true, returnVia: { externalDestination: ext } });
  return r.ok ? { move: r.value as EntityId } : { why: r.reasons.map((b) => ctx.formatBlocker(b)).join('; ') };
}

/**
 * The goods could not be brought back (its lorry stopped on every try, or the store gone): in storage still, what was
 * paid for the trip refunded (freight is owed on delivery, § 420 HGB; review y), said with the ways to have them back.
 * They were asked back with the costs paid, so the month for asking is not over by the firm's failing: a month from now
 * at the least (§ 885 Abs. 4 ZPO sells only what is not asked back in time)
 */
function backFailed(ctx: WriteCtx, id: string, h: Held, why: string): void {
  const { move: _m, to: _t, tries: _n, paid, ...rest } = h;
  const from = ctx.port('holdings').label(h.from) ?? h.from;
  if (paid && paid > 0 && ctx.port('prices').hasBooks(h.party)) receive(ctx, h.party, ACCOUNTS.transport, paid, `The goods taken from ${from} not brought back from storage (${why}): the trip refunded`, [h.from]);
  const until = Math.max(h.until ?? ctx.now, ctx.now + ctx.data('leaseEnd')!.goods.keep.value * DAY);
  ctx.patchState('land', { held: { ...(ctx.state('land').held ?? {}), [id]: { ...rest, stage: 'held', until } } });
  ctx.log('warn', `The removal firm could not bring the goods taken from ${from} back (${why}): they are in storage still${paid ? `, the ${Math.round(paid)} € for the trip refunded` : ''}; ask again.`, [h.from]);
  sayHeld(ctx, h.from);
}

/** what is said of goods held for a party after a clearance (in storage, or left where they were), with how to have them back */
function heldBlocker(read: ReadCtx, id: string, h: Held): Blocker {
  const g = read.data('leaseEnd')!.goods;
  const params = { goods: goodsSaid(read, h.goods), from: read.port('holdings').label(h.from) ?? h.from, party: partyLabel(read, h.party), by: partyLabel(read, h.by), until: read.calendar.format(h.until ?? read.now, 'day'), rule: h.stage === 'left' ? g.left : g.rule };
  if (h.stage === 'left') {
    // (left where they were: taken away by our own means, into a store of ours, within the month)
    const to = ownStores(read, h)[0];
    const remedies: Remedy[] = to ? Object.entries(h.goods).slice(0, 6).map(([material, qty]) => ({ label: `Have the ${Math.round(qty * 100) / 100} ${material} moved to ${to[1]} (a van with its driver)`, command: { type: 'production.moveGoods', payload: { from: h.from, to: to[0], material, qty, by: 'service' } } })) : storeByTheWay(read, h, false);
    return { code: 'land.goodsLeft', severity: 'warn', params, remedies };
  }
  const homes = homesFor(read, h);
  const remedies: Remedy[] = [
    ...clearanceOwed(read, h).map((c) => ({ label: `Pay the clearance's costs (${Math.round(c.owed)} €): the goods are handed back only then`, command: { type: 'agreements.act', payload: { agreement: c.agreement, action: 'pay', amount: Math.round(c.owed * 100) / 100 } } })),
    ...homes.slice(0, 3).map(([to, label]) => ({ label: `Have them brought back to ${label} (${Math.round(g.back.value * read.port('prices').index(read.now))} €)`, command: { type: 'land.fetchGoods', payload: { held: id, to } } })),
    ...(homes.length ? [] : storeByTheWay(read, h, true)),
  ];
  return { code: 'land.goodsHeld', severity: 'warn', params, remedies };
}

/** what goods fetch at a sale by the bailiff or the creditor (a share of their price new), less the sale's costs; and what nobody buys */
function proceeds(read: ReadCtx, goods: Record<string, number>): { gross: number; net: number; unsold: string[] } {
  const g = read.data('leaseEnd')!.goods;
  const hold = read.port('holdings');
  let gross = 0;
  const unsold: string[] = [];
  for (const [m, q] of Object.entries(goods).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const price = read.port('trade').offers(m)[0]?.price;
    if (price === undefined || !(price > 0)) unsold.push(m);
    else gross += q * price * g.fetches.value;
  }
  return { gross, net: Math.round(gross * (1 - g.saleCosts.value) * 100) / 100, unsold };
}

/**
 * goods held for a party past their month, not fetched: sold by the bailiff (§ 885 Abs. 4 ZPO). They are beyond the
 * map already; what they fetch (a share of their price new) less the sale's costs is paid to the party, what nobody
 * buys is destroyed
 */
function sellHeld(ctx: WriteCtx, id: string, h: Held): void {
  const g = ctx.data('leaseEnd')!.goods;
  const hold = ctx.port('holdings');
  const { gross, net, unsold } = proceeds(ctx, h.goods);
  const from = ctx.port('holdings').label(h.from) ?? h.from;
  if (net > 0 && ctx.port('prices').hasBooks(h.party)) receive(ctx, h.party, ACCOUNTS.sales, net, `The bailiff's sale of the goods taken from ${from} (${g.rule}): ${Math.round(gross)} € less the sale's costs`, [h.from]);
  ctx.log('warn', `Not fetched within the month, the goods taken from ${from} were sold by the bailiff (${g.rule}): ${goodsSaid(ctx, h.goods)}; ${net > 0 ? `${Math.round(net)} € paid to ${partyLabel(ctx, h.party)}, the sale's costs taken` : 'nothing paid out'}${unsold.length ? `; what nobody buys was destroyed (${unsold.map((m) => hold.material(m).label).join(', ')})` : ''}.`, [h.from]);
  const { [id]: _sold, ...rest } = ctx.state('land').held ?? {};
  ctx.patchState('land', { held: rest });
  sayHeld(ctx, h.from);
}

/**
 * each day: a removal that could not get to the goods tries again (so often, then the enforcement is limited to
 * possession: the goods left where they are, § 885a ZPO); a way back stopped tries again (so often, then refunded);
 * goods held or left past their month sold
 */
function tendHeld(ctx: WriteCtx): void {
  const g = ctx.hasData('leaseEnd') ? ctx.data('leaseEnd')?.goods : undefined;
  if (!g) return;
  for (const [id, h] of Object.entries(ctx.state('land').held ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (h.stage === 'held' && h.until !== undefined && ctx.now >= h.until) sellHeld(ctx, id, h);
    else if (h.stage === 'left') tendLeft(ctx, id, h);
    else if (h.stage === 'back' && h.move === undefined) {
      // (its lorry stopped on the way: again, a bounded number of times, then the trip refunded)
      if ((h.tries ?? 0) >= g.tries.value || !h.to) {
        backFailed(ctx, id, h, `its lorry did not get through on ${h.tries ?? 0} tries`);
        continue;
      }
      const r = bringBack(ctx, id, h, h.to);
      const tries = (h.tries ?? 0) + 1;
      ctx.patchState('land', { held: { ...(ctx.state('land').held ?? {}), [id]: { ...h, tries, ...('move' in r ? { move: r.move } : {}) } } });
      if ('why' in r) ctx.log('warn', `The removal firm cannot bring the goods back to ${ctx.port('holdings').label(h.to) ?? h.to} (${r.why}); it tries again (${tries} of ${Math.round(g.tries.value)}).`, [h.from]);
    } else if (h.stage === 'removal' && (h.move === undefined || !ctx.get('Move', h.move))) {
      const all = { ...(ctx.state('land').held ?? {}) };
      if ((h.tries ?? 0) >= g.tries.value) {
        const left = leftAt(ctx, h.from);
        if (!Object.keys(left).length) delete all[id];
        else {
          // (the enforcement limited to possession: the lessor has it back, the goods left there for the former tenant, § 885a ZPO; review y)
          const { move: _m, tries: _t, ...rest } = h;
          all[id] = { ...rest, stage: 'left', goods: left, until: ctx.now + g.keep.value * DAY };
          ctx.log('warn', `The removal firm could not get to the goods in ${ctx.port('holdings').label(h.from) ?? h.from}: the bailiff hands it back to ${partyLabel(ctx, h.by)} with the goods left where they are (${g.left}). They are still ${partyLabel(ctx, h.party)}'s, to be taken away by ${ctx.calendar.format(all[id]!.until!, 'day')}; not taken, ${partyLabel(ctx, h.by)} sells them for it.`, [h.from]);
        }
      } else all[id] = removeGoods(ctx, id, h);
      ctx.patchState('land', { held: all });
      sayHeld(ctx, h.from);
    }
  }
}

/** the former tenant's goods in a thing let (what a clearance would take) */
function leftAt(read: ReadCtx, store: EntityId): Record<string, number> {
  return Object.fromEntries(Object.entries(read.port('holdings').contents(store)).filter(([, q]) => q > 1e-6).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Goods left where they were after a clearance limited to possession (§ 885a ZPO): what the former tenant has taken
 * away meanwhile is off the record (all of it: it ends); past the month, the lessor sells what is left where it stands
 * (it passes into a store of the lessor's at that place, 0027: a change of hands where the goods are) and pays out what
 * it fetches less the sale's costs
 */
function tendLeft(ctx: WriteCtx, id: string, h: Held): void {
  const g = ctx.data('leaseEnd')!.goods;
  const there = leftAt(ctx, h.from);
  const goods: Record<string, number> = {};
  for (const [m, q] of Object.entries(h.goods)) if (there[m]) goods[m] = Math.min(q, there[m]!);
  const from = ctx.port('holdings').label(h.from) ?? h.from;
  const all = { ...(ctx.state('land').held ?? {}) };
  if (!Object.keys(goods).length) {
    delete all[id];
    ctx.patchState('land', { held: all });
    ctx.log('info', `The goods left on ${from} after its clearance have been taken away by ${partyLabel(ctx, h.party)}.`, [h.from]);
    return sayHeld(ctx, h.from);
  }
  if (h.until === undefined || ctx.now < h.until || !ctx.get('Party', h.by)) {
    all[id] = { ...h, goods };
    ctx.patchState('land', { held: all });
    return;
  }
  const pos = ctx.port('holdings').where(h.from)!;
  const into = ctx.command('inventory.createStore', { holder: h.by, label: `Goods sold off ${from} (${partyLabel(ctx, h.by)})`, kind: 'depot', pos: [pos[0], pos[1]] });
  if (!into.ok) return;
  const hold = ctx.port('holdings');
  const sold: Record<string, number> = {};
  for (const [m, q] of Object.entries(goods)) {
    // (what of them is not claimed by a sale of the tenant's own: theirs to finish)
    const qty = Math.min(q, hold.free(h.from, m));
    if (qty > 1e-6 && ctx.command('inventory.transfer', { from: h.from, to: into.value as EntityId, material: m, qty, why: `sold where they stood (${g.left})` }).ok) sold[m] = qty;
  }
  const { gross, net, unsold } = proceeds(ctx, sold);
  if (net > 0 && ctx.port('prices').hasBooks(h.party)) receive(ctx, h.party, ACCOUNTS.sales, net, `The sale by ${partyLabel(ctx, h.by)} of the goods left on ${from} (${g.left}): ${Math.round(gross)} € less the sale's costs`, [h.from]);
  delete all[id];
  ctx.patchState('land', { held: all });
  ctx.log('warn', `Not taken away within the month, the goods left on ${from} were sold by ${partyLabel(ctx, h.by)} where they stood (${g.left}): ${goodsSaid(ctx, sold)}; ${net > 0 ? `${Math.round(net)} € paid to ${partyLabel(ctx, h.party)}, the sale's costs taken` : 'nothing paid out'}${unsold.length ? `; what nobody buys is ${partyLabel(ctx, h.by)}'s to dispose of (${unsold.map((m) => hold.material(m).label).join(', ')})` : ''}.`, [h.from]);
  sayHeld(ctx, h.from);
}

/** what is said on the thing let of the goods held from it (none left: nothing), when no matter of the law speaks on it now */
function sayHeld(ctx: WriteCtx, from: EntityId): void {
  if (Object.values(ctx.state('land').encounters).some((e) => e.subject === from)) return;
  const list = Object.entries(ctx.state('land').held ?? {}).filter(([, h]) => h.from === from && (h.stage === 'held' || h.stage === 'left')).map(([id, h]) => heldBlocker(ctx, id, h));
  if (list.length) ctx.blockers.set(from, list);
  else ctx.blockers.clear(from);
}

/** a removal or a way back of goods held after a clearance, by its move */
const heldOn = (read: ReadCtx, move: EntityId): [string, Held] | undefined => Object.entries(read.state('land').held ?? {}).find(([, h]) => h.move === move);

/** take the next step of the law on a use: what it says, what it costs, when the next comes */
function takeStep(ctx: WriteCtx, e: Encounter, w: Watcher, use: UseView, on: UseView[] = [use]): Encounter {
  const i = e.step + 1;
  const st = w.steps[i];
  if (!st) return e;
  const who = partyLabel(ctx, w.by);
  const party = partyLabel(ctx, use.party);
  const deadline = st.days ? ctx.now + st.days.value * DAY : undefined;
  const until = deadline !== undefined ? ` by ${ctx.calendar.format(deadline, 'day')}` : '';
  const cost = ((st.cost?.value ?? 0) + (st.costPerM3?.value ?? 0) * (use.built?.volume ?? 0)) * ctx.port('prices').index(ctx.now);
  // (a claim against them: an enforcement fine is coercive; a clearance's costs public by an authority, private by a holder)
  const holder = w.law === 'trespass' || w.law === 'lease';
  if (cost > 0) charge(ctx, { debtor: use.party, creditor: w.by, kind: st.act === 'fine' ? 'coercive' : holder ? 'private' : 'public', label: `${st.label}: ${use.label}`, basis: holder ? `${who}: ${st.label}` : st.label, amount: cost, refs: [use.subject] });
  const next: Encounter = { subject: e.subject, law: e.law, by: e.by, party: e.party, stage: st.act, step: i, ...(e.parcel ? { parcel: e.parcel } : {}), ...(deadline !== undefined ? { deadline } : {}), ...(e.claimed !== undefined ? { claimed: e.claimed } : {}), ...(e.kept ? { kept: e.kept } : {}) };
  const claimed = claimWood(ctx, e);
  if (claimed !== undefined) next.claimed = claimed;
  if (st.act === 'notice') ctx.log('warn', `${who} has found ${use.label} ${w.why}: ${st.label}; ${party} is to end it${until}.`, [use.subject]);
  else if (st.act === 'order') ctx.log('warn', `${who}: ${st.label}. ${party} is to end ${use.label}${until}.`, [use.subject]);
  else if (st.act === 'fine') ctx.log('error', `${who}: ${st.label}${cost > 0 ? `, ${Math.round(cost)} € charged` : ''}. ${use.label} is still to end${until}.`, [use.subject]);
  else {
    ctx.log('error', `${who}: ${st.label}: ${party} must leave ${use.label}${cost > 0 ? `, ${Math.round(cost)} € charged` : ''}.`, [use.subject]);
    for (const u of on) {
      ctx.emit('land.vacate', { subject: u.subject, party: u.party, evicted: true });
      stopWork(ctx, u.subject);
      // (a thing let, cleared: the bailiff has what is in it taken away to storage, at their cost; it stays theirs, § 885 ZPO)
      if (w.law === 'lease' && Object.values(ctx.port('holdings').contents(u.subject)).some((q) => q > 1e-6)) {
        const id = `held:${u.subject}:${ctx.now}`;
        const h = removeGoods(ctx, id, { party: u.party, from: u.subject, by: w.by, stage: 'removal', goods: {}, cleared: ctx.now });
        ctx.patchState('land', { held: { ...(ctx.state('land').held ?? {}), [id]: h } });
      }
    }
  }
  return next;
}

/**
 * Each day, every use with each who watches it: once they notice (when: the holder's habit by the
 * detection contract; the authority's by its own, both hidden), they take the steps of their law in
 * turn, each when the time the last gave runs out. A household's homes in one zone are one matter.
 */
function step(ctx: WriteCtx): void {
  // what the building authority was asked: answered when its time has come
  answer(ctx);
  // goods held after a clearance: their removal tried again, or sold past their month
  tendHeld(ctx);
  // the wood felled with leave since yesterday: bought (before any matter claims what was taken)
  ctx.setState('land', { ...ctx.state('land'), wood: buyWood(ctx, ctx.state('land').wood) });
  const st = ctx.state('land');
  const law = ctx.hasData('buildingLaw') ? ctx.data('buildingLaw') : undefined;
  const all = uses(ctx);
  const subjects = new Set(all.map((u) => u.subject));
  // where households live for good in a zone without homes: since when, the days away not counted (gone longer than a stay, it starts again)
  const dwelt: LandState['dwelt'] = {};
  for (const [k, d] of Object.entries(st.dwelt)) if (law && ctx.now - d.last < law.tolerance.value * DAY) dwelt[k] = d;
  const seen = new Set<string>();
  for (const use of all) {
    const zone = use.dwelling ? zoneAt(ctx, use.pos) : undefined;
    if (!use.dwelling || !zone || zone.dwelling) continue;
    const k = dwellingKey(use.party, zone.id);
    const was = dwelt[k];
    // back after days away (the daily step saw them last before): those days were not lived here
    const away = was && !seen.has(k) ? Math.max(0, ctx.now - was.last - DAY) : 0;
    seen.add(k);
    dwelt[k] = { since: was ? was.since + away : use.dwelling.since, last: ctx.now };
  }
  // each matter with the uses it is about
  const matters = new Map<string, { w: Watcher; uses: UseView[] }>();
  for (const use of all) for (const w of watchers(ctx, use, dwelt)) matters.set(w.key, { w: matters.get(w.key)?.w ?? w, uses: [...(matters.get(w.key)?.uses ?? []), use] });
  // (and things let, kept after the let: the lessor's, from the day it ended)
  for (const { use, w } of keptLets(ctx, all)) {
    matters.set(w.key, { w, uses: [use] });
    subjects.add(use.subject);
  }
  const encounters: Record<string, Encounter> = {};
  const noticed: Record<string, number> = {};
  const said = new Map<EntityId, Blocker[]>();
  for (const [key, { w, uses: on }] of [...matters].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const use = on[0]!;
    let e: Encounter = st.encounters[key] ?? { subject: use.subject, law: w.law, by: w.by, party: use.party, stage: 'unseen', step: -1, ...(w.parcel ? { parcel: w.parcel } : {}), ...(w.kept ? { kept: w.kept } : {}) };
    // back after the use was ended by force: the authority knows them, and orders again at once
    if (e.stage === 'clearance' && !Object.values(ctx.state('land').held ?? {}).some((h) => h.from === e.subject && h.stage === 'removal')) {
      const order = w.steps.findIndex((x) => x.act === 'order');
      if (order > 0) e = { ...e, stage: w.steps[order - 1]!.act, step: order - 1, deadline: ctx.now };
    }
    // the matter is about where they live now (a household that moved within the zone)
    if (!on.some((u) => u.subject === e.subject)) e = { ...e, subject: use.subject };
    // leave asked for and given, from a day yet to come: the holder takes no further step meanwhile
    const asked = w.law === 'trespass' && w.parcel ? ctx.port('agreements').applied(use.party, w.parcel, use.kind) : w.law === 'lease' ? ctx.port('agreements').applied(use.party, use.subject) : undefined;
    if (e.stage === 'unseen') {
      // when they will notice: drawn once, kept from the players
      const at = st.noticedAt[key] ?? noticeAt(ctx, w, use);
      if (ctx.now >= at && !asked) e = takeStep(ctx, e, w, use, on);
      else noticed[key] = at;
    } else if (e.stage !== 'clearance' && !asked && e.deadline !== undefined && ctx.now >= e.deadline) e = takeStep(ctx, e, w, use, on);
    encounters[key] = e;
    for (const u of on) {
      const b = stepBlocker(ctx, e, w, u);
      if (b) said.set(u.subject, [...(said.get(u.subject) ?? []), b]);
    }
  }
  // a household gone from the zone for less than a stay: its matter waits for it (struck for a night, the order stands)
  for (const [key, was] of Object.entries(st.encounters)) {
    if (matters.has(key) || was.law !== 'zoning' || was.stage === 'unseen') continue;
    if (dwelt[key.slice('zoning:'.length)]) encounters[key] = was;
  }
  // a matter about wood taken that ends (the felling stopped or done before their next step): the last of it claimed
  for (const [key, was] of Object.entries(st.encounters)) if (!encounters[key] && was.stage !== 'unseen') claimWood(ctx, was);
  // a thing kept after its let, given back (emptied, cleared, or let again): the days it was kept claimed (§ 546a BGB)
  for (const [key, was] of Object.entries(st.encounters)) if (!encounters[key] && was.law === 'lease' && was.stage !== 'unseen') claimKept(ctx, was);
  // a use gone (the camp struck), or a matter ended with nothing else the law has against its use: what was to compel is
  // done, its coercive fines let go (a use back within the stay is a matter again, and compelled anew)
  for (const [key, was] of Object.entries(st.encounters)) {
    if (was.stage === 'unseen') continue;
    if (!subjects.has(was.subject) || (!encounters[key] && !Object.values(encounters).some((e) => e.subject === was.subject))) relent(ctx, was.subject);
  }
  // a matter that has ended while its use stands (permission given, gone from the zone's concern): said, and forgotten
  for (const [key, was] of Object.entries(st.encounters)) {
    if (matters.has(key) || encounters[key] || was.stage === 'unseen' || was.stage === 'clearance' || !subjects.has(was.subject)) continue;
    const use = all.find((u) => u.subject === was.subject)!;
    ctx.log('info', `${partyLabel(ctx, use.party)} may stay: ${use.label} is no longer a matter for ${partyLabel(ctx, was.by)}.`, [use.subject]);
  }
  // what the law says on each use (this module's word on it: others say theirs beside it)
  const held = Object.entries(ctx.state('land').held ?? {}).filter(([, h]) => h.stage === 'held' || h.stage === 'left');
  for (const subject of new Set([...subjects, ...Object.values(st.encounters).map((e) => e.subject), ...held.map(([, h]) => h.from)])) {
    const mine = [...(subjects.has(subject) ? (said.get(subject) ?? []) : []), ...held.filter(([, h]) => h.from === subject).map(([id, h]) => heldBlocker(ctx, id, h))];
    if (mine.length) ctx.blockers.set(subject, mine);
    else ctx.blockers.clear(subject);
  }
  // (what was told of a matter is kept while it is unseen)
  const told = Object.fromEntries(Object.entries(ctx.state('land').told ?? {}).filter(([k]) => noticed[k] !== undefined));
  ctx.setState('land', { ...ctx.state('land'), encounters, noticedAt: noticed, dwelt, wood: ctx.state('land').wood, told });
}

/** when a watcher will notice a use: the holder by the detection contract (their habit), the authority by its own */
function noticeAt(ctx: WriteCtx, w: Watcher, use: UseView): number {
  const law = ctx.hasData('buildingLaw') ? ctx.data('buildingLaw') : undefined;
  if ((w.law === 'zoning' || w.law === 'building') && law) return Math.round(ctx.now - law.notice.value * DAY * Math.log(1 - ctx.rng('zoning').next()));
  // (a lessor knows the day its let ends: it comes for it then)
  if (w.law === 'lease' && w.kept) return w.kept.since;
  return Math.round(ctx.port('detection').noticedAt(use, ctx.now, ctx.rng('detection').next()).at);
}

export const landModule = defineModule({
  id: 'land',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Agreement', 'Move', 'Party', 'Project', 'Structure', 'WorkPackage'],
  label: 'Land',
  description: 'Parcels with a holder and a basis, and zones; holders notice what others do on their land, the building authority a home where the zoning allows none, and each reacts by the law of the place.',
  provides: ['land'],
  requires: ['parties', 'agreements', 'detection', 'routing', 'prices'],
  components: { Parcel: s.object({ label: s.string(), holder: s.ref('party'), basis: s.enum(BASES), polygon: s.array(s.point()).optional(), watched: s.boolean() }) },
  data: { parcels: s.record(ParcelDataSchema).optional(), detectionSettings: DetectionSettingsSchema, trespass: TrespassSchema, leaseEnd: LeaseEndSchema.optional(), zoning: ZoningSchema.optional(), buildingLaw: BuildingLawSchema.optional() },
  state: { initial: (): LandState => ({ encounters: {}, noticedAt: {}, dwelt: {}, wood: {} }) },
  events: { 'land.vacate': s.object({ subject: s.string(), party: s.string(), evicted: s.boolean() }) },
  blockers: {
    'land.notice': '{who} has found {use} {why} and wants it ended by {date} ({rule})',
    'land.order': '{who}: {rule}; {use} is to end by {date}, then: {next}',
    'land.fined': '{who}: {rule}; {use} is still to end by {date}, then: {next}',
    'land.notYours': '{use} is not held by {party}',
    'land.unknownUse': 'Nothing of ours at {subject} is a use of the land: nobody of ours lives there, and nothing of ours stands or is felled there',
    'land.nothingToAsk': 'the building authority has nothing to decide about {use} here',
    'land.goodsHeld': '{goods} taken from {from} by the clearance are held for {party} in storage ({rule}): handed back on demand once the clearance’s costs are paid; not fetched by {until}, sold for {party}, what they fetch less the costs paid out',
    'land.notHeld': 'No goods of ours are held in storage as {held}',
    'land.costsUnpaid': 'The goods taken from {from} are handed back only once the clearance’s costs are paid ({owed} € owed)',
    'land.notAStore': '{store} is not a store of {party} on the map to bring the goods back to',
    'land.noWayIn': 'The removal firm cannot bring the goods to {store}: {why}',
    'land.goodsLeft': '{goods} were left on {from} by its clearance ({rule}): still {party}’s, to be taken away by {until}; not taken, {by} sells them for {party}, what they fetch less the costs paid out',
  },
  setup(ctx) {
    for (const [id, p] of Object.entries(ctx.hasData('parcels') ? (ctx.data('parcels') ?? {}) : {})) {
      if (!ctx.get('Party', p.holder)) throw new Error(`parcels.${id}: no party '${p.holder}' holds land here`);
      const e = ctx.spawn('parcel', { name: p.label, id: `parcel-${id}` });
      ctx.set('Parcel', e, { label: p.label, holder: p.holder, basis: p.basis, watched: true, ...(p.polygon ? { polygon: p.polygon.map((x) => [x[0], x[1]] as Vec2) } : {}) });
    }
  },
  commands: {
    'land.claim': command(
      s.object({ label: s.string(), holder: s.ref('party'), basis: s.enum(BASES), polygon: s.array(s.point()).optional(), watched: s.boolean().optional() }),
      (ctx, p) => {
        ctx.port('parties').require(p.holder, 'land.claim');
        const id = ctx.spawn('parcel', { name: p.label });
        ctx.set('Parcel', id, { label: p.label, holder: p.holder, basis: p.basis, watched: p.watched ?? false, ...(p.polygon ? { polygon: p.polygon.map((x) => [x[0], x[1]] as Vec2) } : {}) });
        return id;
      },
      { label: 'A party holds land (a starter, a purchase)', internal: true },
    ),
    // what others notice of a use (a camp that smells, has no toilet, leaves its waste about) and tell: those who
    // watch it come to know of it sooner (decision 0025: they react as before; only when is nearer)
    'land.complaint': command(
      s.object({ subject: s.ref(), party: s.ref('party'), what: s.string() }),
      (ctx: WriteCtx, p) => {
        const factor = ctx.data('detectionSettings').complaint?.value;
        if (factor === undefined) return;
        const st = ctx.state('land');
        const told = { ...(st.told ?? {}) };
        const noticedAt = { ...st.noticedAt };
        let nearer = false;
        // the matters about this use, or about this party living for good in the zone it is in (not its other camps)
        const pos = ctx.port('holdings').where(p.subject);
        const zone = pos ? zoneAt(ctx, [pos[0], pos[1]]) : undefined;
        for (const [key, at] of Object.entries(st.noticedAt)) {
          const about = key === `trespass:${p.subject}` || (zone !== undefined && key === `zoning:${dwellingKey(p.party, zone.id)}`);
          if (!about || (told[key] ?? []).includes(p.what) || at <= ctx.now) continue;
          noticedAt[key] = Math.round(ctx.now + (at - ctx.now) * factor);
          told[key] = [...(told[key] ?? []), p.what];
          nearer = true;
        }
        if (nearer) ctx.setState('land', { ...st, noticedAt, told });
      },
      { label: 'What others notice of a use', internal: true },
    ),
    'land.apply': command(
      // (what the authority decides about: a camp, where people live from a store, or a structure)
      s.object({ subject: s.ref(['store', 'structure']), kind: s.enum(['enquiry', 'permit']) }),
      (ctx, p) => {
        // asking the building authority about a use of ours: an enquiry, or an application for the permit after the
        // fact; its fee (and a drafter's for an application), charged as claims; answered after the authority's time
        const theirs = uses(ctx).find((u) => u.subject === p.subject);
        if (theirs && theirs.party !== actorOf(ctx)) ctx.reject('land.notYours', { use: theirs.label, party: partyLabel(ctx, actorOf(ctx)) });
        const ours = askable(ctx, actorOf(ctx));
        const use = ours.find((u) => u.subject === p.subject);
        // (what could be asked about instead)
        if (!use) ctx.reject('land.unknownUse', { subject: ctx.port('holdings').label(p.subject) ?? ctx.get('Structure', p.subject)?.label ?? p.subject }, ours.filter((u) => u.dwelling || u.built).flatMap((u) => askWays(ctx, u)));
        const law = ctx.hasData('buildingLaw') ? ctx.data('buildingLaw')?.applications : undefined;
        const zoning = ctx.hasData('zoning') ? ctx.data('zoning') : undefined;
        const zone = zoneAt(ctx, use!.pos);
        if (!law || !zoning || !zone) ctx.reject('land.nothingToAsk', { use: use!.label });
        const about = use!.built && !use!.dwelling ? 'building' : 'dwelling';
        const app = law![p.kind];
        const st = ctx.state('land');
        const id = `application-${Object.keys(st.applications ?? {}).length + 1}`;
        const decideAt = ctx.now + app.days.value * DAY;
        ctx.setState('land', { ...st, applications: { ...(st.applications ?? {}), [id]: { party: use!.party, subject: use!.subject, label: use!.label, kind: p.kind, about, zone: zone!.id, at: ctx.now, decideAt } } });
        const index = ctx.port('prices').index(ctx.now);
        // (the claim is the fee, named so: paid or seized, it ends, while the application runs on: Qwen S505/S510)
        charge(ctx, { debtor: use!.party, creditor: zoning!.authority, kind: 'public', label: `The fee for ${app.label}: ${use!.label}`, basis: app.label, amount: app.fee.value * index, refs: [use!.subject] });
        if (app.designer && app.designer.value > 0) charge(ctx, { debtor: use!.party, creditor: 'entwurfsverfasser', creditorLabel: 'An architect (the plans for the application)', kind: 'private', label: `The plans for ${app.label}: ${use!.label}`, basis: 'the architect’s fee (HOAI)', amount: app.designer.value * index, refs: [use!.subject] });
        ctx.log('info', `${partyLabel(ctx, use!.party)} asks ${partyLabel(ctx, zoning!.authority)}: ${app.label} about ${use!.label}; the answer in about ${Math.round(app.days.value)} days (the matter goes on meanwhile).`, [use!.subject]);
        return id;
      },
      { label: 'Ask the building authority', description: 'Ask the building authority about a use of ours: a preliminary enquiry (cheaper; says whether it could be permitted) or an application for the permit after the fact (drawn up by an architect). Fees are charged even when refused; the answer comes after the authority\'s time, by the zone\'s law; the matter goes on meanwhile. Granted, the use is permitted and the matter ends.' },
    ),
    'land.fetchGoods': command(
      s.object({ held: s.string(), to: s.ref('store') }),
      (ctx: WriteCtx, p) => {
        const h = ctx.state('land').held?.[p.held];
        if (!h || h.stage !== 'held' || h.party !== actorOf(ctx)) ctx.reject('land.notHeld', { held: p.held });
        const g = ctx.data('leaseEnd')!.goods;
        const hold = ctx.port('holdings');
        const to = hold.where(p.to);
        const named = hold.label(p.to);
        const ways = (): Remedy[] => {
          const homes = homesFor(ctx, h!).slice(0, 3).map(([to, label]) => ({ label: `Have them brought back to ${label}`, command: { type: 'land.fetchGoods', payload: { held: p.held, to } } }));
          return homes.length ? homes : storeByTheWay(ctx, h!, true);
        };
        if (!to || !ownStores(ctx, h!).some(([id]) => id === p.to)) ctx.reject('land.notAStore', { store: named ?? p.to, party: partyLabel(ctx, h!.party) }, ways());
        // (only where its lorry gets to: one function with the remedies offered, review y)
        if (firmWayIn(ctx, to!) === null) ctx.reject('land.noWayIn', { store: named!, why: `no way for a ${ctx.port('routing').profile(g.vehicle).label} from the way in` }, ways());
        // (handed back against the costs paid, § 885 Abs. 4 ZPO)
        const owed = clearanceOwed(ctx, h!);
        if (owed.length) ctx.reject('land.costsUnpaid', { from: ctx.port('holdings').label(h!.from) ?? h!.from, owed: Math.round(owed.reduce((a, c) => a + c.owed, 0)) }, owed.map((c) => ({ label: `Pay the clearance's costs (${Math.round(c.owed)} €)`, command: { type: 'agreements.act', payload: { agreement: c.agreement, action: 'pay', amount: Math.round(c.owed * 100) / 100 } } })));
        // the removal firm's lorry brings them in by the way in (and goes out empty); paid for the trip, refunded if it never comes
        const r = bringBack(ctx, p.held, h!, p.to);
        if ('why' in r) ctx.reject('land.noWayIn', { store: named!, why: r.why }, ways());
        const paid = Math.round(g.back.value * ctx.port('prices').index(ctx.now) * 100) / 100;
        pay(ctx, h!.party, ACCOUNTS.transport, paid, `The goods taken from ${ctx.port('holdings').label(h!.from) ?? h!.from} brought back from storage to ${named}`, [h!.from]);
        const move = (r as { move: EntityId }).move;
        ctx.patchState('land', { held: { ...(ctx.state('land').held ?? {}), [p.held]: { ...h!, stage: 'back', to: p.to, move, tries: 1, paid } } });
        sayHeld(ctx, h!.from);
        ctx.log('info', `The goods taken from ${ctx.port('holdings').label(h!.from) ?? h!.from} are brought back from storage to ${named}: ${goodsSaid(ctx, h!.goods)}, from ${ctx.calendar.format(ctx.require('Move', move).legs[0]!.arrive, 'day')}.`, [h!.from, p.to]);
      },
      { label: 'Have goods back from storage', description: 'Goods a clearance took away (§ 885 ZPO) are still ours, held in storage beyond the map for a month: once the clearance’s costs are paid, a removal firm brings them back to a store of ours its lorry gets to (at its price; a lorry stopped on the way comes again a few times, then the price is refunded). Not fetched in time, they are sold and what they fetch, less the costs, is paid to us.' },
    ),
    'land.leave': command(
      s.object({ subject: s.ref() }),
      (ctx, p) => {
        const use = uses(ctx).find((u) => u.subject === p.subject);
        if (!use) ctx.reject('land.unknownUse', { subject: p.subject });
        if (use!.party !== actorOf(ctx)) ctx.reject('land.notYours', { use: use!.label, party: partyLabel(ctx, actorOf(ctx)) });
        ctx.log('info', `${partyLabel(ctx, use!.party)} leaves: ${use!.label} is struck.`, [p.subject]);
        ctx.blockers.clear(p.subject);
        ctx.emit('land.vacate', { subject: p.subject, party: use!.party, evicted: false });
        stopWork(ctx, p.subject);
      },
      { label: 'Leave a place', description: 'Take what you have at a place away and go (a camp is struck, its people leave the site with what they carry; the stock stays in the store).' },
    ),
  },
  systems: [{ id: 'holders', every: DAY, offset: 10 * HOUR, phase: 'agents', run: (ctx) => step(ctx) }],
  on: {
    // the removal firm at the goods of a thing cleared: they go onto its lorry and out to storage, still their owner's
    'moves.legDone': (ctx, e) => {
      if (e.requester !== LAND || e.purpose !== 'clearance' || e.leg !== 0) return;
      const [id, h] = heldOn(ctx, e.move) ?? [];
      if (!id || !h || h.stage !== 'removal') return;
      const named = ctx.port('holdings').label(h.from);
      const goods: Record<string, number> = {};
      for (const [material, qty] of Object.entries(ctx.port('holdings').contents(h.from)).sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (!(qty > 1e-6)) continue;
        // (over the world's edge with the lorry: held for them beyond the map, in this record, until fetched or sold)
        ctx.command('inventory.toOutside', { from: h.from, material, qty, why: `taken away by the bailiff to storage, still ${partyLabel(ctx, h.party)}'s (${ctx.data('leaseEnd')!.goods.rule})` });
        goods[material] = qty;
      }
      const all = { ...(ctx.state('land').held ?? {}) };
      if (!Object.keys(goods).length) delete all[id];
      else all[id] = { ...h, stage: 'held', goods, until: h.cleared + ctx.data('leaseEnd')!.goods.keep.value * DAY };
      ctx.patchState('land', { held: all });
      if (all[id]) ctx.log('warn', `The bailiff's removal firm takes the goods in ${named ?? h.from} to storage: ${goodsSaid(ctx, goods)}. They are still ${partyLabel(ctx, h.party)}'s: handed back on demand once the clearance's costs are paid; not fetched by ${ctx.calendar.format(all[id]!.until!, 'day')}, sold for it (${ctx.data('leaseEnd')!.goods.rule}).`, [h.from]);
      sayHeld(ctx, h.from);
    },
    // goods held after a clearance brought back: in the store they were asked into
    'moves.arrived': (ctx, e) => {
      if (e.requester !== LAND || e.purpose !== 'goods back') return;
      const [id, h] = heldOn(ctx, e.move) ?? [];
      if (!id || !h || h.stage !== 'back') return;
      const { [id]: _back, ...rest } = ctx.state('land').held ?? {};
      ctx.patchState('land', { held: rest });
      const st = h.to ? ctx.port('holdings').label(h.to) : undefined;
      for (const [material, qty] of Object.entries(h.goods).sort(([a], [b]) => (a < b ? -1 : 1))) if (st !== undefined) ctx.command('inventory.fromOutside', { into: h.to!, material, qty, why: `back from storage after the clearance of ${ctx.port('holdings').label(h.from) ?? h.from}` });
      ctx.log(st !== undefined ? 'success' : 'warn', st !== undefined ? `The goods from storage are back in ${st}: ${goodsSaid(ctx, h.goods)}.` : `The goods from storage came back, but the store they were to go into is gone: the removal firm takes them back to storage.`, [h.from]);
      if (st === undefined) {
        const { move: _m, to: _t, tries: _n, paid: _p, ...was } = h;
        ctx.patchState('land', { held: { ...rest, [id]: { ...was, stage: 'held' } } });
      }
      sayHeld(ctx, h.from);
    },
    // the removal stopped on its way: in to the goods, tried again (tendHeld); with them back, they stay in storage
    'moves.stopped': (ctx, e) => {
      if (e.requester !== LAND) return;
      const [id, h] = heldOn(ctx, e.move) ?? [];
      if (!id || !h) return;
      const { move: _m, ...rest } = h;
      if (h.stage === 'removal') ctx.patchState('land', { held: { ...(ctx.state('land').held ?? {}), [id]: rest } });
      else if (h.stage === 'back') {
        // (it comes again the next day, a bounded number of times; its tries used, the trip is refunded: review y)
        const g = ctx.data('leaseEnd')!.goods;
        if ((h.tries ?? 0) >= g.tries.value) return backFailed(ctx, id, rest, `${e.why}, ${h.tries ?? 0} tries`);
        ctx.patchState('land', { held: { ...(ctx.state('land').held ?? {}), [id]: rest } });
        ctx.log('warn', `The removal firm bringing the goods back from storage could not get through (${e.why}): they are in storage still; it comes again (${h.tries ?? 0} of ${Math.round(g.tries.value)} tries so far).`, [h.from]);
      }
    },
  },
  /** a fork does not know when a holder will notice */
  branch(ctx) {
    // a fork draws when they notice again; what was told is told again while it lasts (and counts against the new draw)
    ctx.patchState('land', { noticedAt: {}, told: {} });
  },
  ports: { land: landPort },
  contributes: {
    holders: () => (read: ReadCtx, subject: EntityId) => read.get('Parcel', subject)?.holder ?? null,
    // felling trees is a use of the land they stand on while the work goes on (taking another's wood is not refused: its holder answers)
    landUse: () => (read: ReadCtx) => fellingUses(read),
    // a tree on another's land is theirs to fell, unless they gave leave
    notOursToFell: () => (read: ReadCtx, party: EntityId, pos: Vec2) => {
      const p = parcelAt(read, pos);
      if (!p || permitted(read, party, p, 'felling')) return null;
      const use: UseView = { subject: p, party, label: 'felling', pos, area: 0, people: 0, kind: 'felling', visibility: 0 };
      return { holder: partyLabel(read, read.require('Parcel', p).holder), ask: wayOut(read, use, p).filter((r) => r.command?.type === 'agreements.open') };
    },
  },
  projections: {
    'land.applications': {
      label: 'What we asked the building authority, and its answers',
      description: 'args: party (whose; a client sees its own)',
      compute: (read: ReadCtx, args?: { party?: EntityId }) => Object.entries(read.state('land').applications ?? {}).filter(([, a]) => !args?.party || a.party === args.party).map(([id, a]) => ({ id, about: a.label, kind: a.kind, asked: read.calendar.format(a.at, 'day'), ...(a.answer ? { answer: a.answer, why: a.why } : { expected: read.calendar.format(a.decideAt, 'day') }) })),
    },
    'land.parcels': {
      label: 'The parcels of the map: who holds them, on what basis; and the places on them let to another (a yard), whose they are and to whom let',
      compute: (read: ReadCtx) => [
        ...[...read.all('Parcel')].map(([id, p]) => ({ id, label: p.label, holder: partyLabel(read, p.holder), basis: p.basis, ...(p.polygon ? { polygon: p.polygon } : { rest: true }) })),
        // (a yard a firm rents is its landlord's, within the parcel it lies on: Qwen S503 read the whole map as the firm's own)
        ...read.port('agreements').lets().filter((l) => l.live && read.port('holdings').exists(l.subject)).map((l) => {
          const at = read.port('holdings').where(l.subject)!;
          return { id: l.subject, label: read.port('holdings').label(l.subject)!, holder: partyLabel(read, l.lessor), basis: 'own', letTo: partyLabel(read, l.lessee), by: 'lease', within: parcelAt(read, [at[0], at[1]]) };
        }),
      ],
    },
    'land.encounters': {
      label: 'What holders of land and the authorities have noticed of ours, and what they demand',
      compute: (read: ReadCtx) => Object.values(read.state('land').encounters).filter((e) => e.stage !== 'unseen').map((e) => ({ subject: e.subject, law: e.law, by: partyLabel(read, e.by), stage: e.stage, ...(e.deadline !== undefined ? { until: e.deadline } : {}) })),
    },
  },
});

// ------------------------------------------------------------------ detection: two models (decision 0015)

export const VISITS_MODEL: ModelDescriptor = {
  contract: 'detection',
  implementation: 'visits',
  kind: 'model',
  label: 'A holder visits the land at random (a mean interval) and notices a use on a visit with a chance that grows with its visibility',
  validity: { notes: 'One holder habit for all parcels; no neighbours who tell, no seasons.' },
  resolution: 'per use',
  confidence: 'low',
  sources: [{ title: 'practice pack: detectionSettings' }],
};

export const ROUNDS_MODEL: ModelDescriptor = {
  contract: 'detection',
  implementation: 'rounds',
  kind: 'model',
  label: 'A holder walks the land in regular rounds and notices a use on a round with a chance that grows with its visibility',
  validity: { notes: 'Fixed rounds from the day a use appears; no neighbours who tell.' },
  resolution: 'per use',
  confidence: 'low',
  sources: [{ title: 'practice pack: detectionSettings' }],
};

const chance = (base: number, use: UseView) => Math.min(0.98, Math.max(0.005, base * use.visibility));

export const visitsModule = defineModule({
  id: 'detection-visits',
  label: 'Detection (random visits)',
  provides: ['detection'],
  models: [VISITS_MODEL],
  ports: {
    detection: (read: ReadCtx): DetectionPort => ({
      noticedAt: (use, from, u) => {
        const v = read.data('detectionSettings').visits;
        // visits come at random, each notices with chance p: the wait is exponential with mean meanDays / p
        const days = (-Math.log(Math.max(1e-12, 1 - u)) * v.meanDays.value) / chance(v.notice.value, use);
        return { at: from + days * DAY, provenance: { kind: 'model', source: 'visits', confidence: 'low' } };
      },
    }),
  },
});

export const roundsModule = defineModule({
  id: 'detection-rounds',
  label: 'Detection (regular rounds)',
  provides: ['detection'],
  models: [ROUNDS_MODEL],
  ports: {
    detection: (read: ReadCtx): DetectionPort => ({
      noticedAt: (use, from, u) => {
        const r = read.data('detectionSettings').rounds;
        const p = chance(r.notice.value, use);
        // the round on which it is first noticed: geometric
        const k = Math.max(1, Math.ceil(Math.log(Math.max(1e-12, 1 - u)) / Math.log(1 - p)));
        return { at: from + k * r.everyDays.value * DAY, provenance: { kind: 'model', source: 'rounds', confidence: 'low' } };
      },
    }),
  },
});

