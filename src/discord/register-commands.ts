import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { data as leagueData } from "./commands/league.js";
import { data as matchData } from "./commands/match.js";
import { data as adminData } from "./commands/admin.js";
import { data as cardData } from "./commands/card.js";

async function main() {
  const commands = [leagueData, matchData, adminData, cardData].map((c) => c.toJSON());
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

  console.log(`Registering ${commands.length} commands to guild ${config.DISCORD_GUILD_ID}...`);
  await rest.put(
    Routes.applicationGuildCommands(
      config.DISCORD_CLIENT_ID,
      config.DISCORD_GUILD_ID,
    ),
    { body: commands },
  );
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
