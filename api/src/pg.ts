// The ledger speaks one small database interface — query, exec, transaction —
// so the same code runs on the production Postgres (through Bun's client) and
// on PGlite in the tests, which gives real Postgres semantics without Docker.
import type { SQL } from "bun";

export type QueryResult<T> = { rows: T[]; affectedRows: number };

export interface Queryable {
  query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  exec(text: string): Promise<void>;
  transaction<R>(fn: (tx: Queryable) => Promise<R>): Promise<R>;
}

function wrap(run: SQL): Queryable {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const r: any = await run.unsafe(text, params as any[]);
      return { rows: [...r] as T[], affectedRows: Number(r.count ?? r.length ?? 0) };
    },
  };
}

export function fromBunSql(sql: SQL): Db {
  const q = wrap(sql);
  return {
    query: q.query,
    async exec(text) {
      await sql.unsafe(text);
    },
    transaction(fn) {
      return sql.begin((tx: SQL) => fn(wrap(tx))) as any;
    },
  };
}

/** The live connection. Set once at boot (or by a test) before the ledger runs. */
export let db: Db;
export function useDb(next: Db): void {
  db = next;
}
