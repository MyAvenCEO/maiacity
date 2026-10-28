/**
 * Loans: we borrow from a bank. The principal is paid out when the loan starts (after the bank's
 * approval time) and repaid monthly by direct debit: an annuity (equal payments), instalments
 * (equal principal plus interest) or a bullet (interest monthly, the principal at the end).
 * Interest is monthly at a twelfth of the annual rate (30/360), pro rata on early repayment.
 * The bank lends only while our debts stay within a multiple of our net worth. Payments the
 * account cannot make stay overdue; after the default period the bank calls in the whole loan.
 */
import { DAY, defineModule, type EntityId, type ReadCtx } from '../../kernel/src/index.ts';
import type { Agreement, Instrument, InstrumentCtx } from './contract.ts';

const round2 = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => `${Math.round(x)} EUR`;
const pct = (r: number) => `${(r * 100).toFixed(2)} %`;

/** the same day `k` months later (the last day of a shorter month), at its start: the calendar's one rule */
const addMonths = (read: ReadCtx, t: number, k: number): number => read.calendar.startOfDay(read.calendar.addMonths(t, k));

/** what we own less what we owe, from the books */
function netWorth(read: ReadCtx, holder: EntityId): number {
  let assets = 0;
  let liabilities = 0;
  for (const a of read.accounts(holder)) {
    if (a.kind === 'asset') assets += a.balance;
    if (a.kind === 'liability') liabilities -= a.balance;
  }
  return assets - liabilities;
}

/** what the holder owes, and what it has applied to borrow and not yet got (not counting `self`) */
function debts(read: ReadCtx, holder: EntityId, self?: string): number {
  const booked = read
    .accounts(holder)
    .filter((a) => a.kind === 'liability')
    .reduce((s, a) => s - a.balance, 0);
  let applied = 0;
  for (const [id, a] of read.all('Agreement')) if (id !== self && a.holder === holder && a.status === 'pending' && a.role === 'borrower') applied += a.amount ?? 0;
  return booked + applied;
}

/** the monthly payment of an annuity: P·r / (1 − (1 + r)^−n) */
const annuity = (principal: number, monthly: number, n: number) => (monthly > 0 ? (principal * monthly) / (1 - (1 + monthly) ** -n) : principal / n);

/** the principal due with the next payment */
function principalDue(a: Readonly<Agreement>, remaining: number, paidMonths: number): number {
  const n = Number(a.terms.months);
  const left = n - paidMonths;
  if (left <= 1) return remaining;
  const monthly = Number(a.terms.rate) / 12;
  switch (a.terms.repayment) {
    case 'bullet':
      return 0;
    case 'instalment':
      return a.amount! / n;
    default:
      return annuity(remaining, monthly, left) - remaining * monthly;
  }
}

const remainingOf = (i: InstrumentCtx) => i.balance();

/** pay off the loan now: the principal, the interest since the last payment, and the fee for repaying early */
function payOff(i: InstrumentCtx, amount: number, fee: boolean): void {
  const a = i.agreement();
  const since = Number(a.state.lastPayment ?? a.start);
  const interest = (amount * Number(a.terms.rate) * (i.ctx.now - since)) / (360 * DAY);
  i.owe({ kind: 'principal', label: 'repayment', due: i.ctx.now, amount, payer: 'holder', from: i.accounts.cash, to: a.account! });
  if (interest >= 0.01) i.owe({ kind: 'interest', label: 'interest to the day', due: i.ctx.now, amount: interest, payer: 'holder', from: i.accounts.cash, to: i.accounts.interest });
  const share = Number(a.terms.prepaymentFee ?? 0);
  if (fee && share > 0) i.owe({ kind: 'fee', label: 'prepayment fee', due: i.ctx.now, amount: amount * share, payer: 'holder', from: i.accounts.cash, to: i.accounts.interest });
}

export const loan: Instrument = {
  id: 'loan',
  label: 'Loan',
  description: 'Money borrowed from a bank: paid out when it starts, repaid monthly with interest by direct debit (annuity, instalments or at the end); early repayment costs a fee; payments not made stay overdue, and after the default period the bank calls in the whole loan.',
  roles: ['borrower'],
  terms: {
    rate: { label: 'interest rate', unit: '1/a' },
    months: { label: 'term', unit: 'mo' },
    repayment: { label: 'repayment', unit: 'choice' },
    prepaymentFee: { label: 'fee for repaying early (share of the amount)', unit: '1', optional: true },
    maxDebtToNetWorth: { label: 'the bank lends while our debts stay within this multiple of our net worth', unit: '1' },
    defaultAfter: { label: 'days overdue before the bank calls in the loan', unit: 'd' },
    defaultRate: { label: 'interest on overdue amounts', unit: '1/a', optional: true },
  },
  balance: 'liability',
  takesAmount: true,
  cashIn: true,
  check(read, holder, terms, amount, self) {
    // no bank lends to one before the insolvency court
    if (read.hasPort('prices') && read.port('prices').beforeCourt(holder)) return { code: 'agreements.beforeCourt', params: {} as Record<string, string | number> };
    const worth = netWorth(read, holder);
    const limit = Number(terms.maxDebtToNetWorth) * Math.max(0, worth);
    const owed = debts(read, holder, self);
    return owed + (amount ?? 0) > limit ? { code: 'agreements.creditRefused', params: { debts: Math.round(owed), amount: Math.round(amount ?? 0), limit: Math.round(limit), worth: Math.round(worth) } } : null;
  },
  start(i) {
    const a = i.agreement();
    if (!['annuity', 'instalment', 'bullet'].includes(String(a.terms.repayment))) throw new Error(`loan ${a.label}: repayment '${a.terms.repayment}' is not annuity, instalment or bullet`);
    // the bank pays out the principal: our cash up, our debt up
    i.move(a.account!, i.accounts.cash, a.amount!, `${a.label}: paid out`);
    i.setState({ paidMonths: 0, lastPayment: i.ctx.now, nextDue: addMonths(i.ctx, i.ctx.now, 1) });
  },
  settle(i) {
    // monthly payments, by direct debit on their due dates
    for (let guard = 0; guard < 600; guard += 1) {
      const a = i.agreement();
      const due = Number(a.state.nextDue);
      if (!(due <= i.ctx.now) || remainingOf(i) - owedPrincipal(a) <= 0.005) break;
      const remaining = remainingOf(i) - owedPrincipal(a);
      const interest = (remaining * Number(a.terms.rate)) / 12;
      const principal = Math.min(remaining, principalDue(a, remaining, Number(a.state.paidMonths)));
      const n = Number(a.state.paidMonths) + 1;
      if (interest >= 0.01) i.owe({ kind: 'interest', label: `interest, month ${n}`, due, amount: interest, payer: 'holder', from: i.accounts.cash, to: i.accounts.interest });
      if (principal >= 0.01) i.owe({ kind: 'principal', label: `repayment, month ${n}`, due, amount: principal, payer: 'holder', from: i.accounts.cash, to: a.account! });
      i.setState({ paidMonths: n, lastPayment: due, nextDue: addMonths(i.ctx, a.start, n + 1) });
    }
    // overdue principal bears default interest: accrued daily, billed at the turn of the month (or when the principal is paid)
    const od = i.agreement();
    const overdueP = od.open.filter((o) => o.payer === 'holder' && o.kind === 'principal' && o.due < i.ctx.now).reduce((s, o) => s + o.amount - o.paid, 0);
    const since = Number(od.state.defaultTo ?? i.ctx.now);
    const accrued = Number(od.state.defaultAccrued ?? 0) + (overdueP * Number(od.terms.defaultRate ?? 0) * Math.max(0, i.ctx.now - since)) / (365 * DAY);
    if (accrued >= 0.01 && (overdueP <= 0 || i.ctx.calendar.at(i.ctx.now).day === 1)) {
      i.owe({ kind: 'interest', label: 'default interest on overdue principal', due: i.ctx.now, amount: accrued, payer: 'holder', from: i.accounts.cash, to: i.accounts.interest });
      i.setState({ defaultAccrued: 0, defaultTo: i.ctx.now });
    } else i.setState({ defaultAccrued: accrued, defaultTo: i.ctx.now });
    // overdue too long: the bank calls in what is left
    const a = i.agreement();
    const overdue = a.open.filter((o) => o.payer === 'holder' && o.due < i.ctx.now - Number(a.terms.defaultAfter) * DAY);
    if (overdue.length && !a.state.calledIn) {
      const rest = round2(remainingOf(i) - owedPrincipal(a));
      if (rest > 0) i.owe({ kind: 'principal', label: 'loan called in (payments overdue)', due: i.ctx.now, amount: rest, payer: 'holder', from: i.accounts.cash, to: a.account! });
      i.setState({ calledIn: true });
      i.ctx.log('error', `${a.label}: payments overdue for more than ${a.terms.defaultAfter} days — the bank calls in the loan (${money(remainingOf(i))} due now).`, [i.id]);
    }
    // repaid in full: it ends
    if (remainingOf(i) <= 0.005 && !i.agreement().open.length && i.agreement().end === undefined) i.patch({ end: i.ctx.now });
  },
  actions: {
    repay: {
      label: 'Repay early',
      description: 'Pay back part of the principal now, with the interest to the day and the prepayment fee; the monthly payments shrink accordingly (the term stays).',
      amount: true,
      run(i, amount) {
        const outstanding = round2(remainingOf(i) - owedPrincipal(i.agreement()));
        if (amount! > outstanding + 0.005) i.refuse('agreements.overRepaid', { agreement: i.agreement().label, outstanding });
        if (!i.ctx.port('prices').canSpend(i.holder, amount!)) i.refuse('agreements.notEnoughCash', { cash: Math.round(Math.max(0, i.ctx.balance(i.accounts.cash))), amount: amount! });
        payOff(i, amount!, true);
      },
    },
  },
  notice(i) {
    // ending a loan early means repaying it all now
    const outstanding = round2(remainingOf(i) - owedPrincipal(i.agreement()));
    if (!i.ctx.port('prices').canSpend(i.holder, outstanding * 1.05)) i.refuse('agreements.notEnoughCash', { cash: Math.round(Math.max(0, i.ctx.balance(i.accounts.cash))), amount: Math.round(outstanding) });
    return i.ctx.now;
  },
  windUp(i) {
    // the borrower in insolvency proceedings: the bank calls in what is left (it is a claim in the proceedings)
    const a = i.agreement();
    if (a.state.calledIn) return;
    const rest = round2(remainingOf(i) - owedPrincipal(a));
    if (rest > 0) i.owe({ kind: 'principal', label: 'loan called in (insolvency proceedings)', due: i.ctx.now, amount: rest, payer: 'holder', from: i.accounts.cash, to: a.account! });
    i.setState({ calledIn: true });
    i.ctx.log('error', `${a.label}: the borrower is in insolvency proceedings — the bank calls in the loan (${money(remainingOf(i))} due now).`, [i.id]);
  },
  close(i) {
    const outstanding = round2(remainingOf(i) - owedPrincipal(i.agreement()));
    if (outstanding > 0.005) payOff(i, outstanding, true);
  },
  describe(read, a, balance) {
    const left = Number(a.terms.months) - Number(a.state.paidMonths ?? 0);
    return `${money(balance)} owed of ${money(a.amount ?? 0)} at ${pct(Number(a.terms.rate))} a year, ${a.terms.repayment}; ${a.status === 'active' ? `${left} monthly payments left, next ${read.calendar.format(Number(a.state.nextDue), 'day')}` : a.status}${a.state.calledIn ? '; called in by the bank' : ''}.`;
  },
};

/** principal already owed (due, not yet paid) */
function owedPrincipal(a: Readonly<Agreement>): number {
  return a.open.filter((o) => o.kind === 'principal').reduce((s, o) => s + o.amount - o.paid, 0);
}

/** loans, contributed to the agreements' instruments */
export const loansModule = defineModule({
  id: 'loans',
  label: 'Loans',
  description: 'Bank loans as agreement instruments.',
  requires: ['agreements'],
  contributes: { instruments: () => [loan] },
});
