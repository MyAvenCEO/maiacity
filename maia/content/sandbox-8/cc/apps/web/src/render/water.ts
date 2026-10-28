/**
 * Creeks (ribbons with soft banks) and ponds (polygons) at their water levels.
 */
import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, ShapeUtils, Vector2, type Texture } from 'three';
import type { WaterBody } from '../../../../packages/terrain/src/index.ts';
import { PALETTE } from './colors.ts';
import type { Heightfield } from './heightfield.ts';
import { GeoBuilder, Path } from './ribbon.ts';

export class WaterLayer {
  readonly group = new Group();
  private mat: MeshStandardMaterial;

  constructor() {
    this.mat = new MeshStandardMaterial({
      color: new Color(PALETTE.water),
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.88,
      vertexColors: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      envMapIntensity: 0.9,
    });
    this.group.name = 'water';
  }

  setEnvMap(tex: Texture | null): void {
    this.mat.envMap = tex;
    this.mat.needsUpdate = true;
  }

  set(water: WaterBody[], hf: Heightfield): void {
    this.clear();
    const base = hf.baseY;
    for (const w of water) {
      if (w.points.length < 2) continue;
      if (w.kind === 'creek') {
        const widths = w.widths ?? w.points.map(() => 2);
        const path = Path.from(w.points, 2, [widths, w.levels]);
        const b = new GeoBuilder();
        b.withColor = true;
        const W = path.extra[0]!;
        const L = path.extra[1]!;
        // 4 lanes across: outer bank fade, inner water
        const yAt = (i: number) => L[i]! - base + 0.03;
        const deep: [number, number, number, number] = [0.55, 0.62, 0.66, 0.95];
        const edge: [number, number, number, number] = [1, 1, 1, 0];
        const lanes: [number, number][] = [
          [-0.62, -0.42],
          [-0.42, 0.42],
          [0.42, 0.62],
        ];
        for (const [a, c] of lanes) {
          b.strip(
            path,
            (i) => W[i]! * a,
            (i) => W[i]! * c,
            (i) => yAt(i),
            4,
            (_i, f) => {
              const t = a < -0.5 ? f : c > 0.5 ? 1 - f : 1;
              return [edge[0] + (deep[0] - edge[0]) * t, edge[1] + (deep[1] - edge[1]) * t, edge[2] + (deep[2] - edge[2]) * t, t * 0.95];
            },
          );
        }
        const g = b.build();
        if (g) this.add(g);
      } else {
        const level = (w.levels[0] ?? hf.elevation(w.points[0]![0], w.points[0]![1])) - base + 0.03;
        const contour = w.points.map((p) => new Vector2(p[0], p[1]));
        if (contour.length > 2 && contour[0]!.distanceTo(contour[contour.length - 1]!) < 1e-6) contour.pop();
        const tris = ShapeUtils.triangulateShape(contour, []);
        const pos: number[] = [];
        const col: number[] = [];
        // centroid-weighted depth tint
        let cx = 0;
        let cz = 0;
        for (const p of contour) {
          cx += p.x;
          cz += p.y;
        }
        cx /= contour.length;
        cz /= contour.length;
        // expand slightly so the shore meets the terrain cleanly
        for (const p of contour) {
          const dx = p.x - cx;
          const dz = p.y - cz;
          const l = Math.hypot(dx, dz) || 1;
          pos.push(p.x + (dx / l) * 1.5, level, p.y + (dz / l) * 1.5);
          col.push(0.75, 0.8, 0.82, 0.9);
        }
        const idx: number[] = [];
        for (const t of tris) idx.push(t[0]!, t[2]!, t[1]!);
        const g = new BufferGeometry();
        g.setAttribute('position', new Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new Float32BufferAttribute(col, 4));
        g.setIndex(idx);
        g.computeVertexNormals();
        // ensure normals point up
        const n = g.getAttribute('normal');
        for (let i = 0; i < n.count; i += 1) n.setXYZ(i, 0, 1, 0);
        g.computeBoundingSphere();
        this.add(g);
      }
    }
  }

  private add(g: BufferGeometry): void {
    const m = new Mesh(g, this.mat);
    m.receiveShadow = true;
    m.renderOrder = 1;
    this.group.add(m);
  }

  clear(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as Mesh).geometry.dispose();
    }
  }

  dispose(): void {
    this.clear();
    this.mat.dispose();
  }
}
