// Harvests: what an aven's land gives each morning, about its capacity: now and then a bad (30-60%) or a rich
// (130-160%) night, and WATER low in a dry spell
export function harvest({ aven, good, capacity, dice, valley }) {
  const v = valley.values;
  if (good === 'water' && valley.weather.dry) {
    return { qty: Math.max(0, Math.round(capacity * Math.max(0, v.dryWells / 100 - 0.15 + dice[1] * 0.3))), kind: 'dry' };
  }
  const swing = v.swing / 100;
  let f, kind;
  if (dice[0] < v.badChance / 100) (f = 0.3 + dice[1] * 0.3), (kind = 'bad');
  else if (dice[0] > 1 - v.richChance / 100) (f = 1.3 + dice[1] * 0.3), (kind = 'rich');
  else (f = 1 - swing + (dice[1] + dice[2]) * swing), (kind = 'normal');
  return { qty: Math.max(0, Math.round(capacity * f)), kind };
}
