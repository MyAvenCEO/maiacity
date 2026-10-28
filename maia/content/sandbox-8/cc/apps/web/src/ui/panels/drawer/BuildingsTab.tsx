/** Structures list (projection structures.list): houses, halls, tents, walls. */
import { Button, Pill } from '../../components/common.tsx';
import { DataTable, type Column } from '../../components/Table.tsx';
import { date, eurK, m2 } from '../../format.ts';
import { useProjection } from '../../hooks.ts';
import { frame, select, selection, world } from '../../state.ts';
import { gradeColor } from '../inspectors/RoadInspector.tsx';
import { setTool } from '../../tools/controller.ts';

interface BuildingRow {
  id: string;
  label: string;
  template: string;
  status: string;
  kit?: boolean;
  floorArea?: number;
  /** what it is estimated to cost; one given up has what it `spent` instead */
  estimate?: number;
  spent?: number;
  project?: string;
  worst?: number;
  inspectedAt?: number;
}

export function BuildingsTab() {
  const { data } = useProjection<BuildingRow[]>('structures.list', 2000);
  const stages = frame.value?.buildingStages ?? {};
  const typeLabel = (id: string) => world.value?.buildingTypes?.find((t) => t.id === id)?.label ?? id;
  const cols: Column<BuildingRow>[] = [
    { key: 'label', label: 'Structure', render: (r) => r.label, sort: (r) => r.label },
    { key: 'type', label: 'Type', render: (r) => typeLabel(r.template), sort: (r) => typeLabel(r.template) },
    { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} />, sort: (r) => r.status },
    {
      key: 'stage',
      label: 'Stage',
      render: (r) => {
        const s = stages[r.id];
        if (!s) return <span class="muted">–</span>;
        return s.active ? `${s.active.stage} ${Math.round(s.active.progress * 100)} %` : `${s.stages.length}/8 stages`;
      },
      sort: (r) => stages[r.id]?.stages.length ?? 0,
    },
    { key: 'gfa', label: 'GFA', render: (r) => (r.floorArea !== undefined ? m2(r.floorArea) : '–'), sort: (r) => r.floorArea ?? 0, align: 'right' },
    { key: 'est', label: 'Estimate', render: (r) => (r.estimate !== undefined ? eurK(r.estimate) : r.spent !== undefined ? <span class="muted">{eurK(r.spent)} spent</span> : '–'), sort: (r) => r.estimate ?? r.spent ?? 0, align: 'right' },
    {
      key: 'worst',
      label: 'Worst grade',
      render: (r) => (r.worst !== undefined ? <b style={{ color: gradeColor(r.worst) }}>{r.worst.toFixed(1)}</b> : <span class="muted">not surveyed</span>),
      sort: (r) => r.worst ?? 0,
      align: 'right',
    },
    { key: 'insp', label: 'Surveyed', render: (r) => (r.inspectedAt !== undefined ? date(r.inspectedAt) : '–'), sort: (r) => r.inspectedAt ?? 0 },
  ];
  return (
    <DataTable
      // (one given up stays, as built, with what it cost; a kit given up is packed away)
      rows={(data ?? []).filter((r) => r.status !== 'struck' && r.status !== 'demolished' && !(r.status === 'cancelled' && r.kit))}
      columns={cols}
      rowKey={(r) => r.id}
      selected={selection.value?.id ?? null}
      onRowClick={(r) => select(r.id, 'structure', { focus: true })}
      initialSort={{ key: 'label', dir: 1 }}
      empty="Nothing built yet — press B to place a building."
      toolbar={
        <Button small kind="primary" onClick={() => setTool('building')}>
          New building (B)
        </Button>
      }
    />
  );
}
