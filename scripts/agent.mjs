// @ts-nocheck — plain JS
// The agent of avenMAIA a script talks to, as an MCP session on its stdio: the Mac's (`avendb` in ~/.claude.json, the
// device The OS app's `avendb-device agent claude` runs), `--device <path>` or AVENDB_DEVICE, or in a cloud session the
// repo's (scripts/avendb-cloud.sh, with AVENDB_AGENT_KEY). It acts with avenMAIA's rights on Maia City: a Suggester's,
// so whatever it writes is a proposal an owner accepts.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** how to start the agent; `named` is a path of avendb-device the caller was given */
export function device(named = process.env.AVENDB_DEVICE) {
	if (named) return { command: named, args: ['agent', 'claude'] };
	if (process.env.CLAUDE_CODE_REMOTE === 'true' && process.env.AVENDB_AGENT_KEY) return { command: 'sh', args: ['scripts/avendb-cloud.sh'] };
	try {
		const conf = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
		const s = conf.mcpServers?.avendb;
		if (s?.command) return { command: s.command, args: s.args ?? [] };
	} catch {
		// no Claude Code config here
	}
	throw new Error('no agent device: give --device <The OS app’s avendb-device>, or add it to Claude Code (claude mcp add --scope user avendb -- <avendb-device> agent claude)');
}

/** an MCP session with the agent (`env`, where given, its environment): `call(tool, args)` answers its tool's text,
 * read as JSON (an op's `ok`) */
export function session({ command, args, env }, name = 'script') {
	const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], ...(env ? { env } : {}) });
	const waiting = new Map();
	let n = 0;
	createInterface({ input: child.stdout }).on('line', (line) => {
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		const w = waiting.get(msg.id);
		if (!w) return;
		waiting.delete(msg.id);
		if (msg.error) w.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
		else w.resolve(msg.result);
	});
	child.on('exit', (code) => {
		for (const w of waiting.values()) w.reject(new Error(`the agent ended (${code})`));
		waiting.clear();
	});
	const send = (method, params) =>
		new Promise((resolve, reject) => {
			const at = ++n;
			waiting.set(at, { resolve, reject });
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: at, method, params })}\n`);
		});
	return {
		async open() {
			await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } });
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
		},
		async call(tool, a) {
			for (let i = 0; ; i++) {
				const r = await send('tools/call', { name: tool, arguments: a });
				const text = (r?.content ?? []).map((c) => c.text ?? '').join('');
				// a vault's first pull runs to its end; a call meanwhile is answered so, and asked again
				if (/still bringing/i.test(text) && i < 30) {
					await new Promise((ok) => setTimeout(ok, 6000));
					continue;
				}
				if (r?.isError) throw new Error(`${tool}: ${text}`);
				let got;
				try {
					got = JSON.parse(text);
				} catch {
					return text;
				}
				if (tool === 'avendb_vaults' || tool === 'avendb_read_file') return got;
				if (got && typeof got === 'object' && 'ok' in got) return got.ok;
				throw new Error(`${tool} ${a.op?.op ?? ''}: ${text.slice(0, 600)}`);
			}
		},
		/** Maia City as this agent sees it */
		async city() {
			const me = await this.call('avendb_vaults', {});
			const city = (me.vaults ?? []).find((x) => x.name === 'Maia City');
			if (!city) throw new Error(`this agent sees no Maia City: ${typeof me === 'string' ? me : JSON.stringify(me).slice(0, 400)}`);
			return city;
		},
		close() {
			child.stdin.end();
			child.kill();
		}
	};
}
