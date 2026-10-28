/**
 * The ways to get a material into a store, as remedies, in one order for every module (design/camp.md
 * C2, "what you hold comes first"): first what the holder already has in its other stores (each module
 * says how it draws from one, `fromHeld`), then a delivery, then fetching it (the `provision`
 * contributions: someone walking to a shop …). Buying used, borrowing and making come with the
 * mechanisms that carry them.
 */
import type { EntityId, ReadCtx, Remedy } from '../../kernel/src/index.ts';
import { wordBlock } from '../../parties/src/index.ts';
import { isCounted } from './contract.ts';

/** the holder's other stores that hold the material, nearest to `pos` first (each where it is now: one riding with a unit where the unit is) */
export function heldElsewhere(read: ReadCtx, holder: EntityId, material: string, pos: readonly [number, number], except?: EntityId): { store: EntityId; label: string; qty: number; distance: number }[] {
  const hold = read.port('holdings');
  return (
    hold
      .ofParty(holder, { near: [pos[0], pos[1]], ...(except !== undefined ? { except } : {}) })
      .map((st) => {
        const at = hold.where(st)!;
        return { store: st, label: hold.label(st)!, qty: hold.stock(st, material), distance: Math.hypot(at[0] - pos[0], at[1] - pos[1]) };
      })
      // a residue is not stock
      .filter((h) => h.qty > 1e-6)
  );
}

/** what the holder holds elsewhere, in words: "Camp store, 30 m away: 15 pcs" */
export function heldText(read: ReadCtx, holder: EntityId, material: string, pos: readonly [number, number], except?: EntityId): string {
  const unit = read.port('holdings').material(material).unit;
  return heldElsewhere(read, holder, material, pos, except)
    .map((h) => `${h.label}, ${Math.round(h.distance)} m away: ${+h.qty.toFixed(2)} ${unit}`)
    .join('; ');
}

/**
 * Remedies that bring `qty` of a material into `store`. `fromHeld` turns one of the holder's other
 * stores into the module's own remedy (a work package supplied from it …); without it, held stock
 * is not offered.
 */
export function fillRemedies(read: ReadCtx, store: EntityId, material: string, qty: number, opts: { pos?: readonly [number, number]; fromHeld?: (held: { store: EntityId; label: string; qty: number; distance: number }) => Remedy | null } = {}): Remedy[] {
  const hold = read.port('holdings');
  const holder = hold.holder(store);
  const at = opts.pos ?? hold.where(store);
  const m = hold.material(material);
  const out: Remedy[] = [];
  if (holder !== undefined && at && opts.fromHeld) {
    for (const h of heldElsewhere(read, holder, material, at, store)) {
      const r = opts.fromHeld(h);
      if (r) out.push(r);
    }
  }
  const offer = read.port('trade').offers(material).find((o) => o.delivers);
  // (an order goes only where the holder's word gets out: else what is bought in person, S4)
  if (offer && !(holder !== undefined && wordBlock(read, holder))) {
    const n = Math.max(offer.minOrder, isCounted(m) ? Math.ceil(qty - 1e-9) : qty);
    out.push({ label: `Order ${+n.toFixed(2)} ${m.unit} ${m.label} (${offer.price.toFixed(2)} €/${m.unit}, from ${offer.supplierLabel})`, command: { type: 'inventory.order', payload: { material, qty: n, store, supplier: offer.supplier } } });
  }
  for (const c of read.contributions('provision')) out.push(...c.impl(read, store, material, qty));
  return out;
}
