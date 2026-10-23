/**
 * Provenance travels with derived values (decision 0022): a value computed from others is no more
 * certain than the least certain of them, and says what it rests on.
 */
import type { Provenance } from './types.ts';

const RANK: Record<Provenance['confidence'], number> = { low: 0, medium: 1, high: 2 };
const BY_RANK: Provenance['confidence'][] = ['low', 'medium', 'high'];

/** where the inputs of a derived value come from: their worst confidence, and every distinct source with its note */
export class ProvenanceTrail {
  private worst = 2;
  private readonly seen = new Map<string, Provenance>();

  add(p: Provenance): void {
    this.worst = Math.min(this.worst, RANK[p.confidence]);
    const key = `${p.kind}:${p.source}:${p.note ?? ''}`;
    if (!this.seen.has(key)) this.seen.set(key, p);
  }

  get size(): number {
    return this.seen.size;
  }

  /** the derived value's provenance: its own, capped at its inputs' confidence, noting what it rests on */
  derive(own: Provenance, what = 'inputs'): Provenance {
    if (!this.seen.size) return own;
    const from = [...this.seen.values()].map((p) => `${p.kind} ${p.source}${p.note ? ` (${p.note})` : ''}`);
    const shown = from.length > 4 ? [...from.slice(0, 4), `${from.length - 4} more`] : from;
    const note = `${what}: ${shown.join('; ')}`;
    return { ...own, confidence: BY_RANK[Math.min(RANK[own.confidence], this.worst)]!, note: own.note ? `${own.note}; ${note}` : note };
  }
}

/** a value derived from these: `own`, no more certain than they are */
export function derivedProvenance(own: Provenance, inputs: Provenance[], what?: string): Provenance {
  const t = new ProvenanceTrail();
  for (const p of inputs) t.add(p);
  return t.derive(own, what);
}
