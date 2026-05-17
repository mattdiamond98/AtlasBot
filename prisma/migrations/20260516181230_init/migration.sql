-- CreateTable
CREATE TABLE "League" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "roundCount" INTEGER NOT NULL,
    "currentRoundNumber" INTEGER NOT NULL DEFAULT 0,
    "matchFormat" TEXT NOT NULL DEFAULT 'Bo3',
    "organizerRoleId" TEXT NOT NULL,
    "announcementsChannelId" TEXT NOT NULL,
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Player" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "discordUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LeaguePlayer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "droppedAt" DATETIME,
    CONSTRAINT "LeaguePlayer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeaguePlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Round" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Round_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Match" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "roundId" INTEGER NOT NULL,
    "playerAId" INTEGER NOT NULL,
    "playerBId" INTEGER,
    "winnerPlayerId" INTEGER,
    "status" TEXT NOT NULL,
    "playerAGameWins" INTEGER NOT NULL DEFAULT 0,
    "playerBGameWins" INTEGER NOT NULL DEFAULT 0,
    "reportedByPlayerId" INTEGER,
    "reportedAt" DATETIME,
    "confirmedAt" DATETIME,
    "threadId" TEXT,
    CONSTRAINT "Match_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_playerAId_fkey" FOREIGN KEY ("playerAId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_playerBId_fkey" FOREIGN KEY ("playerBId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Match_winnerPlayerId_fkey" FOREIGN KEY ("winnerPlayerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Match_reportedByPlayerId_fkey" FOREIGN KEY ("reportedByPlayerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_discordUserId_key" ON "Player"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaguePlayer_leagueId_playerId_key" ON "LeaguePlayer"("leagueId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Round_leagueId_roundNumber_key" ON "Round"("leagueId", "roundNumber");
