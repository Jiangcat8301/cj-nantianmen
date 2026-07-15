// TODO: MySQL impl when needed. Implement the 7 methods from ./interface.js
// using mysql2/promise. SCHEMA differs: AUTOINCREMENT -> AUTO_INCREMENT,
// datetime('now') -> CURRENT_TIMESTAMP, INTEGER -> INT, TEXT -> VARCHAR/TEXT.
// ponytail: this file exists so ./index.js can require it without runtime
// crash if user picks mysql at setup — but no actual code yet.
export class MysqlDatabase {
  constructor(config) {
    throw new Error('MySQL backend not implemented yet. Use sqlite3.')
  }
}
