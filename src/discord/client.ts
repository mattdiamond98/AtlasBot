import { Client, GatewayIntentBits, Partials } from "discord.js";

// Only the Guilds intent. We use slash commands + component interactions, so
// no MessageContent intent. We don't need GuildMembers either — member lookups
// go through the REST API (`guild.members.fetch(id)`).
export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});
