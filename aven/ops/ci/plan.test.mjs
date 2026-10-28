import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { outputs, plan, unpassed, verdict } from './plan.mjs';

const key = paths => paths.join(',');
const ci = Bun.YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));

test('a JS change runs the page device, the gate, the probes and its suite, and no Rust', () => {
 const p = plan(['maia/content/studio/jobs/jobs.js'], { key });
 expect(p.jobs).toMatchObject({ wasm: true, gate: true, probes: true, rust: false, spec: false, mac: false, browser: false, deny: false });
 expect(p.js.map(e => e.suite)).toContain('studio');
 expect(p.rust).toEqual([]);
 expect(p.images).toEqual([]);
});

test('an avenDB change runs its Rust shards, the spec, theOS on a Mac and the peer\'s image', () => {
 const p = plan(['aven/db/crates/avendb-net/src/sync.rs'], { key });
 expect(p.jobs).toMatchObject({ rust: true, spec: true, mac: true, browser: true, delivery: true });
 expect(p.rust.map(s => s.shard)).toEqual(['core', 'core-properties', 'net', 'server-device']);
 expect(new Set(p.rust.map(s => s.key)).size).toBe(p.rust.length);
 expect(p.images).toEqual(['avendb']);
 // a test file builds no image and starts no Mac
 expect(plan(['aven/db/crates/avendb/tests/all/live.rs'], { key })).toMatchObject({ images: [], jobs: { rust: true, mac: false } });
});

test('the lockfiles start their audits; the daily run is the audits alone; the weekly run is everything', () => {
 expect(plan(['Cargo.lock'], { key }).jobs.deny).toBe(true);
 expect(plan(['aven/api/bun.lock'], { key }).jobs.audit).toBe(true);
 const audit = plan(null, { mode: 'audit', key });
 expect(Object.entries(audit.jobs).filter(([, v]) => v).map(([j]) => j).sort()).toEqual(['audit', 'deny']);
 expect(audit.js).toEqual([]);
 const full = plan(['README.md'], { mode: 'full', key });
 expect(Object.values(full.jobs).every(Boolean)).toBe(true);
 expect(full.images.sort()).toEqual(['api', 'avendb']);
});

test('the JS suites pass together: one verdict of every selected entry\'s key leaves them all out', () => {
 const p = plan(['maia/content/studio/jobs/jobs.js', 'maia/content/assets/vault.js'], { key });
 expect(p.js.length).toBeGreaterThan(1);
 expect(p.keys.js).toMatch(/^pass-js-[0-9a-f]{32}$/);
 expect(unpassed(p, new Set([p.keys.js])).js).toEqual([]);
 expect(unpassed(p, new Set([p.js[0].key])).js).toEqual(p.js);
 expect(outputs(unpassed(p, new Set([p.keys.js])))).toMatchObject({ run_suites: 'false', run_js: 'true' });
});

test('a job folds its checks: it runs when any of them does', () => {
 const lean = outputs(plan(['aven/db/spec/AvenDB/Objective.lean'], { key }));
 expect(lean).toMatchObject({ run_lean: 'true', run_macos: 'true' });
 const audit = outputs(plan(null, { mode: 'audit', key }));
 expect(audit).toMatchObject({ run_js: 'true', run_gate: 'false', run_suites: 'false', run_wasm: 'false', run_macos: 'false', run_proofs: 'false' });
});

test('a key that passed before leaves its job or matrix entry out, unless the run is full', () => {
 const p = plan(['aven/db/crates/avendb-net/src/sync.rs'], { key });
 const passed = new Set([p.keys.spec, p.rust[0].key]);
 const q = unpassed(p, passed);
 expect(q.jobs.spec).toBe(false);
 expect(q.rust.map(s => s.shard)).not.toContain('core');
 expect(q.jobs.rust).toBe(true);
 // every shard passed: no archive to build
 expect(unpassed(p, new Set(p.rust.map(s => s.key))).jobs.rust).toBe(false);
 const full = plan(null, { mode: 'full', key });
 expect(unpassed(full, new Set(Object.values(full.keys)))).toBe(full);
});

test('the plan job declares every output plan.mjs writes, and every job that reads one is a job of ci.yml', () => {
 const out = outputs(plan(['aven/db/crates/avendb-net/src/sync.rs'], { key }));
 const declared = Object.keys(ci.jobs.plan.outputs);
 for (const k of declared) expect(out).toHaveProperty(k);
 const text = readFileSync('.github/workflows/ci.yml', 'utf8');
 for (const m of text.matchAll(/needs\.plan\.outputs\.([a-z_]+)/g)) expect(declared).toContain(m[1]);
});

test('"CI required" needs every job, and passes only when each job the plan named passed', () => {
 const jobs = Object.keys(ci.jobs).filter(j => j !== 'required');
 expect([...ci.jobs.required.needs].sort()).toEqual(jobs.sort());
 const out = outputs(plan(['aven/db/crates/avendb-net/src/sync.rs'], { key }));
 const ran = id => id === 'rust-archive' ? out.run_rust : out[`run_${id.replace(/-/g, '_')}`];
 const needs = Object.fromEntries(jobs.map(id => [id, { result: id === 'plan' || ran(id) === 'true' ? 'success' : 'skipped' }]));
 needs.plan.outputs = out;
 expect(verdict(needs)).toEqual([]);
 for (const id of jobs.filter(j => j !== 'plan' && ran(j) === 'true')) {
  for (const result of ['failure', 'cancelled', 'skipped']) expect(verdict({ ...needs, [id]: { result } })).toHaveLength(1);
 }
 // a job the plan left out may be skipped, never failed
 expect(verdict({ ...needs, lean: { result: 'skipped' } })).toEqual([]);
 expect(verdict({ ...needs, lean: { result: 'failure' } })).toHaveLength(1);
 expect(verdict({ ...needs, plan: { result: 'failure' } })).toEqual(['plan: failure']);
});

test('the release ships only what a green check of this commit\'s files built, and deploys through the shared locks', () => {
 const release = Bun.YAML.parse(readFileSync('.github/workflows/release.yml', 'utf8'));
 const checked = "(needs.ci.result == 'success' || (needs.ci.result == 'skipped' && needs.base.outputs.reuse_ci == 'true'))";
 for (const id of ['device', 'images', 'ops']) expect(release.jobs[id].if).toContain(checked);
 expect(release.jobs.site.if).toContain("needs.device.result == 'success'");
 for (const id of ['api', 'peer']) {
  expect(release.jobs[id].if).toContain("needs.images.result == 'success'");
  expect(release.jobs[id].concurrency).toEqual({ group: 'maia-production-containers', 'cancel-in-progress': false });
 }
 expect(release.jobs.ci.uses).toBe('./.github/workflows/ci.yml');
 expect(release.jobs.ci.if).toBe("needs.base.outputs.reuse_ci != 'true'");
 // an image is promoted by the digest its checked run names, and never built under a tag a release reads
 for (const id of ['avendb', 'api']) expect(ci.jobs.images.steps.find(s => s.id === id).with.tags).toContain(`-${id}:ci-\${{ github.sha }}`);
 expect(JSON.stringify(release.jobs.images.steps)).toContain('imagetools create --tag \\"$IMAGE:$GITHUB_SHA\\" \\"$IMAGE@$DIGEST\\"');
});
