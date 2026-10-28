/**
 * Rings draped on the terrain (work fronts, selection, snaps, cursor). The geometry buffer is
 * preallocated and rewritten in place, so moving a ring allocates nothing.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicMaterial } from 'three';
import type { Heightfield } from './heightfield.ts';

const SEG = 56;

export class DrapedRing {
  readonly mesh: Mesh;
  readonly mat: MeshBasicMaterial;
  private pos: Float32Array;
  private last = { x: NaN, z: NaN, r: NaN, w: NaN };

  constructor(color: string | Color, opacity = 0.9, lift = 0.25) {
    this.lift = lift;
    this.pos = new Float32Array((SEG + 1) * 2 * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    const idx: number[] = [];
    for (let i = 0; i < SEG; i += 1) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    g.setIndex(idx);
    this.mat = new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false });
    this.mat.side = 2;
    this.mesh = new Mesh(g, this.mat);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  private lift: number;

  set(hf: Heightfield, x: number, z: number, radius: number, width: number): void {
    const l = this.last;
    if (l.x === x && l.z === z && l.r === radius && l.w === width) return;
    l.x = x;
    l.z = z;
    l.r = radius;
    l.w = width;
    const p = this.pos;
    for (let i = 0; i <= SEG; i += 1) {
      const a = (i / SEG) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r0 = radius - width / 2;
      const r1 = radius + width / 2;
      const x0 = x + c * r0;
      const z0 = z + s * r0;
      const x1 = x + c * r1;
      const z1 = z + s * r1;
      const k = i * 6;
      p[k] = x0;
      p[k + 1] = hf.y(x0, z0) + this.lift;
      p[k + 2] = z0;
      p[k + 3] = x1;
      p[k + 4] = hf.y(x1, z1) + this.lift;
      p[k + 5] = z1;
    }
    const attr = this.mesh.geometry.getAttribute('position') as BufferAttribute;
    attr.needsUpdate = true;
  }

  /** force re-drape (terrain changed) */
  invalidate(): void {
    this.last.x = NaN;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
