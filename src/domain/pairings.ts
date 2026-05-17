import type { Pairing, PairingPlayer } from "./types.js";

/**
 * Generate Swiss pairings for the next round.
 *
 * Algorithm:
 *  1. Sort active players by match points desc, then seed asc.
 *  2. If odd, assign a bye to the lowest-ranked player who has not yet had one
 *     (fall back to absolute lowest if everyone has).
 *  3. Group remaining players into score brackets (same match points).
 *  4. Top-down through brackets: if a bracket is odd, float its lowest-ranked
 *     player down into the next bracket.
 *  5. Within each bracket run a backtracking matcher that prefers fold pairing
 *     (top half vs bottom half) and avoids rematches. If no repeat-free matching
 *     exists, allow repeats.
 */
export function generatePairings(players: readonly PairingPlayer[]): Pairing[] {
  // Sort: match points desc, seed asc (lower seed number = higher rank).
  const sorted = [...players].sort(
    (a, b) => b.matchPoints - a.matchPoints || a.seed - b.seed,
  );

  // Bye assignment for odd counts.
  let byePlayer: PairingPlayer | undefined;
  if (sorted.length % 2 === 1) {
    // Walk from lowest-ranked up; pick the first one who hasn't had a bye.
    let idx = -1;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const candidate = sorted[i];
      if (candidate && !candidate.hadBye) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      idx = sorted.length - 1; // everyone has had a bye; lowest gets it again
    }
    const removed = sorted.splice(idx, 1);
    byePlayer = removed[0];
  }

  // Group into score brackets.
  const brackets: PairingPlayer[][] = [];
  let currentMp: number | undefined;
  for (const p of sorted) {
    if (p.matchPoints !== currentMp) {
      brackets.push([]);
      currentMp = p.matchPoints;
    }
    const last = brackets[brackets.length - 1];
    if (last) last.push(p);
  }

  // Float lowest-ranked of any odd bracket down into the next bracket.
  for (let i = 0; i < brackets.length - 1; i++) {
    const cur = brackets[i];
    const next = brackets[i + 1];
    if (cur && next && cur.length % 2 === 1) {
      const floater = cur.pop();
      if (floater) next.unshift(floater);
    }
  }

  // Pair each bracket. If the final bracket is still odd, merge it into the
  // previous bracket and re-pair (last resort).
  const allPairings: Pairing[] = [];
  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i];
    if (!bracket || bracket.length === 0) continue;
    if (bracket.length % 2 === 1) {
      // Should only happen in the final bracket. Merge upward.
      if (i === 0) {
        // Single bracket of size 1 with no other brackets — shouldn't happen
        // since odd counts get a bye removed above. Defensive: leave unpaired.
        continue;
      }
      const prev = brackets[i - 1];
      if (prev) {
        // Pop this whole bracket onto prev and re-pair prev.
        const merged = [...prev, ...bracket];
        // Remove the prior bracket's pairings from allPairings and re-pair.
        // Simpler: just re-pair `merged` and replace the tail of allPairings.
        const priorPairCount = prev.length / 2;
        allPairings.splice(allPairings.length - priorPairCount, priorPairCount);
        const merged2 = pairBracket(merged);
        allPairings.push(...merged2);
      }
      continue;
    }
    const paired = pairBracket(bracket);
    allPairings.push(...paired);
  }

  if (byePlayer) {
    allPairings.push({
      playerAId: byePlayer.id,
      playerBId: null,
      isBye: true,
    });
  }

  return allPairings;
}

/**
 * Pair an even-sized bracket. Backtracks to avoid rematches; prefers fold
 * pairing (top-half vs bottom-half). If no repeat-free matching exists,
 * retries allowing repeats.
 */
function pairBracket(bracket: readonly PairingPlayer[]): Pairing[] {
  if (bracket.length === 0) return [];
  if (bracket.length % 2 !== 0) {
    throw new Error("pairBracket requires an even-sized bracket");
  }

  const noRepeat = attempt(bracket, false);
  if (noRepeat) return noRepeat;
  return attempt(bracket, true) ?? [];
}

function attempt(
  remaining: readonly PairingPlayer[],
  allowRepeats: boolean,
): Pairing[] | null {
  if (remaining.length === 0) return [];
  const first = remaining[0];
  if (!first) return [];

  // Candidate order: fold-preferring. For a remaining list of length n,
  // try index floor(n/2) first, then n/2+1, ..., n-1, then 1, ..., n/2-1.
  // This naturally pairs top half vs bottom half on the first call, and
  // remains sensible on recursive calls.
  const n = remaining.length;
  const half = Math.floor(n / 2);
  const order: number[] = [];
  for (let i = half; i < n; i++) order.push(i);
  for (let i = 1; i < half; i++) order.push(i);

  for (const i of order) {
    const candidate = remaining[i];
    if (!candidate) continue;
    if (!allowRepeats && first.pastOpponents.has(candidate.id)) continue;

    const rest: PairingPlayer[] = [];
    for (let j = 1; j < n; j++) {
      if (j === i) continue;
      const r = remaining[j];
      if (r) rest.push(r);
    }

    const sub = attempt(rest, allowRepeats);
    if (sub !== null) {
      return [
        { playerAId: first.id, playerBId: candidate.id, isBye: false },
        ...sub,
      ];
    }
  }

  return null;
}
