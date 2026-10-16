// Rot: the units of a good that rot tonight in an aven's store (a share of it, the remainder by chance)
export function rot({ aven, good, dice, valley }) {
  const held = aven.stock[good];
  const x = held * (valley.values['rot_' + good] / 100);
  return Math.min(held, Math.floor(x) + (dice[0] < x % 1 ? 1 : 0));
}
