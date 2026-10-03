/*
 * THE FILM CREW'S SKILLS — every skill of the story producer's crew (.claude/skills/<skill>/), read as they are in the
 * repository when the site is built, for the Skills wiki (/app/skills/). A skill is its SKILL.md (its name, its
 * description, its laws) and its sub-skills, one file each. The crew and its order are below; a new crew skill is a
 * folder in .claude/skills and a line here.
 */

const files = import.meta.glob('/.claude/skills/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The crew in the order a film is made: the producer, the story, the picture, the post, the posts. */
export const CREW: { group: string; note: string; skills: string[] }[] = [
	{ group: 'Producer', note: 'the laws, the order of work, the pipeline', skills: ['story-producer'] },
	{ group: 'Story', note: 'what it is about and why they stay', skills: ['storyteller', 'hook-writer'] },
	{ group: 'Picture', note: 'what is in front of the camera, and how it is seen', skills: ['director', 'cinematographer', 'gaffer', 'neewer-cb60', 'production-designer'] },
	{ group: 'Post', note: 'the cut, the grade, the sound', skills: ['editor', 'colorist', 'sound-designer'] },
	{ group: 'Out', note: 'one day, every platform', skills: ['content-derivatives', 'delivery'] }
];

export type Heading = { level: 2 | 3; text: string; id: string };
export type Doc = {
	/** the file's name in its skill folder: SKILL.md, scenes.md … */
	file: string;
	/** its first heading */
	title: string;
	/** the markdown after the frontmatter */
	body: string;
	headings: Heading[];
	lines: number;
	words: number;
};
export type Skill = {
	id: string;
	group: string;
	/** the frontmatter's name and description */
	name: string;
	description: string;
	/** SKILL.md first, then its sub-skills in the order its table names them */
	docs: Doc[];
};

export const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[`*_]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

function frontmatter(raw: string): { meta: Record<string, string>; body: string } {
	const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
	if (!m) return { meta: {}, body: raw };
	const meta: Record<string, string> = {};
	for (const line of m[1]!.split('\n')) {
		const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
		if (kv) meta[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, '');
	}
	return { meta, body: raw.slice(m[0].length) };
}

function docOf(file: string, raw: string): Doc {
	const { body } = frontmatter(raw);
	const headings: Heading[] = [];
	let fence = false;
	for (const line of body.split('\n')) {
		if (line.startsWith('```')) fence = !fence;
		if (fence) continue;
		const h = /^(##|###) (.+)$/.exec(line);
		if (h) headings.push({ level: h[1]!.length as 2 | 3, text: h[2]!.replace(/`/g, ''), id: slug(h[2]!) });
	}
	return {
		file,
		title: /^# (.+)$/m.exec(body)?.[1]?.trim() ?? file,
		body,
		headings,
		lines: raw.split('\n').length,
		words: body.split(/\s+/).filter(Boolean).length
	};
}

function skillOf(id: string, group: string): Skill | null {
	const mine = Object.entries(files).filter(([path]) => path.startsWith(`/.claude/skills/${id}/`));
	const main = mine.find(([path]) => path.endsWith('/SKILL.md'));
	if (!main) return null;
	const { meta } = frontmatter(main[1]);
	const skillDoc = docOf('SKILL.md', main[1]);
	// the sub-skills in the order SKILL.md names them, then any it doesn't
	const named = [...main[1].matchAll(/`([a-z0-9-]+\.md)`/g)].map((m) => m[1]!);
	const rank = (f: string) => (named.includes(f) ? named.indexOf(f) : 999);
	const subs = mine
		.filter(([path]) => !path.endsWith('/SKILL.md'))
		.map(([path, raw]) => docOf(path.split('/').pop()!, raw))
		.sort((a, b) => rank(a.file) - rank(b.file) || a.file.localeCompare(b.file));
	return { id, group, name: meta.name ?? id, description: meta.description ?? '', docs: [skillDoc, ...subs] };
}

export const SKILLS: Skill[] = CREW.flatMap(({ group, skills }) => skills.map((id) => skillOf(id, group)).filter((s): s is Skill => !!s));

export const skillById = (id: string) => SKILLS.find((s) => s.id === id);
