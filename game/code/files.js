// @ts-nocheck — plain JS, kept loose on purpose
/**
 * CODE ENTRIES AS FILES — how what we keep in code/ is written as files and read back, one way for every kind, so the
 * later move to avenDB is a copy (each folder with an entry.json is one entry; its other files are its files):
 *
 *   views/<id>/                        a view: entry.json, view.html or a2ui.json, data.json, input.json, logic.js
 *   logic/sandbox-7/<card>/            a rule card's default code: entry.json, logic.js
 *   configs/sandbox-7/<id>/v<n>/       one version of a Sandbox 7 config: entry.json, cards.json, a file a card's code
 *   mips/sandbox-7/<number>/           an accepted MIP as it landed: entry.json, cards.json, a file a card's code
 *
 * Cards keep their code in a file of its own (<card id>.js, or .html for a view card), named in cards.json by `file`,
 * so a PR shows a rule's change as code, not as an escaped string. Nothing here touches a disk: scripts/code-index.mjs
 * and scripts/code-land.mjs read and write, game/code/land.js decides what to write.
 */

/** JSON as we write it into code/: tabs, a closing newline */
export const jsonFile = (v) => `${JSON.stringify(v, null, '\t')}\n`;

/** JSON with its keys in order, so the same entry always hashes the same */
export const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));

/** cards as files: cards.json (each card without its code; `file` names the file that holds it) and one file a code */
export function cardsToFiles(cards) {
	const files = {};
	const list = (cards ?? []).map((c) => {
		const { code, ...rest } = c;
		if (typeof code !== 'string' || !code.trim()) return rest;
		const file = `${c.id}.${c.kind === 'view' ? 'html' : 'js'}`;
		files[file] = code;
		return { ...rest, file };
	});
	files['cards.json'] = jsonFile(list);
	return files;
}

/** cards read back from their files, each with its code (empty where it has none: its rules' default runs) */
export function cardsOfFiles(files) {
	return JSON.parse(files['cards.json'] ?? '[]').map(({ file, ...c }) => ({ ...c, code: file ? (files[file] ?? '') : '' }));
}

/** a Generated UI view (as the one checker keeps it) as an entry and its files; viewOfEntry (./index.js) reads it back */
export function viewToFiles(v, place = 'genui') {
	const { data, input, logic, ...rest } = v.spec ?? {};
	const entry = { type: 'view', for: place, title: v.title, ...(v.note ? { note: v.note } : {}), kind: v.kind };
	const files = {};
	if (v.kind === 'a2ui') files['a2ui.json'] = jsonFile(rest);
	else {
		entry.libs = rest.libs ?? [];
		entry.height = rest.height ?? 420;
		files['view.html'] = rest.html ?? '';
	}
	if (data && Object.keys(data).length) files['data.json'] = jsonFile(data);
	if (input && Object.keys(input).length) files['input.json'] = jsonFile(input);
	if (logic) files['logic.js'] = logic;
	files['entry.json'] = jsonFile(entry);
	return files;
}

/**
 * Every entry in a set of files ({ 'views/x/entry.json': text, ... }, paths relative to code/): { ref: { ref, ...entry,
 * files, hash } }, `hash` from `hashOf(canonical text)` when given. A folder with an entry.json is one entry; its
 * other files are its files (none of them an entry's own folder).
 */
export function entriesOfFiles(all, hashOf = null) {
	const out = {};
	for (const path of Object.keys(all).sort()) {
		if (!path.endsWith('/entry.json')) continue;
		const ref = path.slice(0, -'/entry.json'.length);
		const entry = JSON.parse(all[path]);
		const files = {};
		for (const p of Object.keys(all).sort()) {
			const name = p.slice(ref.length + 1);
			if (p.startsWith(`${ref}/`) && name !== 'entry.json' && !name.includes('/')) files[name] = all[p];
		}
		out[ref] = { ref, ...entry, files, ...(hashOf ? { hash: hashOf(canonical({ entry, files })) } : {}) };
	}
	return out;
}
