const config = require("./config");

const BASE_URL = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

async function sendTemplateMessage() {
  const body = {
    messaging_product: "whatsapp",
    to: config.recipientPhone,
    type: "template",
    template: {
      name: config.whatsapp.templateName,
      language: { code: "en_US" },
    },
  };

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Failed to send template message:", data);
    return null;
  }

  console.log(`Journal prompt sent to ${config.recipientPhone} at ${new Date().toISOString()}`);
  return data;
}

module.exports = { sendTemplateMessage };
