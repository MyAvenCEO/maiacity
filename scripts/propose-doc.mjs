#!/usr/bin/env node
// One of the repository's documents (src/lib/avendb/docs.js `DOCS`: a skill), proposed into the Maia City vault as an
// AIP by this Mac's agent (the device of avenMAIA Claude Code starts as its MCP server: `avendb-device agent claude`).
// A document goes into the vault only so (Samuel 2026-10-20: a new doc goes in as a proposal; the seed writes none).
// It finds the doc post by its `doc:<key>` tag and the story it names.
// None yet: it drafts both (`create` with `draft: true`, the records of src/lib/avendb/seed.js `docRecords`, the post
// naming the story drafted), each its own line. One there: it starts a proposal on each whose text differs (`propose`,
// or the same day's line a failed run left with no AIP over it) and sets the new text on that line (`set` at `text`,
// through the record's own schema, as the app edits it). Either way it opens one AIP over the lines (`aip_open`).
// An owner then puts it forward ("Propose it") and accepts it in the Proposals app (/app/aips/); the accept merges the
// lines into main. Without --run it only says what it would do.
// With --text <file>, that file's text is the new text instead of the repository's: for a doc only the vault holds, as
// the avenDB doc (`docs/avendb`), which then needs no entry in `DOCS`; drafting a new doc still takes the repository's.
// The AIP's objective, in Lean against AvenDB.Objective: every line holds the new text, read back off it once set.
//
//   node scripts/propose-doc.mjs skill/editor [--run] [--title <AIP title>] [--note <AIP note>] [--device <path>]
//   node scripts/propose-doc.mjs docs/avendb --text <file> [--run] [--title <AIP title>] [--note <AIP note>]
//
// The agent device is the one ~/.claude.json starts as the `avendb` MCP server, else `--device` or AVENDB_DEVICE.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const flag = (/** @type {string} */ f) => args.includes(f);
const option = (/** @type {string} */ f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const valued = ['--device', '--title', '--note', '--text'];
const key = args.find((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]));
if (!key) {
	console.error('usage: node scripts/propose-doc.mjs <doc key, e.g. skill/editor> [--run] [--title <t>] [--note <n>] [--device <avendb-device>]');
	process.exit(2);
}

/** the agent device Claude Code starts as its `avendb` MCP server, as ~/.claude.json names it */
function device() {
	const named = option('--device') ?? process.env.AVENDB_DEVICE;
	if (named) return { command: named, args: ['agent', 'claude'] };
	try {
		const conf = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
		const s = conf.mcpServers?.avendb;
		if (s?.command) return { command: s.command, args: s.args ?? [] };
	} catch {
		// no Claude Code config here
	}
	throw new Error('no agent device: give --device <The OS app’s avendb-device>, or add it to Claude Code (claude mcp add --scope user avendb -- <avendb-device> agent claude)');
}

/** an MCP session with the agent device on its stdio: `call(tool, args)` answers its tool's text, read as JSON */
function session({ command, args }) {
	const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
	const waiting = new Map();
	let n = 0;
	createInterface({ input: child.stdout }).on('line', (line) => {
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		const w = waiting.get(msg.id);
		if (!w) return;
		waiting.delete(msg.id);
		if (msg.error) w.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
		else w.resolve(msg.result);
	});
	child.on('exit', (code) => {
		for (const w of waiting.values()) w.reject(new Error(`the agent device ended (${code})`));
		waiting.clear();
	});
	const send = (/** @type {string} */ method, /** @type {any} */ params) =>
		new Promise((resolve, reject) => {
			const at = ++n;
			waiting.set(at, { resolve, reject });
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: at, method, params })}\n`);
		});
	return {
		async open() {
			await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'propose-doc', version: '1' } });
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
		},
		/** @param {string} name @param {any} a */
		async call(name, a) {
			const r = /** @type {any} */ (await send('tools/call', { name, arguments: a }));
			const text = (r?.content ?? []).map((/** @type {any} */ c) => c.text ?? '').join('');
			if (r?.isError) throw new Error(`${name}: ${text}`);
			let got;
			try {
				got = JSON.parse(text);
			} catch {
				return text;
			}
			// an op answers {ok} or why it was refused
			if (name === 'avendb_vaults') return got;
			if (got && typeof got === 'object' && 'ok' in got) return got.ok;
			throw new Error(`${name} ${a.op?.op ?? ''}: ${text.slice(0, 600)}`);
		},
		/** @param {boolean} [done] whether the run got through: if not, the device is stopped, not waited for */
		close(done = true) {
			child.stdin.end();
			if (!done) child.kill();
		}
	};
}

const textFile = option('--text');
/** @type {any} */
let doc;
let story = '';
let post = '';
let tag = '';
/** @type {any} */
let records = null;
if (textFile) {
	// a doc the vault alone holds: its story and its post both take the file's text, as the Docs view shows the story's
	story = readFileSync(textFile, 'utf8');
	post = story;
	tag = `doc:${key}`;
	doc = { title: /^# (.+)$/m.exec(story)?.[1]?.trim() ?? key, section: 'doc' };
} else {
	const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
	try {
		const { DOCS, readable } = await server.ssrLoadModule('/src/lib/avendb/docs.js');
		const { docTag, docRecords } = await server.ssrLoadModule('/src/lib/avendb/seed.js');
		doc = DOCS.find((/** @type {any} */ d) => d.key === key);
		if (!doc) throw new Error(`no document ${key}: one of ${DOCS.map((/** @type {any} */ d) => d.key).join(', ')}`);
		// as docRecords drafts them: the story holds the text, the doc post its readable form
		story = await doc.read();
		post = doc.section === 'skill' ? readable(story) : story;
		tag = docTag(key);
		records = await docRecords(key);
	} finally {
		await server.close();
	}
}
if (!story.trim()) {
	console.error(`${key} has no text in the repository: nothing to propose`);
	process.exit(1);
}
const title = option('--title') ?? (textFile ? `${doc.title} doc: a new text (${key})` : `${doc.title} doc: the repository's text (${key})`);
const note = option('--note') ?? (textFile ? `A new text of ${key}, from ${textFile}.` : `The text of ${key} as the repository has it now, so the vault's copy says what its files say.`);
const newTitle = option('--title') ?? `${doc.title} doc, new (${key})`;
const newNote = option('--note') ?? `${doc.title} as a new doc of Maia City: its story with the repository's text, and its doc post, a draft, which avenDB's Docs view lists.`;
console.error(`${key}: ${story.length.toLocaleString('en')} characters, the doc post tagged ${tag} and its story`);
console.error(`AIP: ${title}`);
if (!flag('--run')) {
	console.error('Without --run nothing is written. With it: find the doc post and its story in Maia City, propose the new text on each that differs (or draft both, if Maia City holds none), open the AIP.');
	process.exit(0);
}

const agent = session(device());
let done = false;
try {
	await agent.open();
	const me = await agent.call('avendb_vaults', {});
	const city = (me.vaults ?? []).find((/** @type {any} */ x) => x.name === 'Maia City');
	if (!city) throw new Error(`this agent sees no Maia City: ${typeof me === 'string' ? me : JSON.stringify(me).slice(0, 400)}`);
	const where = { all: [{ type: ['post'] }, { tag }] };
	const found = await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where, select: ['text', 'story'] } });
	const posts = (found.rows ?? []).filter((/** @type {any} */ r) => !(r.tags ?? []).includes('avendb:deleted'));
	if (!posts.length) {
		if (!records) throw new Error(`Maia City holds no doc post tagged ${tag}: drafting a new doc takes the repository's text, never --text`);
		const drafted = await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } });
		const open = drafted.filter((/** @type {any} */ a) => ['idea', 'objective', 'proposed'].includes(a.stage) && !a.outcome && a.title === newTitle);
		if (open.length && !flag('--again')) throw new Error(`an AIP drafting ${key} is open already (${open.map((/** @type {any} */ a) => a.entry).join(', ')}): nothing was written (--again drafts it all the same)`);
		const storyDraft = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, draft: true, ...records.story } });
		const value = { ...records.post.value, story: { vault: city.id, entry: storyDraft.entry } };
		const postDraft = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, draft: true, ...records.post, value } });
		const proposals = [storyDraft, postDraft].map((d) => ({ entry: d.entry, line: d.line }));
		const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title: newTitle, note: newNote, proposals } });
		console.log(JSON.stringify({ vault: city.id, proposals, aip }, null, 2));
		console.error(`Opened. An owner puts it forward ("Propose it") and accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
		done = true;
		agent.close();
		process.exit(0);
	}
	if (posts.length !== 1) throw new Error(`Maia City holds ${posts.length} doc posts tagged ${tag} (${posts.map((/** @type {any} */ r) => r.entry).join(', ')}): one is proposed to, so nothing was written`);
	const [p] = posts;
	const at = p.record?.story?.entry;
	if (!at || p.record?.story?.vault !== city.id) throw new Error(`the doc post ${p.entry} names no story of Maia City: nothing was written`);
	const s = await agent.call('avendb_ask', { op: { op: 'get', entry: at } });
	const targets = [
		{ entry: at, now: s.record?.text, text: story },
		{ entry: p.entry, now: p.record?.text, text: post }
	].filter((t) => t.now !== t.text);
	if (!targets.length) {
		console.error(`Maia City's ${key} already holds the repository's text: nothing to propose`);
		agent.close();
		process.exit(0);
	}
	const entries = new Set(targets.map((t) => t.entry));
	const aips = await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } });
	const open = aips.filter(
		(/** @type {any} */ a) => !a.bare && ['idea', 'objective', 'proposed'].includes(a.stage) && !a.outcome && (a.lines ?? []).some((/** @type {any} */ l) => entries.has(l.entry))
	);
	if (open.length && !flag('--again')) throw new Error(`an AIP over ${key} is open already (${open.map((/** @type {any} */ a) => `${a.title} ${a.entry}`).join('; ')}): nothing was written (--again proposes all the same)`);
	const name = `text ${new Date().toISOString().slice(0, 10)}`;
	// a line of today's name no AIP names yet: a run that failed before its AIP left it, and this one goes on with it
	const left = new Map(
		aips
			.filter((/** @type {any} */ a) => a.bare)
			.flatMap((/** @type {any} */ a) => a.lines ?? [])
			.filter((/** @type {any} */ l) => entries.has(l.entry) && l.name === name && !l.merged)
			.map((/** @type {any} */ l) => [l.entry, l.line])
	);
	const proposals = [];
	for (const t of targets) {
		const line = left.get(t.entry) ?? (await agent.call('avendb_run', { op: { op: 'propose', entry: t.entry, name } })).line;
		if (!line) throw new Error(`the proposal on ${t.entry} started no line`);
		await agent.call('avendb_run', { op: { op: 'set', entry: t.entry, line, path: ['text'], value: t.text } });
		proposals.push({ entry: t.entry, line, text: t.text });
	}
	// its objective: each line holds the new text, as read back off the line
	const objective = [
		'import AvenDB.Objective',
		'open AvenDB.Objective',
		'',
		`/-- Every entry of ${key} this AIP changes holds the new text on its line. -/`,
		`def holding : Metric := metric "Lines holding the new text of ${key}" (equals (reading "lines") ${proposals.length})`,
		'',
		'def objective : List Metric := [holding]',
		''
	].join('\n');
	const lines = proposals.map(({ entry, line }) => ({ entry, line }));
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note, proposals: lines, objective } });
	let holding = 0;
	for (const p of proposals) {
		const got = await agent.call('avendb_ask', { op: { op: 'get', entry: p.entry, line: p.line } });
		if (got.record?.text === p.text) holding++;
	}
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'lines', value: 0, note: 'main, before this AIP' } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'lines', value: holding, note: 'each line read back after its text was set' } });
	if (holding !== proposals.length) console.error(`only ${holding} of ${proposals.length} lines read back the new text: look at the AIP before it is proposed`);
	console.log(JSON.stringify({ vault: city.id, proposals: lines, aip }, null, 2));
	console.error(`Opened. An owner puts it forward ("Propose it") and accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
	done = true;
} finally {
	agent.close(done);
}
