/** Projects: list (left) + Gantt of the chosen project (right). */
import type { ScheduleRow } from '../../../../../../packages/production/src/index.ts';
import { useEffect, useState } from 'preact/hooks';
import { cx, Empty, Pill, Progress } from '../../components/common.tsx';
import { Gantt } from '../../components/Gantt.tsx';
import { dateTime, eurK, num, pct } from '../../format.ts';
import { useProjection, useQuery } from '../../hooks.ts';
import { frame, select, selection } from '../../state.ts';
import { activityColor } from '../inspectors/WorkInspectors.tsx';

export interface ProjectRow {
  id: string;
  label: string;
  status: string;
  owner: string;
  progress: number;
  packages: number;
  active: number;
  blocked: number;
  estimate: { hours: number; cost: number; finish: number };
  cost: number;
}

export interface AlertRow {
  subject: string;
  label: string;
  code: string;
  severity: string;
  message: string;
  since?: number;
  remedies?: unknown[];
}

export function ProjectsTab() {
  const { data: projects } = useProjection<ProjectRow[]>('production.projects', 1500);
  const { data: alerts } = useProjection<AlertRow[]>('settlement.alerts', 2000);
  const [chosen, setChosen] = useState<string | null>(null);
  const list = (projects ?? []).slice().sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active'));
  useEffect(() => {
    if ((!chosen || !list.some((p) => p.id === chosen)) && list[0]) setChosen(list[0].id);
  }, [projects]);
  const { data: rows } = useQuery<ScheduleRow[]>(chosen ? { kind: 'schedule', project: chosen } : null, 2000);
  const cur = list.find((p) => p.id === chosen);
  const blocked = new Set((alerts ?? []).filter((a) => a.severity === 'block').map((a) => a.subject));
  const now = frame.value?.t ?? 0;
  if (!list.length) return <Empty>No projects yet. Press R to design a road — planning it creates a construction project.</Empty>;
  return (
    <div class="split">
      <div class="split-l proj-list">
        {list.map((p) => (
          <div
            key={p.id}
            class={cx('proj-item', chosen === p.id && 'on', selection.value?.id === p.id && 'sel')}
            onClick={() => {
              setChosen(p.id);
              select(p.id, 'project');
            }}
          >
            <div class="row between">
              <b class="ellipsis">{p.label}</b>
              <Pill status={p.blocked ? 'blocked' : p.status} label={p.blocked ? `${p.blocked} blocked` : undefined} />
            </div>
            <Progress value={p.progress} thin tone={p.status === 'complete' ? 'muted' : 'info'} />
            <div class="row between small muted num">
              <span>
                {pct(p.progress)} · {p.active}/{p.packages} active
              </span>
              <span>
                {eurK(p.cost)} / {eurK(p.estimate.cost)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div class="split-r">
        {cur && (
          <div class="gantt-h small">
            <b>{cur.label}</b>
            <span class="muted num"> · planned finish {dateTime(cur.estimate.finish)} · {num(cur.estimate.hours, 0)} h estimated</span>
          </div>
        )}
        <div class="gantt-scroll">
          <Gantt rows={rows ?? []} now={now} blocked={blocked} {...(cur ? { plannedFinish: cur.estimate.finish } : {})} onRowClick={(id) => select(id, 'workPackage', { focus: true })} selected={selection.value?.id ?? null} activityColor={activityColor} />
        </div>
      </div>
    </div>
  );
}
