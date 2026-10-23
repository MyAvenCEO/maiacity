/** Sortable, filterable data table. Rows click → onRowClick (select + focus). */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { cx } from './common.tsx';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ComponentChildren;
  /** sort key; omit to make the column unsortable */
  sort?: (row: T) => number | string;
  /** text used by the filter box (defaults to the sort key) */
  text?: (row: T) => string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  tip?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selected,
  filterPlaceholder = 'Filter…',
  initialSort,
  toolbar,
  empty = 'Nothing here yet.',
  rowClass,
  compact,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  selected?: string | null;
  filterPlaceholder?: string | null;
  initialSort?: { key: string; dir: 1 | -1 };
  toolbar?: ComponentChildren;
  empty?: ComponentChildren;
  rowClass?: (r: T) => string | undefined;
  compact?: boolean;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [filter, setFilter] = useState('');
  const view = useMemo(() => {
    let out = rows;
    const f = filter.trim().toLowerCase();
    if (f) {
      out = out.filter((r) =>
        columns.some((c) => {
          const t = c.text ? c.text(r) : c.sort ? String(c.sort(r)) : '';
          return t.toLowerCase().includes(f);
        }),
      );
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sort) {
        const key = col.sort;
        out = [...out].sort((a, b) => {
          const x = key(a);
          const y = key(b);
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
        });
      }
    }
    return out;
  }, [rows, columns, sort, filter]);

  return (
    <div class={cx('tbl-wrap', compact && 'tbl-compact')}>
      {(filterPlaceholder !== null || toolbar) && (
        <div class="tbl-bar">
          {filterPlaceholder !== null && (
            <input
              class="inp inp-filter"
              placeholder={filterPlaceholder}
              value={filter}
              onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFilter('');
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
            />
          )}
          <span class="tbl-count">
            {view.length}
            {view.length !== rows.length ? ` / ${rows.length}` : ''} rows
          </span>
          <span class="tbl-tools">{toolbar}</span>
        </div>
      )}
      <div class="tbl-scroll">
        <table class="tbl">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  class={cx(c.sort && 'sortable', c.align && `al-${c.align}`)}
                  style={c.width ? { width: c.width } : undefined}
                  title={c.tip}
                  onClick={() => {
                    if (!c.sort) return;
                    setSort(sort?.key === c.key ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 });
                  }}
                >
                  {c.label}
                  {sort?.key === c.key && <span class="sort-ind">{sort.dir === 1 ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const k = rowKey(r);
              return (
                <tr key={k} class={cx(onRowClick && 'clickable', selected === k && 'sel', rowClass?.(r))} onClick={() => onRowClick?.(r)}>
                  {columns.map((c) => (
                    <td key={c.key} class={cx(c.align && `al-${c.align}`, 'num')}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {view.length === 0 && <div class="empty">{empty}</div>}
      </div>
    </div>
  );
}
