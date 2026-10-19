/*
 * The schemas of studio 2.0's jobs (plan: /mnt/project-files/studio-vs-avendb/jobs-studio-2.0-plan.md, J0b): a rule
 * says what is wanted, a task is one piece of work, a rule applied to pinned inputs. Both are records of the vault the
 * work is about, in that vault's own lane (avendb/docs/ARCHITECTURE.md §9), as the HITL queue's review is
 * (src/lib/avendb/hitl.js): the page adds each the first time the vault needs it, the same bytes in every vault, so
 * the same id everywhere. avenDB may ship them later; the bytes stay, so nothing changes for a vault that has them.
 *
 * Fields that hold a query or a free JSON value (a rule's `when`, `inputs` and `makes`, a task's `params` and
 * `result`) are JSON as text: a schema can't say a map of any keys, nor a selector that holds selectors.
 */

/** The type of a rule entry and its record's kind; of a task, the same. */
export const RULE = 'rule';
export const TASK = 'task';

/** The lanes the Mac runs: one job at a time in each (vault/app/src/jobs.rs). */
export const LANES = /** @type {const} */ (['gpu', 'speech', 'ai', 'io', 'net']);
/** @typedef {(typeof LANES)[number]} Lane */

/** Where a task is: queued, claimed by a device running it (`lease_until` in force), done, failed (tried again), or held after
 * three tries, until a person says again. */
export const STATUSES = /** @type {const} */ (['queued', 'claimed', 'done', 'failed', 'held']);
/** @typedef {(typeof STATUSES)[number]} Status */

export const RULE_V1 = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Rule, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "rule" },
    "key": { "type": "string", "maxLength": 64 },
    "name": { "type": "string", "maxLength": 200, "default": "" },
    "version": { "type": "integer", "minimum": 1 },
    "lane": { "enum": ["gpu", "speech", "ai", "io", "net"] },
    "when": { "type": "string", "maxLength": 4000, "default": "" },
    "inputs": { "type": "string", "maxLength": 4000, "default": "{}" },
    "params": { "type": "array", "items": { "type": "string", "maxLength": 200 }, "maxItems": 32, "default": [] },
    "makes": { "type": "string", "maxLength": 4000, "default": "[]" },
    "about": { "type": "string", "maxLength": 2000, "default": "" },
    "off": { "type": "boolean", "default": false }
  },
  "required": ["kind", "key", "version", "lane"]
}
`;

export const TASK_V1 = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Task, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "task" },
    "rule": { "type": "string", "maxLength": 64 },
    "version": { "type": "integer", "minimum": 1 },
    "key": { "type": "string", "maxLength": 64 },
    "lane": { "enum": ["gpu", "speech", "ai", "io", "net"] },
    "inputs": {
      "type": "array",
      "maxItems": 64,
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "integer" },
          "name": { "type": "string", "maxLength": 64 },
          "entry": { "type": "string", "maxLength": 64 },
          "at": { "type": "array", "items": { "type": "string", "maxLength": 64 }, "maxItems": 64, "default": [] }
        },
        "required": ["id", "name", "entry"]
      }
    },
    "params": { "type": "string", "maxLength": 4000, "default": "{}" },
    "status": { "enum": ["queued", "claimed", "done", "failed", "held"] },
    "worker": { "type": "string", "maxLength": 64, "default": "" },
    "lease_until": { "type": "integer", "minimum": 0, "default": 0 },
    "attempts": { "type": "integer", "minimum": 0, "default": 0 },
    "error": { "type": "string", "maxLength": 2000, "default": "" },
    "outputs": { "type": "array", "items": { "type": "string", "maxLength": 64 }, "maxItems": 64, "default": [] },
    "result": { "type": "string", "maxLength": 20000, "default": "" },
    "by": { "type": "string", "maxLength": 64, "default": "" },
    "at": { "type": "integer", "minimum": 0 }
  },
  "required": ["kind", "rule", "version", "key", "lane", "status", "at"]
}
`;

/** Each schema by its title, as the world names a schema entry. */
const SCHEMAS = [
	['Rule, v1', RULE_V1],
	['Task, v1', TASK_V1]
];

/**
 * The ops that add to vault `vault`'s lane the job schemas it lacks, acting for `as`: none once it has both.
 * @param {import('../../avendb/vaults.js').WorldView} world @param {string} vault @param {string} as
 */
export function lacking(world, vault, as) {
	const has = new Set(
		world.entries.filter((e) => e.vault === vault && e.type === 'schema' && !e.deleted).map((e) => e.title)
	);
	return SCHEMAS.filter(([title]) => !has.has(title)).map(([, value]) => ({ op: 'create', vault, type: 'schema', value, as }));
}
