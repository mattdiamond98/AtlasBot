# Atlas Conquest League Bot

Discord bot that runs multi-week Swiss tournaments for Atlas Conquest. Players join via slash command, pairings auto-generate each round, opponents confirm match results, and standings update with MTG-style tiebreakers.

**Status:** Lean MVP (v1). See `PLAN.md` style notes in `.claude/plans/` for the design rationale and what's deferred to v2.

---

## Stack

- Node 20+ · TypeScript · discord.js v14
- SQLite via Prisma (one file; no hosted DB)
- vitest for unit tests
- Single-guild bot (slash commands registered to one guild → instant updates)

---

## Local setup

1. **Install Node 20+.** Recommended: [nvm-windows](https://github.com/coreybutler/nvm-windows) or [fnm](https://github.com/Schniz/fnm). Verify with `node --version`.

2. **Install dependencies:**
   ```sh
   npm install
   ```

3. **Create the Discord application:**
   - Go to https://discord.com/developers/applications → New Application.
   - Bot tab → Reset Token → copy it.
   - OAuth2 → URL Generator → scopes: `bot`, `applications.commands`. Bot permissions: `Send Messages`, `Embed Links`, `Create Public Threads`, `Send Messages in Threads`, `Read Message History`, `Mention Everyone` (for organizer role pings).
   - Open the generated URL and invite the bot to your server.

4. **Configure environment:**
   ```sh
   copy .env.example .env
   ```
   Fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` (Application ID from the General Information tab), `DISCORD_GUILD_ID` (right-click your server → Copy Server ID; requires Developer Mode in Discord settings).

5. **Initialize the database:**
   ```sh
   npx prisma migrate dev --name init
   ```

6. **Register slash commands to your guild** (instant):
   ```sh
   npm run register
   ```

7. **Run the bot:**
   ```sh
   npm run dev
   ```

---

## Running a league

All commands gated to the `organizer_role` you supply at create time. Server admins can also run them.

```
/league create name:"Spring Season"
                rounds:5
                organizer_role:@Organizer
                announcements_channel:#league
```

Players run `/league join` while registration is open. When ready:

```
/league start
```

This locks registration, generates Round 1 pairings, and creates a public thread per match in the announcements channel. Each player gets a `Report Result` button in their thread.

Reporting flow:
1. Either player runs `/match report result:<choice>` or clicks the button.
2. Bot posts a `Confirm` / `Dispute` prompt in the match thread, tagging the opponent.
3. Opponent confirms → result is final. Opponent disputes → organizer is pinged to use `/admin set-result`.

When the round is done:

```
/league next-round missing_policy:cancel
```

`missing_policy: draw` will mark any unresolved matches as 1-1 draws (1 point each).

Run `/league standings` and `/league pairings` anytime.

---

## Admin overrides

```
/admin set-result player_a:@X player_b:@Y result:"Player A wins 2-1"
/admin drop-player player:@X
/admin add-player player:@X
```

---

## Tests

```sh
npm test
```

`tests/pairings.test.ts` and `tests/standings.test.ts` cover the pure-function domain logic (Swiss pairing with backtracking, MTG tiebreakers). Run these before any Discord change — they're where the algorithmic bugs hide.

---

## Production deployment

**Host:** IONOS VPS Linux XS · Ubuntu 24.04 · IPv4 `216.250.119.208`
**Service user:** `atlas` (sudo group)
**Process manager:** systemd unit `atlasbot.service`
**Data:** SQLite at `/home/atlas/AtlasBot/prisma/atlas.db`
**Backups:** daily snapshot to `/home/atlas/backups/`, 14-day retention

### SSH

```sh
ssh atlas@216.250.119.208     # day-to-day (code, db, .env)
ssh root@216.250.119.208      # systemd, apt, firewall
```

Password auth is disabled — SSH key (`~/.ssh/id_ed25519`) only.

### Deploying code changes

From your laptop:

```sh
cd /c/Users/mattd/Projects/AtlasBot
scp -r src prisma package.json package-lock.json tsconfig.json atlas@216.250.119.208:~/AtlasBot/
ssh atlas@216.250.119.208 'cd ~/AtlasBot && npm ci && npx prisma migrate deploy'
ssh root@216.250.119.208 'systemctl restart atlasbot'
```

Only re-run `npm run register` (as `atlas`, in `~/AtlasBot`) when you've **added, renamed, or changed the schema of** a slash command. Code-only changes don't need it.

### Service control (as root)

```sh
systemctl status atlasbot              # is it running?
systemctl restart atlasbot             # after deploy
systemctl stop atlasbot                # take it offline
systemctl start atlasbot
systemctl disable atlasbot             # stop running at boot
systemctl enable atlasbot              # restore boot-time start
```

### Logs

```sh
journalctl -u atlasbot -f                       # live tail
journalctl -u atlasbot -n 200 --no-pager        # last 200 lines
journalctl -u atlasbot --since "1 hour ago"
journalctl -u atlasbot --since today
```

### Database

```sh
# inspect (as atlas)
sqlite3 /home/atlas/AtlasBot/prisma/atlas.db
  .tables
  .schema League
  SELECT * FROM League;
  .quit

# manual backup (cron runs this nightly via /etc/cron.daily/atlasbot-backup)
sqlite3 /home/atlas/AtlasBot/prisma/atlas.db ".backup '/home/atlas/backups/atlas-manual-$(date +%F).db'"

# list backups
ls -lh /home/atlas/backups/

# restore from a backup (STOP the service first or rows will be overwritten on next write)
systemctl stop atlasbot                                                         # as root
cp /home/atlas/backups/atlas-YYYY-MM-DD.db /home/atlas/AtlasBot/prisma/atlas.db  # as atlas
chown atlas:atlas /home/atlas/AtlasBot/prisma/atlas.db
systemctl start atlasbot                                                        # as root
```

Download a backup to your laptop:

```sh
scp atlas@216.250.119.208:/home/atlas/backups/atlas-YYYY-MM-DD.db ./
```

### Rotating the Discord token

If the token leaks (chat, screenshot, shell history, public repo), rotate **immediately**:

1. Discord Developer Portal → your app → Bot → **Reset Token** → copy the new one.
2. On the server:
   ```sh
   ssh atlas@216.250.119.208
   nano ~/AtlasBot/.env       # replace DISCORD_TOKEN= value
   exit
   ssh root@216.250.119.208
   systemctl restart atlasbot
   ```

### Security upkeep

- `unattended-upgrades` is installed and applies security patches automatically — no action required.
- Occasionally reboot to pick up kernel updates: `ssh root@216.250.119.208 'reboot'` (systemd will restart the bot on boot).
- Check firewall: `ssh root@216.250.119.208 'ufw status'` — only OpenSSH should be allowed.

### systemd unit reference

Located at `/etc/systemd/system/atlasbot.service`:

```ini
[Unit]
Description=AtlasBot Discord bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=atlas
WorkingDirectory=/home/atlas/AtlasBot
EnvironmentFile=/home/atlas/AtlasBot/.env
ExecStart=/usr/bin/npx tsx src/bot.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

After editing it, run `systemctl daemon-reload && systemctl restart atlasbot`.

### Backup cron reference

Located at `/etc/cron.daily/atlasbot-backup` (chmod +x):

```sh
#!/bin/bash
mkdir -p /home/atlas/backups
sqlite3 /home/atlas/AtlasBot/prisma/atlas.db ".backup '/home/atlas/backups/atlas-$(date +%F).db'"
find /home/atlas/backups -name 'atlas-*.db' -mtime +14 -delete
```

---

## Project layout

```
src/
  bot.ts                          # entry point
  config.ts                       # env parsing (zod)
  db/client.ts                    # PrismaClient
  domain/                         # PURE business logic (unit-tested)
    pairings.ts
    standings.ts
    types.ts
  services/                       # DB-aware orchestration
    league-service.ts
    match-service.ts
    snapshots.ts                  # builds domain inputs from DB
  discord/
    client.ts                     # discord.js Client
    register-commands.ts          # npm run register
    commands/league.ts            # /league create | start | next-round | join | drop | standings | pairings
    commands/match.ts             # /match report
    commands/admin.ts             # /admin set-result | drop-player | add-player
    handlers/buttons.ts           # Report / Confirm / Dispute button + select dispatch
    lib/embeds.ts                 # standings/pairings/match-thread embed builders
    lib/permissions.ts            # current league + organizer-role check
    lib/ids.ts                    # custom_id encoding for buttons
prisma/schema.prisma              # SQLite schema
tests/                            # vitest
```

---

## Deferred to v2 (intentional)

Deck submission storage · scheduled reminders (24h/3h) · auto round advance · top-8 single-elim cut · CSV/JSON export · audit log table · dispute escalation with deadlines · deck visibility/privacy · multiple concurrent leagues per guild.

Each is a focused follow-up; v1 ships the league flow that actually unblocks running your first season.
