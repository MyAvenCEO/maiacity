/** Road inspector: status, construction stage matrix, condition (ZEB) and actions. */
import type { Road, RoadInspection, SectionProgress } from '../../../../../../packages/roads/src/index.ts';
import type { ScheduleRow } from '../../../../../../packages/production/src/index.ts';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Button, ConfirmButton, cx, Empty, KV, Pill, Progress, Section } from '../../components/common.tsx';
import { EntityLink } from '../../components/EntityLink.tsx';
import { XNum } from '../../components/Explain.tsx';
import { chainage, dateTime, days, eur, length, num, pct, relative } from '../../format.ts';
import { command, frame, inspectorFocus, world } from '../../state.ts';
import { hoverStation } from '../../tools/road.ts';
import type { InspectResult } from '../../../protocol.ts';
import { PlacementSection } from './Placement.tsx';

const STAGE_LABEL: Record<string, string> = {
  clear: 'Clearing',
  topsoil: 'Topsoil',
  culvert: 'Culvert',
  cut: 'Cut',
  fill: 'Fill',
  subgrade: 'Formation',
  swale: 'Swales',
  shoulder: 'Shoulders',
};

/** ZEB grade colour: 1.0 green → 3.5 (Warnwert) amber → 4.5 (Schwellenwert) red. */
export function gradeColor(g: number): string {
  if (g <= 1.5) return '#2f9e44';
  if (g <= 2.5) return '#74b816';
  if (g < 3.5) return '#c9a227';
  if (g < 4.5) return '#ec835a';
  return '#d03b3b';
}

function StageMatrix({ road, progress }: { road: Road; progress: SectionProgress[] }) {
  const w = world.value;
  const cls = w?.roadClasses.find((c) => c.id === road.classId);
  const layers = [...(cls?.layers ?? [])].reverse(); // bottom-up = construction order
  const secs = road.design.sections;
  const planned = (i: number, stage: string): boolean => {
    const s = secs[i];
    if (!s) return false;
    switch (stage) {
      case 'clear':
        return s.trees.length > 0;
      case 'topsoil':
        return s.topsoil > 0;
      case 'culvert':
        return s.culvert > 0;
      case 'cut':
        return s.cut > 0.5;
      case 'fill':
        return s.fill > 0.5;
      case 'subgrade':
        return true;
      case 'shoulder':
        return (cls?.shoulder ?? 0) > 0;
      default:
        return (s.layerQuantity[stage] ?? 0) > 0;
    }
  };
  const all = new Set<string>();
  progress.forEach((p) => p.done.forEach((d) => all.add(d)));
  const stages = ['clear', 'topsoil', 'culvert', 'cut', 'fill', 'subgrade', 'swale', ...layers.map((l) => l.id), 'shoulder'].filter((st) => secs.some((_, i) => planned(i, st)) || all.has(st));
  const labelOf = (st: string) => STAGE_LABEL[st] ?? cls?.layers?.find((l) => l.id === st)?.label ?? st;
  return (
    <div class="stage-matrix">
      <table>
        <thead>
          <tr>
            <th class="sm-sec">km</th>
            {stages.map((st) => (
              <th key={st} title={labelOf(st)}>
                <span class="sm-vert">{labelOf(st).length > 15 ? `${labelOf(st).slice(0, 14)}…` : labelOf(st)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {progress.map((p) => {
            const sec = secs[p.index];
            return (
              <tr key={p.index} onMouseEnter={() => sec && (hoverStation.value = { s: p.s0, x: sec.mid[0], z: sec.mid[1], ground: 0, surface: 0, formation: 0, cut: 0, fill: 0, left: 0, right: 0, water: false })} onMouseLeave={() => (hoverStation.value = null)}>
                <td class="sm-sec num">{chainage(p.s0)}</td>
                {stages.map((st) => {
                  const done = p.done.includes(st) || p.done.includes('open');
                  const active = p.active?.stage === st ? p.active.progress : null;
                  const plan = planned(p.index, st);
                  return (
                    <td key={st} class={cx('sm-cell', done ? 'done' : active !== null ? 'active' : plan ? 'todo' : 'na')} title={`${labelOf(st)} ${chainage(p.s0)}: ${done ? 'done' : active !== null ? `${Math.round(active * 100)} %` : plan ? 'planned' : 'not needed'}`}>
                      {active !== null && <i style={{ height: `${Math.max(8, active * 100)}%` }} />}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div class="sm-legend small muted">
        <span>
          <i class="sm-key done" /> done
        </span>
        <span>
          <i class="sm-key active" /> in progress
        </span>
        <span>
          <i class="sm-key todo" /> planned
        </span>
      </div>
    </div>
  );
}

function GradeChart({ insp, totalLength }: { insp: RoadInspection; totalLength: number }) {
  const W = 340;
  const H = 110;
  const pad = { l: 26, r: 6, t: 8, b: 16 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (s: number) => pad.l + (s / Math.max(1, totalLength)) * iw;
  const y = (g: number) => pad.t + ((5 - g) / 4) * ih;
  return (
    <svg class="grade-chart" width="100%" viewBox={`0 0 ${W} ${H}`}>
      {[1, 2, 3, 4, 5].map((g) => (
        <g key={g}>
          <line class="grid" x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} />
          <text class="axis" x={pad.l - 4} y={y(g) + 3} text-anchor="end">
            {g.toFixed(1)}
          </text>
        </g>
      ))}
      {insp.sections.map((s, i) => (
        <rect key={i} x={x(s.s0) + 1} width={Math.max(1, x(s.s1) - x(s.s0) - 2)} y={y(s.grade)} height={Math.max(1, y(1) - y(s.grade))} rx={2} fill={gradeColor(s.grade)}>
          <title>{`${chainage(s.s0)}–${chainage(s.s1)}: ZEB ${s.grade.toFixed(1)}`}</title>
        </rect>
      ))}
      <line class="zeb-warn" x1={pad.l} x2={W - pad.r} y1={y(3.5)} y2={y(3.5)} />
      <text class="zeb-l warn" x={W - pad.r} y={y(3.5) - 2} text-anchor="end">
        Warnwert 3.5
      </text>
      <line class="zeb-thr" x1={pad.l} x2={W - pad.r} y1={y(4.5)} y2={y(4.5)} />
      <text class="zeb-l thr" x={W - pad.r} y={y(4.5) - 2} text-anchor="end">
        Schwellenwert 4.5
      </text>
      <text class="axis" x={pad.l} y={H - 3}>
        0+000
      </text>
      <text class="axis" x={W - pad.r} y={H - 3} text-anchor="end">
        {chainage(totalLength)}
      </text>
    </svg>
  );
}

function Maintain({ roadId, surface, insp }: { roadId: string; surface: string; insp?: RoadInspection }) {
  const ivs = (world.value?.interventions ?? []).filter((i) => i.surface === surface);
  const [iv, setIv] = useState(ivs[0]?.id ?? '');
  const [secs, setSecs] = useState<number[] | null>(null);
  useEffect(() => {
    if (!ivs.some((x) => x.id === iv)) setIv(ivs[0]?.id ?? '');
  }, [surface]);
  if (!ivs.length) return <Empty>No interventions for {surface} roads.</Empty>;
  const cur = ivs.find((x) => x.id === iv);
  const worse = insp ? insp.sections.map((s, i) => ({ i, g: s.grade })).filter((s) => s.g >= 3.5).map((s) => s.i) : [];
  return (
    <div class="maintain">
      <div class="row">
        <select class="inp grow" value={iv} onChange={(e) => setIv((e.currentTarget as HTMLSelectElement).value)}>
          {ivs.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </div>
      {cur && <div class="small muted">{cur.description}</div>}
      {insp && (
        <div class="row small">
          <label>
            <input type="radio" checked={secs === null} onChange={() => setSecs(null)} /> whole road
          </label>
          <label title="Sections at or above the Warnwert 3.5">
            <input type="radio" checked={secs !== null} disabled={!worse.length} onChange={() => setSecs(worse)} /> {worse.length} sections ≥ 3.5
          </label>
        </div>
      )}
      <Button kind="primary" small onClick={() => void command('roads.maintain', secs ? { road: roadId, intervention: iv, sections: secs } : { road: roadId, intervention: iv }, 'Maintenance project created')}>
        Order maintenance
      </Button>
    </div>
  );
}

export function RoadInspector({ data }: { data: InspectResult }) {
  const road = data.components.Road as Road;
  const insp = data.components.RoadInspection as RoadInspection | undefined;
  const progress = (data.details?.progress as SectionProgress[] | undefined) ?? [];
  const schedule = (data.details?.schedule as ScheduleRow[] | undefined) ?? [];
  const w = world.value;
  const cls = w?.roadClasses.find((c) => c.id === road.classId);
  const now = frame.value?.t ?? 0;
  const id = data.meta.id;
  const focus = inspectorFocus.value;
  useEffect(() => {
    if (focus === 'condition') {
      document.getElementById('insp-condition')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      inspectorFocus.value = null;
    }
  }, [focus, id]);
  const totalStages = progress.length;
  const overall = schedule.length ? schedule.reduce((a, r) => a + r.progress, 0) / schedule.length : road.status === 'open' ? 1 : 0;
  const forecast = schedule.length ? Math.max(...schedule.map((r) => r.actualFinish ?? r.finish)) : undefined;
  return (
    <>
      <div class="insp-sum">
        <Pill status={road.status} />
        <span class="muted">{cls?.label ?? road.classId}</span>
        <span class="num">{length(road.design.length)}</span>
      </div>
      <KV
        rows={[
          ['Class', cls ? `${cls.label} · ${cls.standard}` : road.classId],
          ['Width', cls ? `${num(cls.carriageway, 2)} m ${cls.surface}` : '–'],
          ['Planned', dateTime(road.createdAt)],
          ...(road.openedAt !== undefined ? ([['Opened', dateTime(road.openedAt)]] as [string, string][]) : []),
          ['Estimate', <XNum tree={road.design.estimate.explain} title="Estimated construction cost">{eur(road.design.estimate.cost)}</XNum>],
          ['Est. duration', days(road.design.estimate.days)],
          ...(road.project ? ([['Project', <EntityLink id={road.project} kind="project">open project</EntityLink>]] as [string, unknown][]) : []),
        ] as [string, ComponentChildren][]}
      />
      {road.status === 'construction' && (
        <Section title="Construction" right={<span class="num small">{pct(overall)}</span>}>
          <Progress value={overall} tone="info" />
          {forecast !== undefined && <div class="small muted num">forecast completion {dateTime(forecast)} ({relative(forecast, now)})</div>}
          {totalStages > 0 && <StageMatrix road={road} progress={progress} />}
        </Section>
      )}
      <PlacementSection data={data} />
      <Section title="Condition" id="insp-condition" right={insp && <span class="small muted">inspected {relative(insp.at, now)}</span>}>
        {insp ? (
          <>
            <div class="row">
              <span class="grade-big" style={{ background: gradeColor(insp.mean) }} title="Mean ZEB grade">
                {insp.mean.toFixed(1)}
              </span>
              <span class="small">
                mean ZEB grade · worst <b style={{ color: gradeColor(insp.worst) }}>{insp.worst.toFixed(1)}</b>
                <br />
                <span class="muted">last inspection {dateTime(insp.at)}</span>
              </span>
            </div>
            <GradeChart insp={insp} totalLength={road.design.length} />
            <table class="tbl tbl-mini">
              <thead>
                <tr>
                  <th>Section</th>
                  <th class="al-right">ZEB</th>
                  <th class="al-right" title="International Roughness Index">IRI m/km</th>
                  {cls?.surface === 'gravel' ? (
                    <th class="al-right">gravel mm</th>
                  ) : (
                    <>
                      <th class="al-right">cracks %</th>
                      <th class="al-right">rut mm</th>
                      <th class="al-right">potholes %</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {insp.sections.map((s, i) => (
                  <tr key={i}>
                    <td class="num">{chainage(s.s0)}</td>
                    <td class="al-right num">
                      <b style={{ color: gradeColor(s.grade) }}>{s.grade.toFixed(1)}</b>
                    </td>
                    <td class="al-right num">{num(s.iri, 1)}</td>
                    {cls?.surface === 'gravel' ? (
                      <td class="al-right num">{num(s.gravel, 0)}</td>
                    ) : (
                      <>
                        <td class="al-right num">{num(s.cracks, 1)}</td>
                        <td class="al-right num">{num(s.rut, 1)}</td>
                        <td class="al-right num">{num(s.potholes, 2)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <Empty>{road.status === 'open' ? 'Not inspected yet — the condition is only known after an inspection (ZEB).' : 'Condition is assessed once the road is open.'}</Empty>
        )}
        {road.status === 'open' && (
          <div class="row">
            <Button small onClick={() => void command('roads.inspect', { road: id }, 'Inspection scheduled')} tip="Visual condition survey (ZEB) — creates an inspection work package">
              Inspect condition
            </Button>
          </div>
        )}
      </Section>
      {road.status === 'open' && (
        <Section title="Maintenance">
          <Maintain roadId={id} surface={cls?.surface ?? 'gravel'} {...(insp ? { insp } : {})} />
        </Section>
      )}
      {road.status === 'construction' && (
        <div class="row actions">
          <ConfirmButton onConfirm={() => void command('roads.cancel', { road: id }, 'Construction cancelled')} tip="Stop construction; work done so far stays in the terrain">
            Cancel construction
          </ConfirmButton>
        </div>
      )}
    </>
  );
}
