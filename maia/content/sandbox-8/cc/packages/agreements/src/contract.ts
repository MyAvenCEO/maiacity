/**
 * Agreements contract (docs/design/economy.md): money changes hands with others only through an
 * agreement between us and a party that exists in the world. An agreement is a schedule of
 * obligations; what kind of agreement it is (a deposit, a loan, a lease, a purchase …) is an
 * *instrument* contributed to the `instruments` extension point. Parties and the products they
 * offer are data of the economy pack, every term with its source.
 */
import { s, type EntityId, type Explained, type Infer, type Param, type Provenance, type Source, type WriteCtx, type ReadCtx } from '../../kernel/src/index.ts';
import type { ACCOUNTS } from '../../economy/src/index.ts';
import type {} from '../../parties/src/index.ts';

// ------------------------------------------------------------------ data

/** someone we can agree with (economy pack) */
export const CounterpartySchema = s.object({
  label: s.string(),
  kind: s.enum(['bank', 'firm', 'household', 'public', 'person', 'company']),
  description: s.string().optional(),
  source: s.any<Source>().optional(),
});
export type Counterparty = Infer<typeof CounterpartySchema>;

/** a term of a product: a sourced parameter, or a plain choice (a string or a flag) */
export type TermValue = Param | string | boolean;

/** an offer: a party, an instrument and its default terms (economy pack) */
export const ProductSchema = s.object({
  label: s.string(),
  description: s.string().optional(),
  /** the counterparty (catalog id) */
  party: s.string(),
  instrument: s.string(),
  /** our side of it, one of the instrument's roles */
  role: s.string(),
  terms: s.record(s.any<TermValue>()),
  /** it is about a thing of this entity kind, named when opened (e.g. a yard: 'store'); absent: about nothing in particular */
  subjectKind: s.string().optional(),
  /** only one live agreement of this product at a time (a particular yard, one house) */
  unique: s.boolean().optional(),
  /** what it lets the holder do on its subject (felling; 'stay': being there); absent: staying there only. A permission is for what it says */
  permits: s.array(s.string()).optional(),
  /** the amount the agreement is opened with (deposits, loans), if it takes one */
  minAmount: s.param('EUR').optional(),
  maxAmount: s.param('EUR').optional(),
  /** days from asking until it starts (account opening, a loan's approval) */
  leadTime: s.param('d'),
  source: s.any<Source>().optional(),
});
export type Product = Infer<typeof ProductSchema>;

// ------------------------------------------------------------------ the world

/**
 * The law of a kind of claim (docs/design/claims.md; practice pack, per jurisdiction): when it is to be paid, the
 * notice's own fees, what lateness costs, whether a payment goes to the claim or its costs first, the objection it gives
 * (within how long of what, the court's time, how often a claim is upheld, whether it suspends enforcement, its fee), a
 * deferral, the steps of its enforcement in turn (after how many days, the act, its label and rule, its fee, a
 * detention's days, whether sitting it out ends it, whether it can only be had against a person or not against one shown
 * unable to pay, whether it is served and opens a new period to object, a new term it starts), what a household keeps
 * when its account is seized, what is written off, when it expires, whether it is a means of compulsion (it stops once
 * its purpose is reached), and the account it is booked to
 */
export const ClaimLawSchema = s.object({
  label: s.string(),
  pay: s.param('d'),
  account: s.enum(['fines', 'damages']).optional(),
  /** the notice's fees: a share of the claim between a least and a most, and its outlays (§ 107 OWiG) */
  noticeFee: s.object({ share: s.param('1'), min: s.param('EUR'), max: s.param('EUR'), outlay: s.param('EUR'), rule: s.string() }).optional(),
  /** what lateness costs from the due date or from the first reminder: interest a year (between firms more), or a surcharge a month begun on the claim rounded down */
  late: s.object({ label: s.string(), rule: s.string(), from: s.enum(['due', 'reminder']), perYear: s.param('1/a').optional(), perYearFirms: s.param('1/a').optional(), perMonth: s.param('1').optional(), roundDown: s.param('EUR').optional() }).optional(),
  /** what a payment goes to first: the claim (a fine, § 459b StPO) or its costs and interest (§ 367 BGB) */
  order: s.enum(['claimFirst', 'costsFirst']),
  objection: s.object({ label: s.string(), within: s.param('d'), court: s.param('d'), upheld: s.param('1'), suspends: s.boolean(), fee: s.param('EUR').optional(), served: s.boolean().optional() }).optional(),
  /**
   * a deferral asked of the creditor: how often granted, for how long; `hardship`: only where paying it at once would be a
   * considerable hardship (§ 222 AO, § 59 LHO); `interest`: what it bears a month for each full month granted (§ 234 AO)
   */
  deferral: s.object({ label: s.string(), granted: s.param('1'), days: s.param('d'), hardship: s.boolean().optional(), interest: s.object({ perMonth: s.param('1'), roundDown: s.param('EUR'), whole: s.param('EUR'), least: s.param('EUR'), rule: s.string() }).optional() }).optional(),
  steps: s.array(s.object({ after: s.param('d'), act: s.enum(['reminder', 'seizure', 'court', 'detention']), label: s.string(), rule: s.string(), fee: s.param('EUR').optional(), days: s.param('d').optional(), extinguishes: s.boolean().optional(), person: s.boolean().optional(), unlessUnable: s.boolean().optional(), served: s.boolean().optional(), term: s.param('a').optional() })),
  /** what an account seizure leaves the debtor a month, and more for the first and each further one it keeps (§ 850c ZPO) */
  protect: s.object({ debtor: s.param('EUR'), first: s.param('EUR'), further: s.param('EUR') }).optional(),
  writeOff: s.param('EUR').optional(),
  expires: s.param('a').optional(),
  /** a longer term for a claim above an amount (§ 34 Abs. 2 OWiG) */
  expiresAbove: s.object({ amount: s.param('EUR'), term: s.param('a') }).optional(),
  /** a means of compulsion: enforcement stops once what it was to compel is done (its rule) */
  compels: s.string().optional(),
});
export type ClaimLaw = Infer<typeof ClaimLawSchema>;

/**
 * The law of an estate (practice pack, per jurisdiction): a party with nobody left of it is an estate, its heirs or
 * liquidators winding it up. `fixedTerm`: the law's extraordinary notice of what it rents ends a fixed term too (§ 564
 * S. 2, § 580 BGB: with the law's period); `rule`: the rule said
 */
export const EstateLawSchema = s.object({ rule: s.string(), fixedTerm: s.boolean() });
export type EstateLaw = Infer<typeof EstateLawSchema>;

/** an open item: something one side owes the other, due at a time */
export interface Obligation {
  /** sequence within the agreement */
  id: number;
  kind: string;
  label: string;
  due: number;
  amount: number;
  /** who pays: we, or the other party */
  payer: 'holder' | 'party';
  /** ledger accounts the payment moves between (from → to) */
  from: string;
  to: string;
  paid: number;
  /** the same payment in the other side's books, where it keeps books (another player): its accounts, from → to */
  mirror?: { from: string; to: string };
  /** paid only by the payer's act (a notice to pay: a fine, a bill), never taken from its account when due */
  manual?: boolean;
}

/** what the world knows about an agreement that the players do not (drawn futures, the other side's behaviour) */
export interface HiddenAgreement {
  /** obligation id → when the other side actually pays (a late tenant) */
  paysAt?: Record<string, number>;
  /** when the other side will give notice of their own accord */
  leaveAt?: number;
  /** how the other side behaves (from a market model) */
  behaviour?: { stayDays?: number; lateShare?: number; lateDays?: number };
}

/** who holds an asset other than by owning it outright: let to someone, or rented from someone */
export interface Tenure {
  basis: 'leaseOut' | 'leaseIn';
  agreement: EntityId;
}

export interface Agreement {
  instrument: string;
  product?: string;
  label: string;
  /** the party that holds it: the side whose books it is in (decision 0025) */
  holder: EntityId;
  /** the other side */
  party: EntityId;
  /** the holder's side of it (depositor, borrower, lessee, lessor …) */
  role: string;
  /** what it is about (a building, a space, a machine), if anything */
  subject?: EntityId;
  /** the terms, resolved to numbers in the instrument's units (and plain choices) */
  terms: Record<string, number | string | boolean>;
  status: 'pending' | 'active' | 'ending' | 'ended';
  openedAt: number;
  start: number;
  /** a fixed end (maturity, a booking's last day) */
  end?: number;
  endedAt?: number;
  notice?: { by: 'holder' | 'party'; given: number; effective: number };
  /** the amount it was opened with */
  amount?: number;
  /** ledger account holding the agreement's own balance (a deposit, a loan's principal) */
  account?: string;
  /** open items, oldest first (paid ones are dropped) */
  open: Obligation[];
  /** wound up by its instrument, and ending once its open items are settled */
  wound?: boolean;
  nextObligation: number;
  /** the instrument's own bookkeeping (accrued interest, last accrual …) */
  state: Record<string, number | string | boolean>;
}

// ------------------------------------------------------------------ instruments

/** what an instrument may do to its agreement, inside the agreements module */
export interface InstrumentCtx {
  readonly ctx: WriteCtx;
  readonly id: EntityId;
  agreement(): Readonly<Agreement>;
  patch(patch: Partial<Agreement>): void;
  setState(patch: Agreement['state']): void;
  /** the agreement's own balance (0 without an account) */
  balance(): number;
  /** move money now between two accounts (one of them usually cash or the agreement's account) */
  move(from: string, to: string, amount: number, memo: string): void;
  /** something falls due: an open item the paying side settles when due (the other side late: `paysAt`, kept hidden) */
  owe(o: Omit<Obligation, 'id' | 'paid'> & { paysAt?: number }): void;
  /** what the world knows of it and the players do not */
  hidden(): HiddenAgreement;
  setHidden(patch: HiddenAgreement): void;
  /** refuse an action legibly (a blocker code of the agreements module, with params) */
  refuse(code: string, params?: Record<string, string | number>): never;
  /** the holder: the party whose books the agreement is in */
  readonly holder: EntityId;
  /** the holder's chart of accounts (ledger account ids) */
  readonly accounts: { readonly [K in keyof typeof ACCOUNTS]: string };
}

export interface InstrumentAction {
  label: string;
  description: string;
  /** the action takes an amount (EUR) */
  amount: boolean;
  /** taken by the other side (a creditor relenting), not by the holder */
  byParty?: boolean;
  run(i: InstrumentCtx, amount?: number): void;
}

/**
 * A kind of agreement. Contributed to the `instruments` extension point by any module; the core
 * knows none. Terms are declared with their units so a product's sourced parameters can be
 * resolved and shown; everything an instrument does goes through `InstrumentCtx`.
 */
export interface Instrument {
  id: string;
  label: string;
  description: string;
  /** the sides we may take */
  roles: string[];
  /** made by the law, not by the parties' wills (a claim): had against a party that ended, its estate, too */
  imposed?: boolean;
  /** its terms: unit for numbers (converted from the product's parameters), or 'choice' */
  terms: Record<string, { label: string; unit: string | 'choice'; optional?: boolean }>;
  /** the agreement holds a balance of its own: an asset (deposit) or a liability (loan) of ours, by our role */
  balance?: 'asset' | 'liability' | ((role: string) => 'asset' | 'liability' | undefined);
  /** it is opened with an amount */
  takesAmount: boolean;
  /** what stands against opening it now (checked when asked for, again when it starts; `self`: the agreement starting) */
  check?(read: ReadCtx, holder: EntityId, terms: Agreement['terms'], amount: number | undefined, self?: EntityId): { code: string; params: Record<string, string | number> } | null;
  /** the action that brings its money back to our cash (a deposit's withdrawal), offered when money is short */
  cashOut?: string;
  /** opening it brings cash (a loan), offered when money is short */
  cashIn?: boolean;
  /** what holding its subject means for us in this role (let out, or rented in) */
  tenure?(role: string): Tenure['basis'] | undefined;
  /** the agreement starts (after the product's lead time); refuse if it cannot */
  start(i: InstrumentCtx): void;
  /** bring the agreement up to now (accrue, schedule what falls due); called at least daily */
  settle(i: InstrumentCtx): void;
  actions: Record<string, InstrumentAction>;
  /**
   * may notice be given now, and when does it take effect; `extraordinary`: the law's notice of an estate (the holder
   * ended, nobody left of it: its heirs' notice with the law's period, a fixed term too, where the law gives one)
   */
  notice(i: InstrumentCtx, by: 'holder' | 'party', extraordinary?: boolean): number;
  /** it ends: wind up (pay out balances, settle the rest) */
  close(i: InstrumentCtx): void;
  /** a what-if fork: draw again whatever the agreement holds about the other side's future */
  branch?(i: InstrumentCtx): void;
  /** the holder is being wound up (insolvency proceedings): what this kind of agreement does then (a loan falls due) */
  windUp?(i: InstrumentCtx): void;
  /** a line on its state for players and agents */
  describe(read: ReadCtx, a: Readonly<Agreement>, balance: number): string;
}

/** an agreement as players and agents see it */
export interface AgreementView {
  id: EntityId;
  label: string;
  instrument: string;
  party: string;
  role: string;
  status: Agreement['status'];
  terms: { key: string; label: string; value: number | string | boolean; unit: string }[];
  balance: number;
  start: number;
  end?: number;
  notice?: Agreement['notice'];
  open: { label: string; due: number; amount: number; payer: 'holder' | 'party'; paid: number }[];
  actions: { id: string; label: string; description: string; amount: boolean }[];
  /** how it is ended (by notice, its own command), while it runs */
  endBy?: string;
  summary: string;
}

/** a product as players and agents see it */
export interface OfferView {
  id: string;
  label: string;
  description?: string;
  party: string;
  instrument: string;
  role: string;
  terms: { key: string; label: string; value: number | string | boolean; unit: string; source?: string }[];
  minAmount?: number;
  maxAmount?: number;
  leadTime: number;
}

export interface AgreementsPort {
  /** the agreements (of one holder) */
  agreements(party?: EntityId): AgreementView[];
  offers(): OfferView[];
  /** the live (pending, active or ending) agreement about this subject, if any */
  holderOf(subject: EntityId): EntityId | null;
  /** every live agreement about this subject (one holder may hold several, each for what it permits) */
  about(subject: EntityId): EntityId[];
  /** the agreement of this holder (null: anyone's) about the subject, begun and not ended, that lets it do this ('stay' or none: being there; its product's `permits`); with `at`: the one that did at that time, ended since or not */
  permitting(holder: EntityId | null, subject: EntityId, kind?: string, at?: number): EntityId | undefined;
  /** an agreement of this holder about the subject asked for and not begun yet that will let it do this */
  applied(holder: EntityId, subject: EntityId, kind?: string): EntityId | undefined;
  /** the total of a party's agreement balances by side */
  holdings(party: EntityId): { assets: number; liabilities: number };
  /**
   * things let to a party by another (a yard, a hall: not land, which has its parcels), the let running or ended: the
   * last let of each thing to each lessee, with when it ended and its rent a day (one fact for the parcels' record and
   * for what is to be given back, § 546 BGB)
   */
  lets(): { agreement: EntityId; subject: EntityId; lessee: EntityId; lessor: EntityId; product?: string; live: boolean; ended?: number; rentPerDay: number }[];
}

/** a thing offered by one party to another, waiting for the other to take it (a tool lent: a loan for use, § 598 BGB) */
export interface Proposal {
  from: EntityId;
  to: EntityId;
  /** what is lent */
  subject: EntityId;
  /** for so many days; none: until the lender asks for it back */
  days?: number;
  /** a fee a day (EUR): let for money, not lent for nothing */
  fee?: number;
  at: number;
}

export interface AgreementsState {
  /** counterparty catalog id → party entity */
  parties: Record<string, EntityId>;
  /** offers made so far (their ids count up) */
  offered?: number;
  /** agreement → what players do not know (drawn futures, the other side's behaviour) */
  hidden: Record<EntityId, HiddenAgreement>;
}

// ------------------------------------------------------------------ letting (docs/design/economy.md, slice 5)

/** what a module says about something it can let: what it is and how big and sound it is */
export interface LettableFacts {
  label: string;
  /** e.g. the building type */
  type: string;
  /** gross floor area (m²) */
  area: number;
  /** 0..1: 1 as new */
  condition: number;
  /** the party that holds it and would let it */
  holder: EntityId;
}

/** a way to let something (practice pack: the law and custom of it) */
export const LettingUseSchema = s.object({
  label: s.string(),
  description: s.string().optional(),
  /** the kinds of things let this way (building types) */
  types: s.array(s.string()),
  period: s.enum(['month', 'day']),
  /** a booking of fixed days (day hire); absent: open-ended */
  bookingDays: s.param('d').optional(),
  tenantNotice: s.param('d'),
  /** absent: the lessor cannot give notice (e.g. a home) */
  landlordNotice: s.param('d').optional(),
  /** deposit in rent periods */
  depositPeriods: s.param('1').optional(),
  /** the share of the gross floor area that is let (living or usable area) */
  areaShare: s.param('1'),
  /** the most a new let may ask, as a multiple of the market rent (a rent cap) */
  rentCap: s.param('1').optional(),
  /** of tenants who sign above the cap, the share who claim the excess as void and pay the cap (0025: the law does not refuse the ask, it answers it) */
  capClaim: s.param('1').optional(),
  /** rent in arrears (in rent periods) that lets the lessor end the let at once */
  arrearsLimit: s.param('1').optional(),
  tenantKind: s.enum(['household', 'firm', 'public']),
  /** how a tenant is called ("Household", "Firm", "Event booking") */
  tenantLabel: s.string(),
  source: s.any<Source>().optional(),
});
export type LettingUse = Infer<typeof LettingUseSchema>;

/** what the market pays for a use, and how its tenants behave (economy pack; the rent-level model) */
export const RentLevelSchema = s.object({
  rentPerM2: s.param('EUR/m2/d'),
  /** mean days between prospective tenants (bookings) */
  vacancyDays: s.param('d'),
  /** how widely what they would pay spreads around the market rent (σ of its log) */
  spread: s.param('1'),
  /** a tenant paying above the market stays shorter: stay × (market / rent)^elasticity */
  stayElasticity: s.param('1').optional(),
  /** how much a building in poor condition loses: rent × (1 − weight × (1 − condition)) */
  conditionWeight: s.param('1'),
  stayDays: s.param('d').optional(),
  lateShare: s.param('1').optional(),
  lateDays: s.param('d').optional(),
  source: s.any<Source>().optional(),
});
export type RentLevel = Infer<typeof RentLevelSchema>;

/** an entered rent table (e.g. a local rent index): rent per m² and month by use and size, with what tenants did */
export const RentTableSchema = s.object({
  source: s.any<Source>(),
  /** how widely what tenants would pay spreads around the table's rent (σ of its log) */
  spread: s.param('1'),
  rows: s.array(s.object({ use: s.string(), minArea: s.number({ min: 0 }), maxArea: s.number({ min: 0 }), rentPerM2Month: s.number({ min: 0 }), vacancyDays: s.number({ min: 0 }), stayDays: s.number({ min: 0 }).optional(), stayElasticity: s.number({ min: 0 }).optional(), lateShare: s.number({ min: 0, max: 1 }).optional(), lateDays: s.number({ min: 0 }).optional() })),
});
export type RentTable = Infer<typeof RentTableSchema>;

/** the tenant-demand model contract (decision 0015): what tenants pay, how soon they come, how they behave */
export interface TenantDemandPort {
  /** the market rent per rent period for this subject and use */
  rent(subject: EntityId, use: string): { rent: number; explain: Explained; provenance: Provenance };
  /** prospective tenants (bookings): the mean days between them, and how widely what they would pay spreads around the market rent (σ of its log) */
  tenants(subject: EntityId, use: string): { meanDays: number; spread: number };
  /** how its tenants behave: how long they stay before giving notice (shorter above the market), how often and how late they pay late */
  behaviour(subject: EntityId, use: string): { stayDays?: number; stayElasticity?: number; lateShare: number; lateDays: number };
}

/** something offered to let */
export interface Letting {
  use: string;
  ask: number;
  since: number;
}

export interface LettingState {
  /** subject → when the next prospective tenant comes (drawn: the world's knowledge, not the players') */
  next: Record<EntityId, number>;
}

export interface LettingOption {
  use: string;
  label: string;
  period: 'month' | 'day';
  /** market rent per period */
  rent: number;
  /** the most a new let may ask (a rent cap), if any */
  maxAsk?: number;
  /** expected days until a tenant comes at the market rent */
  expectedDays: number;
  provenance: Provenance;
}

export interface LettingPort {
  /** what a subject could be let for, by use (empty: not lettable) */
  options(subject: EntityId): LettingOption[];
}

declare module '../../kernel/src/index.ts' {
  interface ComponentTypes {
    Agreement: Agreement;
    Proposal: Proposal;
    Tenure: Tenure;
    Letting: Letting;
  }
  interface ContributionTypes {
    instruments: Instrument[];
    /** modules that own lettable things say what they are */
    lettables: (read: ReadCtx, subject: EntityId) => LettableFacts | null;
    /** modules that know who holds a thing say so (a parcel's holder): only its holder lets it (null: not theirs to say) */
    holders: (read: ReadCtx, subject: EntityId) => EntityId | null;
    /** why a thing cannot be lent now (offered for sale, promised to a buyer), or null */
    notLendable: (read: ReadCtx, subject: EntityId) => string | null;
    /** modules that hold things say when one is gone (taken down, come down): what is agreed about it ends */
    gone: (read: ReadCtx, subject: EntityId) => string | null;
    /** modules that own what a product's permit is for say when there is none of it here (a pass where no bus or train stops): such a product is not offered */
    unusable: (read: ReadCtx, permit: string) => string | null;
  }
  interface PortTypes {
    agreements: AgreementsPort;
    tenantDemand: TenantDemandPort;
    letting: LettingPort;
  }
  interface ModuleStateTypes {
    agreements: AgreementsState;
    letting: LettingState;
  }
  interface DataTypes {
    claimLaw?: Record<string, ClaimLaw>;
    estateLaw?: EstateLaw;
    counterparties?: Record<string, Counterparty>;
    products?: Record<string, Product>;
    lettingUses?: Record<string, LettingUse>;
    rentLevels?: Record<string, RentLevel>;
    rentTables?: Record<string, RentTable>;
    rentTableBinding?: { dataset: string };
  }
  interface EventTypes {
    'agreements.started': { agreement: EntityId; instrument: string };
    'agreements.ended': { agreement: EntityId; instrument: string };
  }
  interface CommandTypes {
    'agreements.open': { payload: { product: string; amount?: number; subject?: EntityId; holder?: EntityId }; result: { agreement: EntityId; start: number } };
    'agreements.act': { payload: { agreement: EntityId; action: string; amount?: number }; result: void };
    'agreements.notice': { payload: { agreement: EntityId }; result: { effective: number } };
    /** a market model brings a party into the world (a tenant, a buyer) */

    'letting.offer': { payload: { subject: EntityId; use: string; ask?: number }; result: { ask: number; rent: number; expectedDays: number } };
    'letting.withdraw': { payload: { subject: EntityId }; result: void };
    /** a market model makes an agreement with a party it brought (internal: players open products) */
    'agreements.lend': { payload: { subject: EntityId; to: EntityId; days?: number }; result: string };
    'agreements.accept': { payload: { proposal: string }; result: EntityId };
    'agreements.decline': { payload: { proposal: string }; result: void };
    'agreements.contract': { payload: { instrument: string; label: string; holder: EntityId; party: EntityId; role: string; subject?: EntityId; terms: Agreement['terms']; amount?: number; start?: number; behaviour?: HiddenAgreement['behaviour'] }; result: EntityId };
  }
}
