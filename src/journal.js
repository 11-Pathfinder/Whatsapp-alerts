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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_ratings (
      id SERIAL PRIMARY KEY,
      phone_number TEXT NOT NULL,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      ovo INTEGER CHECK (ovo BETWEEN 1 AND 10),
      pathfinder INTEGER CHECK (pathfinder BETWEEN 1 AND 10),
      health INTEGER CHECK (health BETWEEN 1 AND 10),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (phone_number, date)
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

async function getAllEntriesGroupedByDate(fromDate, toDate) {
  if (fromDate && toDate) {
    const result = await pool.query(
      "SELECT * FROM journal_entries WHERE date BETWEEN $1 AND $2 ORDER BY date DESC, received_at ASC",
      [fromDate, toDate]
    );
    return result.rows;
  }
  const result = await pool.query(
    "SELECT * FROM journal_entries ORDER BY date DESC, received_at ASC"
  );
  return result.rows;
}

async function saveRatings(phoneNumber, date, { ovo, pathfinder, health }) {
  const result = await pool.query(
    `INSERT INTO daily_ratings (phone_number, date, ovo, pathfinder, health)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (phone_number, date) DO UPDATE SET
       ovo = COALESCE($3, daily_ratings.ovo),
       pathfinder = COALESCE($4, daily_ratings.pathfinder),
       health = COALESCE($5, daily_ratings.health),
       updated_at = NOW()
     RETURNING *`,
    [phoneNumber, date, ovo || null, pathfinder || null, health || null]
  );
  console.log(`Ratings saved for ${date}`);
  return result.rows[0];
}

async function getRatings(fromDate, toDate) {
  if (fromDate && toDate) {
    const result = await pool.query(
      "SELECT * FROM daily_ratings WHERE date BETWEEN $1 AND $2 ORDER BY date ASC",
      [fromDate, toDate]
    );
    return result.rows;
  }
  const result = await pool.query(
    "SELECT * FROM daily_ratings ORDER BY date ASC"
  );
  return result.rows;
}

async function getRatingsForDate(date) {
  const result = await pool.query(
    "SELECT * FROM daily_ratings WHERE date = $1",
    [date]
  );
  return result.rows[0] || null;
}

async function getWeeklyAverages(weekStartDate) {
  const result = await pool.query(
    `SELECT AVG(ovo)::numeric(3,1) as avg_ovo,
            AVG(pathfinder)::numeric(3,1) as avg_pathfinder,
            AVG(health)::numeric(3,1) as avg_health,
            COUNT(*) as days_rated
     FROM daily_ratings
     WHERE date >= $1 AND date < $1::date + interval '7 days'`,
    [weekStartDate]
  );
  return result.rows[0];
}

module.exports = { init, saveEntry, getEntriesByDate, getRecentEntries, getAllEntriesGroupedByDate, saveRatings, getRatings, getRatingsForDate, getWeeklyAverages };
