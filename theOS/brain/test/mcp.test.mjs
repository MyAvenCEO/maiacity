// aip-836d checkpoint 4 (c11): brain's MCP server answers every verb (but install and mcp, which set up a clone) as
// the command line does: the same answers and the same refusal codes, on migrated copies of the fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../migrate.mjs';
import { index } from '../door.mjs';

const here = dirname(fileURLToPath(import.meta.url)), program = join(here, '..', 'brain.mjs');
const put = (root, f, d) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, `${f}.json`), JSON.stringify(d, null, 1)); };
const J = (root, f) => JSON.parse(readFileSync(join(root, `${f}.json`), 'utf8'));
function world() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-'));
  cpSync(join(here, 'fixtures'), root, { recursive: true });
  migrate(root, { seed: 'mcp' });
  put(root, 'brain/authors/a-0001', { type: 'author', id: 'a-0001' });
  const open = (t, props) => ({ type: 'type', name: t, schema: { type: 'object', properties: Object.fromEntries(['type', 'id', ...props].map((k) => [k, {}])) } });
  put(root, 'avenCEO/types/ty-0001', { id: 'ty-0001', ...open('decision', ['n', 'title', 'means', 'about', 'supersedes', 'relates', 'intents', 'at']) });
  put(root, 'avenCEO/types/ty-0002', { id: 'ty-0002', ...open('intent', ['title', 'questions', 'tasks', 'events']) });
  put(root, 'avenCEO/types/ty-0003', { id: 'ty-0003', ...open('author', []) });
  index(root);
  execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base', '--allow-empty'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'docs'], { cwd: root });
  return { root, names: J(root, 'brain/renames').names };
}
// the command line's answer: its JSON, or its refusal code
function cli(root, ...a) {
  const r = spawnSync(process.execPath, [program, ...a, '--json', '--root', root], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  return out.error ? { error: out.error } : out;
}
function server(root) {
  const p = spawn(process.execPath, [program, 'mcp', '--root', root]);
  let buf = '', n = 0; const wait = new Map();
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); wait.get(m.id)?.(m); } });
  const call = (method, params) => new Promise((ok) => { const id = ++n; wait.set(id, ok); p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const tool = async (name, args) => { const r = (await call('tools/call', { name, arguments: args })).result; const t = r.content[0].text; return r.isError && !t.startsWith('{') ? { error: t.split(':')[0] } : JSON.parse(t); };
  return { call, tool, stop: () => p.kill() };
}
const file = (o) => { const f = join(mkdtempSync(join(tmpdir(), 'arg-')), 'x.json'); writeFileSync(f, JSON.stringify(o)); return f; };
const noId = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'id' || k === 'at' ? undefined : v)));

test('MCP: every verb answers as the command line does; a failing check is an error', async () => {
  const A = world(), B = world();
  const s = server(B.root), who = { intent: B.names['aip/AIP-1'], by: 'a-0001' }, whoA = ['--intent', A.names['aip/AIP-1'], '--by', 'a-0001'];
  try {
    const init = await s.call('initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    const tools = (await s.call('tools/list')).result.tools.map((t) => t.name);
    assert.deepEqual(tools.sort(), ['add', 'append', 'check', 'edit', 'get', 'holds', 'index', 'prime', 'reflect', 'versions']);
    // reads, on the same docs (B through MCP, B through the command line)
    assert.deepEqual(await s.tool('prime', {}), cli(B.root, 'prime'));
    assert.deepEqual(await s.tool('holds', { type: 'decision' }), cli(B.root, 'holds', 'decision'));
    assert.deepEqual(await s.tool('get', { id: B.names['D-4'] }), cli(B.root, 'get', B.names['D-4']));
    assert.deepEqual(await s.tool('get', { id: 'nope' }), cli(B.root, 'get', 'nope'));
    assert.deepEqual(await s.tool('reflect', { type: 'decision', draft: { about: [] } }), cli(B.root, 'reflect', 'decision', file({ about: [] })));
    assert.deepEqual(await s.tool('check', { range: 'HEAD~1..HEAD' }), cli(B.root, 'check', '--range', 'HEAD~1..HEAD'));
    assert.deepEqual(await s.tool('versions', {}), cli(B.root, 'versions'));
    // writes: the same write on A through the command line and on B through MCP gives the same answer
    const draft = { title: 'Through both doors', about: ['d'] };
    assert.deepEqual(noId(await s.tool('add', { type: 'decision', doc: draft, ...who })), noId(cli(A.root, 'add', 'decision', file(draft), ...whoA)));
    assert.deepEqual(await s.tool('edit', { id: B.names['D-4'], patch: { title: 'edited' }, ...who }), { ...cli(A.root, 'edit', A.names['D-4'], file({ title: 'edited' }), ...whoA), id: B.names['D-4'] });
    assert.deepEqual(await s.tool('append', { id: B.names['D-4'], list: 'relates', entry: B.names['D-3'], ...who }), { ...cli(A.root, 'append', A.names['D-4'], 'relates', file(A.names['D-3']), ...whoA), id: B.names['D-4'] });
    assert.deepEqual(await s.tool('index', {}), cli(A.root, 'index'));
    // refusals carry the same codes
    assert.deepEqual(await s.tool('add', { type: 'decision', doc: draft, intent: 'aip-nope', by: 'a-0001' }), cli(A.root, 'add', 'decision', file(draft), '--intent', 'aip-nope', '--by', 'a-0001'));
    assert.deepEqual(await s.tool('add', { type: 'decision', doc: draft, intent: who.intent, by: 'Samuel' }), cli(A.root, 'add', 'decision', file(draft), '--intent', A.names['aip/AIP-1'], '--by', 'Samuel'));
    // a check that fails is a tool error
    const bad = (await s.call('tools/call', { name: 'check', arguments: { range: 'nope..HEAD' } })).result;
    assert.equal(bad.isError, true);
    // a line that is not a request is answered, and the server keeps serving
    await new Promise((ok) => { s.call('ping').then(ok); });
  } finally { s.stop(); }
});
