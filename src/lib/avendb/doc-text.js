// The text of a document of avenDB's Docs view, as its story holds it and as its doc post shows it (./docs.js,
// ./seed.js `docRecords`, scripts/propose-doc.mjs). Plain functions of the text, with no import, so the seed's drafts
// and every text AIP after them build the post the same way, and a script reads them without a bundler.

/** The line before each further file of a skill, naming its path within the skill. */
export const FILE = (/** @type {string} */ path) => `<!-- file: ${path} -->`;
const FILE_LINE = /^<!-- file: (.+?) -->$/m;

/**
 * A skill's files from its story's text (`text`, as ./docs.js `DOCS` wrote it): SKILL.md, then each file its `FILE`
 * line names.
 * @param {string} text @returns {Record<string, string>}
 */
export function filesOf(text) {
	const parts = text.split(/^(<!-- file: .+? -->)$/m);
	/** @type {Record<string, string>} */
	const files = { 'SKILL.md': `${parts[0].trim()}\n` };
	for (let i = 1; i < parts.length; i += 2) files[FILE_LINE.exec(parts[i])?.[1] ?? `file-${i}.md`] = `${(parts[i + 1] ?? '').trim()}\n`;
	return files;
}

/** A skill's text as a post shows it: its files without their frontmatter, each further one under its path. @param {string} text */
export function readable(text) {
	const drop = (/** @type {string} */ md) => md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
	return Object.entries(filesOf(text))
		.map(([path, md], i) => (i === 0 ? drop(md) : `---\n\n*${path}*\n\n${drop(md)}`))
		.join('\n\n');
}

/**
 * The text of document `key`'s doc post from its story's text: a skill's (`skill/<name>`) readable form, any other
 * doc's the story's text itself.
 * @param {string} key @param {string} text
 */
export const postText = (key, text) => (key.startsWith('skill/') ? readable(text) : text);
