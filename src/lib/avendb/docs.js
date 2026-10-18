// The documents the repository seeds into the Maia City vault (Samuel 2026-10-18: "each skill can become its own
// story, and the theOS paper as well and the avenDB docs too", all owned by the Maia City COOP and published on the
// website's Docs page; since the same day in avenDB alone, as drafts): each a story, its full text the source of
// truth, and its doc post (`post:doc`, ./posttypes.js), which avenDB's Docs view lists (./Docs.svelte).
//
//   skill   each skill of .claude/skills/<name>/: its SKILL.md first, then each other Markdown file of the skill
//           (references, notes), each after a line that names its path (`FILE`), so the skill can be written back to
//           its files whole (`filesOf`)
//   paper   the theOS paper (docs/theos.md), the words of its page (/theos/) as Markdown, its figures named
//   docs    the avenDB architecture (docs/avendb.md), the words of its page (/docs/avendb/) as Markdown
//
// The two pages stay where they are, with their live figures: their doc posts point at them (`page`). The Markdown of
// both is made from the built pages by scripts/docs-markdown.mjs, again whenever a page changes.

const SKILLS = /** @type {Record<string, () => Promise<string>>} */ (
	import.meta.glob('/.claude/skills/*/**/*.md', { query: '?raw', import: 'default' })
);
const PAGES = /** @type {Record<string, () => Promise<string>>} */ (
	import.meta.glob('/docs/*.md', { query: '?raw', import: 'default' })
);

/** The line before each further file of a skill, naming its path within the skill. */
export const FILE = (/** @type {string} */ path) => `<!-- file: ${path} -->`;
const FILE_LINE = /^<!-- file: (.+?) -->$/m;

/**
 * @typedef {{ key: string, section: 'skill' | 'paper' | 'architecture', slug: string, title: string, excerpt: string,
 *   page: string, read: () => Promise<string> }} Doc
 * (a skill's title and excerpt are its frontmatter's `name` and `description`, read with its text)
 */

/** The skills, by folder: their files, SKILL.md first, then the others by path. */
function skills() {
	/** @type {Record<string, string[]>} */
	const by = {};
	for (const path of Object.keys(SKILLS)) {
		const [, name] = /^\/\.claude\/skills\/([^/]+)\//.exec(path) ?? [];
		if (name) (by[name] ??= []).push(path);
	}
	return Object.entries(by)
		.sort(([a], [b]) => a.localeCompare(b))
		.filter(([name, paths]) => paths.includes(`/.claude/skills/${name}/SKILL.md`))
		.map(([name, paths]) => {
			const root = `/.claude/skills/${name}/`;
			const rest = paths.filter((p) => p !== `${root}SKILL.md`).sort();
			/** @type {Doc} */
			const doc = {
				key: `skill/${name}`,
				section: 'skill',
				slug: name,
				title: name,
				excerpt: '',
				page: '',
				read: async () => {
					const head = await SKILLS[`${root}SKILL.md`]();
					const more = await Promise.all(rest.map(async (p) => `${FILE(p.slice(root.length))}\n\n${(await SKILLS[p]()).trim()}`));
					return [head.trim(), ...more].join('\n\n');
				}
			};
			return doc;
		});
}

/** The pages of the site written down as Markdown: the theOS paper and the avenDB architecture. @returns {Doc[]} */
function pages() {
	/** @type {Doc[]} */
	const all = [
		{
			key: 'paper/theos',
			section: 'paper',
			slug: 'theos',
			title: 'theOS',
			excerpt:
				'The civilization scale operating system of Abundism: a macroeconomic and system-engineering framework for a post-labour economy, with HEARTS as the unit of account, liquidity owned by the City COOP, and a floor where no one starves and no one has to work to survive.',
			page: '/theos/',
			read: async () => ''
		},
		{
			key: 'docs/avendb',
			section: 'architecture',
			slug: 'avendb',
			title: 'avenDB',
			excerpt:
				'The user-owned, local-first, post-quantum database under maiaCITY: what the server can and cannot see, vaults, CRDT entries with history, shares, schemas and lenses, sync between your devices, and terabytes of media backed up to a sealed bucket.',
			page: '/docs/avendb/',
			read: async () => ''
		}
	];
	return all
		.filter((d) => PAGES[`/docs/${d.slug}.md`])
		.map((d) => ({ ...d, read: async () => (await PAGES[`/docs/${d.slug}.md`]()).trim() }));
}

/** Every document the repository seeds, the pages first, then the skills by name. */
export const DOCS = [...pages(), ...skills()];

/**
 * A skill's files from its story's text (`text`, as `DOCS` wrote it): SKILL.md, then each file its `FILE` line names.
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
