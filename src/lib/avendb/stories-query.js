/** Story cards and vault-local workflow definitions share one scoped inventory.
 * @param {string} vault @param {string} actor */
export const storiesQuery = (vault, actor) => ({ op: 'entry_views', vault, as: actor, types: ['story', 'flow'] });
/** The existing seed-city workflow fallback is the only additional trusted scope.
 * @param {string} vault @param {string} actor @param {string|undefined} city */
export const storyFallbackQuery = (vault, actor, city) => city && city !== vault
 ? { op: 'entry_views', vault: city, as: actor, types: ['flow'] }
 : { op: 'entry_views', entries: [], as: actor };
