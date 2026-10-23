/**
 * Leases: something let for money, in either direction (we let as lessor, or rent as lessee) and
 * for any length: a booking for a day, a fixed term, or an open-ended let that ends with notice.
 * Rent is due in advance each period (a month or a day). A deposit is held by the lessor and paid
 * back at the end. When we let, the tenant's behaviour comes with the agreement (from the
 * tenant-demand model): how long they stay before giving notice, and how often they pay late.
 */
import { DAY, defineModule, type ReadCtx } from '../../kernel/src/index.ts';
import { ACCOUNTS, acct } from '../../economy/src/index.ts';
import type { Agreement, Instrument, InstrumentCtx } from './contract.ts';

const money = (x: number) => `${Math.round(x)} EUR`;

/** the same day `k` months later (the last day of a shorter month): the calendar's one rule */
export const addMonths = (read: ReadCtx, t: number, k: number): number => read.calendar.addMonths(t, k);

/** the start of rent period k (0: the first) */
const periodStart = (read: ReadCtx, a: Readonly<Agreement>, k: number) => (a.terms.period === 'day' ? a.start + k * DAY : addMonths(read, a.start, k));

const weLet = (a: Readonly<Agreement>) => a.role === 'lessor';

/** what the lessee books the rent as, when the product says (a pass as transport); else rent */
const bookedAs = (i: InstrumentCtx): string | undefined => {
  const a = i.agreement();
  const key = a.terms.expense;
  if (weLet(a) || typeof key !== 'string') return undefined;
  if (!(key in i.accounts)) throw new Error(`lease ${a.label}: expense '${key}' is not an account of the chart`);
  return i.accounts[key as keyof typeof i.accounts];
};

/** rent and deposit move between us and them: who pays, from where to where */
function owePayment(i: InstrumentCtx, kind: string, label: string, due: number, amount: number, toUs: boolean, account?: string): void {
  // (a let for nothing but what is taken from it: no rent to owe)
  if (!(amount > 0)) return;
  const a = i.agreement();
  if (toUs) {
    // the other side pays: late now and then, as their behaviour says (the world knows when, the players do not)
    const b = i.hidden().behaviour ?? {};
    const late = (b.lateShare ?? 0) > 0 && i.ctx.rng('tenants').chance(b.lateShare!);
    const paysAt = late ? Math.round(due + i.ctx.rng('tenants').exponential((b.lateDays ?? 0) * DAY)) : undefined;
    i.owe({ kind, label, due, amount, payer: 'party', from: account ?? i.accounts.rentIncome, to: i.accounts.cash, ...(paysAt !== undefined ? { paysAt } : {}) });
  } else {
    // (a lessor who keeps books, another player, has it come in as rent)
    const books = a.party !== a.holder && i.ctx.port('prices').hasBooks(a.party);
    i.owe({ kind, label, due, amount, payer: 'holder', from: i.accounts.cash, to: account ?? i.accounts.rentExpense, ...(books ? { mirror: { from: acct(a.party, ACCOUNTS.rentIncome), to: acct(a.party, ACCOUNTS.cash) } } : {}) });
  }
}

/** when the other side ends a let by their own decision (drawn from the tenant's behaviour) */
function drawLeave(i: InstrumentCtx): void {
  const a = i.agreement();
  const stay = i.hidden().behaviour?.stayDays ?? 0;
  if (!weLet(a) || a.end !== undefined || !(stay > 0)) return;
  i.setHidden({ leaveAt: Math.round(i.ctx.now + i.ctx.rng('tenants').exponential(stay * DAY)) });
}

export const lease: Instrument = {
  id: 'lease',
  label: 'Lease',
  description: 'Something let for money — a home, a hall, a booking for a day, a machine — in either direction: rent due in advance each period, a deposit held by the lessor, a fixed end or notice.',
  roles: ['lessor', 'lessee'],
  terms: {
    rent: { label: 'rent per period', unit: 'EUR' },
    period: { label: 'rent period (month or day)', unit: 'choice' },
    deposit: { label: 'deposit', unit: 'EUR', optional: true },
    days: { label: 'fixed length (a booking, a fixed term)', unit: 'd', optional: true },
    tenantNotice: { label: "the lessee's notice", unit: 'd' },
    landlordNotice: { label: "the lessor's notice (none: the lessor cannot end it)", unit: 'd', optional: true },
    arrearsLimit: { label: 'rent in arrears (in rent periods) that lets the lessor end it at once', unit: '1', optional: true },
    endEarly: { label: 'the lessee may end it before its fixed end (a thing lent: given back any time)', unit: 'choice', optional: true },
    expense: { label: 'what the lessee books it as (an account of the chart; without it, rent)', unit: 'choice', optional: true },
    royalty: { label: 'paid by the tonne of what is taken from it (wood felled, stone quarried), billed by whoever measures the taking', unit: 'EUR/t', optional: true },
  },
  balance: (role) => (role === 'lessor' ? 'liability' : 'asset'),
  tenure: (role) => (role === 'lessor' ? 'leaseOut' : role === 'lessee' ? 'leaseIn' : undefined),
  takesAmount: false,
  start(i) {
    const a = i.agreement();
    if (a.terms.period !== 'month' && a.terms.period !== 'day') throw new Error(`lease ${a.label}: period '${a.terms.period}' is not month or day`);
    const deposit = Number(a.terms.deposit ?? 0);
    // the deposit: held by the lessor, owed back at the end
    if (deposit > 0) {
      if (weLet(a)) i.owe({ kind: 'deposit', label: 'deposit', due: i.ctx.now, amount: deposit, payer: 'party', from: a.account!, to: i.accounts.cash });
      else i.owe({ kind: 'deposit', label: 'deposit', due: i.ctx.now, amount: deposit, payer: 'holder', from: i.accounts.cash, to: a.account! });
    }
    const days = Number(a.terms.days ?? 0);
    if (days > 0) i.patch({ end: i.ctx.now + days * DAY });
    // a booking of days is paid in full up front
    if (days > 0 && a.terms.period === 'day') {
      owePayment(i, 'rent', `rent for ${days} day${days > 1 ? 's' : ''}`, i.ctx.now, Number(a.terms.rent) * days, weLet(a), bookedAs(i));
      i.setState({ periods: days });
    } else i.setState({ periods: 0 });
    drawLeave(i);
  },
  settle(i) {
    // rent in advance at the start of each period
    for (let guard = 0; guard < 1000; guard += 1) {
      const a = i.agreement();
      const k = Number(a.state.periods ?? 0);
      const due = periodStart(i.ctx, a, k);
      if (due > i.ctx.now || (a.end !== undefined && due >= a.end) || (a.notice && due >= a.notice.effective)) break;
      owePayment(i, 'rent', a.terms.period === 'day' ? `rent, day ${k + 1}` : `rent, month ${k + 1}`, due, Number(a.terms.rent), weLet(a), bookedAs(i));
      i.setState({ periods: k + 1 });
    }
    // rent in arrears up to the limit: the lessor ends it at once (when we rent, our landlord does)
    const a0 = i.agreement();
    if (!weLet(a0) && !a0.notice && arrears(i.ctx, a0) >= arrearsLimit(a0)) {
      i.patch({ notice: { by: 'party', given: i.ctx.now, effective: i.ctx.now }, status: 'ending' });
      i.ctx.log('error', `${i.ctx.get('Party', a0.party)?.label ?? 'The landlord'} ends ${a0.label} at once: ${Math.round(arrears(i.ctx, a0))} EUR of rent in arrears.`, [i.id]);
    }
    // the tenant decides to leave and gives notice, to the end of a rent period
    const a = i.agreement();
    const leaveAt = i.hidden().leaveAt;
    if (weLet(a) && !a.notice && leaveAt !== undefined && leaveAt <= i.ctx.now) {
      const effective = noticeEnd(i.ctx, a, Number(a.terms.tenantNotice));
      i.patch({ notice: { by: 'party', given: i.ctx.now, effective }, status: 'ending' });
      i.ctx.log('info', `${i.ctx.get('Party', a.party)?.label ?? 'The tenant'} gives notice: ${a.label} ends ${i.ctx.calendar.format(effective, 'day')}.`, [i.id]);
    }
  },
  actions: {},
  branch(i) {
    // a fork does not know when tenants leave or how late they pay: drawn again
    const a = i.agreement();
    if (!a.notice && i.hidden().leaveAt !== undefined) drawLeave(i);
    const paysAt = i.hidden().paysAt ?? {};
    const lateDays = i.hidden().behaviour?.lateDays ?? 0;
    i.setHidden({ paysAt: Object.fromEntries(Object.entries(paysAt).map(([k, t]) => [k, t > i.ctx.now ? Math.round(i.ctx.now + i.ctx.rng('tenants').exponential(lateDays * DAY)) : t])) });
  },
  notice(i, _by, extraordinary) {
    const a = i.agreement();
    if (weLet(a)) {
      // a tenant in arrears up to the limit can be put out at once
      if (arrears(i.ctx, a) >= arrearsLimit(a)) return i.ctx.now;
      if (a.terms.landlordNotice === undefined) i.refuse('agreements.cannotEnd', { agreement: a.label, why: 'its terms give the lessor no right to give notice (only rent in arrears would)' });
      return noticeEnd(i.ctx, a, Number(a.terms.landlordNotice));
    }
    if (a.end !== undefined && a.terms.endEarly !== 'yes' && !extraordinary) i.refuse('agreements.cannotEnd', { agreement: a.label, why: `it is let for a fixed time, until ${i.ctx.calendar.format(a.end, 'day')}` });
    return noticeEnd(i.ctx, a, Number(a.terms.tenantNotice));
  },
  close(i) {
    const a = i.agreement();
    let held = i.balance();
    // rent the lessee still owes is set off against the deposit the lessor holds
    const owed = a.open.filter((o) => o.kind === 'rent' && o.payer === (weLet(a) ? 'party' : 'holder') && o.paid < o.amount);
    const open = [...a.open];
    for (const o of owed) {
      const take = Math.min(held, o.amount - o.paid);
      if (take < 0.005) break;
      // we let: the held deposit becomes rent received; we rent: our deposit becomes rent paid
      if (weLet(a)) i.move(i.accounts.rentIncome, a.account!, take, `${a.label}: ${o.label} set off against the deposit`);
      else i.move(a.account!, i.accounts.rentExpense, take, `${a.label}: ${o.label} set off against the deposit`);
      held -= take;
      const k = open.findIndex((x) => x.id === o.id);
      open[k] = { ...o, paid: o.paid + take };
    }
    i.patch({ open: open.filter((o) => o.amount - o.paid >= 0.005) });
    // a booking of days paid up front and ended before its days are up: the rent of the days not had comes back (§ 547 BGB)
    const days = Number(a.terms.days ?? 0);
    if (!weLet(a) && days > 0 && a.terms.period === 'day' && Number(a.terms.rent ?? 0) > 0) {
      const rents = i.agreement().open.filter((o) => o.kind === 'rent' && o.payer === 'holder');
      const unpaid = rents.reduce((x, o) => x + o.amount - o.paid, 0);
      const left = Math.max(0, a.start + days * DAY - i.ctx.now) / DAY;
      // the rent of the days had is owed; what is paid beyond it comes back, what is owed beyond it is let off
      const had = Number(a.terms.rent) * (days - left);
      const paid = Number(a.terms.rent) * days - unpaid;
      let cut = Math.max(0, unpaid - Math.max(0, had - paid));
      if (cut > 0.005) {
        const kept = i.agreement().open.map((o) => {
          if (cut <= 0.005 || o.kind !== 'rent' || o.payer !== 'holder') return o;
          const off = Math.min(cut, o.amount - o.paid);
          cut -= off;
          return { ...o, amount: Math.round((o.amount - off) * 100) / 100 };
        });
        i.patch({ open: kept.filter((o) => o.amount - o.paid >= 0.005) });
      }
      const back = Math.round((paid - had) * 100) / 100;
      if (back > 0.005) {
        const books = a.party !== a.holder && i.ctx.port('prices').hasBooks(a.party);
        i.owe({ kind: 'rent', label: `rent back for ${Math.round(left * 10) / 10} days not had`, due: i.ctx.now, amount: back, payer: 'party', from: bookedAs(i) ?? i.accounts.rentExpense, to: i.accounts.cash, ...(books ? { mirror: { from: acct(a.party, ACCOUNTS.cash), to: acct(a.party, ACCOUNTS.rentIncome) } } : {}) });
      }
    }
    // what is left of the deposit goes back
    if (held > 0.005) {
      if (weLet(a)) i.owe({ kind: 'deposit', label: 'deposit paid back', due: i.ctx.now, amount: held, payer: 'holder', from: i.accounts.cash, to: a.account! });
      else i.owe({ kind: 'deposit', label: 'deposit paid back', due: i.ctx.now, amount: held, payer: 'party', from: a.account!, to: i.accounts.cash });
    }
  },
  describe(read, a) {
    const per = a.terms.period === 'day' ? 'a day' : 'a month';
    const who = read.get('Party', a.party)?.label ?? 'the other side';
    const end = a.end !== undefined ? `until ${read.calendar.format(a.end, 'day')}` : a.notice ? `ends ${read.calendar.format(a.notice.effective, 'day')} (notice by ${a.notice.by === 'holder' ? read.get('Party', a.holder)?.label ?? 'the holder' : who})` : 'open-ended';
    const royalty = Number(a.terms.royalty ?? 0) > 0 ? `; ${money(Number(a.terms.royalty))} a tonne of what is taken` : '';
    return `${weLet(a) ? `Let to ${who}` : `Rented from ${who}`} for ${money(Number(a.terms.rent))} ${per}, ${end}${Number(a.terms.deposit ?? 0) > 0 ? `; deposit ${money(Number(a.terms.deposit))}` : ''}${royalty}.`;
  },
};

/** rent owed by the lessee and overdue */
function arrears(read: ReadCtx, a: Readonly<Agreement>): number {
  return a.open.filter((o) => o.kind === 'rent' && o.payer === (a.role === 'lessor' ? 'party' : 'holder') && o.due < read.now).reduce((s, o) => s + o.amount - o.paid, 0);
}

const arrearsLimit = (a: Readonly<Agreement>) => (a.terms.arrearsLimit === undefined ? Infinity : Number(a.terms.arrearsLimit) * Number(a.terms.rent));

/** notice runs to the end of a rent period at least `days` from now */
function noticeEnd(read: ReadCtx, a: Readonly<Agreement>, days: number): number {
  const earliest = read.now + days * DAY;
  if (a.end !== undefined) return Math.min(a.end, Math.max(read.now, earliest));
  for (let k = 0; k < 2000; k += 1) {
    const t = periodStart(read, a, k);
    if (t >= earliest) return t;
  }
  return earliest;
}

/** leases, contributed to the agreements' instruments */
export const leasesModule = defineModule({
  id: 'leases',
  label: 'Leases',
  description: 'Leases (letting and renting, short and long) as agreement instruments.',
  requires: ['agreements'],
  contributes: { instruments: () => [lease] },
});
