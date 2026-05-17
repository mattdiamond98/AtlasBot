export type MatchStatus =
  | "SCHEDULED"
  | "REPORTED"
  | "CONFIRMED"
  | "BYE"
  | "ADMIN_RESOLVED";

export type LeaguePlayerStatus = "ACTIVE" | "DROPPED";

export type LeagueStatus = "REGISTRATION_OPEN" | "ACTIVE" | "COMPLETED";

export type RoundStatus = "ACTIVE" | "COMPLETED";

// Input to pairing: a snapshot of each ACTIVE player's standing going into the next round.
export type PairingPlayer = {
  id: number;
  matchPoints: number;
  seed: number;
  hadBye: boolean;
  pastOpponents: ReadonlySet<number>;
};

export type Pairing = {
  playerAId: number;
  playerBId: number | null; // null = bye
  isBye: boolean;
};

// Input to standings: a snapshot of all matches played in the league so far.
export type StandingsMatch = {
  playerAId: number;
  playerBId: number | null;
  winnerPlayerId: number | null;
  playerAGameWins: number;
  playerBGameWins: number;
  isBye: boolean;
  // For draws, winnerPlayerId is null and isBye is false.
  isDraw: boolean;
};

export type StandingsPlayer = {
  id: number;
  seed: number;
};

export type Standing = {
  playerId: number;
  matchPoints: number;
  matchesPlayed: number; // including byes
  byes: number;
  gamesWon: number;
  gamesLost: number;
  mwp: number; // own match-win percentage, 0..1, floored at 0.33
  omwp: number; // opponents' MWP, 0..1
  gwp: number; // game-win percentage, 0..1, floored at 0.33
  ogwp: number; // opponents' GWP, 0..1
  seed: number;
};
