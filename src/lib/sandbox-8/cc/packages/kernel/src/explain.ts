/**
 * Explain traces: derived numbers that carry their own derivation.
 *
 * A planned duration is not "43 d" — it is
 *   43 d = 2180 m³ ÷ (95 m³/h × 0.83 job efficiency × 0.8 wet clay) ÷ 8 h/d
 * with every leaf pointing at its data-pack source. The UI renders these trees for
 * any number; models build them with the helpers below at almost no extra cost.
 *
 * Traces are plain JSON (they may live in component state and snapshots).
 */
import type { Param, Source } from './schema.ts';
import { convert } from './units.ts';

export type ExplainOp = 'leaf' | 'sum' | 'sub' | 'mul' | 'div' | 'min' | 'max' | 'convert' | 'note' | 'ceil' | 'round';

export interface Explained {
  /** numeric value */
  v: number;
  /** unit of v ('' = dimensionless) */
  u: string;
  /** short human label */
  label?: string;
  op: ExplainOp;
  args?: Explained[];
  source?: Source;
  note?: string;
}

const leaf = (v: number, u: string, label?: string, source?: Source, note?: string): Explained => {
  const e: Explained = { v, u, op: 'leaf' };
  if (label) e.label = label;
  if (source) e.source = source;
  if (note) e.note = note;
  return e;
};

const combine = (op: ExplainOp, v: number, u: string, label: string | undefined, args: Explained[]): Explained => {
  const e: Explained = { v, u, op, args };
  if (label) e.label = label;
  return e;
};

export const ex = {
  /** A plain constant with optional label/source. */
  value: (v: number, u = '', label?: string, source?: Source, note?: string) => leaf(v, u, label, source, note),
  /** A data-pack parameter (keeps its source). */
  param: (p: Param, label?: string) => leaf(p.value, p.unit, label, p.source, p.note),
  sum: (label: string | undefined, u: string, ...args: Explained[]) => combine('sum', args.reduce((a, b) => a + b.v, 0), u, label, args),
  sub: (label: string | undefined, u: string, a: Explained, b: Explained) => combine('sub', a.v - b.v, u, label, [a, b]),
  mul: (label: string | undefined, u: string, ...args: Explained[]) => combine('mul', args.reduce((a, b) => a * b.v, 1), u, label, args),
  div: (label: string | undefined, u: string, a: Explained, b: Explained) => combine('div', b.v === 0 ? Infinity : a.v / b.v, u, label, [a, b]),
  min: (label: string | undefined, u: string, ...args: Explained[]) => combine('min', Math.min(...args.map((a) => a.v)), u, label, args),
  max: (label: string | undefined, u: string, ...args: Explained[]) => combine('max', Math.max(...args.map((a) => a.v)), u, label, args),
  ceil: (label: string | undefined, a: Explained) => combine('ceil', Math.ceil(a.v - 1e-9), a.u, label, [a]),
  round: (label: string | undefined, a: Explained, digits = 0) => {
    const f = 10 ** digits;
    return combine('round', Math.round(a.v * f) / f, a.u, label, [a]);
  },
  convert: (a: Explained, to: string, label?: string) => combine('convert', convert(a.v, a.u || '1', to || '1'), to, label ?? a.label, [a]),
  /** Attach a label/note without changing the value. */
  note: (a: Explained, label: string, note?: string): Explained => {
    const e: Explained = { ...a, label };
    if (note) e.note = note;
    return e;
  },
};

/** Render a trace as indented text (debugging, CLI, tests). */
export function explainToText(e: Explained, indent = ''): string {
  const fmt = (n: number) => (Math.abs(n) >= 1000 || Number.isInteger(n) ? n.toFixed(0) : n.toPrecision(4));
  const head = `${indent}${e.label ?? e.op}: ${fmt(e.v)}${e.u ? ` ${e.u}` : ''}${e.op !== 'leaf' ? ` [${e.op}]` : ''}${e.source ? `  ← ${e.source.title}${e.source.year ? ` (${e.source.year})` : ''}` : ''}${e.note ? `  — ${e.note}` : ''}`;
  const kids = (e.args ?? []).map((a) => explainToText(a, `${indent}  `));
  return [head, ...kids].join('\n');
}
