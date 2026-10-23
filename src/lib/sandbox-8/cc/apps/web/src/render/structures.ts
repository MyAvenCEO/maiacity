/**
 * Structures that are not buildings, each drawn as the thing it is: a dome tent (its fly over two crossed poles, the
 * porch, guy lines and pegs), a frame tent (an aluminium frame under PVC sheets), a lean-to of poles and brash, a tarp
 * strung over a rain barrel, a hut of notched logs, a dry-stacked brick wall, and what setting up a caravan adds to it.
 * Local axes: x along the length, z across, y up from the ground at the centre; `p` is how far it is put up (0..1).
 */
import { BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, SphereGeometry } from 'three';
import { F, Kit, poly } from './models.ts';

export interface StructureDims {
  type: string;
  form?: string;
  length: number;
  width: number;
  height: number;
  on?: string;
}

type V3 = [number, number, number];
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const PEG = F('#b9bcc0', 'metal');
const LINE = F('#d9d4c4', 'fabric');

/** what this draws (else the building path draws it) */
export function drawsStructure(b: StructureDims): boolean {
  return ['tent2', 'kitchenTent', 'leanTo', 'rainCatcher', 'logHut', 'dryWall', 'caravan', 'siteTrailer'].includes(b.type) || b.form === 'tent' || b.form === 'wall';
}

export function drawStructure(b: StructureDims, p: number, k: Kit, glass: Kit, ground: (lx: number, lz: number) => number = () => 0): void {
  const t = b.type;
  if (t === 'kitchenTent' || (b.form === 'tent' && t !== 'tent2' && t !== 'leanTo' && t !== 'rainCatcher' && b.height > 2.2)) return frameTent(b, p, k, glass);
  if (t === 'leanTo') return leanTo(b, p, k, ground);
  if (t === 'rainCatcher') return rainCatcher(b, p, k);
  if (t === 'logHut') return logHut(b, p, k, glass);
  if (t === 'dryWall' || b.form === 'wall') return dryWall(b, p, k, ground);
  if (t === 'caravan' || t === 'siteTrailer') return setUp(b, p, k);
  return domeTent(b, p, k);
}

/** a sheet through a grid of points (rows of columns), both faces */
function sheet(rows: V3[][]): BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i + 1 < rows.length; i += 1) {
    for (let j = 0; j + 1 < rows[i]!.length; j += 1) {
      const a = rows[i]![j]!;
      const b = rows[i]![j + 1]!;
      const c = rows[i + 1]![j + 1]!;
      const d = rows[i + 1]![j]!;
      pos.push(...a, ...b, ...c, ...a, ...c, ...d, ...a, ...c, ...b, ...a, ...d, ...c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function pegsAndLines(k: Kit, from: V3[], to: V3[]): void {
  for (let i = 0; i < from.length; i += 1) {
    const a = from[i]!;
    const b = to[i]!;
    k.tube(a, b, 0.004, LINE, 3);
    k.tube([b[0], 0.05, b[2]], [b[0], -0.1, b[2]], 0.006, PEG, 4).box(0.05, 0.012, 0.012, b[0], 0.055, b[2], PEG);
  }
}

/** a two-person dome tent: the fly over two crossed poles, its porch at one end, pulled out by guy lines */
function domeTent(b: StructureDims, p: number, k: Kit): void {
  const L = b.length;
  const W = b.width;
  const H = b.height;
  const a = L / 2;
  const c = W / 2;
  if (p <= 0) {
    // laid out to be pitched: the pack, its pegs where the corners will be
    k.lathe([[0, 0], [0.09, 0.02], [0.09, 0.5], [0, 0.52]], 0, 0.09, 0, F('#3d5a3a', 'nylon'), 10);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) k.tube([(sx * a) / 1.4, 0.15, (sz * c) / 1.4], [(sx * a) / 1.4, -0.08, (sz * c) / 1.4], 0.006, PEG, 4);
    return;
  }
  const h = H * p;
  const FLY = F('#47663f', 'nylon');
  // the fly: a dome over the footprint ellipse, sagging between the poles (they run corner to corner, at 45°)
  const dome = new SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const ps = dome.getAttribute('position');
  for (let i = 0; i < ps.count; i += 1) {
    const x = ps.getX(i);
    const y = ps.getY(i);
    const z = ps.getZ(i);
    const az = Math.atan2(z, x);
    const sag = 0.07 * (1 + Math.cos(4 * az)) * 0.5 * Math.sin(Math.acos(Math.min(1, y)) * 1.2);
    ps.setXYZ(i, x * a * (1 - sag * 0.6), Math.max(0.04, y * h * (1 - sag)), z * c * (1 - sag * 0.6));
  }
  dome.computeVertexNormals();
  k.add(dome, FLY);
  // the porch (vestibule) at the door end, its zip in a darker seam
  const porch = new SphereGeometry(1, 16, 8, Math.PI / 2, Math.PI, 0, Math.PI / 2);
  porch.scale(0.7, h * 0.74, c * 0.8);
  porch.translate(a * 0.7, 0.03, 0);
  k.add(porch, F('#4f7047', 'nylon'));
  k.tube([a * 0.7 + 0.68, 0.05, 0], [a * 0.7 + 0.36, h * 0.66, 0], 0.008, F('#2c3a2a', 'nylon'), 4);
  // the two poles over the top, in their sleeves
  for (const s of [-1, 1]) {
    const pts: V3[] = [];
    for (let i = 0; i <= 12; i += 1) {
      const r = -1 + (2 * i) / 12;
      pts.push([a * r * Math.SQRT1_2, h * Math.sqrt(Math.max(0, 1 - r * r)) + 0.012, s * c * r * Math.SQRT1_2]);
    }
    k.bar(pts, 0.011, F('#2f3236', 'dull'), 5);
  }
  // guy lines from the fly's tie-outs, and the pegs at the feet of the poles
  const tie: V3[] = [[0, h * 0.62, c * 0.8], [0, h * 0.62, -c * 0.8], [-a * 0.82, h * 0.6, 0], [a * 0.82 + 0.45, h * 0.45, 0]];
  const out: V3[] = [[0, 0, c + 0.85], [0, 0, -c - 0.85], [-a - 0.9, 0, 0], [a + 1.4, 0, 0]];
  pegsAndLines(k, tie, out);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) k.tube([sx * a * Math.SQRT1_2, 0.04, sz * c * Math.SQRT1_2], [sx * a * Math.SQRT1_2 * 1.08, -0.1, sz * c * Math.SQRT1_2 * 1.08], 0.006, PEG, 4);
}

/** a frame tent: aluminium uprights, eaves rails, rafters and a ridge under white PVC roof and side sheets with windows */
function frameTent(b: StructureDims, p: number, k: Kit, glass: Kit): void {
  const L = b.length;
  const W = b.width;
  const eaves = Math.min(2.4, b.height * 0.77);
  const ridge = b.height * 1.2;
  const AL = F('#c4c8cc', 'metal');
  const PVC = F('#f1f0ea', [0.55, 0, 4]);
  const bays = Math.max(2, Math.round(L / 3));
  const bay = L / bays;
  const xs = Array.from({ length: bays + 1 }, (_, i) => -L / 2 + i * bay);
  // the frame goes up first, then the sheets
  const frame = Math.min(1, p * 2);
  const sheets = Math.max(0, p * 2 - 1);
  const up = eaves * frame;
  for (const x of xs) {
    for (const z of [-W / 2, W / 2]) {
      k.tube([x, 0, z], [x, up, z], 0.042, AL, 8);
      k.box(0.3, 0.12, 0.3, x, 0.06, z, F('#8a8d90', 'concrete'));
    }
    if (frame >= 1) {
      k.tube([x, eaves, -W / 2], [x, ridge, 0], 0.04, AL, 8).tube([x, eaves, W / 2], [x, ridge, 0], 0.04, AL, 8);
      k.tube([x, eaves - 0.05, -W / 2], [x, eaves - 0.05, W / 2], 0.02, AL, 6);
    }
  }
  for (const z of [-W / 2, W / 2]) k.tube([-L / 2, up, z], [-L / 2 + L * frame, up, z], 0.035, AL, 6);
  if (frame >= 1) {
    k.tube([-L / 2, ridge, 0], [L / 2, ridge, 0], 0.04, AL, 6);
    for (const x of [-L / 2, L / 2]) k.tube([x, 0, 0], [x, ridge, 0], 0.04, AL, 8);
  }
  if (sheets <= 0) return;
  // roof sheets bay by bay, each sagging a little between its rafters
  const n = Math.max(1, Math.ceil(bays * sheets));
  for (let i = 0; i < n; i += 1) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    for (const s of [-1, 1]) {
      const rows: V3[][] = [];
      for (let u = 0; u <= 4; u += 1) {
        const f = u / 4;
        const row: V3[] = [];
        for (let v = 0; v <= 4; v += 1) {
          const g = v / 4;
          const sag = 0.06 * Math.sin(Math.PI * g) * Math.sin(Math.PI * f);
          row.push([x0 + (x1 - x0) * g, eaves + 0.03 + (ridge - eaves) * f - sag, s * (W / 2 + 0.06) * (1 - f)]);
        }
        rows.push(row);
      }
      k.add(sheet(rows), PVC);
    }
  }
  if (sheets < 0.6) return;
  // side sheets: PVC with windows in the long walls; one end open, its bay rolled up as the way in
  const wall = eaves - 0.02;
  for (const z of [-W / 2 - 0.02, W / 2 + 0.02]) {
    k.box(L, wall, 0.012, 0, wall / 2, z, PVC);
    for (let i = 0; i < bays; i += 1) {
      if (i % 2 === 0) continue;
      const x = xs[i]! + bay / 2;
      glass.box(bay * 0.62, 0.75, 0.012, x, 1.35, z + Math.sign(z) * 0.008, F('#b9c7cf', 'glass'));
      k.box(bay * 0.62, 0.03, 0.014, x, 1.35, z + Math.sign(z) * 0.01, F('#e6e4dc', 'plastic')).box(0.03, 0.75, 0.014, x, 1.35, z + Math.sign(z) * 0.01, F('#e6e4dc', 'plastic'));
    }
  }
  // (a gable's sheet: its outline across the width, set upright at the end)
  const across = (pts: [number, number][], x: number) => k.add(new ExtrudeGeometry(poly(pts), { depth: 0.012, bevelEnabled: false }).rotateY(Math.PI / 2).translate(x, 0, 0), PVC);
  const gable = (x: number, open: boolean) => {
    if (!open) across([[-W / 2, 0], [W / 2, 0], [W / 2, eaves], [0, ridge], [-W / 2, eaves]], x);
    else {
      // the doorway: the gable above it and the sheets beside it, the middle bay rolled up under the eaves
      across([[-W / 2, eaves * 0.95], [W / 2, eaves * 0.95], [W / 2, eaves], [0, ridge], [-W / 2, eaves]], x);
      for (const s of [-1, 1]) k.box(0.012, wall, W * 0.25, x, wall / 2, s * W * 0.375, PVC);
      k.tube([x + 0.05, eaves * 0.9, -W / 4], [x + 0.05, eaves * 0.9, W / 4], 0.07, PVC, 8);
    }
  };
  gable(-L / 2 - 0.02, false);
  gable(L / 2 + 0.02, true);
  // the camp kitchen inside: trestle tables and benches, a gas cooker on its stand
  const WD = F('#a98458', 'wood');
  for (const x of [L / 2 - 2.2, L / 2 - 4.6]) {
    k.box(2.2, 0.04, 0.7, x, 0.75, 0, WD);
    for (const sx of [-0.9, 0.9]) k.box(0.05, 0.73, 0.6, x + sx, 0.37, 0, WD);
    for (const z of [-0.65, 0.65]) k.box(2.2, 0.04, 0.25, x, 0.45, z, WD).box(0.05, 0.43, 0.2, x - 0.9, 0.22, z, WD).box(0.05, 0.43, 0.2, x + 0.9, 0.22, z, WD);
  }
  k.box(0.9, 0.85, 0.5, -L / 2 + 1.2, 0.42, W / 2 - 0.6, F('#9a9fa4', 'metal')).box(0.8, 0.05, 0.45, -L / 2 + 1.2, 0.87, W / 2 - 0.6, F('#2a2b2d', 'dull'));
}

/**
 * a lean-to: a ridge pole on two forked uprights, rafters leant from it down to the ground behind, brash laid thick over
 * them: one sloped roof, open at the front under the ridge. Frame first, then the brash from the ground up.
 */
function leanTo(b: StructureDims, p: number, k: Kit, ground: (lx: number, lz: number) => number): void {
  const L = b.length;
  const W = b.width;
  const H = b.height;
  const POLE = F('#6e5236', 'bark');
  // the ridge over the open front (−z), the rafters' feet on the ground at the back (+z)
  const zf = -W / 2;
  const zb = W / 2 + 0.15;
  const frame = Math.min(1, p * 1.6);
  const up = H * Math.min(1, frame * 2);
  for (const x of [-L / 2 + 0.2, L / 2 - 0.2]) {
    k.tube([x, ground(x, zf) - 0.25, zf], [x, up, zf], 0.05, POLE, 7);
    if (frame >= 0.5) k.tube([x, H - 0.08, zf], [x - 0.13, H + 0.2, zf + 0.02], 0.026, POLE, 5).tube([x, H - 0.08, zf], [x + 0.13, H + 0.2, zf - 0.02], 0.026, POLE, 5);
  }
  if (frame < 0.5) return;
  k.tube([-L / 2 - 0.3, H + 0.03, zf], [L / 2 + 0.3, H + 0.06, zf], 0.055, POLE, 7);
  // rafters, some 35 cm apart, from just over the ridge to the ground behind, as they are laid
  const n = Math.max(3, Math.round(L / 0.35));
  const laid = Math.ceil(n * Math.min(1, (frame - 0.5) * 2));
  for (let i = 0; i < laid; i += 1) {
    const x = -L / 2 + (L * (i + 0.5)) / n;
    const xb = x + (hash(i + 5) - 0.5) * 0.15;
    k.tube([x + (hash(i) - 0.5) * 0.08, H + 0.14, zf - 0.15], [xb, ground(xb, zb) - 0.05, zb], 0.03 + 0.008 * hash(i + 2), POLE, 5);
  }
  // the brash: a thick, ragged layer over the rafters, laid from the ground up to the ridge
  const thatch = Math.max(0, p * 1.6 - 0.6);
  if (thatch <= 0) return;
  const NU = 14;
  const NV = 8;
  const top = Math.max(1, Math.round(NV * thatch));
  const at = (u: number, v: number, lift: number): V3 => {
    // u along the ridge, v from the back (ground) up to the ridge; lift out of the roof plane
    const x = -L / 2 - 0.15 + (L + 0.3) * u;
    // (its lower edge on the ground behind, wherever that is)
    const y = (ground(x, zb + 0.1) + 0.02) * (1 - v) + (H + 0.14) * v;
    const z = zb + 0.1 + (zf - 0.15 - zb - 0.1) * v;
    // the roof's outward normal (up and back)
    const nl = Math.hypot(H + 0.14, zb - zf + 0.25);
    const ny = (zb - zf + 0.25) / nl;
    const nz = (H + 0.14) / nl;
    return [x, y + ny * lift, z + nz * lift];
  };
  for (const layer of [0, 1]) {
    const rows: V3[][] = [];
    for (let j = 0; j <= top; j += 1) {
      const v = j / NV;
      const row: V3[] = [];
      for (let i = 0; i <= NU; i += 1) {
        const u = i / NU;
        const bump = hash(i * 7 + j * 13 + layer * 31);
        // ragged at its edges, thickest in the middle
        const edge = Math.min(1, u * 6, (1 - u) * 6);
        row.push(at(u + (bump - 0.5) * 0.02, v, (0.08 + 0.26 * bump) * edge * (layer ? 1 : 0.4) + 0.04));
      }
      rows.push(row);
    }
    // (cut brash wilts: needles and leaves olive to brown, the wood under them darker)
    k.add(sheet(rows), F(layer ? '#5b5230' : '#4a3b26', 'bark'));
  }
  // the branches it is made of, laid down the slope, butts at the ridge, each with its side twigs
  const nb = Math.round(L / 0.22);
  for (let i = 0; i < nb; i += 1) {
    const u = (i + 0.5) / nb + (hash(i * 9) - 0.5) * 0.04;
    const v0 = Math.min(top / NV, 0.98 - hash(i * 3) * 0.1);
    const v1 = Math.max(0, v0 - 0.45 - hash(i * 7) * 0.4);
    const a = at(u, v0, 0.26 + 0.08 * hash(i));
    const b2 = at(u + (hash(i + 2) - 0.5) * 0.08, v1, 0.22);
    k.tube(a, b2, 0.016 + 0.01 * hash(i + 4), F('#4a3a28', 'bark'), 4);
    for (let j = 1; j < 4; j += 1) {
      const f = j / 4;
      const m: V3 = [a[0] + (b2[0] - a[0]) * f, a[1] + (b2[1] - a[1]) * f, a[2] + (b2[2] - a[2]) * f];
      const sd = (j % 2 ? 1 : -1) * (0.15 + 0.15 * hash(i * 5 + j));
      k.tube(m, [m[0] + sd, m[1] - 0.04, m[2] + 0.12], 0.007, F('#4a3a28', 'bark'), 3);
    }
  }
  // twigs sticking out of it, along the edges and the ridge
  for (let i = 0; i < 16; i += 1) {
    const u = hash(i * 3 + 1);
    const v = Math.min(top / NV, hash(i * 5 + 2));
    const [x, y, z] = at(u, v, 0.18);
    k.tube([x, y, z], [x + (hash(i) - 0.5) * 0.6, y + 0.1 + hash(i + 9) * 0.25, z + (hash(i + 4) - 0.5) * 0.4], 0.012, F('#4e3b28', 'bark'), 4);
  }
}

/** a tarp strung between two poles and low pegs, sloping to its lowest corner over a 200 l barrel */
function rainCatcher(b: StructureDims, p: number, k: Kit): void {
  const L = b.length;
  const W = b.width;
  const H = b.height;
  const POLE = F('#6e5236', 'bark');
  // the barrel at the low corner: a blue HDPE drum with its lid and tap
  const bx = L / 2 - 0.35;
  const bz = W / 2 - 0.35;
  k.lathe([[0, 0], [0.29, 0], [0.3, 0.05], [0.29, 0.3], [0.3, 0.34], [0.29, 0.6], [0.3, 0.64], [0.29, 0.9], [0.24, 0.93], [0, 0.93]], bx, 0, bz, F('#1f5aa6', 'plastic'), 18);
  k.cyl(0.02, 0.08, bx - 0.3, 0.12, bz, F('#2b2c2e', 'plastic'), 'x', 6);
  if (p <= 0.05) return;
  // corners: two high on poles, one middling, the lowest over the barrel's funnel
  const hi = H * Math.min(1, p * 1.5);
  const C: V3[] = [[-L / 2, hi, -W / 2], [L / 2, hi * 0.85, -W / 2], [L / 2, 0.98, W / 2 - 0.35], [-L / 2, hi * 0.7, W / 2]];
  k.tube([-L / 2, -0.2, -W / 2], [-L / 2, hi + 0.1, -W / 2], 0.035, POLE, 6).tube([L / 2, -0.2, -W / 2], [L / 2, hi * 0.85 + 0.1, -W / 2], 0.035, POLE, 6).tube([-L / 2, -0.2, W / 2], [-L / 2, hi * 0.7 + 0.1, W / 2], 0.035, POLE, 6);
  if (p < 0.5) return;
  const rows: V3[][] = [];
  for (let u = 0; u <= 6; u += 1) {
    const f = u / 6;
    const row: V3[] = [];
    for (let v = 0; v <= 6; v += 1) {
      const g = v / 6;
      const lerp = (i: 0 | 1 | 2) => (C[0]![i] * (1 - g) + C[1]![i] * g) * (1 - f) + (C[3]![i] * (1 - g) + C[2]![i] * g) * f;
      // (it sags towards the low corner: the water runs there)
      const sag = 0.18 * Math.sin(Math.PI * f) * Math.sin(Math.PI * g);
      row.push([lerp(0), lerp(1) - sag, lerp(2)]);
    }
    rows.push(row);
  }
  k.add(sheet(rows), F('#2e6aa8', [0.55, 0, 4]));
  pegsAndLines(k, [C[0]!, C[1]!, C[3]!], [[-L / 2 - 1.2, 0, -W / 2 - 0.6], [L / 2 + 1.2, 0, -W / 2 - 0.6], [-L / 2 - 1.1, 0, W / 2 + 0.5]]);
}

/** a hut of notched logs: courses crossing at the corners, the log ends standing out, a roof of poles under brash and earth */
function logHut(b: StructureDims, p: number, k: Kit, glass: Kit): void {
  const L = b.length;
  const W = b.width;
  const r = 0.11;
  const eaves = Math.max(1.6, b.height - 0.9);
  const LOG = F('#7d5f40', 'bark');
  const inL = L - 0.5;
  const inW = W - 0.5;
  // each wall's logs lie on the ones below, notched; the crossing walls half a log higher
  const lift = r * 0.92;
  const courses = Math.floor(eaves / lift);
  const built = Math.ceil(courses * Math.min(1, p * 1.4));
  for (let i = 0; i < built; i += 1) {
    const y = r + i * lift - (i % 2 ? 0 : r * 0.85);
    const long = i % 2 === 0;
    for (const s of [-1, 1]) {
      if (long) {
        // the door on the +z side: its course is cut there
        if (s > 0 && y < 1.75) {
          k.tube([-L / 2, y + r * 0.85, (s * inW) / 2], [-0.45, y + r * 0.85, (s * inW) / 2], r * (0.92 + 0.1 * hash(i)), LOG, 8);
          k.tube([0.45, y + r * 0.85, (s * inW) / 2], [L / 2, y + r * 0.85, (s * inW) / 2], r * (0.92 + 0.1 * hash(i + 1)), LOG, 8);
        } else k.tube([-L / 2, y + r * 0.85, (s * inW) / 2], [L / 2, y + r * 0.85, (s * inW) / 2], r * (0.92 + 0.1 * hash(i + s)), LOG, 8);
      } else k.tube([(s * inL) / 2, y, -W / 2], [(s * inL) / 2, y, W / 2], r * (0.92 + 0.1 * hash(i + 5 + s)), LOG, 8);
    }
  }
  if (p < 0.7) return;
  const top = r + courses * lift;
  // gables of shortening logs, the ridge and purlins, a roof of poles under brash and turf
  const rise = 0.85;
  for (let i = 0; i < 5; i += 1) {
    const f = i / 5;
    const half = (inW / 2 + 0.1) * (1 - f);
    for (const s of [-1, 1]) k.tube([(s * inL) / 2, top + f * rise, -half], [(s * inL) / 2, top + f * rise, half], r * 0.9, LOG, 7);
  }
  k.tube([-L / 2 - 0.3, top + rise, 0], [L / 2 + 0.3, top + rise, 0], r, LOG, 8);
  const slope = Math.hypot(W / 2 + 0.4, rise);
  for (const s of [-1, 1]) {
    const ang = Math.atan2(rise, W / 2 + 0.4);
    const g = new SphereGeometry(1, 12, 4);
    g.scale(L / 2 + 0.45, 0.13, slope / 2);
    g.rotateX(s * ang);
    g.translate(0, top + rise / 2 + 0.12, (s * (W / 2 + 0.4)) / 2);
    k.add(g, F('#5a5a33', 'bark'));
  }
  // the door of boards, a small window, the stove pipe
  k.box(0.85, 1.7, 0.06, 0, 0.85, inW / 2 + 0.08, F('#6a4d31', 'boards'));
  glass.box(0.45, 0.4, 0.03, 0, 1.35, -inW / 2 - r - 0.02, F('#2a333a', 'glass'));
  k.box(0.55, 0.06, 0.06, 0, 1.12, -inW / 2 - r - 0.03, F('#6a4d31', 'wood'));
  k.tube([inL / 2 - 0.5, top, inW / 4], [inL / 2 - 0.5, top + rise + 0.7, inW / 4], 0.06, F('#3d4043', 'dull'), 8).cyl(0.11, 0.04, inL / 2 - 0.5, top + rise + 0.72, inW / 4, F('#3d4043', 'dull'), 'y', 8);
}

/**
 * a wall of NF bricks (240 × 115 × 71 mm) stacked without mortar, half a brick thick, in stretcher bond: each brick by
 * itself, a little out of line as dry-stacked bricks are, the courses level and stepped down where the ground falls, laid
 * course by course to its height
 */
function dryWall(b: StructureDims, p: number, k: Kit, ground: (lx: number, lz: number) => number): void {
  const L = b.length;
  const T = Math.max(0.115, b.width);
  const bl = 0.24;
  const bh = 0.071;
  const course = bh + 0.003;
  const n = Math.ceil(L / (bl + 0.004));
  let low = Infinity;
  for (let i = 0; i <= 8; i += 1) low = Math.min(low, ground(-L / 2 + (L * i) / 8, 0));
  // (the top course at its height over the ground where it stands; the courses below go down to the ground)
  const topY = Math.max(bh, b.height * p);
  const first = Math.floor((low - 0.02) / course);
  const last = Math.floor((topY - bh) / course);
  // the strip of ground it stands on, cleared and trodden as it was laid, following the ground on both sides
  const strip: V3[][] = [];
  for (const z of [-T / 2 - 0.35, -T / 2, T / 2, T / 2 + 0.35]) {
    const row: V3[] = [];
    for (let i = 0; i <= 12; i += 1) {
      const x = -L / 2 - 0.3 + ((L + 0.6) * i) / 12;
      row.push([x, ground(x, z) + 0.012, z]);
    }
    strip.push(row);
  }
  k.add(sheet(strip), F('#4a4130', 'rough'));
  // (a long wall drawn whole would be thousands of bricks: one block with its courses beyond that)
  if ((last - first + 1) * n > 2600) {
    k.box(L, topY - low, T, 0, (topY + low) / 2, 0, F('#b4553a', [0.92, 0, 1]));
    return;
  }
  // (the dark of the gaps between dry bricks: what is seen through the joints)
  k.box(L - 0.02, last * course + bh - first * course - 0.01, T * 0.6, 0, (first * course + last * course + bh) / 2, 0, F('#2b231d', 'matte'));
  for (let c = first; c <= last; c += 1) {
    const y = c * course + bh / 2;
    const shift = c % 2 ? bl / 2 : 0;
    for (let i = -1; i < n; i += 1) {
      let x0 = -L / 2 + i * (bl + 0.004) + shift;
      let x1 = x0 + bl;
      x0 = Math.max(x0, -L / 2);
      x1 = Math.min(x1, L / 2);
      if (x1 - x0 < 0.03) continue;
      const cx = (x0 + x1) / 2;
      // only bricks with their top above the ground there
      if (y + bh / 2 < ground(cx, 0) - 0.01) continue;
      const h = hash(c * 131 + i * 17);
      const tone = 0.82 + 0.3 * hash(c * 7 + i * 29);
      const col = `#${[0xb4, 0x55, 0x3a].map((v) => Math.min(255, Math.round(v * tone)).toString(16).padStart(2, '0')).join('')}`;
      k.box(x1 - x0 - 0.009, bh - 0.007, T - 0.004, cx + (h - 0.5) * 0.006, y, (hash(c * 3 + i * 41) - 0.5) * 0.012, F(col, [0.92, 0, 0]), 0, (h - 0.5) * 0.02);
    }
  }
}

/** a vehicle set up where it stands (a caravan, a Bauwagen): the vehicle draws itself; this adds its steadies, chocks and step */
function setUp(b: StructureDims, p: number, k: Kit): void {
  if (p <= 0) return;
  const L = b.length;
  const W = b.width;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.18, 0.04, 0.18, sx * (L / 2 - 0.25), 0.02, sz * (W / 2 - 0.2), F('#6b5236', 'wood'));
  // chocks either side of each wheel, a step at the door
  for (const sz of [-1, 1]) for (const dx of [-0.42, 0.42]) k.add(new SphereGeometry(0.1, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.2, 1, 0.8).translate(-0.1 + dx, 0, sz * 1.02), F('#d9b018', 'plastic'));
  k.box(0.5, 0.2, 0.35, -0.19, 0.1, W / 2 + 0.35, F('#8e9398', 'galv')).box(0.46, 0.02, 0.32, -0.19, 0.205, W / 2 + 0.35, F('#3a3b3d', 'rubber'));
}
