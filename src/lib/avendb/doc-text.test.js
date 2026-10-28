// @ts-nocheck — Bun test
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FILE, filesOf, postText, readable } from './doc-text.js';

const SKILLS = join(import.meta.dir, '../../../.claude/skills');

/** A skill's story text as ./docs.js `DOCS` reads it: SKILL.md, then each other Markdown file under its `FILE` line. */
function storyOf(name) {
	const root = join(SKILLS, name);
	const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith('.md') ? [join(dir, f)] : []));
	const rest = walk(root).map((p) => relative(root, p)).filter((p) => p !== 'SKILL.md').sort();
	const head = readFileSync(join(root, 'SKILL.md'), 'utf8').trim();
	return [head, ...rest.map((p) => `${FILE(p)}\n\n${readFileSync(join(root, p), 'utf8').trim()}`)].join('\n\n');
}

/** The lines of `b` that differ from `a`'s, where both have as many lines (a line changed in place), else null. */
function changedLines(a, b) {
	const x = a.split('\n');
	const y = b.split('\n');
	if (x.length !== y.length) return null;
	return x.flatMap((line, i) => (line === y[i] ? [] : [i]));
}

/** `text` with the first line that holds `word` (after the frontmatter) changed in place. */
function changeOne(text, word) {
	const lines = text.split('\n');
	const end = lines.indexOf('---', 1);
	const at = lines.findIndex((l, i) => i > end && l.includes(word));
	expect(at).toBeGreaterThan(end);
	lines[at] = lines[at].replace(word, `${word} (changed)`);
	return lines.join('\n');
}

test('a one-line change of a skill text is a one-line change of its post', () => {
	// asset-producer and actor-skill take the "Actors" → "Characters" text AIPs; cinematographer has further files
	for (const [name, word] of [['asset-producer', 'Actors'], ['actor-skill', 'Actors'], ['cinematographer', 'the']]) {
		const story = storyOf(name);
		const changed = changeOne(story, word);
		expect(changedLines(story, changed)).toHaveLength(1);
		expect(changedLines(postText(`skill/${name}`, story), postText(`skill/${name}`, changed))).toHaveLength(1);
	}
});

test('a one-line change in a further file of a skill is a one-line change of its post', () => {
	const story = storyOf('cinematographer');
	const at = story.indexOf('<!-- file: ');
	expect(at).toBeGreaterThan(0);
	const [head, rest] = [story.slice(0, at), story.slice(at)];
	const lines = rest.split('\n');
	const i = lines.findIndex((l, n) => n > 2 && l.trim() && !l.startsWith('<!--') && !l.startsWith('---'));
	lines[i] = `${lines[i]} (changed)`;
	const changed = head + lines.join('\n');
	expect(changedLines(postText('skill/cinematographer', story), postText('skill/cinematographer', changed))).toHaveLength(1);
});

test("a skill's post is its readable form: no frontmatter, each further file under its path", () => {
	const story = ['---', 'name: demo', 'description: A demo.', '---', '', '# Demo', '', 'One line.', '', FILE('notes/more.md'), '', '# More', '', 'Two.'].join('\n');
	const post = postText('skill/demo', story);
	expect(post).toBe(readable(story));
	expect(post).toBe(['# Demo', '', 'One line.', '', '---', '', '*notes/more.md*', '', '# More', '', 'Two.'].join('\n'));
	expect(post).not.toContain('name: demo');
	expect(filesOf(story)).toEqual({ 'SKILL.md': `${story.split(FILE('notes/more.md'))[0].trim()}\n`, 'notes/more.md': '# More\n\nTwo.\n' });
});

test("any other doc's post is its story's text", () => {
	const text = '---\nnot frontmatter here\n---\n\n# avenDB\n\n<!-- file: kept.md -->\n';
	expect(postText('docs/avendb', text)).toBe(text);
	expect(postText('paper/theos', text)).toBe(text);
});
