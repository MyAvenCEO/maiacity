/**
 * Economy module: opens a party's chart of accounts when it gets books (decision 0025), posts its
 * starting capital, charges overdraft interest and overhead daily, and keeps month-by-month
 * account movements for the cash-flow projection (projections only see balances, not ledger
 * entries).
 */
import { command, DAY, defineModule, s, type EntityId, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';
import { endedBlock } from '../../parties/src/index.ts';
import {
  ACCOUNT_KINDS,
  ACCOUNTS,
  acct,
  BooksSchema,
  chartIdOf,
  EconomySettingsSchema,
  InsolvencyLawSchema,
  type AccountId,
  type CashflowMonth,
  type EconomyState,
  type EconomySummary,
  type InsolvencyLaw,
  type PricesPort,
} from './contract.ts';

export const ACCOUNT_LABELS: Record<AccountId, string> = {
  cash: 'Cash (bank account)',
  'equity:capital': 'Equity capital',
  'income:grants': 'Grants & subsidies',
  'income:sales': 'Sales revenue',
  'income:wages': 'Wages earned (our people working for others)',
  'expense:labour': 'Labour (wages incl. employer costs)',
  'expense:equipment-owning': 'Equipment owning (depreciation & interest)',
  'expense:equipment-repair': 'Equipment repair & breakdowns',
  'expense:equipment-rental': 'Equipment rental',
  'expense:fuel': 'Diesel',
  'expense:materials': 'Materials',
  'expense:transport': 'Transport',
  'expense:disposal': 'Disposal fees',
  'expense:services': 'Services',
  'expense:interest': 'Interest paid (overdraft, loans)',
  'income:interest': 'Interest earned (deposits)',
  'income:asset-sales': 'Gains on assets sold',
  'income:rent': 'Rent received',
  'expense:rent': 'Rent paid',
  'expense:asset-sales': 'Losses on assets sold',
  'expense:overhead': 'Overhead (office, insurance, adviser, chamber)',
  'expense:helper-meals': 'Meals for helpers',
  'expense:food': 'Meals bought',
  'asset:fixed-assets': 'Fixed assets (machines)',
  'asset:buildings': 'Buildings (at cost less depreciation)',
  'income:own-work': 'Own construction work capitalised',
  'expense:depreciation': 'Depreciation of buildings',
  'expense:fines': 'Fines and costs imposed (evictions, penalties)',
  'expense:damages': 'Damages paid to others (wood taken from their land)',
  'income:claims': 'Paid to us on our claims (damages)',
};

/** Days per year used for the daily overdraft interest (bank convention act/365). */
const INTEREST_DAYS_PER_YEAR = 365;
/** Julian year in seconds — the unit 'a' of the escalation rate. */
const YEAR_S = 365.25 * DAY;

const round2 = (x: number) => Math.round(x * 100) / 100;

function monthKey(ctx: ReadCtx, t: number): string {
  const c = ctx.calendar.at(t);
  return `${c.year}-${String(c.month).padStart(2, '0')}`;
}

function booksOf(ctx: ReadCtx, party: EntityId) {
  const b = ctx.state('economy').books[party];
  if (!b) throw new Error(`economy: ${party} keeps no books`);
  return b;
}

/** every chart account of every party with books */
function balances(ctx: ReadCtx): Record<string, number> {
  const out: Record<string, number> = {};
  for (const party of Object.keys(ctx.state('economy').books)) {
    for (const id of Object.values(ACCOUNTS)) out[acct(party, id)] = ctx.balance(acct(party, id));
    // and the accounts its agreements keep for it (a deposit, a loan), under the party: money paid into a deposit is
    // there, not gone (Qwen S514: cash fell by 13,617 € in a month with nothing to show where it went)
    for (const a of ctx.accounts(party)) if (!a.id.startsWith(`${party}:`)) out[`${party}:${a.id}`] = a.balance;
  }
  return out;
}

/** Month table including the still-open movements since the last daily close. */
function monthsWithOpen(ctx: ReadCtx): Record<string, Record<string, number>> {
  const st = ctx.state('economy');
  const months: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(st.months)) months[k] = { ...v };
  const key = monthKey(ctx, ctx.now);
  const cur = (months[key] ??= {});
  for (const [id, bal] of Object.entries(balances(ctx))) {
    const d = round2(bal - (st.closed[id] ?? 0));
    if (d !== 0) cur[id] = round2((cur[id] ?? 0) + d);
  }
  return months;
}

/** one party's month: its chart accounts' movements */
function toCashflow(party: EntityId, month: string, all: Record<string, number>): CashflowMonth {
  const byAccount: Record<string, number> = {};
  let expenses = 0;
  let income = 0;
  for (const [id, v] of Object.entries(all)) {
    const chart = chartIdOf(party, id);
    if (!chart) continue;
    byAccount[chart] = v;
    const kind = ACCOUNT_KINDS[chart];
    if (kind === 'expense') expenses += v;
    else if (kind === 'income') income -= v;
  }
  return { month, byAccount, expenses: round2(expenses), income: round2(income), cash: byAccount[ACCOUNTS.cash] ?? 0 };
}

/** the price level from the construction cycle: busier markets charge more (1 without a cycle in the world) */
function cycleFactor(ctx: ReadCtx): number {
  if (!ctx.hasPort('constructionCycle')) return 1;
  const e = ctx.data('economySettings').cyclePriceElasticity;
  if (!e) throw new Error('economy: the world has a construction cycle but no economySettings.cyclePriceElasticity');
  return ctx.port('constructionCycle').current().level ** e.value;
}

function market(ctx: ReadCtx): NonNullable<EconomySummary['market']> {
  const cycle = ctx.port('constructionCycle');
  const now = cycle.current();
  const h = cycle.history(4);
  return { month: now.month, level: now.level, threeMonthsAgo: h[0]!.level, source: `${now.provenance.kind}: ${now.provenance.source}${now.provenance.note ? ` (${now.provenance.note})` : ''}` };
}

function pricesPort(ctx: ReadCtx): PricesPort {
  const settings = () => ctx.data('economySettings');
  return {
    index: (t) => (1 + settings().priceEscalation.value) ** (t / YEAR_S) * cycleFactor(ctx),
    canSpend: (party, amount) => ctx.balance(acct(party, ACCOUNTS.cash)) - amount >= -booksOf(ctx, party).creditLimit - 1e-9,
    liquidity: (party) => ctx.balance(acct(party, ACCOUNTS.cash)) + booksOf(ctx, party).creditLimit,
    hasBooks: (party) => Boolean(ctx.state('economy').books[party]),
    windingUp: (party) => ctx.state('economy').books[party]?.insolvency?.stage === 'opened',
    beforeCourt: (party) => ctx.state('economy').books[party]?.insolvency !== undefined,
    woundUp: () => Object.entries(ctx.state('economy').books).filter(([, b]) => b.insolvency?.stage === 'opened').map(([p]) => p),
  };
}

/** Convenience for other modules: a party pays out of its cash, booked to one of its accounts. */
export function pay(ctx: WriteCtx, party: EntityId, to: AccountId, amount: number, memo: string, refs?: string[]): void {
  if (!(amount > 0)) return;
  const entry: Parameters<WriteCtx['ledger']['post']>[0] = { from: acct(party, ACCOUNTS.cash), to: acct(party, to), amount, memo, category: to };
  if (refs?.length) entry.refs = refs;
  ctx.ledger.post(entry);
}

/** Convenience for other modules: a party is paid into its cash, booked from one of its accounts. */
export function receive(ctx: WriteCtx, party: EntityId, from: AccountId, amount: number, memo: string, refs?: string[]): void {
  if (!(amount > 0)) return;
  const entry: Parameters<WriteCtx['ledger']['post']>[0] = { from: acct(party, from), to: acct(party, ACCOUNTS.cash), amount, memo, category: from };
  if (refs?.length) entry.refs = refs;
  ctx.ledger.post(entry);
}

/** the party whose summary or cash flow is asked for (a projection argument) */
function partyArg(ctx: ReadCtx, args: Record<string, unknown>): EntityId {
  const party = args.party;
  if (typeof party !== 'string' || !ctx.state('economy').books[party]) throw new Error(`economy: name a party that keeps books (args.party); these do: ${Object.keys(ctx.state('economy').books).join(', ')}`);
  return party;
}

/**
 * Unable to pay (§ 17 InsO): cash beyond the credit line, day after day. After the law's days a petition
 * is filed (the debtor's duty, or the bank as creditor) and the bank ends the line; the court decides
 * after its days: able to pay again (cash not below nothing), the petition is dismissed; else proceedings
 * open and the administrator winds the party up (each module for what it holds).
 */
/** where the money to pay could come from (what the modules offer: drawing on deposits, selling, borrowing) */
const moneyIn = (ctx: ReadCtx, party: EntityId, need: number) => (need > 0 ? ctx.contributions('financing').flatMap((c) => c.impl(ctx, party, need, { liquidCounted: true })) : []);

function insolvency(ctx: WriteCtx, party: EntityId, over: boolean, cash: number, law: InsolvencyLaw): void {
  const b = ctx.state('economy').books[party]!;
  const label = ctx.port('parties').get(party)?.label ?? party;
  const put = (next: Partial<typeof b>, drop: (keyof typeof b)[] = []) => {
    const st = ctx.state('economy');
    const was = { ...st.books[party]!, ...next };
    for (const k of drop) delete was[k];
    ctx.patchState('economy', { books: { ...st.books, [party]: was } });
  };
  const i = b.insolvency;
  if (!i) {
    if (!over) {
      if (b.overSince !== undefined) put({}, ['overSince']);
      return;
    }
    const since = b.overSince ?? ctx.now;
    if (b.overSince === undefined) put({ overSince: since });
    if (ctx.now - since < law.filingDays.value * DAY - 1) return;
    const decideAt = ctx.calendar.startOfDay(ctx.now) + Math.ceil(law.openingDays.value) * DAY;
    // the bank ends the line it gave (it will not lend into an insolvency)
    put({ insolvency: { stage: 'filed', filedAt: ctx.now, decideAt }, creditLimit: 0 }, ['overSince']);
    ctx.blockers.set(party, [{ code: 'economy.insolvencyFiled', severity: 'block', params: { party: label, court: law.court, date: ctx.calendar.format(decideAt, 'day'), cash: Math.round(cash) }, remedies: moneyIn(ctx, party, -cash) }]);
    ctx.log('error', `${label} has been unable to pay its debts for ${law.filingDays.value} days: the bank ends its credit line, and a petition for insolvency is filed with ${law.court} (${law.rule}). The court decides on ${ctx.calendar.format(decideAt, 'day')}; until then, paying in what is owed (cash not below nothing) ends it.`, [party]);
    ctx.emit('economy.insolvencyFiled', { party, decideAt });
    return;
  }
  if (i.stage !== 'filed') return;
  ctx.blockers.set(party, [{ code: 'economy.insolvencyFiled', severity: 'block', params: { party: label, court: law.court, date: ctx.calendar.format(i.decideAt, 'day'), cash: Math.round(cash) }, remedies: moneyIn(ctx, party, -cash) }]);
  if (ctx.now < i.decideAt) return;
  ctx.blockers.clear(party);
  if (cash >= 0) {
    put({}, ['insolvency']);
    ctx.log('info', `${law.court} dismisses the petition against ${label}: it can pay its debts again. Its bank gives no new credit line.`, [party]);
    return;
  }
  put({ insolvency: { ...i, stage: 'opened', openedAt: ctx.now } });
  ctx.log('error', `${law.court} opens insolvency proceedings against ${label} (cash ${Math.round(cash)} EUR): an administrator takes over its affairs and winds it up (${law.rule}).`, [party]);
  ctx.emit('economy.insolvencyOpened', { party });
}

export const economyModule = defineModule({
  id: 'economy',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Agreement', 'Employment', 'Helper', 'Machine', 'Person', 'Presence', 'Tenure'],
  label: 'Economy',
  description: "Every party's books: capital, overdraft & interest, overhead; the price index; cash flow.",
  provides: ['prices'],
  requires: ['parties'],
  optional: ['constructionCycle'],
  data: { economySettings: EconomySettingsSchema, insolvencyLaw: InsolvencyLawSchema.optional() },
  events: { 'economy.insolvencyFiled': s.object({ party: s.string(), decideAt: s.number() }), 'economy.insolvencyOpened': s.object({ party: s.string() }) },
  contributes: {
    // opened proceedings: the administrator holds the power to act for the party (§ 80 InsO)
    cannotAct: () => (read: ReadCtx, party: EntityId) => {
      const i = read.state('economy').books[party]?.insolvency;
      return i?.stage === 'opened' ? `insolvency proceedings were opened on ${read.calendar.format(i.openedAt!, 'day')}; the administrator acts for it and winds it up` : null;
    },
  },
  state: {
    initial: (): EconomyState => ({ books: {}, closed: {}, months: {} }),
  },
  blockers: {
    'economy.creditExceeded': 'Credit line exceeded: cash {cash} EUR below the limit of −{limit} EUR',
    'economy.hasBooks': '{party} already keeps books',
    'economy.insolvencyFiled': '{party} cannot pay its debts as they fall due: {court} decides on {date} whether to open insolvency proceedings, unless it can pay again by then (cash {cash} EUR)',
  },
  commands: {
    'economy.openBooks': command(
      s.object({ party: s.ref('party'), books: BooksSchema }),
      (ctx, p) => {
        ctx.port('parties').require(p.party, 'economy.openBooks');
        if (ctx.state('economy').books[p.party]) ctx.reject('economy.hasBooks', { party: p.party });
        for (const id of Object.values(ACCOUNTS)) ctx.ledger.open(acct(p.party, id), { label: ACCOUNT_LABELS[id], kind: ACCOUNT_KINDS[id], unit: 'EUR', holder: p.party });
        const st = ctx.state('economy');
        ctx.patchState('economy', { books: { ...st.books, [p.party]: { creditLimit: p.books.creditLimit?.value ?? 0, dailyOverhead: p.books.dailyOverhead?.value ?? 0, overLimit: false } } });
        receive(ctx, p.party, ACCOUNTS.capital, p.books.capital.value, 'Starting capital');
      },
      { label: 'A party starts keeping books (its starter)', internal: true },
    ),
    'economy.grant': command(
      s.object({ party: s.ref('party'), amount: s.number({ min: 0, unit: 'EUR' }), memo: s.string() }),
      (ctx, p) => {
        booksOf(ctx, p.party);
        receive(ctx, p.party, ACCOUNTS.grants, p.amount, p.memo);
      },
      { label: 'Receive a grant', internal: true },
    ),
  },
  systems: [
    {
      id: 'daily-accounting',
      every: DAY,
      phase: 'accounting',
      run(ctx) {
        const set = ctx.data('economySettings');
        const law = ctx.hasData('insolvencyLaw') ? ctx.data('insolvencyLaw') : undefined;
        for (const [party, b] of Object.entries(ctx.state('economy').books)) {
          // wound up: no overhead, no interest of its own making (the administrator's estate is not modelled)
          if (b.insolvency?.stage === 'opened') continue;
          const cash = ctx.balance(acct(party, ACCOUNTS.cash));
          if (cash < 0) pay(ctx, party, ACCOUNTS.interest, (set.overdraftRate.value / INTEREST_DAYS_PER_YEAR) * -cash, `Overdraft interest ${(set.overdraftRate.value * 100).toFixed(2)} %/a on ${(-cash).toFixed(2)} EUR`);
          // (a party that ended, nobody left of it, keeps no office: its running costs end with it, its estate owes what it
          // owes; the one check, review y)
          if (b.dailyOverhead > 0 && !endedBlock(ctx, party)) pay(ctx, party, ACCOUNTS.overhead, b.dailyOverhead, 'Overhead: office, insurance, tax adviser, chamber');
          const after = ctx.balance(acct(party, ACCOUNTS.cash));
          // drawing on its credit line, and back out of it, is said (Qwen S150: cash ran 1.3 M€ down into the line without a word)
          if (b.creditLimit > 0 && after < 0 !== Boolean(b.overdrawn)) {
            const label = ctx.port('parties').get(party)?.label ?? party;
            if (after < 0) ctx.log('warn', `${label}: the cash is used up; it now draws on its credit line (${(-after).toFixed(0)} of ${b.creditLimit.toFixed(0)} EUR, at ${(set.overdraftRate.value * 100).toFixed(2)} %/a).`, [party]);
            else ctx.log('info', `${label}: in credit again.`, [party]);
            const st = ctx.state('economy');
            ctx.patchState('economy', { books: { ...st.books, [party]: { ...st.books[party]!, overdrawn: after < 0 } } });
          }
          const over = after < -b.creditLimit;
          if (over !== b.overLimit) {
            const label = ctx.port('parties').get(party)?.label ?? party;
            const duty = law && law.filingDuty.includes(ctx.port('parties').get(party)?.kind ?? '');
            if (over) ctx.log('warn', `${label}: credit line exceeded: cash ${after.toFixed(0)} EUR, limit −${b.creditLimit.toFixed(0)} EUR${duty ? `; unable to pay for ${law!.filingDays.value} days, it comes before ${law!.court}` : ''}`, [party]);
            else ctx.log('info', `${label}: back within the credit line`, [party]);
            const st = ctx.state('economy');
            ctx.patchState('economy', { books: { ...st.books, [party]: { ...st.books[party]!, overLimit: over } } });
          }
          // (only parties bound to file: a household's debts take other ways; money it can draw on at once counts)
          if (law && law.filingDuty.includes(ctx.port('parties').get(party)?.kind ?? '')) {
            const funds = ctx.contributions('liquidFunds').reduce((a, c) => a + c.impl(ctx, party), 0);
            const b2 = ctx.state('economy').books[party]!;
            insolvency(ctx, party, after + funds < -b2.creditLimit, after + funds, law);
          }
        }
      },
    },
    {
      // closes the day's movements into the month table (all postings of a day belong to its month)
      id: 'daily-close',
      every: DAY,
      offset: DAY - 1,
      phase: 'report',
      run(ctx) {
        ctx.setState('economy', { ...ctx.state('economy'), months: monthsWithOpen(ctx), closed: balances(ctx) });
      },
    },
  ],
  ports: { prices: pricesPort },
  projections: {
    'economy.cashflow': {
      label: "A party's monthly cash flow by account",
      description: 'args: party (a party that keeps books)',
      compute(ctx, args: Record<string, unknown>) {
        const party = partyArg(ctx, args);
        const months = monthsWithOpen(ctx);
        return Object.keys(months)
          .sort()
          .map((k) => toCashflow(party, k, months[k]!));
      },
    },
    'economy.summary': {
      label: "A party's financial summary",
      description: 'args: party (a party that keeps books)',
      compute(ctx, args: Record<string, unknown>): EconomySummary {
        const party = partyArg(ctx, args);
        const b = booksOf(ctx, party);
        const cash = ctx.balance(acct(party, ACCOUNTS.cash));
        let totalExpenses = 0;
        let totalIncome = 0;
        const accounts: EconomySummary['accounts'] = [];
        let assets = 0;
        let liabilities = 0;
        // every account in the party's books, the chart's and those agreements open (a deposit, a loan)
        for (const a of ctx.accounts(party)) {
          accounts.push({ id: chartIdOf(party, a.id) ?? a.id, label: a.label, kind: a.kind, balance: a.balance });
          if (a.kind === 'expense') totalExpenses += a.balance;
          if (a.kind === 'income') totalIncome -= a.balance;
          if (a.kind === 'asset') assets += a.balance;
          if (a.kind === 'liability') liabilities -= a.balance;
        }
        return {
          party,
          cash,
          creditLimit: b.creditLimit,
          liquidity: cash + b.creditLimit,
          priceIndex: pricesPort(ctx).index(ctx.now),
          fixedAssets: ctx.balance(acct(party, ACCOUNTS.fixedAssets)),
          totalExpenses: round2(totalExpenses),
          totalIncome: round2(totalIncome),
          assets: round2(assets),
          liabilities: round2(liabilities),
          netWorth: round2(assets - liabilities),
          accounts,
          ...(ctx.hasPort('constructionCycle') ? { market: market(ctx) } : {}),
        };
      },
    },
  },
});
