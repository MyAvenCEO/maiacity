/**
 * What a store holds, drawn as the goods themselves where they come in pieces or packs: six-packs of water, boxes of
 * provisions, 11 kg gas bottles, jerrycans, tent bags and rolled mats, a stack of split firewood, logs on a pile, bricks on
 * pallets, beams in a stack. Bulk goods (soil, gravel, asphalt) stay a heap, sized by what is left of them. Piles are set
 * out side by side next to the store, each on the ground where it lies; counts are capped so a big store stays cheap.
 */
import { SphereGeometry } from 'three';
import { F, Kit } from './models.ts';

export interface Good {
  material: string;
  qty: number;
  unit: string;
  /** loose volume of a bulk good (m³) */
  m3?: number;
}

type Pile = { w: number; d: number; draw: (k: Kit, x: number, z: number, y: number) => void };

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const CARD = F('#b48d5c', 'card');
const PET = F('#a9cde0', [0.12, 0, 0]);

/** in rows: n things of w × d footprint, `per` to a row, `layers` high, each drawn at (x, z, layer) */
function grid(n: number, per: number, w: number, d: number, gap: number, draw: (k: Kit, x: number, z: number, y: number, i: number, layer: number) => void, layerH: number, maxLayers = 1): Pile {
  const perLayer = Math.ceil(n / maxLayers);
  const cols = Math.min(per, perLayer);
  const rows = Math.ceil(perLayer / cols);
  const W = cols * (w + gap);
  const D = rows * (d + gap);
  return {
    w: W,
    d: D,
    draw: (k, x0, z0, y0) => {
      for (let i = 0; i < n; i += 1) {
        const layer = Math.floor(i / perLayer);
        const j = i % perLayer;
        const x = x0 - W / 2 + (j % cols) * (w + gap) + (w + gap) / 2;
        const z = z0 - D / 2 + Math.floor(j / cols) * (d + gap) + (d + gap) / 2;
        draw(k, x, z, y0 + layer * layerH, i, layer);
      }
    },
  };
}

const sixPack = (k: Kit, x: number, z: number, y: number) => {
  for (let i = 0; i < 6; i += 1) {
    const bx = x + ((i % 3) - 1) * 0.09;
    const bz = z + (Math.floor(i / 3) - 0.5) * 0.09;
    k.lathe([[0, 0], [0.043, 0.005], [0.045, 0.22], [0.02, 0.29], [0.014, 0.31], [0, 0.31]], bx, y, bz, PET, 8).cyl(0.015, 0.02, bx, y + 0.32, bz, F('#1f5fae', 'plastic'), 'y', 6);
  }
};

const gasBottle = (k: Kit, x: number, z: number, y: number, i: number) => {
  // an 11 kg propane bottle (grey, a red one among them), its collar and valve
  const c = i % 3 === 2 ? '#b8322b' : '#8c9196';
  k.lathe([[0, 0], [0.13, 0], [0.15, 0.06], [0.15, 0.45], [0.12, 0.53], [0.05, 0.56], [0, 0.56]], x, y, z, F(c, 'paint'), 14);
  k.ring(0.075, 0.012, x, y + 0.6, z, F(c, 'paint'), 'y', Math.PI * 1.4, 10).cyl(0.015, 0.06, x, y + 0.59, z, F('#b38f2f', 'metal'), 'y', 6);
};

const jerrycan = (k: Kit, x: number, z: number, y: number) => {
  k.box(0.33, 0.33, 0.16, x, y + 0.165, z, F('#b5261e', 'plastic')).box(0.3, 0.3, 0.165, x, y + 0.165, z, F('#a3221b', 'plastic'));
  k.box(0.14, 0.04, 0.05, x - 0.05, y + 0.36, z, F('#b5261e', 'plastic')).cyl(0.025, 0.05, x + 0.11, y + 0.35, z, F('#1c1c1d', 'plastic'), 'y', 6);
};

const roll = (k: Kit, x: number, z: number, y: number, r: number, len: number, color: string, fin: 'nylon' | 'fabric' | 'plastic' = 'nylon') => {
  k.cyl(r, len, x, y + r, z, F(color, fin), 'x', 12);
  k.cyl(r * 1.02, 0.02, x - len * 0.3, y + r, z, F('#1c1c1d', 'fabric'), 'x', 12).cyl(r * 1.02, 0.02, x + len * 0.3, y + r, z, F('#1c1c1d', 'fabric'), 'x', 12);
};

const sack = (k: Kit, x: number, z: number, y: number, w: number, d: number, h: number, color: string, fin: 'card' | 'fabric' | 'plastic' = 'fabric') => {
  const g = new SphereGeometry(1, 10, 6);
  const ps = g.getAttribute('position');
  for (let i = 0; i < ps.count; i += 1) {
    const sx = ps.getX(i);
    const sy = ps.getY(i);
    const sz = ps.getZ(i);
    const sq = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.55);
    ps.setXYZ(i, sq(sx) * w / 2, (sq(sy) + 1) * h / 2, sq(sz) * d / 2);
  }
  g.computeVertexNormals();
  k.add(g.translate(x, y, z), F(color, fin));
};

/** the pile for one good (null: a bulk good, or nothing to see) */
function pile(g: Good, seed: number): Pile | null {
  const m = g.material;
  const q = g.qty;
  const cap = (n: number, c: number) => Math.max(1, Math.min(c, Math.ceil(n - 1e-9)));
  if (q <= 1e-6) return null;
  switch (m) {
    case 'water.drinking':
      return grid(cap(q / 9, 48), 4, 0.27, 0.18, 0.01, (k, x, z, y) => sixPack(k, x, z, y), 0.33, 3);
    case 'water.rain':
    case 'water.raw':
      return grid(cap(q / 200, 6), 3, 0.6, 0.6, 0.05, (k, x, z, y) => k.lathe([[0, 0], [0.29, 0], [0.3, 0.05], [0.29, 0.3], [0.3, 0.34], [0.29, 0.6], [0.3, 0.64], [0.29, 0.9], [0.24, 0.93], [0, 0.93]], x, y, z, F('#1f5aa6', 'plastic'), 16), 0.93);
    case 'food.provisions':
      return grid(cap(q / 8, 30), 3, 0.4, 0.3, 0.02, (k, x, z, y, i) => {
        k.box(0.4, 0.26, 0.3, x, y + 0.13, z, i % 4 === 3 ? F('#c9b88f', 'card') : CARD).box(0.402, 0.05, 0.302, x, y + 0.2, z, F(i % 2 ? '#3d6a9c' : '#a33a2c', 'card'));
      }, 0.27, 3);
    case 'food.dry':
    case 'fuel.charcoal':
      return grid(cap(q / 5, 24), 3, 0.32, 0.22, 0.02, (k, x, z, y) => sack(k, x, z, y, 0.32, 0.22, 0.12, m === 'fuel.charcoal' ? '#2b2b2b' : '#d8c9a3', m === 'fuel.charcoal' ? 'card' : 'plastic'), 0.12, 3);
    case 'fuel.propane':
      return grid(cap(q / 11, 12), 4, 0.31, 0.31, 0.03, gasBottle, 0.6);
    case 'petrol.2t':
      return grid(cap(q / 10, 10), 4, 0.33, 0.17, 0.03, (k, x, z, y) => jerrycan(k, x, z, y), 0.4);
    case 'kit.tent2':
      return grid(cap(q, 8), 2, 0.5, 0.2, 0.04, (k, x, z, y) => roll(k, x, z, y, 0.09, 0.5, '#3d5a3a'), 0.18, 2);
    case 'kit.rainCatcher':
      return grid(cap(q, 4), 2, 0.7, 0.62, 0.05, (k, x, z, y) => {
        k.lathe([[0, 0], [0.29, 0], [0.29, 0.9], [0, 0.93]], x - 0.05, y, z, F('#1f5aa6', 'plastic'), 14);
        roll(k, x + 0.1, z + 0.32, y, 0.08, 0.6, '#2e6aa8', 'plastic');
      }, 0.95);
    case 'kit.kitchenTent':
      // pole bundles and the rolled roof and wall sheets, one piece each
      return grid(cap(q, 20), 3, 2.0, 0.24, 0.03, (k, x, z, y, i) => {
        if (i % 3 === 0) {
          for (let j = 0; j < 4; j += 1) k.tube([x - 1, y + 0.05 + (j % 2) * 0.06, z - 0.05 + Math.floor(j / 2) * 0.07], [x + 1, y + 0.05 + (j % 2) * 0.06, z - 0.05 + Math.floor(j / 2) * 0.07], 0.03, F('#c4c8cc', 'metal'), 6);
        } else roll(k, x, z, y, 0.11, 1.6, '#e9e7df', 'plastic');
      }, 0.22, 3);
    case 'bedding.bag3season':
    case 'bedding.bagWinter':
      return grid(cap(q, 10), 5, 0.26, 0.38, 0.02, (k, x, z, y, i) => {
        k.cyl(0.12, 0.36, x, y + 0.12, z, F(i % 2 ? '#2f5b8c' : m === 'bedding.bagWinter' ? '#8c2f2f' : '#3c6aa0', 'nylon'), 'z', 12);
      }, 0.24, 2);
    case 'bedding.matFoam':
    case 'bedding.matInsulated':
      return grid(cap(q, 10), 5, 0.18, 0.6, 0.02, (k, x, z, y) => {
        k.cyl(0.08, 0.6, x, y + 0.08, z, F(m === 'bedding.matFoam' ? '#c9b03a' : '#4f7a4a', m === 'bedding.matFoam' ? 'plastic' : 'nylon'), 'z', 12);
      }, 0.16, 2);
    case 'heater.gas':
      // a cabinet gas heater: its bottle inside, three ceramic panels in front
      return grid(cap(q, 4), 4, 0.44, 0.42, 0.05, (k, x, z, y) => {
        k.box(0.44, 0.74, 0.4, x, y + 0.37, z, F('#e3e1dc', 'paint')).box(0.36, 0.3, 0.02, x, y + 0.52, z + 0.205, F('#c9a07a', [0.9, 0, 0]));
        for (let j = 0; j < 3; j += 1) k.box(0.36, 0.006, 0.025, x, y + 0.4 + j * 0.1, z + 0.21, F('#2b2c2e', 'dull'));
        k.cyl(0.02, 0.03, x + 0.15, y + 0.72, z + 0.2, F('#1c1c1d', 'plastic'), 'z', 8);
      }, 0.75);
    case 'stove.camping':
      return grid(cap(q, 4), 2, 0.56, 0.34, 0.04, (k, x, z, y) => {
        k.box(0.56, 0.1, 0.34, x, y + 0.05, z, F('#4a6a55', 'paint')).box(0.56, 0.24, 0.015, x, y + 0.22, z - 0.16, F('#4a6a55', 'paint'));
        for (const sx of [-0.13, 0.13]) k.ring(0.06, 0.008, x + sx, y + 0.11, z, F('#2b2c2e', 'dull'), 'y', Math.PI * 2, 12);
      }, 0.12);
    case 'stove.tent':
      return grid(cap(q, 3), 3, 0.45, 0.3, 0.05, (k, x, z, y) => {
        k.box(0.42, 0.28, 0.28, x, y + 0.2, z, F('#3a3d40', 'dull'));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.tube([x + sx * 0.18, y + 0.06, z + sz * 0.11], [x + sx * 0.18, y, z + sz * 0.11], 0.01, F('#3a3d40', 'dull'), 4);
        k.tube([x + 0.12, y + 0.34, z], [x + 0.12, y + 0.45, z], 0.04, F('#4a4d50', 'dull'), 8);
      }, 0.5);
    case 'grill.charcoal':
      return grid(cap(q, 3), 3, 0.5, 0.5, 0.05, (k, x, z, y) => {
        k.add(new SphereGeometry(0.24, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(x, y + 0.7, z), F('#1e1f20', 'paint'));
        for (let j = 0; j < 3; j += 1) {
          const a = (j / 3) * Math.PI * 2;
          k.tube([x + Math.cos(a) * 0.17, y + 0.55, z + Math.sin(a) * 0.17], [x + Math.cos(a) * 0.26, y, z + Math.sin(a) * 0.26], 0.012, F('#8a8d90', 'metal'), 4);
        }
      }, 0.75);
    case 'toilet.bucket':
      return grid(cap(q, 3), 3, 0.34, 0.34, 0.05, (k, x, z, y) => {
        k.lathe([[0, 0], [0.13, 0], [0.155, 0.36], [0, 0.36]], x, y, z, F('#ecebe6', 'plastic'), 14).cyl(0.17, 0.04, x, y + 0.38, z, F('#2b2c2e', 'plastic'), 'y', 14);
      }, 0.42);
    case 'cover.sawdust':
      return grid(cap(q / 20, 10), 3, 0.5, 0.32, 0.02, (k, x, z, y) => sack(k, x, z, y, 0.5, 0.32, 0.2, '#d9c25a', 'plastic'), 0.2, 2);
    case 'filter.gravity':
    case 'soap.bar':
      return grid(cap(m === 'soap.bar' ? q / 0.5 : q, 4), 4, 0.16, 0.12, 0.02, (k, x, z, y) => k.box(0.14, m === 'soap.bar' ? 0.05 : 0.26, 0.1, x, y + (m === 'soap.bar' ? 0.025 : 0.13), z, F(m === 'soap.bar' ? '#f0e2a8' : '#2f7fa8', 'plastic')), 0.26);
    case 'waste.household':
      return grid(cap(q / 6, 14), 4, 0.45, 0.45, -0.05, (k, x, z, y, i) => {
        const g = new SphereGeometry(0.24 + hash(i) * 0.04, 10, 7);
        g.scale(1, 1.25, 0.95);
        k.add(g.translate(x, y + 0.27, z), F(i % 3 ? '#1e1f21' : '#3a3c3f', [0.35, 0, 0]));
        k.box(0.05, 0.08, 0.05, x, y + 0.6, z, F('#1e1f21', [0.35, 0, 0]));
      }, 0.5, 2);
    case 'fuel.firewood':
    case 'fuel.firewoodGreen':
      return woodStack(q / (m === 'fuel.firewood' ? 450 : 650), seed);
    case 'wood.logs':
      return logPile((g.m3 ?? q / 0.8) * 0.6, seed);
    case 'wood.brash':
      return brash(g.m3 ?? q / 0.3, seed);
    case 'brick.nf':
      return pallets(q);
    case 'timber.kvh':
      return beams(q);
    case 'pipe.culvert':
      return grid(cap(q, 9), 3, 2.5, 0.8, 0.05, (k, x, z, y) => k.cyl(0.38, 2.5, x, y + 0.38, z, F('#9a9a96', 'concrete'), 'x', 18).cyl(0.3, 2.52, x, y + 0.38, z, F('#3a3a38', 'concrete'), 'x', 18), 0.76);
    default:
      if (g.unit === 't' || g.unit === 'm3') return null;
      // a good with no shape of its own yet: in plain cartons
      return grid(cap(q / (g.unit === 'pcs' ? 1 : 10), 12), 3, 0.4, 0.3, 0.02, (k, x, z, y) => k.box(0.4, 0.3, 0.3, x, y + 0.15, z, CARD), 0.3, 2);
  }
}

/** split firewood stacked between end posts, 33 cm pieces, as high as a person reaches: its log ends to the front */
function woodStack(stere: number, seed: number): Pile {
  const h = Math.min(1.25, 0.45 + stere * 0.25);
  const deep = 0.36;
  const len = Math.max(0.6, stere / (h * deep * 0.92));
  return {
    w: len + 0.2,
    d: deep + 0.1,
    draw: (k, x, z, y) => {
      k.box(len, h, deep, x, y + h / 2, z, F('#6d5136', [0.95, 0, 8]));
      const n = Math.min(260, Math.round((len / 0.11) * (h / 0.11)));
      const cols = Math.max(1, Math.round(len / 0.11));
      for (let i = 0; i < n; i += 1) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const px = x - len / 2 + (c + 0.5) * (len / cols) + (hash(i + seed) - 0.5) * 0.03;
        const py = y + 0.06 + r * 0.105 + (r % 2) * 0.01;
        if (py > y + h - 0.04) break;
        const rr = 0.045 + hash(i * 3 + seed) * 0.02;
        k.cyl(rr, 0.02, px, py, z + deep / 2 + 0.005, F(hash(i + 9) > 0.5 ? '#c79d68' : '#b88d5b', [0.85, 0, 0]), 'z', 5);
      }
      for (const sx of [-1, 1]) k.tube([x + sx * (len / 2 + 0.05), y - 0.2, z], [x + sx * (len / 2 + 0.05), y + h + 0.1, z], 0.05, F('#6e5236', 'bark'), 6);
    },
  };
}

/** logs on a pile, the longest at the bottom, their cut ends pale */
function logPile(m3: number, seed: number): Pile {
  const len = 4;
  const r = 0.15;
  const n = Math.max(1, Math.min(42, Math.round(m3 / (Math.PI * r * r * len))));
  let rows = 1;
  while ((rows * (rows + 1)) / 2 < n) rows += 1;
  const base = rows;
  return {
    w: len + 0.3,
    d: base * 2 * r + 0.3,
    draw: (k, x, z, y) => {
      let i = 0;
      for (let row = 0; row < rows && i < n; row += 1) {
        const inRow = base - row;
        for (let j = 0; j < inRow && i < n; j += 1, i += 1) {
          const rr = r * (0.8 + 0.4 * hash(i + seed));
          const zz = z + (j - (inRow - 1) / 2) * 2 * r;
          const yy = y + r + row * r * 1.72;
          const l = len * (0.9 + 0.15 * hash(i * 7 + seed));
          k.cyl(rr, l, x + (hash(i * 5) - 0.5) * 0.3, yy, zz, F('#5f4a33', 'bark'), 'x', 9);
          for (const s of [-1, 1]) k.cyl(rr * 0.92, 0.01, x + (hash(i * 5) - 0.5) * 0.3 + (s * l) / 2, yy, zz, F('#c9a374', [0.85, 0, 0]), 'x', 9);
        }
      }
    },
  };
}

/** brash: a loose pile of branches and twigs with their needles and leaves */
function brash(m3: number, seed: number): Pile {
  const r = Math.max(0.6, Math.cbrt(m3) * 0.9);
  return {
    w: r * 2.4,
    d: r * 1.8,
    draw: (k, x, z, y) => {
      for (let i = 0; i < 6; i += 1) {
        const g = new SphereGeometry(1, 9, 5);
        g.scale(r * (0.6 + 0.4 * hash(i + seed)), r * 0.35 * (0.7 + 0.5 * hash(i + 3)), r * (0.45 + 0.3 * hash(i + 6)));
        k.add(g.translate(x + (hash(i * 3 + seed) - 0.5) * r, y + r * 0.12, z + (hash(i * 7) - 0.5) * r * 0.6), F(i % 2 ? '#5d6436' : '#6a5a3a', 'bark'));
      }
      for (let i = 0; i < 14; i += 1) {
        const a = hash(i * 11 + seed) * Math.PI * 2;
        const l = r * (0.8 + hash(i) * 0.8);
        k.tube([x + Math.cos(a) * r * 0.2, y + r * 0.3, z + Math.sin(a) * r * 0.2], [x + Math.cos(a) * l, y + 0.05, z + Math.sin(a) * l * 0.7], 0.02, F('#4e3b28', 'bark'), 4);
      }
    },
  };
}

/** bricks strapped on pallets: some 400 NF to a Euro pallet (1.2 × 0.8 m), the last one part full */
function pallets(n: number): Pile {
  const per = 400;
  const count = Math.max(1, Math.min(10, Math.ceil(n / per)));
  return grid(count, 3, 1.2, 0.8, 0.12, (k, x, z, y, i) => {
    const left = Math.min(per, n - i * per);
    const h = Math.max(0.071, 0.71 * Math.min(1, left / per));
    k.box(1.2, 0.022, 0.8, x, y + 0.133, z, F('#b99a6b', 'wood'));
    for (const zz of [-0.35, 0, 0.35]) k.box(1.2, 0.1, 0.1, x, y + 0.06, z + zz, F('#a88a5e', 'wood'));
    k.box(1.12, h, 0.74, x, y + 0.144 + h / 2, z, F('#b4553a', [0.9, 0, 1]));
    for (const xx of [-0.3, 0.3]) k.box(0.02, h + 0.01, 0.75, x + xx, y + 0.144 + h / 2, z, F('#2b2c2e', 'plastic'));
  }, 1);
}

/** sawn beams (KVH, 12 × 20 cm, 5 m) in a stack on spacers */
function beams(m3: number): Pile {
  const n = Math.max(1, Math.min(48, Math.round(m3 / 0.12)));
  const per = 6;
  const layers = Math.ceil(n / per);
  return {
    w: 5.2,
    d: per * 0.14 + 0.2,
    draw: (k, x, z, y) => {
      for (const xx of [-2, 0, 2]) k.box(0.1, 0.1, per * 0.14 + 0.1, x + xx, y + 0.05, z, F('#8a7a5e', 'wood'));
      for (let i = 0; i < n; i += 1) {
        const layer = Math.floor(i / per);
        const j = i % per;
        k.box(5, 0.2, 0.12, x, y + 0.1 + 0.1 + layer * 0.22, z - (per * 0.14) / 2 + j * 0.14 + 0.07, F('#d8b37a', 'wood'));
      }
      void layers;
    },
  };
}

/** the store's goods as piles side by side (in rows some 4 m wide), each on the ground; and the bulk left for a heap */
export function drawGoods(goods: Good[], k: Kit, ground: (dx: number, dz: number) => number, seed: number): { bulk: number; radius: number } {
  const piles: Pile[] = [];
  let bulk = 0;
  for (const g of goods) {
    const p = pile(g, seed);
    if (p) piles.push(p);
    else if (g.unit === 't' || g.unit === 'm3') bulk += g.m3 ?? 0;
  }
  piles.sort((a, b) => b.w * b.d - a.w * a.d);
  const rowW = Math.max(4, ...piles.map((p) => p.w));
  let x = 0;
  let z = 0;
  let rowD = 0;
  const placed: { p: Pile; x: number; z: number }[] = [];
  for (const p of piles) {
    if (x > 0 && x + p.w > rowW) {
      z += rowD + 0.3;
      x = 0;
      rowD = 0;
    }
    placed.push({ p, x: x + p.w / 2, z: z + p.d / 2 });
    x += p.w + 0.3;
    rowD = Math.max(rowD, p.d);
  }
  const W = placed.reduce((a, q) => Math.max(a, q.x + q.p.w / 2), 0);
  const D = z + rowD;
  for (const q of placed) {
    const px = q.x - W / 2;
    const pz = q.z - D / 2;
    q.p.draw(k, px, pz, ground(px, pz));
  }
  return { bulk, radius: Math.hypot(W, D) / 2 };
}
