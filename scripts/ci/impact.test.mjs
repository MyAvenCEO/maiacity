import { expect, test } from 'bun:test';
import { impact } from './impact.mjs';
import { inventory, selected } from './test.mjs';
test('a missing comparison or an unknown build input selects all release checks',()=>{
 expect(Object.values(impact(null)).every(Boolean)).toBe(true);
 expect(Object.values(impact(['unexpected-build-input'])).every(Boolean)).toBe(true);
});
test('a browser change requires validation but cannot rebuild the unrelated server',()=>{
 const next=impact(['avendb/crates/avendb-browser/src/lib.rs']);
 expect(next.avendb && next.browser).toBe(true); expect(next.server).toBe(false);
});
test('cryptographic and vendored transport changes require protocol and browser checks',()=>{
 for(const file of ['avendb/crates/avendb/src/keys.rs','avendb/vendor/iroh/src/endpoint.rs','avendb/Cargo.lock']) {
  const next=impact([file]); expect(next.protocol && next.browser && next.server).toBe(true);
 }
});
test('proof changes validate Lean without rebuilding runtime binaries',()=>{
 const next=impact(['avendb/spec/AvenDB/WorldReads.lean']);
 expect(next.avendb).toBe(true);expect(next.server||next.agent||next.browser).toBe(false);
});
test('generated WASM updates both consumers and must be checked',()=>{
 const next=impact(['src/lib/avendb/device/avendb_browser_bg.wasm']);
 expect(next.site && next.api && next.avendb && next.browser).toBe(true);
});
test('no new JS test can silently fall outside CI ownership',()=>{
 expect(()=>inventory(['src/new-component/security.test.js'])).toThrow('Unowned test');
 expect(Object.values(inventory()).flat().length).toBeGreaterThan(160);
});
test('shared build changes select every suite; targeted changes retain security',()=>{
 expect(selected(['bun.lock'])).toContain('physics');
 expect(selected(['src/lib/studio/jobs/jobs.js'])).toContain('studio');
 expect(selected(['src/lib/studio/jobs/jobs.js'])).toContain('security');
});

// Keep the proof-to-implementation links reviewable and prevent stale evidence paths.
import { readFileSync, existsSync } from 'node:fs';
test('scheduling contract evidence still exists', () => {
 const { contracts } = JSON.parse(readFileSync('avendb/spec/contracts.json', 'utf8'));
 for (const contract of contracts) {
  for (const path of [contract.model, contract.implementation, contract.test]) expect(existsSync(path)).toBe(true);
  if (contract.testName) expect(readFileSync(contract.test, 'utf8')).toContain(contract.testName);
 }
});
test('device dependencies select the real browser and cloud agent', () => {
 const next = impact(['avendb/crates/avendb-device/src/lib.rs']);
 expect(next.browser && next.agent && next.avendb).toBe(true);
});

import { spawnSync } from 'node:child_process';
test('the actual aggregate rejects missing, skipped and failed required jobs', () => {
 const workflow = readFileSync('.github/workflows/avendb-checks.yml', 'utf8');
 const expression = workflow.slice(workflow.indexOf('      - name: Require every selected suite')).match(/jq -e '([\s\S]*?)'/)[1];
 const names = ['impact','tests','image','spec','real-browser','protocol','frontend'];
 const results = Object.fromEntries(names.map(name => [name, { result:'success' }]));
 results.impact.outputs = { native:'true', browser:'true', protocol:'true', server:'true' };
 const cases = [{ data:results, expected:true }];
 for (const name of names.filter(n => n !== 'frontend')) {
  for (const result of ['failure','cancelled','skipped']) cases.push({data:{...results,[name]:{...results[name],result}},expected:false});
  const missing = {...results}; delete missing[name]; cases.push({data:missing,expected:false});
 }
 cases.push({data:{...results, frontend:{result:'skipped'}},expected:true});
 const run = spawnSync('jq', ['-c',expression], { input:cases.map(c=>JSON.stringify(c.data)).join('\n'), encoding:'utf8', env:{ ...process.env, PR:'true', DRAFT:'false', FRONTEND:'false', BROWSER_ONLY:'false', BROWSER:'false', PROTOCOL:'false' } });
 expect(run.status).toBe(0);
 expect(run.stdout.trim().split('\n').map(JSON.parse)).toEqual(cases.map(c=>c.expected));
});

test('Bun package and container versions follow the pinned toolchain', () => {
 const version = readFileSync('.bun-version','utf8').trim();
 expect(JSON.parse(readFileSync('package.json','utf8')).packageManager).toBe(`bun@${version}`);
 expect(readFileSync('api/Dockerfile','utf8')).toContain(`oven/bun:${version}-alpine`);
});

test('kernel aggregate requires every selected application and security job', () => {
 const workflow=readFileSync('.github/workflows/kernel.yml','utf8');
 const expression=workflow.slice(workflow.indexOf('    name: Kernel required checks')).match(/jq -e '([\s\S]*?)'/)[1];
 const names=['selection','tests','application','probes','probes-webkit','opfs-webkit'];
 const results=Object.fromEntries(names.map(name=>[name,{result:'success'}]));
 results.selection.outputs={suites:'["physics"]'};
 const cases=[{data:results,expected:true}];
 for(const name of names) for(const result of ['failure','cancelled','skipped']) cases.push({data:{...results,[name]:{...results[name],result}},expected:false});
 cases.push({data:{...results,selection:{result:'success',outputs:{suites:'[]'}},application:{result:'skipped'}},expected:true});
 const run=spawnSync('jq',['-c',expression],{input:cases.map(c=>JSON.stringify(c.data)).join('\n'),encoding:'utf8'});
 expect(run.status).toBe(0);
 expect(run.stdout.trim().split('\n').map(JSON.parse)).toEqual(cases.map(c=>c.expected));
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

test('API release accepts exactly its selected gate and successful delivery/image work', () => {
 const workflow=readFileSync('.github/workflows/main.yml','utf8');
 const condition=workflow.slice(workflow.indexOf('  api:\n')).match(/if: \$\{\{ (.*?) \}\}/)[1];
 // This condition uses only boolean operators, string equality and cancelled(); exercise the actual expression.
 const evaluate=new Function('needs','cancelled',`return (${condition.replaceAll('needs.api-tests', "needs['api-tests']").replaceAll('needs.api-image', "needs['api-image']")})`);
 const needs={impact:{outputs:{api:'true',site:'true'}},kernel:{result:'success'},'api-tests':{result:'skipped'},delivery:{result:'success'},'api-image':{result:'success'}};
 expect(evaluate(needs,()=>false)).toBe(true);
 expect(evaluate(needs,()=>true)).toBe(false);
 for(const name of ['kernel','delivery','api-image']) for(const result of ['failure','cancelled','skipped']) expect(evaluate({...needs,[name]:{result}},()=>false)).toBe(false);
 const apiOnly={...needs,impact:{outputs:{api:'true',site:'false'}},kernel:{result:'skipped'},'api-tests':{result:'success'}};
 expect(evaluate(apiOnly,()=>false)).toBe(true);
 for(const result of ['failure','cancelled','skipped']) expect(evaluate({...apiOnly,'api-tests':{result}},()=>false)).toBe(false);
 expect(evaluate({...apiOnly,impact:needs.impact},()=>false)).toBe(false);
 expect(evaluate({...needs,'api-tests':{result:'failure'}},()=>false)).toBe(false);
});

test('native tests and build helpers validate without publishing unchanged binaries', () => {
 for (const file of ['avendb/crates/avendb/tests/properties.rs','avendb/crates/avendb-device/tests/agent.rs','avendb/scripts/test-browser.sh']) {
  const next=impact([file]); expect(next.avendb && next.native).toBe(true); expect(next.server || next.agent).toBe(false);
 }
 expect(impact(['avendb/crates/avendb/src/lib.rs']).server).toBe(true);
});
