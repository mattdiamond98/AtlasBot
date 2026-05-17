import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { prisma } from "../../db/client.js";
import {
  LeagueServiceError,
  dropFromLeague,
  joinLeague,
} from "../../services/league-service.js";
import {
  MatchServiceError,
  ReportResult,
  adminSetResult,
} from "../../services/match-service.js";
import {
  denyNonOrganizer,
  getCurrentLeague,
  isOrganizer,
} from "../lib/permissions.js";

export const data = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("Organizer-only league overrides")
  .addSubcommand((s) =>
    s
      .setName("set-result")
      .setDescription("Manually set a match result")
      .addUserOption((o) =>
        o.setName("player_a").setDescription("Player A").setRequired(true),
      )
      .addUserOption((o) =>
        o.setName("player_b").setDescription("Player B").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("result")
          .setDescription("Outcome")
          .setRequired(true)
          .addChoices(
            { name: "Player A wins 2-0", value: "A_2_0" },
            { name: "Player A wins 2-1", value: "A_2_1" },
            { name: "Player B wins 2-1", value: "B_2_1" },
            { name: "Player B wins 2-0", value: "B_2_0" },
            { name: "Draw 1-1", value: "DRAW" },
          ),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("drop-player")
      .setDescription("Drop a player from the current league")
      .addUserOption((o) =>
        o.setName("player").setDescription("Player to drop").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("add-player")
      .setDescription("Add a player to the current league")
      .addUserOption((o) =>
        o.setName("player").setDescription("Player to add").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("accept-reported")
      .setDescription(
        "Confirm every reported-but-unconfirmed match in the current round",
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("draw-unreported")
      .setDescription(
        "Mark every unreported match in the current round as a 1-1 draw",
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const league = await getCurrentLeague();
  if (!league) {
    await interaction.reply({
      content: "No league is currently open.",
      ephemeral: true,
    });
    return;
  }
  if (!(await isOrganizer(interaction, league.organizerRoleId))) {
    return denyNonOrganizer(interaction);
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case "set-result":
      return handleSetResult(interaction, league.id);
    case "drop-player":
      return handleDropPlayer(interaction, league.id);
    case "add-player":
      return handleAddPlayer(interaction, league.id);
    case "accept-reported":
      return handleAcceptReported(interaction, league.id, league.currentRoundNumber, league.status);
    case "draw-unreported":
      return handleDrawUnreported(interaction, league.id, league.currentRoundNumber, league.status);
    default:
      await interaction.reply({
        content: `Unknown subcommand: ${sub}`,
        ephemeral: true,
      });
  }
}

async function handleSetResult(
  interaction: ChatInputCommandInteraction,
  leagueId: number,
) {
  const userA = interaction.options.getUser("player_a", true);
  const userB = interaction.options.getUser("player_b", true);
  const result = interaction.options.getString("result", true) as ReportResult;

  const playerA = await prisma.player.findUnique({
    where: { discordUserId: userA.id },
  });
  const playerB = await prisma.player.findUnique({
    where: { discordUserId: userB.id },
  });
  if (!playerA || !playerB) {
    await interaction.reply({
      content: "One of those users isn't registered as a player.",
      ephemeral: true,
    });
    return;
  }

  // Find the match between them in the active round.
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) return;
  const round = await prisma.round.findUnique({
    where: {
      leagueId_roundNumber: {
        leagueId,
        roundNumber: league.currentRoundNumber,
      },
    },
    include: {
      matches: {
        where: {
          OR: [
            { playerAId: playerA.id, playerBId: playerB.id },
            { playerAId: playerB.id, playerBId: playerA.id },
          ],
        },
      },
    },
  });
  const match = round?.matches[0];
  if (!match) {
    await interaction.reply({
      content: "No match between those players in the current round.",
      ephemeral: true,
    });
    return;
  }
  // If the stored A/B ordering is reversed vs. the user inputs, swap.
  const storedAIsUserA = match.playerAId === playerA.id;
  const adjusted: ReportResult = storedAIsUserA ? result : swapAB(result);

  try {
    await adminSetResult({ matchId: match.id, result: adjusted });
    await interaction.reply({
      content: `Match result set. (Match #${match.id})`,
      ephemeral: true,
    });
  } catch (err) {
    await interaction.reply({
      content:
        err instanceof MatchServiceError
          ? err.message
          : "Unexpected error.",
      ephemeral: true,
    });
  }
}

async function handleDropPlayer(
  interaction: ChatInputCommandInteraction,
  leagueId: number,
) {
  const user = interaction.options.getUser("player", true);
  const result = await dropFromLeague({
    leagueId,
    discordUserId: user.id,
  });
  await interaction.reply({
    content: result.dropped
      ? `Dropped <@${user.id}> from the league.`
      : `<@${user.id}> wasn't an active participant.`,
    ephemeral: true,
  });
}

async function handleAddPlayer(
  interaction: ChatInputCommandInteraction,
  leagueId: number,
) {
  const user = interaction.options.getUser("player", true);
  try {
    const result = await joinLeague({
      leagueId,
      discordUserId: user.id,
      displayName: user.globalName ?? user.username,
    });
    await interaction.reply({
      content: result.alreadyJoined
        ? `<@${user.id}> was already in the league.`
        : `Added <@${user.id}> to the league.`,
      ephemeral: true,
    });
  } catch (err) {
    await interaction.reply({
      content:
        err instanceof LeagueServiceError
          ? err.message
          : "Unexpected error.",
      ephemeral: true,
    });
  }
}

async function handleAcceptReported(
  interaction: ChatInputCommandInteraction,
  leagueId: number,
  currentRoundNumber: number,
  leagueStatus: string,
) {
  if (leagueStatus !== "ACTIVE" || currentRoundNumber === 0) {
    await interaction.reply({
      content: "No active round to act on.",
      ephemeral: true,
    });
    return;
  }
  const round = await prisma.round.findUnique({
    where: {
      leagueId_roundNumber: { leagueId, roundNumber: currentRoundNumber },
    },
    include: { matches: true },
  });
  if (!round) {
    await interaction.reply({
      content: `Round ${currentRoundNumber} not found.`,
      ephemeral: true,
    });
    return;
  }
  const reported = round.matches.filter((m) => m.status === "REPORTED");
  if (reported.length === 0) {
    await interaction.reply({
      content: `No reported-but-unconfirmed matches in Round ${currentRoundNumber}.`,
      ephemeral: true,
    });
    return;
  }
  const now = new Date();
  await prisma.$transaction(
    reported.map((m) =>
      prisma.match.update({
        where: { id: m.id },
        data: { status: "CONFIRMED", confirmedAt: now },
      }),
    ),
  );
  await interaction.reply({
    content: `Confirmed ${reported.length} reported match${reported.length === 1 ? "" : "es"} in Round ${currentRoundNumber}.`,
    ephemeral: true,
  });
}

async function handleDrawUnreported(
  interaction: ChatInputCommandInteraction,
  leagueId: number,
  currentRoundNumber: number,
  leagueStatus: string,
) {
  if (leagueStatus !== "ACTIVE" || currentRoundNumber === 0) {
    await interaction.reply({
      content: "No active round to act on.",
      ephemeral: true,
    });
    return;
  }
  const round = await prisma.round.findUnique({
    where: {
      leagueId_roundNumber: { leagueId, roundNumber: currentRoundNumber },
    },
    include: { matches: true },
  });
  if (!round) {
    await interaction.reply({
      content: `Round ${currentRoundNumber} not found.`,
      ephemeral: true,
    });
    return;
  }
  const unreported = round.matches.filter((m) => m.status === "SCHEDULED");
  if (unreported.length === 0) {
    await interaction.reply({
      content: `No unreported matches in Round ${currentRoundNumber}.`,
      ephemeral: true,
    });
    return;
  }
  const now = new Date();
  await prisma.$transaction(
    unreported.map((m) =>
      prisma.match.update({
        where: { id: m.id },
        data: {
          status: "ADMIN_RESOLVED",
          winnerPlayerId: null,
          playerAGameWins: 1,
          playerBGameWins: 1,
          confirmedAt: now,
        },
      }),
    ),
  );
  await interaction.reply({
    content: `Marked ${unreported.length} unreported match${unreported.length === 1 ? "" : "es"} in Round ${currentRoundNumber} as 1-1 draws.`,
    ephemeral: true,
  });
}

function swapAB(r: ReportResult): ReportResult {
  switch (r) {
    case "A_2_0":
      return "B_2_0";
    case "A_2_1":
      return "B_2_1";
    case "B_2_1":
      return "A_2_1";
    case "B_2_0":
      return "A_2_0";
    case "DRAW":
      return "DRAW";
  }
}
