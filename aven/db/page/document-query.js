/** Authorized local inventory for document text and the posts that locate it.
 * The positive types are scheduling hints; the ordinary entry_views operation
 * still checks the acting vault, and no response claims discovery complete.
 * @param {string} vault @param {string} actor */
export const documentQuery = (vault, actor) => ({ op: 'entry_views', vault, as: actor, types: ['story', 'post'] });
