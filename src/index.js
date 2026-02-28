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

  // Journal webpage (protected by token auth)
  app.get("/journal", (req, res, next) => {
    const token = config.journalAuthToken;
    if (!token) {
      return res.status(503).send("Journal auth token not configured.");
    }
    const provided = req.query.token || req.headers["x-auth-token"];
    if (provided !== token) {
      return res.status(401).send("Unauthorized.");
    }
    next();
  }, async (_req, res) => {
    try {
      const entries = await journal.getAllEntriesGroupedByDate();

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
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 2rem;
      color: #1a1a1a;
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
  ${entriesHtml}
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
