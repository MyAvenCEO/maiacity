/**
 * The agreements core: parties from the economy pack, products on offer, agreements opened,
 * acted on and given notice by player commands, and a daily settlement that brings each agreement
 * up to now and pays what falls due. What an agreement *does* is its instrument's business.
 */
import { command, convert, DAY, defineModule, HOUR, s, type EntityId, type Param, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';
import { ACCOUNTS, acct, type AccountId } from '../../economy/src/index.ts';
import { actorOf, mustBeLive, partyLabel, wordBlock } from '../../parties/src/index.ts';
import type { StoreUse } from '../../inventory/src/index.ts';
import { claim } from './claims.ts';

/** how long a party of the world's catalogues takes to answer an offer it did not ask for (a letter or a call back within a week or two; an estimate) */
const ANSWER_DAYS = 10;
import { ClaimLawSchema, CounterpartySchema, EstateLawSchema, ProductSchema, type Agreement, type AgreementView, type AgreementsPort, type AgreementsState, type HiddenAgreement, type Instrument, type InstrumentCtx, type Obligation, type OfferView, type Product, type Proposal } from './contract.ts';

const round2 = (x: number) => Math.round(x * 100) / 100 + 0;

/** a refusal inside an instrument: a blocker of this module (turned into a rejection, or a log line in a system) */
class Refusal extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string | number>,
  ) {
    super(code);
  }
}

function instruments(read: ReadCtx): Map<string, Instrument> {
  const out = new Map<string, Instrument>();
  for (const c of read.contributions('instruments')) for (const i of c.impl) out.set(i.id, i);
  return out;
}

function instrumentOf(read: ReadCtx, id: string): Instrument {
  const i = instruments(read).get(id);
  if (!i) throw new Error(`agreements: no instrument '${id}' in this world`);
  return i;
}

const products = (read: ReadCtx): Record<string, Product> => (read.hasData('products') ? (read.data('products') ?? {}) : {});

/** what a product lets its holder do: what it permits; without a word, staying there only */
const allows = (read: ReadCtx, a: Readonly<Agreement>, kind?: string) => {
  const permits = products(read)[a.product ?? '']?.permits;
  return permits ? permits.includes(kind ?? 'stay') : !kind;
};

/** a product's terms in the instrument's units (and plain choices), checked */
function resolveTerms(inst: Instrument, productId: string, p: Product): Agreement['terms'] {
  const out: Agreement['terms'] = {};
  for (const [key, spec] of Object.entries(inst.terms)) {
    const v = p.terms[key];
    if (v === undefined) {
      if (!spec.optional) throw new Error(`products.${productId}: the ${inst.id} instrument needs the term '${key}' (${spec.label})`);
      continue;
    }
    if (spec.unit === 'choice') {
      if (typeof v === 'object') throw new Error(`products.${productId}.terms.${key}: a choice, not a parameter`);
      out[key] = v;
    } else {
      if (typeof v !== 'object' || typeof (v as Param).value !== 'number') throw new Error(`products.${productId}.terms.${key}: a parameter in ${spec.unit} expected`);
      out[key] = convert((v as Param).value, (v as Param).unit, spec.unit);
    }
  }
  return out;
}

function accountOf(id: EntityId, side: 'asset' | 'liability'): string {
  return `${side}:agreement:${id}`;
}

const hiddenOf = (read: ReadCtx, id: EntityId): HiddenAgreement => read.state('agreements').hidden[id] ?? {};

function setHidden(ctx: WriteCtx, id: EntityId, patch: HiddenAgreement): void {
  const st = ctx.state('agreements');
  ctx.patchState('agreements', { hidden: { ...st.hidden, [id]: { ...(st.hidden[id] ?? {}), ...patch } } });
}

/** a party's chart of accounts by name (ledger account ids) */
const accountsOf = (holder: EntityId) => Object.fromEntries(Object.entries(ACCOUNTS).map(([k, v]) => [k, acct(holder, v as AccountId)])) as InstrumentCtx['accounts'];

function instrumentCtx(ctx: WriteCtx, id: EntityId): InstrumentCtx {
  const holder = ctx.require('Agreement', id).holder;
  const i: InstrumentCtx = {
    ctx,
    id,
    holder,
    agreement: () => ctx.require('Agreement', id),
    patch: (patch) => ctx.set('Agreement', id, { ...ctx.require('Agreement', id), ...patch }),
    setState: (patch) => {
      const a = ctx.require('Agreement', id);
      ctx.set('Agreement', id, { ...a, state: { ...a.state, ...patch } });
    },
    balance: () => {
      const acc = ctx.require('Agreement', id).account;
      if (!acc) return 0;
      // the ledger keeps balances by kind: an asset grows with debits, a liability with credits
      return round2(ctx.balance(acc) * (acc.startsWith('liability:') ? -1 : 1));
    },
    move: (from, to, amount, memo) => {
      const amt = round2(amount);
      if (amt <= 0) return;
      ctx.ledger.post({ from, to, amount: amt, memo, category: 'agreement', refs: [id] });
    },
    owe: ({ paysAt, ...o }) => {
      const a = ctx.require('Agreement', id);
      const amount = round2(o.amount);
      if (amount <= 0) return;
      ctx.set('Agreement', id, { ...a, open: [...a.open, { ...o, amount, id: a.nextObligation, paid: 0 }], nextObligation: a.nextObligation + 1 });
      // when the other side really pays is the world's knowledge, not the players'
      if (paysAt !== undefined) setHidden(ctx, id, { paysAt: { ...(hiddenOf(ctx, id).paysAt ?? {}), [String(a.nextObligation)]: paysAt } });
    },
    hidden: () => hiddenOf(ctx, id),
    setHidden: (patch) => setHidden(ctx, id, patch),
    refuse: (code, params = {}) => {
      throw new Refusal(code, params);
    },
    accounts: accountsOf(holder),
  };
  return i;
}

/** what can be drawn from it any day (no notice period) */
const liquidNow = (a: Readonly<Agreement>) => !(Number(a.terms.withdrawalNotice ?? 0) > 0);

/** where a party's money could come from when it is short: what its agreements can release, what is on offer to borrow */
export function moneyRemedies(read: ReadCtx, holder: EntityId, need: number, opts?: { liquidCounted?: boolean }): { label: string; command: { type: string; payload: Record<string, unknown> } }[] {
  const out: { label: string; command: { type: string; payload: Record<string, unknown> } }[] = [];
  for (const [id, a] of read.all('Agreement')) {
    if (a.holder !== holder || a.status !== 'active' || !a.account) continue;
    const inst = instrumentOf(read, a.instrument);
    const held = round2(read.balance(a.account));
    if (!inst.cashOut || held <= 0) continue;
    // (where what can be drawn at once is counted already, drawing it changes nothing)
    if (opts?.liquidCounted && liquidNow(a)) continue;
    const amount = round2(Math.min(held, Math.max(need, 0.01)));
    out.push({ label: `${inst.actions[inst.cashOut]?.label ?? inst.cashOut} ${amount} EUR from ${a.label}`, command: { type: 'agreements.act', payload: { agreement: id, action: inst.cashOut, amount } } });
  }
  for (const [pid, p] of Object.entries(products(read))) {
    const inst = instruments(read).get(p.instrument);
    if (!inst?.cashIn) continue;
    const amount = Math.ceil(Math.max(need, p.minAmount?.value ?? 0));
    if (p.maxAmount && amount > p.maxAmount.value) continue;
    // what the bank would refuse on what it can see (our debts against our net worth) is no way out
    if (inst.check?.(read, holder, resolveTerms(inst, pid, p), amount)) continue;
    out.push({ label: `Borrow ${amount} EUR: ${p.label} (${p.leadTime.value > 0 ? `paid out in ${p.leadTime.value} d, ` : ''}if the bank agrees)`, command: { type: 'agreements.open', payload: { product: pid, amount } } });
  }
  return out;
}

/** run instrument code for a holder; a refusal becomes the command's rejection (with where its money could come from, when it is short) */
function inCommand<T>(ctx: WriteCtx, holder: EntityId, body: () => T): T {
  try {
    return body();
  } catch (e) {
    if (e instanceof Refusal) ctx.reject(e.code, e.params, e.code === 'agreements.notEnoughCash' ? moneyRemedies(ctx, holder, Number(e.params.amount) - Math.max(0, ctx.balance(acct(holder, ACCOUNTS.cash)))) : undefined);
    throw e;
  }
}

/** a player acts only on the agreements its party holds */
function mustHold(ctx: WriteCtx, a: Readonly<Agreement>): void {
  if (ctx.caller === 'client' && a.holder !== actorOf(ctx)) ctx.reject('agreements.notOurs', { agreement: a.label, party: partyLabel(ctx, actorOf(ctx)) });
}

/** pay what is due: the other side pays when it does (on the day, or late), we pay from cash while the credit line allows */
function payDue(ctx: WriteCtx, id: EntityId): void {
  const a = ctx.require('Agreement', id);
  if (!a.open.some((o) => o.due <= ctx.now && o.paid < o.amount) && !ctx.blockersOf(id).some((b) => b.module === 'agreements')) return;
  const prices = ctx.port('prices');
  const paysAt = hiddenOf(ctx, id).paysAt ?? {};
  const left: Obligation[] = [];
  const late: string[] = [];
  const theyOwe: string[] = [];
  for (const o of a.open) {
    // (not yet due, paid, or paid only by the payer's act: its instrument says what comes of it)
    if (o.due > ctx.now || o.paid >= o.amount || (o.manual && o.payer === 'holder')) {
      if (o.paid < o.amount) left.push(o);
      continue;
    }
    const rest = round2(o.amount - o.paid);
    if (o.payer === 'holder' && !prices.canSpend(a.holder, rest)) {
      // what the money allows is paid now, the rest stays overdue
      const part = Math.max(0, Math.floor(prices.liquidity(a.holder) * 100) / 100);
      if (part > 0) ctx.ledger.post({ from: o.from, to: o.to, amount: part, memo: `${a.label}: ${o.label} (part)`, category: 'agreement', refs: [id] });
      if (part > 0 && o.mirror) ctx.ledger.post({ from: o.mirror.from, to: o.mirror.to, amount: part, memo: `${a.label}: ${o.label} (part), from ${partyLabel(ctx, a.holder)}`, category: 'agreement', refs: [id] });
      left.push({ ...o, paid: round2(o.paid + part) });
      late.push(`${o.label} ${round2(rest - part).toFixed(2)} EUR`);
      continue;
    }
    if (o.payer === 'party' && paysAt[String(o.id)] !== undefined && paysAt[String(o.id)]! > ctx.now) {
      left.push(o);
      theyOwe.push(`${o.label} ${rest.toFixed(2)} EUR (due ${ctx.calendar.format(o.due, 'date')})`);
      continue;
    }
    ctx.ledger.post({ from: o.from, to: o.to, amount: rest, memo: `${a.label}: ${o.label}`, category: 'agreement', refs: [id] });
    // what we pay is said (Qwen S188: a month's pass was paid without a word); a day's rent is not news each day
    if (o.payer === 'holder' && rest > 0 && a.terms.period !== 'day') ctx.log('info', `Paid ${rest.toFixed(2)} EUR: ${a.label}, ${o.label}.`, [id]);
    // (in the other side's books too, where it keeps them)
    if (o.mirror) ctx.ledger.post({ from: o.mirror.from, to: o.mirror.to, amount: rest, memo: `${a.label}: ${o.label}, from ${partyLabel(ctx, a.holder)}`, category: 'agreement', refs: [id] });
  }
  ctx.set('Agreement', id, { ...ctx.require('Agreement', id), open: left });
  // forget the drawn payment times of what is paid
  if (Object.keys(paysAt).length) {
    const keep = Object.fromEntries(Object.entries(paysAt).filter(([k]) => left.some((o) => String(o.id) === k)));
    if (Object.keys(keep).length !== Object.keys(paysAt).length) setHidden(ctx, id, { paysAt: keep });
  }
  const blockers: { code: string; severity: 'warn'; params: Record<string, string>; remedies?: ReturnType<typeof moneyRemedies> }[] = [];
  if (late.length) blockers.push({ code: 'agreements.arrears', severity: 'warn', params: { what: late.join(', ') }, remedies: moneyRemedies(ctx, a.holder, left.filter((o) => o.payer === 'holder' && o.due <= ctx.now).reduce((x, o) => x + o.amount - o.paid, 0) - Math.max(0, ctx.port('prices').liquidity(a.holder))) });
  if (theyOwe.length) blockers.push({ code: 'agreements.theyOwe', severity: 'warn', params: { party: ctx.get('Party', a.party)?.label ?? a.party, what: theyOwe.join(', ') } });
  // a player on the other side (its books get what we pay) sees what we owe it, on the thing, with its way: asking it back
  const theirs = left.filter((o) => o.mirror && o.payer === 'holder' && o.due <= ctx.now);
  if (a.subject && ctx.port('prices').hasBooks(a.party)) {
    if (theirs.length) ctx.blockers.set(a.subject, [{ code: 'agreements.theyOwe', severity: 'warn', params: { party: partyLabel(ctx, a.holder), what: theirs.map((o) => `${o.label} ${round2(o.amount - o.paid).toFixed(2)} EUR`).join(', ') }, remedies: [{ label: `Ask for it back (${a.label})`, command: { type: 'agreements.notice', payload: { agreement: id } } }] }]);
    else if (ctx.blockersOf(a.subject).some((b) => b.module === 'agreements' && b.code === 'agreements.theyOwe')) ctx.blockers.clear(a.subject);
  }
  // (its own: what an instrument says of the agreement, a claim's notice, stays)
  const theirsToo = ctx.blockersOf(id).filter((b) => b.code !== 'agreements.arrears' && b.code !== 'agreements.theyOwe');
  if (blockers.length || theirsToo.length) ctx.blockers.set(id, [...theirsToo, ...blockers]);
  else ctx.blockers.clear(id);
}

const balanceSide = (inst: Instrument, role: string) => (typeof inst.balance === 'function' ? inst.balance(role) : inst.balance);

function start(ctx: WriteCtx, id: EntityId): void {
  const a = ctx.require('Agreement', id);
  const inst = instrumentOf(ctx, a.instrument);
  // what was checked when asked for is checked again now (other agreements may have started since)
  const no = inst.check?.(ctx, a.holder, a.terms, a.amount, id);
  if (no) throw new Refusal(no.code, no.params);
  const side = balanceSide(inst, a.role);
  if (side) {
    const acc = accountOf(id, side);
    ctx.ledger.open(acc, { label: a.label, kind: side, unit: 'EUR', holder: a.holder });
    ctx.set('Agreement', id, { ...a, account: acc });
  }
  inst.start(instrumentCtx(ctx, id));
  // what falls due from the first day (a lease's first rent)
  inst.settle(instrumentCtx(ctx, id));
  // what it is about is held by it now: let to someone, or rented from someone
  const basis = inst.tenure?.(a.role);
  if (a.subject && basis) ctx.set('Tenure', a.subject, { basis, agreement: id });
  ctx.set('Agreement', id, { ...ctx.require('Agreement', id), status: 'active', start: ctx.now });
  payDue(ctx, id);
  ctx.emit('agreements.started', { agreement: id, instrument: a.instrument });
  ctx.log('info', `${a.label} started.`, [id]);
}

/**
 * The agreements of a party that is wound up (one function, decision 0028 rule 4; review y): by its administrator, when
 * insolvency proceedings are opened (`insolvency`), or by its heirs or liquidators, when it has ended with nobody left
 * of it (`estate`: what depends on it ends with it, in the law's way, never by vanishing). Either way nothing more is
 * begun: what was asked for and has not begun lapses; what it lent to others is asked back by its terms; what it rents,
 * and what it holds that can be drawn (a deposit), is given notice at the earliest lawful date: its own notice, for what
 * is rented at most the insolvency law's cap (§ 109 InsO as data), or for an estate the law's extraordinary notice, a
 * fixed term too where the estate law says so (§§ 564, 580 BGB as data); a notice given before cut to it. Rent is owed
 * until then (from the estate's account), the deposit settled at the end (`close`). A loan falls due in insolvency (its
 * instrument's `windUp`); an estate owes it on its terms, as it is owed what it lets to others for rent.
 */
function windUp(ctx: WriteCtx, party: EntityId, how: 'insolvency' | 'estate' = 'insolvency'): void {
  const estate = how === 'estate';
  const cap = !estate && ctx.hasData('insolvencyLaw') ? ctx.data('insolvencyLaw')?.maxNotice.value : undefined;
  const law = estate && ctx.hasData('estateLaw') ? ctx.data('estateLaw') : undefined;
  const who = estate ? `The estate of ${partyLabel(ctx, party)}` : 'The administrator';
  // what the party has lent to others (in their books): asked back, by the terms (a loan for use: at once)
  for (const [id, a] of [...ctx.all('Agreement')]) {
    // (lent for nothing or let for a fee: asked back by its terms; an estate asks back what it lent for nothing, what it
    // lets for rent runs on as the estate's, the tenant's right unchanged)
    if (a.party !== party || a.holder === party || a.status !== 'active' || a.role !== 'lessee' || a.terms.landlordNotice === undefined || a.notice) continue;
    if (estate && Number(a.terms.rent ?? 0) > 0) continue;
    const effective = Math.max(ctx.now, Math.min(a.end ?? Infinity, ctx.now + Number(a.terms.landlordNotice) * DAY));
    ctx.set('Agreement', id, { ...a, status: 'ending', notice: { by: 'party', given: ctx.now, effective } });
    if (effective <= ctx.now) close(ctx, id);
    ctx.log('info', `${who} asks for ${a.label} back.`, [id]);
  }
  for (const [id, a] of [...ctx.all('Agreement')]) {
    if (a.status === 'ended' || (a.holder !== party && !(estate && a.party === party && a.status === 'pending'))) continue;
    if (a.status === 'pending') {
      ctx.set('Agreement', id, { ...a, status: 'ended', endedAt: ctx.now });
      ctx.log('info', `${a.label} lapses: ${estate ? `${partyLabel(ctx, party)} has ended (nobody left of it)` : 'its holder is in insolvency proceedings'}.`, [id]);
      continue;
    }
    if (a.wound) continue;
    const inst = instrumentOf(ctx, a.instrument);
    if (!estate && inst.windUp) {
      inst.windUp(instrumentCtx(ctx, id));
      continue;
    }
    const lessee = a.role === 'lessee' && inst.tenure?.(a.role) !== undefined;
    if (!lessee && inst.balance !== 'asset') {
      // (a loan it owes, a let it holds as lessor, a claim on it: the estate's, on their terms, § 1967 BGB)
      if (estate) ctx.log('info', `${a.label} runs on as the estate's of ${partyLabel(ctx, party)}.`, [id]);
      continue;
    }
    // its own notice where it can be given now (refused: a fixed term, unless the estate's notice ends that too), and for
    // what is rented in insolvency the law's cap
    let own = Infinity;
    try {
      own = inCommand(ctx, a.holder, () => inst.notice(instrumentCtx(ctx, id), 'holder', estate && lessee && Boolean(law?.fixedTerm)));
    } catch {
      own = Infinity;
    }
    const limit = lessee && cap !== undefined ? ctx.calendar.startOfDay(ctx.now) + Math.ceil(cap) * DAY : Infinity;
    const effective = Math.max(ctx.now, Math.min(a.end ?? Infinity, a.notice?.effective ?? Infinity, own, limit));
    if (!Number.isFinite(effective) || (a.notice && a.notice.effective <= effective)) {
      if (estate) ctx.log('info', `${a.label} runs on as the estate's of ${partyLabel(ctx, party)}${a.notice ? `, to ${ctx.calendar.format(a.notice.effective, 'day')}` : a.end !== undefined ? `, to ${ctx.calendar.format(a.end, 'day')}` : ''}.`, [id]);
      continue;
    }
    ctx.set('Agreement', id, { ...ctx.require('Agreement', id), status: 'ending', notice: { by: 'holder', given: ctx.now, effective } });
    if (effective <= ctx.now) close(ctx, id);
    if (estate) ctx.log('info', `${who} gives notice of ${a.label}${law && lessee ? ` (${law.rule})` : ''}: it ${effective <= ctx.now ? 'ends now' : `ends ${ctx.calendar.format(effective, 'day')}, what falls due until then paid from the estate`}.`, [id]);
    else if (effective > ctx.now) ctx.log('info', `${who} ends ${a.label}: it ends ${ctx.calendar.format(effective, 'day')}.`, [id]);
  }
}

/** why a product is of no use here (what it permits there is none of on this map), or undefined */
function unusable(read: ReadCtx, product: Readonly<Product>): string | undefined {
  for (const permit of product.permits ?? []) {
    const why = read.contributions('unusable').map((c) => c.impl(read, permit)).find((x): x is string => Boolean(x));
    if (why) return why;
  }
  return undefined;
}

/** wind it up: the instrument settles the end; it ends once nothing is owed any more */
function close(ctx: WriteCtx, id: EntityId): void {
  const inst = instrumentOf(ctx, ctx.require('Agreement', id).instrument);
  const i = instrumentCtx(ctx, id);
  inst.settle(i);
  inst.close(i);
  ctx.set('Agreement', id, { ...ctx.require('Agreement', id), wound: true, status: 'ending' });
  // what falls due at the end is settled now
  payDue(ctx, id);
  finishIfSettled(ctx, id);
}

function finishIfSettled(ctx: WriteCtx, id: EntityId): void {
  const a = ctx.require('Agreement', id);
  if (a.open.length) return;
  ctx.set('Agreement', id, { ...a, status: 'ended', endedAt: ctx.now });
  if (a.subject && ctx.get('Tenure', a.subject)?.agreement === id) {
    // held by another agreement still (a household's permission to camp beside its felling season): that one now
    const next = [...ctx.all('Agreement')].find(([x, b]) => x !== id && b.subject === a.subject && b.status !== 'ended' && b.status !== 'pending' && instrumentOf(ctx, b.instrument).tenure?.(b.role));
    if (next) ctx.set('Tenure', a.subject, { basis: instrumentOf(ctx, next[1].instrument).tenure!(next[1].role)!, agreement: next[0] });
    else ctx.remove('Tenure', a.subject);
  }
  const st = ctx.state('agreements');
  if (st.hidden[id]) {
    const { [id]: _gone, ...rest } = st.hidden;
    ctx.patchState('agreements', { hidden: rest });
  }
  ctx.blockers.clear(id);
  ctx.emit('agreements.ended', { agreement: id, instrument: a.instrument });
  ctx.log('info', `${a.label} ended.`, [id]);
}

/** every agreement brought up to now; a day is the finest any instrument needs so far */
/**
 * Why an offer stands no more (one fact for the list, the taking and its end, decision 0028 rule 4): what it offers is
 * no longer its maker's to give (sold, handed back) or is held by an agreement meanwhile (lent to another on another
 * offer); undefined: it stands. (Offered for sale meanwhile it is still theirs: taking it is refused until the listing
 * is withdrawn, `agreements.notLendable`.)
 */
function lapsed(read: ReadCtx, pr: Readonly<Proposal>): { code: string; params: Record<string, string | number> } | undefined {
  const by = read.contributions('holders').map((c) => c.impl(read, pr.subject)).find((x): x is EntityId => Boolean(x));
  return by !== pr.from || agreementsPort(read).holderOf(pr.subject) ? { code: 'agreements.proposalLapsed', params: { subject: read.entity(pr.subject)?.name ?? pr.subject } } : undefined;
}

/** the offers that stand no more (of one thing, or all), ended and said (§ 145 BGB: one who gave the thing to another cannot stand by a second offer of it) */
function lapseOffers(ctx: WriteCtx, subject?: EntityId): void {
  for (const [id, pr] of [...ctx.all('Proposal')]) {
    if (subject !== undefined && pr.subject !== subject) continue;
    const why = lapsed(ctx, pr);
    if (!why) continue;
    ctx.log('info', `${ctx.entity(id)?.name ?? id} is no longer offered: ${ctx.formatBlocker({ module: 'agreements', code: why.code, severity: 'info', params: why.params })}.`, [id, pr.from, pr.to]);
    ctx.destroy(id);
  }
}

function daily(ctx: WriteCtx): void {
  lapseOffers(ctx);
  for (const [id, a] of [...ctx.all('Agreement')]) {
    if (a.status === 'ended') continue;
    // wound up: only what is still owed is settled, then it ends
    if (a.wound) {
      payDue(ctx, id);
      finishIfSettled(ctx, id);
      continue;
    }
    if (a.status === 'pending') {
      if (a.start > ctx.now) continue;
      try {
        start(ctx, id);
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        ctx.set('Agreement', id, { ...ctx.require('Agreement', id), status: 'ended', endedAt: ctx.now });
        ctx.log('warn', `${a.label} could not start: ${ctx.formatBlocker({ module: 'agreements', code: e.code, severity: 'block', params: e.params })}.`, [id]);
      }
      continue;
    }
    // what it is about is gone (a house taken down): it can be had no more, and the agreement ends
    const why = a.subject ? ctx.contributions('gone').map((c) => c.impl(ctx, a.subject!)).find((x): x is string => Boolean(x)) : undefined;
    if (why && a.status === 'active') {
      ctx.log('warn', `${a.label} ends: ${why}.`, [id]);
      close(ctx, id);
      continue;
    }
    instrumentOf(ctx, a.instrument).settle(instrumentCtx(ctx, id));
    payDue(ctx, id);
    const now = ctx.require('Agreement', id);
    if ((now.notice && now.notice.effective <= ctx.now) || (now.end !== undefined && now.end <= ctx.now)) close(ctx, id);
  }
}

function view(read: ReadCtx, id: EntityId, a: Readonly<Agreement>): AgreementView {
  const inst = instrumentOf(read, a.instrument);
  const bal = a.account ? round2(read.balance(a.account) * (a.account.startsWith('liability:') ? -1 : 1)) : 0;
  return {
    id,
    label: a.label,
    instrument: inst.label,
    party: read.get('Party', a.party)?.label ?? a.party,
    role: a.role,
    status: a.status,
    terms: Object.entries(a.terms).map(([key, value]) => ({ key, label: inst.terms[key]?.label ?? key, value, unit: inst.terms[key]?.unit === 'choice' ? '' : (inst.terms[key]?.unit ?? '') })),
    balance: bal,
    start: a.start,
    ...(a.end !== undefined ? { end: a.end } : {}),
    ...(a.notice ? { notice: a.notice } : {}),
    open: a.open.map((o) => ({ label: o.label, due: o.due, amount: o.amount, payer: o.payer, paid: o.paid })),
    actions: a.status === 'active' ? Object.entries(inst.actions).map(([k, x]) => ({ id: k, label: x.label, description: x.description, amount: x.amount })) : [],
    // (ending it: by notice, its own command)
    ...(a.status === 'active' ? { endBy: 'agreements.notice' } : {}),
    summary: inst.describe(read, a, bal),
  };
}

function offerView(read: ReadCtx, id: string, p: Product): OfferView | null {
  const inst = instruments(read).get(p.instrument);
  if (!inst) return null;
  const party = read.hasData('counterparties') ? read.data('counterparties')?.[p.party] : undefined;
  return {
    id,
    label: p.label,
    ...(p.description ? { description: p.description } : {}),
    party: party?.label ?? p.party,
    instrument: inst.label,
    role: p.role,
    terms: Object.entries(resolveTerms(inst, id, p)).map(([key, value]) => {
      const t = p.terms[key];
      const src = typeof t === 'object' ? (t as Param).source?.title : undefined;
      return { key, label: inst.terms[key]?.label ?? key, value, unit: inst.terms[key]?.unit === 'choice' ? '' : inst.terms[key]!.unit, ...(src ? { source: src } : {}) };
    }),
    ...(p.minAmount ? { minAmount: p.minAmount.value } : {}),
    ...(p.maxAmount ? { maxAmount: p.maxAmount.value } : {}),
    leadTime: p.leadTime.value,
  };
}

/** an agreement that still holds its subject: not ended, and its end or notice not come yet */
const holding = (read: ReadCtx, a: Readonly<Agreement>): boolean => a.status !== 'ended' && (a.status === 'pending' || read.now < Math.min(a.end ?? Infinity, a.notice?.effective ?? Infinity, a.endedAt ?? Infinity));

const agreementsPort = (read: ReadCtx): AgreementsPort => ({
  lets: () => {
    const last = new Map<string, [EntityId, Readonly<Agreement>]>();
    for (const [id, a] of read.all('Agreement')) {
      // (rented by its holder from another: a lessee's tenure, about a thing that is not land, nor a person's pass)
      const kind = a.subject ? read.entity(a.subject)?.kind : undefined;
      if (!a.subject || a.party === a.holder || a.status === 'pending' || instruments(read).get(a.instrument)?.tenure?.(a.role) !== 'leaseIn' || kind === 'parcel' || kind === 'person') continue;
      const k = `${a.subject}|${a.holder}`;
      const was = last.get(k);
      if (!was || was[1].start <= a.start) last.set(k, [id, a]);
    }
    return [...last.values()].map(([id, a]) => {
      const live = holding(read, a);
      const ended = live ? undefined : Math.min(a.end ?? Infinity, a.notice?.effective ?? Infinity, a.endedAt ?? Infinity);
      const rent = Number(a.terms.rent ?? 0);
      return { agreement: id, subject: a.subject!, lessee: a.holder, lessor: a.party, ...(a.product ? { product: a.product } : {}), live, ...(ended !== undefined && Number.isFinite(ended) ? { ended } : {}), rentPerDay: a.terms.period === 'day' ? rent : rent / 30.44 };
    }).sort((x, y) => (x.subject < y.subject ? -1 : x.subject > y.subject ? 1 : x.lessee < y.lessee ? -1 : 1));
  },
  agreements: (party) => [...read.all('Agreement')].filter(([, a]) => party === undefined || a.holder === party).map(([id, a]) => view(read, id, a)),
  // (one whose end or notice has come holds nothing more, though it waits for what is still owed)
  holderOf: (subject) => {
    for (const [id, a] of read.all('Agreement')) if (a.subject === subject && holding(read, a)) return id;
    return null;
  },
  about: (subject) => [...read.all('Agreement')].filter(([, a]) => a.subject === subject && holding(read, a)).map(([id]) => id),
  permitting: (holder, subject, kind, at) => {
    for (const [id, a] of read.all('Agreement')) {
      if (a.subject !== subject || (holder !== null && a.holder !== holder) || !allows(read, a, kind)) continue;
      // (ended in effect when its end or notice has come, though it waits for what is still owed)
      const until = Math.min(a.end ?? Infinity, a.notice?.effective ?? Infinity, a.endedAt ?? Infinity);
      if (at === undefined ? a.status !== 'ended' && a.status !== 'pending' && read.now < until : a.status !== 'pending' && a.start <= at && at <= until) return id;
    }
    return undefined;
  },
  applied: (holder, subject, kind) => [...read.all('Agreement')].find(([, a]) => a.subject === subject && a.holder === holder && a.status === 'pending' && allows(read, a, kind))?.[0],
  offers: () => {
    // (land offered by a party that holds none in this world is no offer here: Qwen S201)
    const landOf = new Set([...(read.all as (name: string) => Iterable<[EntityId, { holder?: EntityId }]>)('Parcel')].map(([, x]) => x.holder));
    const parties = read.state('agreements').parties;
    return Object.entries(products(read))
      .filter(([, p]) => p.subjectKind !== 'parcel' || landOf.has(parties[p.party] ?? p.party))
      // (nor one whose use there is none of here: a monthly pass on a map no bus or train serves, Qwen S507)
      .filter(([, p]) => !unusable(read, p))
      .map(([id, p]) => offerView(read, id, p))
      .filter((x): x is OfferView => x !== null);
  },
  holdings: (party) => {
    let assets = 0;
    let liabilities = 0;
    for (const [, a] of read.all('Agreement')) {
      if (a.holder !== party || !a.account || a.status === 'ended') continue;
      const b = read.balance(a.account);
      if (a.account.startsWith('liability:')) liabilities -= b;
      else assets += b;
    }
    return { assets: round2(assets), liabilities: round2(liabilities) };
  },
});

export const agreementsModule = defineModule({
  id: 'agreements',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Employment', 'Helper', 'Machine', 'Parcel', 'Party', 'Person', 'Presence', 'Structure'],
  label: 'Agreements',
  description: 'Agreements between us and the parties of the world: products on offer, open, act, notice, and the daily settlement of what falls due.',
  provides: ['agreements'],
  requires: ['prices', 'parties'],
  contributes: {
    // claims (fines, damages, public fees) are agreements imposed by law: the core's own instrument
    instruments: () => [claim],
    financing: () => (read: ReadCtx, holder: EntityId, need: number, opts?: { liquidCounted?: boolean }) => moneyRemedies(read, holder, need, opts),
    // a thing let or lent to someone: theirs to use while the agreement runs
    machineUser: () => (read: ReadCtx, machine: EntityId) => {
      const t = read.get('Tenure', machine);
      const a = t?.basis === 'leaseIn' ? read.get('Agreement', t.agreement) : undefined;
      return a && (a.status === 'active' || a.status === 'ending') && read.now < Math.min(a.end ?? Infinity, a.notice?.effective ?? Infinity) ? a.holder : null;
    },
    // a thing lent for nothing is its borrower's to keep (its ordinary upkeep); one let for rent stays its lessor's to keep
    machineKeeper: () => (read: ReadCtx, machine: EntityId) => {
      const t = read.get('Tenure', machine);
      const a = t?.basis === 'leaseIn' ? read.get('Agreement', t.agreement) : undefined;
      const lent = a && (a.status === 'active' || a.status === 'ending') && read.now < Math.min(a.end ?? Infinity, a.notice?.effective ?? Infinity);
      return lent && Number(a.terms.rent ?? 0) === 0 ? a.holder : null;
    },
    // a store let or lent (a yard rented): used by its agreement while it holds it, not given up or closed from under it
    // (decision 0028 rule 1; review y)
    storeUses: () => (read: ReadCtx, store: EntityId): StoreUse[] =>
      agreementsPort(read).about(store).map((id) => {
        const a = read.require('Agreement', id);
        return { by: id, why: `${a.label} holds it (${a.role === 'lessor' ? `let to ${partyLabel(read, a.party)}` : `${partyLabel(read, a.holder)} rents it from ${partyLabel(read, a.party)}`})` };
      }),
    // money it can draw on at once: what can be withdrawn any day (a call deposit without a notice period)
    liquidFunds: () => (read: ReadCtx, holder: EntityId) =>
      [...read.all('Agreement')]
        .filter(([, a]) => a.holder === holder && a.status === 'active' && a.account && instrumentOf(read, a.instrument).cashOut && liquidNow(a))
        .reduce((s, [, a]) => s + Math.max(0, read.balance(a.account!)), 0),
  },
  // an agreement is its two sides' business
  observe: { Agreement: (v: Agreement, viewer: EntityId) => (v.holder === viewer || v.party === viewer ? v : undefined) },
  components: {
    Agreement: s.any<Agreement>(),
    Proposal: s.object({ from: s.ref('party'), to: s.ref('party'), subject: s.ref(), days: s.number({ min: 1 }).optional(), fee: s.number({ min: 0, unit: 'EUR' }).optional(), at: s.number({ unit: 's' }) }),
    Tenure: s.object({ basis: s.enum(['leaseOut', 'leaseIn']), agreement: s.ref('agreement') }),
  },
  data: { counterparties: s.record(CounterpartySchema).optional(), products: s.record(ProductSchema).optional(), claimLaw: s.record(ClaimLawSchema).optional(), estateLaw: EstateLawSchema.optional() },
  state: { initial: (): AgreementsState => ({ parties: {}, hidden: {} }) },
  events: {
    'agreements.started': s.object({ agreement: s.ref('agreement'), instrument: s.string() }),
    'agreements.ended': s.object({ agreement: s.ref('agreement'), instrument: s.string() }),
  },
  blockers: {
    'agreements.unknownProduct': 'Nothing called {product} is on offer (offers: {offers})',
    'agreements.unknownAgreement': 'No agreement {agreement}',
    'agreements.notActive': '{agreement} is {status}',
    'agreements.unknownAction': '{agreement} has no action {action} (actions: {actions})',
    'agreements.amountNeeded': '{product} is opened with an amount (at least {min} EUR)',
    'agreements.amountTooSmall': '{product} takes at least {min} EUR',
    'agreements.amountTooLarge': '{product} takes at most {max} EUR',
    'agreements.notEnoughCash': 'Only {cash} EUR of our own money in the bank account; {amount} EUR needed (the credit line is not for this)',
    'agreements.overdrawn': 'Only {available} EUR in {agreement} can be withdrawn',
    'agreements.locked': '{agreement} is fixed until {until}: no withdrawal and no notice before then',
    'agreements.noticeGiven': 'Notice has been given already: {agreement} ends {effective}',
    'agreements.arrears': 'Overdue: {what}',
    'agreements.theyOwe': '{party} has not paid: {what}',
    'agreements.cannotEnd': '{agreement} cannot be ended by us: {why}',
    'agreements.claim': '{claim}: {owed} owed to {creditor} ({basis}), due {due}; next: {next}',
    'agreements.noObjection': '{claim} gives no objection',
    'agreements.objectedAlready': '{claim} has been objected to already',
    'agreements.objectionLate': 'the time to object to {claim} ran out on {by}',
    'agreements.noDeferral': '{claim} is not deferred (asked already, or its law does not)',
    'agreements.noHardship': '{claim} is not deferred: paying {owed} at once is no considerable hardship with {have} at hand (§ 222 AO)',
    'agreements.objectionNotYet': 'there is nothing to object to in {claim} yet: {when}',
    'agreements.claimSettled': '{claim} is settled: nothing is left to dispute',
    'agreements.canPay': 'we can pay {claim}: {have} EUR is above the {keep} EUR the law leaves us',
    'agreements.cannotRelent': '{claim} is not ours to let go',
    'agreements.noMoney': 'there is no money to pay with (needed: {need} EUR)',
    'agreements.creditRefused': 'The bank will not lend {amount} EUR: our debts would be {debts} + {amount} EUR, more than it lends against a net worth of {worth} EUR (at most {limit} EUR)',
    'agreements.overRepaid': 'Only {outstanding} EUR of {agreement} is outstanding',
    'agreements.subjectNeeded': '{product} is about a particular {kind}: name it',
    'agreements.wrongSubject': '{product} is about a {kind}, not {subject}',
    'agreements.beforeCourt': 'No bank lends to a borrower before the insolvency court',
    'agreements.notLendable': '{subject} cannot be lent now: {why}',
    'agreements.toSelf': 'One does not lend to oneself',
    'agreements.noBooks': '{party} keeps no books: a fee is paid from books into books (economy.openBooks)',
    'agreements.noParty': 'There is no party {party} (the parties are listed by parties.list: {known})',
    'agreements.noProposal': 'There is no such offer ({proposal})',
    'agreements.notToYou': 'That offer is not to {party}',
    'agreements.proposalLapsed': '{subject} is no longer offered: it is no longer theirs to lend, or lent to someone else',
    'agreements.subjectHeld': '{subject} is held by {agreement} already',
    'agreements.noSubject': '{product} is not about a particular thing',
    'agreements.onlyOne': 'There is only one {product}, and it is taken',
    'agreements.noWord': 'We cannot ask for {agreement}: {why}',
    'agreements.notOurs': '{agreement} is not held by {party}',
    'agreements.notTheirs': '{party} cannot let {subject}: it is held by {holder}',
    'agreements.noUseHere': '{product} is not offered here: {why}',
    'agreements.owesThem': '{party} gives no {product} while {owed} EUR is owed to them, overdue ({what}); paid, it can be asked for again'
  },
  commands: {
    'agreements.open': command(
      s.object({ product: s.string(), amount: s.number({ min: 0, unit: 'EUR' }).optional(), subject: s.ref().optional(), holder: s.ref('party').optional() }),
      (ctx: WriteCtx, p) => {
        const product = products(ctx)[p.product];
        if (!product) ctx.reject('agreements.unknownProduct', { product: p.product, offers: Object.keys(products(ctx)).join(', ') || 'none here' });
        const inst = instrumentOf(ctx, product!.instrument);
        // (a product of no use here is not sold: a monthly pass where no bus stops, Qwen S507)
        const useless = unusable(ctx, product!);
        if (useless) ctx.reject('agreements.noUseHere', { product: product!.label, why: useless });
        const min = product!.minAmount?.value ?? 0;
        if (inst.takesAmount && p.amount === undefined) ctx.reject('agreements.amountNeeded', { product: product!.label, min });
        if (p.amount !== undefined && p.amount < min) ctx.reject('agreements.amountTooSmall', { product: product!.label, min });
        if (p.amount !== undefined && product!.maxAmount && p.amount > product!.maxAmount.value) ctx.reject('agreements.amountTooLarge', { product: product!.label, max: product!.maxAmount.value });
        // a player opens for its own party; a world module setting a party up names it
        const holder = ctx.caller !== 'client' && p.holder ? p.holder : actorOf(ctx);
        if (p.holder && p.holder !== holder) ctx.reject('agreements.notOurs', { agreement: product!.label, party: partyLabel(ctx, holder) });
        // (nothing is opened for a party that ended, whoever asks: the one check; review y)
        mustBeLive(ctx, holder);
        // (asking for it is word to whoever offers it: it gets out by an office, a phone with charge, one beyond the map, S4)
        const noWord = ctx.setup ? undefined : wordBlock(ctx, holder);
        if (noWord) ctx.reject('agreements.noWord', { agreement: product!.label, why: noWord.why }, noWord.remedies);
        const no = inst.check?.(ctx, holder, resolveTerms(inst, p.product, product!), p.amount);
        if (no) ctx.reject(no.code, no.params, no.code === 'agreements.notEnoughCash' ? moneyRemedies(ctx, holder, (p.amount ?? 0) - Math.max(0, ctx.balance(acct(holder, ACCOUNTS.cash)))) : undefined);
        // what it is about: a thing of the product's kind, held by no other live agreement
        if (product!.subjectKind) {
          if (!p.subject) ctx.reject('agreements.subjectNeeded', { product: product!.label, kind: product!.subjectKind });
          if (ctx.entity(p.subject!)?.kind !== product!.subjectKind) ctx.reject('agreements.wrongSubject', { product: product!.label, kind: product!.subjectKind, subject: ctx.entity(p.subject!)?.name ?? p.subject! });
          // (another's, or one like it of ours: a holder may hold several, each for what it permits)
          const held = agreementsPort(ctx).about(p.subject!).find((id) => { const a = ctx.get('Agreement', id)!; return a.holder !== holder || a.product === p.product; });
          if (held) ctx.reject('agreements.subjectHeld', { subject: ctx.entity(p.subject!)?.name ?? p.subject!, agreement: ctx.get('Agreement', held)?.label ?? held });
          // only the one who holds it lets it: no rent to a farmer for land that is ours or another's
          const by = ctx.contributions('holders').map((c) => c.impl(ctx, p.subject!)).find((x): x is EntityId => Boolean(x));
          const offeredBy = ctx.state('agreements').parties[product!.party];
          if (by && offeredBy && by !== offeredBy) ctx.reject('agreements.notTheirs', { party: partyLabel(ctx, offeredBy), subject: ctx.entity(p.subject!)?.name ?? p.subject!, holder: partyLabel(ctx, by) });
        } else if (p.subject) ctx.reject('agreements.noSubject', { product: product!.label });
        if (product!.unique && [...ctx.all('Agreement')].some(([, x]) => x.product === p.product && x.status !== 'ended')) ctx.reject('agreements.onlyOne', { product: product!.label });
        const party = ctx.state('agreements').parties[product!.party];
        if (!party) throw new Error(`products.${p.product}: party '${product!.party}' is not in the counterparties of this world`);
        // (one who owes them, overdue, gets nothing more from them until it is paid: a landlord who has just ended a let for
        // rent in arrears, § 543 Abs. 2 Nr. 3 BGB, does not let again the same day while the arrears stand, Qwen S502)
        const overdue = [...ctx.all('Agreement')].filter(([, x]) => x.holder === holder && x.party === party).flatMap(([, x]) => x.open.filter((o) => o.payer === 'holder' && o.due < ctx.now && o.paid < o.amount).map((o) => ({ a: x, o })));
        const owing = round2(overdue.reduce((t, { o }) => t + o.amount - o.paid, 0));
        if (owing >= 0.01) ctx.reject('agreements.owesThem', { party: partyLabel(ctx, party), product: product!.label, owed: owing.toFixed(2), what: [...new Set(overdue.map(({ a }) => a.label))].map((l) => `${l}: ${overdue.filter(({ a }) => a.label === l).map(({ o }) => o.label).join('; ')}`).join('; ') }, moneyRemedies(ctx, holder, owing - Math.max(0, ctx.port('prices').liquidity(holder))));
        const startAt = product!.leadTime.value > 0 ? ctx.calendar.startOfDay(ctx.now) + Math.ceil(product!.leadTime.value) * DAY : ctx.now;
        const id = ctx.spawn('agreement', { name: product!.label });
        const a: Agreement = { instrument: product!.instrument, product: p.product, label: product!.label, holder, party, role: product!.role, ...(p.subject ? { subject: p.subject } : {}), terms: resolveTerms(inst, p.product, product!), status: 'pending', openedAt: ctx.now, start: startAt, open: [], nextObligation: 1, state: {}, ...(p.amount !== undefined ? { amount: round2(p.amount) } : {}) };
        ctx.set('Agreement', id, a);
        if (startAt <= ctx.now) inCommand(ctx, holder, () => start(ctx, id));
        else ctx.log('info', `${product!.label} with ${ctx.require('Party', party).label} applied for; it starts ${ctx.calendar.format(startAt, 'day')}.`, [id]);
        return { agreement: id, start: startAt };
      },
      { label: 'Open an agreement on offer', description: "Open an agreement a party offers (see the offers with their sourced terms: query agreements.offers): a deposit, a loan, renting a particular thing (name it as subject). Products that take an amount are opened with it; the agreement starts after the product's lead time." },
    ),
    'agreements.act': command(
      s.object({ agreement: s.ref('agreement'), action: s.string(), amount: s.number({ min: 0, unit: 'EUR' }).optional() }),
      (ctx: WriteCtx, p) => {
        const a = ctx.get('Agreement', p.agreement);
        if (!a) ctx.reject('agreements.unknownAgreement', { agreement: p.agreement });
        if (a!.status !== 'active' && a!.status !== 'ending') ctx.reject('agreements.notActive', { agreement: a!.label, status: a!.status });
        const inst = instrumentOf(ctx, a!.instrument);
        const action = inst.actions[p.action];
        // (ending it is not an action of it but notice: said; Qwen S195)
        if (!action) ctx.reject('agreements.unknownAction', { agreement: a!.label, action: p.action, actions: `${Object.keys(inst.actions).join(', ') || 'none'}; to end it, agreements.notice` });
        if (action!.amount && !(p.amount! > 0)) ctx.reject('agreements.amountNeeded', { product: a!.label, min: 0.01 });
        // (an action of the other side is that side's: a player acts on what it is the party to)
        if (action!.byParty) {
          if (ctx.caller === 'client' && a!.party !== actorOf(ctx)) ctx.reject('agreements.notOurs', { agreement: a!.label, party: partyLabel(ctx, actorOf(ctx)) });
        } else mustHold(ctx, a!);
        const i = instrumentCtx(ctx, p.agreement);
        inCommand(ctx, a!.holder, () => {
          inst.settle(i);
          action!.run(i, p.amount);
        });
        payDue(ctx, p.agreement);
      },
      { label: 'Act on an agreement', description: 'Do what an agreement allows, e.g. payIn or withdraw on a call deposit (each agreement lists its actions).' },
    ),
    'agreements.notice': command(
      s.object({ agreement: s.ref('agreement') }),
      (ctx: WriteCtx, p) => {
        const a = ctx.get('Agreement', p.agreement);
        if (!a) ctx.reject('agreements.unknownAgreement', { agreement: p.agreement });
        if (a!.notice) ctx.reject('agreements.noticeGiven', { agreement: a!.label, effective: ctx.calendar.format(a!.notice.effective, 'day') });
        if (a!.status !== 'active') ctx.reject('agreements.notActive', { agreement: a!.label, status: a!.status });
        // the other side of it, where it acts for itself (a lender asking for a tool back): its notice, by the terms
        const other = ctx.caller === 'client' && a!.party === actorOf(ctx) && a!.holder !== actorOf(ctx);
        if (!other) mustHold(ctx, a!);
        const inst = instrumentOf(ctx, a!.instrument);
        const effective = other
          ? (a!.terms.landlordNotice === undefined ? ctx.reject('agreements.cannotEnd', { agreement: a!.label, why: 'its terms give you no right to end it' }) : Math.min(a!.end ?? Infinity, ctx.now + Number(a!.terms.landlordNotice) * DAY))
          : inCommand(ctx, a!.holder, () => inst.notice(instrumentCtx(ctx, p.agreement), 'holder'));
        ctx.set('Agreement', p.agreement, { ...ctx.require('Agreement', p.agreement), status: 'ending', notice: { by: other ? 'party' : 'holder', given: ctx.now, effective } });
        if (effective <= ctx.now) close(ctx, p.agreement);
        else ctx.log('info', `Notice given: ${a!.label} ends ${ctx.calendar.format(effective, 'day')}.`, [p.agreement]);
        return { effective };
      },
      { label: 'Give notice', description: 'End an agreement under its terms: it ends when the notice period has run (some, like fixed-term deposits, cannot be ended early).' },
    ),
    // lending a thing for nothing (a tool to a neighbour; Leihe, §§ 598, 604 BGB), or letting it for a fee a day (Miete): offered by its holder, taken by the other
    'agreements.lend': command(
      s.object({ subject: s.ref(), to: s.ref('party'), days: s.number({ min: 1 }).optional(), fee: s.number({ min: 0, unit: 'EUR' }).optional() }),
      (ctx: WriteCtx, p) => {
        const from = actorOf(ctx);
        const by = ctx.contributions('holders').map((c) => c.impl(ctx, p.subject)).find((x): x is EntityId => Boolean(x));
        if (by !== from) ctx.reject('agreements.notTheirs', { party: partyLabel(ctx, from), subject: ctx.entity(p.subject)?.name ?? p.subject, holder: by ? partyLabel(ctx, by) : 'nobody' });
        if (p.to === from) ctx.reject('agreements.toSelf', {});
        const why = ctx.contributions('notLendable').map((c) => c.impl(ctx, p.subject)).find((x): x is string => Boolean(x));
        if (why) ctx.reject('agreements.notLendable', { subject: ctx.entity(p.subject)?.name ?? p.subject, why });
        if (!ctx.get('Party', p.to) || ctx.ended(p.to)) ctx.reject('agreements.noParty', { party: p.to, known: [...ctx.all('Party')].filter(([id]) => id !== from && !ctx.ended(id)).map(([id]) => id).sort().slice(0, 12).join(', ') });
        // (let for money: the fee comes into our books)
        if ((p.fee ?? 0) > 0 && !ctx.port('prices').hasBooks(from)) ctx.reject('agreements.noBooks', { party: partyLabel(ctx, from) });
        const held = agreementsPort(ctx).holderOf(p.subject);
        if (held) ctx.reject('agreements.subjectHeld', { subject: ctx.entity(p.subject)?.name ?? p.subject, agreement: ctx.get('Agreement', held)?.label ?? held });
        const st = ctx.state('agreements');
        const n = (st.offered ?? 0) + 1;
        const id = `offer-${n}`;
        ctx.patchState('agreements', { offered: n });
        // (an offer of a thing: for that thing and both its parties, it ends with any of them: the thing gone, its maker or
        // the one it is made to with nobody left; decision 0028, Qwen S508, § 153 BGB)
        ctx.spawn('proposal', { id, name: `${ctx.entity(p.subject)?.name ?? p.subject} offered to ${partyLabel(ctx, p.to)}`, for: [p.subject, from, p.to] });
        ctx.set('Proposal', id, { from, to: p.to, subject: p.subject, ...(p.days ? { days: p.days } : {}), ...((p.fee ?? 0) > 0 ? { fee: p.fee } : {}), at: ctx.now });
        // a party of the world's catalogues answers in its own time: it has no use for a thing it did not ask for (no
        // demand of theirs is modelled yet), and says so, rather than leaving it unanswered for ever (decision 0028, S503/S508)
        if (Object.values(st.parties).includes(p.to)) ctx.at(ctx.now + ANSWER_DAYS * DAY, 'answer', { proposal: id });
        ctx.log('info', `Offered (${id}): ${partyLabel(ctx, from)} would lend ${ctx.entity(p.subject)?.name ?? p.subject} to ${partyLabel(ctx, p.to)}${(p.fee ?? 0) > 0 ? ` for ${p.fee} EUR a day` : ''}${p.days ? ` for ${p.days} days` : ' until asked for it back'} (agreements.accept with this offer to take it).`, [p.subject, p.to, from]);
        return id;
      },
      { label: 'Lend a thing', description: 'Offer something of ours (a tool, a machine) to another party, for nothing or for a fee a day (fee, EUR), for some days or until we ask for it back (agreements.notice); they take it with agreements.accept. While lent, it is theirs to use and not ours; lent for nothing it is theirs to keep (its services and its month’s upkeep; breakdowns stay ours), let for a fee ours to keep; the fee is paid from their books into ours each day (for some days: all at once). It stays ours.' },
    ),
    'agreements.accept': command(
      s.object({ proposal: s.string() }),
      (ctx: WriteCtx, p) => {
        const pr = ctx.get('Proposal', p.proposal);
        if (!pr) ctx.reject('agreements.noProposal', { proposal: p.proposal });
        const to = actorOf(ctx);
        if (pr.to !== to) ctx.reject('agreements.notToYou', { party: partyLabel(ctx, to) });
        // (still theirs to lend, and lent to no one else meanwhile)
        const gone = lapsed(ctx, pr);
        if (gone) ctx.reject(gone.code, gone.params);
        // (still lendable: not offered for sale since)
        const why = ctx.contributions('notLendable').map((c) => c.impl(ctx, pr.subject)).find((x): x is string => Boolean(x));
        if (why) ctx.reject('agreements.notLendable', { subject: ctx.entity(pr.subject)?.name ?? pr.subject, why });
        ctx.destroy(p.proposal);
        const name = ctx.entity(pr.subject)?.name ?? pr.subject;
        // (a fee is paid from our books)
        if ((pr.fee ?? 0) > 0 && !ctx.port('prices').hasBooks(to)) ctx.reject('agreements.noBooks', { party: partyLabel(ctx, to) });
        const r = ctx.command('agreements.contract', { instrument: 'lease', label: `${name}, ${(pr.fee ?? 0) > 0 ? `let by ${partyLabel(ctx, pr.from)} for ${pr.fee} EUR a day` : `lent by ${partyLabel(ctx, pr.from)}`}`, holder: to, party: pr.from, role: 'lessee', subject: pr.subject, terms: { rent: pr.fee ?? 0, period: 'day', ...(pr.days ? { days: pr.days, endEarly: 'yes' } : {}), tenantNotice: 0, landlordNotice: 0 } });
        if (!r.ok) ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
        return r.ok ? (r.value as EntityId) : '';
      },
      { label: 'Take what is offered', description: 'Take something another party offers us (a tool lent for nothing or for a fee a day, paid from our books): it is ours to use from now, until its days are up or they ask for it back; we can give it back any time (agreements.notice).' },
    ),
    'agreements.decline': command(
      s.object({ proposal: s.string() }),
      (ctx: WriteCtx, p) => {
        const pr = ctx.get('Proposal', p.proposal);
        if (!pr) ctx.reject('agreements.noProposal', { proposal: p.proposal });
        const who = actorOf(ctx);
        if (pr.to !== who && pr.from !== who) ctx.reject('agreements.notToYou', { party: partyLabel(ctx, who) });
        ctx.destroy(p.proposal);
      },
      { label: 'Decline or withdraw an offer', description: 'Turn down what another party offers us, or take back what we offered.' },
    ),
    'agreements.contract': command(
      s.object({ instrument: s.string(), label: s.string(), holder: s.ref('party'), party: s.ref('party'), role: s.string(), subject: s.ref().optional(), terms: s.record(s.any<number | string | boolean>()), amount: s.number({ min: 0 }).optional(), start: s.number().optional(), behaviour: s.any<HiddenAgreement['behaviour']>().optional() }),
      (ctx: WriteCtx, p) => {
        const inst = instrumentOf(ctx, p.instrument);
        if (!inst.roles.includes(p.role)) throw new Error(`agreements.contract: role '${p.role}' is not one of the ${inst.id} instrument's`);
        for (const x of [p.holder, p.party]) if (!ctx.get('Party', x)) throw new Error(`agreements.contract: no party ${x}`);
        // (no agreement is made with a party that ended, by a market or a module; one the law imposes, a claim, is had against
        // its estate all the same: the one check, review y)
        if (!inst.imposed) for (const x of [p.holder, p.party]) mustBeLive(ctx, x);
        const startAt = Math.max(ctx.now, p.start ?? ctx.now);
        const id = ctx.spawn('agreement', { name: p.label });
        if (p.subject && agreementsPort(ctx).holderOf(p.subject)) throw new Error(`agreements.contract: ${p.subject} is held by another agreement`);
        ctx.set('Agreement', id, { instrument: p.instrument, label: p.label, holder: p.holder, party: p.party, role: p.role, ...(p.subject ? { subject: p.subject } : {}), terms: p.terms, status: 'pending', openedAt: ctx.now, start: startAt, open: [], nextObligation: 1, state: {}, ...(p.amount !== undefined ? { amount: round2(p.amount) } : {}) });
        if (p.behaviour) setHidden(ctx, id, { behaviour: p.behaviour });
        if (startAt <= ctx.now) start(ctx, id);
        // (held now: other offers of it stand no more)
        if (p.subject) lapseOffers(ctx, p.subject);
        return id;
      },
      { label: 'An agreement a market model makes with a party (internal: players open products)', internal: true },
    ),
  },
  systems: [
    { id: 'settle', every: DAY, offset: 0, phase: 'economy', run: (ctx) => daily(ctx) },
    // the administrator goes on with what was asked for before the opening and begins only now
    { id: 'windUp', every: DAY, offset: 9 * HOUR, phase: 'agents', run: (ctx) => ctx.port('prices').woundUp().forEach((p) => windUp(ctx, p)) },
  ],
  // an offer of a thing gone, or to or from a party that ended, is offered no more (decision 0028, Qwen S508): spawned for
  // all three (one sold or lent to another meanwhile: `lapseOffers`)
  ended: {
    proposal: (ctx, id, cause) => {
      const pr = ctx.get('Proposal', id);
      if (pr) ctx.log('info', `${ctx.entity(id)?.name ?? id} is no longer offered: ${cause.owner === pr.subject ? cause.why : `${partyLabel(ctx, cause.owner)}, ${cause.why}`}.`, [id, pr.from, pr.to]);
      ctx.destroy(id);
    },
  },
  timers: {
    // a party of the world's catalogues answers an offer in its own time: it has no use for it (S503/S508)
    answer(ctx, payload: { proposal: string }) {
      const pr = ctx.get('Proposal', payload.proposal);
      if (!pr) return;
      ctx.log('info', `${partyLabel(ctx, pr.to)} declines ${ctx.entity(payload.proposal)?.name ?? payload.proposal}: it has no use for it now.`, [payload.proposal, pr.from, pr.to]);
      ctx.destroy(payload.proposal);
    },
  },
  on: {
    // insolvency proceedings opened: the administrator ends what the party rents, at the latest after the law's cap (§ 109 InsO)
    'economy.insolvencyOpened': (ctx, p) => windUp(ctx, p.party),
    // a party that ended, nobody left of it: its agreements are its estate's, wound up in the law's way (review y)
    'entity.ended': (ctx, e) => {
      if (ctx.get('Party', e.id)) windUp(ctx, e.id, 'estate');
    },
  },
  branch(ctx) {
    for (const [id, a] of [...ctx.all('Agreement')]) {
      if (a.status === 'ended') continue;
      instrumentOf(ctx, a.instrument).branch?.(instrumentCtx(ctx, id));
    }
  },
  setup(ctx) {
    const parties: Record<string, EntityId> = {};
    for (const [id, c] of Object.entries(ctx.hasData('counterparties') ? (ctx.data('counterparties') ?? {}) : {})) {
      // a counterparty of the catalog is a party with the catalog's id: a world can name it (as a holder of land …)
      const r = ctx.command('parties.add', { id, label: c.label, kind: c.kind, catalog: id });
      if (!r.ok) throw new Error(`counterparty ${id}: ${JSON.stringify(r.reasons)}`);
      parties[id] = r.value;
    }
    ctx.setState('agreements', { parties, hidden: {} });
    // every product names a party and an instrument of this world, and has the terms its instrument needs
    for (const [id, p] of Object.entries(products(ctx))) {
      if (!parties[p.party]) throw new Error(`products.${id}: unknown party '${p.party}'`);
      const inst = instrumentOf(ctx, p.instrument);
      if (!inst.roles.includes(p.role)) throw new Error(`products.${id}: role '${p.role}' is not one of the ${inst.id} instrument's (${inst.roles.join(', ')})`);
      resolveTerms(inst, id, p);
    }
  },
  ports: { agreements: agreementsPort },
  projections: {
    'agreements.list': { label: "A party's agreements (deposits, loans, leases …) with balances, terms, open items and actions", description: 'args: party (whose; default: every party)', compute: (read: ReadCtx, args: Record<string, unknown>) => agreementsPort(read).agreements(typeof args.party === 'string' ? args.party : undefined) },
    'agreements.offers': { label: 'What the parties of the world offer (products with their sourced terms)', compute: (read: ReadCtx) => agreementsPort(read).offers() },
    'agreements.proposals': {
      label: 'What parties offer each other and is not taken yet (a tool lent): to and from a party',
      description: 'args: party (whose offers to and from; default: all)',
      compute: (read: ReadCtx, args: Record<string, unknown>) =>
        [...read.all('Proposal')]
          .filter(([, x]) => (typeof args.party !== 'string' || x.to === args.party || x.from === args.party) && !lapsed(read, x))
          .map(([id, x]) => ({ id, from: x.from, fromLabel: partyLabel(read, x.from), to: x.to, toLabel: partyLabel(read, x.to), subject: x.subject, what: read.entity(x.subject)?.name ?? x.subject, ...(x.days ? { days: x.days } : {}), ...(x.fee ? { fee: x.fee } : {}), at: x.at })),
    },
  },
});
