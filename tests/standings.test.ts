import { describe, expect, it } from "vitest";
import { computeStandings } from "../src/domain/standings.js";
import type {
  StandingsMatch,
  StandingsPlayer,
} from "../src/domain/types.js";

function p(id: number, seed: number = id): StandingsPlayer {
  return { id, seed };
}

function win(
  a: number,
  b: number,
  aGames: number,
  bGames: number,
): StandingsMatch {
  return {
    playerAId: a,
    playerBId: b,
    winnerPlayerId: aGames > bGames ? a : b,
    playerAGameWins: aGames,
    playerBGameWins: bGames,
    isBye: false,
    isDraw: false,
  };
}

function draw(a: number, b: number): StandingsMatch {
  return {
    playerAId: a,
    playerBId: b,
    winnerPlayerId: null,
    playerAGameWins: 1,
    playerBGameWins: 1,
    isBye: false,
    isDraw: true,
  };
}

function bye(a: number): StandingsMatch {
  return {
    playerAId: a,
    playerBId: null,
    winnerPlayerId: a,
    playerAGameWins: 0,
    playerBGameWins: 0,
    isBye: true,
    isDraw: false,
  };
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("computeStandings", () => {
  it("orders by match points first", () => {
    const players = [p(1), p(2), p(3), p(4)];
    const matches = [
      win(1, 2, 2, 0),
      win(3, 4, 2, 1),
      win(1, 3, 2, 1),
      win(2, 4, 2, 0),
    ];
    const result = computeStandings(players, matches);
    expect(result.map((r) => r.playerId)).toEqual([1, 3, 2, 4]);
    expect(result[0]!.matchPoints).toBe(6);
    expect(result[1]!.matchPoints).toBe(3);
  });

  it("treats a draw as 1 point for each side", () => {
    const players = [p(1), p(2)];
    const result = computeStandings(players, [draw(1, 2)]);
    expect(result[0]!.matchPoints).toBe(1);
    expect(result[1]!.matchPoints).toBe(1);
  });

  it("awards 3 match points for a bye and tracks the bye count", () => {
    const players = [p(1), p(2), p(3)];
    const result = computeStandings(players, [win(1, 2, 2, 0), bye(3)]);
    const row3 = result.find((r) => r.playerId === 3)!;
    expect(row3.matchPoints).toBe(3);
    expect(row3.byes).toBe(1);
    expect(row3.matchesPlayed).toBe(1);
    expect(row3.gamesWon + row3.gamesLost).toBe(0); // bye contributes no games
  });

  it("floors each opponent's MWP at 33% when computing OMW%", () => {
    // P1 plays P2 (and wins). P2 played only P1 and lost (0% MWP) — should
    // be floored to 33% for P1's OMW%.
    const players = [p(1), p(2)];
    const result = computeStandings(players, [win(1, 2, 2, 0)]);
    const row1 = result.find((r) => r.playerId === 1)!;
    expect(close(row1.omwp, 0.33)).toBe(true);
  });

  it("excludes byes from the opponent list (no opponent contributes for a bye round)", () => {
    // P1 beats P2, then P1 has a bye. P1's opponent list = [P2] only.
    const players = [p(1), p(2)];
    const result = computeStandings(players, [win(1, 2, 2, 0), bye(1)]);
    const row1 = result.find((r) => r.playerId === 1)!;
    // P1 played 2 matches; opponent list has 1 entry (P2, floored to 33% MWP).
    expect(row1.matchesPlayed).toBe(2);
    expect(row1.byes).toBe(1);
    expect(close(row1.omwp, 0.33)).toBe(true);
  });

  it("computes game-win percentage from games won / total games", () => {
    const players = [p(1), p(2)];
    const result = computeStandings(players, [win(1, 2, 2, 1)]);
    const row1 = result.find((r) => r.playerId === 1)!;
    // 2 of 3 games won → 0.6666...
    expect(close(row1.gwp, 2 / 3)).toBe(true);
    const row2 = result.find((r) => r.playerId === 2)!;
    // 1 of 3 games — but floored to 33%.
    expect(close(row2.gwp, 1 / 3 < 0.33 ? 0.33 : 1 / 3)).toBe(true);
  });

  it("uses seed as the final deterministic tiebreak", () => {
    // P1 and P2 are perfectly tied (both 3 points from beating P3 and P4 2-0).
    // Seed should break: lower seed wins.
    const players = [p(1, 1), p(2, 2), p(3, 3), p(4, 4)];
    const matches = [win(1, 3, 2, 0), win(2, 4, 2, 0)];
    const result = computeStandings(players, matches);
    expect(result[0]!.playerId).toBe(1);
    expect(result[1]!.playerId).toBe(2);
  });

  it("hand-computed 3-round scenario with OMW% to 4 decimals", () => {
    // Players A=1, B=2, C=3, D=4
    // R1: 1 beat 2 (2-0); 3 beat 4 (2-1)
    // R2: 1 beat 3 (2-1); 4 beat 2 (2-0)
    // R3: 1 beat 4 (2-0); 3 beat 2 (2-1)
    const players = [p(1), p(2), p(3), p(4)];
    const matches = [
      win(1, 2, 2, 0),
      win(3, 4, 2, 1),
      win(1, 3, 2, 1),
      win(4, 2, 2, 0),
      win(1, 4, 2, 0),
      win(3, 2, 2, 1),
    ];
    const result = computeStandings(players, matches);
    // Match points: 1=9, 3=6, 4=3, 2=0
    expect(result.map((r) => [r.playerId, r.matchPoints])).toEqual([
      [1, 9],
      [3, 6],
      [4, 3],
      [2, 0],
    ]);

    // Player 1 played 2, 3, 4.
    // Opponent MWPs: 2 = 0/9 floored→0.33, 3 = 6/9 = 0.6667, 4 = 3/9 = 0.3333
    // (4's raw 0.3333 is above floor)
    // OMW%(1) = (0.33 + 0.6667 + 0.3333) / 3 = 0.4433
    const row1 = result.find((r) => r.playerId === 1)!;
    expect(close(Math.round(row1.omwp * 10000) / 10000, 0.4433)).toBe(true);
  });
});
