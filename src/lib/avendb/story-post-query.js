/** Posts may reference a story across authorized vaults. Never narrow that relationship to its owner vault.
 * @param {string} actor */
export const storyPostsQuery = actor => ({op:'entry_views',as:actor,types:['post']});
