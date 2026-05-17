import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { prisma } from "../../db/client.js";
import {
  MatchServiceError,
  ReportResult,
  confirmMatch,
  disputeMatch,
  playerRelativeToAB,
  reportMatch,
} from "../../services/match-service.js";
import {
  LeagueServiceError,
  joinLeague,
} from "../../services/league-service.js";
import { CustomId, parseCustomId } from "../lib/ids.js";
import { getCurrentLeague } from "../lib/permissions.js";

type ResultChoice = "2_0" | "2_1" | "lost_1_2" | "lost_0_2" | "draw";

const RESULT_CHOICES: Array<{ label: string; value: ResultChoice }> = [
  { label: "I won 2-0", value: "2_0" },
  { label: "I won 2-1", value: "2_1" },
  { label: "I lost 1-2", value: "lost_1_2" },
  { label: "I lost 0-2", value: "lost_0_2" },
  { label: "Draw 1-1", value: "draw" },
];

const REPORT_SELECT_PREFIX = "match:report-select:";

export async function handleButton(interaction: ButtonInteraction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return;

  if (parsed.namespace === "league") {
    if (parsed.action === "join") {
      return handleLeagueJoinButton(interaction, Number(parsed.arg));
    }
    return;
  }

  if (parsed.namespace !== "match") return;
  switch (parsed.action) {
    case "report":
      return handleReportButton(interaction, Number(parsed.arg));
    case "confirm":
      return handleConfirm(interaction, Number(parsed.arg));
    case "dispute":
      return handleDispute(interaction, Number(parsed.arg));
  }
}

async function handleLeagueJoinButton(
  interaction: ButtonInteraction,
  leagueId: number,
) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) {
    await interaction.reply({ content: "League not found.", ephemeral: true });
    return;
  }
  if (league.status !== "REGISTRATION_OPEN") {
    await interaction.reply({
      content: `Registration is closed for **${league.name}**.`,
      ephemeral: true,
    });
    return;
  }
  const member =
    interaction.member && "displayName" in interaction.member
      ? (interaction.member as { displayName?: string })
      : null;
  const displayName =
    member?.displayName ??
    interaction.user.globalName ??
    interaction.user.username;
  try {
    const result = await joinLeague({
      leagueId,
      discordUserId: interaction.user.id,
      displayName,
    });
    await interaction.reply({
      content: result.alreadyJoined
        ? `You're already registered for **${league.name}**.`
        : `Welcome to **${league.name}**! You're registered.`,
      ephemeral: true,
    });
  } catch (err) {
    await interaction.reply({
      content:
        err instanceof LeagueServiceError ? err.message : "Unexpected error.",
      ephemeral: true,
    });
  }
}

async function handleReportButton(
  interaction: ButtonInteraction,
  matchId: number,
) {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) {
    await interaction.reply({ content: "Match not found.", ephemeral: true });
    return;
  }
  const player = await prisma.player.findUnique({
    where: { discordUserId: interaction.user.id },
  });
  if (
    !player ||
    (player.id !== match.playerAId && player.id !== match.playerBId)
  ) {
    await interaction.reply({
      content: "You aren't a participant in this match.",
      ephemeral: true,
    });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${REPORT_SELECT_PREFIX}${matchId}`)
    .setPlaceholder("Pick your result")
    .addOptions(
      RESULT_CHOICES.map((c) => ({ label: c.label, value: c.value })),
    );
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    select,
  );
  await interaction.reply({
    content: "What was the result?",
    components: [row],
    ephemeral: true,
  });
}

export async function handleReportSelect(
  interaction: StringSelectMenuInteraction,
) {
  if (!interaction.customId.startsWith(REPORT_SELECT_PREFIX)) return;
  const matchId = Number(interaction.customId.slice(REPORT_SELECT_PREFIX.length));
  if (!Number.isFinite(matchId)) return;

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) {
    await interaction.update({ content: "Match not found.", components: [] });
    return;
  }
  const player = await prisma.player.findUnique({
    where: { discordUserId: interaction.user.id },
  });
  if (
    !player ||
    (player.id !== match.playerAId && player.id !== match.playerBId)
  ) {
    await interaction.update({
      content: "You aren't a participant in this match.",
      components: [],
    });
    return;
  }

  const choice = interaction.values[0] as ResultChoice;
  const reporterIsA = match.playerAId === player.id;
  const result: ReportResult = playerRelativeToAB(reporterIsA, choice);

  try {
    await reportMatch({
      matchId,
      reporterPlayerId: player.id,
      result,
    });
  } catch (err) {
    await interaction.update({
      content:
        err instanceof MatchServiceError
          ? err.message
          : "Unexpected error reporting match.",
      components: [],
    });
    return;
  }

  // Post the confirm/dispute prompt in the thread (which is where this button
  // was originally rendered).
  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CustomId.matchConfirm(matchId))
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(CustomId.matchDispute(matchId))
      .setLabel("Dispute")
      .setStyle(ButtonStyle.Danger),
  );

  const opponentId = reporterIsA ? match.playerBId : match.playerAId;
  const opponent = opponentId
    ? await prisma.player.findUnique({ where: { id: opponentId } })
    : null;

  // Update the ephemeral reply so the reporter sees confirmation.
  await interaction.update({
    content: "Result reported. Waiting for opponent.",
    components: [],
  });

  // Post the confirm/dispute message in the thread.
  if (interaction.channel && "send" in interaction.channel) {
    await interaction.channel.send({
      content: opponent
        ? `<@${opponent.discordUserId}>, please confirm or dispute.`
        : "Opponent: please confirm or dispute.",
      embeds: [
        {
          title: "Match result reported",
          description: `Reported by ${interaction.user}: ${describeResult(result, reporterIsA)}`,
          color: 0xd69e2e,
        },
      ],
      components: [confirmRow],
    });
  }
}

async function handleConfirm(interaction: ButtonInteraction, matchId: number) {
  const player = await prisma.player.findUnique({
    where: { discordUserId: interaction.user.id },
  });
  if (!player) {
    await interaction.reply({
      content: "You aren't registered as a player.",
      ephemeral: true,
    });
    return;
  }
  try {
    await confirmMatch({ matchId, confirmerPlayerId: player.id });
  } catch (err) {
    await interaction.reply({
      content:
        err instanceof MatchServiceError ? err.message : "Unexpected error.",
      ephemeral: true,
    });
    return;
  }
  await interaction.update({
    content: "✅ Result confirmed.",
    embeds: interaction.message.embeds,
    components: [], // strip buttons
  });
}

async function handleDispute(interaction: ButtonInteraction, matchId: number) {
  const player = await prisma.player.findUnique({
    where: { discordUserId: interaction.user.id },
  });
  if (!player) {
    await interaction.reply({
      content: "You aren't registered as a player.",
      ephemeral: true,
    });
    return;
  }
  try {
    await disputeMatch({ matchId, disputerPlayerId: player.id });
  } catch (err) {
    await interaction.reply({
      content:
        err instanceof MatchServiceError ? err.message : "Unexpected error.",
      ephemeral: true,
    });
    return;
  }
  const league = await getCurrentLeague();
  const ping = league ? `<@&${league.organizerRoleId}>` : "Organizers";
  await interaction.update({
    content: `⚠️ Result disputed by ${interaction.user}. ${ping} please resolve with \`/admin set-result\`.`,
    embeds: interaction.message.embeds,
    components: [],
  });
}

function describeResult(result: ReportResult, reporterIsA: boolean): string {
  switch (result) {
    case "A_2_0":
      return reporterIsA ? "won **2-0**" : "lost **0-2**";
    case "A_2_1":
      return reporterIsA ? "won **2-1**" : "lost **1-2**";
    case "B_2_1":
      return reporterIsA ? "lost **1-2**" : "won **2-1**";
    case "B_2_0":
      return reporterIsA ? "lost **0-2**" : "won **2-0**";
    case "DRAW":
      return "**1-1** draw";
  }
}

export function isReportSelect(customId: string): boolean {
  return customId.startsWith(REPORT_SELECT_PREFIX);
}
