const cron = require("node-cron");
const config = require("./config");
const { sendTemplateMessage } = require("./whatsapp");

function start() {
  for (const time of config.journalPromptTimes) {
    const [hour, minute] = time.split(":");
    const expression = `${minute} ${hour} * * *`;

    if (!cron.validate(expression)) {
      console.error(`Invalid cron expression for time "${time}": ${expression}`);
      continue;
    }

    cron.schedule(expression, async () => {
      console.log(`Cron triggered for ${time} — sending journal prompt...`);
      try {
        await sendTemplateMessage();
      } catch (err) {
        console.error(`Failed to send prompt for ${time}:`, err);
      }
    });

    console.log(`Scheduled journal prompt at ${time} (cron: ${expression})`);
  }
}

module.exports = { start };
