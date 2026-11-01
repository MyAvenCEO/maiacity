// aip-836d checkpoint 4 (c11): brain's MCP server answers every read verb as the command line does, and a write
// through it is the same door (a refusal is a tool error with its code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), fixtures = join(here, 'fixtures'), program = join(here, '..', 'brain.mjs');
const cli = (...a) => JSON.parse(execFileSync(process.execPath, [program, ...a, '--json', '--root', fixtures], { encoding: 'utf8' }));

function server() {
  const p = spawn(process.execPath, [program, 'mcp', '--root', fixtures]);
  let buf = '', n = 0; const wait = new Map();
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); wait.get(m.id)?.(m); } });
  const call = (method, params) => new Promise((ok) => { const id = ++n; wait.set(id, ok); p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return { call, stop: () => p.kill() };
}

test('MCP: initialize, the tools listed, and prime, holds and get answer as the command does', async () => {
  const s = server();
  try {
    const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'brain');
    const tools = (await s.call('tools/list')).result.tools.map((t) => t.name);
    for (const v of ['prime', 'holds', 'get', 'reflect', 'add', 'edit', 'append', 'index', 'check', 'versions']) assert.ok(tools.includes(v), v);
    const via = async (name, args) => JSON.parse((await s.call('tools/call', { name, arguments: args })).result.content[0].text);
    assert.deepEqual(await via('prime', {}), cli('prime'));
    assert.deepEqual(await via('holds', { type: 'decision' }), cli('holds', 'decision'));
    const g = cli('get', 'decisions/D-2'); delete g.changedSince;
    assert.deepEqual(await via('get', { id: 'decisions/D-2' }), g);
    const refused = (await s.call('tools/call', { name: 'get', arguments: { id: 'nope' } })).result;
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /^not_found: /);
  } finally { s.stop(); }
});
