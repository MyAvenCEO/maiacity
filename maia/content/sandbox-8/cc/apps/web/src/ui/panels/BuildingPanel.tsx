/** Building design panel: type, placement, dimensions, geometry, platform, elements, estimate, build. */
import type { BuildingDesign } from '../../../../../packages/buildings/src/index.ts';
import { Button, cx, Empty, Kbd, KV, Section, Stat } from '../components/common.tsx';
import { ExplainTree, XNum } from '../components/Explain.tsx';
import { days, eur, hours, m2, m3, metres, num, qty } from '../format.ts';
import { world } from '../state.ts';
import {
  bAligned,
  bBuilding,
  bBusy,
  bFloors,
  bLabel,
  bLength,
  bPlaced,
  bPreview,
  bResult,
  bRotation,
  bWidth,
  buildingType,
  cancelBuilding,
  commitBuilding,
  rotate,
  setBuildingType,
} from '../tools/building.ts';
import { setTool } from '../tools/controller.ts';

const CAT_COLOR: Record<string, string> = { residential: '#3987e5', commercial: '#d95926', agricultural: '#199e70', public: '#9085e9' };

function TypeCards() {
  const types = world.value?.buildingTypes ?? [];
  const cur = buildingType.value;
  if (!types.length) return <Empty>No building types in the data pack.</Empty>;
  return (
    <div class="cls-grid">
      {types.map((t) => (
        <button key={t.id} class={cx('cls-card', cur?.id === t.id && 'on')} onClick={() => setBuildingType(t.id)} title={t.description}>
          <span class="cls-swatch" style={{ background: CAT_COLOR[t.category] ?? '#888' }} />
          <span class="cls-label">{t.label}</span>
          <span class="cls-std">{t.category}</span>
          <span class="cls-specs num">
            {num(t.length, 1)} × {num(t.width, 1)} m · {t.floors} {t.floors === 1 ? 'floor' : 'floors'}
          </span>
        </button>
      ))}
    </div>
  );
}

function NumField({ label, value, placeholder, onChange, step = 0.5, unit }: { label: string; value: number | null; placeholder: number | undefined; onChange: (v: number | null) => void; step?: number; unit?: string }) {
  return (
    <label class="nfield">
      <span class="sc">{label}</span>
      <span class="row nowrap">
        <input
          class="inp num w60"
          type="number"
          step={step}
          value={value ?? ''}
          placeholder={placeholder !== undefined ? String(placeholder) : ''}
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            onChange(v === '' ? null : Number(v));
          }}
        />
        {unit && <span class="small muted">{unit}</span>}
      </span>
    </label>
  );
}

function Elements({ d }: { d: BuildingDesign }) {
  const rows = [...d.elements].sort((a, b) => a.din276.localeCompare(b.din276));
  return (
    <table class="tbl tbl-mini">
      <thead>
        <tr>
          <th title="DIN 276 cost group">KG</th>
          <th>Element</th>
          <th class="al-right">Quantity</th>
          <th class="al-right">Cost</th>
          <th class="al-right">Hours</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id} title={e.serviceLife ? `service life ${e.serviceLife} a (BBSR)` : undefined}>
            <td class="num muted">{e.din276}</td>
            <td class="ellipsis" style={{ maxWidth: '120px' }}>
              {e.label}
            </td>
            <td class="al-right num">{qty(e.quantity, e.unit, e.quantity >= 100 ? 0 : 1)}</td>
            <td class="al-right num">{eur(e.cost)}</td>
            <td class="al-right num">{num(e.hours, 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BuildingPanel() {
  const t = buildingType.value;
  const d = bPreview.value;
  const placed = bPlaced.value;
  const g = d?.geometry;
  const res = bResult.value;
  return (
    <div class="side glass design">
      <div class="side-h">
        <div class="side-h-l">
          <div class="side-kind sc">Building design</div>
          <div class="side-title">{t?.label ?? 'Building'}</div>
        </div>
        <div class="side-h-r">
          {bBusy.value && <span class="spinner" title="Updating design…" />}
          {d && <span class={cx('pill', d.valid ? 'tone-good' : 'tone-bad')}>{d.valid ? 'Valid' : 'Invalid'}</span>}
          <button class="icon-btn" onClick={() => (cancelBuilding(), setTool('select'))} title="Close (Esc)">
            ✕
          </button>
        </div>
      </div>
      <div class="side-b">
        <Section key={placed ? 'p' : 'f'} title="Building type" open={!placed} right={t && <span class="muted small">{t.category}</span>}>
          <TypeCards />
        </Section>
        <div class="hint-box">
          {placed ? (
            <>
              <b>Placed.</b> Click elsewhere to move it, right-click to pick it up again.
            </>
          ) : (
            <>
              <b>Move the cursor</b> over the terrain and <b>click</b> to place the footprint.
            </>
          )}{' '}
          <Kbd k="Q" />/<Kbd k="E" /> or Alt+wheel rotate · <Kbd k="Shift" /> align to the nearest road.
          {bAligned.value && <div class="snap-msg">aligned to {bAligned.value}</div>}
        </div>
        <div class="row dims">
          <NumField label="Length" unit="m" value={bLength.value} placeholder={g?.length ?? t?.length} onChange={(v) => (bLength.value = v)} />
          <NumField label="Width" unit="m" value={bWidth.value} placeholder={g?.width ?? t?.width} onChange={(v) => (bWidth.value = v)} />
          <NumField label="Floors" step={1} value={bFloors.value} placeholder={g?.floors ?? t?.floors} onChange={(v) => (bFloors.value = v)} />
          <label class="nfield">
            <span class="sc">Rotation</span>
            <span class="row nowrap">
              <button class="icon-btn" onClick={() => rotate(-15)} title="Rotate −15° (Q)">
                ↺
              </button>
              <span class="num">{bRotation.value}°</span>
              <button class="icon-btn" onClick={() => rotate(15)} title="Rotate +15° (E)">
                ↻
              </button>
            </span>
          </label>
        </div>
        {d && (
          <>
            {(d.problems.length > 0 || d.warnings.length > 0 || d.findings.length > 0) && (
              <ul class="issues">
                {d.problems.map((p, i) => (
                  <li key={`p${i}`} class="msg msg-bad">
                    {p}
                  </li>
                ))}
                {d.findings.map((f, i) => (
                  <li key={`f${i}`} class="msg msg-advice" title={f.source ? `${f.source.title}${f.source.publisher ? ` — ${f.source.publisher}` : ''}` : f.rulebook}>
                    <span class="advice-by">{f.rulebook}</span> {f.message}
                  </li>
                ))}
                {d.warnings.map((p, i) => (
                  <li key={`w${i}`} class="msg msg-warn">
                    {p}
                  </li>
                ))}
              </ul>
            )}
            <div class="stat-grid">
              <Stat label="GFA" value={m2(g!.gfa)} sub={`footprint ${m2(g!.footprint)}`} tip="Gross floor area (BGF, DIN 277)" />
              <Stat label="Size" value={`${num(g!.length, 0)}×${num(g!.width, 0)} m`} sub={`${g!.floors} fl. · ${metres(g!.height, 1)} high`} />
              <Stat label="Access" value={d.access ? metres(d.access.distance) : 'none'} sub="to the nearest road" tone={d.access ? undefined : 'bad'} />
              <Stat label="Est. cost" value={<XNum tree={d.estimate.explain} title="Estimated building cost">{eur(d.estimate.cost)}</XNum>} sub={`${eur(d.estimate.costPerM2)} per m² GFA`} />
              <Stat label="Duration" value={days(d.estimate.days, 1)} sub={`${hours(d.estimate.hours, 0)} work-hours`} />
              <Stat label="Platform" value={`${num(g!.platform, 2)} m`} sub="finished level a.s.l." />
            </div>
            <Section title="Geometry">
              <KV
                rows={[
                  ['External wall (gross)', m2(g!.wallGross)],
                  ['  windows', m2(g!.windowArea)],
                  ['  net wall', m2(g!.wallNet)],
                  ['Roof area', m2(g!.roofArea)],
                  ['Slab area', m2(g!.slabArea)],
                  ['Perimeter', metres(g!.perimeter, 1)],
                  ['Roof pitch', `${num(g!.roofPitch, 0)}°`],
                ]}
              />
            </Section>
            <Section title="Platform earthworks">
              <KV
                rows={[
                  [<span><i class="sw sw-cut" /> Cut</span>, m3(g!.platformCut)],
                  [<span><i class="sw sw-fill" /> Fill</span>, m3(g!.platformFill)],
                  ['Topsoil strip', m3(g!.topsoil)],
                  ['Excavation (foundations)', m3(g!.excavation)],
                ]}
              />
            </Section>
            <Section title={`Elements (${d.elements.length})`}>
              <Elements d={d} />
            </Section>
            <Section title="Cost breakdown" open={false}>
              <ExplainTree tree={d.estimate.explain} />
            </Section>
          </>
        )}
        {!d && <Empty>{placed || bBusy.value ? 'Computing design…' : 'Hover over the terrain to preview the building.'}</Empty>}
      </div>
      <div class="side-f">
        {res && !res.ok && (
          <ul class="issues">
            {res.messages.map((m, i) => (
              <li key={i} class="msg msg-bad">
                {m}
              </li>
            ))}
          </ul>
        )}
        <div class="row">
          <input class="inp grow" placeholder="Name (optional)" value={bLabel.value} onInput={(e) => (bLabel.value = (e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && void commitBuilding()} />
        </div>
        <div class="row">
          <Button kind="primary" class="grow" hotkey="Enter" disabled={!placed || bBuilding.value || (!!d && !d.valid)} onClick={() => void commitBuilding()} tip="Plan the building: creates the construction project (structures.build)">
            {bBuilding.value ? 'Planning…' : 'Build'}
          </Button>
          <Button kind="ghost" onClick={() => (cancelBuilding(), setTool('select'))} tip="Cancel (Esc)">
            Cancel <Kbd k="Esc" />
          </Button>
        </div>
      </div>
    </div>
  );
}
