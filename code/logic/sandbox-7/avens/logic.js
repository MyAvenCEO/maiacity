// Avens: when the dead come back, and with what (-1: not yet)
export function rebirth({ aven, dead, valley }) {
  return dead >= valley.values.rebirthDays ? valley.values.startHearts : -1;
}
