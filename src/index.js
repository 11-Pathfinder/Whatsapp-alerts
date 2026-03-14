const express = require("express");
const rateLimit = require("express-rate-limit");
const config = require("./config");
const journal = require("./journal");
const webhookRouter = require("./webhook");
const scheduler = require("./scheduler");

async function main() {
  // Initialize database
  await journal.init();

  // Set up Express server
  const app = express();
  app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

  // Rate limiting — 100 requests per 15 minutes per IP
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

  app.use(webhookRouter);

  // Health check
  app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "whatsapp-journal-reminders" });
  });

  // Token auth middleware for journal routes
  function journalAuth(req, res, next) {
    const provided = req.query.token || req.headers["x-auth-token"];
    if (provided !== config.journalAuthToken) {
      return res.status(401).send("Unauthorized.");
    }
    next();
  }

  // POST /journal/ratings — save ratings from web UI
  app.post("/journal/ratings", journalAuth, async (req, res) => {
    try {
      const { date, ovo, pathfinder, health } = req.body;
      if (!date) return res.status(400).json({ error: "date is required" });

      const validate = (v) => {
        if (v === null || v === undefined || v === "") return null;
        const n = parseInt(v, 10);
        return n >= 1 && n <= 10 ? n : null;
      };

      await journal.saveRatings(config.recipientPhone, date, {
        ovo: validate(ovo),
        pathfinder: validate(pathfinder),
        health: validate(health),
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("Error saving ratings:", err);
      res.status(500).json({ error: "Failed to save ratings" });
    }
  });

  // Journal webpage — entries only
  app.get("/journal", journalAuth, async (req, res) => {
    try {
      const from = req.query.from || null;
      const to = req.query.to || null;
      const token = req.query.token;

      const entries = await journal.getAllEntriesGroupedByDate(from, to);

      // Group entries by date
      const grouped = {};
      for (const entry of entries) {
        const date =
          entry.date instanceof Date
            ? entry.date.toISOString().split("T")[0]
            : String(entry.date).split("T")[0];
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(entry);
      }

      const dates = Object.keys(grouped);

      // Build entries HTML
      let entriesHtml = "";
      if (dates.length === 0) {
        entriesHtml = `<p class="empty">No journal entries yet. Reply to a WhatsApp prompt to get started.</p>`;
      } else {
        for (const date of dates) {
          const dateObj = new Date(date + "T00:00:00");
          const formatted = dateObj.toLocaleDateString("en-GB", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          });

          let dayEntries = "";
          for (const entry of grouped[date]) {
            const time = new Date(entry.received_at).toLocaleTimeString(
              "en-GB",
              { hour: "2-digit", minute: "2-digit" }
            );
            dayEntries += `
              <div class="entry">
                <span class="time">${time}</span>
                <p class="text">${escapeHtml(entry.message_text)}</p>
              </div>`;
          }

          entriesHtml += `
            <div class="day">
              <h2>${formatted}</h2>
              ${dayEntries}
            </div>`;
        }
      }

      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Journal</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #faf9f6;
      color: #2d2d2d;
      max-width: 640px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }
    nav {
      display: flex;
      gap: 1.5rem;
      margin-bottom: 1.5rem;
    }
    nav a {
      font-size: 0.9rem;
      color: #888;
      text-decoration: none;
    }
    nav a:hover { color: #2d2d2d; }
    nav a.active {
      color: #2d2d2d;
      font-weight: 600;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      color: #1a1a1a;
    }
    .filter {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }
    .filter label { font-size: 0.8rem; color: #666; }
    .filter input[type="date"] {
      font-family: inherit;
      font-size: 0.85rem;
      padding: 0.3rem 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #fff;
    }
    .filter button {
      padding: 0.3rem 1rem;
      background: #2d2d2d;
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .filter a { font-size: 0.8rem; color: #888; }
    .day { margin-bottom: 2rem; }
    .day h2 {
      font-size: 0.85rem;
      font-weight: 500;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #e8e6e1;
    }
    .entry { display: flex; gap: 1rem; padding: 0.75rem 0; }
    .entry + .entry { border-top: 1px solid #f0eeea; }
    .time {
      font-size: 0.8rem;
      color: #aaa;
      min-width: 3.5rem;
      padding-top: 0.15rem;
    }
    .text {
      font-size: 1rem;
      line-height: 1.6;
      white-space: pre-wrap;
    }
    .empty {
      color: #999;
      font-style: italic;
      margin-top: 2rem;
    }
  </style>
</head>
<body>
  <nav>
    <a href="/journal?token=${encodeURIComponent(token)}" class="active">Journal</a>
    <a href="/ratings?token=${encodeURIComponent(token)}">Ratings</a>
  </nav>

  <h1>Journal</h1>

  <form class="filter" method="GET" action="/journal">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <label>From <input type="date" name="from" value="${from || ""}"></label>
    <label>To <input type="date" name="to" value="${to || ""}"></label>
    <button type="submit">Filter</button>
    <a href="/journal?token=${encodeURIComponent(token)}">Clear</a>
  </form>

  ${entriesHtml}
</body>
</html>`);
    } catch (err) {
      console.error("Error rendering journal:", err);
      res.status(500).send("Something went wrong.");
    }
  });

  // Ratings page — dedicated ratings view with visualizations
  app.get("/ratings", journalAuth, async (req, res) => {
    try {
      const from = req.query.from || null;
      const to = req.query.to || null;
      const token = req.query.token;

      const ratings = await journal.getRatings(from, to);

      // Weekly summary cards
      const today = new Date();
      const dayOfWeek = today.getDay();
      const thisWeekStart = new Date(today);
      thisWeekStart.setDate(today.getDate() - ((dayOfWeek + 6) % 7)); // Monday
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(thisWeekStart.getDate() - 7);

      const formatDateStr = (d) => d.toISOString().split("T")[0];
      const currentWeek = await journal.getWeeklyAverages(formatDateStr(thisWeekStart));
      const prevWeek = await journal.getWeeklyAverages(formatDateStr(lastWeekStart));

      const summaryCardsHtml = renderSummaryCards(currentWeek, prevWeek);
      const gradedBlocksHtml = renderGradedBlocks(ratings, from, to);
      const chartHtml = renderRatingsChart(ratings);
      const categoryBarsHtml = renderCategoryBars(ratings);
      const streaksHtml = renderStreaks(ratings);

      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ratings</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #faf9f6;
      color: #2d2d2d;
      max-width: 640px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }
    nav {
      display: flex;
      gap: 1.5rem;
      margin-bottom: 1.5rem;
    }
    nav a {
      font-size: 0.9rem;
      color: #888;
      text-decoration: none;
    }
    nav a:hover { color: #2d2d2d; }
    nav a.active {
      color: #2d2d2d;
      font-weight: 600;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      color: #1a1a1a;
    }
    .filter {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }
    .filter label { font-size: 0.8rem; color: #666; }
    .filter input[type="date"] {
      font-family: inherit;
      font-size: 0.85rem;
      padding: 0.3rem 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #fff;
    }
    .filter button {
      padding: 0.3rem 1rem;
      background: #2d2d2d;
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .filter a { font-size: 0.8rem; color: #888; }
    .add-rating {
      margin-bottom: 1.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid #e8e6e1;
    }
    .section-title {
      font-size: 0.85rem;
      font-weight: 500;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }
    .add-rating input[type="date"] {
      font-family: inherit;
      font-size: 0.85rem;
      padding: 0.2rem 0.4rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #fff;
    }
    .ratings-row {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .ratings-row label {
      font-size: 0.8rem;
      color: #666;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .ratings-row input[type="number"] {
      width: 3rem;
      padding: 0.2rem 0.4rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 0.85rem;
      text-align: center;
      background: #fff;
    }
    .ratings-row button {
      padding: 0.2rem 0.75rem;
      background: #2d2d2d;
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
    }
    .rating-status {
      font-size: 0.75rem;
      color: #81b29a;
    }
    .summary-cards {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }
    .summary-card {
      flex: 1;
      min-width: 120px;
      padding: 1rem;
      background: #fff;
      border: 1px solid #e8e6e1;
      border-radius: 8px;
    }
    .summary-card .card-label {
      font-size: 0.7rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    .summary-card .card-value {
      font-size: 1.75rem;
      font-weight: 600;
      color: #1a1a1a;
    }
    .summary-card .card-delta {
      font-size: 0.75rem;
      margin-top: 0.25rem;
    }
    .delta-up { color: #81b29a; }
    .delta-down { color: #e07a5f; }
    .delta-flat { color: #aaa; }
    .graded-blocks {
      margin-bottom: 2rem;
    }
    .block-row {
      display: flex;
      align-items: center;
      margin-bottom: 4px;
    }
    .block-row-label {
      font-size: 0.7rem;
      font-weight: 500;
      color: #888;
      width: 70px;
      flex-shrink: 0;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .block-row-cells {
      display: flex;
      gap: 2px;
      flex-wrap: wrap;
    }
    .block-cell {
      width: 18px;
      height: 18px;
      border-radius: 2px;
      cursor: default;
    }
    .block-dates {
      display: flex;
      gap: 2px;
      margin-left: 70px;
      margin-top: 4px;
      margin-bottom: 0.5rem;
    }
    .block-date-label {
      width: 18px;
      font-size: 0.55rem;
      color: #aaa;
      text-align: center;
      overflow: hidden;
    }
    .chart-section { margin-bottom: 2rem; }
    .chart-section h2 {
      font-size: 0.85rem;
      font-weight: 500;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }
    .category-bars { margin-bottom: 2rem; }
    .bar-row {
      display: flex;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .bar-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: #666;
      width: 80px;
      flex-shrink: 0;
    }
    .bar-track {
      flex: 1;
      height: 20px;
      background: #f0eeea;
      border-radius: 4px;
      overflow: hidden;
      position: relative;
    }
    .bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .bar-value {
      font-size: 0.75rem;
      font-weight: 600;
      color: #666;
      width: 35px;
      text-align: right;
      margin-left: 0.5rem;
    }
    .streaks {
      margin-bottom: 2rem;
      padding: 1rem;
      background: #fff;
      border: 1px solid #e8e6e1;
      border-radius: 8px;
      font-size: 0.85rem;
      color: #666;
    }
    .streaks strong { color: #2d2d2d; }
    .empty {
      color: #999;
      font-style: italic;
      margin-top: 2rem;
    }
  </style>
</head>
<body>
  <nav>
    <a href="/journal?token=${encodeURIComponent(token)}">Journal</a>
    <a href="/ratings?token=${encodeURIComponent(token)}" class="active">Ratings</a>
  </nav>

  <h1>Ratings</h1>

  <form class="filter" method="GET" action="/ratings">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <label>From <input type="date" name="from" value="${from || ""}"></label>
    <label>To <input type="date" name="to" value="${to || ""}"></label>
    <button type="submit">Filter</button>
    <a href="/ratings?token=${encodeURIComponent(token)}">Clear</a>
  </form>

  <div class="add-rating">
    <h2 class="section-title">Add Rating</h2>
    <div class="ratings-row" id="add-rating-row">
      <label>Date <input type="date" name="date" value="${new Date().toISOString().split("T")[0]}"></label>
      <label>O <input type="number" name="ovo" min="1" max="10"></label>
      <label>P <input type="number" name="pathfinder" min="1" max="10"></label>
      <label>H <input type="number" name="health" min="1" max="10"></label>
      <button onclick="saveRating(this)">Save</button>
      <span class="rating-status"></span>
    </div>
  </div>

  ${summaryCardsHtml}

  ${gradedBlocksHtml}

  ${chartHtml}

  ${categoryBarsHtml}

  ${streaksHtml}

  <script>
    async function saveRating(btn) {
      var row = btn.closest('.ratings-row');
      var dateInput = row.querySelector('[name=date]');
      var date = dateInput ? dateInput.value : row.dataset.date;
      var body = {
        date: date,
        ovo: parseInt(row.querySelector('[name=ovo]').value) || null,
        pathfinder: parseInt(row.querySelector('[name=pathfinder]').value) || null,
        health: parseInt(row.querySelector('[name=health]').value) || null,
      };
      var status = row.querySelector('.rating-status');
      try {
        var res = await fetch('/journal/ratings?token=${encodeURIComponent(token)}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        status.textContent = res.ok ? 'Saved' : 'Error';
      } catch(e) {
        status.textContent = 'Error';
      }
      setTimeout(function() { status.textContent = ''; }, 2000);
    }
  </script>
</body>
</html>`);
    } catch (err) {
      console.error("Error rendering ratings:", err);
      res.status(500).send("Something went wrong.");
    }
  });

  // Start cron jobs
  scheduler.start();

  // Start server
  app.listen(config.port, () => {
    console.log(`WhatsApp Journal Reminders running on port ${config.port}`);
    console.log(`Webhook URL: http://localhost:${config.port}/webhook`);
    console.log(`Journal page: http://localhost:${config.port}/journal`);
    console.log(`Ratings page: http://localhost:${config.port}/ratings`);
    console.log(`Prompt times: ${config.journalPromptTimes.join(", ")}`);
  });
}

// --- Visualization render helpers ---

const CATEGORIES = [
  { key: "ovo", label: "OVO", color: "#e07a5f", h: 13, s: 68 },
  { key: "pathfinder", label: "Pathfinder", color: "#3d85c6", h: 210, s: 53 },
  { key: "health", label: "Health", color: "#81b29a", h: 153, s: 24 },
];

function scoreToHsl(baseH, baseS, score) {
  if (score == null) return "#eee";
  const lightness = 93 - (score - 1) * (55 / 9);
  return `hsl(${baseH}, ${baseS}%, ${Math.round(lightness)}%)`;
}

function toDateStr(d) {
  return d instanceof Date
    ? d.toISOString().split("T")[0]
    : String(d).split("T")[0];
}

function renderSummaryCards(currentWeek, prevWeek) {
  let html = '<div class="summary-cards">';
  for (const cat of CATEGORIES) {
    const avgKey = `avg_${cat.key}`;
    const curr = currentWeek[avgKey] != null ? parseFloat(currentWeek[avgKey]) : null;
    const prev = prevWeek[avgKey] != null ? parseFloat(prevWeek[avgKey]) : null;

    let deltaHtml = "";
    if (curr != null && prev != null) {
      const diff = curr - prev;
      if (Math.abs(diff) < 0.05) {
        deltaHtml = `<div class="card-delta delta-flat">&mdash; same as last week</div>`;
      } else if (diff > 0) {
        deltaHtml = `<div class="card-delta delta-up">&uarr; +${diff.toFixed(1)} vs last week</div>`;
      } else {
        deltaHtml = `<div class="card-delta delta-down">&darr; ${diff.toFixed(1)} vs last week</div>`;
      }
    } else if (curr != null) {
      deltaHtml = `<div class="card-delta delta-flat">No data last week</div>`;
    }

    html += `
      <div class="summary-card">
        <div class="card-label" style="color:${cat.color}">${cat.label}</div>
        <div class="card-value">${curr != null ? curr.toFixed(1) : "&mdash;"}</div>
        ${deltaHtml}
      </div>`;
  }
  html += "</div>";
  return html;
}

function renderGradedBlocks(ratings, fromDate, toDate) {
  // Build date range — default last 30 days
  const end = toDate ? new Date(toDate + "T00:00:00") : new Date();
  const start = fromDate ? new Date(fromDate + "T00:00:00") : new Date(end);
  if (!fromDate) start.setDate(end.getDate() - 29);

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(toDateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  if (dates.length === 0) return "";

  // Build lookup
  const ratingsMap = {};
  for (const r of ratings) {
    ratingsMap[toDateStr(r.date)] = r;
  }

  let html = `<div class="graded-blocks"><h2 class="section-title">Daily Scores</h2>`;

  for (const cat of CATEGORIES) {
    html += `<div class="block-row">`;
    html += `<span class="block-row-label">${cat.label}</span>`;
    html += `<div class="block-row-cells">`;
    for (const d of dates) {
      const r = ratingsMap[d];
      const score = r ? r[cat.key] : null;
      const bg = scoreToHsl(cat.h, cat.s, score);
      const shortDate = d.slice(5); // MM-DD
      const title = score != null ? `${shortDate}: ${score}/10` : `${shortDate}: -`;
      html += `<div class="block-cell" style="background:${bg}" title="${title}"></div>`;
    }
    html += `</div></div>`;
  }

  // Date labels — show every Nth date
  const step = Math.max(1, Math.floor(dates.length / 10));
  html += `<div class="block-dates">`;
  for (let i = 0; i < dates.length; i++) {
    const label = i % step === 0 ? dates[i].slice(8) : ""; // DD
    html += `<span class="block-date-label">${label}</span>`;
  }
  html += `</div>`;

  // Color legend
  html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.25rem;margin-bottom:0.25rem;">`;
  html += `<span style="font-size:0.65rem;color:#aaa;">Low</span>`;
  for (let s = 1; s <= 10; s++) {
    const bg = scoreToHsl(0, 0, s); // neutral gray gradient for legend
    html += `<div style="width:12px;height:12px;border-radius:2px;background:hsl(0,0%,${Math.round(93 - (s - 1) * (55 / 9))}%)"></div>`;
  }
  html += `<span style="font-size:0.65rem;color:#aaa;">High</span>`;
  html += `</div>`;

  html += `</div>`;
  return html;
}

function renderRatingsChart(ratings) {
  if (ratings.length < 2) {
    return ratings.length === 0
      ? ""
      : '<div class="chart-section"><p class="empty">Need at least 2 days of ratings to show chart.</p></div>';
  }

  const W = 600, H = 220, PAD = 40;
  const plotW = W - 2 * PAD, plotH = H - 2 * PAD;
  const n = ratings.length;

  const toX = (i) => PAD + (i / (n - 1)) * plotW;
  const toY = (val) => PAD + plotH - ((val - 1) / 9) * plotH;

  let paths = "";
  for (const cat of CATEGORIES) {
    const points = [];
    for (let i = 0; i < n; i++) {
      const val = ratings[i][cat.key];
      if (val != null) points.push({ i, val });
    }
    if (points.length > 1) {
      const polyPoints = points.map((p) => `${toX(p.i)},${toY(p.val)}`).join(" ");
      paths += `<polyline points="${polyPoints}" fill="none" stroke="${cat.color}" stroke-width="2" stroke-linejoin="round"/>`;
      for (const p of points) {
        paths += `<circle cx="${toX(p.i)}" cy="${toY(p.val)}" r="3" fill="${cat.color}"/>`;
      }
    }
  }

  // Y-axis gridlines and labels
  let grid = "";
  for (const v of [1, 5, 10]) {
    grid += `<line x1="${PAD}" y1="${toY(v)}" x2="${W - PAD}" y2="${toY(v)}" stroke="#eee"/>`;
    grid += `<text x="${PAD - 8}" y="${toY(v) + 4}" text-anchor="end" font-size="11" fill="#aaa">${v}</text>`;
  }

  // X-axis date labels
  let xLabels = "";
  const step = Math.max(1, Math.floor(n / 6));
  for (let i = 0; i < n; i += step) {
    const d = toDateStr(ratings[i].date).slice(5);
    xLabels += `<text x="${toX(i)}" y="${H - 5}" text-anchor="middle" font-size="10" fill="#aaa">${d}</text>`;
  }

  // Legend
  const legend = CATEGORIES.map((cat, i) =>
    `<circle cx="${PAD + i * 110}" cy="12" r="4" fill="${cat.color}"/>` +
    `<text x="${PAD + i * 110 + 8}" y="16" font-size="11" fill="#666">${cat.label}</text>`
  ).join("");

  return `
    <div class="chart-section">
      <h2>Trends</h2>
      <svg viewBox="0 0 ${W} ${H + 10}" width="100%" style="max-width:${W}px">
        ${grid}${xLabels}${paths}${legend}
      </svg>
    </div>`;
}

function renderCategoryBars(ratings) {
  if (ratings.length === 0) return "";

  let html = `<div class="category-bars"><h2 class="section-title">Category Averages</h2>`;

  for (const cat of CATEGORIES) {
    const values = ratings.map((r) => r[cat.key]).filter((v) => v != null);
    if (values.length === 0) {
      html += `
        <div class="bar-row">
          <span class="bar-label">${cat.label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:0%;background:${cat.color}"></div></div>
          <span class="bar-value">&mdash;</span>
        </div>`;
      continue;
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const pct = (avg / 10) * 100;
    html += `
      <div class="bar-row">
        <span class="bar-label">${cat.label}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${cat.color}"></div></div>
        <span class="bar-value">${avg.toFixed(1)}</span>
      </div>`;
  }

  html += `</div>`;
  return html;
}

function renderStreaks(ratings) {
  if (ratings.length === 0) return "";

  // Sort by date ascending and compute streaks
  const sorted = ratings
    .map((r) => toDateStr(r.date))
    .sort();

  // Deduplicate
  const uniqueDates = [...new Set(sorted)];

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 1;

  // Check if today or yesterday is in the data to determine current streak
  const today = new Date();
  const todayStr = toDateStr(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);

  // Build streaks
  for (let i = 1; i < uniqueDates.length; i++) {
    const prev = new Date(uniqueDates[i - 1] + "T00:00:00");
    const curr = new Date(uniqueDates[i] + "T00:00:00");
    const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);

    if (diffDays === 1) {
      tempStreak++;
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak);

  // Current streak: count backwards from last rated date
  const lastRated = uniqueDates[uniqueDates.length - 1];
  if (lastRated === todayStr || lastRated === yesterdayStr) {
    currentStreak = 1;
    for (let i = uniqueDates.length - 2; i >= 0; i--) {
      const curr = new Date(uniqueDates[i + 1] + "T00:00:00");
      const prev = new Date(uniqueDates[i] + "T00:00:00");
      if ((curr - prev) / (1000 * 60 * 60 * 24) === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  return `
    <div class="streaks">
      <h2 class="section-title" style="margin-bottom:0.5rem">Consistency</h2>
      Current streak: <strong>${currentStreak} day${currentStreak !== 1 ? "s" : ""}</strong>
      &middot;
      Longest streak: <strong>${longestStreak} day${longestStreak !== 1 ? "s" : ""}</strong>
      &middot;
      Total days rated: <strong>${uniqueDates.length}</strong>
    </div>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
