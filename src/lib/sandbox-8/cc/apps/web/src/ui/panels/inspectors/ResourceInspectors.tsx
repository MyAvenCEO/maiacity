/** Machine, person, store and order inspectors. */
import type { Explained } from '../../../../../../packages/kernel/src/index.ts';
import type { ComponentChildren } from 'preact';
import type { Machine, MachineModel } from '../../../../../../packages/equipment/src/index.ts';
import type { Employment, Person, Presence } from '../../../../../../packages/workforce/src/index.ts';
import type { Order, Store } from '../../../../../../packages/inventory/src/index.ts';
import { useState } from 'preact/hooks';
import { BlockerList } from '../../components/Blockers.tsx';
import { Button, ConfirmButton, Empty, Icon, KV, Pill, Progress, Section } from '../../components/common.tsx';
import { EntityLink } from '../../components/EntityLink.tsx';
import { XNum } from '../../components/Explain.tsx';
import { cal, date, dateTime, eur, hours, num, qty, relative, tonnes } from '../../format.ts';
import { command, frame, moveTargetFor, tool, world } from '../../state.ts';
import type { InspectResult } from '../../../protocol.ts';
import { openOrderDialog } from '../drawer/MaterialsTab.tsx';

function Assignment({ data }: { data: InspectResult }) {
  const a = data.details?.assignment as { package: string; role: string; label: string } | undefined;
  if (!a) return <span class="muted">unassigned</span>;
  return (
    <span>
      <EntityLink id={a.package} kind="workPackage">
        {a.label}
      </EntityLink>
      <span class="muted small"> · {a.role}</span>
    </span>
  );
}

export function MachineInspector({ data }: { data: InspectResult }) {
  const m = data.components.Machine as Machine;
  // (its tank is a holding of its own: the inspector is told what is in it)
  const fuel = (data.details?.fuel as number | undefined) ?? 0;
  const model = data.details?.model as MachineModel | undefined;
  const id = data.meta.id;
  const now = frame.value?.t ?? 0;
  const tank = model?.engine?.tankSize.value ?? 0;
  const svc = model?.engine?.serviceInterval.value ?? model?.wear?.careEvery.value ?? 0;
  const market = data.details?.marketValue as { value: number; explain: Explained; provenance: { kind: string; source: string; note?: string }; expectedDays: number } | undefined;
  return (
    <>
      <div class="insp-sum">
        <Pill status={m.status} />
        <span class="muted">{m.ownership}</span>
        {m.until !== undefined && m.until > now && <span class="small muted">until {dateTime(m.until).slice(3)}</span>}
      </div>
      <BlockerList blockers={data.blockers} />
      <KV
        rows={[
          ['Model', model ? `${model.label}` : m.model],
          ['Power / weight', model ? `${model.engine ? `${num(model.engine.power.value)} kW · ` : ''}${num(model.operatingWeight.value, model.operatingWeight.value < 0.1 ? 4 : 1)} t` : '–'],
          ['Assignment', <Assignment data={data} />],
          [model?.engine ? 'Engine hours' : 'Hours of use', model?.wear ? `${hours(m.engineHours, 0)} of ${hours(model.wear.life.value, 0)}` : hours(m.engineHours, 0)],
          [model?.engine ? 'Since service' : 'Since care', svc ? `${hours(m.hoursSinceService, 0)} of ${hours(svc, 0)}` : hours(m.hoursSinceService, 0)],
          [
            'Fuel',
            <span>
              {num(fuel, 0)} l{tank ? ` / ${num(tank)} l` : ''}
            </span>,
          ],
          ['Hourly cost', <XNum tree={data.details?.hourlyCostExplain as Explained | undefined} title="Machine cost per operating hour (excl. operator)">{qty(data.details?.hourlyCost as number, 'EUR/h', 2)}</XNum>],
          ...(m.ownership === 'rented' && model?.rentalPerDay ? ([['Rental', `${eur(model.rentalPerDay.value)} / day`]] as [string, string][]) : []),
          ...(m.bookValue !== undefined ? ([['Book value', eur(m.bookValue)]] as [string, string][]) : []),
          ...(market ? ([['Market value', <span title={`${market.provenance.kind}: ${market.provenance.source}${market.provenance.note ? ` — ${market.provenance.note}` : ''}`}><XNum tree={market.explain} title="What the used-plant market would pay">{eur(market.value)}</XNum> <span class="small muted">a buyer in ~{num(market.expectedDays)} d</span></span>]] as [string, ComponentChildren][]) : []),
          ['Acquired', dateTime(m.acquiredAt)],
        ]}
      />
      {tank > 0 && <Progress value={fuel / tank} tone={fuel / tank < 0.15 ? 'bad' : 'info'} label="fuel level" thin />}
      <div class="row actions">
        <Button
          small
          onClick={() => {
            moveTargetFor.value = id;
            tool.value = 'moveTarget';
          }}
          tip="Then click the destination on the map (Esc cancels)"
        >
          <Icon name="move" size={12} /> Move to…
        </Button>
        {m.ownership === 'rented' ? (
          <ConfirmButton onConfirm={() => void command('equipment.release', { machine: id }, 'Rental returned')} tip="Return to the rental company (stops daily rent)">
            Return rental
          </ConfirmButton>
        ) : m.listing ? (
          <Button small onClick={() => void command('equipment.withdrawListing', { machine: id }, 'Off the market')} tip="Withdraw the sale offer">
            Withdraw sale ({eur(m.listing.ask)})
          </Button>
        ) : (
          <SellButton id={id} value={market?.value} />
        )}
      </div>
    </>
  );
}

/** offer a machine of ours on the used-plant market: at its market value, or at an asking price */
function SellButton({ id, value }: { id: string; value?: number }) {
  const [ask, setAsk] = useState<number | ''>('');
  return (
    <span class="row">
      <input class="inp num w80" type="number" min="1" step="1000" placeholder={value !== undefined ? String(value) : 'market value'} value={ask} onInput={(e) => setAsk((e.currentTarget as HTMLInputElement).value === '' ? '' : Number((e.currentTarget as HTMLInputElement).value))} title="Asking price in EUR (empty: what the market values it at); a higher ask waits longer for a buyer" />
      <ConfirmButton kind="default" onConfirm={() => void command('equipment.sell', { machine: id, ...(ask !== '' ? { ask } : {}) }, 'For sale')} tip="Offer it on the used-plant market; buyers come over time and collect it">
        Sell
      </ConfirmButton>
    </span>
  );
}

export function PersonInspector({ data }: { data: InspectResult }) {
  const p = data.components.Person as Person;
  const emp = data.components.Employment as Employment | undefined;
  const pres = data.components.Presence as Presence | undefined;
  const id = data.meta.id;
  const now = frame.value?.t ?? 0;
  const year = cal()?.at(now).year ?? 2027;
  const quals = (data.details?.qualificationLabels as string[] | undefined) ?? p.certificates ?? [];
  const courses = (data.details?.courses as { id: string; label: string; grants: string[]; held: boolean; workdays: number; price: number; leadTime: number; why?: string }[] | undefined) ?? [];
  const enrolment = data.details?.enrolment as { label: string; from: number; until: number } | undefined;
  const skills = (data.details?.skills as { id: string; label: string; hours: number; level: number; allowed: boolean; certificate: boolean }[] | undefined) ?? [];
  const status = emp && emp.hiredAt > now ? 'recruiting' : (pres?.status ?? 'available');
  return (
    <>
      <div class="insp-sum">
        <Pill status={status} />
        <span class="muted">{(data.details?.jobLabel as string) ?? emp?.job}</span>
        {pres?.until !== undefined && pres.until > now && <span class="small muted">until {date(pres.until)}</span>}
      </div>
      <KV
        rows={[
          ['Job', (data.details?.jobLabel as string) ?? emp?.job ?? '–'],
          ['Age', `${year - p.birthYear}`],
          ['Assignment', <Assignment data={data} />],
          ['Wage', emp ? `${eur(emp.hourlyWage, 2)} / h` : '–'],
          ['Employer cost', <XNum tree={data.details?.hourlyCostExplain as Explained | undefined} title="Employer cost per paid hour">{qty(data.details?.hourlyCost as number, 'EUR/h', 2)}</XNum>],
          ['Vacation left', pres ? `${num(pres.vacationDaysLeft)} d` : '–'],
          ['Sick days (year)', pres ? `${num(pres.sickDaysThisYear)} d` : '–'],
          ...(emp?.hiredAt !== undefined ? ([['Hired', date(emp.hiredAt)]] as [string, string][]) : []),
          ...(emp?.leavesAt !== undefined ? ([['Leaves', date(emp.leavesAt)]] as [string, string][]) : []),
        ]}
      />
      <Section title="Skills" right={<span class="small muted">practice on the learning curve (an expert = 100 %)</span>}>
        <table class="tbl tbl-mini">
          <tbody>
            {skills.map((s) => (
              <tr key={s.id}>
                <td>{s.label}</td>
                <td class="num">{num(s.hours, 0)} h</td>
                <td class="num" title="How practised: a person's own knack shows in their work (the rate explains of their packages)">
                  {num(s.level * 100, 0)} %
                </td>
                <td class="small muted">{s.certificate ? (s.allowed ? 'certified' : 'needs a certificate') : s.allowed ? '' : 'needs first practice'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Certificates">
        <div class="chips">
          {quals.length ? (
            quals.map((q) => (
              <span key={q} class="chip">
                {q}
              </span>
            ))
          ) : (
            <span class="small muted">none</span>
          )}
        </div>
      </Section>
      {courses.length > 0 && (
        <Section title="Courses" right={<span class="small muted">certificates; the fee is paid on enrolment</span>}>
          {enrolment && (
            <p class="small">
              Enrolled in {enrolment.label}: away {date(enrolment.from)} – {date(enrolment.until)}
            </p>
          )}
          <table class="tbl tbl-mini">
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td title={c.grants.join(', ')}>{c.label}</td>
                  <td class="num small">{c.workdays} d away · starts in ~{c.leadTime} d</td>
                  <td class="num">{eur(c.price, 0)}</td>
                  <td>
                    {c.held || c.why ? (
                      <span class="small muted" title={c.why}>
                        {c.held ? 'held' : '–'}
                      </span>
                    ) : (
                      <ConfirmButton kind="default" small onConfirm={() => void command('workforce.enrol', { person: id, course: c.id }, `${p.name}: enrolled in ${c.label}`)} tip={`Enrol ${p.name}: ${eur(c.price, 0)} now, away ${c.workdays} working days`}>
                        Enrol
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {emp && !emp.leavesAt && (
        <div class="row actions">
          <ConfirmButton onConfirm={() => void command('workforce.dismiss', { person: id }, 'Notice given')} tip="Give notice (statutory notice period applies)">
            Dismiss
          </ConfirmButton>
        </div>
      )}
      {emp?.leavesAt !== undefined && emp.leavesAt > now && (
        <div class="row actions">
          <Button small onClick={() => void command('workforce.withdrawNotice', { person: id }, `${p.name} stays`)}>
            Take back the notice
          </Button>
        </div>
      )}
    </>
  );
}

function matInfo(id: string) {
  return world.value?.materials.find((m) => m.id === id);
}

function DisposeRow({ store, material, qty: have, unit }: { store: string; material: string; qty: number; unit: string }) {
  const [amount, setAmount] = useState(Math.floor(have));
  return (
    <div class="row">
      <input class="inp num w80" type="number" min={0} max={have} value={amount} onInput={(e) => setAmount(Number((e.currentTarget as HTMLInputElement).value))} />
      <span class="small muted">{unit}</span>
      <Button small onClick={() => void command('inventory.dispose', { store, material, qty: Math.min(have, amount) }, 'Haul-off ordered')} tip="Order trucks to haul this material to the nearest disposal site (costs transport + tipping fee)">
        Haul off
      </Button>
    </div>
  );
}

export function StoreInspector({ data }: { data: InspectResult }) {
  const st = data.components.Store as Store;
  const id = data.meta.id;
  const [disposing, setDisposing] = useState<string | null>(null);
  const rows = Object.entries(st.contents).filter(([, v]) => v > 1e-6);
  let total = 0;
  for (const [m, v] of rows) {
    const info = matInfo(m);
    total += info?.unit === 't' ? v : info?.unit === 'm3' ? v * (info.density ?? 1.8) : 0;
  }
  return (
    <>
      <div class="insp-sum">
        <span class="pill tone-info">{st.kind}</span>
        <span class="num">{tonnes(total)}</span>
      </div>
      {rows.length ? (
        <table class="tbl tbl-mini">
          <thead>
            <tr>
              <th>Material</th>
              <th class="al-right">Quantity</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(([m, v]) => {
              const info = matInfo(m);
              const soil = info?.category === 'soil';
              return (
                <>
                  <tr key={m}>
                    <td>
                      {info?.color && <i class="sw" style={{ background: info.color }} />} {info?.label ?? m}
                    </td>
                    <td class="al-right num">{qty(v, info?.unit, info?.unit === 'pcs' ? 0 : 1)}</td>
                    <td class="al-right">
                      {soil && (
                        <button class="lnk" onClick={() => setDisposing(disposing === m ? null : m)} title="Dispose of surplus soil">
                          dispose…
                        </button>
                      )}
                    </td>
                  </tr>
                  {disposing === m && (
                    <tr key={`${m}-d`}>
                      <td colSpan={3}>
                        <DisposeRow store={id} material={m} qty={v} unit={info?.unit ?? ''} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      ) : (
        <Empty>Empty.</Empty>
      )}
      <div class="row actions">
        <Button small onClick={() => openOrderDialog({ store: id })}>
          Order material…
        </Button>
      </div>
    </>
  );
}

export function OrderInspector({ data }: { data: InspectResult }) {
  const o = data.components.Order as Order;
  const id = data.meta.id;
  const info = matInfo(o.material);
  const now = frame.value?.t ?? 0;
  return (
    <>
      <div class="insp-sum">
        <Pill status={o.status} />
        <span class="muted">{o.direction === 'outbound' ? 'haul-off' : 'purchase'}</span>
      </div>
      <BlockerList blockers={data.blockers} />
      <KV
        rows={[
          ['Material', info?.label ?? o.material],
          ['Quantity', qty(o.qty, info?.unit)],
          ['Delivered', qty(o.delivered, info?.unit)],
          ['In transit', qty(o.inTransit, info?.unit)],
          ['Unit price', qty(o.unitPrice, `EUR/${info?.unit ?? 'unit'}`, 2)],
          ['Supplier', o.supplier],
          ['Store', <EntityLink id={o.store} kind="store" />],
          ['Ordered', dateTime(o.orderedAt)],
          ['Earliest delivery', `${dateTime(o.earliest)} (${relative(o.earliest, now)})`],
        ]}
      />
      <Progress value={o.delivered / Math.max(1e-9, o.qty)} />
      {o.status === 'open' && (
        <div class="row actions">
          <ConfirmButton onConfirm={() => void command('inventory.cancelOrder', { order: id }, 'Order cancelled')}>Cancel order</ConfirmButton>
        </div>
      )}
    </>
  );
}
