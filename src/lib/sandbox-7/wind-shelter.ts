import type RAPIER from '@dimforge/rapier3d-compat';
import type { V3 } from './simulation';

export type WindBlocker = { collider: RAPIER.Collider; center: V3; radius: number; min: V3; max: V3 };
type Node = { min: V3; max: V3; children?: [Node, Node]; blockers?: WindBlocker[] };
const axes = ['x', 'y', 'z'] as const;

function build(blockers: WindBlocker[]): Node {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const b of blockers) for (const axis of axes) {
    min[axis] = Math.min(min[axis], b.min[axis]); max[axis] = Math.max(max[axis], b.max[axis]);
  }
  if (blockers.length <= 4) return { min, max, blockers };
  const axis = axes.reduce((best, a) => max[a] - min[a] > max[best] - min[best] ? a : best);
  blockers.sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
  const middle = Math.floor(blockers.length / 2);
  return { min, max, children: [build(blockers.slice(0, middle)), build(blockers.slice(middle))] };
}

function intersects(node: Node | WindBlocker, ray: RAPIER.Ray): boolean {
  let near = 0, far = 100;
  for (const axis of axes) {
    const origin = ray.origin[axis], direction = ray.dir[axis];
    if (direction === 0) {
      if (origin < node.min[axis] || origin > node.max[axis]) return false;
    } else {
      const a = (node.min[axis] - origin) / direction, b = (node.max[axis] - origin) / direction;
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      if (near > far) return false;
    }
  }
  return true;
}

/** Rebuilt from current poses each measurement, including newly placed bodies.
 * Bounds only cull candidates; Rapier still performs every actual hit test. */
export class WindShelter {
  private readonly root: Node;
  private readonly byCollider: Map<RAPIER.Collider, WindBlocker>;
  constructor(blockers: WindBlocker[]) {
    this.byCollider = new Map(blockers.map(b => [b.collider, b]));
    this.root = build(blockers);
  }
  blocker(ray: RAPIER.Ray, source: RAPIER.Collider, previous?: RAPIER.Collider): RAPIER.Collider | undefined {
    const hit = (b: WindBlocker): boolean => {
      if (b.collider === source) return false;
      const x = b.center.x - ray.origin.x, y = b.center.y - ray.origin.y, z = b.center.z - ray.origin.z;
      const along = x * ray.dir.x + y * ray.dir.y + z * ray.dir.z;
      if (along + b.radius < 0 || along - b.radius > 100 || x*x + y*y + z*z - along*along > b.radius*b.radius) return false;
      return b.collider.castRay(ray, 100, true) >= 0;
    };
    // A hint only: re-test the old blocker against today's ray and collider.
    // Movement, destruction and wind-direction changes never reuse a hit result.
    const hint = previous && this.byCollider.get(previous);
    if (hint && hit(hint)) return hint.collider;
    const visit = (node: Node): RAPIER.Collider | undefined => {
      if (!intersects(node, ray)) return;
      if (node.children) return visit(node.children[0]) ?? visit(node.children[1]);
      return node.blockers!.find(b => b !== hint && hit(b))?.collider;
    };
    return visit(this.root);
  }
}
