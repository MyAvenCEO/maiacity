// Sandbox 7: a candidate `price` hook for a world's Trading card (paste it below the card's other hooks), from the
// research "Fast scarcity prices for aven markets" (2026-10-11). Not used by any world unless a MIP puts it there.
//
// The flow price (Worlds 33-37) adds each morning's gap between need and harvest onto yesterday's price, so a price
// is the sum of its whole history: it trails a shortage, keeps climbing after the new fields are planted, and can
// sit upside down against what is short today (World 36: water dearest in a glut, chicken cheap with none grown).
// This price is set each morning from where the valley stands instead: what it holds in store, what its fields
// harvested last night, and what the fields still growing will add, against what the living need over the time a
// new field takes to grow, plus a few days of need in hand. Fields already planted lower the price before they
// harvest, so a rush into one crop stops paying the next morning; and the price keeps paying until the valley holds
// those days in hand, so a margin above bare need is worth growing. A slow reference level drifts toward where the
// valley holds its days in hand. Every good starts from the same price, the middle of the prices the world inherits:
// started from World 36's last prices one by one, vegetables at 0.07 could never pay for a field (the margin moves a
// price at most 4x), and on a rough copy of World 36 that start lost 187 avens over 9 seeds against 1 from the middle.

// days of need the price keeps paying for in hand; how strongly the price answers the margin; how slowly the reference
// drifts (in multiples of the crop's growing time)
const IN_HAND = 5;
const BETA = 1;
const DRIFT = 8;
// the reference level of each good, and which goods this world priced first itself (not after a reload)
const ref = {};
const fresh = {};

export function price({ good, price, inherited, previous, opening, valley }) {
  if (price == null) {
    fresh[good] = true;
    // a world's first price: the middle of the prices it inherits, the same for every good (2 when it inherits none)
    const all = Object.values(previous ?? {}).filter((p) => p > 0).sort((a, b) => a - b);
    return all.length ? all[Math.floor(all.length / 2)] : (inherited ?? 2);
  }
  if (!opening) return price;
  const v = valley.values;
  const live = valley.avens.filter((a) => a.alive);
  const each = good === 'water' ? v.needWater : v.needFood;
  const need = live.reduce((n, a) => n + (a.need?.[good] ?? each), 0);
  if (!need) return price;
  // how long a new field of this crop takes to grow: the horizon the margin is reckoned over
  const days = Math.max(1, v['ramp_' + good] ?? 7);
  // what's in store, less what rots on the way
  const rot = (v['rot_' + good] ?? 0) / 100;
  const stock = live.reduce((n, a) => n + (a.stock?.[good] ?? 0), 0) * Math.pow(1 - rot, days / 2);
  // last night's harvest, and what the fields still growing into their yield will add once grown
  const harvest = live.reduce((n, a) => n + (a.harvest?.[good] ?? 0), 0);
  const share = (level) => (level === 1 ? 1 : level === 2 ? v.level2 / 100 : v.level3 / 100);
  let growing = 0;
  for (const a of live)
    for (const f of a.fields ?? [])
      if (f.crop === good) growing += (v['cap_' + good] ?? 0) * share(f.level) * (1 - Math.min(1, Math.max(0, (valley.day - f.since) / days)));
  // WATER: the rain barrels too, on average, unless a dry spell is on
  const rain = good === 'water' && !valley.weather?.dry ? (live.length * (v.rainChance / 100) * (1 + v.rainMax)) / 2 : 0;
  // the margin: 1 when the valley holds its days in hand and grows what it needs; below 1 short, above 1 a glut
  const margin = (stock + days * (harvest + growing + rain)) / (days * need + IN_HAND * need);
  const x = Math.min(4, Math.max(0.25, margin));
  // the reference: a world's first price at first; after a reload, today's price as it stands (no jump)
  let r = ref[good] ?? (fresh[good] ? price : price * Math.pow(x, BETA));
  if (margin > 0.25 && margin < 4) r *= Math.exp(-(BETA / (DRIFT * days)) * Math.log(x));
  ref[good] = r;
  return r * Math.pow(x, -BETA);
}
