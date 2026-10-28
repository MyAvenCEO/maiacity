/**
 * Claims (docs/design/claims.md, VISION "Owing, and being made to pay"): what one party owes another by law or by a deed,
 * not by agreement (a coercive fine, an administrative fine, damages, a public fee). The debtor holds it against its
 * creditor. Its open items (the claim, its fees, what lateness costs) are paid only by the debtor's act, or taken by a
 * seizure; unpaid, the creditor takes the steps of the claim's law in turn (a reminder, the account seized above what the
 * law leaves, a court's order, detention), each with its fee and its time; a small one is written off (still owed, not
 * pursued), an old one expires. The debtor may pay, in part, object where the law gives an objection, ask for time, or
 * show it cannot pay; the creditor may let it go (a means of compulsion whose purpose is reached). The law is the
 * law pack's (`claimLaw`).
 */
import { DAY, type EntityId, type ReadCtx } from '../../kernel/src/index.ts';
import { ACCOUNTS, acct } from '../../economy/src/index.ts';
import { partyLabel } from '../../parties/src/index.ts';
import type { Agreement, ClaimLaw, Instrument, InstrumentCtx, Obligation } from './contract.ts';

const round2 = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => `${round2(x).toFixed(2)} EUR`;
const YEAR = 365.25 * DAY;
const MONTH = YEAR / 12;

/** the law of a claim's kind */
function lawOf(read: ReadCtx, kind: string): ClaimLaw {
  const law = read.hasData('claimLaw') ? read.data('claimLaw')?.[kind] : undefined;
  if (!law) throw new Error(`claims: no law for claims of kind '${kind}' (law pack: claimLaw)`);
  return law;
}

/** what is still owed on it, and on the claim itself (its fees and lateness apart) */
const owed = (open: readonly Obligation[]) => round2(open.reduce((s, o) => s + o.amount - o.paid, 0));
const principalLeft = (open: readonly Obligation[]) => owed(open.filter((o) => o.kind === 'claim'));

/** a natural person's party (a household, a person): a firm or a public body is a legal person */
const natural = (read: ReadCtx, party: EntityId) => ['household', 'person'].includes(read.get('Party', party)?.kind ?? '');

/** who answers for it in person: whom the claim names (a driver's own fine), else a household's lead member, wherever they live; none for a legal person */
function answerable(read: ReadCtx, a: Readonly<Agreement>): EntityId | undefined {
  if (typeof a.terms.person === 'string' && a.terms.person) return a.terms.person;
  if (!natural(read, a.holder) || !read.hasPort('workforce')) return undefined;
  return read.port('workforce').members(a.holder)[0];
}

/** what an account seizure leaves the debtor: its own, and more for the first and each further one it keeps (a household's other members; not friends who help) */
function kept(read: ReadCtx, law: ClaimLaw, holder: EntityId): number {
  if (!law.protect || !natural(read, holder)) return 0;
  const others = read.hasPort('workforce') ? Math.max(0, read.port('workforce').members(holder).length - 1) : 0;
  return law.protect.debtor.value + (others > 0 ? law.protect.first.value + (others - 1) * law.protect.further.value : 0);
}

/** whether paying `left` at once would be a considerable hardship: more than the debtor has above what the law leaves it (§ 222 AO) */
const hardship = (read: ReadCtx, law: ClaimLaw, holder: EntityId, left: number) => read.port('prices').liquidity(holder) - kept(read, law, holder) < left - 0.005;

/** where the claim's money goes: the debtor's account for it, and the creditor's books where it keeps them */
function dest(i: InstrumentCtx, law: ClaimLaw): Pick<Obligation, 'from' | 'to' | 'mirror'> {
  const a = i.agreement();
  const books = a.party !== a.holder && i.ctx.port('prices').hasBooks(a.party);
  return { from: i.accounts.cash, to: law.account === 'damages' ? i.accounts.damages : i.accounts.fines, ...(books ? { mirror: { from: acct(a.party, ACCOUNTS.claimsIncome), to: acct(a.party, ACCOUNTS.cash) } } : {}) };
}

/** a number drawn within a parameter's range about its value (a court's time: never clockwork) */
function drawn(i: InstrumentCtx, what: string, p: { value: number; range?: readonly [number, number] | number[] }): number {
  const [lo, hi] = p.range && p.range.length === 2 ? [p.range[0]!, p.range[1]!] : [p.value, p.value];
  if (!(hi > lo)) return p.value;
  // (triangular about the value)
  const u = i.ctx.rng(`claim:${i.id}:${what}`).next();
  const c = (p.value - lo) / (hi - lo);
  return u < c ? lo + Math.sqrt(u * (hi - lo) * (p.value - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - p.value));
}

/** pay what is owed from the debtor's cash, in the order its law puts payments, as far as `amount` and the money go; what was paid */
function payOwed(i: InstrumentCtx, law: ClaimLaw, amount: number, how: string): number {
  const a = i.agreement();
  let left = Math.min(amount, Math.max(0, i.ctx.port('prices').liquidity(a.holder)));
  const rank = (o: Obligation) => ((o.kind === 'claim') === (law.order === 'claimFirst') ? 0 : 1);
  const paid = new Map<number, number>();
  const sums: Record<string, number> = {};
  for (const o of [...a.open].sort((x, y) => rank(x) - rank(y) || x.id - y.id)) {
    const x = round2(Math.min(left, o.amount - o.paid));
    if (!(x > 0)) continue;
    i.move(o.from, o.to, x, `${a.label}: ${o.label} (${how})`);
    if (o.mirror) i.move(o.mirror.from, o.mirror.to, x, `${a.label}: ${o.label} (${how}), from ${partyLabel(i.ctx, a.holder)}`);
    // (what was paid, where to: given back if the claim is set aside)
    const key = `paid|${o.to}|${o.mirror?.from ?? ''}|${o.mirror?.to ?? ''}`;
    sums[key] = round2((sums[key] ?? Number(a.state[key] ?? 0)) + x);
    paid.set(o.id, x);
    left -= x;
  }
  const open = a.open.map((o) => (paid.has(o.id) ? { ...o, paid: round2(o.paid + paid.get(o.id)!) } : o)).filter((o) => o.paid < o.amount - 0.005);
  i.patch({ open });
  i.setState(sums);
  return round2([...paid.values()].reduce((s, x) => s + x, 0));
}

/** what was paid on it, given back (the court set it aside) */
function payBack(i: InstrumentCtx, why: string): number {
  const a = i.agreement();
  let back = 0;
  for (const [key, v] of Object.entries(a.state)) {
    if (!key.startsWith('paid|') || !(Number(v) > 0)) continue;
    const [, to, mFrom, mTo] = key.split('|');
    i.move(to!, i.accounts.cash, Number(v), `${a.label}: paid back (${why})`);
    if (mFrom && mTo) i.move(mTo, mFrom, Number(v), `${a.label}: paid back to ${partyLabel(i.ctx, a.holder)} (${why})`);
    back += Number(v);
  }
  return round2(back);
}

/** the claim settled, set aside, let go or expired: said, a detention for it ended, and it ends */
function end(i: InstrumentCtx, why: string): void {
  const a = i.agreement();
  i.ctx.log('info', `${a.label}: ${why}.`, [i.id]);
  const who = typeof a.state.custody === 'string' ? a.state.custody : undefined;
  if (who && i.ctx.hasPort('workforce') && i.ctx.port('workforce').inCustody(who, i.id)) i.ctx.command('workforce.release', { person: who, for: i.id, why: `released: ${a.label} ${why}` });
  i.patch({ open: [], end: i.ctx.now });
  i.ctx.blockers.clear(i.id);
}

/** from when the time to object runs: the notice, or the last order served (a dunning order); none yet */
function servedAt(a: Readonly<Agreement>): number | undefined {
  return a.state.served !== undefined ? Number(a.state.served) : undefined;
}

/** what the debtor sees: what is owed, by when, what comes next, and the ways open to it */
function say(i: InstrumentCtx): void {
  const a = i.agreement();
  const law = lawOf(i.ctx, String(a.terms.kind));
  const st = a.state;
  const due = Number(st.due ?? a.start);
  const left = owed(a.open);
  if (!(left > 0)) return;
  const day = (t: number) => i.ctx.calendar.format(t, 'day');
  const s = law.steps[Number(st.step ?? 0)];
  const who = typeof st.custody === 'string' && i.ctx.hasPort('workforce') && i.ctx.port('workforce').inCustody(st.custody, i.id) ? i.ctx.port('workforce').name(st.custody) : undefined;
  const next = st.writtenOff ? 'written off: still owed, not pursued' : who && st.serving ? `${who} is serving it in custody` : s && st.nextAt !== undefined ? `${s.label} from ${day(Number(st.nextAt))}` : st.seized ? 'the account stays seized' : 'nothing more is done about it';
  const remedies: { label: string; command: { type: string; payload: Record<string, unknown> } }[] = [{ label: `Pay ${money(left)}`, command: { type: 'agreements.act', payload: { agreement: i.id, action: 'pay', amount: left } } }];
  const from = servedAt(a);
  if (law.objection && st.decideAt === undefined && from !== undefined && i.ctx.now <= from + law.objection.within.value * DAY) remedies.push({ label: `Object (${law.objection.label}; by ${day(from + law.objection.within.value * DAY)})`, command: { type: 'agreements.act', payload: { agreement: i.id, action: 'object' } } });
  if (law.deferral && !st.deferred && (!law.deferral.hardship || hardship(i.ctx, law, a.holder, left))) remedies.push({ label: `Ask for time (${law.deferral.label})`, command: { type: 'agreements.act', payload: { agreement: i.id, action: 'askTime' } } });
  if (!st.unable && !st.detained && law.steps.some((x) => x.unlessUnable) && i.ctx.port('prices').liquidity(a.holder) <= kept(i.ctx, law, a.holder) + 0.005) remedies.push({ label: 'Show that we cannot pay (no coercive detention then; it stays owed)', command: { type: 'agreements.act', payload: { agreement: i.id, action: 'unable' } } });
  i.ctx.blockers.set(i.id, [{ code: 'agreements.claim', severity: i.ctx.now > due && !st.writtenOff ? 'block' : 'warn', params: { claim: a.label, creditor: partyLabel(i.ctx, a.party), owed: money(left), due: day(due), basis: String(a.terms.basis), next: st.decideAt !== undefined && !st.decided ? `before the court until about ${day(Number(st.decideAt))}${st.objected ? '' : ` (meanwhile: ${next})`}` : next }, remedies }]);
}

/** on to the step after this one, when its time comes */
function advance(i: InstrumentCtx, law: ClaimLaw, k: number): void {
  const nextStep = law.steps[k + 1];
  i.setState({ step: k + 1, ...(nextStep ? { nextAt: i.ctx.now + nextStep.after.value * DAY } : {}) });
  if (!nextStep) {
    const { nextAt: _n, ...rest } = i.agreement().state;
    i.patch({ state: rest });
  }
}

/** the account seized: what lies on it above what the law leaves is taken for what is owed (now, and what comes in later) */
function seize(i: InstrumentCtx, law: ClaimLaw, how: string): number {
  const a = i.agreement();
  const can = Math.max(0, i.ctx.port('prices').liquidity(a.holder) - kept(i.ctx, law, a.holder));
  return can > 0.005 ? payOwed(i, law, can, how) : 0;
}

/** what lateness costs, month by month: interest from default, or a surcharge for each month begun */
function accrue(i: InstrumentCtx, law: ClaimLaw): void {
  const late = law.late;
  if (!late) return;
  const a = i.agreement();
  const st = a.state;
  const from = late.from === 'due' ? Number(st.due) : st.defaultAt !== undefined ? Number(st.defaultAt) : undefined;
  if (from === undefined || !(i.ctx.now > from) || st.writtenOff) return;
  const monthly = late.perMonth !== undefined;
  const months = monthly ? Math.ceil((i.ctx.now - from) / MONTH) : Math.floor((i.ctx.now - from) / MONTH);
  const done = Number(st.lateMonths ?? 0);
  if (months <= done) return;
  i.setState({ lateMonths: months });
  const base = principalLeft(a.open);
  const on = late.roundDown ? Math.floor(base / late.roundDown.value) * late.roundDown.value : base;
  const firms = i.ctx.get('Party', a.holder)?.kind === 'company' && i.ctx.get('Party', a.party)?.kind === 'company';
  const rate = monthly ? late.perMonth!.value : ((firms ? late.perYearFirms : undefined) ?? late.perYear)!.value / 12;
  const add = round2(on * rate * (months - done));
  if (!(add > 0)) return;
  const item = a.open.find((o) => o.kind === 'late');
  if (item) i.patch({ open: i.agreement().open.map((o) => (o.id === item.id ? { ...o, amount: round2(o.amount + add) } : o)) });
  else i.owe({ kind: 'late', label: `${late.label} (${late.rule})`, due: i.ctx.now, amount: add, payer: 'holder', ...dest(i, law), manual: true });
}

/** the term after which it expires: the law's (longer above an amount), or the one a title started */
function expiry(a: Readonly<Agreement>, law: ClaimLaw): number | undefined {
  const st = a.state;
  const years = st.term !== undefined ? Number(st.term) : law.expiresAbove && (a.amount ?? 0) > law.expiresAbove.amount.value ? law.expiresAbove.term.value : law.expires?.value;
  return years === undefined ? undefined : Number(st.termFrom ?? st.due ?? a.openedAt) + years * YEAR;
}

/** the creditor's next move, when its time has come: the standing seizure, the next step of its law */
function enforce(i: InstrumentCtx, law: ClaimLaw): void {
  const a = i.agreement();
  const st = a.state;
  const left = owed(a.open);
  if (!(left > 0)) return;
  // old enough, it expires (§ 228 AO, § 34 OWiG; a private claim time-barred, § 214 BGB)
  const ends = expiry(a, law);
  if (ends !== undefined && i.ctx.now >= ends) return end(i, `expired, ${money(left)} not collected`);
  if (st.writtenOff || st.objected) return;
  const creditor = partyLabel(i.ctx, a.party);
  const debtor = partyLabel(i.ctx, a.holder);
  // (a seized account goes on giving what comes into it above what the law leaves: § 833a ZPO, § 314 AO)
  if (st.seized && i.ctx.now > Number(st.due)) {
    const got = seize(i, law, 'from the seized account');
    if (got > 0) i.ctx.log('warn', `${creditor} takes ${money(got)} from ${debtor}’s seized account for ${a.label}${owed(i.agreement().open) > 0 ? `, ${money(owed(i.agreement().open))} still owed` : ''}.`, [i.id]);
    if (!(owed(i.agreement().open) > 0)) return;
  }
  if (st.nextAt === undefined || i.ctx.now < Number(st.nextAt)) return;
  const k = Number(st.step ?? 0);
  const s = law.steps[k];
  if (!s) return;
  const now = owed(i.agreement().open);
  // what collecting it would cost more than it brings is written off: still owed, not pursued (§ 261 AO and the like)
  if (law.writeOff && now <= law.writeOff.value && s.act !== 'reminder') {
    const { nextAt: _n, ...rest } = i.agreement().state;
    i.patch({ state: { ...rest, writtenOff: true } });
    i.ctx.log('info', `${a.label}: written off by ${creditor}: ${money(now)} owed, not worth collecting; still owed, no longer pursued.`, [i.id]);
    return say(i);
  }
  // a step against a person: none to take (a legal person answers with its assets only), had already for this claim
  // (§ 96 Abs. 3 OWiG), or the debtor has shown it cannot pay (§ 96 Abs. 1 Nr. 4 OWiG)
  if (s.person) {
    const who = answerable(i.ctx, a);
    const why = !who ? `${debtor} is no person to be detained; only its assets answer` : st.detained ? 'detention for it has been had' : s.unlessUnable && st.unable && i.ctx.port('prices').liquidity(a.holder) <= kept(i.ctx, law, a.holder) + 0.005 ? `${debtor} has shown it cannot pay` : undefined;
    if (why) {
      if (!st.noDetention) i.ctx.log('info', `${creditor}: no ${s.label} for ${a.label}: ${why}.`, [i.id]);
      i.setState({ noDetention: true });
      return advance(i, law, k);
    }
  }
  // its fee, added to what is owed
  if (s.fee && s.fee.value > 0) i.owe({ kind: 'fee', label: `${s.label} (fee)`, due: i.ctx.now, amount: s.fee.value, payer: 'holder', ...dest(i, law), manual: true });
  if (s.served) i.setState({ served: i.ctx.now });
  if (s.term) i.setState({ termFrom: i.ctx.now, term: s.term.value });
  if (s.act === 'reminder') {
    if (st.defaultAt === undefined) i.setState({ defaultAt: i.ctx.now });
    i.ctx.log('warn', `${creditor}: ${s.label} to ${debtor} for ${a.label} (${s.rule}): ${money(owed(i.agreement().open))} owed.`, [i.id]);
  } else if (s.act === 'court') i.ctx.log('warn', `${creditor}: ${s.label} for ${a.label} (${s.rule}).`, [i.id]);
  else if (s.act === 'seizure') {
    const got = seize(i, law, `seized: ${s.rule}`);
    i.setState({ seized: true });
    i.ctx.log(got > 0 ? 'error' : 'warn', `${creditor}: ${s.label} of ${debtor} for ${a.label} (${s.rule}): ${got > 0 ? `${money(got)} taken` : 'nothing to take above what the law leaves'}${owed(i.agreement().open) > 0 ? `, ${money(owed(i.agreement().open))} still owed; what comes into the account is seized too` : ''}.`, [i.id]);
  } else if (s.act === 'detention') {
    const who = answerable(i.ctx, a)!;
    const whole = Number(a.terms.days) > 0 ? Number(a.terms.days) : (s.days?.value ?? 1);
    // (sitting it out instead of paying: the days for what is left of the claim, § 43 StGB; coercive detention its days)
    const days = s.extinguishes ? Math.max(1, Math.ceil((whole * principalLeft(i.agreement().open)) / Math.max(0.01, a.amount ?? 0))) : whole;
    if (i.ctx.hasPort('workforce')) {
      i.ctx.command('workforce.detain', { person: who, days, for: i.id, reason: `${s.label} for ${a.label} (${s.rule})` });
      i.ctx.log('error', `${creditor}: ${s.label}: ${i.ctx.port('workforce').name(who)} is taken into custody for ${days} days for ${a.label} (${s.rule}).`, [i.id, who]);
    }
    i.setState({ detained: true, custody: who, ...(s.extinguishes ? { serving: true } : {}) });
  }
  advance(i, law, k);
}

export const claim: Instrument = {
  id: 'claim',
  label: 'A claim (a fine, damages, a public fee)',
  description: 'What one party owes another by law or by a deed: paid by the debtor, else enforced step by step by the creditor, as the law of its kind says.',
  roles: ['debtor'],
  imposed: true,
  terms: {
    kind: { label: 'Kind of claim (its law)', unit: 'choice' },
    basis: { label: 'What it is made on (the rule)', unit: 'choice' },
  },
  takesAmount: true,
  start(i) {
    const a = i.agreement();
    const law = lawOf(i.ctx, String(a.terms.kind));
    const due = i.ctx.now + law.pay.value * DAY;
    i.owe({ kind: 'claim', label: String(a.terms.basis), due, amount: round2(a.amount ?? 0), payer: 'holder', ...dest(i, law), manual: true });
    // (the notice's own fees and outlays, where its law has them: § 107 OWiG)
    const nf = law.noticeFee;
    if (nf) i.owe({ kind: 'fee', label: `the notice’s fees and outlays (${nf.rule})`, due, amount: Math.min(nf.max.value, Math.max(nf.min.value, nf.share.value * (a.amount ?? 0))) + nf.outlay.value, payer: 'holder', ...dest(i, law), manual: true });
    const first = law.steps[0];
    i.setState({ due, step: 0, ...(first ? { nextAt: due + first.after.value * DAY } : {}), ...(law.objection && !law.objection.served ? { served: i.ctx.now } : {}) });
    i.ctx.log('warn', `${partyLabel(i.ctx, a.party)} claims ${money(owed(i.agreement().open))} of ${partyLabel(i.ctx, a.holder)}: ${a.label} (${String(a.terms.basis)}), to be paid by ${i.ctx.calendar.format(due, 'day')}.`, [i.id]);
    say(i);
  },
  settle(i) {
    const a = i.agreement();
    if (a.end !== undefined) return;
    const law = lawOf(i.ctx, String(a.terms.kind));
    const st = a.state;
    // before the court: it decides when its time has come
    if (!st.decided && st.decideAt !== undefined && i.ctx.now >= Number(st.decideAt)) {
      const upheld = i.ctx.rng(`claim:${i.id}`).chance(law.objection!.upheld.value);
      if (!upheld) {
        // (set aside: what was paid on it comes back, § 37 Abs. 2 AO and the like)
        const back = payBack(i, `set aside by the court`);
        return end(i, `the court sets it aside (${law.objection!.label})${back > 0 ? `; ${money(back)} paid on it is paid back` : ''}`);
      }
      if (st.objected) {
        // (suspended meanwhile: due again now, its enforcement goes on from where it stood)
        const due = i.ctx.now + law.pay.value * DAY;
        const s = law.steps[Number(st.step ?? 0)];
        i.setState({ objected: false, decided: true, due, ...(s ? { nextAt: due + s.after.value * DAY } : {}) });
        i.patch({ open: i.agreement().open.map((o) => ({ ...o, due: Math.max(o.due, due) })) });
        i.ctx.log('warn', `${a.label}: the court upholds it (${law.objection!.label}); to be paid by ${i.ctx.calendar.format(due, 'day')}.`, [i.id]);
      } else {
        i.setState({ decided: true });
        i.ctx.log('warn', `${a.label}: the court upholds it (${law.objection!.label}); its enforcement goes on.`, [i.id]);
      }
    }
    if (!(owed(i.agreement().open) > 0)) return end(i, 'paid');
    // a detention that ends it, sat out
    const who = typeof st.custody === 'string' ? st.custody : undefined;
    if (who && i.ctx.hasPort('workforce') && !i.ctx.port('workforce').inCustody(who, i.id)) {
      if (st.serving) return end(i, `served: ${i.ctx.port('workforce').name(who)} has sat it out in custody`);
      const { custody: _c, ...rest } = i.agreement().state;
      i.patch({ state: rest });
    }
    accrue(i, law);
    enforce(i, law);
    if (i.agreement().end !== undefined) return;
    // (taken in full from the seized account)
    if (!(owed(i.agreement().open) > 0)) return end(i, 'paid');
    say(i);
  },
  actions: {
    pay: {
      label: 'Pay',
      description: 'Pay what is owed on the claim, the whole or a part, from our cash.',
      amount: true,
      run(i, amount) {
        // (taken from the seized account already, today)
        if (i.agreement().end !== undefined) return;
        const law = lawOf(i.ctx, String(i.agreement().terms.kind));
        const got = payOwed(i, law, amount ?? 0, 'paid');
        if (!(got > 0)) i.refuse('agreements.noMoney', { need: round2(amount ?? 0) });
        if (!(owed(i.agreement().open) > 0)) end(i, 'paid');
        else say(i);
      },
    },
    object: {
      label: 'Object',
      description: 'Object to the claim within the period its law gives (from the notice, or from the court order served): a court decides, after its time; meanwhile it is not enforced where the objection suspends it.',
      amount: false,
      run(i) {
        const a = i.agreement();
        const law = lawOf(i.ctx, String(a.terms.kind));
        if (!law.objection) i.refuse('agreements.noObjection', { claim: a.label });
        if (a.end !== undefined || !(owed(a.open) > 0)) i.refuse('agreements.claimSettled', { claim: a.label });
        if (a.state.decideAt !== undefined) i.refuse('agreements.objectedAlready', { claim: a.label });
        const from = servedAt(a);
        if (from === undefined) i.refuse('agreements.objectionNotYet', { claim: a.label, when: `it is disputed once a court's order is served (${law.objection!.label})` });
        if (i.ctx.now > from! + law.objection!.within.value * DAY) i.refuse('agreements.objectionLate', { claim: a.label, by: i.ctx.calendar.format(from! + law.objection!.within.value * DAY, 'day') });
        // (a court fee, where its law has one: the court's, given back with the rest if the claim is set aside)
        if (law.objection!.fee && law.objection!.fee.value > 0) i.owe({ kind: 'fee', label: `${law.objection!.label} (court fee)`, due: i.ctx.now, amount: law.objection!.fee.value, payer: 'holder', from: i.accounts.cash, to: i.accounts.fines, manual: true });
        // (the court's time differs from case to case)
        const decideAt = i.ctx.now + Math.round(drawn(i, 'court', law.objection!.court)) * DAY;
        // (suspending: not enforced while the court has it; else enforced meanwhile, the court still deciding)
        i.setState({ objected: law.objection!.suspends, decideAt });
        i.ctx.log('info', `${a.label}: objected (${law.objection!.label}); the court decides by about ${i.ctx.calendar.format(decideAt, 'day')}${law.objection!.suspends ? '' : ' (it is enforced meanwhile)'}.`, [i.id]);
        say(i);
      },
    },
    askTime: {
      label: 'Ask for time',
      description: 'Ask the creditor to defer the claim (Stundung): granted or not, as its law and its practice are; where its law says so, only when paying it at once would be a considerable hardship, and at interest for each full month.',
      amount: false,
      run(i) {
        const a = i.agreement();
        const law = lawOf(i.ctx, String(a.terms.kind));
        if (!law.deferral || a.state.deferred) i.refuse('agreements.noDeferral', { claim: a.label });
        // (deferred only where paying it at once would be a considerable hardship: Qwen S511, a household with the money
        // was given months for nothing)
        const left = owed(a.open);
        if (law.deferral!.hardship && !hardship(i.ctx, law, a.holder, left)) i.refuse('agreements.noHardship', { claim: a.label, owed: money(left), have: money(i.ctx.port('prices').liquidity(a.holder)) });
        const granted = i.ctx.rng(`claim:${i.id}`).chance(law.deferral!.granted.value);
        i.setState({ deferred: true });
        if (!granted) {
          i.ctx.log('warn', `${a.label}: ${partyLabel(i.ctx, a.party)} does not defer it (${law.deferral!.label}).`, [i.id]);
          return say(i);
        }
        const days = law.deferral!.days.value;
        // (from now, or from its due date if that is still to come; its term rests meanwhile)
        const due = Math.max(i.ctx.now, Number(a.state.due ?? i.ctx.now)) + days * DAY;
        const s = law.steps[Number(a.state.step ?? 0)];
        i.setState({ due, termFrom: Number(a.state.termFrom ?? a.state.due ?? a.openedAt) + days * DAY, ...(s ? { nextAt: due + s.after.value * DAY } : {}) });
        i.patch({ open: i.agreement().open.map((o) => ({ ...o, due: Math.max(o.due, due) })) });
        // (it bears interest for each full month granted, fixed with the deferral and due with the claim: § 234, § 238 AO)
        const rate = law.deferral!.interest;
        // (full calendar months from the day it runs from; a month begun is not counted, § 238 Abs. 1; the sum rounded down
        // as its law says, § 238 Abs. 2; the interest rounded down in the debtor's favour and not fixed at all under its
        // least, § 239 Abs. 2 AO: the law's numbers)
        const [f, u] = [i.ctx.calendar.at(Math.max(i.ctx.now, Number(a.state.due ?? i.ctx.now))), i.ctx.calendar.at(due)];
        const months = Math.max(0, (u.year - f.year) * 12 + u.month - f.month - (u.day < f.day ? 1 : 0));
        const base = principalLeft(i.agreement().open);
        const down = (x: number, step: number) => (step > 0 ? Math.floor(x / step + 1e-9) * step : x);
        const reckoned = rate ? down(down(base, rate.roundDown.value) * rate.perMonth.value * months, rate.whole.value) : 0;
        const interest = rate && reckoned >= rate.least.value ? round2(reckoned) : 0;
        if (interest > 0) i.owe({ kind: 'late', label: `interest on the deferral (${rate!.rule})`, due, amount: interest, payer: 'holder', ...dest(i, law), manual: true });
        i.ctx.log('info', `${a.label}: deferred by ${partyLabel(i.ctx, a.party)} until ${i.ctx.calendar.format(due, 'day')} (${law.deferral!.label})${interest > 0 ? `, at ${money(interest)} interest (${rate!.rule})` : ''}.`, [i.id]);
        say(i);
      },
    },
    unable: {
      label: 'Show that we cannot pay',
      description: 'Show the creditor that we cannot pay (our means laid open): where its law says so (§ 96 Abs. 1 Nr. 4 OWiG), no coercive detention is ordered then; it stays owed.',
      amount: false,
      run(i) {
        const a = i.agreement();
        const law = lawOf(i.ctx, String(a.terms.kind));
        const have = i.ctx.port('prices').liquidity(a.holder);
        const keep = kept(i.ctx, law, a.holder);
        if (have > keep + 0.005) i.refuse('agreements.canPay', { claim: a.label, have: round2(have), keep: round2(keep) });
        i.setState({ unable: true });
        i.ctx.log('info', `${a.label}: ${partyLabel(i.ctx, a.holder)} shows ${partyLabel(i.ctx, a.party)} that it cannot pay (${money(have)}, less than the law leaves).`, [i.id]);
        say(i);
      },
    },
    relent: {
      label: 'Let it go',
      description: 'The creditor stops enforcing it: what it was to compel is done (a means of compulsion), or it waives what is owed.',
      amount: false,
      byParty: true,
      run(i) {
        const a = i.agreement();
        const law = lawOf(i.ctx, String(a.terms.kind));
        if (!(owed(a.open) > 0)) return;
        end(i, law.compels ? `no longer enforced: what it was to compel is done (${law.compels}); ${money(owed(a.open))} is not collected` : `${partyLabel(i.ctx, a.party)} lets ${money(owed(a.open))} go`);
      },
    },
  },
  notice(i) {
    return i.refuse('agreements.cannotEnd', { agreement: i.agreement().label, why: 'a claim ends when it is paid, set aside, let go or expired' });
  },
  close() {},
  describe(read, a) {
    return `${a.label}: ${money(owed(a.open))} owed to ${partyLabel(read, a.party)} (${String(a.terms.basis)})`;
  },
};
