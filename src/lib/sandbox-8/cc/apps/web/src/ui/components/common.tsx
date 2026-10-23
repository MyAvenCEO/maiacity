/** Small presentational building blocks shared by all panels. */
import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { titleCase } from '../format.ts';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

export function Kbd({ k }: { k: string }) {
  return <kbd class="kbd">{k}</kbd>;
}

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'kind'> & {
  kind?: 'primary' | 'danger' | 'ghost' | 'default';
  small?: boolean;
  hotkey?: string;
  tip?: string;
  disabled?: boolean;
};
export function Button({ kind = 'default', small, hotkey, tip, children, class: klass, ...rest }: BtnProps) {
  return (
    <button type="button" class={cx('btn', `btn-${kind}`, small && 'btn-sm', klass as string)} data-tip={tip} {...rest}>
      {children}
      {hotkey && <Kbd k={hotkey} />}
    </button>
  );
}

/** Collapsible section with small-caps heading. */
export function Section({ title, right, children, open: initial = true, id }: { title: ComponentChildren; right?: ComponentChildren; children: ComponentChildren; open?: boolean; id?: string }) {
  const [open, setOpen] = useState(initial);
  return (
    <section class={cx('sec', !open && 'sec-closed')} id={id}>
      <header class="sec-h" onClick={() => setOpen(!open)}>
        <span class="caret">{open ? '▾' : '▸'}</span>
        <span class="sc">{title}</span>
        <span class="sec-right" onClick={(e) => e.stopPropagation()}>
          {right}
        </span>
      </header>
      {open && <div class="sec-b">{children}</div>}
    </section>
  );
}

/** Label/value pair in a key-figure grid. */
export function Stat({ label, value, sub, tone, tip }: { label: string; value: ComponentChildren; sub?: ComponentChildren; tone?: Tone; tip?: string }) {
  return (
    <div class={cx('stat', tone && `tone-${tone}`)} data-tip={tip}>
      <div class="stat-l sc">{label}</div>
      <div class="stat-v num">{value}</div>
      {sub !== undefined && <div class="stat-s">{sub}</div>}
    </div>
  );
}

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'muted' | 'serious';

const STATUS_TONE: Record<string, Tone> = {
  active: 'good',
  working: 'good',
  ready: 'info',
  available: 'good',
  open: 'good',
  complete: 'muted',
  done: 'muted',
  waiting: 'muted',
  idle: 'warn',
  hold: 'info',
  paused: 'warn',
  construction: 'info',
  building: 'info',
  standing: 'muted',
  collapsed: 'bad',
  struck: 'muted',
  travelling: 'info',
  arriving: 'info',
  recruiting: 'info',
  servicing: 'warn',
  sick: 'warn',
  vacation: 'muted',
  off: 'muted',
  absent: 'muted',
  broken: 'bad',
  blocked: 'bad',
  cancelled: 'muted',
  closed: 'muted',
  block: 'bad',
  warn: 'warn',
  info: 'info',
};

export function toneOf(status: string | undefined): Tone {
  return (status && STATUS_TONE[status]) || 'muted';
}

export function Pill({ status, label, tone }: { status?: string; label?: ComponentChildren; tone?: Tone }) {
  const t = tone ?? toneOf(status);
  return (
    <span class={cx('pill', `tone-${t}`)}>
      <i class="dot" />
      {label ?? titleCase(status ?? '')}
    </span>
  );
}

export function Progress({ value, tone = 'info', label, thin }: { value: number; tone?: Tone; label?: string; thin?: boolean }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div class={cx('prog', thin && 'prog-thin')} title={label ?? `${(v * 100).toFixed(0)} %`}>
      <div class={cx('prog-f', `bg-${tone}`)} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <div class="empty">{children}</div>;
}

/** Minimal line icons (24×24, stroke = currentColor). */
const ICONS: Record<string, string> = {
  select: 'M5 3l13 8-6 1.5L9.5 19z',
  road: 'M8 3L4 21M16 3l4 18M12 4v3M12 10v3M12 16v4',
  inspect: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L21 21M8 10.5h5M10.5 8v5',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  scout: 'M6 21V4h11l-2.5 4 2.5 4H6',
  building: 'M4 21V10l8-6 8 6v11M4 21h16M9 21v-6h6v6M8 12h2M14 12h2',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  skip: 'M5 4l9 8-9 8zM15 4h3v16h-3z',
  day: 'M4 12h12M12 6l6 6-6 6M20 5v14',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  focus: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M12 9v6M9 12h6',
  help: 'M9 9a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1.2-1.5 2.4M12 17.5v.5M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19z',
  save: 'M5 3h11l3 3v15H5zM8 3v5h8V3M8 21v-7h8v7',
  load: 'M4 20h16M12 4v12M7 11l5 5 5-5',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  // weather
  clear: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  fair: 'M8 5a4 4 0 0 0-3.9 4.9M8 1v2M2 8H1M3.8 3.8l1 1M12.5 4.8l-1 1M7 19h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 19z',
  overcast: 'M6 19h12a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.6A3.8 3.8 0 0 0 6 19z',
  rain: 'M6 14h12a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 6 14zM8 17l-1 3M12 17l-1 3M16 17l-1 3',
  heavyRain: 'M6 12h12a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 6 12zM7 15l-1.5 5M11 15l-1.5 5M15 15l-1.5 5M19 15l-1.5 5',
  snow: 'M6 13h12a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 6 13zM8 17h.01M12 19h.01M16 17h.01M10 21h.01M14 21h.01',
  wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
};

export function Icon({ name, size = 16, title }: { name: string; size?: number; title?: string }) {
  const d = ICONS[name] ?? ICONS.help!;
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden={title ? undefined : 'true'}>
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}

/** Two-column key/value list. */
export function KV({ rows }: { rows: [ComponentChildren, ComponentChildren][] }) {
  return (
    <dl class="kv">
      {rows.map(([k, v], i) => (
        <>
          <dt key={`k${i}`}>{k}</dt>
          <dd key={`v${i}`} class="num">
            {v}
          </dd>
        </>
      ))}
    </dl>
  );
}

/** Two-step button for destructive actions: first click arms, second click (within 4 s) runs. */
export function ConfirmButton({ children, onConfirm, kind = 'danger', small = true, tip, disabled }: { children: ComponentChildren; onConfirm: () => void; kind?: 'danger' | 'default'; small?: boolean; tip?: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      kind={armed ? 'danger' : kind === 'danger' ? 'ghost' : 'default'}
      small={small}
      tip={tip}
      disabled={disabled}
      class={armed ? 'armed' : undefined}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          setTimeout(() => setArmed(false), 4000);
        }
      }}
    >
      {armed ? 'Click again to confirm' : children}
    </Button>
  );
}
