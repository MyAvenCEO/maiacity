/**
 * The admin's window into this Postgres, read only: every table of the public schema with its columns and how many
 * rows it holds, and a page of one table's rows. Each read runs in a READ ONLY transaction, a table is named only as
 * the catalog names it, and a column that keeps a secret or a credential is never sent, only that it is there.
 */
import { db, type Queryable } from "./pg";

export class TableError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Column = { name: string; type: string; hidden: boolean };
export type Table = { name: string; rows: number; columns: Column[] };

/** The columns that keep a secret, a bearer code or a credential, by table: never sent. */
const SECRET: Record<string, string[]> = {
  secrets: ["value"],
  vault_config: ["value"],
  api_keys: ["hash"],
  device_codes: ["device_code", "user_code"],
  passkeys: ["public_key"],
  signup_invites: ["code"],
};
/** …and in a table added later, any column named like one. */
const SECRETISH = /secret|token|password|private|cipher|credential/i;
const hidden = (table: string, column: string) => !!SECRET[table]?.includes(column) || SECRETISH.test(column);

/** A cell longer than this is cut, so one big JSON value can't make a page of megabytes. */
const MAX_CELL = 20_000;
const PAGE = 50;
const MAX_PAGE = 200;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function readOnly<R>(fn: (tx: Queryable) => Promise<R>): Promise<R> {
  return db.transaction(async (tx) => {
    await tx.query("SET TRANSACTION READ ONLY");
    return fn(tx);
  });
}

async function columnsOf(tx: Queryable): Promise<Map<string, Column[]>> {
  const { rows } = await tx.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT c.table_name, c.column_name, c.data_type
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position`,
  );
  const out = new Map<string, Column[]>();
  for (const r of rows) {
    const list = out.get(r.table_name) ?? [];
    list.push({ name: r.column_name, type: r.data_type, hidden: hidden(r.table_name, r.column_name) });
    out.set(r.table_name, list);
  }
  return out;
}

/** Every table, by name, with its columns and its rows counted. */
export async function listTables(): Promise<Table[]> {
  return readOnly(async (tx) => {
    const all = await columnsOf(tx);
    const out: Table[] = [];
    for (const [name, columns] of [...all].sort(([a], [b]) => a.localeCompare(b))) {
      const { rows } = await tx.query<{ n: number | string }>(`SELECT count(*) AS n FROM ${quote(name)}`);
      out.push({ name, rows: Number(rows[0]?.n ?? 0), columns });
    }
    return out;
  });
}

/** A cell as it is sent: a hidden one never, a long one cut. */
function cell(value: unknown, column: Column): unknown {
  if (column.hidden) return value == null ? null : { hidden: true };
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length > MAX_CELL) return { cut: text.slice(0, MAX_CELL), length: text.length };
  return value;
}

/** A page of table `name`'s rows, in its primary key's order (else as stored), with how many it has in all. */
export async function readTable(name: string, offset = 0, limit = PAGE) {
  const from = Math.max(0, Math.floor(Number(offset) || 0));
  const take = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(limit) || PAGE)));
  return readOnly(async (tx) => {
    const columns = (await columnsOf(tx)).get(name);
    if (!columns) throw new TableError(`There is no table ${name}.`, 404);
    const { rows: keys } = await tx.query<{ column_name: string }>(
      `SELECT k.column_name
         FROM information_schema.table_constraints c
         JOIN information_schema.key_column_usage k
           ON k.constraint_name = c.constraint_name AND k.table_schema = c.table_schema AND k.table_name = c.table_name
        WHERE c.table_schema = 'public' AND c.table_name = $1 AND c.constraint_type = 'PRIMARY KEY'
        ORDER BY k.ordinal_position`,
      [name],
    );
    const order = keys.length ? `ORDER BY ${keys.map((k) => quote(k.column_name)).join(", ")}` : "";
    const { rows: counted } = await tx.query<{ n: number | string }>(`SELECT count(*) AS n FROM ${quote(name)}`);
    const { rows } = await tx.query<Record<string, unknown>>(
      `SELECT * FROM ${quote(name)} ${order} LIMIT ${take} OFFSET ${from}`,
    );
    return {
      name,
      columns,
      total: Number(counted[0]?.n ?? 0),
      offset: from,
      limit: take,
      rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c.name, cell(r[c.name], c)]))),
    };
  });
}
