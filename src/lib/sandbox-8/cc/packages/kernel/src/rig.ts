/**
 * A rig: a world of only the modules under test and fakes for the ports they require (design/modular-split.md §7.2).
 * Audited like every test world: undeclared foreign reads are refused and every module's audit runs.
 */
import type { CalendarDate, Locale } from './time.ts';
import type { EntityId, ModuleDef } from './types.ts';
import { Runtime } from './runtime.ts';

export interface RigOptions {
  /** fake modules standing in for the ports the modules under test require (each passes its port's conformance suite) */
  fakes?: ModuleDef[];
  /** data-pack catalogs, as a world definition would bind them */
  data?: Record<string, unknown>;
  seed?: number;
  epoch?: CalendarDate;
  /** how dates are written (none: the neutral ISO 8601) */
  locale?: Locale;
  actor?: EntityId;
}

export function rig(modules: ModuleDef[], opts: RigOptions = {}): Runtime {
  return Runtime.create({
    modules: [...modules, ...(opts.fakes ?? [])],
    data: opts.data ?? {},
    seed: opts.seed ?? 1,
    epoch: opts.epoch ?? { year: 2027, month: 4, day: 5 },
    strict: true,
    trusted: true,
    ...(opts.locale ? { locale: opts.locale } : {}),
    ...(opts.actor ? { actor: opts.actor } : {}),
  });
}
