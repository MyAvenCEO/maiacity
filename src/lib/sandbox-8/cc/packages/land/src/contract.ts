/**
 * Land (decision 0025): every place has a holder and a basis — owned, leased, held by custom,
 * public, or nobody's. Holding land gates nothing: anyone can camp or build anywhere they can get
 * to. The holder notices what others do on its land (a model contract: how soon) and reacts by the
 * law of the place, in steps with their own time: a word, a letter, an eviction.
 */
import { s, type EntityId, type Infer, type Provenance } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';

export const BASES = ['own', 'lease', 'customary', 'public', 'none'] as const;
export type Basis = (typeof BASES)[number];

/** a piece of land: its outline (absent: the rest of the map) and who holds it on what basis */
export interface Parcel {
  label: string;
  holder: EntityId;
  basis: Basis;
  /** absent: everything no other parcel covers */
  polygon?: Vec2[];
  /** the holder looks after it by the custom of the place (a world's farmer); false: its players decide (decision 0025) */
  watched: boolean;
}

/** parcels a world defines (truth: decision 0021) */
export const ParcelDataSchema = s.object({ label: s.string(), holder: s.string(), basis: s.enum(BASES), polygon: s.array(s.point()).optional() });

/** what something someone has on the land is, as its module says: where, how big, who lives there */
export interface LandUse {
  subject: EntityId;
  party: EntityId;
  label: string;
  pos: Vec2;
  /** ground it covers (m²) */
  area: number;
  /** people living there */
  people: number;
  /** lived in for good (not a stay): by those who make their home there, since when */
  dwelling?: { since: number };
  /** built in place (not a kit struck and pitched again): since when its work began, its size (m³ built), and whether it stands finished */
  built?: { since: number; volume: number; finished: boolean };
  /** the words for ending it ('strike the camp and go' by default) */
  leave?: string;
  /** what kind of use it is, where a permission must say it (felling) */
  kind?: string;
}

/** a use as the holder sees it: how visible it is from where people pass */
export interface UseView extends LandUse {
  /** 0.. : how easily it is noticed (size, people, nearness to a way) */
  visibility: number;
}

/** the detection contract: when a holder comes to notice a use of its land (u: a uniform draw) */
export interface DetectionPort {
  noticedAt(use: UseView, from: number, u: number): { at: number; provenance: Provenance };
}

/** how a holder notices: by visits at random, or by regular rounds (practice pack: custom) */
export const DetectionSettingsSchema = s.object({
  visits: s.object({ meanDays: s.param('d'), notice: s.param('1') }),
  rounds: s.object({ everyDays: s.param('d'), notice: s.param('1') }),
  /** visibility: a use of this area (m²) at this distance from a way (m) counts 1 */
  reference: s.object({ area: s.param('m2'), distance: s.param('m') }),
  /** what others notice of a use and tell (a smell, no toilet, waste lying about): each kind once brings the noticing nearer, the time left to it so many times as long */
  complaint: s.param('1').optional(),
});
export type DetectionSettings = Infer<typeof DetectionSettingsSchema>;

/**
 * A step of the law, as one who watches the land takes it (law pack): a notice (a word, a
 * hearing) and an order give time; a fine is paid and gives time again; a clearance ends the use, at
 * its cost. The steps are taken in turn while the use goes on.
 */
export const LawStepSchema = s.object({
  act: s.enum(['notice', 'order', 'fine', 'clearance']),
  label: s.string(),
  days: s.param('d').optional(),
  cost: s.param('EUR').optional(),
  /** what it costs by the size of what is built (a demolition: per m³ built) */
  costPerM3: s.param('EUR/m3').optional(),
  source: s.any().optional(),
});
export type LawStep = Infer<typeof LawStepSchema>;

/** what a holder does about someone else's use of its land, step by step (law pack) */
/** wood taken from the land: its value, which the holder claims as damages when they find it */
export const TrespassSchema = s.object({ steps: s.array(LawStepSchema), wood: s.object({ value: s.param('EUR/t'), rule: s.string() }).optional() });
export type Trespass = Infer<typeof TrespassSchema>;

/**
 * A thing let that is not given back when its let has ended (a yard with the tenant's goods still in it): the lessor's
 * steps to have it back cleared, and the rent it is owed a day for the time it is kept (law pack)
 */
export const LeaseEndSchema = s.object({
  steps: s.array(LawStepSchema),
  rule: s.string(),
  compensation: s.string(),
  /**
   * what a clearance does with the goods in it: they stay the former tenant's. The removal firm's `vehicle` comes for
   * them (`tries` times at most) and takes them to storage beyond the map; there they are kept `keep` days from the
   * clearance and handed back on demand once the clearance's costs are paid (brought back for `back`); not fetched, they
   * are sold, fetching `fetches` of their price new, and what that brings less the sale's `saleCosts` (a share) is paid
   * to the former tenant; what nobody buys is destroyed. Brought back, a lorry stopped on the way comes again (`tries`
   * times at most), else what was paid for the trip is refunded. A removal that cannot get to the goods on any of its
   * tries ends in the enforcement limited to possession (`left`, the rule): the lessor has the thing back, the goods are
   * left where they are, the former tenant's to take away within `keep` days; then the lessor sells them where they
   * stand, what they fetch less the costs paid out
   */
  goods: s.object({ rule: s.string(), left: s.string(), vehicle: s.string(), tries: s.param('1'), keep: s.param('d'), fetches: s.param('1'), saleCosts: s.param('1'), back: s.param('EUR') }),
});
export type LeaseEnd = Infer<typeof LeaseEndSchema>;

/**
 * Zoning (region data, decision 0021): what a place may be used for. Living somewhere for good where
 * the zone does not allow dwellings (the outer area, § 35 BauGB) is a matter for the authority that
 * the world names, a party of it; a zone without an outline is the rest of the map.
 */
export const ZoningSchema = s.object({
  authority: s.string(),
  /** dwelling: a home may be lived in here; building: what is built in place may be permitted here */
  zones: s.record(s.object({ label: s.string(), polygon: s.array(s.point()).optional(), dwelling: s.boolean(), building: s.boolean() })),
});
export type Zoning = Infer<typeof ZoningSchema>;

/** what the building authority does about a use against the zoning, and after how long a stay it counts as living there for good (law pack) */
/** asking the authority (VISION "Asking the authority is a deed too"): its label, its fee, the drafter's fee, how long it takes */
const ApplicationSchema = s.object({ label: s.string(), fee: s.param('EUR'), designer: s.param('EUR').optional(), days: s.param('d') });

export const BuildingLawSchema = s.object({
  /** a preliminary enquiry and an application for the permit after the fact, and why a use the zone does not allow is refused */
  applications: s.object({ enquiry: ApplicationSchema, permit: ApplicationSchema, refusal: s.object({ dwelling: s.string(), building: s.string() }) }).optional(),
  /** what is built in place without a permit where nothing may be built: the steps, and how small a thing needs none */
  building: s.object({ free: s.param('m3'), steps: s.array(LawStepSchema), rule: s.string() }),
  tolerance: s.param('d'),
  /** how long, on average, until a home lived in for good in such a zone becomes known to the authority (neighbours, walkers, the post) */
  notice: s.param('d'),
  steps: s.array(LawStepSchema),
  rule: s.string(),
});
export type BuildingLaw = Infer<typeof BuildingLawSchema>;

/** how the authorities come to know of what is against the law, and what it costs (law pack) */
/** what an authority answers a breach with: how often it finds such breaches, the fine, and the authority (a party id) */
export const EnforcementSchema = s.record(s.object({ label: s.string(), foundPerYear: s.param('1/a'), fine: s.param('EUR'), kind: s.enum(['administrative', 'criminal']).optional(), by: s.string().optional(), byLabel: s.string().optional() }));
export type Enforcement = Infer<typeof EnforcementSchema>;

/** something against the law the authorities may come to know of */
export interface Exposure {
  party: EntityId;
  person: EntityId;
  kind: string;
  what: string;
  rule: string;
  at: number;
}

/** where a use stands with one who watches it (the holder of its land, the building authority) */
export interface Encounter {
  /** the subject (the use) */
  subject: EntityId;
  /** whose law: the holder's (trespass) or the authority's (zoning) */
  law: 'trespass' | 'zoning' | 'building' | 'lease';
  /** who watches: the holder, the authority */
  by: EntityId;
  parcel?: EntityId;
  party: EntityId;
  /** 'unseen', or the act of the step taken last */
  stage: 'unseen' | LawStep['act'];
  /** the step taken last (index into the law's steps) */
  step: number;
  /** when the current step's time runs out */
  deadline?: number;
  /** wood taken (t) the holder has claimed for so far */
  claimed?: number;
  /** a thing let and kept after its let ended: the agreement, since when, and the rent a day owed for it (§ 546a BGB) */
  kept?: { agreement: EntityId; since: number; perDay: number };
}

export interface AuthorityState {
  /** what the authorities do not know yet */
  exposures: Record<string, Exposure>;
  /** exposure → when they will find out (the world's knowledge) */
  foundAt: Record<string, number>;
  next: number;
}

export interface LandState {
  /** matter (trespass:use, zoning:household|zone) → where it stands with its watcher */
  encounters: Record<string, Encounter>;
  /** matter → when its watcher will notice it (the world's knowledge, not the players') */
  noticedAt: Record<string, number>;
  /** household|zone → since when it has lived in a zone without homes, and when it was last seen there */
  dwelt: Record<string, { since: number; last: number }>;
  /** matter → what has been told of it already (each kind of complaint brings its noticing nearer once) */
  told?: Record<string, string[]>;
  /** felling work → how many of its felled trees (felledAt) were looked at, which of them were felled with the holder's leave (bought, not taken), and which were claimed for as taken */
  wood: Record<EntityId, { seen: number; bought: number[]; claimed: number[] }>;
  /** what a party has asked the building authority: an enquiry or an application, about a use, and its answer when given */
  applications?: Record<string, { party: EntityId; subject: EntityId; label: string; kind: 'enquiry' | 'permit'; about: 'dwelling' | 'building'; zone: string; at: number; decideAt: number; answer?: 'granted' | 'could be permitted' | 'refused'; why?: string }>;
  /** what the authority has permitted: household|zone (living there) and structures (built there) */
  permits?: Record<string, number>;
  /** a let kept after it ended → until when its days kept have been claimed (kept again later, only the days since count) */
  keptClaimed?: Record<EntityId, number>;
  /**
   * goods a clearance took from a thing let (§ 885 ZPO), still their owner's: the removal on its way to them
   * (`removal`), held in storage beyond the map since `since` until `until` (`held`), or on their way back (`back`)
   */
  held?: Record<string, Held>;
}

export interface Held {
  party: EntityId;
  /** the thing let they were taken from, and who had it cleared */
  from: EntityId;
  by: EntityId;
  /** removal: the firm on its way to them; held: in storage; back: being brought back; left: left where they were, the lessor in possession (§ 885a) */
  stage: 'removal' | 'held' | 'back' | 'left';
  /** material → quantity (empty while the removal is on its way) */
  goods: Record<string, number>;
  /** when the clearance was */
  cleared: number;
  /** held or left: until when they are kept before they are sold */
  until?: number;
  /** the removal's or the way back's move; the removal's or the way back's tries so far */
  move?: EntityId;
  tries?: number;
  /** on the way back: into this store of the owner's, and what was paid for the trip (refunded if it never comes) */
  to?: EntityId;
  paid?: number;
}

export interface LandPort {
  parcelAt(pos: Vec2): EntityId | null;
  /** may this party use this parcel: it holds it, or holds an agreement about it (a lease, a permission) */
  permitted(party: EntityId, parcel: EntityId, kind?: string): boolean;
}

declare module '../../kernel/src/index.ts' {
  interface ComponentTypes {
    Parcel: Parcel;
  }
  interface PortTypes {
    land: LandPort;
    detection: DetectionPort;
  }
  interface ContributionTypes {
    /** modules say what of theirs is on the land: camps, structures, works */
    landUse: (read: import('../../kernel/src/index.ts').ReadCtx) => LandUse[];
  }
  interface DataTypes {
    parcels?: Record<string, Infer<typeof ParcelDataSchema>>;
    detectionSettings: DetectionSettings;
    trespass: Trespass;
    leaseEnd?: LeaseEnd;
    zoning?: Zoning;
    buildingLaw?: BuildingLaw;
    enforcement: Enforcement;
  }
  interface ModuleStateTypes {
    land: LandState;
    authorities: AuthorityState;
  }
  interface CommandTypes {
    /** a party holds land (a starter, a purchase): an outline, or the rest of the map */
    'land.claim': { payload: { label: string; holder: EntityId; basis: Basis; polygon?: Vec2[]; watched?: boolean }; result: EntityId };
    /** leave a place: the party takes what it has there away (a camp is struck) */
    'land.leave': { payload: { subject: EntityId }; result: void };
    'land.complaint': { payload: { subject: EntityId; party: EntityId; what: string }; result: void };
    /** goods a clearance took to storage, asked back into a store of ours (their costs paid) */
    'land.fetchGoods': { payload: { held: string; to: EntityId }; result: void };
  }
  interface EventTypes {
    /** a use is to be taken away: by its party leaving, or by eviction */
    'land.vacate': { subject: EntityId; party: EntityId; evicted: boolean };
  }
}
