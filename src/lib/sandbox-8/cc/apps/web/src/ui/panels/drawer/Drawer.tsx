/** Bottom drawer: resizable, tabbed (Tab toggles, [ ] switch tabs). */
import type { LogEntry } from '../../../../../../packages/kernel/src/index.ts';
import { useState } from 'preact/hooks';
import { RemedyButtons } from '../../components/Blockers.tsx';
import { cx, Empty, Kbd } from '../../components/common.tsx';
import { EntityLink } from '../../components/EntityLink.tsx';
import { dateTime, relative } from '../../format.ts';
import { useProjection } from '../../hooks.ts';
import { DRAWER_TABS, drawerHeight, drawerOpen, drawerTab, frame, logHistory, save, select } from '../../state.ts';
import { FinanceTab } from './FinanceTab.tsx';
import { BuildingsTab } from './BuildingsTab.tsx';
import { FleetTab } from './FleetTab.tsx';
import { MaterialsTab } from './MaterialsTab.tsx';
import { ProjectsTab, type AlertRow } from './ProjectsTab.tsx';
import { WorkforceTab } from './WorkforceTab.tsx';

function LogTab() {
  const [level, setLevel] = useState<'all' | LogEntry['level']>('all');
  const rows = logHistory.value.filter((e) => level === 'all' || e.level === level).slice(-300).reverse();
  return (
    <div class="log">
      <div class="tbl-bar">
        {(['all', 'info', 'success', 'warn', 'error'] as const).map((l) => (
          <button key={l} class={cx('seg', level === l && 'on')} onClick={() => setLevel(l)}>
            {l}
          </button>
        ))}
      </div>
      <div class="tbl-scroll">
        {rows.length ? (
          <ul class="log-list">
            {rows.map((e, i) => (
              <li key={`${e.t}:${i}`} class={cx('log-row', `lv-${e.level}`)} onClick={() => e.refs?.[0] && select(e.refs[0], undefined, { focus: true })}>
                <span class="num muted log-t">{dateTime(e.t)}</span>
                <span class="log-m">{e.module}</span>
                <span class="log-msg">{e.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No log entries.</Empty>
        )}
      </div>
    </div>
  );
}

function AlertsTab() {
  const { data } = useProjection<AlertRow[]>('settlement.alerts', 1500);
  const now = frame.value?.t ?? 0;
  const rows = (data ?? []).slice().sort((a, b) => Number(b.severity === 'block') - Number(a.severity === 'block'));
  if (!rows.length) return <Empty>No alerts — all work is progressing or waiting normally.</Empty>;
  return (
    <div class="tbl-scroll">
      <ul class="alerts">
        {rows.map((a, i) => (
          <li key={`${a.subject}:${a.code}:${i}`} class={cx('blocker', `sev-${a.severity}`)}>
            <div class="blocker-msg">
              <span class="sev-ico" />
              <EntityLink id={a.subject} kind="workPackage">
                {a.label}
              </EntityLink>
              <span>— {a.message}</span>
              {a.since !== undefined && <span class="muted small"> · {relative(a.since, now)}</span>}
            </div>
            <RemedyButtons remedies={a.remedies} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Drawer() {
  const open = drawerOpen.value;
  const tab = drawerTab.value;
  const h = drawerHeight.value;
  const alerts = frame.value?.alertCount ?? 0;
  const onResize = (ev: PointerEvent) => {
    ev.preventDefault();
    const startY = ev.clientY;
    const startH = h;
    const move = (e: PointerEvent) => {
      drawerHeight.value = Math.max(140, Math.min(window.innerHeight - 160, startH + (startY - e.clientY)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save('drawerHeight', drawerHeight.value);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div class={cx('drawer glass', open && 'open')} style={open ? { height: `${h}px` } : undefined}>
      {open && <div class="drawer-grip" onPointerDown={onResize} title="Drag to resize" />}
      <div class="drawer-tabs">
        {DRAWER_TABS.map((t) => (
          <button
            key={t.id}
            class={cx('dtab', open && tab === t.id && 'on')}
            onClick={() => {
              if (open && tab === t.id) drawerOpen.value = false;
              else {
                drawerTab.value = t.id;
                drawerOpen.value = true;
              }
              save('drawerOpen', drawerOpen.value);
              save('drawerTab', drawerTab.value);
            }}
          >
            {t.label}
            {t.id === 'alerts' && alerts > 0 && <span class="badge">{alerts}</span>}
          </button>
        ))}
        <span class="dtab-hint small muted">
          <Kbd k="Tab" /> {open ? 'hide' : 'show'} · <Kbd k="[" />
          <Kbd k="]" /> switch
        </span>
      </div>
      {open && (
        <div class="drawer-b">
          {tab === 'projects' && <ProjectsTab />}
          {tab === 'buildings' && <BuildingsTab />}
          {tab === 'workforce' && <WorkforceTab />}
          {tab === 'fleet' && <FleetTab />}
          {tab === 'materials' && <MaterialsTab />}
          {tab === 'finance' && <FinanceTab />}
          {tab === 'log' && <LogTab />}
          {tab === 'alerts' && <AlertsTab />}
        </div>
      )}
    </div>
  );
}
