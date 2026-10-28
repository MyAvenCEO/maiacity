/** Clickable reference to an entity: selects it and flies the camera there. */
import type { ComponentChildren } from 'preact';
import { frame, select, world } from '../state.ts';

export function entityLabel(id: string): string {
  const f = frame.value;
  if (f) {
    const m = f.machines.find((x) => x.id === id);
    if (m) return m.label;
    const p = f.people.find((x) => x.id === id);
    if (p) return p.name;
    const s = f.stores.find((x) => x.id === id);
    if (s) return s.label;
    const w = f.workfronts.find((x) => x.id === id);
    if (w) return w.label;
  }
  const r = world.value?.roads.find((x) => x.id === id);
  if (r) return r.label;
  return id;
}

export function EntityLink({ id, kind, children }: { id: string; kind?: string; children?: ComponentChildren }) {
  return (
    <a
      class="elink"
      href="#"
      title={`Select ${id} (and focus)`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        select(id, kind, { focus: true });
      }}
    >
      {children ?? entityLabel(id)}
    </a>
  );
}
