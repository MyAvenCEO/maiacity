/** Work package and project inspectors. */
import type { Explained, ProcessView } from '../../../../../../packages/kernel/src/index.ts';
import type { Project, ScheduleRow, WorkPackage } from '../../../../../../packages/production/src/index.ts';
import { BlockerList } from '../../components/Blockers.tsx';
import { Button, ConfirmButton, cx, Empty, Icon, KV, Pill, Progress, Section, Stat } from '../../components/common.tsx';
import { EntityLink } from '../../components/EntityLink.tsx';
import { XNum } from '../../components/Explain.tsx';
import { Gantt } from '../../components/Gantt.tsx';
import { date, dateTime, eur, hours, num, pct, qty, relative, titleCase } from '../../format.ts';
import { command, frame, select, world } from '../../state.ts';
import type { InspectResult } from '../../../protocol.ts';

export function activityColor(id: string): string | undefined {
  return world.value?.activities?.find((a) => a.id === id)?.color;
}

export function PackageInspector({ data }: { data: InspectResult }) {
  const pkg = data.components.WorkPackage as WorkPackage;
  const d = data.details ?? {};
  const proc = data.processes[0] as ProcessView | undefined;
  const now = frame.value?.t ?? 0;
  const progress = (d.progress as number | undefined) ?? (proc ? proc.done / Math.max(1e-9, proc.total) : pkg.status === 'done' ? 1 : 0);
  const done = proc ? proc.done : progress * pkg.quantity;
  const rateExplain = (d.rateExplain as Explained | undefined) ?? undefined;
  const crew = (d.crew as { id: string; name: string; role?: string }[] | undefined) ?? [];
  const machines = (d.machines as { id: string; label: string; role?: string; status?: string }[] | undefined) ?? [];
  const cost = pkg.cost.labour + pkg.cost.equipment + pkg.cost.materials;
  const unit = pkg.unit;
  const eta = d.eta as number | undefined;
  const remainingH = pkg.rate > 0 ? (pkg.quantity - done) / pkg.rate : Infinity;
  const staged = Object.entries((d.staged as Record<string, number> | undefined) ?? {}).filter(([, v]) => v > 1e-6);
  return (
    <>
      <div class="insp-sum">
        <Pill status={data.blockers.some((b) => b.severity === 'block') ? 'blocked' : pkg.status} label={data.blockers.some((b) => b.severity === 'block') ? 'Blocked' : undefined} />
        <span class="muted">{(d.activityLabel as string) ?? pkg.activity}</span>
        <EntityLink id={pkg.project} kind="project">
          {(d.projectLabel as string) ?? 'project'}
        </EntityLink>
      </div>
      <BlockerList blockers={data.blockers} />
      <div class="wp-progress">
        <div class="row between">
          <span class="num">
            <b>{qty(done, unit)}</b> of {qty(pkg.quantity, unit)}
          </span>
          <span class="num">{pct(progress, 0)}</span>
        </div>
        <Progress value={progress} tone={pkg.status === 'done' ? 'muted' : pkg.rate > 0 ? 'good' : 'warn'} />
      </div>
      <div class="stat-grid">
        <Stat
          label="Current rate"
          value={
            rateExplain ? (
              <XNum tree={rateExplain} title="Current production rate">
                {qty(pkg.rate, `${unit}/h`)}
              </XNum>
            ) : (
              qty(pkg.rate, `${unit}/h`)
            )
          }
          sub={pkg.rate > 0 ? 'working now' : pkg.status === 'active' ? 'idle — see blockers' : titleCase(pkg.status)}
          tone={pkg.status === 'active' && pkg.rate <= 0 ? 'warn' : undefined}
        />
        <Stat
          label="Planned rate"
          value={
            <XNum tree={pkg.estimate.rateExplain} title="Planned rate (standard resources)">
              {qty(pkg.estimate.rate, `${unit}/h`)}
            </XNum>
          }
          sub="standard crew & machines"
        />
        <Stat label="Remaining" value={Number.isFinite(remainingH) ? hours(remainingH) : '–'} sub={eta !== undefined && Number.isFinite(eta) ? relative(eta, now) : 'at current rate'} />
        <Stat label="Hours" value={`${num(pkg.workedHours, 1)} / ${num(pkg.estimate.hours, 1)}`} sub="worked / estimated" tone={pkg.workedHours > pkg.estimate.hours * 1.15 ? 'warn' : undefined} />
        <Stat label="Cost so far" value={eur(cost)} sub={`labour ${eur(pkg.cost.labour)} · plant ${eur(pkg.cost.equipment)} · mat. ${eur(pkg.cost.materials)}`} />
        <Stat label="Started" value={pkg.startedAt !== undefined ? dateTime(pkg.startedAt).slice(3) : '–'} sub={pkg.completedAt !== undefined ? `done ${dateTime(pkg.completedAt).slice(3)}` : pkg.holdUntil !== undefined ? `hold until ${dateTime(pkg.holdUntil).slice(3)}` : undefined} />
      </div>
      <Section title={`Crew (${crew.length})`}>
        {crew.length ? (
          <ul class="plain">
            {crew.map((c) => (
              <li key={c.id}>
                <EntityLink id={c.id} kind="person">
                  {c.name}
                </EntityLink>
                <span class="muted small"> · {c.role ?? ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No crew assigned.</Empty>
        )}
      </Section>
      <Section title={`Machines (${machines.length})`}>
        {machines.length ? (
          <ul class="plain">
            {machines.map((m) => (
              <li key={m.id}>
                <EntityLink id={m.id} kind="machine">
                  {m.label}
                </EntityLink>
                <span class="muted small"> · {m.role ?? ''}</span> {m.status && m.status !== 'ready' && <Pill status={m.status} />}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No machines assigned.</Empty>
        )}
      </Section>
      {staged.length > 0 && (
        <Section title="Staged materials" open={false}>
          <KV rows={staged.map(([m, v]) => [world.value?.materials.find((x) => x.id === m)?.label ?? m, qty(v, world.value?.materials.find((x) => x.id === m)?.unit)])} />
        </Section>
      )}
    </>
  );
}

export function ProjectInspector({ data }: { data: InspectResult }) {
  const p = data.components.Project as Project;
  const id = data.meta.id;
  const rows = (data.details?.schedule as ScheduleRow[] | undefined) ?? [];
  const pkgs = (data.details?.packages as { id: string; label: string; status?: string; blocked: boolean }[] | undefined) ?? [];
  const now = frame.value?.t ?? 0;
  const blocked = new Set(pkgs.filter((x) => x.blocked).map((x) => x.id));
  const forecast = rows.length ? Math.max(...rows.map((r) => r.actualFinish ?? r.finish)) : undefined;
  const slipDays = forecast !== undefined && Number.isFinite(p.estimate.finish) ? (forecast - p.estimate.finish) / 86400 : 0;
  const totalH = rows.length;
  const progress = totalH ? rows.reduce((a, r) => a + r.progress, 0) / totalH : 0;
  const doneCount = pkgs.filter((x) => x.status === 'done').length;
  return (
    <>
      <div class="insp-sum">
        <Pill status={p.status} />
        <span class="muted">{p.owner}</span>
        <span class="num">
          {doneCount}/{pkgs.length} packages
        </span>
        {blocked.size > 0 && <span class="pill tone-bad">{blocked.size} blocked</span>}
      </div>
      <Progress value={progress} />
      <div class="stat-grid">
        <Stat label="Planned finish" value={date(p.estimate.finish)} sub={`est. ${hours(p.estimate.hours, 0)}`} />
        <Stat label="Forecast" value={forecast !== undefined ? date(forecast) : '–'} sub={forecast !== undefined ? `${slipDays >= 0 ? '+' : '−'}${num(Math.abs(slipDays), 1)} d vs plan` : undefined} tone={slipDays > 2 ? 'warn' : undefined} />
        <Stat label="Est. cost" value={eur(p.estimate.cost)} />
        <Stat label="Priority" value={num(p.priority)} sub="higher gets resources first" />
      </div>
      <div class="row actions">
        <Button small onClick={() => void command('production.setPriority', { project: id, priority: p.priority + 1 })} tip="Raise priority">
          <Icon name="up" size={12} /> Priority
        </Button>
        <Button small onClick={() => void command('production.setPriority', { project: id, priority: p.priority - 1 })} tip="Lower priority">
          <Icon name="down" size={12} /> Priority
        </Button>
        {p.status === 'active' && (
          <Button small onClick={() => void command('production.pauseProject', { project: id }, 'Project paused')}>
            Pause
          </Button>
        )}
        {p.status === 'paused' && (
          <Button small kind="primary" onClick={() => void command('production.resumeProject', { project: id }, 'Project resumed')}>
            Resume
          </Button>
        )}
        {(p.status === 'active' || p.status === 'paused') && (
          <ConfirmButton onConfirm={() => void command('production.cancelProject', { project: id }, 'Project cancelled')}>Cancel</ConfirmButton>
        )}
      </div>
      <Section title="Schedule">
        <Gantt rows={rows} now={now} blocked={blocked} plannedFinish={p.estimate.finish} compact onRowClick={(pid) => select(pid, 'workPackage', { focus: true })} activityColor={activityColor} />
      </Section>
      <Section title="Work packages" open={pkgs.length <= 30}>
        <ul class="plain pkg-list">
          {pkgs.map((x) => (
            <li key={x.id} class={cx(x.status === 'done' && 'muted')}>
              <EntityLink id={x.id} kind="workPackage">
                {x.label}
              </EntityLink>{' '}
              {x.blocked ? <Pill tone="bad" label="Blocked" /> : x.status !== 'done' && x.status !== 'waiting' && <Pill status={x.status} />}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
