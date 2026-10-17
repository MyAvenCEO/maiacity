// The post types of the Maia City vault (Samuel 2026-10-17): there are only stories, and the posts drawn from them.
// A story is the single source of truth, its full written text the base; each post is one way it goes out, of one
// post type, and links the story it came from (`story`). A post type is a schema of the vault's own, "Post: <name>,
// v1": the fields its posts hold, beside a post's own (a title, a text, the story, the day it went out), and its
// template, the Markdown a writer or an agent fills in from the story (`x-template`). Changing a type's fields or its
// template is a new version of its schema, by proposal, like any other change of the vault.
//
// Its posts are entries of type `post`, of the record kind `post:<type>` and tagged `post:<type>`, so the Maia
// Universe stream lists them all, and a page lays each out by its type (./../universe/inspire.js for `inspire`).

/** The tag, and the record's kind, of a post of type `type`. @param {string} type */
export const postTag = (type) => `post:${type}`;

/** The fields every post holds, whatever its type. */
const POST = {
	title: { type: 'string', maxLength: 300, default: '' },
	text: { type: 'string', 'x-loro': 'text', default: '' },
	story: { 'x-link': 'newest' },
	channel: { type: 'string', maxLength: 80, default: '' },
	published: { type: 'string', maxLength: 32 },
	tags: { type: 'array', items: { type: 'string' }, default: [] }
};

/** A post's own language, and the line a preview card shows under its title. */
const WORDS = {
	excerpt: { type: 'string', maxLength: 2000 },
	language: { type: 'string', maxLength: 16 }
};

/**
 * The post types the repository seeds: each one's name (its tag's), its channel on the Maia Universe stream, the file
 * of its template, and its own fields.
 * @type {Record<string, { channel: string, template: string, fields: Record<string, any> }>}
 */
export const POST_TYPES = {
	journal: { channel: 'Journal', template: '/blog/TEMPLATE.md', fields: { ...WORDS } },
	inspire: {
		channel: 'Inspire me',
		template: '/inspire-me/FORMAT.md',
		fields: {
			...WORDS,
			quote: { type: 'object', properties: { text: { type: 'string' }, by: { type: 'string' } } }
		}
	}
};

/** The title of post type `type`'s schema. @param {string} type */
export const postTypeTitle = (type) => `Post: ${POST_TYPES[type]?.channel ?? type}, v1`;

/**
 * Post type `type`'s schema, as the vault holds it, with its template `template` (Markdown).
 * @param {string} type @param {string} template
 */
export function postTypeSchema(type, template) {
	const t = POST_TYPES[type];
	return JSON.stringify({
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		title: postTypeTitle(type),
		type: 'object',
		'x-post-type': type,
		'x-template': template,
		properties: { kind: { const: postTag(type) }, ...POST, ...t.fields },
		required: ['kind', 'story']
	});
}
