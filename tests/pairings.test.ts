import { describe, expect, it } from "vitest";
import { generatePairings } from "../src/domain/pairings.js";
import type { PairingPlayer, Pairing } from "../src/domain/types.js";

function mk(
  id: number,
  matchPoints: number,
  seed: number,
  hadBye = false,
  pastOpponents: number[] = [],
): PairingPlayer {
  return {
    id,
    matchPoints,
    seed,
    hadBye,
    pastOpponents: new Set(pastOpponents),
  };
}

function pairKey(p: Pairing): string {
  if (p.isBye) return `bye-${p.playerAId}`;
  const lo = Math.min(p.playerAId, p.playerBId!);
  const hi = Math.max(p.playerAId, p.playerBId!);
  return `${lo}-${hi}`;
}

function allPlayersPairedExactlyOnce(
  pairings: Pairing[],
  players: PairingPlayer[],
): boolean {
  const seen = new Map<number, number>();
  for (const p of pairings) {
    seen.set(p.playerAId, (seen.get(p.playerAId) ?? 0) + 1);
    if (p.playerBId !== null) {
      seen.set(p.playerBId, (seen.get(p.playerBId) ?? 0) + 1);
    }
  }
  if (seen.size !== players.length) return false;
  for (const v of seen.values()) if (v !== 1) return false;
  return true;
}

describe("generatePairings", () => {
  it("4 players, round 1: 2 pairings, no byes", () => {
    const players = [mk(1, 0, 1), mk(2, 0, 2), mk(3, 0, 3), mk(4, 0, 4)];
    const result = generatePairings(players);
    expect(result).toHaveLength(2);
    expect(result.every((p) => !p.isBye)).toBe(true);
    expect(allPlayersPairedExactlyOnce(result, players)).toBe(true);
  });

  it("3 players, round 1: lowest-seeded player gets the bye", () => {
    const players = [mk(1, 0, 1), mk(2, 0, 2), mk(3, 0, 3)];
    const result = generatePairings(players);
    expect(result).toHaveLength(2);
    const bye = result.find((p) => p.isBye);
    expect(bye?.playerAId).toBe(3);
  });

  it("3 players: a player who already had a bye does not get a second one", () => {
    const players = [
      mk(1, 3, 1, false), // not byed
      mk(2, 3, 2, false), // not byed
      mk(3, 3, 3, true), // already had a bye
    ];
    const result = generatePairings(players);
    const bye = result.find((p) => p.isBye);
    expect(bye).toBeDefined();
    // Bye should go to id=2 (next-lowest seed among those without a prior bye).
    expect(bye?.playerAId).toBe(2);
  });

  it("8 players round 1: fold pairing (1v5, 2v6, 3v7, 4v8)", () => {
    const players = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => mk(i, 0, i));
    const result = generatePairings(players);
    const keys = new Set(result.map(pairKey));
    expect(keys).toEqual(new Set(["1-5", "2-6", "3-7", "4-8"]));
  });

  it("4 players, 3 rounds: never repeat a pairing", () => {
    // Simulate a full 4-player round-robin via Swiss; every player should play
    // every other exactly once.
    const ids = [1, 2, 3, 4];
    const seed = new Map(ids.map((id) => [id, id]));
    const points = new Map(ids.map((id) => [id, 0]));
    const past = new Map(ids.map((id) => [id, new Set<number>()]));
    const allPairings: Pairing[] = [];

    for (let round = 0; round < 3; round++) {
      const players = ids.map((id) =>
        mk(id, points.get(id)!, seed.get(id)!, false, [...past.get(id)!]),
      );
      const ps = generatePairings(players);
      expect(ps.every((p) => !p.isBye)).toBe(true);
      for (const p of ps) {
        allPairings.push(p);
        past.get(p.playerAId)!.add(p.playerBId!);
        past.get(p.playerBId!)!.add(p.playerAId);
        // Simulate playerA winning every match for simplicity.
        points.set(p.playerAId, (points.get(p.playerAId) ?? 0) + 3);
      }
    }

    const keys = new Set(allPairings.map(pairKey));
    expect(keys.size).toBe(6);
    expect(keys).toEqual(new Set(["1-2", "1-3", "1-4", "2-3", "2-4", "3-4"]));
  });

  it("7 players: bye rotates; no player receives two byes across rounds", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7];
    const seed = new Map(ids.map((id) => [id, id]));
    const points = new Map(ids.map((id) => [id, 0]));
    const past = new Map(ids.map((id) => [id, new Set<number>()]));
    const hadBye = new Map(ids.map((id) => [id, false]));

    const byeRecipients: number[] = [];
    for (let round = 0; round < 7; round++) {
      const players = ids.map((id) =>
        mk(
          id,
          points.get(id)!,
          seed.get(id)!,
          hadBye.get(id)!,
          [...past.get(id)!],
        ),
      );
      const ps = generatePairings(players);
      const bye = ps.find((p) => p.isBye);
      expect(bye).toBeDefined();
      byeRecipients.push(bye!.playerAId);
      hadBye.set(bye!.playerAId, true);
      points.set(bye!.playerAId, points.get(bye!.playerAId)! + 3);
      for (const p of ps) {
        if (p.isBye) continue;
        past.get(p.playerAId)!.add(p.playerBId!);
        past.get(p.playerBId!)!.add(p.playerAId);
        points.set(p.playerAId, (points.get(p.playerAId) ?? 0) + 3);
      }
    }

    // 7 rounds, 7 unique bye recipients (one per player).
    expect(new Set(byeRecipients).size).toBe(7);
  });

  it("forced repeat: when no repeat-free matching exists, falls back gracefully", () => {
    // Construct: 4 players who have all already played each other in
    // every possible combination. Any new pairing must be a repeat.
    const allOpps = (self: number) => [1, 2, 3, 4].filter((x) => x !== self);
    const players = [
      mk(1, 0, 1, false, allOpps(1)),
      mk(2, 0, 2, false, allOpps(2)),
      mk(3, 0, 3, false, allOpps(3)),
      mk(4, 0, 4, false, allOpps(4)),
    ];
    const result = generatePairings(players);
    expect(result).toHaveLength(2);
    expect(allPlayersPairedExactlyOnce(result, players)).toBe(true);
  });

  it("respects match-point bracket boundaries", () => {
    // 4 players: 1,2 have 3 points; 3,4 have 0 points.
    // Pairings should keep brackets intact (1v2, 3v4) unless a float is needed.
    const players = [
      mk(1, 3, 1),
      mk(2, 3, 2),
      mk(3, 0, 3),
      mk(4, 0, 4),
    ];
    const result = generatePairings(players);
    const keys = new Set(result.map(pairKey));
    expect(keys).toEqual(new Set(["1-2", "3-4"]));
  });

  it("floats lowest of an odd bracket down to the next bracket", () => {
    // 6 players: top bracket has 3 (odd), bottom has 3 (odd).
    // Top: ids 1,2,3 at 3 pts. Bottom: 4,5,6 at 0 pts.
    // Float 3 down → top is {1,2}, mid (containing 3,4,5,6) → 4 players.
    const players = [
      mk(1, 3, 1),
      mk(2, 3, 2),
      mk(3, 3, 3),
      mk(4, 0, 4),
      mk(5, 0, 5),
      mk(6, 0, 6),
    ];
    const result = generatePairings(players);
    expect(result).toHaveLength(3);
    expect(allPlayersPairedExactlyOnce(result, players)).toBe(true);
    // 1 vs 2 is the only valid top-bracket pairing post-float.
    const keys = new Set(result.map(pairKey));
    expect(keys.has("1-2")).toBe(true);
    // Player 3 should have floated and be playing someone from the bottom bracket.
    const threes = result.find(
      (p) => p.playerAId === 3 || p.playerBId === 3,
    );
    expect(threes).toBeDefined();
    const other =
      threes!.playerAId === 3 ? threes!.playerBId : threes!.playerAId;
    expect([4, 5, 6]).toContain(other);
  });
});
