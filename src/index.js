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

  // Journal webpage
  app.get("/journal", journalAuth, async (req, res) => {
    try {
      const from = req.query.from || null;
      const to = req.query.to || null;
      const token = req.query.token;

      const entries = await journal.getAllEntriesGroupedByDate(from, to);
      const ratings = await journal.getRatings(from, to);

      // Build ratings lookup by date
      const ratingsMap = {};
      for (const r of ratings) {
        const d = r.date instanceof Date
          ? r.date.toISOString().split("T")[0]
          : String(r.date).split("T")[0];
        ratingsMap[d] = r;
      }

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

      // Build chart SVG
      const chartHtml = renderRatingsChart(ratings);

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

          const dayRating = ratingsMap[date];

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
              <div class="ratings-row" data-date="${date}">
                <label>O <input type="number" name="ovo" min="1" max="10" value="${dayRating?.ovo ?? ""}"></label>
                <label>P <input type="number" name="pathfinder" min="1" max="10" value="${dayRating?.pathfinder ?? ""}"></label>
                <label>H <input type="number" name="health" min="1" max="10" value="${dayRating?.health ?? ""}"></label>
                <button onclick="saveRating(this)">Save</button>
                <span class="rating-status"></span>
              </div>
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
    .filter label {
      font-size: 0.8rem;
      color: #666;
    }
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
    .filter a {
      font-size: 0.8rem;
      color: #888;
    }
    .chart-section {
      margin-bottom: 2rem;
    }
    .chart-section h2 {
      font-size: 0.85rem;
      font-weight: 500;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }
    .day {
      margin-bottom: 2rem;
    }
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
    .ratings-row {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 0.75rem;
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
    .entry {
      display: flex;
      gap: 1rem;
      padding: 0.75rem 0;
    }
    .entry + .entry {
      border-top: 1px solid #f0eeea;
    }
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
  <h1>Journal</h1>

  <form class="filter" method="GET" action="/journal">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <label>From <input type="date" name="from" value="${from || ""}"></label>
    <label>To <input type="date" name="to" value="${to || ""}"></label>
    <button type="submit">Filter</button>
    <a href="/journal?token=${encodeURIComponent(token)}">Clear</a>
  </form>

  ${chartHtml}

  ${entriesHtml}

  <script>
    async function saveRating(btn) {
      var row = btn.closest('.ratings-row');
      var date = row.dataset.date;
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
      console.error("Error rendering journal:", err);
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
    console.log(`Prompt times: ${config.journalPromptTimes.join(", ")}`);
  });
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

  const categories = [
    { key: "ovo", color: "#e07a5f", label: "OVO" },
    { key: "pathfinder", color: "#3d85c6", label: "Pathfinder" },
    { key: "health", color: "#81b29a", label: "Health" },
  ];

  let paths = "";
  for (const cat of categories) {
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
    const d = ratings[i].date instanceof Date
      ? ratings[i].date.toISOString().split("T")[0].slice(5)
      : String(ratings[i].date).split("T")[0].slice(5);
    xLabels += `<text x="${toX(i)}" y="${H - 5}" text-anchor="middle" font-size="10" fill="#aaa">${d}</text>`;
  }

  // Legend
  const legend = categories.map((cat, i) =>
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
