/**
 * Long section (Längsschnitt): existing ground vs. design surface along chainage, with cut
 * (orange) / fill (blue) shading, grade labels per section and a hover crosshair that reports
 * the station (and highlights it in the 3D view through onHover).
 */
import type { SectionDesign, Station } from '../../../../../packages/roads/src/index.ts';
import { useMemo, useState } from 'preact/hooks';
import { chainage, num } from '../format.ts';
import { useWidth } from '../hooks.ts';

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

function interp(stations: Station[], s: number, key: 'surface' | 'ground'): number {
  if (!stations.length) return 0;
  if (s <= stations[0]!.s) return stations[0]![key];
  for (let i = 1; i < stations.length; i += 1) {
    const b = stations[i]!;
    if (b.s >= s) {
      const a = stations[i - 1]!;
      const f = (s - a.s) / Math.max(1e-9, b.s - a.s);
      return a[key] + (b[key] - a[key]) * f;
    }
  }
  return stations[stations.length - 1]![key];
}

export function LongSection({ stations, sections, maxGrade, height = 170, onHover }: { stations: Station[]; sections: SectionDesign[]; maxGrade?: number; height?: number; onHover?: (st: Station | null) => void }) {
  const [box, W] = useWidth<HTMLDivElement>(360);
  const H = height;
  const pad = { l: 34, r: 8, t: 16, b: 18 };
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (stations.length < 2) return null;
    const L = stations[stations.length - 1]!.s - stations[0]!.s || 1;
    const s0 = stations[0]!.s;
    let hMin = Infinity;
    let hMax = -Infinity;
    for (const st of stations) {
      hMin = Math.min(hMin, st.ground, st.surface);
      hMax = Math.max(hMax, st.ground, st.surface);
    }
    const span = Math.max(4, hMax - hMin);
    hMin -= span * 0.12;
    hMax += span * 0.18;
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const x = (s: number) => pad.l + ((s - s0) / L) * iw;
    const y = (h: number) => pad.t + ((hMax - h) / (hMax - hMin)) * ih;
    // cut/fill polygons per segment, split at crossings
    const cut: string[] = [];
    const fill: string[] = [];
    for (let i = 1; i < stations.length; i += 1) {
      const a = stations[i - 1]!;
      const b = stations[i]!;
      const da = a.surface - a.ground;
      const db = b.surface - b.ground;
      const poly = (pts: [number, number][], into: string[]) => into.push(pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' '));
      if (da * db >= 0) {
        const pts: [number, number][] = [
          [x(a.s), y(a.ground)],
          [x(b.s), y(b.ground)],
          [x(b.s), y(b.surface)],
          [x(a.s), y(a.surface)],
        ];
        if (Math.abs(da) + Math.abs(db) > 0.01) poly(pts, da + db < 0 ? cut : fill);
      } else {
        const f = da / (da - db);
        const sc = a.s + (b.s - a.s) * f;
        const hc = a.ground + (b.ground - a.ground) * f;
        poly([[x(a.s), y(a.ground)], [x(sc), y(hc)], [x(a.s), y(a.surface)]], da < 0 ? cut : fill);
        poly([[x(sc), y(hc)], [x(b.s), y(b.ground)], [x(b.s), y(b.surface)]], db < 0 ? cut : fill);
      }
    }
    const line = (k: 'ground' | 'surface') => stations.map((st, i) => `${i ? 'L' : 'M'}${x(st.s).toFixed(1)},${y(st[k]).toFixed(1)}`).join('');
    const sStep = niceStep(L, 5);
    const sTicks: number[] = [];
    for (let s = Math.ceil(s0 / sStep) * sStep; s <= s0 + L + 1e-6; s += sStep) sTicks.push(s);
    const hStep = niceStep(hMax - hMin, 4);
    const hTicks: number[] = [];
    for (let h = Math.ceil(hMin / hStep) * hStep; h <= hMax; h += hStep) hTicks.push(h);
    // grade labels per section (thin out when crowded)
    const every = Math.max(1, Math.ceil(sections.length / 8));
    const grades = sections
      .filter((_, i) => i % every === 0)
      .map((sec) => {
        const a = sec.s0;
        const b = every > 1 ? Math.min(sections[Math.min(sections.length - 1, sec.index + every - 1)]?.s1 ?? sec.s1, s0 + L) : sec.s1;
        const ha = interp(stations, a, 'surface');
        const hb = interp(stations, b, 'surface');
        const g = ((hb - ha) / Math.max(1e-6, b - a)) * 100;
        return { x: (x(a) + x(b)) / 2, y: Math.min(y(ha), y(hb)) - 4, g, x0: x(a) };
      });
    return { x, y, cut, fill, ground: line('ground'), surface: line('surface'), sTicks, hTicks, grades, iw, ih, s0, L };
  }, [stations, sections, H, W]);

  if (!geo)
    return (
      <div class="lsec" ref={box}>
        <div class="empty">Place at least two points to see the long section.</div>
      </div>
    );

  const hv = hover !== null ? stations[hover] : null;
  const onMove = (ev: MouseEvent) => {
    const svg = ev.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const s = geo.s0 + ((px - pad.l) / geo.iw) * geo.L;
    let best = 0;
    let bd = Infinity;
    stations.forEach((st, i) => {
      const d = Math.abs(st.s - s);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
    onHover?.(stations[best]!);
  };

  return (
    <div class="lsec" ref={box}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(null);
          onHover?.(null);
        }}
      >
        {geo.hTicks.map((h) => (
          <g key={`h${h}`}>
            <line class="grid" x1={pad.l} x2={W - pad.r} y1={geo.y(h)} y2={geo.y(h)} />
            <text class="axis" x={pad.l - 4} y={geo.y(h) + 3} text-anchor="end">
              {num(h, 0)}
            </text>
          </g>
        ))}
        {geo.sTicks.map((s) => (
          <g key={`s${s}`}>
            <line class="grid" x1={geo.x(s)} x2={geo.x(s)} y1={pad.t} y2={H - pad.b} />
            <text class="axis" x={geo.x(s)} y={H - 5} text-anchor="middle">
              {chainage(s)}
            </text>
          </g>
        ))}
        {geo.cut.map((p, i) => (
          <polygon key={`c${i}`} class="ls-cut" points={p} />
        ))}
        {geo.fill.map((p, i) => (
          <polygon key={`f${i}`} class="ls-fill" points={p} />
        ))}
        <path class="ls-ground" d={geo.ground} />
        <path class="ls-surface" d={geo.surface} />
        {stations.map((st, i) => (st.water ? <line key={`w${i}`} class="ls-water" x1={geo.x(st.s)} x2={geo.x(st.s)} y1={H - pad.b - 3} y2={H - pad.b} /> : null))}
        {geo.grades.map((g, i) => (
          <g key={`g${i}`}>
            <line class="ls-break" x1={g.x0} x2={g.x0} y1={pad.t} y2={H - pad.b} />
            <text class={maxGrade !== undefined && Math.abs(g.g) > maxGrade + 0.05 ? 'ls-grade bad' : 'ls-grade'} x={g.x} y={Math.max(pad.t + 2, g.y)} text-anchor="middle">
              {g.g >= 0 ? '+' : '−'}
              {num(Math.abs(g.g), 1)}%
            </text>
          </g>
        ))}
        {hv && (
          <g>
            <line class="ls-cross" x1={geo.x(hv.s)} x2={geo.x(hv.s)} y1={pad.t} y2={H - pad.b} />
            <circle class="ls-dot" cx={geo.x(hv.s)} cy={geo.y(hv.surface)} r="3" />
            <circle class="ls-dot-g" cx={geo.x(hv.s)} cy={geo.y(hv.ground)} r="2.5" />
          </g>
        )}
      </svg>
      <div class="ls-legend">
        {hv ? (
          <span class="num">
            km {chainage(hv.s)} · ground {num(hv.ground, 2)} m · design {num(hv.surface, 2)} m ·{' '}
            <b class={hv.surface < hv.ground ? 'c-cut' : 'c-fill'}>
              {hv.surface < hv.ground ? 'cut' : 'fill'} {num(Math.abs(hv.surface - hv.ground), 2)} m
            </b>
            {hv.water ? ' · water' : ''}
          </span>
        ) : (
          <>
            <span>
              <i class="sw sw-ground" /> existing ground
            </span>
            <span>
              <i class="sw sw-surface" /> design surface
            </span>
            <span>
              <i class="sw sw-cut" /> cut
            </span>
            <span>
              <i class="sw sw-fill" /> fill
            </span>
          </>
        )}
      </div>
    </div>
  );
}
