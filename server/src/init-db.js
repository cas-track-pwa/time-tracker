// Creates/initializes the SQLite database and reports its location.
// Safe to run repeatedly; schema.sql is idempotent.
import db, { DB_PATH } from './db.js';

const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

console.log(`Database ready: ${DB_PATH}`);
console.log(`Users: ${userCount}`);
