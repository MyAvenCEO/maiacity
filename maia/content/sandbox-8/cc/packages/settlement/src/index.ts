/**
 * The settlement game.
 *
 * Composition only: which models run, which data calibrates them, and how a new game starts.
 * Every rule of the world lives in the model packages; this package decides the scenario:
 *   - a public road (Kreisstraße) entering the map from the edge connection
 *   - a contractor's yard (Bauhof) at its end with a small permanent crew and owned fleet
 *   - starting crew, fleet, stock, capital and credit line from the starter pack
 * Everything else — roads, purchases, hiring — is up to the player.
 */
import { convert, DAY, defineModule, HOUR, Runtime, s, type CalendarDate, type Infer, type Param, type EntityId, type ModuleDef, type ReadCtx, type RuntimeConfig } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import { terrainModule, vegetationModule } from '../../terrain/src/index.ts';
import { enteredWeatherModule, externalWeatherModule, measuredWeatherModule, weatherModule } from '../../weather/src/index.ts';
import { resolveWorld, type Binding, type Connection, type ResolvedWorld, type WorldDefinition, type WorldRegistry } from '../../world/src/index.ts';
import { soilModule } from '../../soil/src/index.ts';
import { accessesModule, accessOf, movesModule, networkModule, trafficModule } from '../../network/src/index.ts';
import { workforceModule } from '../../workforce/src/index.ts';
import { equipmentModule, usedPlantComparablesModule, usedPlantCurveModule } from '../../equipment/src/index.ts';
import { inventoryModule } from '../../inventory/src/index.ts';
import { ACCOUNTS, acct, BooksSchema, cycleModelModule, cycleRecordedModule, economyModule } from '../../economy/src/index.ts';
import { PARTY_KINDS, partiesModule } from '../../parties/src/index.ts';
import { livingModule, physiologyModule, sphereModule } from '../../needs/src/index.ts';
import { authoritiesModule, BASES, landModule, roundsModule, visitsModule } from '../../land/src/index.ts';
import { mechanicsModule, rulesModule, structuresModule } from '../../structures/src/index.ts';
import { agreementsModule, depositsModule, leasesModule, lettingModule, loansModule, rentLevelModule, rentTableModule } from '../../agreements/src/index.ts';
import { errandsModule, productionModule } from '../../production/src/index.ts';
import { roadsModule } from '../../roads/src/index.ts';
import { buildingsModule } from '../../buildings/src/index.ts';
import { spaceModule } from '../../space/src/index.ts';
import { environmentModule, recordedEnvironmentModule } from '../../environment/src/index.ts';
import { doseDurabilityModule, isoDurabilityModule } from '../../materials/src/index.ts';
import { rulebooksModule } from '../../rulebooks/src/index.ts';
import { sitingModule } from '../../siting/src/index.ts';
import { datasets as economyDatasets, economyDe } from '../../economy-de/src/index.ts';
import { practiceDe } from '../../practice-de/src/index.ts';
import { datasets as regionDatasets, regionGoettingen, regionGoettingenHillside } from '../../region-goettingen/src/index.ts';
import { lawDe, lawDeNi, lawGoettingen, lawGoettingenPlanned } from '../../law-de/src/index.ts';
import { starterPacks } from '../../starter-packs/src/index.ts';
import { LOCALES } from '../../locales/src/index.ts';

export interface SettlementState {
  /** the party the starter brought */
  party: EntityId;
  depot: EntityId | null;
  depotPos: Vec2;
  publicRoad: EntityId[];
  externalNode: EntityId | null;
  scenario: string;
}

declare module '../../kernel/src/index.ts' {
  interface ModuleStateTypes {
    settlement: SettlementState;
  }
}

/** who is there at the start and what it brings (decisions 0011, 0025): a starter pack per party the world definition names */
export const StarterSchema = s.object({
  label: s.string(),
  /** who arrives: the party that holds all of it; its id is stable, so a host can seat a player as it. A party the world knows already (a farm of the economy pack) is given what the starter brings */
  party: s.object({ id: s.string(), label: s.string(), kind: s.enum(PARTY_KINDS) }),
  /** its books: the money it brings, its credit line and overhead */
  books: BooksSchema,
  /** where it settles, beside the end of the way in (`at`: metres along it and to its side; default 30 m to the side): a yard that is there already (`clear`), or a pack put down */
  base: s.object({ label: s.string(), kind: s.enum(['depot', 'stockpile', 'site']), clear: s.boolean().optional(), at: s.object({ along: s.number(), side: s.number() }).optional() }).optional(),
  /** land it holds (no outline: the rest of the map); `watched`: it looks after it by the custom of the place */
  land: s.array(s.object({ label: s.string(), basis: s.enum(BASES), polygon: s.array(s.point()).optional(), watched: s.boolean().optional() })).optional(),
  /** people by job; optionally with the practice they bring (hours per skill) instead of a draw from the labour market */
  crew: s.array(s.object({ job: s.string(), count: s.number({ min: 0 }), experience: s.record(s.number({ min: 0 })).optional() })).optional(),
  fleet: s.array(s.object({ model: s.string(), ownership: s.enum(['owned', 'rented']) })).optional(),
  /** the people of the party and its family and friends: working days a year their lives allow, days to get here (scenario values with their source), practice in hours per skill; `lives`: they live on site from the base's stores */
  circle: s
    .array(s.object({ name: s.string(), relation: s.string(), resident: s.boolean().optional(), lives: s.boolean().optional(), daysPerYear: s.param('d'), travelDays: s.param('d'), birthYear: s.int().optional(), aptitude: s.number().optional(), certificates: s.array(s.string()).optional(), experience: s.record(s.number({ min: 0 })).optional() }))
    .optional(),
  /** stock at the base at the start, in the material's unit */
  stock: s.array(s.object({ material: s.string(), qty: s.any<Param>() })).optional(),
  /** what it rents from others at the start (a product of the economy pack; 'yard': its base) */
  rents: s.array(s.object({ product: s.string(), subject: s.enum(['yard']) })).optional(),
});
export type Starter = Infer<typeof StarterSchema>;

declare module '../../kernel/src/index.ts' {
  interface DataTypes {
    /** starter id → what it brings, in the order the world definition names them (the first is the seat) */
    starters: Record<string, Starter>;
  }
}

/** the party a single-seat host plays: the one the starter brought */
export const seatParty = (read: ReadCtx): EntityId => read.state('settlement').party;

export const settlementModule: ModuleDef = defineModule({
  id: 'settlement',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Parcel', 'Party'],
  label: 'Settlement scenario',
  requires: ['terrain', 'vegetation', 'routing', 'workforce', 'equipment', 'holdings', 'trade', 'prices', 'production', 'roads', 'agreements', 'land'],
  data: { starters: s.record(StarterSchema) },
  state: {
    initial: (): SettlementState => ({ party: '', depot: null, depotPos: [0, 0], publicRoad: [], externalNode: null, scenario: 'default' }),
  },
  setup(ctx) {
    // everyone settles by the way in: a road if there is one, else a track or a footpath
    const conn = accessOf(ctx, 'road', 'track', 'footpath');
    if (!conn) throw new Error('scenario: the world needs a way into the map (accesses)');
    const side: Vec2 = [-conn.inward[1], conn.inward[0]];
    const veg = ctx.port('vegetation');
    // the way in is of course free of trees (a footpath is narrow)
    const half = conn.width / 2 + 3;
    const corridor: Vec2[] = [...conn.points.map((p): Vec2 => [p[0] + side[0] * half, p[1] + side[1] * half]), ...[...conn.points].reverse().map((p): Vec2 => [p[0] - side[0] * half, p[1] - side[1] * half])];
    const clearing = new Set(veg.treesIn(corridor).map((tr) => tr.id));
    const fail = (what: string, r: { ok: false; reasons: Parameters<typeof ctx.formatBlocker>[0][] }): never => {
      throw new Error(`scenario: ${what}: ${r.reasons.map((x) => ctx.formatBlocker(x)).join('; ')}`);
    };
    let seat: { party: EntityId; base: EntityId | null; pos: Vec2 } | null = null;
    // the starters in the order the world lists them: the first is the seat
    for (const [key, starter] of Object.entries(ctx.data('starters'))) {
      // the party that arrives (or one the world already knows, like a farm of the economy pack), with its books
      let party = starter.party.id;
      if (!ctx.get('Party', party)) {
        const pr = ctx.command('parties.add', { id: starter.party.id, label: starter.party.label, kind: starter.party.kind });
        if (!pr.ok) fail(`party ${starter.party.id}`, pr);
        else party = pr.value;
      }
      if (!ctx.port('prices').hasBooks(party)) {
        const books = ctx.command('economy.openBooks', { party, books: starter.books });
        if (!books.ok) fail(`books of ${key}`, books);
      }
      for (const l of starter.land ?? []) {
        const land = ctx.command('land.claim', { label: l.label, holder: party, basis: l.basis, ...(l.polygon ? { polygon: l.polygon } : {}), ...(l.watched !== undefined ? { watched: l.watched } : {}) });
        if (!land.ok) fail(`land of ${key}`, land);
      }
      // where it settles: beside the end of the way in
      let base: EntityId | null = null;
      const at = starter.base?.at ?? { along: 0, side: 30 };
      const pos: Vec2 = [conn.end[0] + conn.inward[0] * at.along + side[0] * at.side, conn.end[1] + conn.inward[1] * at.along + side[1] * at.side];
      if (starter.base) {
        if (starter.base.clear) {
          // a yard that is there already: free of trees
          const yard: Vec2[] = [
            [pos[0] - side[0] * 25 - conn.inward[0] * 30, pos[1] - side[1] * 25 - conn.inward[1] * 30],
            [pos[0] + side[0] * 25 - conn.inward[0] * 30, pos[1] + side[1] * 25 - conn.inward[1] * 30],
            [pos[0] + side[0] * 25 + conn.inward[0] * 30, pos[1] + side[1] * 25 + conn.inward[1] * 30],
            [pos[0] - side[0] * 25 + conn.inward[0] * 30, pos[1] - side[1] * 25 + conn.inward[1] * 30],
          ];
          for (const tr of veg.treesIn(yard)) clearing.add(tr.id);
          // and its way in from the end of the road (S159: lorries set down 30 m short of a yard with none):
          // a firm's yard has a gravel entrance, a clearing an earth track (4 m wide, walking pace for lorries; estimates)
          if (Math.hypot(pos[0] - conn.end[0], pos[1] - conn.end[1]) > 1) {
            const drive = ctx.command('network.addPolyline', { points: [conn.end, pos], open: true, surface: starter.base.kind === 'depot' ? 'gravel' : 'earth', width: 4, speedLimit: 20, label: `${starter.base.label}: entrance` });
            if (!drive.ok) fail(`entrance of ${key}`, drive);
          }
        }
        const st = ctx.command('inventory.createStore', { holder: party, label: starter.base.label, kind: starter.base.kind, pos });
        if (!st.ok) fail(`base of ${key}`, st);
        else base = st.value;
      }
      for (const c of starter.crew ?? []) {
        for (let i = 0; i < c.count; i += 1) {
          const r = ctx.command('workforce.employ', { employer: party, job: c.job, ...(c.experience ? { experience: c.experience } : {}) });
          if (!r.ok) fail(`employ ${c.job}`, r);
        }
      }
      for (const { lives, ...h } of starter.circle ?? []) {
        const r = ctx.command('workforce.addHelper', { ...h, of: party, daysPerYear: h.daysPerYear.value, travelDays: h.travelDays.value });
        if (!r.ok) fail(`helper ${h.name}`, r);
        // living on site, from the base's stores
        else if (lives) {
          if (!base) throw new Error(`scenario: ${h.name} lives on site, but ${key} has no base`);
          const settled = ctx.command('living.settle', { person: r.value, party, store: base });
          if (!settled.ok) fail(`${h.name} settling`, settled);
        }
      }
      (starter.fleet ?? []).forEach((m, i) => {
        const at: Vec2 = [pos[0] + (i % 5) * 7 - 14, pos[1] + Math.floor(i / 5) * 9 - 4];
        const r = ctx.command('equipment.acquire', { model: m.model, ownership: m.ownership, pos: at, immediate: true, holder: party });
        if (!r.ok) fail(`acquire ${m.model}`, r);
      });
      for (const st of starter.stock ?? []) {
        const mat = ctx.data('materials')[st.material];
        if (!mat) throw new Error(`scenario: the starter pack stocks '${st.material}', which the economy does not know`);
        if (!base) throw new Error(`scenario: ${key} brings stock but has no base`);
        const r = ctx.command('inventory.stock', { store: base, material: st.material, qty: convert(st.qty.value, st.qty.unit, mat.unit) });
        if (!r.ok) fail(`stock ${st.material}`, r);
      }
      // what it rents: the agreements start today, rent is due from the first day
      for (const r of starter.rents ?? []) {
        if (!base) throw new Error(`scenario: ${key} rents a yard but has no base`);
        const opened = ctx.command('agreements.open', { product: r.product, subject: base, holder: party });
        if (!opened.ok) fail(`renting ${r.product}`, opened);
      }
      seat ??= { party, base, pos };
      const people = (starter.crew ?? []).reduce((a, c) => a + c.count, 0) + (starter.circle ?? []).filter((h) => h.lives || h.resident).length;
      ctx.log('info', `${starter.party.label} ${base ? `starts at ${starter.base!.label} by the ${conn.label}` : 'is here'}${people ? `: ${people} ${people === 1 ? 'person' : 'people'}` : ''}${starter.fleet?.length ? `, ${starter.fleet.length} ${starter.fleet.length === 1 ? 'tool or machine' : 'tools and machines'}` : ''}.`, base ? [base] : []);
    }
    if (!seat) throw new Error('scenario: no starter');
    // the land nobody claimed: the rest of the valley is the seat's (a world's parcels or a starter may say otherwise)
    if (![...ctx.all('Parcel')].some(([, p]) => !p.polygon)) {
      const land = ctx.command('land.claim', { label: 'The valley', holder: seat.party, basis: 'own' });
      if (!land.ok) fail('land claim', land);
    }
    if (clearing.size) ctx.command('vegetation.removeTrees', { ids: [...clearing], reason: 'the way in and the yard' });
    ctx.setState('settlement', { party: seat.party, depot: seat.base, depotPos: seat.pos, publicRoad: conn.edges, externalNode: conn.node, scenario: 'default' });
  },
  projections: {
    'settlement.hud': {
      label: 'HUD',
      description: 'args: party (whose money, staff and machines; default: the party the starter brought)',
      compute: (read: ReadCtx, args: Record<string, unknown> = {}) => {
        const party = typeof args.party === 'string' ? args.party : read.state('settlement').party;
        // the weather now is observable; the rest of today and the coming days only as forecast
        const w = read.port('weather').hour(read.now);
        const forecast = read.port('weather').forecast(read.now, 5);
        const day = forecast[0] ?? read.port('weather').soFar(read.now);
        const prices = read.port('prices');
        const wf = read.port('workforce');
        let blocked = 0;
        for (const [id, pkg] of read.all('WorkPackage')) if (pkg.status !== 'done' && read.blockersOf(id).some((b) => b.severity === 'block')) blocked += 1;
        return {
          time: read.now,
          date: read.calendar.format(read.now),
          // the clock is the region's standard time all year (no daylight saving)
          timeZone: `UTC${read.data('climate').station.utcOffset.value >= 0 ? '+' : ''}${read.data('climate').station.utcOffset.value}, standard time all year`,
          weather: {
            temp: w.airTemp,
            precip: w.precip,
            wind: w.wind,
            cloud: w.cloud,
            kind: day.kind,
            tMin: day.tMin,
            tMax: day.tMax,
            daylight: w.daylight,
            sunElevation: w.sunElevation,
            sunAzimuth: w.sunAzimuth,
          },
          forecast: forecast.map((f) => ({ day: f.day, date: read.calendar.format(f.day * DAY, 'day'), kind: f.kind, tMin: f.tMin, tMax: f.tMax, rainChance: f.precipProbability, precip: f.precip, wind: f.wind, frost: f.frost })),
          party,
          cash: read.balance(acct(party, ACCOUNTS.cash)),
          liquidity: prices.liquidity(party),
          onShift: wf.onShift(read.now, party),
          staff: wf.staff(party).length,
          machines: [...read.all('Machine')].filter(([, m]) => m.holder === party).length,
          activeProjects: [...read.all('Project')].filter(([, p]) => p.status === 'active').length,
          blockedPackages: blocked,
        };
      },
    },
    'settlement.alerts': {
      label: 'Alerts',
      description: 'args: party (whose alerts; a client sees its own)',
      compute: (read: ReadCtx, args: Record<string, unknown> = {}) => {
        const party = typeof args.party === 'string' ? args.party : undefined;
        const out: { subject: string; label: string; code: string; severity: string; message: string; since?: number; remedies?: unknown[] }[] = [];
        // everything in the world that is held up or in trouble: work, people (thirst, hunger, sleep),
        // goods set down short of their store, orders, machines … (info blockers are only notes)
        for (const id of read.blocked()) {
          // (another party's troubles are its own: a neighbour's thirst is not in our alerts)
          if (party && partyOfSubject(read, id) !== party) continue;
          const pkg = read.get('WorkPackage', id);
          if (pkg && (pkg.status === 'done' || pkg.status === 'cancelled')) continue;
          const label = pkg?.label ?? read.get('Person', id)?.name ?? read.port('holdings').label(id) ?? read.entity(id)?.name ?? id;
          for (const b of read.blockersOf(id)) {
            if (b.severity === 'info') continue;
            const item: (typeof out)[number] = { subject: id, label, code: b.code, severity: b.severity, message: read.formatBlocker(b) };
            if (b.since !== undefined) item.since = b.since;
            if (b.remedies) item.remedies = b.remedies;
            out.push(item);
          }
        }
        out.push(...[...surplusSoilAlerts(read, party), ...idleRentalAlerts(read)].filter((a) => !party || partyOfSubject(read, a.subject) === party));
        return out;
      },
    },
  },
});

/** a rented machine left without work this long is worth a look (it is paid every working day) */
const IDLE_RENTAL_HOURS = 24;

/** Rented machines on site that nothing has used for a day: the rent runs on until they are returned. */
function idleRentalAlerts(read: ReadCtx): { subject: string; label: string; code: string; severity: string; message: string; since: number; remedies: unknown[] }[] {
  const eq = read.port('equipment');
  const out: ReturnType<typeof idleRentalAlerts> = [];
  for (const [id, m] of read.all('Machine')) {
    if (m.ownership !== 'rented' || m.status !== 'ready' || read.has('Assignment', id)) continue;
    const since = m.lastActive ?? m.acquiredAt;
    if (read.now - since < IDLE_RENTAL_HOURS * HOUR) continue;
    const md = eq.model(m.model);
    const rate = Math.round((md.rentalPerDay?.value ?? 0) * read.port('prices').index(read.now));
    out.push({
      subject: id,
      label: md.label,
      code: 'settlement.idleRental',
      severity: 'warn',
      since,
      message: `${md.label} (rented) has had no work since ${read.calendar.format(since, 'day')} — the rent of ${rate} € a working day runs on until it is returned.`,
      remedies: [{ label: `Return ${md.label} to the rental company (off-hire)`, command: { type: 'equipment.release', payload: { machine: id } } }],
    });
  }
  return out;
}

/**
 * Soil left on stockpiles no running work draws from: nothing removes it by itself. The player
 * either has it hauled to a disposal site (paid) or keeps it to reuse as fill elsewhere.
 */
/** whose a thing held up is: its holder, employer, household, project's party (undefined: nobody's in particular) */
function partyOfSubject(read: ReadCtx, id: EntityId): EntityId | undefined {
  const pkg = read.get('WorkPackage', id);
  if (pkg) return read.get('Project', pkg.project)?.party;
  return (
    read.port('holdings').holder(read.port('trade').order(id)?.store ?? id) ??
    read.get('Project', id)?.party ??
    read.get('Machine', id)?.holder ??
    read.get('Structure', id)?.holder ??
    read.get('Employment', id)?.employer ??
    read.get('Helper', id)?.of ??
    read.get('Resident', id)?.party ??
    read.get('Road', id)?.holder
  );
}

function surplusSoilAlerts(read: ReadCtx, party?: EntityId): {
  subject: string;
  label: string;
  code: string;
  severity: string;
  message: string;
  remedies?: unknown[];
}[] {
  const inUse = new Set<EntityId>();
  for (const [, pr] of read.all('Project')) if ((pr.status === 'active' || pr.status === 'paused') && pr.store) inUse.add(pr.store);
  for (const [, pkg] of read.all('WorkPackage')) {
    if (pkg.status === 'done' || pkg.status === 'cancelled') continue;
    if (pkg.store) inUse.add(pkg.store);
    for (const o of pkg.produces ?? []) inUse.add(o.store);
    for (const sub of Object.values(pkg.substitutes ?? {})) if (sub.store) inUse.add(sub.store);
  }
  const hold = read.port('holdings');
  const out: ReturnType<typeof surplusSoilAlerts> = [];
  // (a heap of ours: not a depot, a work's front or what is built in, nor what a machine carries; of a party, or of every party)
  const parties = party !== undefined ? [party] : read.port('parties').all().map(([p]) => p);
  for (const id of parties.flatMap((p) => hold.ofParty(p, { kind: ['stockpile', 'site'] }))) {
    if (inUse.has(id)) continue;
    const label = hold.label(id)!;
    for (const material of Object.keys(hold.contents(id))) {
      // (what is not sold or sent off already, waiting for its lorry)
      const qty = hold.free(id, material);
      const mat = hold.material(material);
      if (mat.category !== 'soil' || qty < 1) continue;
      const amount = `${String(Math.round(qty)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${mat.unit}`;
      out.push({
        subject: id,
        label,
        code: 'settlement.surplusSoil',
        severity: 'warn',
        message: `${amount} ${mat.label} left on ${label} — no work draws from it. Dispose of it (trucked to a disposal site, paid) or keep it to reuse as fill.`,
        remedies: [
          {
            label: `Dispose of ${amount} ${mat.label}`,
            command: {
              type: 'inventory.dispose',
              payload: { store: id, material, qty },
            },
          },
        ],
      });
    }
  }
  return out;
}

/** All modules of the settlement game, in any order (the kernel sorts them by requirements). */
export const SETTLEMENT_MODULES: ModuleDef[] = [
  partiesModule,
  weatherModule,
  terrainModule,
  vegetationModule,
  soilModule,
  networkModule,
  accessesModule,
  trafficModule,
  movesModule,
  cycleModelModule,
  economyModule,
  agreementsModule,
  depositsModule,
  loansModule,
  leasesModule,
  lettingModule,
  rentLevelModule,
  workforceModule,
  physiologyModule,
  livingModule,
  visitsModule,
  landModule,
  authoritiesModule,
  equipmentModule,
  usedPlantCurveModule,
  inventoryModule,
  productionModule,
  errandsModule,
  spaceModule,
  environmentModule,
  rulebooksModule,
  sitingModule,
  structuresModule,
  roadsModule,
  buildingsModule,
  settlementModule,
];

// ------------------------------------------------------------------ worlds (decision 0021)

/** The default world: the Göttingen valley, a contractor's start, weather from the generator. */
export const GOETTINGEN_CONTRACTOR: WorldDefinition = {
  id: 'goettingen-contractor',
  label: 'Göttingen valley — contractor start',
  description: 'A 1.6 km valley near Göttingen. Your company: 15 people, 9 machines, a yard by the public road. Weather from the generator fitted to DWD 1991–2020.',
  seed: 20270301,
  epoch: { year: 2027, month: 3, day: 1 },
  area: 'de-ni-goettingen',
  packs: ['region-goettingen', 'economy-de', 'practice-de', 'law-de', 'law-de-ni', 'law-goettingen-planned'],
  starters: ['contractor'],
  bindings: [{ contract: 'weather', source: { kind: 'model', implementation: 'wgen-generator' } }],
  locale: 'de-DE',
};

/**
 * The same valley in 2024 with the weather that was measured at the DWD station Göttingen. The
 * station's record has a few gaps (a missing day's rain, wind or humidity); history will not
 * deliver them later, so the author lets the generator fill them — marked on every such value.
 */
export const GOETTINGEN_2024_MEASURED: WorldDefinition = {
  id: 'goettingen-2024-measured',
  label: 'Göttingen valley 2024 — measured weather',
  description: 'The contractor start in March 2024, with the daily weather measured at DWD station 01691 (CC BY 4.0) and the construction cycle recorded by Eurostat. Gaps in the records are filled by the models and marked.',
  seed: 20240301,
  epoch: { year: 2024, month: 3, day: 1 },
  area: 'de-ni-goettingen',
  packs: ['region-goettingen', 'economy-de', 'practice-de', 'law-de', 'law-de-ni', 'law-goettingen-planned'],
  starters: ['contractor'],
  // the daily record has no wind direction: the author takes it from the model, declared (decision 0022)
  bindings: [
    { contract: 'weather', source: { kind: 'measured', dataset: 'dwd-01691-daily', modelledFields: ['windDir'] }, gap: { policy: 'fallback' } },
    // the construction cycle that happened (Eurostat); after its last month the model draws on from there, marked
    { contract: 'constructionCycle', source: { kind: 'measured', dataset: 'eurostat-copr-de' }, gap: { policy: 'fallback' } },
  ],
  locale: 'de-DE',
};

/** A small contractor that rents its yard, in the same valley. */
export const GOETTINGEN_SMALL: WorldDefinition = {
  id: 'goettingen-small-contractor',
  label: 'Göttingen valley — small contractor, rented yard',
  description: 'The same valley; your company: 6 people, 3 machines, a rented yard with rent due from the first day.',
  seed: 20270301,
  epoch: { year: 2027, month: 3, day: 1 },
  area: 'de-ni-goettingen',
  packs: ['region-goettingen', 'economy-de', 'practice-de', 'law-de', 'law-de-ni', 'law-goettingen-planned'],
  starters: ['smallContractor'],
  bindings: [{ contract: 'weather', source: { kind: 'model', implementation: 'wgen-generator' } }],
  locale: 'de-DE',
};

/**
 * Rung 1 (decision 0025): one person and a tent, on somebody else's land. Jonas walks over the
 * hill from Rosdorf in November with a tent, a knife and food for a few days; the valley is the
 * Lindemann farm's, and they look after it. No road, no company, no machine.
 */
export const GOETTINGEN_TENT: WorldDefinition = {
  id: 'goettingen-tent',
  label: 'Göttingen hills — one person and a tent',
  description: 'November in the hills near Göttingen. You: one person with a tent, a knife, food and water for a few days and 400 €. The land is the Lindemann farm’s; the way in is a footpath over the hill from Rosdorf.',
  seed: 20271102,
  epoch: { year: 2027, month: 11, day: 2 },
  area: 'de-ni-goettingen',
  packs: ['region-goettingen-hillside', 'economy-de', 'practice-de', 'law-de', 'law-de-ni', 'law-goettingen'],
  starters: ['camper', 'lindemann'],
  bindings: [{ contract: 'weather', source: { kind: 'model', implementation: 'wgen-generator' } }],
  locale: 'de-DE',
};

/**
 * Five on inherited land: three men and two women take over a plot one of them inherited. Nothing
 * may be built on it — what stands there stands unfastened or on wheels. In April they arrive with
 * three tents and a frame tent for kitchen and sitting, hand tools, food and water for a few days
 * and pooled money; the plan is amenities, then living from the land.
 */
export const GOETTINGEN_HOMESTEAD: WorldDefinition = {
  id: 'goettingen-homestead',
  label: 'Göttingen valley — five on inherited land',
  description: 'April in the valley near Göttingen. Five people on a plot one of them inherited: nothing may be built on it, so all of it stays movable — three tents, a frame tent for kitchen and sitting, hand tools, food and water for a few days and 15,000 € pooled. The way in is a road; the long plan is amenities and growing their own food.',
  seed: 20280401,
  epoch: { year: 2028, month: 4, day: 1 },
  area: 'de-ni-goettingen',
  packs: ['region-goettingen', 'economy-de', 'practice-de', 'law-de', 'law-de-ni', 'law-goettingen'],
  starters: ['homesteaders'],
  bindings: [{ contract: 'weather', source: { kind: 'model', implementation: 'wgen-generator' } }],
  locale: 'de-DE',
};

/** Rung 1 with company: five friends who mean to build from the wood itself, by hand and with tools. */
export const GOETTINGEN_FOREST: WorldDefinition = {
  id: 'goettingen-forest-friends',
  label: 'Göttingen hills — five friends in the woods',
  description: 'May in the wood above Rosdorf. You: five friends with three tents, a camping stove, hand tools, a chainsaw and food and water for a few days, reaching for what the wood gives — felled timber, worked by hand. The land is the Lindemann farm’s; the way in is a footpath over the hill.',
  seed: 20270503,
  epoch: { year: 2027, month: 5, day: 3 },
  area: 'de-ni-goettingen',
  packs: ['region-goettingen-hillside', 'economy-de', 'practice-de', 'law-de', 'law-de-ni', 'law-goettingen'],
  starters: ['forestFriends', 'lindemann'],
  bindings: [{ contract: 'weather', source: { kind: 'model', implementation: 'wgen-generator' } }],
  locale: 'de-DE',
};

export const WORLDS: Record<string, WorldDefinition> = { [GOETTINGEN_CONTRACTOR.id]: GOETTINGEN_CONTRACTOR, [GOETTINGEN_2024_MEASURED.id]: GOETTINGEN_2024_MEASURED, [GOETTINGEN_SMALL.id]: GOETTINGEN_SMALL, [GOETTINGEN_TENT.id]: GOETTINGEN_TENT, [GOETTINGEN_HOMESTEAD.id]: GOETTINGEN_HOMESTEAD, [GOETTINGEN_FOREST.id]: GOETTINGEN_FOREST };

/** a weather series from a dataset of the pack, or delivered over a connection while the world runs */
const weatherSeriesSource = (module: ModuleDef) => (b: Binding, dataset: unknown, connection?: Connection) => ({
  modules: [module],
  data: {
    ...(b.source.dataset ? { weatherSeries: { [b.source.dataset]: dataset } } : {}),
    weatherBinding: { ...(b.source.dataset ? { dataset: b.source.dataset } : { connection: b.source.connection!, ...(connection?.label ? { connectionLabel: connection.label } : {}) }), ...(b.source.modelledFields ? { modelledFields: b.source.modelledFields } : {}), gap: b.gap! },
  },
});

/** a recorded exposure series from a dataset of the pack (decision 0022) */
const exposureSeriesSource = (b: Binding, dataset: unknown) => {
  if (!b.source.dataset) throw new Error('an exposure series needs a dataset');
  if (b.gap?.policy === 'wait') throw new Error("an exposure series' gaps can only fall back or fail");
  return { modules: [recordedEnvironmentModule], data: { exposureSeries: { [b.source.dataset]: dataset }, exposureBinding: { dataset: b.source.dataset, gap: b.gap! } } };
};

/** an entered record of used-plant sales from a dataset (decision 0022) */
const usedPlantSalesSource = (b: Binding, dataset: unknown) => {
  if (!b.source.dataset) throw new Error('comparable used-plant sales need a dataset');
  return { modules: [usedPlantComparablesModule], data: { usedPlantSales: { [b.source.dataset]: dataset }, usedPlantBinding: { dataset: b.source.dataset } } };
};

/** a recorded construction-activity index from a dataset (decision 0022) */
const cycleSeriesSource = (b: Binding, dataset: unknown) => {
  if (!b.source.dataset) throw new Error('a recorded construction cycle needs a dataset');
  if (b.gap?.policy === 'wait') throw new Error("a construction cycle's gaps can only fall back or fail");
  return { modules: [cycleRecordedModule], data: { cycleSeries: { [b.source.dataset]: dataset }, cycleBinding: { dataset: b.source.dataset, gap: b.gap! } } };
};

/** an entered rent table from a dataset (decision 0022) */
const rentTableSource = (b: Binding, dataset: unknown) => {
  if (!b.source.dataset) throw new Error('a rent table needs a dataset');
  return { modules: [rentTableModule], data: { rentTables: { [b.source.dataset]: dataset }, rentTableBinding: { dataset: b.source.dataset } } };
};

/** what the settlement game can offer to world definitions */
export const SETTLEMENT_REGISTRY: WorldRegistry = {
  packs: { 'region-goettingen': regionGoettingen, 'region-goettingen-hillside': regionGoettingenHillside, 'economy-de': economyDe, 'practice-de': practiceDe, 'law-de': lawDe, 'law-de-ni': lawDeNi, 'law-goettingen': lawGoettingen, 'law-goettingen-planned': lawGoettingenPlanned, ...Object.fromEntries(Object.entries(starterPacks).map(([id, catalogs]) => [id, { role: 'starter' as const, catalogs, modules: [settlementModule] }])) },
  locales: LOCALES,
  datasets: { ...regionDatasets, ...economyDatasets },
  base: SETTLEMENT_MODULES.filter((m) => m !== weatherModule && m !== environmentModule && m !== usedPlantCurveModule && m !== rentLevelModule && m !== cycleModelModule && m !== physiologyModule && m !== visitsModule && m !== settlementModule),
  contracts: {
    weather: {
      default: { modules: [weatherModule] },
      sources: { model: () => ({ modules: [weatherModule] }), measured: weatherSeriesSource(measuredWeatherModule), entered: weatherSeriesSource(enteredWeatherModule), external: weatherSeriesSource(externalWeatherModule) },
    },
    durability: {
      default: { modules: [isoDurabilityModule] },
      sources: { model: () => ({ modules: [isoDurabilityModule] }), 'iso15686-factor': () => ({ modules: [isoDurabilityModule] }), 'decay-dose': () => ({ modules: [doseDurabilityModule] }) },
    },
    environment: {
      default: { modules: [environmentModule] },
      sources: { model: () => ({ modules: [environmentModule] }), measured: exposureSeriesSource, entered: exposureSeriesSource },
    },
    tenantDemand: {
      default: { modules: [rentLevelModule] },
      sources: { model: () => ({ modules: [rentLevelModule] }), 'rent-level': () => ({ modules: [rentLevelModule] }), entered: rentTableSource },
    },
    detection: {
      default: { modules: [visitsModule] },
      sources: { model: () => ({ modules: [visitsModule] }), visits: () => ({ modules: [visitsModule] }), rounds: () => ({ modules: [roundsModule] }) },
    },
    structural: {
      default: { modules: [mechanicsModule] },
      sources: { model: () => ({ modules: [mechanicsModule] }), mechanics: () => ({ modules: [mechanicsModule] }), rules: () => ({ modules: [rulesModule] }) },
    },
    needs: {
      default: { modules: [physiologyModule] },
      sources: { model: () => ({ modules: [physiologyModule] }), physiology: () => ({ modules: [physiologyModule] }), sphere: () => ({ modules: [sphereModule] }) },
    },
    constructionCycle: {
      default: { modules: [cycleModelModule] },
      sources: { model: () => ({ modules: [cycleModelModule] }), ar1: () => ({ modules: [cycleModelModule] }), measured: cycleSeriesSource },
    },
    usedPlant: {
      default: { modules: [usedPlantCurveModule] },
      sources: { model: () => ({ modules: [usedPlantCurveModule] }), 'depreciation-curve': () => ({ modules: [usedPlantCurveModule] }), entered: usedPlantSalesSource },
    },
  },
};

export interface SettlementOptions {
  /** the world definition (default: the Göttingen contractor start); an id from WORLDS or a definition */
  world?: WorldDefinition | string;
  /** overrides the world's seed */
  seed?: number;
  /** overrides the world's epoch */
  epoch?: CalendarDate;
  /** override individual data catalogs (e.g. terrainSettings for another map) */
  data?: Record<string, unknown>;
  strict?: boolean;
}

/** resolve a world definition into a runnable world (decision 0021): its manifest, checked and composed */
export function settlementWorld(opts: SettlementOptions = {}): ResolvedWorld {
  const def = typeof opts.world === 'string' ? (WORLDS[opts.world] ?? (() => { throw new Error(`unknown world '${opts.world}'`); })()) : (opts.world ?? GOETTINGEN_CONTRACTOR);
  const resolved = resolveWorld(def, SETTLEMENT_REGISTRY, { strict: opts.strict ?? false, ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.epoch ? { epoch: opts.epoch } : {}), ...(opts.data ? { data: opts.data } : {}) });
  // a single-seat host acts as the party its starter brings (a multi-seat host names the actor per command)
  const seat = (resolved.config.data?.starters as Record<string, Starter> | undefined)?.[resolved.definition.starters[0]!];
  if (seat) resolved.config.actor = resolved.manifest.actor = seat.party.id;
  return resolved;
}

export function settlementConfig(opts: SettlementOptions = {}): RuntimeConfig {
  return settlementWorld(opts).config;
}

export function createSettlement(opts: SettlementOptions = {}): Runtime {
  return Runtime.create(settlementConfig(opts));
}
