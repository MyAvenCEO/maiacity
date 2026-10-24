// A fresh DB per suite; only adapter code is shared. Migration regressions replay their own histories.
import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS } from '../../src/migrations-list';
import { useDb, type Db, type Queryable } from '../../src/pg';
export function databaseOf(pg: PGlite): Db {
 const wrap = (query: any): Queryable => ({ query: async (text, params = []) => {
  const r = await query.query(text, params);
  return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
 }});
 return { ...wrap(pg), exec: async text => { await pg.exec(text); }, transaction: fn => pg.transaction(tx => fn(wrap(tx))) };
}
export async function migrateAndUse(pg: PGlite) {
 for (const migration of MIGRATIONS) await pg.exec(migration.sql);
 const db = databaseOf(pg);
 useDb(db);
 return db;
}
