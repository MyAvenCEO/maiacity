import { expect, test } from 'bun:test';
import { impact } from './impact.mjs';
import { inventory, selected, partition, matrix, keyed, suites } from './test.mjs';
test('a missing comparison or an unknown build input selects all release checks',()=>{
 expect(Object.values(impact(null)).every(Boolean)).toBe(true);
 expect(Object.values(impact(['unexpected-build-input'])).every(Boolean)).toBe(true);
});
test('a browser change requires validation but cannot rebuild the unrelated server',()=>{
 const next=impact(['aven/db/crates/avendb-browser/src/lib.rs']);
 expect(next.avendb && next.browser).toBe(true); expect(next.server).toBe(false);
});
test('cryptographic and vendored transport changes require protocol and browser checks',()=>{
 for(const file of ['aven/db/crates/avendb/src/keys.rs','aven/db/vendor/iroh/src/endpoint.rs','Cargo.lock']) {
  const next=impact([file]); expect(next.protocol && next.browser && next.server).toBe(true);
 }
});
test('proof changes validate Lean without rebuilding runtime binaries',()=>{
 const next=impact(['aven/db/spec/AvenDB/WorldReads.lean']);
 expect(next.avendb).toBe(true);expect(next.server||next.agent||next.browser).toBe(false);
});
test('generated WASM updates both consumers and must be checked',()=>{
 const next=impact(['aven/db/page/device/avendb_browser_bg.wasm']);
 expect(next.site && next.api && next.avendb && next.browser).toBe(true);
});
test('the page\'s op names run the Rust test that holds them to the engine',()=>{
 expect(impact(['aven/db/page/op-names.js']).native).toBe(true);
 expect(impact(['aven/db/page/ops.js']).native).toBe(false);
});
test('no new JS test can silently fall outside CI ownership',()=>{
 expect(()=>inventory(['maia/site/new-component/security.test.js'])).toThrow('Unowned test');
 expect(Object.values(inventory()).flat().length).toBeGreaterThan(160);
});
test('shared build changes select every suite; targeted changes retain security',()=>{
 expect(selected(['bun.lock'])).toContain('assets');
 expect(selected(['bun.lock'])).not.toContain('physics');
 expect(selected(['maia/content/studio/jobs/jobs.js'])).toContain('studio');
 expect(selected(['maia/content/studio/jobs/jobs.js'])).toContain('security');
});

// Keep the proof-to-implementation links reviewable and prevent stale evidence paths.
import { readFileSync, existsSync } from 'node:fs';
test('scheduling contract evidence still exists', () => {
 const { contracts } = JSON.parse(readFileSync('aven/db/spec/contracts.json', 'utf8'));
 for (const contract of contracts) {
  for (const path of [contract.model, contract.implementation, contract.test]) expect(existsSync(path)).toBe(true);
  if (contract.testName) expect(readFileSync(contract.test, 'utf8')).toContain(contract.testName);
 }
});
test('device dependencies select the real browser and cloud agent', () => {
 const next = impact(['aven/db/crates/avendb-device/src/lib.rs']);
 expect(next.browser && next.agent && next.avendb).toBe(true);
});


test('Bun package and container versions follow the pinned toolchain', () => {
 const version = readFileSync('.bun-version','utf8').trim();
 expect(JSON.parse(readFileSync('package.json','utf8')).packageManager).toBe(`bun@${version}`);
 expect(readFileSync('aven/api/Dockerfile','utf8')).toContain(`oven/bun:${version}-alpine`);
});


import { releasedBase } from './release-base.mjs';
test('a queued, superseded, failed or unknown predecessor forces a full release', () => {
 const base='a'.repeat(40);
 expect(releasedBase(base,[{head_sha:base,status:'completed',conclusion:'success'}])).toBe(base);
 for(const run of [null,{head_sha:'b'.repeat(40),status:'completed',conclusion:'success'},{head_sha:base,status:'in_progress',conclusion:null},{head_sha:base,status:'completed',conclusion:'failure'},{head_sha:base,status:'completed',conclusion:'cancelled'}]) {
  expect(releasedBase(base,run?[run]:[])).toBe('');
 }
 expect(releasedBase('0'.repeat(40),[])).toBe('');
});


test('native tests and build helpers validate without publishing unchanged binaries', () => {
 for (const file of ['aven/db/crates/avendb/tests/all/properties.rs','aven/db/crates/avendb-device/tests/agent.rs','aven/db/scripts/test-browser.sh']) {
  const next=impact([file]); expect(next.avendb && next.native).toBe(true); expect(next.server || next.agent).toBe(false);
 }
 expect(impact(['aven/db/crates/avendb/src/lib.rs']).server).toBe(true);
});

test('physics shards cover each owned file exactly once and reject invalid selection', () => {
 const files=inventory().physics;
 const jobs=matrix(['security','ci','physics','assets']);
 const pieces=jobs.filter(j=>j.suite==='physics').map(j=>partition(files,j.shard));
 expect(pieces).toHaveLength(5);
 expect(pieces.every(p=>p.length>0)).toBe(true);
 expect(pieces.flat().sort()).toEqual([...files].sort());
 expect(new Set(pieces.flat()).size).toBe(files.length);
 expect(jobs.filter(j=>j.suite!=='physics')).toEqual([{suite:'assets',shard:'',label:'assets'}]);
 for (const shard of ['0/5','6/5','1/0','1/999','oops']) expect(()=>partition(files,shard)).toThrow();
});

test('JavaScript worker and carrier changes require real browser validation without native publishing', () => {
 for (const file of ['aven/db/page/transports/webtransport.js','aven/db/page/remote.worker.js','aven/db/scripts/avendb-browser-transports.mjs']) {
  const next=impact([file]);
  expect(next.site && next.avendb && next.browser).toBe(true);
  expect(next.server || next.agent || next.native).toBe(false);
 }
});

test('shards are packed by measured time: the longest files first, each to the least loaded shard', () => {
 const files=['a','b','c','d','e'], times={a:10,b:9,c:5,d:4,e:1};
 const pieces=['1/2','2/2'].map(shard=>partition(files,shard,times));
 expect(pieces).toEqual([['a','d','e'],['b','c']]);
 // an unmeasured file counts as the median, and the same files always land the same way
 expect(partition([...files,'new'],'1/2',times)).toEqual(partition([...files,'new'],'1/2',times));
 expect(partition([...files,'new'],'1/2',times).concat(partition([...files,'new'],'2/2',times)).sort()).toEqual([...files,'new'].sort());
});

import { hash } from './passes.mjs';
test('a pass marker follows its files, and a path left out leaves its key alone', () => {
 expect(hash(['aven/db'])).toBe(hash(['aven/db']));
 expect(hash(['aven/db'])).not.toBe(hash(['aven/db/spec']));
 expect(hash(['aven/db','!aven/db/page'])).not.toBe(hash(['aven/db']));
 const keys=keyed(matrix(['physics','assets']));
 expect(new Set(keys.map(k=>k.key)).size).toBe(keys.length);
 expect(keys.every(k=>/^pass-app-[a-z]+-(all|\d+of\d+)-[0-9a-f]{40}$/.test(k.key))).toBe(true);
});

test('a workflow edit selects what that workflow checks; the checks, the release or an unknown one select everything', () => {
 expect(Object.entries(impact(['.github/workflows/ops.yml'])).filter(([,v])=>v)).toEqual([]);
 for (const f of ['.github/workflows/ci.yml','.github/workflows/release.yml','.github/workflows/new.yml','.github/actions/prod-ssh/action.yml'])
  expect(Object.values(impact([f])).every(Boolean)).toBe(true);
 expect(selected(['.github/workflows/ops.yml'])).toEqual(['security','ci']);
 expect(selected(['.github/workflows/ci.yml'])).toContain('assets');
});

test('the server image builds on a PR only when its build reads something new', () => {
 for (const f of ['aven/db/Dockerfile.server','Cargo.lock','Cargo.toml','aven/db/crates/avendb-net/Cargo.toml','aven/db/vendor/iroh/src/lib.rs','aven/db/Dockerfile.server.dockerignore'])
  expect(impact([f]).image).toBe(true);
 for (const f of ['aven/db/crates/avendb-server/src/main.rs','aven/db/crates/avendb/tests/all/properties.rs','aven/db/spec/AvenDB/Wire.lean'])
  expect(impact([f]).image).toBe(false);
});

test('each Playwright image is the Playwright its job drives', () => {
 const version=JSON.parse(readFileSync('package.json','utf8')).devDependencies?.playwright ?? JSON.parse(readFileSync('package.json','utf8')).dependencies.playwright;
 const ci=Bun.YAML.parse(readFileSync('.github/workflows/ci.yml','utf8'));
 expect(ci.jobs.probes.container.image).toBe(`mcr.microsoft.com/playwright:v${version}-noble`);
});
import { reusable } from './reuse.mjs';
function github({ parents = ['p'], tree = 't', headTree = 't', pulls, compare = 'ahead', runs }) {
 const calls = [];
 const api = async path => {
  calls.push(path);
  if (path === 'repos/o/r/commits/m') return { parents: parents.map(sha => ({ sha })), commit: { tree: { sha: tree } } };
  if (path === 'repos/o/r/commits/m/pulls') return pulls ?? [{ number: 7, merged_at: 'x', merge_commit_sha: 'm', head: { sha: 'h', repo: { full_name: 'o/r' } } }];
  if (path === 'repos/o/r/commits/h') return { commit: { tree: { sha: headTree } } };
  if (path === 'repos/o/r/compare/p...h') return { status: compare };
  if (path.startsWith('repos/o/r/actions/runs?head_sha=h')) return { workflow_runs: typeof runs === 'function' ? runs() : runs };
  throw new Error('unexpected ' + path);
 };
 return { api, calls };
}
const run = (path, conclusion = 'success', extra = {}) => ({ id: 1, path: `.github/workflows/${path}`, head_sha: 'h', head_repository: { full_name: 'o/r' }, status: 'completed', conclusion, run_number: 1, run_attempt: 1, ...extra });
const ask = (gh, base = 'p') => reusable({ api: gh.api, repo: 'o/r', sha: 'm', base, wait: 0, sleep: async () => {} });
const none = { ci: false, run: '' };
test('main reuses CI only from a green run on the very files it holds, and names that run',async()=>{
 expect(await ask(github({ runs: [run('ci.yml', 'success', { id: 42 })] }))).toEqual({ ci: true, run: '42' });
 expect(await ask(github({ runs: [run('ci.yml', 'failure')] }))).toEqual(none);
 // another workflow's green run is no evidence
 expect(await ask(github({ runs: [run('ops.yml')] }))).toEqual(none);
 // the latest run decides: a green older run does not cover a red re-run
 expect(await ask(github({ runs: [run('ci.yml'), run('ci.yml', 'failure', { run_number: 2 })] }))).toEqual(none);
 // a fork's run, or a run of another head, is never evidence
 expect(await ask(github({ runs: [run('ci.yml', 'success', { head_repository: { full_name: 'x/r' } })] }))).toEqual(none);
});
test('a goal merge commit onto main with the PR head as second parent reuses its run',async()=>{
 expect((await ask(github({ parents: ['p', 'h'], runs: [run('ci.yml')] }))).ci).toBe(true);
});
test('different files, a stale head, another base or no single pull request run CI on main',async()=>{
 const all = [run('ci.yml')];
 expect(await ask(github({ headTree: 'other', runs: all }))).toEqual(none);
 expect(await ask(github({ compare: 'diverged', runs: all }))).toEqual(none);
 expect(await ask(github({ runs: all }), 'older')).toEqual(none);
 expect(await ask(github({ runs: all }), '')).toEqual(none);
 expect(await ask(github({ parents: ['p', 'q'], runs: all }))).toEqual(none);
 expect(await ask(github({ parents: ['p', 'h', 'q'], runs: all }))).toEqual(none);
 expect(await ask(github({ pulls: [], runs: all }))).toEqual(none);
 expect(await ask(github({ pulls: [{ number: 7, merged_at: 'x', merge_commit_sha: 'm', head: { sha: 'h', repo: { full_name: 'x/r' } } }], runs: all }))).toEqual(none);
});
test('a run still going on the same files is waited for, never taken as passed',async()=>{
 let n = 0;
 const runs = () => [run('ci.yml', n++ < 2 ? null : 'success', { status: n <= 2 ? 'in_progress' : 'completed' })];
 const gh = github({ runs });
 expect(await reusable({ api: gh.api, repo: 'o/r', sha: 'm', base: 'p', wait: 60000, sleep: async () => {} })).toEqual({ ci: true, run: '1' });
 expect(await ask(github({ runs: [run('ci.yml', null, { status: 'in_progress' })] }))).toEqual(none);
});
test('a suite marked off is never selected, not even by its own files or a full run', () => {
 expect(suites.find(s=>s.name==='physics').off).toBeTruthy();
 for (const run of [selected(['maia/content/sandbox-7/shed.ts']), selected(null), selected([], 'all')]) expect(run).not.toContain('physics');
 expect(inventory().physics.length).toBeGreaterThan(0);
});
