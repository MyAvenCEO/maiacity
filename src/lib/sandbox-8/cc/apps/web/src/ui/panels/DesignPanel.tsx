/** Road design panel: class choice, validity, key figures, long section, quantities, build. */
import type { RoadDesign } from '../../../../../packages/roads/src/index.ts';
import { Button, cx, Empty, Kbd, KV, Section, Stat } from '../components/common.tsx';
import { ExplainTree, XNum } from '../components/Explain.tsx';
import { LongSection } from '../components/LongSection.tsx';
import { chainage, days, eur, hours, length, m3, metres, num, pctv, qty, tonnes } from '../format.ts';
import { world } from '../state.ts';
import {
  buildResult,
  building,
  cancelDraft,
  commit,
  cursorSnap,
  draftLabel,
  draftPoints,
  hoverStation,
  noSnap,
  preview,
  previewBusy,
  previewError,
  previewWithCursor,
  removeLast,
  roadClass,
  setRoadClass,
} from '../tools/road.ts';
import { setTool } from '../tools/controller.ts';

function ClassCards() {
  const w = world.value;
  const cur = roadClass.value;
  if (!w) return null;
  return (
    <div class="cls-grid">
      {w.roadClasses.map((c) => {
        const width = c.carriageway + 2 * (c.shoulder ?? 0);
        return (
          <button key={c.id} class={cx('cls-card', cur?.id === c.id && 'on')} onClick={() => setRoadClass(c.id)} title={c.description}>
            <span class="cls-swatch" style={{ background: c.color }} />
            <span class="cls-label">{c.label}</span>
            <span class="cls-std">{c.standard}</span>
            <span class="cls-specs num">
              {num(c.carriageway, 2)} m {c.surface}
              {c.shoulder ? ` · ${num(width, 1)} m wide` : ''}
            </span>
            {(c.minRadius !== undefined || c.maxGrade !== undefined) && (
              <span class="cls-specs num muted">
                {c.designSpeed ? `${c.designSpeed} km/h · ` : ''}R ≥ {num(c.minRadius, 0)} m · ≤ {num(c.maxGrade, 1)} %
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function matLabel(id: string): { label: string; unit: string } {
  const m = world.value?.materials.find((x) => x.id === id);
  return { label: m?.label ?? id, unit: m?.unit ?? '' };
}

function Figures({ d }: { d: RoadDesign }) {
  const cls = roadClass.value;
  const minR = cls?.minRadius;
  const maxG = cls?.maxGrade;
  const radiusBad = minR !== undefined && d.alignment.length > 2 && d.minRadius < minR - 0.5;
  const gradePct = d.maxGradeUsed * 100; // design reports a fraction
  const gradeBad = maxG !== undefined && gradePct > maxG + 0.05;
  const straight = !Number.isFinite(d.minRadius) || d.minRadius > 1e5;
  return (
    <div class="stat-grid">
      <Stat label="Length" value={length(d.length)} sub={`${d.sections.length} sections`} />
      <Stat label="Min radius" value={straight ? 'straight' : metres(d.minRadius)} sub={minR !== undefined ? `class min ${metres(minR)}` : undefined} tone={radiusBad ? 'bad' : undefined} />
      <Stat label="Max grade" value={pctv(gradePct)} sub={maxG !== undefined ? `class max ${pctv(maxG)}` : undefined} tone={gradeBad ? 'bad' : undefined} />
      <Stat label="Est. cost" value={<XNum tree={d.estimate.explain} title="Estimated construction cost">{eur(d.estimate.cost)}</XNum>} sub={d.length > 0 ? `${eur(d.estimate.cost / d.length)} per m` : undefined} />
      <Stat label="Duration" value={days(d.estimate.days, 1)} sub={`${hours(d.estimate.hours, 0)} crew-hours`} tip="Working days: the slowest trade sets the pace, the others add one section each; 8 productive h/day with ~20 % weather allowance" />
      <Stat
        label="Connects"
        value={
          <span class="small">
            {d.connections.start ? 'start ✓' : 'start –'} · {d.connections.end ? 'end ✓' : 'end –'}
          </span>
        }
        sub={d.connections.start || d.connections.end ? 'to the road network' : 'not connected'}
        tone={!d.connections.start && !d.connections.end ? 'warn' : undefined}
      />
    </div>
  );
}

function Earthworks({ d }: { d: RoadDesign }) {
  const t = d.totals;
  return (
    <KV
      rows={[
        [<span><i class="sw sw-cut" /> Cut (bank)</span>, m3(t.cut)],
        ['  of which suitable as fill', tonnes(t.suitableCut)],
        [<span><i class="sw sw-fill" /> Fill (compacted)</span>, m3(t.fill)],
        ['Topsoil strip', m3(t.topsoil)],
        ['Imported fill', <span class={t.importFill > 0 ? 'c-warn' : ''}>{tonnes(t.importFill)}</span>],
        ['Spoil to haul off', tonnes(t.spoilTonnes)],
        ['Trees to fell', num(t.trees)],
        ['Culverts', num(t.culverts)],
      ]}
    />
  );
}

function Pavement({ d }: { d: RoadDesign }) {
  const cls = roadClass.value;
  const layers = cls?.layers ?? [];
  return (
    <div>
      {layers.length > 0 && (
        <div class="layers">
          {layers.map((l) => (
            <div key={l.id} class={cx('layer', `lk-${l.kind}`)}>
              <span>{l.label}</span>
              <span class="num">{l.thickness !== undefined ? `${num(l.thickness * 100, 0)} cm` : 'per section ↓'}</span>
            </div>
          ))}
        </div>
      )}
      <table class="tbl tbl-mini">
        <thead>
          <tr>
            <th>Section</th>
            <th title="Frost susceptibility class of the subgrade (ZTV E-StB)">Frost cl.</th>
            <th class="al-right" title="Frost protection layer thickness (RStO Tab. 6/7) — click for derivation">FSS</th>
            <th class="al-right">max cut</th>
            <th class="al-right">max fill</th>
          </tr>
        </thead>
        <tbody>
          {d.sections.map((s) => (
            <tr key={s.index} onMouseEnter={() => (hoverStation.value = { s: s.s0, x: s.mid[0], z: s.mid[1], ground: 0, surface: 0, formation: 0, cut: 0, fill: 0, left: 0, right: 0, water: false })} onMouseLeave={() => (hoverStation.value = null)}>
              <td class="num">
                {chainage(s.s0)}–{chainage(s.s1)}
              </td>
              <td class={s.frostClass === 'F3' ? 'c-warn' : ''}>{s.frostClass}</td>
              <td class="al-right">
                <XNum tree={s.frostExplain} title={`Frost protection layer ${chainage(s.s0)}`}>
                  {num(s.frostLayer * 100, 0)} cm
                </XNum>
              </td>
              <td class="al-right num c-cut">{s.maxCut > 0.05 ? metres(s.maxCut, 1) : '–'}</td>
              <td class="al-right num c-fill">{s.maxFill > 0.05 ? metres(s.maxFill, 1) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Materials({ d }: { d: RoadDesign }) {
  const entries = Object.entries(d.totals.materials).filter(([, v]) => v > 0.001);
  if (!entries.length) return <Empty>No purchased materials.</Empty>;
  return (
    <KV
      rows={entries.map(([id, v]) => {
        const m = matLabel(id);
        return [m.label, qty(v, m.unit, m.unit === 't' || m.unit === 'm3' ? 0 : undefined)];
      })}
    />
  );
}

export function DesignPanel() {
  const pts = draftPoints.value;
  const d = preview.value;
  const cls = roadClass.value;
  const snap = cursorSnap.value;
  const res = buildResult.value;
  const canBuild = pts.length >= 2 && !building.value && !(d && !previewWithCursor.value && !d.valid);
  return (
    <div class="side glass design">
      <div class="side-h">
        <div>
          <div class="side-kind sc">Road design</div>
          <div class="side-title">{cls?.label ?? 'Road'}</div>
        </div>
        <div class="side-h-r">
          {previewBusy.value && <span class="spinner" title="Updating design…" />}
          {d && <span class={cx('pill', d.valid ? 'tone-good' : 'tone-bad')}>{d.valid ? 'Valid' : 'Invalid'}</span>}
          <button class="icon-btn" onClick={() => (cancelDraft(), setTool('select'))} title="Close (Esc)">
            ✕
          </button>
        </div>
      </div>
      <div class="side-b">
        <Section key={pts.length ? 'c' : 'o'} title="Road class" open={pts.length === 0} right={cls && <span class="muted small">{cls.standard}</span>}>
          <ClassCards />
        </Section>

        {pts.length === 0 && (
          <div class="hint-box">
            <b>Click on the terrain</b> to place the first control point — start near an existing road so the new road connects (snap within {num(world.value?.roadSettings?.connectDistance ?? 25)} m).
            {snap ? (
              <div class="snap-msg">
                <span class="snap-ring" /> Connects to <b>{snap.label}</b> ({metres(snap.distance, 1)})
              </div>
            ) : (
              <div class="muted small">Hold Alt to place without snapping.</div>
            )}
          </div>
        )}

        {pts.length > 0 && (
          <div class="draft-line small">
            <span class="num">{pts.length} points</span>
            {previewWithCursor.value && <span class="tag">incl. cursor</span>}
            {snap && !noSnap.value && (
              <span class="snap-msg">
                <span class="snap-ring" /> {snap.label} · {metres(snap.distance, 1)}
              </span>
            )}
            <span class="muted">drag points to move · right-click removes last</span>
          </div>
        )}

        {previewError.value && <div class="msg msg-bad">Preview failed: {previewError.value}</div>}

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
            <Figures d={d} />
            <Section title="Long section" right={<span class="muted small">exaggerated vertically</span>}>
              <LongSection stations={d.stations} sections={d.sections} {...(cls?.maxGrade !== undefined ? { maxGrade: cls.maxGrade } : {})} onHover={(st) => (hoverStation.value = st)} />
            </Section>
            <Section title="Earthworks">
              <Earthworks d={d} />
            </Section>
            <Section title="Pavement build-up" right={<span class="muted small">frost zone {world.value?.roadSettings?.frostZone ?? '–'}</span>}>
              <Pavement d={d} />
            </Section>
            <Section title="Materials to order">
              <Materials d={d} />
            </Section>
            <Section title="Cost breakdown" open={false}>
              <ExplainTree tree={d.estimate.explain} />
            </Section>
          </>
        )}
        {!d && pts.length === 1 && <Empty>Move the cursor to see the design for the next point; click to place it.</Empty>}
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
          <input class="inp grow" placeholder="Name (optional)" value={draftLabel.value} onInput={(e) => (draftLabel.value = (e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && void commit()} />
        </div>
        <div class="row">
          <Button kind="primary" class="grow" hotkey="Enter" disabled={!canBuild} onClick={() => void commit()} tip="Plan the road: creates the construction project (roads.plan)">
            {building.value ? 'Planning…' : 'Build'}
          </Button>
          <Button onClick={removeLast} disabled={!pts.length} tip="Remove the last point (Backspace or right-click)">
            Undo
          </Button>
          <Button kind="ghost" onClick={() => cancelDraft()} disabled={!pts.length} tip="Discard the draft (Esc)">
            Clear <Kbd k="Esc" />
          </Button>
        </div>
      </div>
    </div>
  );
}
