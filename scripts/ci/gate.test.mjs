import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expected, fires } from './gate.mjs';

test('path filters: globs, negation, paths-ignore, branches', () => {
 expect(fires(undefined, ['a.js'])).toBe(false);
 expect(fires(null, ['a.js'])).toBe(true);
 expect(fires({ types: ['opened'] }, ['a.js'])).toBe(true);
 expect(fires({ paths: ['avendb/**'] }, ['avendb/core/src/lib.rs'])).toBe(true);
 expect(fires({ paths: ['avendb/**'] }, ['src/app.js'])).toBe(false);
 expect(fires({ paths: ['avendb/**', '!avendb/**/*.md'] }, ['avendb/README.md'])).toBe(false);
 expect(fires({ paths: ['src/*.js'] }, ['src/lib/x.js'])).toBe(false);
 expect(fires({ 'paths-ignore': ['docs/**'] }, ['docs/a.md'])).toBe(false);
 expect(fires({ 'paths-ignore': ['docs/**'] }, ['docs/a.md', 'b.js'])).toBe(true);
 expect(fires({ branches: ['release'] }, ['a.js'])).toBe(false);
});

test('expected names the workflows a diff starts, never the gate itself', () => {
 const dir = mkdtempSync(`${tmpdir()}/gate-`);
 writeFileSync(`${dir}/rust.yml`, 'name: Rust\non:\n  pull_request:\n    paths: [avendb/**]\njobs: {}\n');
 writeFileSync(`${dir}/all.yml`, 'name: All\non: [push, pull_request]\njobs: {}\n');
 writeFileSync(`${dir}/main.yml`, 'name: Main\non:\n  push:\n    branches: [main]\njobs: {}\n');
 writeFileSync(`${dir}/gate.yml`, 'name: Batch gate\non: pull_request\njobs: {}\n');
 expect(expected(['src/a.js'], dir).map(w => w.name)).toEqual(['All']);
 expect(expected(['avendb/x.rs'], dir).map(w => w.name).sort()).toEqual(['All', 'Rust']);
});
