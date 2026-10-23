/**
 * What every detection model must hold (decision 0015): a use is noticed no earlier than now, later
 * the later the draw, and no later for being more visible; with its provenance.
 */
import { check, DAY, Runtime, type ConformanceSuite } from '../../kernel/src/index.ts';
import type { UseView } from './contract.ts';

export interface DetectionSubject {
  world: () => Runtime;
}

const use = (visibility: number): UseView => ({ subject: 'x', party: 'p', label: 'a camp', pos: [0, 0], area: 12, people: 1, visibility });

export const detectionConformance: ConformanceSuite<DetectionSubject> = {
  contract: 'detection',
  cases: [
    {
      name: 'noticed no earlier than now, with its provenance',
      run(subject) {
        const rt = subject.world();
        for (const u of [0, 0.3, 0.9, 0.999]) {
          const r = rt.read.port('detection').noticedAt(use(1), 10 * DAY, u);
          check(Number.isFinite(r.at) && r.at >= 10 * DAY, `u ${u}: noticed at ${r.at}`);
          check(Boolean(r.provenance.source), 'no provenance');
        }
      },
    },
    {
      name: 'a later draw is no sooner; a more visible use no later',
      run(subject) {
        const det = subject.world().read.port('detection');
        let last = 0;
        for (const u of [0.1, 0.4, 0.7, 0.95]) {
          const at = det.noticedAt(use(1), 0, u).at;
          check(at >= last, `u ${u}: ${at} before ${last}`);
          last = at;
        }
        for (const u of [0.2, 0.6, 0.9]) check(det.noticedAt(use(4), 0, u).at <= det.noticedAt(use(0.25), 0, u).at, `u ${u}: the more visible is noticed later`);
      },
    },
  ],
};
