/** Blockers with remedy buttons (each remedy dispatches its command). */
import type { Remedy } from '../../../../../packages/kernel/src/index.ts';
import { useState } from 'preact/hooks';
import { relative } from '../format.ts';
import { command, frame } from '../state.ts';
import { Button, cx } from './common.tsx';

export interface BlockerLike {
  code: string;
  severity: string;
  message: string;
  since?: number;
  remedies?: Remedy[] | unknown[];
}

export function RemedyButtons({ remedies }: { remedies?: Remedy[] | unknown[] }) {
  const [busy, setBusy] = useState<number | null>(null);
  const list = (remedies ?? []) as Remedy[];
  if (!list.length) return null;
  return (
    <div class="remedies">
      {list.map((r, i) =>
        r.command ? (
          <Button
            key={i}
            small
            kind={i === 0 ? 'primary' : 'default'}
            disabled={busy !== null}
            tip={`${r.command.type}`}
            onClick={async (e: MouseEvent) => {
              e.stopPropagation();
              setBusy(i);
              await command(r.command!.type, r.command!.payload, `Done: ${r.label}`);
              setBusy(null);
            }}
          >
            {busy === i ? '…' : r.label}
          </Button>
        ) : (
          <span key={i} class="remedy-hint">
            → {r.label}
          </span>
        ),
      )}
    </div>
  );
}

export function BlockerList({ blockers, compact }: { blockers: BlockerLike[]; compact?: boolean }) {
  const now = frame.value?.t ?? 0;
  if (!blockers.length) return null;
  return (
    <ul class={cx('blockers', compact && 'blockers-compact')}>
      {blockers.map((b, i) => (
        <li key={`${b.code}${i}`} class={cx('blocker', `sev-${b.severity}`)}>
          <div class="blocker-msg">
            <span class="sev-ico" />
            <span>{b.message}</span>
            {b.since !== undefined && <span class="muted small"> · since {relative(b.since, now).replace(' ago', '')}</span>}
          </div>
          <RemedyButtons remedies={b.remedies} />
        </li>
      ))}
    </ul>
  );
}
