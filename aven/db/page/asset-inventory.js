/** Read the Assets view entirely from locally held canonical recipe rows.
 * The database projection preserves version/variant history; entry_views supplies
 * reader and file metadata. Neither depends on world, bring or connected peers.
 * A mounted read window keeps recipe discovery active even when no local rows
 * exist yet. Its demand publication never delays this local inventory.
 * @param {{ask:(op:any)=>Promise<any>}} api @param {string} vault
 * @param {{read:(op:any)=>Promise<any>} | null} [window] */
export async function readAssetInventory(api, vault, window = null) {
 const [database, metadata] = await Promise.all([
  (window ? window.read({op:'database', vault, types:['recipe']}) : api.ask({op:'database', vault, types:['recipe']})),
  api.ask({op:'entry_views', vault, types:['recipe']})
 ]);
 const db = database?.ok, entries = metadata?.ok?.rows;
 if (!db || db.vault !== vault || !Array.isArray(db.rows) || !Array.isArray(entries))
  throw new Error(database?.why || metadata?.why || 'Local recipe inventory is unavailable');
 return {db, entries};
}
