/**
 * Economy contract: every party's books (decision 0025), the price level, the construction cycle.
 * A party that keeps books has its own chart of accounts (`<party>:cash`, `<party>:expense:labour`
 * …); every module that spends or earns money posts to the books of the party that pays or is
 * paid. A future "global economy" model replaces the `prices` port without touching consumers.
 */
import { s, type EntityId, type Infer } from '../../kernel/src/index.ts';

export const ACCOUNTS = {
  cash: 'cash',
  capital: 'equity:capital',
  grants: 'income:grants',
  sales: 'income:sales',
  labour: 'expense:labour',
  equipmentOwning: 'expense:equipment-owning',
  equipmentRepair: 'expense:equipment-repair',
  equipmentRental: 'expense:equipment-rental',
  fuel: 'expense:fuel',
  materials: 'expense:materials',
  transport: 'expense:transport',
  disposal: 'expense:disposal',
  services: 'expense:services',
  /** wages earned by our people working for others */
  wages: 'income:wages',
  interest: 'expense:interest',
  /** interest earned (deposits) */
  interestIncome: 'income:interest',
  /** rent received for what we let, and paid for what we rent */
  rentIncome: 'income:rent',
  rentExpense: 'expense:rent',
  /** gains and losses when an asset is sold above or below its book value */
  assetGain: 'income:asset-sales',
  assetLoss: 'expense:asset-sales',
  overhead: 'expense:overhead',
  /** meals for family and friends who help (Qwen S114: booked as 'upkeep') */
  helperMeals: 'expense:helper-meals',
  /** meals bought (a canteen lunch at work) */
  food: 'expense:food',
  /** capitalised purchases (machines) */
  fixedAssets: 'asset:fixed-assets',
  /** buildings of ours, at cost less depreciation */
  buildings: 'asset:buildings',
  /** our own construction work put on the books as an asset (HGB: andere aktivierte Eigenleistungen) */
  ownWork: 'income:own-work',
  /** depreciation of buildings */
  depreciation: 'expense:depreciation',
  /** fines and costs imposed by institutions (an eviction, undeclared work found) */
  fines: 'expense:fines',
  /** what is paid to make good a harm done to another (the wood taken from their land) */
  damages: 'expense:damages',
  /** what others pay on our claims against them (damages for what they took of ours) */
  claimsIncome: 'income:claims',
} as const;
export type AccountId = (typeof ACCOUNTS)[keyof typeof ACCOUNTS];

/** the ledger account of a party's chart of accounts */
export const acct = (party: EntityId, account: AccountId): string => `${party}:${account}`;
/** the chart id of a party's account (null: not an account of the chart) */
export const chartIdOf = (party: EntityId, ledgerId: string): AccountId | null => (ledgerId.startsWith(`${party}:`) ? (ledgerId.slice(party.length + 1) as AccountId) : null);

export const EconomySettingsSchema = s.object({
  /** annual overdraft interest rate */
  overdraftRate: s.param('1/a'),
  /** annual construction price escalation (Baupreisindex trend) */
  priceEscalation: s.param('1/a'),
  /** how prices follow the construction cycle: the price level moves with activity^elasticity (needed when the world has a cycle) */
  cyclePriceElasticity: s.param('1').optional(),
});

/** a party's books: what it starts with (from its starter) */
export const BooksSchema = s.object({
  /** money brought in at the start */
  capital: s.param('EUR'),
  /** overdraft facility (Kontokorrentkredit), if the party has one */
  creditLimit: s.param('EUR').optional(),
  /** fixed overhead per calendar day, whatever the party does (a firm's office, insurance, tax adviser, chamber), if any */
  dailyOverhead: s.param('EUR/d').optional(),
});
export type Books = Infer<typeof BooksSchema>;

/** the law on insolvency of a place (law pack): when a party unable to pay is brought before the court, and what follows */
export const InsolvencyLawSchema = s.object({
  /** the kinds of party bound to file when unable to pay (legal persons); others only file for themselves */
  filingDuty: s.array(s.string()),
  /** days unable to pay (cash beyond the credit line) before a petition is filed */
  filingDays: s.param('d'),
  /** days from the petition to the court's decision (the preliminary proceedings) */
  openingDays: s.param('d'),
  /** the longest notice the administrator has to keep to for employees and leases (days) */
  maxNotice: s.param('d'),
  /** what an administrator asks for a machine sold to wind up, as a share of what the market values it at */
  liquidationShare: s.param('1'),
  /** the court that decides (a label) and the rules, for messages */
  court: s.string(),
  rule: s.string(),
});
export type InsolvencyLaw = Infer<typeof InsolvencyLawSchema>;

/** where a party stands with the insolvency court */
export interface Insolvency {
  stage: 'filed' | 'opened';
  filedAt: number;
  /** when the court decides (filed) */
  decideAt: number;
  openedAt?: number;
}
export type EconomySettings = Infer<typeof EconomySettingsSchema>;

export interface PricesPort {
  /** multiplicative price index relative to the scenario epoch: the trend, and the construction cycle of now (the coming months are not known) */
  index(t: number): number;
  /** can the party spend this amount now without exceeding its credit line? */
  canSpend(party: EntityId, amount: number): boolean;
  /** the party's cash + unused credit */
  liquidity(party: EntityId): number;
  /** does the party keep books? */
  hasBooks(party: EntityId): boolean;
  /** is the party being wound up (insolvency proceedings opened: an administrator acts for it)? */
  windingUp(party: EntityId): boolean;
  /** the parties being wound up */
  woundUp(): EntityId[];
  /** is a petition for insolvency against the party before the court, or proceedings opened (no bank lends then)? */
  beforeCourt(party: EntityId): boolean;
}

declare module '../../kernel/src/index.ts' {
  interface PortTypes {
    prices: PricesPort;
  }
  interface ContributionTypes {
    /** where a party's money could come from when it is short (what its agreements release, what is on offer to borrow) */
    financing: (read: import('../../kernel/src/index.ts').ReadCtx, holder: EntityId, need: number, opts?: { liquidCounted?: boolean }) => import('../../kernel/src/index.ts').Remedy[];
    /** money of a party it can draw on at once besides its cash (a call deposit): it counts toward being able to pay */
    liquidFunds: (read: import('../../kernel/src/index.ts').ReadCtx, holder: EntityId) => number;
  }
  interface DataTypes {
    economySettings: EconomySettings;
    insolvencyLaw?: InsolvencyLaw;
  }
  interface EventTypes {
    /** a party unable to pay is before the insolvency court */
    'economy.insolvencyFiled': { party: EntityId; decideAt: number };
    /** proceedings opened: the administrator winds the party up (each module for what it holds) */
    'economy.insolvencyOpened': { party: EntityId };
  }
  interface CommandTypes {
    'economy.grant': { payload: { party: string; amount: number; memo: string }; result: void };
    'economy.openBooks': { payload: { party: string; books: Books }; result: void };
  }
}

/** Ledger account kinds of the chart of accounts (opened by the economy module at setup). */
export const ACCOUNT_KINDS: Record<AccountId, 'asset' | 'liability' | 'equity' | 'income' | 'expense'> = {
  cash: 'asset',
  'equity:capital': 'equity',
  'income:grants': 'income',
  'income:sales': 'income',
  'income:wages': 'income',
  'expense:labour': 'expense',
  'expense:equipment-owning': 'expense',
  'expense:equipment-repair': 'expense',
  'expense:equipment-rental': 'expense',
  'expense:fuel': 'expense',
  'expense:materials': 'expense',
  'expense:transport': 'expense',
  'expense:disposal': 'expense',
  'expense:services': 'expense',
  'expense:interest': 'expense',
  'income:interest': 'income',
  'income:asset-sales': 'income',
  'income:rent': 'income',
  'expense:rent': 'expense',
  'expense:asset-sales': 'expense',
  'expense:overhead': 'expense',
  'expense:helper-meals': 'expense',
  'expense:food': 'expense',
  'asset:fixed-assets': 'asset',
  'asset:buildings': 'asset',
  'income:own-work': 'income',
  'expense:depreciation': 'expense',
  'expense:fines': 'expense',
  'expense:damages': 'expense',
  'income:claims': 'income',
};

/** Economy module state: every party's books and their month-by-month movements (the ledger itself is not visible to projections). */
export interface EconomyState {
  /** party → its books' terms, and whether its cash is below −creditLimit (warned once per crossing) */
  books: Record<string, { creditLimit: number; dailyOverhead: number; overLimit: boolean; overdrawn?: boolean; overSince?: number; insolvency?: Insolvency }>;
  /** balances of every account at the last daily close (23:59:59) */
  closed: Record<string, number>;
  /** 'YYYY-MM' → ledger account → net movement (debit positive: expenses/assets up, income/equity down) */
  months: Record<string, Record<string, number>>;
}

export interface CashflowMonth {
  month: string;
  /** account → net movement in EUR (expense/asset accounts positive when they grow); an agreement's own account (a deposit, a loan) by its id */
  byAccount: Record<string, number>;
  /** expense and income totals (income as a positive number) */
  expenses: number;
  income: number;
  /** net change of cash */
  cash: number;
}

export interface EconomySummary {
  party: string;
  cash: number;
  creditLimit: number;
  liquidity: number;
  priceIndex: number;
  fixedAssets: number;
  totalExpenses: number;
  totalIncome: number;
  /** everything we hold: cash (negative: overdraft), fixed assets, deposits and other agreement balances */
  assets: number;
  /** everything we owe through agreements (loans …) */
  liabilities: number;
  /** assets − liabilities */
  netWorth: number;
  accounts: { id: string; label: string; kind: string; balance: number }[];
  /** the construction market this month against normal (1), and three months before (absent: the world has no construction cycle) */
  market?: { month: string; level: number; threeMonthsAgo: number; source: string };
}

declare module '../../kernel/src/index.ts' {
  interface ModuleStateTypes {
    economy: EconomyState;
  }
}
