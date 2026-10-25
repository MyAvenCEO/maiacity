/** Article filenames and the cover picker are resolved only within the story vault.
 * Canonical entry_views enforces the current actor's read access; body text has no file-read barrier.
 * @param {string} vault @param {string} actor */
export const storyWritingQuery = (vault, actor) => ({ op: 'entry_views', vault, as: actor, types: ['file'] });
