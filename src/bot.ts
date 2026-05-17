import { Events, Interaction } from "discord.js";
import { config } from "./config.js";
import { client } from "./discord/client.js";
import * as leagueCmd from "./discord/commands/league.js";
import * as matchCmd from "./discord/commands/match.js";
import * as adminCmd from "./discord/commands/admin.js";
import * as cardCmd from "./discord/commands/card.js";
import {
  handleButton,
  handleReportSelect,
  isReportSelect,
} from "./discord/handlers/buttons.js";

const commands = {
  league: leagueCmd,
  match: matchCmd,
  admin: adminCmd,
  card: cardCmd,
};

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const handler = commands[interaction.commandName as keyof typeof commands];
      if (!handler) {
        await interaction.reply({
          content: `Unknown command: ${interaction.commandName}`,
          ephemeral: true,
        });
        return;
      }
      await handler.execute(interaction);
      return;
    }
    if (interaction.isAutocomplete()) {
      const handler = commands[interaction.commandName as keyof typeof commands];
      if (handler && "autocomplete" in handler && typeof handler.autocomplete === "function") {
        await handler.autocomplete(interaction);
      } else {
        await interaction.respond([]);
      }
      return;
    }
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }
    if (interaction.isStringSelectMenu()) {
      if (isReportSelect(interaction.customId)) {
        await handleReportSelect(interaction);
      }
      return;
    }
  } catch (err) {
    console.error("Interaction handler error:", err);
    if (
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction
        .reply({
          content: "Something went wrong. Please try again.",
          ephemeral: true,
        })
        .catch(() => undefined);
    }
  }
});

client.login(config.DISCORD_TOKEN).catch((err) => {
  console.error("Failed to log in:", err);
  process.exit(1);
});
