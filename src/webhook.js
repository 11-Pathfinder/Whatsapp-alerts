const crypto = require("crypto");
const express = require("express");
const config = require("./config");
const journal = require("./journal");

const router = express.Router();

function parseRatings(text) {
  const trimmed = text.trim();
  const oMatch = trimmed.match(/\bO\s*:\s*(\d{1,2})\b/i);
  const pMatch = trimmed.match(/\bP\s*:\s*(\d{1,2})\b/i);
  const hMatch = trimmed.match(/\bH\s*:\s*(\d{1,2})\b/i);

  if (!oMatch && !pMatch && !hMatch) return null;

  // If there's non-rating text, treat as a journal entry
  const stripped = trimmed
    .replace(/\b[OPH]\s*:\s*\d{1,2}\b/gi, "")
    .replace(/[,\s]+/g, "")
    .trim();
  if (stripped.length > 0) return null;

  const validate = (match) => {
    if (!match) return null;
    const val = parseInt(match[1], 10);
    return val >= 1 && val <= 10 ? val : null;
  };

  const ratings = {
    ovo: oMatch ? validate(oMatch) : null,
    pathfinder: pMatch ? validate(pMatch) : null,
    health: hMatch ? validate(hMatch) : null,
  };

  if (Object.values(ratings).every((v) => v === null)) return null;
  return ratings;
}

// Verify Meta webhook signature (HMAC-SHA256 with App Secret)
function verifySignature(req, res, next) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) {
    console.warn("Webhook rejected — missing x-hub-signature-256 header.");
    return res.sendStatus(401);
  }

  const expectedHash = crypto
    .createHmac("sha256", config.whatsapp.appSecret)
    .update(req.rawBody)
    .digest("hex");

  const expected = `sha256=${expectedHash}`;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    console.warn("Webhook rejected — invalid signature.");
    return res.sendStatus(401);
  }

  next();
}

// GET /webhook — Meta verification handshake
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.webhookVerifyToken) {
    console.log("Webhook verified successfully.");
    return res.status(200).send(challenge);
  }

  console.warn("Webhook verification failed — token mismatch.");
  return res.sendStatus(403);
});

// POST /webhook — Incoming messages from Meta (signature-verified)
router.post("/webhook", verifySignature, async (req, res) => {
  // Always respond 200 quickly — Meta will retry on timeouts
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages) return; // status update, not a message

    for (const message of value.messages) {
      if (message.type !== "text") {
        console.log(`Skipping non-text message (type: ${message.type})`);
        continue;
      }

      const phoneNumber = message.from;
      const text = message.text.body;

      console.log(`Received journal reply from ${phoneNumber}: "${text}"`);

      const ratings = parseRatings(text);
      if (ratings) {
        const today = new Date().toISOString().split("T")[0];
        await journal.saveRatings(phoneNumber, today, ratings);
        console.log(`Ratings saved for ${phoneNumber}: ${JSON.stringify(ratings)}`);
        continue;
      }

      await journal.saveEntry(phoneNumber, text);
    }
  } catch (err) {
    console.error("Error processing webhook:", err);
  }
});

module.exports = router;
