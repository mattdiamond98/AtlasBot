import { EmbedBuilder } from "discord.js";
import type { Standing } from "../../domain/types.js";

const fmtPct = (x: number) => `${(x * 100).toFixed(2)}%`;

export function standingsEmbed(opts: {
  leagueName: string;
  roundNumber: number;
  rows: ReadonlyArray<Standing & { displayName: string }>;
}): EmbedBuilder {
  const lines = opts.rows.map((r, i) => {
    const rank = (i + 1).toString().padStart(2, " ");
    return `\`${rank}.\` **${r.displayName}** — ${r.matchPoints} pts · OMW% ${fmtPct(r.omwp)} · GW% ${fmtPct(r.gwp)}`;
  });
  return new EmbedBuilder()
    .setTitle(`${opts.leagueName} — Standings after Round ${opts.roundNumber}`)
    .setDescription(lines.join("\n") || "_No players yet._")
    .setColor(0x2b6cb0);
}

export function pairingsEmbed(opts: {
  leagueName: string;
  roundNumber: number;
  rows: ReadonlyArray<{
    matchId: number;
    playerAName: string;
    playerBName: string | null; // null = bye
    threadId: string | null;
    status: string;
  }>;
}): EmbedBuilder {
  const lines = opts.rows.map((r) => {
    if (r.playerBName === null) return `**${r.playerAName}** — _bye_`;
    const threadLink = r.threadId ? ` <#${r.threadId}>` : "";
    const statusSuffix = r.status === "CONFIRMED" ? " ✓" : r.status === "REPORTED" ? " · awaiting confirm" : "";
    return `**${r.playerAName}** vs **${r.playerBName}**${threadLink}${statusSuffix}`;
  });
  return new EmbedBuilder()
    .setTitle(`${opts.leagueName} — Round ${opts.roundNumber} Pairings`)
    .setDescription(lines.join("\n") || "_No pairings._")
    .setColor(0x38a169);
}

export function matchThreadEmbed(opts: {
  leagueName: string;
  roundNumber: number;
  playerAMention: string;
  playerBMention: string;
  matchFormat: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${opts.leagueName} — Round ${opts.roundNumber}`)
    .setDescription(
      [
        `${opts.playerAMention} vs ${opts.playerBMention}`,
        `Format: **${opts.matchFormat}**`,
        "",
        "Coordinate your match here. When done, click **Report Result** or run `/match report`.",
      ].join("\n"),
    )
    .setColor(0x805ad5);
}
