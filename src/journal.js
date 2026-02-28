const { Pool } = require("pg");

let pool;

function getSslConfig() {
  const dbUrl = process.env.DATABASE_URL || "";
  if (dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1")) {
    return false;
  }
  if (process.env.DATABASE_CA_CERT) {
    return { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT };
  }
  return { rejectUnauthorized: false };
}

async function init() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: getSslConfig(),
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id SERIAL PRIMARY KEY,
      phone_number TEXT NOT NULL,
      message_text TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      date DATE NOT NULL DEFAULT CURRENT_DATE
    )
  `);
  console.log("Journal database initialized (Postgres).");
}

async function saveEntry(phoneNumber, messageText) {
  const result = await pool.query(
    "INSERT INTO journal_entries (phone_number, message_text) VALUES ($1, $2) RETURNING id",
    [phoneNumber, messageText]
  );
  const id = result.rows[0].id;
  console.log(`Journal entry saved (id: ${id})`);
  return id;
}

async function getEntriesByDate(date) {
  const result = await pool.query(
    "SELECT * FROM journal_entries WHERE date = $1 ORDER BY received_at",
    [date]
  );
  return result.rows;
}

async function getRecentEntries(limit = 10) {
  const result = await pool.query(
    "SELECT * FROM journal_entries ORDER BY received_at DESC LIMIT $1",
    [limit]
  );
  return result.rows;
}

async function getAllEntriesGroupedByDate() {
  const result = await pool.query(
    "SELECT * FROM journal_entries ORDER BY date DESC, received_at ASC"
  );
  return result.rows;
}

module.exports = { init, saveEntry, getEntriesByDate, getRecentEntries, getAllEntriesGroupedByDate };
