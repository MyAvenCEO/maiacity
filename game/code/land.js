// @ts-nocheck — plain JS, kept loose on purpose
/**
 * LANDING — what a decision writes into code/. Samuel (2026-10-16): the repo is the truth for what runs until avenDB
 * carries code; an agent's Generated UI view is a draft until the admin keeps it, and it goes live once the PR that
 * writes it into code/ is merged.
 *
 * The landing job (.github/workflows/code-land.yml) reads the kept drafts from the database (deploy/code-export.sh),
 * hands them here with the entries code/ holds, writes the files that come back, and merges them by PR; the API drops
 * each draft that landed (api/src/genui.js). Everything is checked again here by the one checker (./check.js), and an
 * id becomes a path only after it passed its pattern.
 *
 *   landing({ views }, have) -> { files: { path under code/: text }, landed, refused }
 *
 *   views     Generated UI views to keep   { id, title, note, kind, spec }
 */
import { checkCode } from './check.js';
import { canonical, viewToFiles } from './files.js';
import { viewOfEntry } from './index.js';

// one line of plain text (a title in a commit message and a log, where a new line could start a command)
const line = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const prefix = (dir, files) => Object.fromEntries(Object.entries(files).map(([n, t]) => [`${dir}/${n}`, t]));

export function landing(exported, have = {}) {
	const files = {};
	const landed = [];
	const refused = [];
	// Generated UI views to keep: only what passes the one checker with nothing left doing nothing
	for (const raw of exported?.views ?? []) {
		const r = checkCode('view', raw);
		const id = r.ok ? r.value.id : line(raw?.id ?? '?', 48);
		if (!r.ok || r.notes.length) {
			refused.push(`view ${id}: ${line((r.ok ? r.notes : r.errors).join(' '), 400)}`);
			continue;
		}
		const there = have[`views/${id}`];
		if (there && there.for !== 'genui') {
			refused.push(`view ${id}: that id is ${there.for}'s screen`);
			continue;
		}
		// the same view as the repo's, whatever order its keys come in (the database keeps JSON in its own order)
		const was = there ? checkCode('view', viewOfEntry(there), { mode: 'read' }) : null;
		if (was?.ok && canonical(was.value) === canonical(r.value)) continue;
		Object.assign(files, prefix(`views/${id}`, viewToFiles(r.value)));
		landed.push(`View ${id} “${line(r.value.title, 80)}” (Generated UI)${there ? ', changed' : ''}`);
	}
	return { files, landed, refused };
}

