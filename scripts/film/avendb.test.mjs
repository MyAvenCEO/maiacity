// The scripts' avenDB client (./avendb.mjs): MCP over stdio to a mock agent device, its tool answers read.
// Run: bun test scripts/film/avendb.test.mjs
import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { connect, DEVICE, DIR, HARNESS, ok, parseResult } from './avendb.mjs';

test('defaults to the embedded application and preserves standalone overrides', () => {
	const env = { ...process.env };
	delete env.AVENDB_DEVICE;
	const source = `import { DEVICE } from ${JSON.stringify(new URL('./avendb.mjs', import.meta.url).href)}; console.log(DEVICE);`;
	const resolve = () => {
		const result = Bun.spawnSync([process.execPath, '-e', source], { env });
		expect(result.exitCode).toBe(0);
		return result.stdout.toString().trim();
	};
	expect(resolve()).toMatch(/\/Applications\/(theOS|The OS)\.app\/Contents\/MacOS\/maiacity-studio$/);
	env.AVENDB_DEVICE = '/custom/avendb-device';
	expect(resolve()).toBe(env.AVENDB_DEVICE);
});

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });
const WAIT = 'agentScripts is waiting for its person to answer its access request: they open theOS app on this Mac.';

/** A mock `avendb-device agent scripts`: answers each request line with `answer(message)`. */
function mock(answer) {
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.sent = [];
	child.stdin = new Writable({
		write(chunk, _, done) {
			for (const line of String(chunk).split('\n').filter(Boolean)) {
				const m = JSON.parse(line);
				child.sent.push(m);
				if (m.id !== undefined) child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: answer(m) }) + '\n');
			}
			done();
		}
	});
	child.kill = () => {};
	return child;
}

test('a tool answer: JSON, text, an error, the waiting and a no', () => {
	expect(parseResult(text('{"ok":{"entry":"ab"}}'))).toEqual({ ok: { entry: 'ab' } });
	expect(parseResult(text('plain words'))).toBe('plain words');
	expect(() => parseResult(text('no tool "x"', true))).toThrow('no tool');
	expect(() => parseResult(text(WAIT))).toThrow('waiting');
	expect(() => parseResult(text("agentScripts's person said no to its request."))).toThrow('said no');
	expect(ok({ ok: 1 }, 'x')).toBe(1);
	expect(() => ok({ refused: 'NoCap', why: 'a Suggester' }, 'adding')).toThrow('adding: a Suggester (NoCap)');
});

test('initialize, then tools/call, each answer by its id', async () => {
	let child;
	const s = connect({
		spawn: (executable, args) => {
			expect(executable).toBe(DEVICE);
			expect(args).toEqual(['agent', HARNESS, '--dir', DIR]);
			return (child = mock((m) => (m.method === 'initialize' ? { protocolVersion: '2025-06-18' } : text(JSON.stringify({ ok: { got: m.params } })))));
		}
	});
	const got = await s.ask({ op: 'world' });
	expect(got.got).toEqual({ name: 'avendb_ask', arguments: { op: { op: 'world' } } });
	expect(child.sent.map((m) => m.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
	s.close();
});

test('waits for its person, then goes on', async () => {
	let calls = 0;
	const said = [];
	const s = connect({
		wait: 10,
		say: (x) => said.push(x),
		spawn: () => mock((m) => (m.method === 'initialize' ? {} : ++calls === 1 ? text(WAIT) : text('{"who":"agentScripts"}')))
	});
	expect(await s.tool('avendb_vaults')).toEqual({ who: 'agentScripts' });
	expect(said.length).toBe(1);
	s.close();
}, 10000);
