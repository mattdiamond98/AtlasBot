import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { prisma } from "../../db/client.js";
import {
  MatchServiceError,
  ReportResult,
  findActiveRoundMatchForPlayer,
  playerRelativeToAB,
  reportMatch,
} from "../../services/match-service.js";
import { CustomId } from "../lib/ids.js";
import { getCurrentLeague } from "../lib/permissions.js";

type ResultChoice = "2_0" | "2_1" | "lost_1_2" | "lost_0_2" | "draw";

export const data = new SlashCommandBuilder()
  .setName("match")
  .setDescription("Match reporting")
  .addSubcommand((s) =>
    s
      .setName("report")
      .setDescription("Report your current-round match result")
      .addStringOption((o) =>
        o
          .setName("result")
          .setDescription("Your result")
          .setRequired(true)
          .addChoices(
            { name: "I won 2-0", value: "2_0" },
            { name: "I won 2-1", value: "2_1" },
            { name: "I lost 1-2", value: "lost_1_2" },
            { name: "I lost 0-2", value: "lost_0_2" },
            { name: "Draw 1-1", value: "draw" },
          ),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub !== "report") {
    await interaction.reply({
      content: `Unknown subcommand: ${sub}`,
      ephemeral: true,
    });
    return;
  }
  return handleReport(interaction);
}

async function handleReport(interaction: ChatInputCommandInteraction) {
  const league = await getCurrentLeague();
  if (!league || league.status !== "ACTIVE") {
    await interaction.reply({
      content: "No league is currently active.",
      ephemeral: true,
    });
    return;
  }
  const player = await prisma.player.findUnique({
    where: { discordUserId: interaction.user.id },
  });
  if (!player) {
    await interaction.reply({
      content: "You aren't registered for this league.",
      ephemeral: true,
    });
    return;
  }
  const match = await findActiveRoundMatchForPlayer({
    leagueId: league.id,
    playerId: player.id,
  });
  if (!match) {
    await interaction.reply({
      content:
        "Couldn't find your current-round match. If you have one, report from the match thread using the **Report Result** button.",
      ephemeral: true,
    });
    return;
  }
  if (match.status === "BYE") {
    await interaction.reply({
      content: "You have a bye this round — nothing to report.",
      ephemeral: true,
    });
    return;
  }

  const choice = interaction.options.getString("result", true) as ResultChoice;
  const reporterIsA = match.playerAId === player.id;
  const result: ReportResult = playerRelativeToAB(reporterIsA, choice);

  try {
    await reportMatch({
      matchId: match.id,
      reporterPlayerId: player.id,
      result,
    });
  } catch (err) {
    await interaction.reply({
      content:
        err instanceof MatchServiceError
          ? err.message
          : "Unexpected error reporting match.",
      ephemeral: true,
    });
    return;
  }

  await postConfirmationRequest({
    interaction,
    matchId: match.id,
    threadId: match.threadId,
    reporterIsA,
    result,
    aId: match.playerAId,
    bId: match.playerBId!,
  });

  await interaction.reply({
    content: "Reported. Waiting for your opponent to confirm.",
    ephemeral: true,
  });
}

export async function postConfirmationRequest(args: {
  interaction: ChatInputCommandInteraction;
  matchId: number;
  threadId: string | null;
  reporterIsA: boolean;
  result: ReportResult;
  aId: number;
  bId: number;
}) {
  const { interaction, matchId, threadId, reporterIsA, result, aId, bId } =
    args;
  const opponentId = reporterIsA ? bId : aId;
  const opponent = await prisma.player.findUnique({
    where: { id: opponentId },
  });

  const description = describeResult(result, reporterIsA);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CustomId.matchConfirm(matchId))
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(CustomId.matchDispute(matchId))
      .setLabel("Dispute")
      .setStyle(ButtonStyle.Danger),
  );

  const embed = new EmbedBuilder()
    .setTitle("Match result reported")
    .setDescription(
      [
        `Reported by ${interaction.user}`,
        description,
        "",
        opponent
          ? `<@${opponent.discordUserId}>, please confirm or dispute.`
          : "Opponent: confirm or dispute below.",
      ].join("\n"),
    )
    .setColor(0xd69e2e);

  if (threadId) {
    const thread = await interaction.client.channels.fetch(threadId).catch(() => null);
    if (thread && thread.isTextBased() && "send" in thread) {
      await thread.send({
        content: opponent ? `<@${opponent.discordUserId}>` : undefined,
        embeds: [embed],
        components: [row],
      });
    }
  }
}

function describeResult(result: ReportResult, reporterIsA: boolean): string {
  switch (result) {
    case "A_2_0":
      return reporterIsA ? "Reporter won **2-0**" : "Reporter lost **0-2**";
    case "A_2_1":
      return reporterIsA ? "Reporter won **2-1**" : "Reporter lost **1-2**";
    case "B_2_1":
      return reporterIsA ? "Reporter lost **1-2**" : "Reporter won **2-1**";
    case "B_2_0":
      return reporterIsA ? "Reporter lost **0-2**" : "Reporter won **2-0**";
    case "DRAW":
      return "Draw **1-1**";
  }
}
