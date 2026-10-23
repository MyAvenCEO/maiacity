/** Root UI: glass panels over the 3D view. */
import { ScoutPanel } from './panels/ScoutPanel.tsx';
import { useEffect } from 'preact/hooks';
import { cx, Kbd } from './components/common.tsx';
import { ExplainPopoverHost } from './components/Explain.tsx';
import { entityLabel } from './components/EntityLink.tsx';
import { AgentPanel } from './panels/AgentPanel.tsx';
import { DesignPanel } from './panels/DesignPanel.tsx';
import { BuildingPanel } from './panels/BuildingPanel.tsx';
import { Drawer } from './panels/drawer/Drawer.tsx';
import { OrderDialog } from './panels/drawer/MaterialsTab.tsx';
import { Inspector } from './panels/Inspector.tsx';
import { DeathNotice, Fatal, Help, Menu, Onboarding, Toasts } from './panels/Overlays.tsx';
import { OverlayLegend, ToolRail } from './panels/ToolRail.tsx';
import { TopBar } from './panels/TopBar.tsx';
import { WorldLayer } from './panels/WorldLayer.tsx';
import { booting, drawerHeight, drawerOpen, fatal, moveTargetFor, scoutOpen, selection, tool } from './state.ts';
import { dragIndex } from './tools/road.ts';

function ModeBanner() {
  const t = tool.value;
  if (t === 'moveTarget' && moveTargetFor.value)
    return (
      <div class="mode-banner glass">
        Click the destination for <b>{entityLabel(moveTargetFor.value)}</b> · <Kbd k="Esc" /> cancel
      </div>
    );
  if (t === 'inspect')
    return (
      <div class="mode-banner glass">
        Condition tool — click a road to see its ZEB grades · <Kbd k="Esc" /> back
      </div>
    );
  return null;
}

export function App() {
  const right = tool.value === 'road' || tool.value === 'building' || !!selection.value;
  useEffect(() => {
    document.body.classList.toggle('dragging', dragIndex.value !== null);
  }, [dragIndex.value]);
  const bottom = drawerOpen.value ? drawerHeight.value + 16 : 46;
  return (
    <div class={cx('ui-root', right && 'has-right', drawerOpen.value && 'drawer-open')} style={{ '--drawer-h': `${bottom}px` }}>
      <WorldLayer />
      <TopBar />
      <ToolRail />
      <AgentPanel />
      {tool.value === 'road' ? <DesignPanel /> : tool.value === 'building' ? <BuildingPanel /> : scoutOpen.value ? <ScoutPanel /> : <Inspector />}
      <Drawer />
      <OverlayLegend />
      <ModeBanner />
      <Onboarding />
      <Toasts />
      <Menu />
      <Help />
      <OrderDialog />
      <ExplainPopoverHost />
      <DeathNotice />
      {booting.value && !fatal.value && (
        <div class="boot glass">
          <span class="spinner" /> Generating terrain, weather and the company… <span class="muted small">(first start takes a few seconds)</span>
        </div>
      )}
      {fatal.value && <Fatal message={fatal.value} />}
    </div>
  );
}
