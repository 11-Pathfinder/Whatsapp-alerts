const crypto = require("crypto");
const express = require("express");
const config = require("./config");
const journal = require("./journal");

const router = express.Router();

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
      await journal.saveEntry(phoneNumber, text);
    }
  } catch (err) {
    console.error("Error processing webhook:", err);
  }
});

module.exports = router;
