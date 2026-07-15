// ponytail: abstract Database interface; one impl (sqlite3) now, MySQL later.
// query(sql, params) -> rows[]; run(sql, params) -> { changes, lastInsertRowid };
// exec(sql) -> no result; begin/commit/rollback for transactions;
// close() for shutdown.
export class Database {
  // Returns rows as array of plain objects (caller treats as readonly)
  async query(sql, params = []) { throw new Error('not implemented') }
  // Mutation: returns { changes, lastInsertRowid }
  async run(sql, params = []) { throw new Error('not implemented') }
  async exec(sql) { throw new Error('not implemented') }
  async begin() { throw new Error('not implemented') }
  async commit() { throw new Error('not implemented') }
  async rollback() { throw new Error('not implemented') }
  async close() { throw new Error('not implemented') }
}
