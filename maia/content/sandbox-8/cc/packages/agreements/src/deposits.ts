/**
 * Bank deposits, the first instruments: a call deposit (Tagesgeld: interest accrued daily,
 * credited monthly, withdrawal any day or after a notice period) and a term deposit (Festgeld:
 * fixed until maturity, interest with the principal at maturity). Interest is act/365.
 */
import { DAY, defineModule, type EntityId, type ReadCtx } from '../../kernel/src/index.ts';
import { ACCOUNTS, acct } from '../../economy/src/index.ts';
import type { Instrument, InstrumentCtx } from './contract.ts';

const YEAR_DAYS = 365;
const round2 = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => `${round2(x).toFixed(2)} EUR`;
const pct = (r: number) => `${(r * 100).toFixed(2)} %`;
const monthOf = (read: ReadCtx, t: number) => {
  const c = read.calendar.at(t);
  return c.year * 12 + c.month;
};

/** interest on the balance from the last accrual until now, at the agreement's rate */
function accrue(i: InstrumentCtx): void {
  const a = i.agreement();
  const from = Number(a.state.accruedTo ?? a.start);
  const now = i.ctx.now;
  if (now <= from) return;
  const interest = (i.balance() * Number(a.terms.rate) * (now - from)) / (YEAR_DAYS * DAY);
  i.setState({ accrued: Number(a.state.accrued ?? 0) + interest, accruedTo: now });
}

/** the bank credits what has accrued (whole cents; the rest keeps accruing) */
function credit(i: InstrumentCtx, label: string): void {
  const accrued = Number(i.agreement().state.accrued ?? 0);
  const cents = Math.floor(accrued * 100) / 100;
  if (cents <= 0) return;
  i.owe({ kind: 'interest', label, due: i.ctx.now, amount: cents, payer: 'party', from: i.accounts.interestIncome, to: i.agreement().account! });
  i.setState({ accrued: accrued - cents });
}

/** a deposit is our own money: what is in the bank account, not the credit line */
function ownMoney(read: ReadCtx, holder: EntityId, amount: number | undefined): { code: string; params: Record<string, string | number> } | null {
  const cash = read.balance(acct(holder, ACCOUNTS.cash));
  return amount !== undefined && cash < amount ? { code: 'agreements.notEnoughCash', params: { cash: Math.round(Math.max(0, cash)), amount } } : null;
}

/** money withdrawn but not yet paid out (a notice period runs) */
const pendingOut = (i: InstrumentCtx) => i.agreement().open.filter((o) => o.kind === 'withdrawal').reduce((s, o) => s + o.amount - o.paid, 0);

export const callDeposit: Instrument = {
  id: 'callDeposit',
  label: 'Call deposit',
  description: 'Money at the bank earning interest, accrued daily and credited monthly; it can be withdrawn any day, or after a notice period.',
  roles: ['depositor'],
  terms: {
    rate: { label: 'interest rate', unit: '1/a' },
    withdrawalNotice: { label: 'notice for a withdrawal', unit: 'd', optional: true },
  },
  balance: 'asset',
  takesAmount: true,
  cashOut: 'withdraw',
  check: (read, holder, _terms, amount) => ownMoney(read, holder, amount),
  start(i) {
    const a = i.agreement();
    const cash = i.ctx.balance(i.accounts.cash);
    if (cash < a.amount!) i.refuse('agreements.notEnoughCash', { cash: Math.round(Math.max(0, cash)), amount: a.amount! });
    i.move(i.accounts.cash, a.account!, a.amount!, `${a.label}: paid in`);
    i.setState({ accrued: 0, accruedTo: i.ctx.now, creditedMonth: monthOf(i.ctx, i.ctx.now) });
  },
  settle(i) {
    accrue(i);
    // interest is credited at the turn of each month
    const month = monthOf(i.ctx, i.ctx.now);
    if (month !== Number(i.agreement().state.creditedMonth)) {
      credit(i, 'interest');
      i.setState({ creditedMonth: month });
    }
  },
  actions: {
    payIn: {
      label: 'Pay in',
      description: 'Move money from the bank account into the deposit (own money only, not the credit line).',
      amount: true,
      run(i, amount) {
        const cash = i.ctx.balance(i.accounts.cash);
        if (cash < amount!) i.refuse('agreements.notEnoughCash', { cash: Math.round(Math.max(0, cash)), amount: amount! });
        i.move(i.accounts.cash, i.agreement().account!, amount!, `${i.agreement().label}: paid in`);
        // (said: the money is in the deposit, ours, not spent; Qwen S514)
        const notice = Number(i.agreement().terms.withdrawalNotice ?? 0);
        i.ctx.log('info', `${i.agreement().label}: ${money(amount!)} paid in from the bank account; ${money(i.balance())} in it now, ours to withdraw ${notice > 0 ? `after ${notice} days' notice` : 'any day'}.`, [i.id]);
      },
    },
    withdraw: {
      label: 'Withdraw',
      description: 'Move money back to the bank account: today, or after the notice period of the deposit.',
      amount: true,
      run(i, amount) {
        const a = i.agreement();
        const available = round2(i.balance() - pendingOut(i));
        if (amount! > available + 1e-9) i.refuse('agreements.overdrawn', { agreement: a.label, available });
        const notice = Number(a.terms.withdrawalNotice ?? 0);
        i.owe({ kind: 'withdrawal', label: 'withdrawal', due: i.ctx.now + notice * DAY, amount: amount!, payer: 'party', from: a.account!, to: i.accounts.cash });
      },
    },
  },
  notice(i) {
    return i.ctx.now + Number(i.agreement().terms.withdrawalNotice ?? 0) * DAY;
  },
  close(i) {
    credit(i, 'interest to the close');
    // withdrawals still under notice are paid out now, with everything else
    i.patch({ open: i.agreement().open.map((o) => (o.kind === 'withdrawal' && o.due > i.ctx.now ? { ...o, due: i.ctx.now } : o)) });
    const interest = i.agreement().open.filter((o) => o.kind === 'interest').reduce((s, o) => s + o.amount - o.paid, 0);
    const a = i.agreement();
    i.owe({ kind: 'payout', label: 'paid out at the close', due: i.ctx.now, amount: round2(i.balance() + interest - pendingOut(i)), payer: 'party', from: a.account!, to: i.accounts.cash });
  },
  describe(read, a, balance) {
    const notice = Number(a.terms.withdrawalNotice ?? 0);
    return `${money(balance)} at ${pct(Number(a.terms.rate))} a year; interest credited monthly${a.status === 'active' ? ` (${money(Number(a.state.accrued ?? 0))} accrued)` : ''}; withdrawals ${notice > 0 ? `after ${notice} days' notice` : 'any day'}.`;
  },
};

export const termDeposit: Instrument = {
  id: 'termDeposit',
  label: 'Term deposit',
  description: 'Money fixed at the bank for a term at a fixed rate: it cannot be touched before maturity, then the principal and the interest come back.',
  roles: ['depositor'],
  terms: {
    rate: { label: 'interest rate', unit: '1/a' },
    term: { label: 'term', unit: 'd' },
  },
  balance: 'asset',
  takesAmount: true,
  check: (read, holder, _terms, amount) => ownMoney(read, holder, amount),
  start(i) {
    const a = i.agreement();
    const cash = i.ctx.balance(i.accounts.cash);
    if (cash < a.amount!) i.refuse('agreements.notEnoughCash', { cash: Math.round(Math.max(0, cash)), amount: a.amount! });
    i.move(i.accounts.cash, a.account!, a.amount!, `${a.label}: paid in`);
    i.patch({ end: i.ctx.calendar.startOfDay(i.ctx.now) + Number(a.terms.term) * DAY });
  },
  settle() {
    // nothing happens before maturity
  },
  actions: {
    withdraw: {
      label: 'Withdraw',
      description: 'Not possible before maturity (the money is fixed for the term).',
      amount: true,
      run(i) {
        i.refuse('agreements.locked', { agreement: i.agreement().label, until: i.ctx.calendar.format(i.agreement().end!, 'day') });
      },
    },
  },
  notice(i) {
    return i.refuse('agreements.locked', { agreement: i.agreement().label, until: i.ctx.calendar.format(i.agreement().end!, 'day') });
  },
  close(i) {
    const a = i.agreement();
    const interest = round2((a.amount! * Number(a.terms.rate) * Number(a.terms.term)) / YEAR_DAYS);
    i.owe({ kind: 'interest', label: 'interest at maturity', due: i.ctx.now, amount: interest, payer: 'party', from: i.accounts.interestIncome, to: a.account! });
    i.owe({ kind: 'payout', label: 'repaid at maturity', due: i.ctx.now, amount: round2(i.balance() + interest), payer: 'party', from: a.account!, to: i.accounts.cash });
  },
  describe(read, a, balance) {
    const interest = round2(((a.amount ?? 0) * Number(a.terms.rate) * Number(a.terms.term)) / YEAR_DAYS);
    return `${money(balance || (a.amount ?? 0))} fixed${a.end !== undefined ? ` until ${read.calendar.format(a.end, 'day')}` : ` for ${a.terms.term} days`} at ${pct(Number(a.terms.rate))} a year: ${money(interest)} interest at maturity.`;
  },
};

/** bank deposits, contributed to the agreements' instruments */
export const depositsModule = defineModule({
  id: 'deposits',
  label: 'Bank deposits',
  description: 'Call and term deposits as agreement instruments.',
  requires: ['agreements'],
  contributes: { instruments: () => [callDeposit, termDeposit] },
});
