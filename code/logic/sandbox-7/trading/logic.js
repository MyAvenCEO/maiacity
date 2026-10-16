// Trading: what an aven wants to buy, what it can spare, who meets whom when the market clears, and the price they
// strike
const need = (good, values) => (good === 'water' ? values.needWater : values.needFood);

// a good it doesn't grow: up to its stock target, in days of need (its brain's wants, else the starting target)
export function want({ aven, good, valley }) {
  if (aven.grows.includes(good)) return 0;
  const days = aven.keep?.[good === 'water' ? 'water' : 'food'] ?? aven.reserveDays;
  return Math.max(0, need(good, valley.values) * days - aven.stock[good]);
}

// a good it grows: everything above two days of its own need
export function spare({ aven, good, valley }) {
  if (!aven.grows.includes(good)) return 0;
  return Math.max(0, aven.stock[good] - need(good, valley.values) * 2);
}

// who meets next when the market clears: the cheapest seller and the buyer who pays most (null: the round ends)
export function match({ good, sellers, buyers }) {
  const seller = [...sellers].sort((x, y) => x.price - y.price)[0];
  const buyer = [...buyers].sort((x, y) => y.price - x.price).find((b) => b.id !== seller?.id);
  return seller && buyer ? { seller: seller.id, buyer: buyer.id } : null;
}

// the seller's price when the buyer's limit reaches it; else each gives in up to its own flexibility and, if the gap
// closes, they settle halfway between what each will still accept; null: no deal
export function haggle({ ask, bid, sellerFlex, buyerFlex }) {
  if (ask <= bid) return ask;
  const floor = ask * (1 - sellerFlex);
  const ceiling = bid * (1 + buyerFlex);
  if (floor > ceiling) return null;
  return Math.max(0.01, Math.round(((Math.max(floor, bid) + Math.min(ceiling, ask)) / 2) * 100) / 100);
}
