/** Right-hand inspector for the selected entity (refreshes every second while visible). */
import { Section, Empty, Icon } from '../components/common.tsx';
import { BlockerList } from '../components/Blockers.tsx';
import { ExplainTree } from '../components/Explain.tsx';
import { dateTime, titleCase } from '../format.ts';
import { useQuery } from '../hooks.ts';
import { focusEntity, follow, following, select, selection } from '../state.ts';
import type { InspectResult } from '../../protocol.ts';
import type { Explained } from '../../../../../packages/kernel/src/index.ts';
import { RoadInspector } from './inspectors/RoadInspector.tsx';
import { StructureInspector } from './inspectors/StructureInspector.tsx';
import { PackageInspector, ProjectInspector } from './inspectors/WorkInspectors.tsx';
import { MachineInspector, OrderInspector, PersonInspector, StoreInspector } from './inspectors/ResourceInspectors.tsx';

type Kind = 'structure' | 'road' | 'workPackage' | 'project' | 'machine' | 'person' | 'store' | 'order' | 'generic';

function kindOf(d: InspectResult): Kind {
  const c = d.components;
  if (c.Structure) return 'structure';
  if (c.Road) return 'road';
  if (c.WorkPackage) return 'workPackage';
  if (c.Project) return 'project';
  if (c.Machine) return 'machine';
  if (c.Person) return 'person';
  if (c.Store) return 'store';
  if (c.Order) return 'order';
  return 'generic';
}

const KIND_LABEL: Record<Kind, string> = { structure: 'Structure', road: 'Road', workPackage: 'Work package', project: 'Project', machine: 'Machine', person: 'Person', store: 'Store', order: 'Order', generic: 'Entity' };

function titleOf(d: InspectResult, k: Kind): string {
  const c = d.components as Record<string, { label?: string; name?: string } | undefined>;
  if (k === 'person') return c.Person?.name ?? d.meta.id;
  if (k === 'machine') return (d.details?.model as { label?: string } | undefined)?.label ?? d.meta.name ?? d.meta.id;
  for (const comp of Object.values(c)) if (comp && typeof comp === 'object' && typeof comp.label === 'string') return comp.label;
  return d.meta.name ?? d.meta.id;
}

/** Hidden truth that the player only learns through inspections. */
const HIDDEN = new Set(['RoadCondition']);

function isExplained(v: unknown): v is Explained {
  return !!v && typeof v === 'object' && 'op' in (v as object) && 'v' in (v as object);
}

function Dump({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span class="muted">–</span>;
  if (isExplained(value)) return <ExplainTree tree={value} />;
  if (typeof value !== 'object') return <span class="num">{typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(3)) : String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length > 20 || depth > 2) return <span class="muted">[{value.length} items]</span>;
    return (
      <ol class="dump">
        {value.map((v, i) => (
          <li key={i}>
            <Dump value={v} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  if (depth > 3) return <span class="muted">{'{…}'}</span>;
  return (
    <dl class="dump">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div key={k} class="dump-row">
          <dt>{k}</dt>
          <dd>
            <Dump value={v} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Generic({ data }: { data: InspectResult }) {
  return (
    <>
      <BlockerList blockers={data.blockers} />
      {Object.entries(data.components)
        .filter(([k]) => !HIDDEN.has(k))
        .map(([k, v]) => (
          <Section key={k} title={k} open={Object.keys(data.components).length <= 2}>
            <Dump value={v} />
          </Section>
        ))}
    </>
  );
}

export function Inspector() {
  const sel = selection.value;
  const { data, error, loaded } = useQuery<InspectResult | null>(sel ? { kind: 'inspect', id: sel.id } : null, 1000);
  if (!sel) return null;
  const k = data ? kindOf(data) : 'generic';
  return (
    <div class="side glass inspector">
      <div class="side-h">
        <div class="side-h-l">
          <div class="side-kind sc">{data ? KIND_LABEL[k] : (titleCase(sel.kind ?? 'entity'))}</div>
          <div class="side-title">{data ? titleOf(data, k) : '…'}</div>
        </div>
        <div class="side-h-r">
          <button class="icon-btn" onClick={() => focusEntity(sel.id)} title="Focus camera (F)">
            <Icon name="focus" />
          </button>
          <label class="follow-box" title="Keep the camera on it as it moves">
            <input type="checkbox" checked={following.value === sel.id} onChange={(e) => follow((e.currentTarget as HTMLInputElement).checked ? sel.id : null)} />
            <span>Follow</span>
          </label>
          <button class="icon-btn" onClick={() => select(null)} title="Close (Esc)">
            <Icon name="close" />
          </button>
        </div>
      </div>
      <div class="side-b">
        {error && <div class="msg msg-bad">{error}</div>}
        {loaded && data === null && <Empty>This entity no longer exists.</Empty>}
        {data &&
          (k === 'structure' ? (
            <StructureInspector data={data} />
          ) : k === 'road' ? (
            <RoadInspector data={data} />
          ) : k === 'workPackage' ? (
            <PackageInspector data={data} />
          ) : k === 'project' ? (
            <ProjectInspector data={data} />
          ) : k === 'machine' ? (
            <MachineInspector data={data} />
          ) : k === 'person' ? (
            <PersonInspector data={data} />
          ) : k === 'store' ? (
            <StoreInspector data={data} />
          ) : k === 'order' ? (
            <OrderInspector data={data} />
          ) : (
            <Generic data={data} />
          ))}
        {data && k !== 'generic' && (
          <Section title="Raw data" open={false}>
            <Generic data={data} />
          </Section>
        )}
        {data && <div class="small muted id-line">{data.meta.id} · created {dateTime(data.meta.createdAt)} by {data.meta.createdBy}</div>}
        {!loaded && !error && (
          <div class="spinner-row">
            <span class="spinner" />
          </div>
        )}
      </div>
    </div>
  );
}
