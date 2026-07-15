import { SqliteDatabase } from './sqlite.js'
import { MysqlDatabase } from './mysql.js'

let _db = null

export function getDb() {
  if (_db === null) throw new Error('DB not initialized; call initDb() first')
  return _db
}

export async function initDb(config) {
  if (_db !== null) {
    await _db.close()
    _db = null
  }
  if (config.type === 'sqlite3') {
    _db = new SqliteDatabase(config.path)
  } else if (config.type === 'mysql') {
    _db = new MysqlDatabase(config)
  } else {
    throw new Error(`Unknown DB type: ${config.type}`)
  }
  return _db
}

export async function closeDb() {
  if (_db) {
    await _db.close()
    _db = null
  }
}
