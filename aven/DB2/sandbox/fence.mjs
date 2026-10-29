// The fence around avenDB (README, rule 12 and "Names"): nothing here may use v1's code, and the folder is spelled
// `aven/DB2` everywhere code names it. `bun run up --check` runs this first; `bun sandbox/fence.mjs` runs it alone.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const db2 = resolve(import.meta.dirname, '..');
const skip = new Set(['node_modules', 'target', 'runs', 'dist', 'deliverables', '.lake', '.git']);
const text = /\.(rs|toml|js|mjs|ts|svelte|json|lean|yml|yaml|sh|html|css)$|^Dockerfile$/;

const rules = [
	// v1's crates, by name, in a manifest or in Rust
	{ files: /Cargo\.toml$/, pattern: /^\s*avendb(-[a-z]+)?\s*=|path\s*=\s*"[^"]*aven\/db\//m, says: "depends on v1's crates" },
	{ files: /\.rs$/, pattern: /\bavendb(_[a-z]+)?::|\bextern crate avendb/, says: "uses v1's crates" },
	// v1's folder, from code
	{ files: /\.(js|mjs|ts|svelte)$/, pattern: /(from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*aven\/db\//, says: 'imports from v1' },
	// the folder's spelling: a Mac forgives `aven/db2`, Linux and CI don't
	{ files: text, pattern: /aven\/(?!DB2)[dD][bB]2/, says: 'misspells aven/DB2' },
];

export function fence() {
	const problems = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (skip.has(entry.name)) continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (text.test(entry.name) && path !== import.meta.filename) {
				const content = readFileSync(path, 'utf8');
				for (const rule of rules)
					if (rule.files.test(entry.name) && rule.pattern.test(content)) problems.push(`${relative(db2, path)} ${rule.says}`);
			}
		}
	};
	walk(db2);
	return problems;
}

if (import.meta.main) {
	const problems = fence();
	for (const problem of problems) console.error(`avenSANDBOX fence: ${problem}`);
	process.exit(problems.length ? 1 : 0);
}
