import type { Database, Statement } from "better-sqlite3";

/**
 * Prepared statements for ad-hoc SQL, cached per connection.
 *
 * The scheduler reads the seasons and their mode values every ten seconds;
 * compiling the same SQL on every call was measurable work for nothing. Keyed
 * weakly on the connection so a closed or replaced database (import, tests)
 * simply drops its cache.
 */
const cache = new WeakMap<Database, Map<string, Statement>>();

export function cachedStatement(db: Database, sql: string): Statement {
  let statements = cache.get(db);
  if (!statements) {
    statements = new Map();
    cache.set(db, statements);
  }
  let statement = statements.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}
