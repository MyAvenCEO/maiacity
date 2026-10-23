/**
 * Explain viewer: renders `Explained` traces (how a number was derived) as a collapsible tree.
 *   - <ExplainTree tree={…}/>  inline tree
 *   - <XNum tree={…}/>         a number with dotted underline; click opens the tree in a popover
 */
import type { Explained } from '../../../../../packages/kernel/src/index.ts';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { qty, smart, unitLabel } from '../format.ts';
import { explainPopover } from '../state.ts';
import { cx } from './common.tsx';

const OP_SYMBOL: Record<string, string> = { sum: '+', sub: '−', mul: '×', div: '÷', min: '·', max: '·', ceil: '', round: '', convert: '', note: '' };
const OP_HEAD: Record<string, string> = { sum: 'Σ', sub: '−', mul: '×', div: '÷', min: 'min', max: 'max', ceil: '⌈⌉', round: '≈', convert: '→', note: '', leaf: '' };

function value(e: Explained): string {
  const u = unitLabel(e.u);
  return u ? `${smart(e.v)} ${u}` : smart(e.v);
}

function Source({ e }: { e: Explained }) {
  if (!e.source) return null;
  const s = e.source;
  const tip = [s.title, s.publisher, s.year, s.note].filter(Boolean).join(' · ');
  const short = `${s.title.length > 28 ? `${s.title.slice(0, 26)}…` : s.title}${s.year ? ` ${s.year}` : ''}`;
  return s.url ? (
    <a class="x-src" href={s.url} target="_blank" rel="noreferrer" title={tip} onClick={(ev) => ev.stopPropagation()}>
      [{short}]
    </a>
  ) : (
    <span class="x-src" title={tip}>
      [{short}]
    </span>
  );
}

function Node({ e, depth, prefix, expandAll }: { e: Explained; depth: number; prefix: string; expandAll: number }) {
  const kids = e.args ?? [];
  const [open, setOpen] = useState(depth < 1 || (depth < 2 && kids.length <= 4));
  useEffect(() => {
    if (expandAll > 0) setOpen(true);
    if (expandAll < 0) setOpen(depth < 1);
  }, [expandAll]);
  const head = OP_HEAD[e.op] ?? '';
  const sym = OP_SYMBOL;
  return (
    <div class="x-node">
      <div class={cx('x-row', kids.length > 0 && 'x-has')} onClick={() => kids.length && setOpen(!open)}>
        <span class="x-pre">{prefix}</span>
        <span class="x-caret">{kids.length ? (open ? '▾' : '▸') : ''}</span>
        <span class="x-label">
          {e.label ?? (e.op === 'leaf' ? 'value' : e.op)}
          {head && kids.length > 0 && <span class="x-op">{head}</span>}
          <Source e={e} />
        </span>
        <span class="x-val num">{value(e)}</span>
      </div>
      {e.note && <div class="x-note">{e.note}</div>}
      {open && kids.length > 0 && (
        <div class="x-kids">
          {kids.map((k, i) => (
            <Node key={i} e={k} depth={depth + 1} prefix={i === 0 && e.op !== 'min' && e.op !== 'max' ? '' : (sym[e.op] ?? '')} expandAll={expandAll} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExplainTree({ tree, title }: { tree: Explained; title?: string }) {
  const [all, setAll] = useState(0);
  return (
    <div class="x-tree">
      <div class="x-tools">
        {title && <span class="sc x-title">{title}</span>}
        <button class="lnk" onClick={() => setAll(Math.abs(all) + 1)}>
          expand all
        </button>
        <button class="lnk" onClick={() => setAll(-(Math.abs(all) + 1))}>
          collapse
        </button>
      </div>
      <Node e={tree} depth={0} prefix="" expandAll={all} />
    </div>
  );
}

/** A number backed by an explain trace: dotted underline, click → popover with the tree. */
export function XNum({ tree, children, title }: { tree: Explained | undefined | null; children?: ComponentChildren; title?: string }) {
  if (!tree) return <span class="num">{children}</span>;
  return (
    <span
      class="xnum num"
      tabIndex={0}
      title="Click to see how this number is derived"
      onClick={(ev) => {
        ev.stopPropagation();
        const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
        const p: { tree: Explained; x: number; y: number; title?: string } = { tree, x: r.left, y: r.bottom + 4 };
        if (title) p.title = title;
        explainPopover.value = p;
      }}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') (ev.currentTarget as HTMLElement).click();
      }}
    >
      {children ?? qty(tree.v, tree.u)}
    </span>
  );
}

/** Global popover host (rendered once in App). */
export function ExplainPopoverHost() {
  const p = explainPopover.value;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p) return;
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) explainPopover.value = null;
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        explainPopover.value = null;
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [p]);
  if (!p) return null;
  const w = 460;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, p.x - 40));
  const maxH = Math.max(160, window.innerHeight - p.y - 12);
  const top = maxH < 240 ? Math.max(8, p.y - 320) : p.y;
  return (
    <div class="popover glass" ref={ref} style={{ left: `${left}px`, top: `${top}px`, width: `${w}px`, maxHeight: `${Math.max(240, maxH)}px` }}>
      <div class="popover-h">
        <span class="sc">{p.title ?? 'Derivation'}</span>
        <button class="icon-btn" onClick={() => (explainPopover.value = null)} title="Close (Esc)">
          ✕
        </button>
      </div>
      <ExplainTree tree={p.tree} />
    </div>
  );
}
