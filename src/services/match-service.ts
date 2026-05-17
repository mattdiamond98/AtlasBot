import { prisma } from "../db/client.js";

export class MatchServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatchServiceError";
  }
}

export type ReportInput = {
  matchId: number;
  reporterPlayerId: number;
  // "A_2_0" | "A_2_1" | "B_2_1" | "B_2_0" | "DRAW", where A/B is relative to
  // the stored match.playerAId / playerBId.
  result: ReportResult;
};

export type ReportResult = "A_2_0" | "A_2_1" | "B_2_1" | "B_2_0" | "DRAW";

/**
 * Convert a player-relative result ("I won 2-0", "Draw", etc.) to A/B form.
 */
export function playerRelativeToAB(
  reporterIsA: boolean,
  iWon: "2_0" | "2_1" | "lost_1_2" | "lost_0_2" | "draw",
): ReportResult {
  if (iWon === "draw") return "DRAW";
  if (reporterIsA) {
    if (iWon === "2_0") return "A_2_0";
    if (iWon === "2_1") return "A_2_1";
    if (iWon === "lost_1_2") return "B_2_1";
    return "B_2_0"; // lost_0_2
  } else {
    if (iWon === "2_0") return "B_2_0";
    if (iWon === "2_1") return "B_2_1";
    if (iWon === "lost_1_2") return "A_2_1";
    return "A_2_0"; // lost_0_2
  }
}

/**
 * Report a result. Status moves SCHEDULED → REPORTED. Opponent must confirm.
 */
export async function reportMatch(input: ReportInput) {
  const match = await prisma.match.findUnique({ where: { id: input.matchId } });
  if (!match) throw new MatchServiceError("Match not found.");
  if (match.status === "BYE") {
    throw new MatchServiceError("This match is a bye and has no result to report.");
  }
  if (match.status === "CONFIRMED" || match.status === "ADMIN_RESOLVED") {
    throw new MatchServiceError("This match is already finalized.");
  }
  if (
    match.playerAId !== input.reporterPlayerId &&
    match.playerBId !== input.reporterPlayerId
  ) {
    throw new MatchServiceError("You are not a participant in this match.");
  }

  const { winnerPlayerId, aWins, bWins, isDraw } = applyResult(
    match.playerAId,
    match.playerBId!,
    input.result,
  );

  return prisma.match.update({
    where: { id: input.matchId },
    data: {
      status: "REPORTED",
      winnerPlayerId,
      playerAGameWins: aWins,
      playerBGameWins: bWins,
      reportedByPlayerId: input.reporterPlayerId,
      reportedAt: new Date(),
      // Reset confirmation if there was a prior report.
      confirmedAt: null,
    },
  });
}

/**
 * Opponent confirms a reported result. Status → CONFIRMED.
 * `confirmerPlayerId` must be the non-reporter.
 */
export async function confirmMatch(input: {
  matchId: number;
  confirmerPlayerId: number;
}) {
  const match = await prisma.match.findUnique({ where: { id: input.matchId } });
  if (!match) throw new MatchServiceError("Match not found.");
  if (match.status !== "REPORTED") {
    throw new MatchServiceError(
      `Cannot confirm a match in status ${match.status}.`,
    );
  }
  if (
    match.playerAId !== input.confirmerPlayerId &&
    match.playerBId !== input.confirmerPlayerId
  ) {
    throw new MatchServiceError("You are not a participant in this match.");
  }
  if (match.reportedByPlayerId === input.confirmerPlayerId) {
    throw new MatchServiceError(
      "Your opponent must be the one to confirm (you reported this result).",
    );
  }
  return prisma.match.update({
    where: { id: input.matchId },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });
}

/**
 * Opponent disputes a reported result. Status stays REPORTED; caller pings organizers.
 */
export async function disputeMatch(input: {
  matchId: number;
  disputerPlayerId: number;
}) {
  const match = await prisma.match.findUnique({ where: { id: input.matchId } });
  if (!match) throw new MatchServiceError("Match not found.");
  if (match.status !== "REPORTED") {
    throw new MatchServiceError(
      `Nothing to dispute in match status ${match.status}.`,
    );
  }
  if (
    match.playerAId !== input.disputerPlayerId &&
    match.playerBId !== input.disputerPlayerId
  ) {
    throw new MatchServiceError("You are not a participant in this match.");
  }
  if (match.reportedByPlayerId === input.disputerPlayerId) {
    throw new MatchServiceError(
      "You reported this result yourself — re-report a corrected result instead of disputing.",
    );
  }
  // No state change; caller surfaces the dispute to organizers.
  return match;
}

/**
 * Organizer manual override. Sets status=ADMIN_RESOLVED.
 */
export async function adminSetResult(input: {
  matchId: number;
  result: ReportResult;
}) {
  const match = await prisma.match.findUnique({ where: { id: input.matchId } });
  if (!match) throw new MatchServiceError("Match not found.");
  if (match.status === "BYE") {
    throw new MatchServiceError("Cannot override a bye match's result.");
  }
  if (match.playerBId === null) {
    throw new MatchServiceError("Match has no opponent set.");
  }
  const { winnerPlayerId, aWins, bWins } = applyResult(
    match.playerAId,
    match.playerBId,
    input.result,
  );
  return prisma.match.update({
    where: { id: input.matchId },
    data: {
      status: "ADMIN_RESOLVED",
      winnerPlayerId,
      playerAGameWins: aWins,
      playerBGameWins: bWins,
      confirmedAt: new Date(),
    },
  });
}

/**
 * Find a player's match in the active round. Returns null if zero or more than one.
 */
export async function findActiveRoundMatchForPlayer(input: {
  leagueId: number;
  playerId: number;
}) {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
  });
  if (!league || league.status !== "ACTIVE") return null;

  const round = await prisma.round.findUnique({
    where: {
      leagueId_roundNumber: {
        leagueId: input.leagueId,
        roundNumber: league.currentRoundNumber,
      },
    },
    include: {
      matches: {
        where: {
          OR: [
            { playerAId: input.playerId },
            { playerBId: input.playerId },
          ],
        },
      },
    },
  });
  if (!round || round.matches.length === 0) return null;
  if (round.matches.length > 1) return null;
  return round.matches[0]!;
}

function applyResult(
  playerAId: number,
  playerBId: number,
  result: ReportResult,
): { winnerPlayerId: number | null; aWins: number; bWins: number; isDraw: boolean } {
  switch (result) {
    case "A_2_0":
      return { winnerPlayerId: playerAId, aWins: 2, bWins: 0, isDraw: false };
    case "A_2_1":
      return { winnerPlayerId: playerAId, aWins: 2, bWins: 1, isDraw: false };
    case "B_2_1":
      return { winnerPlayerId: playerBId, aWins: 1, bWins: 2, isDraw: false };
    case "B_2_0":
      return { winnerPlayerId: playerBId, aWins: 0, bWins: 2, isDraw: false };
    case "DRAW":
      return { winnerPlayerId: null, aWins: 1, bWins: 1, isDraw: true };
  }
}
