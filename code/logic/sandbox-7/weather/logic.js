// Weather, valley-wide, each night: now and then a dry spell begins (wells run low, no rain); otherwise some nights
// it rains and every land's barrel catches a little WATER
export function weather({ weather, day, dice, valley }) {
  const v = valley.values;
  const w = { ...weather };
  if (w.dry) w.dry -= 1;
  else if (dice[0] < v.dryChance / 100) {
    const lo = Math.min(v.dryMin, v.dryMax);
    w.dry = lo + Math.floor(dice[1] * (Math.max(v.dryMin, v.dryMax) - lo + 1));
    w.dryFrom = day;
  }
  w.rain = !w.dry && v.rainMax > 0 && dice[2] < v.rainChance / 100 ? 1 + Math.floor(dice[3] * v.rainMax) : 0;
  return w;
}
