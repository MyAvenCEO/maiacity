/**
 * Rulebooks (decision 0013): standards and codes are practice — they check a design and advise,
 * with their sources. They never block; physical impossibility is not advice and stays with the
 * domain (a road off the map, a house in the creek). Any module contributes rules to the extension
 * point `rulebook` for the kinds of design it knows; the `rulebooks` port consults them all.
 */
import { defineModule, type ReadCtx, type Source } from '../../kernel/src/index.ts';

export type FindingSeverity = 'info' | 'advice' | 'warning';

export interface Finding {
  /** the rulebook (standard, code, practice guide) speaking */
  rulebook: string;
  code: string;
  severity: FindingSeverity;
  message: string;
  source?: Source;
}

/** what a rulebook is asked about: a design of some kind (a road, a building …) */
export interface RulebookSubject {
  kind: string;
  design: unknown;
}

export interface RulebookContribution {
  label: string;
  /** the kinds of design it checks */
  kinds: string[];
  check(subject: RulebookSubject): Finding[];
}

export interface RulebooksPort {
  /** every rulebook's findings on a design, warnings first */
  check(subject: RulebookSubject): Finding[];
  /** the rulebooks consulted for a kind of design */
  consulted(kind: string): string[];
}

const ORDER: Record<FindingSeverity, number> = { warning: 0, advice: 1, info: 2 };

const rulebooksPort = (read: ReadCtx): RulebooksPort => ({
  check(subject) {
    const out: Finding[] = [];
    for (const c of read.contributions('rulebook')) if (c.impl.kinds.includes(subject.kind)) out.push(...c.impl.check(subject));
    return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  },
  consulted: (kind) => read.contributions('rulebook').filter((c) => c.impl.kinds.includes(kind)).map((c) => c.impl.label),
});

export const rulebooksModule = defineModule({
  id: 'rulebooks',
  label: 'Rulebooks (advice from codes and standards)',
  provides: ['rulebooks'],
  ports: { rulebooks: rulebooksPort },
});

declare module '../../kernel/src/index.ts' {
  interface PortTypes {
    rulebooks: RulebooksPort;
  }
  interface ContributionTypes {
    rulebook: RulebookContribution;
  }
}
