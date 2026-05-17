import { prisma } from "../db/client.js";
import { computeStandings } from "../domain/standings.js";
import type {
  PairingPlayer,
  Standing,
  StandingsMatch,
  StandingsPlayer,
} from "../domain/types.js";

export type StandingRow = Standing & {
  displayName: string;
  discordUserId: string;
};

/**
 * Compute standings for a league using all CONFIRMED/ADMIN_RESOLVED/BYE matches.
 * Includes display names so callers can render directly.
 */
export async function getStandingsForLeague(
  leagueId: number,
): Promise<StandingRow[]> {
  const leaguePlayers = await prisma.leaguePlayer.findMany({
    where: { leagueId },
    include: { player: true },
  });

  const players: StandingsPlayer[] = leaguePlayers.map((lp) => ({
    id: lp.playerId,
    seed: lp.seed,
  }));

  const matches = await prisma.match.findMany({
    where: {
      round: { leagueId },
      status: { in: ["CONFIRMED", "ADMIN_RESOLVED", "BYE"] },
    },
  });

  const sMatches: StandingsMatch[] = matches.map((m) => ({
    playerAId: m.playerAId,
    playerBId: m.playerBId,
    winnerPlayerId: m.winnerPlayerId,
    playerAGameWins: m.playerAGameWins,
    playerBGameWins: m.playerBGameWins,
    isBye: m.status === "BYE",
    isDraw: m.status !== "BYE" && m.winnerPlayerId === null,
  }));

  const ranked = computeStandings(players, sMatches);

  const lpByPlayerId = new Map(leaguePlayers.map((lp) => [lp.playerId, lp]));
  return ranked.map((r) => {
    const lp = lpByPlayerId.get(r.playerId);
    return {
      ...r,
      displayName: lp?.player.displayName ?? `Player ${r.playerId}`,
      discordUserId: lp?.player.discordUserId ?? "",
    };
  });
}

/**
 * Build the input snapshot for generating the next round's pairings.
 * Only ACTIVE players are included.
 */
export async function buildPairingInputs(
  leagueId: number,
): Promise<PairingPlayer[]> {
  const standings = await getStandingsForLeague(leagueId);
  const matchPointsById = new Map(
    standings.map((s) => [s.playerId, s.matchPoints]),
  );

  const activeLP = await prisma.leaguePlayer.findMany({
    where: { leagueId, status: "ACTIVE" },
  });

  // Include all prior matches regardless of status — we need to know who
  // has been paired before, not just who has a final result.
  const pastMatches = await prisma.match.findMany({
    where: { round: { leagueId } },
    select: { playerAId: true, playerBId: true },
  });

  const pastOpponents = new Map<number, Set<number>>();
  const hadBye = new Set<number>();
  for (const lp of activeLP) pastOpponents.set(lp.playerId, new Set());
  for (const m of pastMatches) {
    if (m.playerBId === null) {
      hadBye.add(m.playerAId);
    } else {
      pastOpponents.get(m.playerAId)?.add(m.playerBId);
      pastOpponents.get(m.playerBId)?.add(m.playerAId);
    }
  }

  return activeLP.map((lp) => ({
    id: lp.playerId,
    matchPoints: matchPointsById.get(lp.playerId) ?? 0,
    seed: lp.seed,
    hadBye: hadBye.has(lp.playerId),
    pastOpponents: pastOpponents.get(lp.playerId) ?? new Set(),
  }));
}
