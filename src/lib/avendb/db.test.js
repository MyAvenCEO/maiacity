// @ts-nocheck — plain JS
// The studio's tables (./db.js `tables`): every one a schema's, one for each family of the schemas this device holds,
// one for each type no schema held here names, and no catch-all.
// Run: bun test src/lib/avendb/db.test.js
import { expect, test } from 'bun:test';
import { tables } from './db.js';

const hex = (n) => n.toString(16).padEnd(64, '0');
/** a schema of kind `kind`, titled `title`, its fields `more` beside its kind */
const schema = (id, title, kind, more = {}, description) => ({
	id: hex(id),
	title,
	json: JSON.stringify({ title, description, type: 'object', properties: { kind: { const: kind }, ...more }, required: ['kind'] })
});
const lens = (id, from, to) => ({ id: hex(id), title: 'v1 to v2', from: from.id, to: to.id, json: JSON.stringify({ steps: [{ add: 'story' }] }) });

const DOCUMENT = schema(1, 'Markdown document, v1', 'document', { title: { type: 'string' } });
const TODO = schema(2, 'Todo, v1', 'todo', { title: { type: 'string' } }, 'Things to do, each open, doing or done');
const ARTICLE_1 = schema(3, 'Article, v1', 'article', { text: { type: 'string' } });
const ARTICLE_2 = schema(4, 'Article, v2', 'article', { text: { type: 'string' }, story: {} });
const GAME = schema(5, 'Game, v1', 'game', { id: { type: 'string' } });
const SCHEMAS = [DOCUMENT, TODO, ARTICLE_1, ARTICLE_2];
const LENSES = [lens(9, ARTICLE_1, ARTICLE_2)];

/** a row: entry `n`, of type `type`, its record of kind `kind` written under `authored` */
const row = (n, type, kind, authored = [], more = {}) => ({
	entry: hex(100 + n),
	type,
	kind,
	record: kind === 'sealed' ? null : { kind },
	authored: authored.map((s) => s.id),
	audience: hex(50),
	...more
});

/** the studio the tables read: its rows, its schemas and lenses, and which rows the acting vault opens */
const studio = (rows, schemas = SCHEMAS, lenses = LENSES, opens = (r) => r.record !== null) => ({
	rows,
	byWho: [{ words: 'only me', ids: [hex(50)] }],
	opens,
	schemas: new Map(schemas.map((x) => [x.id, x])),
	lenses: new Map(lenses.map((x) => [x.id, x]))
});

const NOTE = row(1, 'note', 'document', [DOCUMENT]);
const TASK = row(2, 'todo', 'todo', [TODO]);
const OLD = row(3, 'article', 'article', [ARTICLE_1]);
const NEW = row(4, 'article', 'article', [ARTICLE_2]);
const PLAY = row(5, 'game', 'game', []);
const VIEW = row(6, 'view', 'view', [schema(7, 'View, v1', 'view')]);
const LANE = { ...row(7, 'schema', 'schema'), record: JSON.parse(GAME.json) };
const SEALED = row(8, null, 'sealed');

/** each table's label and its rows' entries */
const shape = (ts) => ts.map((t) => [t.label, t.rows.map((r) => r.entry)]);

test('one table for each family of schemas, named for it, its hint the schema’s description or its versions', () => {
	const ts = tables(studio([NOTE, TASK]), '');
	expect(shape(ts)).toEqual([
		['Markdown document', [NOTE.entry]],
		['Todo', [TASK.entry]]
	]);
	expect(ts.map((t) => t.id)).toEqual([DOCUMENT.id, TODO.id]);
	expect(ts[0].family?.schemas).toEqual([DOCUMENT]);
	expect(ts[0].hint).toBe('Entries written under Markdown document, v1');
	expect(ts[1].hint).toBe('Things to do, each open, doing or done');
});

test('two versions a lens joins are one table, of the rows written under either', () => {
	const ts = tables(studio([OLD, NEW]), '');
	expect(shape(ts)).toEqual([['Article', [OLD.entry, NEW.entry]]]);
	expect(ts[0].family?.schemas).toEqual([ARTICLE_1, ARTICLE_2]);
	expect(ts[0].family?.lenses).toEqual(LENSES);
	expect(ts[0].hint).toBe('Entries written under Article, v1 or Article, v2, which a lens joins');
	// with no lens between them, each version is a family, a table, of its own: each by its id too, as both are Article
	const apart = tables(studio([OLD, NEW], SCHEMAS, []), '');
	expect(apart.map((t) => t.label)).toEqual(['Article 3000 0000', 'Article 4000 0000']);
	expect(apart.map((t) => t.rows.map((r) => r.entry))).toEqual([[OLD.entry], [NEW.entry]]);
});

test('a row goes to the family of the schema it was written under, else of its kind, else of its type', () => {
	const byKind = row(9, 'note', 'document');
	const byType = { ...row(10, 'todo', 'record'), record: { title: 'no kind' } };
	expect(shape(tables(studio([byKind, byType]), ''))).toEqual([
		['Markdown document', [byKind.entry]],
		['Todo', [byType.entry]]
	]);
});

test('a type no schema held here names gets a table of its own, named for the type; held, its family’s', () => {
	const ts = tables(studio([NOTE, PLAY, VIEW]), '');
	expect(shape(ts)).toEqual([
		['Markdown document', [NOTE.entry]],
		['game', [PLAY.entry]],
		['view', [VIEW.entry]]
	]);
	expect(ts[1]).toMatchObject({ id: 'type:game', family: null });
	expect(ts[1].hint).toStartWith('Schema not held here');
	expect(ts[1].hint).toContain('“game”');
	// once the vault's lane holds the Game schema, its rows are that family's
	const held = tables(studio([NOTE, PLAY], [...SCHEMAS, GAME]), '');
	expect(shape(held)).toEqual([
		['Markdown document', [NOTE.entry]],
		['Game', [PLAY.entry]]
	]);
});

test('schema and lens entries get a table of their type, and what can’t be read is sealed, with no records table ever', () => {
	const ts = tables(studio([NOTE, LANE, SEALED, PLAY, VIEW, TASK]), '');
	expect(shape(ts)).toEqual([
		['Markdown document', [NOTE.entry]],
		['Todo', [TASK.entry]],
		['game', [PLAY.entry]],
		['schema', [LANE.entry]],
		['view', [VIEW.entry]],
		['sealed', [SEALED.entry]]
	]);
	expect(ts.find((t) => t.label === 'schema')?.hint).toContain('The vault’s schemas');
	expect(ts.find((t) => t.id === 'sealed')?.family).toBeNull();
	for (const t of ts) expect([t.id, t.label]).not.toContain('records');
});

test('a row the acting vault doesn’t open is sealed in its type’s table, where it reads its type', () => {
	const hidden = row(11, 'note', 'document', [DOCUMENT]);
	const alone = row(12, 'game', 'game');
	const opens = (r) => r !== hidden && r !== alone && r.record !== null;
	const ts = tables(studio([hidden, NOTE, alone, SEALED], SCHEMAS, LENSES, opens), '');
	expect(shape(ts)).toEqual([
		['Markdown document', [hidden.entry, NOTE.entry]],
		['game', [alone.entry]],
		['sealed', [SEALED.entry]]
	]);
	expect(ts[1].hint).toBe('Entries of type “game” the acting vault doesn’t open, so it can’t tell the schema they were written under');
});

test('only the tables with rows show, of the entries shared alike when asked, and every family’s while none has any', () => {
	const elsewhere = { ...TASK, audience: hex(51) };
	expect(shape(tables(studio([NOTE, elsewhere]), 'only me'))).toEqual([['Markdown document', [NOTE.entry]]]);
	const empty = tables(studio([]), '');
	expect(empty.map((t) => t.label)).toEqual(['Markdown document', 'Todo', 'Article']);
	expect(empty.every((t) => t.family && !t.rows.length)).toBe(true);
});
