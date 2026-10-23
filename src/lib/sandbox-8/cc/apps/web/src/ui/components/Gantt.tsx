/**
 * Gantt chart for a project's schedule rows: forecast bar (outline), progress fill, actual
 * start/finish, today line, planned project finish marker and blocked badges.
 */
import type { ScheduleRow } from '../../../../../packages/production/src/index.ts';
import { DAY, HOUR } from '../../../../../packages/kernel/src/index.ts';
import { useMemo, useState } from 'preact/hooks';
import { dateShort, dateTime, duration, num } from '../format.ts';
import { useWidth } from '../hooks.ts';
import { cx } from './common.tsx';

export function Gantt({
  rows,
  now,
  blocked,
  plannedFinish,
  compact,
  onRowClick,
  selected,
  activityColor,
  labelWidth = 230,
}: {
  rows: ScheduleRow[];
  now: number;
  blocked?: Set<string>;
  plannedFinish?: number;
  compact?: boolean;
  onRowClick?: (id: string) => void;
  selected?: string | null;
  activityColor?: (activity: string) => string | undefined;
  labelWidth?: number;
}) {
  const [box, width] = useWidth<HTMLDivElement>(600);
  const [tip, setTip] = useState<{ row: ScheduleRow; x: number; y: number } | null>(null);
  const rowH = compact ? 9 : 18;
  const lw = compact ? 0 : labelWidth;
  const axisH = compact ? 12 : 20;
  const geo = useMemo(() => {
    if (!rows.length) return null;
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const r of rows) {
      t0 = Math.min(t0, r.actualStart ?? r.start, r.start);
      t1 = Math.max(t1, r.actualFinish ?? r.finish, r.finish);
    }
    t0 = Math.min(t0, now);
    t1 = Math.max(t1, now, plannedFinish ?? -Infinity);
    const span = Math.max(HOUR * 8, t1 - t0);
    t0 -= span * 0.02;
    t1 += span * 0.04;
    const iw = Math.max(80, width - lw - 8);
    const x = (t: number) => lw + ((t - t0) / (t1 - t0)) * iw;
    // ticks: days or weeks
    const days = (t1 - t0) / DAY;
    const stepDays = days <= 10 ? 1 : days <= 30 ? 2 : days <= 70 ? 7 : days <= 200 ? 14 : 30;
    const ticks: number[] = [];
    for (let t = Math.ceil(t0 / DAY) * DAY; t <= t1; t += stepDays * DAY) ticks.push(t);
    return { x, ticks, t0, t1 };
  }, [rows, now, width, lw, plannedFinish]);

  if (!geo)
    return (
      <div class="gantt" ref={box}>
        <div class="empty">No schedule.</div>
      </div>
    );
  const H = axisH + rows.length * rowH + 4;
  return (
    <div class={cx('gantt', compact && 'gantt-compact')} ref={box}>
      <svg width={width} height={H} onMouseLeave={() => setTip(null)}>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line class="grid" x1={geo.x(t)} x2={geo.x(t)} y1={axisH - 2} y2={H} />
            {!compact && (
              <text class="axis" x={geo.x(t) + 2} y={12}>
                {dateShort(t)}
              </text>
            )}
          </g>
        ))}
        {rows.map((r, i) => {
          const y = axisH + i * rowH;
          const fs = r.start;
          const ff = r.finish;
          const as = r.actualStart;
          const af = r.actualFinish;
          const color = activityColor?.(r.activity) ?? '#7aa7d9';
          const isBlocked = blocked?.has(r.package);
          const bx0 = geo.x(Math.min(as ?? fs, fs));
          const bx1 = Math.max(bx0 + 2, geo.x(af ?? Math.max(ff, as ?? fs)));
          const bh = compact ? rowH - 3 : rowH - 7;
          const by = y + (rowH - bh) / 2;
          return (
            <g
              key={r.package}
              class={cx('g-row', onRowClick && 'clickable', selected === r.package && 'sel')}
              onClick={() => onRowClick?.(r.package)}
              onMouseMove={(ev) => setTip({ row: r, x: (ev as MouseEvent).offsetX, y: y + rowH })}
            >
              <rect class="g-hit" x={0} y={y} width={width} height={rowH} />
              {!compact && (
                <text class={cx('g-label', r.status === 'done' && 'muted')} x={4} y={y + rowH - 5}>
                  {isBlocked ? '● ' : ''}
                  {r.label.length > 34 ? `${r.label.slice(0, 33)}…` : r.label}
                </text>
              )}
              <rect class={cx('g-bar', `g-${r.status}`)} x={bx0} y={by} width={bx1 - bx0} height={bh} rx={2} style={{ stroke: color }} />
              <rect class="g-prog" x={bx0} y={by} width={(bx1 - bx0) * Math.max(0, Math.min(1, r.progress))} height={bh} rx={2} style={{ fill: color }} />
              {isBlocked && <rect class="g-blocked" x={bx0 - 4} y={by} width={3} height={bh} />}
            </g>
          );
        })}
        <line class="g-now" x1={geo.x(now)} x2={geo.x(now)} y1={0} y2={H} />
        {!compact && (
          <text class="g-now-l" x={geo.x(now) + 3} y={axisH - 6}>
            now
          </text>
        )}
        {plannedFinish !== undefined && Number.isFinite(plannedFinish) && (
          <g>
            <line class="g-plan" x1={geo.x(plannedFinish)} x2={geo.x(plannedFinish)} y1={axisH - 4} y2={H} />
            {!compact && (
              <text class="g-plan-l" x={geo.x(plannedFinish) - 3} y={H - 4} text-anchor="end">
                planned finish
              </text>
            )}
          </g>
        )}
      </svg>
      {tip && !compact && (
        <div class="g-tip glass" style={{ left: `${Math.min(width - 260, tip.x + 12)}px`, top: `${tip.y + 4}px` }}>
          <div class="g-tip-t">{tip.row.label}</div>
          <div class="num">
            {num(tip.row.progress * 100, 0)} % · {tip.row.status}
          </div>
          <div class="num muted">
            {tip.row.actualStart !== undefined ? `started ${dateTime(tip.row.actualStart)}` : `start ${dateTime(tip.row.start)}`}
          </div>
          <div class="num muted">
            {tip.row.actualFinish !== undefined ? `finished ${dateTime(tip.row.actualFinish)}` : `forecast finish ${dateTime(tip.row.finish)} (${duration(tip.row.finish - (tip.row.actualStart ?? tip.row.start))})`}
          </div>
          {blocked?.has(tip.row.package) && <div class="c-bad">blocked</div>}
        </div>
      )}
    </div>
  );
}
