/** Left tool rail: tools with hotkeys, overlay picker, help. */
import { useState } from 'preact/hooks';
import { cx, Icon } from '../components/common.tsx';
import { num } from '../format.ts';
import { helpOpen, overlay, OVERLAYS, scoutOpen, tool, world } from '../state.ts';
import type { OverlayLayer } from '../../protocol.ts';
import { overlayData, setTool } from '../tools/controller.ts';
import { overlayRgba } from '../../render/colors.ts';

const TOOLS = [
  { id: 'select', icon: 'select', label: 'Select', key: 'V', hint: 'Click machines, people, stores, work fronts or roads to inspect them' },
  { id: 'road', icon: 'road', label: 'Road', key: 'R', hint: 'Design and build a road: click points on the terrain, Enter to build' },
  { id: 'building', icon: 'building', label: 'Building', key: 'B', hint: 'Place a building: click to place, Q/E rotate, Shift aligns to the road, Enter to build' },
  { id: 'inspect', icon: 'inspect', label: 'Condition', key: 'I', hint: 'Click a road to see its condition (ZEB grades) and order inspections or maintenance' },
] as const;

export function ToolRail() {
  const [ovOpen, setOvOpen] = useState(false);
  return (
    <div class="rail glass">
      {TOOLS.map((t) => (
        <button key={t.id} class={cx('rail-btn', tool.value === t.id && 'on')} onClick={() => setTool(t.id)} data-tip={`${t.label} (${t.key}) — ${t.hint}`} data-tip-side="right">
          <Icon name={t.icon} size={20} />
          <span class="rail-key">{t.key}</span>
        </button>
      ))}
      <div class="rail-sep" />
      <button class={cx('rail-btn', scoutOpen.value && 'on')} onClick={() => (scoutOpen.value = !scoutOpen.value)} data-tip="Scout (K) — where is a good place, for what? Pick or edit a goal, see it on the map, find the best places" data-tip-side="right">
        <Icon name="scout" size={20} />
        <span class="rail-key">K</span>
      </button>
      <div class="rail-ov">
        <button class={cx('rail-btn', overlay.value !== 'none' && 'on')} onClick={() => setOvOpen(!ovOpen)} data-tip="Map overlays (L cycles)" data-tip-side="right">
          <Icon name="layers" size={20} />
          <span class="rail-key">L</span>
        </button>
        {ovOpen && (
          <div class="ov-menu glass" onMouseLeave={() => setOvOpen(false)}>
            {[
              { title: 'Ground', items: OVERLAYS.map((o) => ({ id: o.id, label: o.label, hint: o.hint })) },
              { title: 'Scouting: criteria', items: (world.value?.siting.criteria ?? []).map((c) => ({ id: `crit:${c.id}` as OverlayLayer, label: c.label, hint: `${c.description} (${c.unit}; known from ${c.knowledge})` })) },
              { title: 'Scouting: goals', items: (world.value?.siting.goals ?? []).map((g) => ({ id: `goal:${g.id}` as OverlayLayer, label: g.label, hint: g.description ?? g.label })) },
            ].map((group) => (
              <div key={group.title}>
                <div class="sc muted ov-title">{group.title}</div>
                {group.items.map((o) => (
                  <button
                    key={o.id}
                    class={cx('ov-item', overlay.value === o.id && 'on')}
                    title={o.hint}
                    onClick={() => {
                      overlay.value = o.id;
                      setOvOpen(false);
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <div class="rail-fill" />
      <button class="rail-btn" onClick={() => (helpOpen.value = !helpOpen.value)} data-tip="Keyboard shortcuts (?)" data-tip-side="right">
        <Icon name="help" size={20} />
      </button>
    </div>
  );
}

/** Legend for the active overlay (bottom-left of the view). */
export function OverlayLegend() {
  const o = overlay.value;
  if (o === 'none') return null;
  const d = overlayData.value;
  const meta = OVERLAYS.find((x) => x.id === o) ?? { label: o.startsWith('goal:') ? 'Suitability' : 'Scouting', hint: '' };
  return (
    <div class="ov-legend glass">
      <div class="ov-legend-h">
        <span class="sc">{meta.label} overlay</span>
        <button class="icon-btn" onClick={() => (overlay.value = 'none')} title="Hide overlay (L)">
          ✕
        </button>
      </div>
      {d && o === 'soil' ? (
        <>
          <div class="small">Subsoil class at 0.8 m depth</div>
          <div class="ov-cats">
            {(d.label.split(':')[1] ?? '')
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
              .map((name, i) => {
                const c = overlayRgba('soil', i, d.min, d.max);
                return (
                  <span key={name} class="small">
                    <i class="sw" style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }} /> {name}
                  </span>
                );
              })}
          </div>
        </>
      ) : d ? (
        <>
          <div class="small">{d.label}</div>
          <div
            class="ov-ramp"
            style={{
              background: `linear-gradient(90deg, ${Array.from({ length: 9 }, (_, i) => {
                const c = overlayRgba(o, d.min + ((d.max - d.min) * i) / 8, d.min, d.max);
                return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
              }).join(',')})`,
            }}
          />
          <div class="ov-scale num small">
            <span>
              {num(d.min, d.max - d.min < 5 ? 1 : 0)} {d.unit}
            </span>
            <span>
              {num(d.max, d.max - d.min < 5 ? 1 : 0)} {d.unit}
            </span>
          </div>
        </>
      ) : (
        <div class="small muted">{meta.hint} — no data for this layer yet.</div>
      )}
    </div>
  );
}
