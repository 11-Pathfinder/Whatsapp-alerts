const dotenv = require("dotenv");
dotenv.config();

const required = [
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_TEMPLATE_NAME",
  "RECIPIENT_PHONE_NUMBER",
  "WEBHOOK_VERIFY_TOKEN",
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env and fill in the values.");
  process.exit(1);
}

module.exports = {
  whatsapp: {
    apiVersion: process.env.WHATSAPP_API_VERSION || "v21.0",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    templateName: process.env.WHATSAPP_TEMPLATE_NAME,
  },
  recipientPhone: process.env.RECIPIENT_PHONE_NUMBER,
  webhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN,
  port: parseInt(process.env.PORT, 10) || 3000,
  journalPromptTimes: (process.env.JOURNAL_PROMPT_TIMES || "09:00,21:00")
    .split(",")
    .map((t) => t.trim()),
};
