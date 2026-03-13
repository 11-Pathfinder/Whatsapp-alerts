const cron = require("node-cron");
const config = require("./config");
const { sendTemplateMessage, sendTextMessage } = require("./whatsapp");

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

  // Schedule daily rating prompt
  const [rHour, rMinute] = config.ratingPromptTime.split(":");
  const ratingCron = `${rMinute} ${rHour} * * *`;

  if (cron.validate(ratingCron)) {
    cron.schedule(ratingCron, async () => {
      console.log("Sending daily rating prompt...");
      try {
        await sendTextMessage(
          config.recipientPhone,
          "How was your day? Rate 1-10:\nO:_ P:_ H:_\n(OVO / Pathfinder / Health)"
        );
      } catch (err) {
        console.error("Failed to send rating prompt:", err);
      }
    });
    console.log(`Scheduled rating prompt at ${config.ratingPromptTime} (cron: ${ratingCron})`);
  }
}

module.exports = { start };
