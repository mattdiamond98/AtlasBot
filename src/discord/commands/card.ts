import {
  AttachmentBuilder,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import {
  findCardByName,
  searchCards,
} from "../../services/card-catalog.js";

export const data = new SlashCommandBuilder()
  .setName("card")
  .setDescription("Post an Atlas Conquest card image")
  .addStringOption((o) =>
    o
      .setName("name")
      .setDescription("Card name (start typing to search)")
      .setRequired(true)
      .setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused();
  try {
    const matches = await searchCards(focused, 25);
    await interaction.respond(
      matches.map((m) => ({ name: m.name, value: m.name })),
    );
  } catch {
    await interaction.respond([]);
  }
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString("name", true);

  let card = await findCardByName(query).catch(() => null);
  if (!card) {
    const matches = await searchCards(query, 5).catch(() => []);
    if (matches.length === 1) {
      card = matches[0];
    } else if (matches.length === 0) {
      await interaction.reply({
        content: `No card found matching "${query}".`,
        ephemeral: true,
      });
      return;
    } else {
      const list = matches.map((m) => `• ${m.name}`).join("\n");
      await interaction.reply({
        content: `Multiple matches for "${query}":\n${list}\n\nRun \`/card\` again and pick one from the autocomplete.`,
        ephemeral: true,
      });
      return;
    }
  }

  await interaction.deferReply();
  try {
    const res = await fetch(card.imageUrl);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const attachment = new AttachmentBuilder(buffer, { name: card.filename });
    await interaction.editReply({
      content: `**${card.name}**`,
      files: [attachment],
    });
  } catch {
    await interaction.editReply({
      content: `**${card.name}**\n${card.imageUrl}`,
    });
  }
}
