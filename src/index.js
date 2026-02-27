const express = require("express");
const config = require("./config");
const journal = require("./journal");
const webhookRouter = require("./webhook");
const scheduler = require("./scheduler");

// Initialize database
journal.init();

// Set up Express server
const app = express();
app.use(express.json());
app.use(webhookRouter);

// Health check
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "whatsapp-journal-reminders" });
});

// Start cron jobs
scheduler.start();

// Start server
app.listen(config.port, () => {
  console.log(`WhatsApp Journal Reminders running on port ${config.port}`);
  console.log(`Webhook URL: http://localhost:${config.port}/webhook`);
  console.log(`Prompt times: ${config.journalPromptTimes.join(", ")}`);
});
