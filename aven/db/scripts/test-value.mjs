#!/usr/bin/env node
// What each avenDB test is worth (step T1 of the tests and architecture audit): the lines it alone covers and the
// mutants it alone kills. A test that covers no line and kills no mutant that another test doesn't is a candidate to
// drop or merge; one that alone kills a mutant guards something nothing else does.
//
//   node aven/db/scripts/test-value.mjs --coverage <dir> [--mutants <dir> ...] --out <dir>
//
// --coverage: a folder of `<test id>.lcov` files, one per test, named `<binary id>__<test name>` with ':' as '~'
// (avendb-assurance.yml's coverage job writes them), so each reads as nextest names it: `avendb::engine a_test`.
// --mutants: cargo-mutants output folders (`mutants.out`), one per shard; each mutant's log names the tests that failed.
// Writes test-value.json (every test) and test-value.md (the summary and the candidates) to --out.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

function args(argv) {
	const out = { mutants: [] };
	for (let i = 2; i < argv.length; i += 2) {
		const [k, v] = [argv[i], argv[i + 1]];
		if (k === '--coverage') out.coverage = v;
		else if (k === '--mutants') out.mutants.push(v);
		else if (k === '--out') out.out = v;
		else throw new Error(`unknown argument ${k}`);
	}
	if (!out.coverage || !out.out) throw new Error('usage: --coverage <dir> [--mutants <dir> ...] --out <dir>');
	return out;
}

// The lines one lcov file shows run at least once, as "file:line", our own sources only.
export function coveredLines(lcov) {
	const lines = new Set();
	let file = null;
	for (const row of lcov.split('\n')) {
		if (row.startsWith('SF:')) file = row.slice(3);
		else if (row.startsWith('DA:') && file && file.includes('/aven/db/crates/') && !file.includes('/tests/')) {
			const [line, hits] = row.slice(3).split(',');
			if (Number(hits) > 0) lines.add(`${file.slice(file.indexOf('/aven/db/crates/') + 1)}:${line}`);
		}
	}
	return lines;
}

// The tests a mutant's log names as failed, as nextest prints them: `FAIL [ 0.1s] avendb::engine some_test`.
export function killers(log) {
	const out = new Set();
	for (const m of log.matchAll(/^\s*FAIL \[[^\]]*\]\s+(?:\(\d+\/\d+\)\s+)?(\S+)\s+(\S+)/gm)) out.add(`${m[1]} ${m[2]}`);
	return out;
}

function walk(dir) {
	return readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});
}

// Each caught mutant with the tests that killed it, read from one cargo-mutants output folder.
export function caught(dir) {
	const out = [];
	const outcomes = JSON.parse(readFileSync(join(dir, 'outcomes.json'), 'utf8'));
	for (const o of outcomes.outcomes ?? []) {
		if (o.summary !== 'CaughtMutant' || !o.scenario?.Mutant) continue;
		const m = o.scenario.Mutant;
		const name = `${m.file}:${m.span?.start?.line} ${m.function?.function_name ?? ''} ${m.replacement ?? ''}`;
		const log = o.log_path && existsSync(join(dir, o.log_path)) ? readFileSync(join(dir, o.log_path), 'utf8') : '';
		out.push({ mutant: name, killers: [...killers(log)] });
	}
	return out;
}

export function value(coverage, mutants) {
	const owners = new Map();
	for (const [test, lines] of coverage) for (const l of lines) owners.set(l, (owners.get(l) ?? 0) + 1);
	const tests = new Map([...coverage.keys()].map((t) => [t, { test: t, lines: coverage.get(t).size, uniqueLines: 0, kills: 0, uniqueKills: 0 }]));
	for (const [test, lines] of coverage) for (const l of lines) if (owners.get(l) === 1) tests.get(test).uniqueLines++;
	for (const { killers: ks } of mutants) {
		for (const k of ks) {
			if (!tests.has(k)) tests.set(k, { test: k, lines: 0, uniqueLines: 0, kills: 0, uniqueKills: 0 });
			tests.get(k).kills++;
			if (ks.length === 1) tests.get(k).uniqueKills++;
		}
	}
	return [...tests.values()].sort((a, b) => a.uniqueLines + a.uniqueKills - (b.uniqueLines + b.uniqueKills) || a.test.localeCompare(b.test));
}

function main() {
	const a = args(process.argv);
	const coverage = new Map();
	for (const f of walk(a.coverage).filter((f) => f.endsWith('.lcov'))) coverage.set(basename(f, '.lcov').replaceAll('__', ' ').replaceAll('~', ':'), coveredLines(readFileSync(f, 'utf8')));
	const mutants = a.mutants.flatMap((d) => walk(d).filter((f) => basename(f) === 'outcomes.json').map((f) => caught(join(f, '..')))).flat();
	const rows = value(coverage, mutants);
	const candidates = rows.filter((r) => r.uniqueLines === 0 && r.uniqueKills === 0);
	mkdirSync(a.out, { recursive: true });
	writeFileSync(join(a.out, 'test-value.json'), JSON.stringify({ tests: rows, mutants: mutants.length }, null, '\t'));
	const md = [
		`# avenDB test value`,
		``,
		`${rows.length} tests, ${mutants.length} caught mutants, ${candidates.length} tests that cover no line and kill no mutant that another test doesn't.`,
		``,
		`| Test | Lines | Unique lines | Kills | Unique kills |`,
		`| --- | --- | --- | --- | --- |`,
		...candidates.map((r) => `| ${r.test} | ${r.lines} | 0 | ${r.kills} | 0 |`),
	];
	writeFileSync(join(a.out, 'test-value.md'), md.join('\n') + '\n');
	console.log(md.slice(0, 3).join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
