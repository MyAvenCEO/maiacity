/** Structure inspector (a house, a hall, a tent, a wall): status, stages, condition per element (from surveys), actions. */
import type { BuildingDesign } from '../../../../../../packages/buildings/src/index.ts';
import type { ElementCondition, Structure, StructureCondition, StructureInspection } from '../../../../../../packages/structures/src/index.ts';
import type { ScheduleRow } from '../../../../../../packages/production/src/index.ts';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { BUILDING_STAGES, type BuildingStageView, type InspectResult } from '../../../protocol.ts';
import { Button, ConfirmButton, cx, Empty, KV, Pill, Progress, Section } from '../../components/common.tsx';
import { EntityLink } from '../../components/EntityLink.tsx';
import { XNum } from '../../components/Explain.tsx';
import { date, dateTime, days, eur, m2, num, pct, relative } from '../../format.ts';
import { command, frame } from '../../state.ts';
import { PlacementSection } from './Placement.tsx';
import { gradeColor } from './RoadInspector.tsx';

const STAGE_LABEL: Record<string, string> = { site: 'Site', foundation: 'Foundation', shell: 'Shell', roof: 'Roof', envelope: 'Envelope', services: 'Services', finishing: 'Finishing', handover: 'Handover' };

export function StageStrip({ view }: { view: BuildingStageView }) {
  return (
    <div class="stage-strip">
      {BUILDING_STAGES.map((st) => {
        const done = view.stages.includes(st);
        const active = view.active?.stage === st ? view.active.progress : null;
        return (
          <div key={st} class={cx('ss-cell', done ? 'done' : active !== null ? 'active' : 'todo')} title={`${STAGE_LABEL[st]}: ${done ? 'done' : active !== null ? `${Math.round(active * 100)} %` : 'to do'}`}>
            {active !== null && <i style={{ width: `${Math.max(6, active * 100)}%` }} />}
            <span>{STAGE_LABEL[st]}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Horizontal grade bars 1.0–5.0 with Warnwert 3.5 / Schwellenwert 4.5 markers. */
function GradeBars({ rows }: { rows: { id: string; label: string; grade?: number; age?: number; life?: number }[] }) {
  const x = (g: number) => `${((g - 1) / 4) * 100}%`;
  return (
    <div class="gbars">
      <div class="gbar-scale small muted">
        <span style={{ left: x(1) }}>1.0</span>
        <span style={{ left: x(3.5) }} class="c-warn">
          3.5
        </span>
        <span style={{ left: x(4.5) }} class="c-bad">
          4.5
        </span>
        <span style={{ left: x(5) }}>5.0</span>
      </div>
      {rows.map((r) => (
        <div key={r.id} class="gbar-row" title={r.life ? `age ${num(r.age, 1)} a of ${num(r.life, 0)} a service life (BBSR)` : undefined}>
          <span class="gbar-l ellipsis">{r.label}</span>
          <span class="gbar-t">
            <i class="gbar-m warn" style={{ left: x(3.5) }} />
            <i class="gbar-m thr" style={{ left: x(4.5) }} />
            {r.grade !== undefined && <b style={{ width: x(r.grade), background: gradeColor(r.grade) }} />}
          </span>
          <span class="gbar-v num">{r.grade !== undefined ? r.grade.toFixed(1) : '–'}</span>
          <span class="gbar-age num small muted">{r.life ? `${num(r.age, 0)}/${num(r.life, 0)} a` : ''}</span>
        </div>
      ))}
    </div>
  );
}

interface LettingDetails {
  options: { use: string; label: string; period: 'month' | 'day'; rent: number; expectedDays: number }[];
  offered?: { use: string; ask: number; since: number };
  lease?: { id: string; summary: string; status: string };
}

/** let a building of ours: the uses with their market rent, an asking rent, the current lease */
function LettingSection({ id, letting }: { id: string; letting: LettingDetails | undefined }) {
  const [asks, setAsks] = useState<Record<string, number>>({});
  if (!letting || (!letting.options.length && !letting.lease)) return null;
  return (
    <Section title="Letting" right={<span class="small muted">rent comes in each period; a deposit is held</span>}>
      {letting.lease && <div class="small">{letting.lease.summary}</div>}
      {letting.offered && (
        <div class="row small">
          Offered at {eur(letting.offered.ask)} since {date(letting.offered.since)}
          <Button small onClick={() => void command('letting.withdraw', { subject: id }, 'Letting offer withdrawn')}>
            Withdraw
          </Button>
        </div>
      )}
      {!letting.lease &&
        letting.options.map((o) => (
          <div key={o.use} class="row between">
            <span>
              {o.label} <span class="small muted">market {eur(o.rent)} a {o.period}, a tenant in ~{num(o.expectedDays)} d</span>
            </span>
            <span class="row">
              <input class="inp num w80" type="number" min="1" value={asks[o.use] ?? o.rent} onInput={(e) => setAsks({ ...asks, [o.use]: Number((e.currentTarget as HTMLInputElement).value) })} title={`asking rent a ${o.period} (EUR); higher waits longer`} />
              <ConfirmButton kind="default" onConfirm={() => void command('letting.offer', { subject: id, use: o.use, ask: asks[o.use] ?? o.rent }, `Offered to let: ${o.label}`)} tip="Offer it to let at this rent">
                Offer
              </ConfirmButton>
            </span>
          </div>
        ))}
    </Section>
  );
}

export function StructureInspector({ data }: { data: InspectResult }) {
  const b = data.components.Structure as Structure;
  const insp = data.components.StructureInspection as StructureInspection | undefined;
  const cond = data.components.StructureCondition as StructureCondition | undefined;
  const design = b.plan.planner === 'building' ? (b.plan.detail as BuildingDesign) : null;
  const d = data.details ?? {};
  const view = (d.stages as BuildingStageView | undefined) ?? { stages: [], elements: [] };
  const schedule = (d.schedule as ScheduleRow[] | undefined) ?? [];
  const elements = (d.elements as { id: string; label: string; serviceLife?: number; renewal?: string }[] | undefined) ?? [];
  const id = data.meta.id;
  const now = frame.value?.t ?? 0;
  const [pick, setPick] = useState<string[]>([]);
  const overall = schedule.length ? schedule.reduce((a, r) => a + r.progress, 0) / schedule.length : b.status === 'building' ? 0 : 1;
  const forecast = schedule.length ? Math.max(...schedule.map((r) => r.actualFinish ?? r.finish)) : undefined;
  const rows = (insp?.elements ?? elements.map((e) => ({ id: e.id, label: e.label, grade: undefined as number | undefined }))).map((e) => {
    const c = cond?.elements.find((x: ElementCondition) => x.id === e.id);
    const r: { id: string; label: string; grade?: number; age?: number; life?: number } = { id: e.id, label: e.label };
    if (e.grade !== undefined) r.grade = e.grade;
    if (c) {
      r.age = c.age;
      r.life = c.life;
    }
    return r;
  });
  const renewable = new Set(elements.filter((e) => e.renewal).map((e) => e.id));
  const worse = rows.filter((r) => (r.grade ?? 0) >= 3.5 && renewable.has(r.id));
  return (
    <>
      <div class="insp-sum">
        <Pill status={b.status} />
        <span class="muted">{(d.typeLabel as string) ?? b.template}</span>
        {b.plan.floorArea !== undefined && <span class="num">{m2(b.plan.floorArea)} GFA</span>}
      </div>
      <KV
        rows={
          [
            ['Size', `${num(b.plan.length, 1)} × ${num(b.plan.width, 1)} m${design ? ` · ${design.geometry.floors} floors` : ` · ${num(b.plan.height, 1)} m high`}`],
            ['Planned', dateTime(b.createdAt)],
            ...(b.builtAt !== undefined ? [['Completed', dateTime(b.builtAt)]] : []),
            ['Estimate', b.plan.estimate.explain ? <XNum tree={b.plan.estimate.explain} title="Estimated cost">{eur(b.plan.estimate.cost)}</XNum> : eur(b.plan.estimate.cost)],
            ...(b.plan.floorArea ? [['Per m² GFA', eur(b.plan.estimate.cost / b.plan.floorArea)]] : []),
            ['Est. duration', days(b.plan.estimate.days)],
            ...(b.project ? [['Project', <EntityLink id={b.project} kind="project">open project</EntityLink>]] : []),
          ] as [string, ComponentChildren][]
        }
      />
      <Section title="Construction" right={<span class="num small">{pct(overall)}</span>}>
        <StageStrip view={view} />
        {b.status === 'building' && (
          <>
            <Progress value={overall} />
            {forecast !== undefined && <div class="small muted num">forecast completion {dateTime(forecast)} ({relative(forecast, now)})</div>}
          </>
        )}
      </Section>
      <LettingSection id={id} letting={d.letting as LettingDetails | undefined} />
      <PlacementSection data={data} />
      <Section title="Condition" right={insp && <span class="small muted">surveyed {relative(insp.at, now)}</span>}>
        {b.status !== 'standing' ? (
          <Empty>Condition is surveyed once it stands.</Empty>
        ) : (
          <>
            {!insp && <div class="small muted">Not surveyed yet — grades are only known after a survey. Ages and service lives are shown.</div>}
            {insp && (
              <div class="row small">
                worst element <b style={{ color: gradeColor(insp.worst) }}>{insp.worst.toFixed(1)}</b> · last survey {dateTime(insp.at)}
              </div>
            )}
            <GradeBars rows={rows} />
            <div class="row actions">
              <Button small onClick={() => void command('structures.inspect', { structure: id }, 'Survey scheduled')} tip="Condition survey of all elements (creates a work package)">
                Survey condition
              </Button>
              <Button small kind={worse.length ? 'primary' : 'default'} disabled={!insp || !worse.length} onClick={() => void command('structures.renew', { structure: id }, 'Renewal project created')} tip="Renew every element graded 3.5 or worse in the last survey">
                Renew elements ≥ 3.5 ({worse.length})
              </Button>
            </div>
            {renewable.size > 0 && (
              <div class="renew-pick">
                <div class="sc muted">Renew selected</div>
                <div class="chips">
                  {elements
                    .filter((e) => e.renewal)
                    .map((e) => (
                      <label key={e.id} class={cx('chip', pick.includes(e.id) && 'on')} title={e.renewal}>
                        <input type="checkbox" checked={pick.includes(e.id)} onChange={() => setPick(pick.includes(e.id) ? pick.filter((x) => x !== e.id) : [...pick, e.id])} /> {e.label}
                      </label>
                    ))}
                </div>
                <Button small disabled={!pick.length} onClick={() => void command('structures.renew', { structure: id, elements: pick }, 'Renewal project created').then((r) => r.ok && setPick([]))}>
                  Renew {pick.length || ''} selected
                </Button>
              </div>
            )}
          </>
        )}
      </Section>
      {b.status === 'building' && (
        <div class="row actions">
          <ConfirmButton onConfirm={() => void command('structures.cancel', { structure: id }, 'Construction cancelled')}>Cancel construction</ConfirmButton>
        </div>
      )}
    </>
  );
}
