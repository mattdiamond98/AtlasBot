import type { Standing, StandingsMatch, StandingsPlayer } from "./types.js";

const FLOOR = 0.33;

/**
 * Compute standings for the league.
 *
 * MTG-style tiebreakers in order:
 *   1. Match Points (W=3, D=1, L=0, Bye=3)
 *   2. Opponent Match-Win % (each opponent floored at 33%; byes skipped)
 *   3. Game-Win % (byes don't contribute games)
 *   4. Opponent Game-Win %
 *   5. Seed (deterministic final tiebreak; lower = higher rank)
 *
 * The function is total: it returns one row per input player, even if they
 * have played zero matches.
 */
export function computeStandings(
  players: readonly StandingsPlayer[],
  matches: readonly StandingsMatch[],
): Standing[] {
  // Per-player aggregates.
  type Agg = {
    matchPoints: number;
    matchesPlayed: number;
    byes: number;
    gamesWon: number;
    gamesLost: number;
    opponentIds: number[]; // non-bye opponents only
  };

  const agg = new Map<number, Agg>();
  for (const p of players) {
    agg.set(p.id, {
      matchPoints: 0,
      matchesPlayed: 0,
      byes: 0,
      gamesWon: 0,
      gamesLost: 0,
      opponentIds: [],
    });
  }

  const touch = (id: number): Agg => {
    let a = agg.get(id);
    if (!a) {
      a = {
        matchPoints: 0,
        matchesPlayed: 0,
        byes: 0,
        gamesWon: 0,
        gamesLost: 0,
        opponentIds: [],
      };
      agg.set(id, a);
    }
    return a;
  };

  for (const m of matches) {
    if (m.isBye) {
      const a = touch(m.playerAId);
      a.matchPoints += 3;
      a.matchesPlayed += 1;
      a.byes += 1;
      continue;
    }

    if (m.playerBId === null) continue; // defensive — non-bye must have B

    const a = touch(m.playerAId);
    const b = touch(m.playerBId);

    a.matchesPlayed += 1;
    b.matchesPlayed += 1;
    a.opponentIds.push(m.playerBId);
    b.opponentIds.push(m.playerAId);
    a.gamesWon += m.playerAGameWins;
    a.gamesLost += m.playerBGameWins;
    b.gamesWon += m.playerBGameWins;
    b.gamesLost += m.playerAGameWins;

    if (m.isDraw) {
      a.matchPoints += 1;
      b.matchPoints += 1;
    } else if (m.winnerPlayerId === m.playerAId) {
      a.matchPoints += 3;
    } else if (m.winnerPlayerId === m.playerBId) {
      b.matchPoints += 3;
    }
    // If neither winner nor draw: 0 points each (e.g., admin-resolved no-show).
  }

  // Per-player MWP and GWP (used by opponents' calculations).
  const mwpOf = new Map<number, number>();
  const gwpOf = new Map<number, number>();
  for (const [id, a] of agg) {
    const mwpRaw =
      a.matchesPlayed === 0 ? 0 : a.matchPoints / (a.matchesPlayed * 3);
    mwpOf.set(id, Math.max(mwpRaw, FLOOR));

    const totalGames = a.gamesWon + a.gamesLost;
    const gwpRaw = totalGames === 0 ? 0 : a.gamesWon / totalGames;
    gwpOf.set(id, Math.max(gwpRaw, FLOOR));
  }

  const result: Standing[] = [];
  for (const p of players) {
    const a = agg.get(p.id);
    if (!a) continue;

    const ownMwpRaw =
      a.matchesPlayed === 0 ? 0 : a.matchPoints / (a.matchesPlayed * 3);
    const ownMwp = Math.max(ownMwpRaw, FLOOR);

    const ownGames = a.gamesWon + a.gamesLost;
    const ownGwpRaw = ownGames === 0 ? 0 : a.gamesWon / ownGames;
    const ownGwp = Math.max(ownGwpRaw, FLOOR);

    const opps = a.opponentIds;
    let omwp = 0;
    let ogwp = 0;
    if (opps.length > 0) {
      let omwpSum = 0;
      let ogwpSum = 0;
      for (const oid of opps) {
        omwpSum += mwpOf.get(oid) ?? FLOOR;
        ogwpSum += gwpOf.get(oid) ?? FLOOR;
      }
      omwp = omwpSum / opps.length;
      ogwp = ogwpSum / opps.length;
    }

    result.push({
      playerId: p.id,
      matchPoints: a.matchPoints,
      matchesPlayed: a.matchesPlayed,
      byes: a.byes,
      gamesWon: a.gamesWon,
      gamesLost: a.gamesLost,
      mwp: ownMwp,
      omwp,
      gwp: ownGwp,
      ogwp,
      seed: p.seed,
    });
  }

  result.sort(
    (a, b) =>
      b.matchPoints - a.matchPoints ||
      b.omwp - a.omwp ||
      b.gwp - a.gwp ||
      b.ogwp - a.ogwp ||
      a.seed - b.seed,
  );

  return result;
}
