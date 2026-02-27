const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "journal.db");
let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_number TEXT NOT NULL,
      message_text TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      date TEXT NOT NULL DEFAULT (date('now'))
    )
  `);
  console.log("Journal database initialized.");
}

function saveEntry(phoneNumber, messageText) {
  const stmt = db.prepare(
    "INSERT INTO journal_entries (phone_number, message_text) VALUES (?, ?)"
  );
  const result = stmt.run(phoneNumber, messageText);
  console.log(`Journal entry saved (id: ${result.lastInsertRowid})`);
  return result.lastInsertRowid;
}

function getEntriesByDate(date) {
  return db
    .prepare("SELECT * FROM journal_entries WHERE date = ? ORDER BY received_at")
    .all(date);
}

function getRecentEntries(limit = 10) {
  return db
    .prepare("SELECT * FROM journal_entries ORDER BY received_at DESC LIMIT ?")
    .all(limit);
}

module.exports = { init, saveEntry, getEntriesByDate, getRecentEntries };
