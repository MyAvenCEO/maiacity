// avenDB, for this Mac's scripts: the agent device agentScripts, a device of the coop's aven (avenMAIA for Maia City)
// as Claude's agentClaude is, acting with avenMAIA's rights and no more (by default a Suggester on Maia City). It is
// The OS app's `avendb-device agent scripts`, spoken to as an MCP server over stdio (initialize, then tools/call) —
// the same tools Claude has: avendb_vaults, avendb_ask, avendb_run, avendb_read_file.
//
// The first run asks its person: they open The OS app on this Mac, where avenDB shows agentScripts' request, and
// approve it with one touch of their passkey. Until then every call answers that it is waiting; `tool` waits for the
// answer (AVENDB_WAIT seconds, 300 by default), saying so once, and fails clearly when they said no.
//
//   AVENDB_DEVICE   the binary (default: The OS app's, ~/Applications/The OS.app/Contents/MacOS/avendb-device)
//   AVENDB_DIR      the app's avenDB folder (default ~/avenDB/mac)
import { spawn as spawnChild } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export const HARNESS = 'scripts';
export const DEVICE = process.env.AVENDB_DEVICE ?? join(homedir(), 'Applications', 'The OS.app', 'Contents', 'MacOS', 'avendb-device');
export const DIR = process.env.AVENDB_DIR ?? join(homedir(), 'avenDB', 'mac');
const PROTOCOL = '2025-06-18';

/** The words the agent answers with while its person hasn't approved it, and once they said no (agent.rs `call`). */
export const WAITING = /is waiting for its person to answer its access request/;
export const DENIED = /person said no to its request/;

export class Waiting extends Error {}

/**
 * A tool's answer read: its text, parsed as JSON where it is (an engine answer, `{ok}` or `{refused, why}`), else
 * the text; an MCP error, or `isError`, thrown; the waiting and the refusal of its person told apart.
 * @param {any} result the `result` of a tools/call answer
 */
export function parseResult(result) {
	const text = (result?.content ?? []).filter((c) => c?.type === 'text').map((c) => c.text).join('');
	if (result?.isError) throw new Error(`avenDB: ${text}`);
	if (DENIED.test(text)) throw new Error(`avenDB: ${text} (in The OS app)`);
	if (WAITING.test(text)) throw new Waiting(text);
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** An engine answer's value, or its refusal thrown. @param {any} a @param {string} what */
export function ok(a, what) {
	if (a && typeof a === 'object' && 'ok' in a) return a.ok;
	if (a?.refused) throw Object.assign(new Error(`${what}: ${a.why ?? ''} (${a.refused})`), { refused: a.refused });
	if (a?.approve) throw new Error(`${what}: it would need a passkey's approval, which an agent never gives`);
	return a;
}

/**
 * A session with the agent device. `spawn` is injectable (a test's mock child: stdin, stdout, stderr, kill, on).
 * @param {{ spawn?: typeof spawnChild, wait?: number, say?: (s: string) => void }} [o]
 */
export function connect(o = {}) {
	const spawn = o.spawn ?? spawnChild;
	const waitFor = (o.wait ?? Number(process.env.AVENDB_WAIT ?? 300)) * 1000;
	const say = o.say ?? ((s) => console.error(s));
	const child = spawn(DEVICE, ['agent', HARNESS, '--dir', DIR], { stdio: ['pipe', 'pipe', 'pipe'] });
	let next = 1;
	/** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
	const pending = new Map();
	let gone = /** @type {Error | null} */ (null);
	// the child holds the process open only while an answer is awaited: a script ends when its work does
	const hold = (/** @type {boolean} */ on) => {
		for (const s of [child, child.stdin, child.stdout, child.stderr]) /** @type {any} */ (s)?.[on ? 'ref' : 'unref']?.();
	};
	hold(false);
	const fail = (/** @type {Error} */ e) => {
		gone ??= e;
		for (const p of pending.values()) p.reject(e);
		pending.clear();
	};
	child.on('error', (/** @type {any} */ e) =>
		fail(new Error(e?.code === 'ENOENT' ? `no avendb-device at ${DEVICE}: install The OS app, or set AVENDB_DEVICE` : `avendb-device: ${e.message}`))
	);
	child.on('exit', (/** @type {number | null} */ code) => fail(new Error(`avendb-device ended (${code})`)));
	createInterface({ input: child.stdout }).on('line', (line) => {
		let m;
		try {
			m = JSON.parse(line);
		} catch {
			return;
		}
		const p = pending.get(m.id);
		if (!p) return;
		pending.delete(m.id);
		if (!pending.size) hold(false);
		if (m.error) p.reject(new Error(`avenDB: ${m.error.message ?? JSON.stringify(m.error)}`));
		else p.resolve(m.result);
	});
	/** @param {string} method @param {any} [params] */
	const request = (method, params) =>
		new Promise((resolve, reject) => {
			if (gone) return reject(gone);
			const id = next++;
			if (!pending.size) hold(true);
			pending.set(id, { resolve, reject });
			child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
		});
	const ready = request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'maiacity-scripts', version: '1' } }).then(
		(r) => {
			child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
			return r;
		}
	);
	let told = false;
	/**
	 * Tool `name` with `args`: its answer parsed (`parseResult`), once its person approved agentScripts.
	 * @param {string} name @param {Record<string, any>} [args]
	 */
	async function tool(name, args = {}) {
		await ready;
		const until = Date.now() + waitFor;
		for (;;) {
			try {
				return parseResult(await request('tools/call', { name, arguments: args }));
			} catch (e) {
				if (!(e instanceof Waiting) || Date.now() > until) throw e instanceof Waiting ? new Error(`avenDB: ${e.message} (waited ${waitFor / 1000} s)`) : e;
				if (!told) say(`avenDB: agentScripts waits for approval — open The OS app on this Mac and approve it with your passkey.`);
				told = true;
				await new Promise((r) => setTimeout(r, 3000));
			}
		}
	}
	return {
		tool,
		/** A read op (avendb_ask): its value. @param {any} op */
		ask: async (op) => ok(await tool('avendb_ask', { op }), op.op),
		/** A change op (avendb_run), with a `path` beside it for put_file, a create with a file and get_file. @param {any} op @param {{ path?: string, overwrite?: boolean }} [beside] */
		run: async (op, beside = {}) => tool('avendb_run', { op, ...beside }),
		close: () => {
			child.stdin.end();
			child.kill();
		},
		child
	};
}

/** @type {ReturnType<typeof connect> | null} */
let shared = null;
/** The process's one session, started on first use and ended with the process. */
export function session() {
	if (!shared) {
		shared = connect();
		process.once('exit', () => shared?.close());
	}
	return shared;
}
