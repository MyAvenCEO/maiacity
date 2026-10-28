/** Workforce: roster table + recruiting per job. */
import type { RosterEntry } from '../../../../../../packages/workforce/src/index.ts';
import { useState } from 'preact/hooks';
import { Button, Pill } from '../../components/common.tsx';
import { DataTable, type Column } from '../../components/Table.tsx';
import { dateTime, eur, num } from '../../format.ts';
import { useProjection } from '../../hooks.ts';
import { command, frame, select, selection, world } from '../../state.ts';

function jobLabel(id: string): string {
  if (id === 'family') return 'Family (helps unpaid)';
  if (id === 'friend') return 'Friend (helps unpaid)';
  return world.value?.jobs.find((j) => j.id === id)?.label ?? id;
}

/** family and friends: ask them to come and help (unpaid, fed while here), or let them go home */
function Circle({ rows, now }: { rows: RosterEntry[]; now: number }) {
  const circle = rows.filter((r) => r.helper);
  const [days, setDays] = useState<Record<string, number>>({});
  if (!circle.length) return null;
  return (
    <div class="recruit">
      <div class="sc muted">Family &amp; friends</div>
      {circle.map((r) => {
        const h = r.helper!;
        const staying = h.stay && h.stay.until > now;
        const n = Math.max(1, Math.min(h.moreDaysThisYear, days[r.id] ?? Math.min(5, h.moreDaysThisYear)));
        return (
          <div key={r.id} class="row between" title={h.relation === 'friend' ? 'A friend may help a business unpaid only occasionally (labour law)' : 'Family helps as far as their own lives allow'}>
            <span>
              {r.name} <span class="muted small">{h.relation}{h.resident ? ', lives here' : `, ${h.moreDaysThisYear} d left this year`}</span>
              {staying && <span class="muted small"> · {h.stay!.from > now ? `arrives ${dateTime(h.stay!.from).slice(3, 9)}` : `here until ${dateTime(h.stay!.until).slice(3, 9)}`}</span>}
            </span>
            {h.resident || r.status === 'training' ? null : staying ? (
              <Button small onClick={() => void command('workforce.sendHome', { person: r.id }, `${r.name} goes home`)}>
                Send home
              </Button>
            ) : (
              <span class="row">
                <input class="inp num w60" type="number" min="1" max={h.moreDaysThisYear} value={n} onInput={(e) => setDays({ ...days, [r.id]: Number((e.currentTarget as HTMLInputElement).value) })} title="working days" />
                <Button small kind="primary" disabled={h.moreDaysThisYear < 1} onClick={() => void command('workforce.askForHelp', { person: r.id, days: n }, `Asked ${r.name} to help for ${n} days`)}>
                  Ask to help
                </Button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Recruit() {
  const jobs = world.value?.jobs ?? [];
  const [job, setJob] = useState(jobs[0]?.id ?? '');
  const [count, setCount] = useState(1);
  const j = jobs.find((x) => x.id === job);
  return (
    <div class="recruit">
      <div class="sc muted">Recruit</div>
      <div class="job-grid">
        {jobs.map((x) => (
          <button
            key={x.id}
            class={job === x.id ? 'job on' : 'job'}
            onClick={() => setJob(x.id)}
            title={`${x.label}: ${eur(x.wage, 2)}/h gross. A suitable applicant turns up every ~${num(x.applicantDays)} days on average (random), then works ${num(x.noticeDays)} days' notice.`}
          >
            <span class="ellipsis">{x.label}</span>
            <span class="num muted small">
              {eur(x.wage, 2)}/h · ~{num(x.applicantDays + x.noticeDays)} d
            </span>
          </button>
        ))}
      </div>
      {j && (
        <div class="row">
          <input class="inp num w60" type="number" min={1} max={20} value={count} onInput={(e) => setCount(Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1))} />
          <span class="small">× {j.label}</span>
          <Button kind="primary" small onClick={() => void command('workforce.recruit', { job: j.id, count }, `Advertising ${count} × ${j.label}`)}>
            Advertise
          </Button>
          <span class="small muted">
            advert {eur(j.advertCost)} · last start in ~{num(count * j.applicantDays + j.noticeDays)} days (random) · wage {eur(j.wage * count, 2)}/h total
          </span>
        </div>
      )}
    </div>
  );
}

interface VacancyRow {
  id: string;
  job: string;
  label: string;
  openedAt: number;
  expectedStartDays: number;
}

/** open vacancies: applicants arrive at random; each can be withdrawn */
function Vacancies() {
  const { data } = useProjection<VacancyRow[]>('workforce.vacancies', 2000);
  if (!data?.length) return null;
  return (
    <div class="vacancies">
      <div class="sc muted">Open vacancies</div>
      {data.map((v) => (
        <div class="row" key={v.id}>
          <span class="small ellipsis">{v.label}</span>
          <span class="small muted num">
            since {dateTime(v.openedAt).slice(3, 9)} · start expected in ~{num(v.expectedStartDays)} d
          </span>
          <Button small onClick={() => void command('workforce.withdrawVacancy', { vacancy: v.id }, `Withdrawing vacancy ${v.label}`)}>
            Withdraw
          </Button>
        </div>
      ))}
    </div>
  );
}

export function WorkforceTab() {
  const { data } = useProjection<RosterEntry[]>('workforce.roster', 2000);
  const f = frame.value;
  const now = f?.t ?? 0;
  const assign = new Map((f?.people ?? []).map((p) => [p.id, p]));
  const fronts = new Map((f?.workfronts ?? []).map((w) => [w.id, w.label]));
  const cols: Column<RosterEntry>[] = [
    { key: 'name', label: 'Name', render: (r) => r.name, sort: (r) => r.name },
    {
      key: 'job',
      label: 'Job',
      render: (r) => jobLabel(r.job),
      sort: (r) => jobLabel(r.job),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => {
        const pv = assign.get(r.id);
        const st = r.status !== 'available' ? r.status : (pv?.state ?? 'available');
        return (
          <span>
            <Pill status={st} />
            {r.until !== undefined && r.until > now && <span class="muted small"> until {dateTime(r.until).slice(3, 9)}</span>}
          </span>
        );
      },
      sort: (r) => (r.status !== 'available' ? r.status : (assign.get(r.id)?.state ?? 'available')),
    },
    {
      key: 'assign',
      label: 'Assignment',
      render: (r) => {
        const pkg = assign.get(r.id)?.pkg;
        return pkg ? <span class="ellipsis">{fronts.get(pkg) ?? pkg}</span> : <span class="muted">–</span>;
      },
      sort: (r) => (assign.get(r.id)?.pkg ? (fronts.get(assign.get(r.id)!.pkg!) ?? 'z') : 'zz'),
    },
    {
      key: 'cost',
      label: 'Cost €/h',
      render: (r) => num(r.hourlyCost, 2),
      sort: (r) => r.hourlyCost,
      align: 'right',
      tip: 'Employer cost per paid hour (wage + surcharges)',
    },
    {
      key: 'vac',
      label: 'Vac. d',
      render: (r) => num(r.vacationDaysLeft),
      sort: (r) => r.vacationDaysLeft,
      align: 'right',
    },
    {
      key: 'sick',
      label: 'Sick d',
      render: (r) => num(r.sickDaysThisYear),
      sort: (r) => r.sickDaysThisYear,
      align: 'right',
    },
  ];
  const rows = data ?? [];
  const payroll = rows.reduce((a, r) => a + r.hourlyCost, 0);
  return (
    <div class="split">
      <div class="split-r grow">
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={(r) => r.id}
          selected={selection.value?.id ?? null}
          onRowClick={(r) => select(r.id, 'person', { focus: true })}
          initialSort={{ key: 'job', dir: 1 }}
          toolbar={
            <span class="small muted num">
              payroll {eur(payroll, 0)}/h · {eur(payroll * 8, 0)}/shift
            </span>
          }
        />
      </div>
      <div class="split-side">
        <Circle rows={rows} now={now} />
        <Recruit />
        <Vacancies />
      </div>
    </div>
  );
}
