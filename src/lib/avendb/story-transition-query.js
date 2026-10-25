/** Complete local inputs used by a private Story transition: its flow/functions
 * and posts about it. No file or unrelated entry materialization is required.
 * @param {string} vault @param {string} actor */
export const storyTransitionQuery = (vault,actor) => ({op:'entry_views',vault,as:actor,types:['flow','function','post']});
/** Preserve the existing trusted-city fallback, never another peer's authority.
 * @param {string} vault @param {string} actor @param {string|undefined} city */
export const storyTransitionDefaults = (vault,actor,city) => city && city!==vault
 ? {op:'entry_views',vault:city,as:actor,types:['flow','function']}
 : {op:'entry_views',entries:[],as:actor};
/** No public-stage transition may use partial positive discovery: leaving a
 * public stage requires negative evidence about other picture users.
 * @param {any} from @param {any} to @param {string} local @param {string} trusted */
export const privateTransitionReady = (from,to,local,trusted) => !!to && from?.public!==true && to.public!==true && local==='ready' && trusted==='ready';
