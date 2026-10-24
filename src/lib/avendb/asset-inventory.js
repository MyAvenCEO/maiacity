/** Read the Assets view entirely from locally held canonical recipe rows.
 * The database projection preserves version/variant history; entry_views supplies
 * reader and file metadata. Neither depends on world, bring or connected peers.
 * @param {{ask:(op:any)=>Promise<any>}} api @param {string} vault */
export async function readAssetInventory(api, vault) {
 const [database, metadata] = await Promise.all([
  api.ask({op:'database', vault, types:['recipe']}),
  api.ask({op:'entry_views', vault, types:['recipe']})
 ]);
 const db = database?.ok, entries = metadata?.ok?.rows;
 if (!db || db.vault !== vault || !Array.isArray(db.rows) || !Array.isArray(entries))
  throw new Error(database?.why || metadata?.why || 'Local recipe inventory is unavailable');
 return {db, entries};
}
