import { equipmentLabelHeight } from '../../render/item-assets.ts';
/**
 * HTML layer over the 3D view, positioned every animation frame with scene.project():
 *   - work-front labels (activity + progress, blocked badge)
 *   - machine names when zoomed in
 *   - draggable road control-point handles (road tool)
 * DOM is updated imperatively (no re-render per animation frame).
 */
import { useEffect, useRef } from 'preact/hooks';
import { app, frame, options, scoutOpen, scoutPlaces, select, tool, world } from '../state.ts';
import { dragIndex, draftPoints } from '../tools/road.ts';
import { heightAt } from '../tools/geometry.ts';

interface Item {
  key: string;
  x: number;
  z: number;
  lift: number;
  html: string;
  cls: string;
  onClick?: () => void;
  /** min pixels per metre for visibility (zoom gate) */
  minPpm?: number;
  priority: number;
  /** approximate width in px (overlap culling) */
  w: number;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function activityLabel(id: string): string {
  const l = world.peek()?.activities?.find((a) => a.id === id)?.label ?? id;
  return l.replace(/\s*\(.*\)\s*/g, ' ').replace(/,.*$/, '').trim();
}

function collect(): Item[] {
  const f = frame.peek();
  const items: Item[] = [];
  // the Scout panel's best places
  if (scoutOpen.peek()) {
    scoutPlaces.peek().forEach((p, n) => {
      items.push({ key: `scout:${n}`, x: p.at[0], z: p.at[1], lift: 3, cls: 'wl wl-scout', html: `<b>#${n + 1}</b> <span class="num">${Math.round(p.score * 100)} %</span>`, onClick: () => app.scene.focus(p.at[0], p.at[1], { distance: 260 }), priority: 5, w: 64 });
    });
  }
  // the graves of those who died here: always shown, whatever the labels setting
  for (const d of f?.deaths ?? []) {
    if (d.x === undefined || d.z === undefined) continue;
    items.push({ key: `grave:${d.id}`, x: d.x, z: d.z, lift: 1.2, cls: 'wl wl-grave', html: `<b>†</b> ${esc(d.name)}`, onClick: () => select(d.id, undefined, { focus: true }), priority: 10, w: 110 });
  }
  if (!f || !options.peek().worldLabels) return items;
  for (const w of f.workfronts) {
    if (w.status !== 'active' && !w.blocked) continue;
    const pct = Math.round(w.progress * 100);
    const badge = w.blocked ? `<span class="wl-blk" title="${esc(w.blocker ?? 'blocked')}">BLOCKED</span>` : w.rate > 0 ? '<span class="wl-on"></span>' : '<span class="wl-idle"></span>';
    items.push({
      key: `w:${w.id}`,
      x: w.x,
      z: w.z,
      lift: 6,
      cls: `wl wl-front${w.blocked ? ' blocked' : ''}`,
      html: `${badge}<b>${esc(activityLabel(w.activity))}</b> <span class="num">${pct}%</span>${w.blocked && w.blocker ? `<div class="wl-why">${esc(w.blocker.length > 56 ? `${w.blocker.slice(0, 54)}…` : w.blocker)}</div>` : ''}`,
      onClick: () => select(w.id, 'workPackage'),
      priority: w.blocked ? 3 : 2,
      w: Math.min(280, 40 + activityLabel(w.activity).length * 6.5),
    });
  }
  for (const m of f.machines) {
    const name = m.label.replace(/\s*\(.*$/, '').trim();
    items.push({ key: `m:${m.id}`, x: m.x, z: m.z, lift: equipmentLabelHeight(m.model, m.cls), cls: 'wl wl-machine', html: esc(name), onClick: () => select(m.id, 'machine'), minPpm: 5, priority: 1, w: 12 + name.length * 5.6 });
  }
  return items;
}

export function WorldLayer() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const els = new Map<string, HTMLDivElement>();
    const handles: HTMLDivElement[] = [];
    let raf = 0;
    let lastHtml = new Map<string, string>();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const scene = app.scene;
      const host = root.current;
      if (!scene || !host) return;
      const w = world.peek();
      const W = host.clientWidth;
      const H = host.clientHeight;
      // ---- labels
      const seen = new Set<string>();
      const items = collect();
      const placed: { x: number; y: number; it: Item }[] = [];
      for (const it of items) {
        const y = heightAt(w, it.x, it.z) + it.lift;
        const p = scene.project(it.x, it.z, y);
        if (!p || p.x < it.w / 2 || p.y < 20 || p.x > W - it.w / 2 || p.y > H) continue;
        if (it.minPpm) {
          const q = scene.project(it.x + 5, it.z, y);
          if (!q || Math.hypot(q.x - p.x, q.y - p.y) / 5 < it.minPpm) continue;
        }
        placed.push({ x: p.x, y: p.y, it });
      }
      // keep it readable: few labels, highest priority first, drop overlaps
      placed.sort((a, b) => b.it.priority - a.it.priority);
      const kept: typeof placed = [];
      for (const p of placed) {
        if (kept.length >= 14) break;
        if (kept.some((k) => Math.abs(k.x - p.x) < (k.it.w + p.it.w) / 2 + 4 && Math.abs(k.y - p.y) < 20)) continue;
        kept.push(p);
      }
      const nextHtml = new Map<string, string>();
      for (const { x, y, it } of kept) {
        seen.add(it.key);
        let el = els.get(it.key);
        if (!el) {
          el = document.createElement('div');
          el.className = it.cls;
          if (it.onClick) {
            const cb = it.onClick;
            el.addEventListener('click', (e) => {
              e.stopPropagation();
              cb();
            });
          }
          host.appendChild(el);
          els.set(it.key, el);
        }
        if (lastHtml.get(it.key) !== it.html) el.innerHTML = it.html;
        if (el.className !== it.cls) el.className = it.cls;
        nextHtml.set(it.key, it.html);
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      }
      lastHtml = nextHtml;
      for (const [k, el] of els) {
        if (!seen.has(k)) {
          el.remove();
          els.delete(k);
        }
      }
      // ---- road handles
      const pts = tool.peek() === 'road' ? draftPoints.peek() : [];
      while (handles.length < pts.length) {
        const i = handles.length;
        const h = document.createElement('div');
        h.className = 'rh';
        h.title = 'Drag to move · right-click the map to remove the last point';
        h.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          dragIndex.value = i;
        });
        host.appendChild(h);
        handles.push(h);
      }
      while (handles.length > pts.length) handles.pop()!.remove();
      const di = dragIndex.peek();
      pts.forEach((pt, i) => {
        const h = handles[i]!;
        const p = scene.project(pt[0], pt[1], heightAt(w, pt[0], pt[1]) + 0.3);
        if (!p) {
          h.style.display = 'none';
          return;
        }
        h.style.display = '';
        h.className = `rh${i === 0 ? ' first' : ''}${i === pts.length - 1 ? ' last' : ''}${di === i ? ' drag' : ''}`;
        h.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
        h.textContent = String(i + 1);
      });
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      els.forEach((el) => el.remove());
      handles.forEach((h) => h.remove());
    };
  }, []);
  return <div class="world-layer" ref={root} />;
}
