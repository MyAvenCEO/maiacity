/** Finance: cash curve (last 30 days), monthly cash flow by category, ledger. */
import type { LedgerAccount, LedgerEntry } from '../../../../../../packages/kernel/src/index.ts';
import type { CashflowMonth } from '../../../../../../packages/economy/src/index.ts';
import type { AgreementView, OfferView } from '../../../../../../packages/agreements/src/index.ts';
import { useMemo, useState } from 'preact/hooks';
import { Button, ConfirmButton, Section, Stat } from '../../components/common.tsx';
import { DataTable, type Column } from '../../components/Table.tsx';
import { dateShort, dateTime, eur, eurK, monthLabel, num } from '../../format.ts';
import { useProjection, useQuery, useWidth } from '../../hooks.ts';
import { command, frame } from '../../state.ts';

interface LedgerResult {
  accounts: LedgerAccount[];
  entries: LedgerEntry[];
  cashflow: CashflowMonth[];
}
interface Summary {
  cash: number;
  creditLimit: number;
  liquidity: number;
  priceIndex: number;
  fixedAssets: number;
  totalExpenses: number;
  totalIncome: number;
  netWorth: number;
  market?: { month: string; level: number; threeMonthsAgo: number; source: string };
}

/** the construction market in words: how busy against normal, and where it is heading */
function marketLine(m: NonNullable<Summary['market']>): string {
  const pct = Math.round(m.level * 100);
  const d = m.level - m.threeMonthsAgo;
  const mood = m.level >= 1.08 ? 'boom' : m.level <= 0.92 ? 'slump' : 'normal';
  return `market ${pct} % (${mood}) ${d > 0.01 ? '↑' : d < -0.01 ? '↓' : '→'}`;
}

/** expense categories (fixed order → fixed colours, dark-surface categorical palette) */
const CATS: { id: string; label: string; color: string; accounts: string[] }[] = [
  { id: 'labour', label: 'Labour', color: '#3987e5', accounts: ['expense:labour'] },
  { id: 'plant', label: 'Plant & fuel', color: '#d95926', accounts: ['expense:equipment-owning', 'expense:equipment-repair', 'expense:equipment-rental', 'expense:fuel'] },
  { id: 'materials', label: 'Materials', color: '#199e70', accounts: ['expense:materials'] },
  { id: 'haul', label: 'Transport & disposal', color: '#c98500', accounts: ['expense:transport', 'expense:disposal'] },
  { id: 'other', label: 'Services & overhead', color: '#d55181', accounts: ['expense:services', 'expense:interest', 'expense:overhead'] },
];
const INCOME_COLOR = '#9085e9';

function CashCurve({ entries, cashNow, now }: { entries: LedgerEntry[]; cashNow: number; now: number }) {
  const [box, W] = useWidth<HTMLDivElement>(400);
  const H = 150;
  const pad = { l: 52, r: 8, t: 10, b: 18 };
  const [hx, setHx] = useState<number | null>(null);
  const pts = useMemo(() => {
    const out: [number, number][] = [[now, cashNow]];
    let c = cashNow;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const e = entries[i]!;
      if (e.from === 'cash') c += e.amount;
      else if (e.to === 'cash') c -= e.amount;
      else continue;
      out.push([e.t, c]);
    }
    return out.reverse();
  }, [entries, cashNow, now]);
  if (pts.length < 2) return <div ref={box} class="empty">No cash movements yet.</div>;
  const t0 = pts[0]![0];
  const t1 = Math.max(now, t0 + 3600);
  let lo = Math.min(...pts.map((p) => p[1]), 0);
  let hi = Math.max(...pts.map((p) => p[1]));
  const span = Math.max(1000, hi - lo);
  lo -= span * 0.05;
  hi += span * 0.08;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  let d = '';
  pts.forEach(([t, v], i) => {
    d += i === 0 ? `M${x(t)},${y(v)}` : `H${x(t)}V${y(v)}`;
  });
  d += `H${x(t1)}`;
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const hover = hx !== null ? pts.filter((p) => x(p[0]) <= hx).pop() : null;
  return (
    <div ref={box} class="chart">
      <svg
        width={W}
        height={H}
        onMouseMove={(e) => setHx((e as MouseEvent).offsetX)}
        onMouseLeave={() => setHx(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line class="grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text class="axis" x={pad.l - 4} y={y(v) + 3} text-anchor="end">
              {eurK(v)}
            </text>
          </g>
        ))}
        {lo < 0 && <line class="baseline" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />}
        <text class="axis" x={pad.l} y={H - 4}>
          {dateShort(t0)}
        </text>
        <text class="axis" x={W - pad.r} y={H - 4} text-anchor="end">
          {dateShort(t1)}
        </text>
        <path class="cash-line" d={d} />
        {hover && (
          <g>
            <line class="ls-cross" x1={hx!} x2={hx!} y1={pad.t} y2={H - pad.b} />
            <circle class="ls-dot" cx={hx!} cy={y(hover[1])} r="3" />
          </g>
        )}
      </svg>
      <div class="chart-cap small muted num">{hover ? `${dateTime(hover[0])} · ${eur(hover[1])}` : 'Cash balance, last 30 days (hover for values)'}</div>
    </div>
  );
}

function MonthlyBars({ months }: { months: CashflowMonth[] }) {
  const [box, W] = useWidth<HTMLDivElement>(400);
  const H = 150;
  const pad = { l: 52, r: 8, t: 10, b: 18 };
  const [hover, setHover] = useState<number | null>(null);
  const data = months.slice(-8).map((m) => {
    const cats = CATS.map((c) => ({ ...c, v: c.accounts.reduce((a, acc) => a + Math.max(0, m.byAccount[acc] ?? 0), 0) }));
    return { month: m.month, cats, income: m.income, expenses: m.expenses };
  });
  if (!data.length) return <div ref={box} class="empty">No months yet.</div>;
  const max = Math.max(1000, ...data.map((d) => Math.max(d.cats.reduce((a, c) => a + c.v, 0), d.income))) * 1.08;
  const ih = H - pad.t - pad.b;
  const groupW = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(26, groupW * 0.32);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const hv = hover !== null ? data[hover] : null;
  return (
    <div ref={box} class="chart">
      <svg width={W} height={H} onMouseLeave={() => setHover(null)}>
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line class="grid" x1={pad.l} x2={W - pad.r} y1={y(max * f * 0.92)} y2={y(max * f * 0.92)} />
            <text class="axis" x={pad.l - 4} y={y(max * f * 0.92) + 3} text-anchor="end">
              {eurK(max * f * 0.92)}
            </text>
          </g>
        ))}
        <line class="baseline" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
        {data.map((d, i) => {
          const gx = pad.l + i * groupW + groupW / 2;
          let acc = 0;
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)}>
              <rect class="g-hit" x={gx - groupW / 2} y={pad.t} width={groupW} height={ih} />
              {d.cats.map((c) => {
                if (c.v <= 0) return null;
                const y0 = y(acc);
                acc += c.v;
                const y1 = y(acc);
                return <rect key={c.id} x={gx - bw - 1} y={y1} width={bw} height={Math.max(0, y0 - y1 - 1.5)} fill={c.color} rx={1.5} />;
              })}
              {d.income > 0 && <rect x={gx + 1} y={y(d.income)} width={bw} height={Math.max(0, y(0) - y(d.income))} fill={INCOME_COLOR} rx={1.5} />}
              <text class="axis" x={gx} y={H - 4} text-anchor="middle">
                {monthLabel(d.month).slice(0, 3)}
              </text>
            </g>
          );
        })}
      </svg>
      <div class="legend small">
        {hv ? (
          <span class="num">
            <b>{monthLabel(hv.month)}</b> · expenses {eur(hv.expenses)}
            {hv.cats
              .filter((c) => c.v > 0)
              .map((c) => (
                <span key={c.id}>
                  {' '}
                  · <i class="sw" style={{ background: c.color }} /> {c.label} {eurK(c.v)}
                </span>
              ))}{' '}
            · <i class="sw" style={{ background: INCOME_COLOR }} /> income {eurK(hv.income)}
          </span>
        ) : (
          <>
            {CATS.map((c) => (
              <span key={c.id}>
                <i class="sw" style={{ background: c.color }} /> {c.label}
              </span>
            ))}
            <span>
              <i class="sw" style={{ background: INCOME_COLOR }} /> Income
            </span>
          </>
        )}
      </div>
    </div>
  );
}

const termText = (t: { value: number | string | boolean; unit: string }) => (t.unit === '1/a' ? `${num(Number(t.value) * 100, 2)} %/a` : t.unit === 'd' ? `${num(Number(t.value))} d` : t.unit ? `${String(t.value)} ${t.unit}` : String(t.value));

/** what the banks (and later others) offer, and our agreements with them */
function Agreements() {
  const { data: offers } = useProjection<OfferView[]>('agreements.offers', 10000);
  const { data: ours } = useProjection<AgreementView[]>('agreements.list', 2000);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const amountOf = (key: string, fallback: number) => amounts[key] ?? fallback;
  const amountInput = (key: string, fallback: number) => (
    <input class="inp num w80" type="number" min="0" step="1000" value={amountOf(key, fallback)} onInput={(e) => setAmounts({ ...amounts, [key]: Number((e.currentTarget as HTMLInputElement).value) })} title="EUR" />
  );
  const live = (ours ?? []).filter((a) => a.status !== 'ended');
  return (
    <Section title="Agreements" right={<span class="small muted">deposits, loans, leases — with the banks and others of the world</span>}>
      {live.length > 0 && (
        <table class="tbl tbl-mini">
          <tbody>
            {live.map((a) => (
              <tr key={a.id}>
                <td title={`${a.party} · ${a.instrument}`}>
                  {a.label} <span class="small muted">{a.status !== 'active' ? `(${a.status})` : ''}</span>
                  <div class="small muted">{a.summary}</div>
                </td>
                <td class="num">{eur(a.balance, 0)}</td>
                <td>
                  <span class="row">
                    {a.actions.map((x) =>
                      x.amount ? (
                        <span key={x.id} class="row">
                          {amountInput(`${a.id}:${x.id}`, 10000)}
                          <Button small tip={x.description} onClick={() => void command('agreements.act', { agreement: a.id, action: x.id, amount: amountOf(`${a.id}:${x.id}`, 10000) }, `${a.label}: ${x.label}`)}>
                            {x.label}
                          </Button>
                        </span>
                      ) : (
                        <Button key={x.id} small tip={x.description} onClick={() => void command('agreements.act', { agreement: a.id, action: x.id }, `${a.label}: ${x.label}`)}>
                          {x.label}
                        </Button>
                      ),
                    )}
                    {a.status === 'active' && (
                      <ConfirmButton kind="default" onConfirm={() => void command('agreements.notice', { agreement: a.id }, `${a.label}: notice`)} tip="End it under its terms">
                        Notice
                      </ConfirmButton>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table class="tbl tbl-mini">
        <tbody>
          {(offers ?? []).map((o) => (
            <tr key={o.id}>
              <td title={o.terms.map((t) => `${t.label}: ${termText(t)}${t.source ? ` (${t.source})` : ''}`).join('\n')}>
                {o.label} <span class="small muted">· {o.party}</span>
                <div class="small muted">
                  {o.terms.map((t) => `${t.label} ${termText(t)}`).join(' · ')}
                  {o.minAmount ? ` · from ${eurK(o.minAmount)}` : ''}
                </div>
              </td>
              <td>
                <span class="row">
                  {amountInput(o.id, Math.max(o.minAmount ?? 0, 50000))}
                  <ConfirmButton kind="default" onConfirm={() => void command('agreements.open', { product: o.id, amount: amountOf(o.id, Math.max(o.minAmount ?? 0, 50000)) }, `Open ${o.label}`)} tip={`Starts ${o.leadTime > 0 ? `in ${o.leadTime} d` : 'at once'}`}>
                    Open
                  </ConfirmButton>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export function FinanceTab() {
  const { data } = useQuery<LedgerResult>({ kind: 'ledger' }, 3000);
  const { data: sum } = useProjection<Summary>('economy.summary', 3000);
  const f = frame.value;
  const now = f?.t ?? 0;
  const accLabel = (id: string) => data?.accounts.find((a) => a.id === id)?.label ?? id;
  const entries = data?.entries ?? [];
  const rows = entries.map((e, i) => ({ ...e, key: `${e.t}:${i}` })).reverse();
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 't', label: 'Time', render: (e) => dateTime(e.t), sort: (e) => e.t },
    { key: 'amt', label: 'Amount', render: (e) => <span class={e.from === 'cash' ? 'c-bad' : e.to === 'cash' ? 'c-good' : ''}>{e.from === 'cash' ? '−' : e.to === 'cash' ? '+' : ''}{eur(e.amount, 2)}</span>, sort: (e) => (e.from === 'cash' ? -e.amount : e.amount), align: 'right' },
    { key: 'memo', label: 'Memo', render: (e) => <span class="ellipsis" title={e.memo}>{e.memo}</span>, sort: (e) => e.memo },
    { key: 'acc', label: 'Account', render: (e) => accLabel(e.from === 'cash' ? e.to : e.from), sort: (e) => accLabel(e.from === 'cash' ? e.to : e.from) },
  ];
  return (
    <div class="split finance">
      <div class="split-l fin-charts">
        {sum && (
          <div class="stat-grid stat-grid-4">
            <Stat label="Cash" value={eurK(sum.cash)} tone={sum.cash < 0 ? 'bad' : undefined} />
            <Stat label="Credit line" value={eurK(sum.creditLimit)} sub={`liquidity ${eurK(sum.liquidity)}`} />
            <Stat label="Fixed assets" value={eurK(sum.fixedAssets)} sub={`net worth ${eurK(sum.netWorth)}`} />
            <Stat label="Price index" value={num(sum.priceIndex, 3)} sub={sum.market ? marketLine(sum.market) : `spent ${eurK(sum.totalExpenses)}`} tip={sum.market ? `Construction activity in ${sum.market.month}: ${num(sum.market.level, 3)} of normal (3 months before ${num(sum.market.threeMonthsAgo, 3)}). In a boom firms are booked further ahead and prices rise; in a slump the reverse. Source: ${sum.market.source}` : undefined} />
          </div>
        )}
        <CashCurve entries={entries} cashNow={f?.hud.cash ?? 0} now={now} />
        <MonthlyBars months={data?.cashflow ?? []} />
        <Agreements />
      </div>
      <div class="split-r grow">
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.key} initialSort={{ key: 't', dir: -1 }} filterPlaceholder="Filter ledger…" />
      </div>
    </div>
  );
}
