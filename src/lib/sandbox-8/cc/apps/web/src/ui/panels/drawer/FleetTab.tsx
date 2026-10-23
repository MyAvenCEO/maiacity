/** Fleet: machines table + rent/buy per model. */
import { useState } from 'preact/hooks';
import { Button, Pill } from '../../components/common.tsx';
import { DataTable, type Column } from '../../components/Table.tsx';
import { dateTime, eur, eurK, num } from '../../format.ts';
import { useProjection } from '../../hooks.ts';
import { command, frame, select, selection, world } from '../../state.ts';

interface FleetRow {
  id: string;
  label: string;
  model: string;
  ownership: 'owned' | 'rented';
  engineHours: number;
  hoursSinceService: number;
  fuel: number;
  status: string;
  until?: number;
  pos: [number, number];
  hourlyCost: number;
  blockers: string[];
}

function Acquire() {
  const w = world.value;
  const models = w?.machineModels ?? [];
  const [filter, setFilter] = useState('');
  const pos = w?.depotPos ?? w?.accesses[0]?.point ?? [0, 0];
  const list = models.filter((m) => !filter || `${m.label} ${m.class}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div class="acquire">
      <div class="row between">
        <span class="sc muted">Rent or buy</span>
        <input class="inp inp-filter" placeholder="Filter models…" value={filter} onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)} />
      </div>
      <div class="model-list">
        {list.map((m) => (
          <div key={m.id} class="model-row">
            <div class="grow">
              <div class="ellipsis">{m.label}</div>
              <div class="small muted num">
                {m.class}
                {m.enginePower ? ` · ${num(m.enginePower)} kW` : ''}
                {m.fuelUse ? ` · ${num(m.fuelUse, 0)} l/h` : ''}
              </div>
            </div>
            <Button small onClick={() => void command('equipment.acquire', { model: m.id, ownership: 'rented', pos }, `Renting ${m.label}`)} tip={`Rent: ${eur(m.rentalPerDay)} per day, delivered to the yard`}>
              Rent <span class="num muted">{eur(m.rentalPerDay)}/d</span>
            </Button>
            <Button small onClick={() => void command('equipment.acquire', { model: m.id, ownership: 'owned', pos }, `Bought ${m.label}`)} tip={`Buy for ${eur(m.purchasePrice)} (capitalised, depreciates)`}>
              Buy <span class="num muted">{eurK(m.purchasePrice)}</span>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FleetTab() {
  const { data } = useProjection<FleetRow[]>('equipment.fleet', 2000);
  const f = frame.value;
  const now = f?.t ?? 0;
  const mv = new Map((f?.machines ?? []).map((m) => [m.id, m]));
  const fronts = new Map((f?.workfronts ?? []).map((w) => [w.id, w.label]));
  const cols: Column<FleetRow>[] = [
    { key: 'label', label: 'Machine', render: (r) => r.label, sort: (r) => r.label },
    {
      key: 'status',
      label: 'Status',
      render: (r) => {
        const working = mv.get(r.id)?.working;
        return (
          <span>
            <Pill status={working ? 'working' : r.status} />
            {r.until !== undefined && r.until > now && <span class="muted small"> until {dateTime(r.until).slice(3, 15)}</span>}
            {r.blockers.length > 0 && <span class="c-warn small" title={r.blockers.join('\n')}> ⚑</span>}
          </span>
        );
      },
      sort: (r) => (mv.get(r.id)?.working ? 'aworking' : r.status),
      text: (r) => `${r.status} ${r.blockers.join(' ')}`,
    },
    { key: 'own', label: 'Own.', render: (r) => (r.ownership === 'owned' ? 'owned' : 'rented'), sort: (r) => r.ownership },
    {
      key: 'assign',
      label: 'Assignment',
      render: (r) => {
        const p = mv.get(r.id)?.pkg;
        return p ? <span class="ellipsis">{fronts.get(p) ?? p}</span> : <span class="muted">–</span>;
      },
      sort: (r) => (mv.get(r.id)?.pkg ? fronts.get(mv.get(r.id)!.pkg!) ?? 'y' : 'zz'),
    },
    { key: 'eh', label: 'Eng. h', render: (r) => num(r.engineHours, 0), sort: (r) => r.engineHours, align: 'right' },
    { key: 'fuel', label: 'Fuel l', render: (r) => num(r.fuel, 0), sort: (r) => r.fuel, align: 'right' },
    { key: 'cost', label: '€/h', render: (r) => num(r.hourlyCost, 2), sort: (r) => r.hourlyCost, align: 'right', tip: 'Operating cost per hour excl. operator' },
  ];
  return (
    <div class="split">
      <div class="split-r grow">
        <DataTable rows={data ?? []} columns={cols} rowKey={(r) => r.id} selected={selection.value?.id ?? null} onRowClick={(r) => select(r.id, 'machine', { focus: true })} initialSort={{ key: 'label', dir: 1 }} />
      </div>
      <div class="split-side">
        <Acquire />
      </div>
    </div>
  );
}
