import { prisma } from "../db/client.js";
import { generatePairings } from "../domain/pairings.js";
import { buildPairingInputs } from "./snapshots.js";

export class LeagueServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeagueServiceError";
  }
}

/**
 * Create a new league in REGISTRATION_OPEN. Fails if any non-completed league
 * already exists (lean MVP: one league at a time).
 */
export async function createLeague(input: {
  name: string;
  roundCount: number;
  organizerRoleId: string;
  announcementsChannelId: string;
  createdByDiscordId: string;
}) {
  const existing = await prisma.league.findFirst({
    where: { status: { in: ["REGISTRATION_OPEN", "ACTIVE"] } },
  });
  if (existing) {
    throw new LeagueServiceError(
      `A league is already open ("${existing.name}"). Complete it before starting another.`,
    );
  }
  return prisma.league.create({
    data: {
      name: input.name,
      roundCount: input.roundCount,
      organizerRoleId: input.organizerRoleId,
      announcementsChannelId: input.announcementsChannelId,
      createdByDiscordId: input.createdByDiscordId,
      status: "REGISTRATION_OPEN",
    },
  });
}

/**
 * Upsert a player and add them to the league as ACTIVE.
 * Returns { alreadyJoined: boolean }.
 */
export async function joinLeague(input: {
  leagueId: number;
  discordUserId: string;
  displayName: string;
}): Promise<{ alreadyJoined: boolean }> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
  });
  if (!league) throw new LeagueServiceError("League not found.");
  if (league.status !== "REGISTRATION_OPEN") {
    throw new LeagueServiceError(
      "Registration is closed for this league. Ask the organizer to add you manually.",
    );
  }

  const player = await prisma.player.upsert({
    where: { discordUserId: input.discordUserId },
    create: {
      discordUserId: input.discordUserId,
      displayName: input.displayName,
    },
    update: { displayName: input.displayName },
  });

  const existing = await prisma.leaguePlayer.findUnique({
    where: {
      leagueId_playerId: { leagueId: input.leagueId, playerId: player.id },
    },
  });
  if (existing) {
    if (existing.status === "DROPPED") {
      // Re-activate.
      await prisma.leaguePlayer.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", droppedAt: null },
      });
      return { alreadyJoined: false };
    }
    return { alreadyJoined: true };
  }

  await prisma.leaguePlayer.create({
    data: {
      leagueId: input.leagueId,
      playerId: player.id,
      status: "ACTIVE",
      seed: randomSeed(),
    },
  });
  return { alreadyJoined: false };
}

/**
 * Hard-delete a non-completed league and all its matches, rounds, and
 * league-player records. Refuses on COMPLETED leagues to preserve history.
 * Player records survive (they're guild-level, not league-scoped).
 */
export async function deleteLeague(leagueId: number): Promise<{
  leagueName: string;
  matchCount: number;
  roundCount: number;
  playerCount: number;
  threadIds: string[];
}> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      players: true,
      rounds: { include: { matches: true } },
    },
  });
  if (!league) throw new LeagueServiceError("League not found.");
  if (league.status === "COMPLETED") {
    throw new LeagueServiceError(
      "Cannot delete a completed league — standings history is preserved.",
    );
  }

  const matchIds = league.rounds.flatMap((r) => r.matches.map((m) => m.id));
  const roundIds = league.rounds.map((r) => r.id);
  const threadIds = league.rounds
    .flatMap((r) => r.matches.map((m) => m.threadId))
    .filter((t): t is string => !!t);

  await prisma.$transaction([
    prisma.match.deleteMany({ where: { id: { in: matchIds } } }),
    prisma.round.deleteMany({ where: { id: { in: roundIds } } }),
    prisma.leaguePlayer.deleteMany({ where: { leagueId } }),
    prisma.league.delete({ where: { id: leagueId } }),
  ]);

  return {
    leagueName: league.name,
    matchCount: matchIds.length,
    roundCount: roundIds.length,
    playerCount: league.players.length,
    threadIds,
  };
}

/**
 * Set a player's league status to DROPPED. No-op if not in the league.
 */
export async function dropFromLeague(input: {
  leagueId: number;
  discordUserId: string;
}): Promise<{ dropped: boolean }> {
  const player = await prisma.player.findUnique({
    where: { discordUserId: input.discordUserId },
  });
  if (!player) return { dropped: false };

  const lp = await prisma.leaguePlayer.findUnique({
    where: {
      leagueId_playerId: { leagueId: input.leagueId, playerId: player.id },
    },
  });
  if (!lp || lp.status === "DROPPED") return { dropped: false };

  await prisma.leaguePlayer.update({
    where: { id: lp.id },
    data: { status: "DROPPED", droppedAt: new Date() },
  });
  return { dropped: true };
}

export type GeneratedMatch = {
  matchId: number;
  playerAId: number;
  playerBId: number | null;
  isBye: boolean;
  playerADisplayName: string;
  playerADiscordId: string;
  playerBDisplayName: string | null;
  playerBDiscordId: string | null;
};

/**
 * Start the league: lock registration, generate round 1, persist matches.
 * Returns the new matches for the caller to wire up Discord threads.
 */
export async function startLeague(leagueId: number): Promise<{
  roundId: number;
  roundNumber: number;
  matches: GeneratedMatch[];
}> {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) throw new LeagueServiceError("League not found.");
  if (league.status !== "REGISTRATION_OPEN") {
    throw new LeagueServiceError(
      `League is not open for start (status: ${league.status}).`,
    );
  }
  const activeCount = await prisma.leaguePlayer.count({
    where: { leagueId, status: "ACTIVE" },
  });
  if (activeCount < 2) {
    throw new LeagueServiceError(
      "Need at least 2 active players to start the league.",
    );
  }

  return persistNextRound(leagueId, 1, true);
}

/**
 * Advance to the next round.
 *
 * If there are unfinished matches in the current round, behavior depends on
 * `missingMatchPolicy`:
 *   - 'cancel' → throw an error; organizer should resolve first
 *   - 'draw'   → mark them ADMIN_RESOLVED with isDraw, 1-1 game wins
 *
 * Returns either the new matches (round generated) or `{ leagueCompleted: true }`
 * when the final round has been completed.
 */
export async function advanceRound(input: {
  leagueId: number;
  missingMatchPolicy: "cancel" | "draw";
}): Promise<
  | { leagueCompleted: true }
  | { leagueCompleted: false; roundId: number; roundNumber: number; matches: GeneratedMatch[] }
> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
  });
  if (!league) throw new LeagueServiceError("League not found.");
  if (league.status !== "ACTIVE") {
    throw new LeagueServiceError(
      `League is not active (status: ${league.status}).`,
    );
  }

  const currentRound = await prisma.round.findUnique({
    where: {
      leagueId_roundNumber: {
        leagueId: input.leagueId,
        roundNumber: league.currentRoundNumber,
      },
    },
    include: { matches: true },
  });
  if (!currentRound) {
    throw new LeagueServiceError(
      "Current round not found; data is inconsistent.",
    );
  }

  const unfinished = currentRound.matches.filter(
    (m) => m.status === "SCHEDULED" || m.status === "REPORTED",
  );
  if (unfinished.length > 0) {
    if (input.missingMatchPolicy === "cancel") {
      throw new LeagueServiceError(
        `Round ${currentRound.roundNumber} has ${unfinished.length} unresolved match(es). Resolve them with /admin set-result, or re-run with missing_policy:"Mark as draw (1-1)".`,
      );
    }
    // Mark them as draws.
    await prisma.$transaction(
      unfinished.map((m) =>
        prisma.match.update({
          where: { id: m.id },
          data: {
            status: "ADMIN_RESOLVED",
            winnerPlayerId: null,
            playerAGameWins: 1,
            playerBGameWins: 1,
            confirmedAt: new Date(),
          },
        }),
      ),
    );
  }

  // Mark round complete.
  await prisma.round.update({
    where: { id: currentRound.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  // League complete?
  if (currentRound.roundNumber >= league.roundCount) {
    await prisma.league.update({
      where: { id: input.leagueId },
      data: { status: "COMPLETED" },
    });
    return { leagueCompleted: true };
  }

  const result = await persistNextRound(
    input.leagueId,
    currentRound.roundNumber + 1,
    false,
  );
  return { leagueCompleted: false, ...result };
}

/**
 * Shared between startLeague and advanceRound: generate pairings, persist a
 * new Round + Matches, update League status/round number.
 */
async function persistNextRound(
  leagueId: number,
  roundNumber: number,
  isFirstRound: boolean,
): Promise<{ roundId: number; roundNumber: number; matches: GeneratedMatch[] }> {
  const inputs = await buildPairingInputs(leagueId);
  const pairings = generatePairings(inputs);

  const lpRows = await prisma.leaguePlayer.findMany({
    where: { leagueId },
    include: { player: true },
  });
  const playerById = new Map(lpRows.map((lp) => [lp.playerId, lp.player]));

  const round = await prisma.round.create({
    data: {
      leagueId,
      roundNumber,
      status: "ACTIVE",
    },
  });

  const created: GeneratedMatch[] = [];
  for (const pairing of pairings) {
    const match = await prisma.match.create({
      data: {
        roundId: round.id,
        playerAId: pairing.playerAId,
        playerBId: pairing.playerBId,
        status: pairing.isBye ? "BYE" : "SCHEDULED",
        winnerPlayerId: pairing.isBye ? pairing.playerAId : null,
      },
    });
    const a = playerById.get(pairing.playerAId);
    const b = pairing.playerBId ? playerById.get(pairing.playerBId) : null;
    created.push({
      matchId: match.id,
      playerAId: pairing.playerAId,
      playerBId: pairing.playerBId,
      isBye: pairing.isBye,
      playerADisplayName: a?.displayName ?? `Player ${pairing.playerAId}`,
      playerADiscordId: a?.discordUserId ?? "",
      playerBDisplayName: b?.displayName ?? null,
      playerBDiscordId: b?.discordUserId ?? null,
    });
  }

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      currentRoundNumber: roundNumber,
      ...(isFirstRound ? { status: "ACTIVE" } : {}),
    },
  });

  return { roundId: round.id, roundNumber, matches: created };
}

function randomSeed(): number {
  // 1..1_000_000 — collisions are astronomically unlikely at league scale
  // and ties tiebreak deterministically by player.id anyway.
  return 1 + Math.floor(Math.random() * 1_000_000);
}
