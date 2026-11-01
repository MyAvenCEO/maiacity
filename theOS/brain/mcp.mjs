// brain's MCP server (aip-836d, checkpoint 4, c11; d-9271): the same verbs brain.mjs exports, served as MCP tools over
// stdio (newline-delimited JSON-RPC 2.0), so other sessions and tools use the same door. No dependency: MCP's stdio
// transport is one JSON message per line. Run: node brain/brain.mjs mcp (theOS/.mcp.json names it for Claude Code).
import { createInterface } from 'node:readline';

const str = { type: 'string' };
const who = { intent: { ...str, description: "the intent's id this write serves (aip-…)" }, by: { ...str, description: "the author's id (a-…)" }, task: { ...str, description: 'the task id, if any' } };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

// Each tool: its input schema and the plain function it calls, given the theOS root and its arguments.
// brain is brain.mjs's own exports, passed in (importing it here would wait on its top-level await).
export const tools = (brain) => ({
  prime: { description: 'What holds now in theOS (decisions and terms) and what waits for Samuel. Read this first.', input: obj({}), run: async (root) => brain.prime(await brain.load(root)) },
  holds: { description: 'The docs of a type that hold now (decision, term, reference, intent, lesson, metric, …).', input: obj({ type: str }, ['type']), run: async (root, a) => brain.holds(await brain.load(root), a.type) },
  get: { description: 'One doc by id (or an old name): whether it holds, what supersedes it, its links and backlinks by field.', input: obj({ id: str }, ['id']), run: async (root, a) => brain.get(await brain.load(root), a.id) },
  reflect: { description: 'The docs a draft may supersede: same type, holding, a shared topic word (about).', input: obj({ type: str, draft: { type: 'object' } }, ['type', 'draft']), run: (root, a) => brain.reflect(brain.docsOf(root), a.type, a.draft) },
  add: { description: 'A new doc: its id minted, its schema checked, filed, indexed, and the intent\'s event written. Commit the files after.', input: obj({ type: str, doc: { type: 'object' }, ...who }, ['type', 'doc', 'intent', 'by']), run: (root, a) => brain.add(root, a) },
  edit: { description: 'A correction that keeps a doc\'s meaning; the fields given replace the doc\'s. A change of meaning is a new doc that supersedes it.', input: obj({ id: str, patch: { type: 'object' }, ...who }, ['id', 'patch', 'intent', 'by']), run: (root, a) => brain.edit(root, a) },
  append: { description: 'An entry at the end of a list that only grows.', input: obj({ id: str, list: str, entry: {}, ...who }, ['id', 'list', 'entry', 'intent', 'by']), run: (root, a) => brain.append(root, a) },
  index: { description: 'brain/ids.json, the index docs and the copied lists written again from the docs.', input: obj({}), run: (root) => brain.index(root) },
  check: { description: 'Every commit in the range against its parent, and the tree: events cover every changed doc, schemas, history only grows, links resolve.', input: obj({ range: str }), run: (root, a) => brain.check(root, a) },
  versions: { description: 'Links whose target changed after they were cited, by citing doc.', input: obj({ ids: { type: 'array', items: str } }), run: (root, a) => brain.versions(root, a.ids) },
});

// One JSON-RPC request in, one response out (null for a notification).
export async function handle(root, msg, TOOLS) {
  const ok = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.id === undefined) return null;
  if (msg.method === 'initialize') return ok({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'brain', version: '1' }, instructions: "theOS's memory. Read with prime, holds and get; write only with add, edit and append, each naming --intent and --by." });
  if (msg.method === 'ping') return ok({});
  if (msg.method === 'tools/list') return ok({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.input })) });
  if (msg.method === 'tools/call') {
    const t = TOOLS[msg.params?.name];
    if (!t) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `no tool ${msg.params?.name}` } };
    try {
      const out = await t.run(root, msg.params.arguments || {});
      return ok({ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: { result: out } });
    } catch (e) {
      // a refusal is brain's fixed code and its fix; anything else is reported as it is
      return ok({ content: [{ type: 'text', text: e.fix ? `${e.code}: ${e.fix}` : String(e.message || e) }], isError: true });
    }
  }
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `no method ${msg.method}` } };
}

export function serve(root, brain) {
  const TOOLS = tools(brain);
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`); return; }
    const res = await handle(root, msg, TOOLS);
    if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
  });
}
