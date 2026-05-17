import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { prisma } from "../../db/client.js";
import {
  GeneratedMatch,
  LeagueServiceError,
  createLeague,
  deleteLeague,
  dropFromLeague,
  joinLeague,
  startLeague,
  advanceRound,
} from "../../services/league-service.js";
import { getStandingsForLeague } from "../../services/snapshots.js";
import { CustomId } from "../lib/ids.js";
import {
  matchThreadEmbed,
  pairingsEmbed,
  standingsEmbed,
} from "../lib/embeds.js";
import {
  denyNonOrganizer,
  getCurrentLeague,
  isOrganizer,
} from "../lib/permissions.js";

export const data = new SlashCommandBuilder()
  .setName("league")
  .setDescription("Atlas Conquest league commands")
  .addSubcommand((s) =>
    s
      .setName("create")
      .setDescription("Create a new league (organizer only)")
      .addStringOption((o) =>
        o.setName("name").setDescription("League name").setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName("rounds")
          .setDescription("Number of Swiss rounds")
          .setMinValue(3)
          .setMaxValue(12)
          .setRequired(true),
      )
      .addRoleOption((o) =>
        o
          .setName("organizer_role")
          .setDescription("Role granted organizer powers")
          .setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName("announcements_channel")
          .setDescription("Channel for pairings and match threads")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("start")
      .setDescription("Lock registration and generate Round 1 (organizer only)"),
  )
  .addSubcommand((s) =>
    s
      .setName("next-round")
      .setDescription(
        "Complete the current round and generate the next (organizer only)",
      )
      .addStringOption((o) =>
        o
          .setName("missing_policy")
          .setDescription("How to handle unresolved matches")
          .addChoices(
            { name: "Cancel — block until resolved", value: "cancel" },
            { name: "Mark as draw (1-1)", value: "draw" },
          ),
      ),
  )
  .addSubcommand((s) =>
    s.setName("join").setDescription("Join the open league"),
  )
  .addSubcommand((s) =>
    s
      .setName("delete")
      .setDescription(
        "Delete the current league and all its data (organizer only)",
      )
      .addBooleanOption((o) =>
        o
          .setName("confirm")
          .setDescription("Must be true — this is irreversible")
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s.setName("drop").setDescription("Drop out of the current league"),
  )
  .addSubcommand((s) =>
    s
      .setName("standings")
      .setDescription("Show current standings"),
  )
  .addSubcommand((s) =>
    s
      .setName("pairings")
      .setDescription("Show pairings for the current (or chosen) round")
      .addIntegerOption((o) =>
        o
          .setName("round")
          .setDescription("Round number (defaults to current)")
          .setMinValue(1),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case "create":
      return handleCreate(interaction);
    case "start":
      return handleStart(interaction);
    case "next-round":
      return handleNextRound(interaction);
    case "join":
      return handleJoin(interaction);
    case "delete":
      return handleDelete(interaction);
    case "drop":
      return handleDrop(interaction);
    case "standings":
      return handleStandings(interaction);
    case "pairings":
      return handlePairings(interaction);
    default:
      await interaction.reply({
        content: `Unknown subcommand: ${sub}`,
        ephemeral: true,
      });
  }
}

async function handleCreate(interaction: ChatInputCommandInteraction) {
  // No existing league means no organizer_role to check against yet — gate
  // creation by Discord server Administrator instead.
  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply({
      content: "Only server administrators can create leagues.",
      ephemeral: true,
    });
    return;
  }
  const name = interaction.options.getString("name", true);
  const rounds = interaction.options.getInteger("rounds", true);
  const organizerRole = interaction.options.getRole("organizer_role", true);
  const announcementsChannel = interaction.options.getChannel(
    "announcements_channel",
    true,
  );

  let league;
  try {
    league = await createLeague({
      name,
      roundCount: rounds,
      organizerRoleId: organizerRole.id,
      announcementsChannelId: announcementsChannel.id,
      createdByDiscordId: interaction.user.id,
    });
  } catch (err) {
    await replyError(interaction, err);
    return;
  }

  let announcementPosted = false;
  let announcementError: string | null = null;
  try {
    const announcementChannel = await interaction.client.channels.fetch(
      announcementsChannel.id,
    );
    if (
      announcementChannel &&
      announcementChannel.type === ChannelType.GuildText
    ) {
      const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(CustomId.leagueJoin(league.id))
          .setLabel("Join League")
          .setStyle(ButtonStyle.Success),
      );
      await (announcementChannel as TextChannel).send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🎮 ${league.name} — registration is open`)
            .setDescription(
              [
                `Rounds: **${league.roundCount}**`,
                "",
                "Click **Join League** below to register, or run `/league join`.",
              ].join("\n"),
            )
            .setColor(0x38a169),
        ],
        components: [joinRow],
      });
      announcementPosted = true;
    } else {
      announcementError = "channel is not a text channel or not visible to the bot";
    }
  } catch (err) {
    announcementError = err instanceof Error ? err.message : String(err);
  }

  const descriptionLines = [
    `Rounds: **${league.roundCount}**`,
    `Organizer role: <@&${organizerRole.id}>`,
    `Announcements channel: <#${announcementsChannel.id}>`,
    "",
  ];
  if (announcementPosted) {
    descriptionLines.push(
      `Join announcement posted to <#${announcementsChannel.id}> with a Join button.`,
      "Run `/league start` when ready to lock registration and generate Round 1.",
    );
  } else {
    descriptionLines.push(
      `⚠️ **League was created, but the Join announcement could not be posted** in <#${announcementsChannel.id}> (${announcementError ?? "unknown error"}).`,
      "Grant the bot **View Channel, Send Messages, Embed Links** on that channel, then either:",
      "• Run `/league delete confirm:true` and `/league create` again, or",
      "• Tell players to use `/league join` directly.",
    );
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`League created: ${league.name}`)
        .setDescription(descriptionLines.join("\n"))
        .setColor(announcementPosted ? 0x3182ce : 0xd69e2e),
    ],
    ephemeral: true,
  });
}

async function handleStart(interaction: ChatInputCommandInteraction) {
  const league = await getCurrentLeague();
  if (!league) {
    await interaction.reply({
      content: "No league is currently open.",
      ephemeral: true,
    });
    return;
  }
  if (!(await isOrganizer(interaction, league.organizerRoleId))) {
    return denyNonOrganizer(interaction);
  }

  await interaction.deferReply();
  try {
    const { roundNumber, matches } = await startLeague(league.id);
    await postPairingsAndThreads(interaction, league, roundNumber, matches);
    await interaction.editReply({
      content: `League **${league.name}** started — Round ${roundNumber} pairings posted.`,
    });
  } catch (err) {
    await replyError(interaction, err);
  }
}

async function handleNextRound(interaction: ChatInputCommandInteraction) {
  const league = await getCurrentLeague();
  if (!league) {
    await interaction.reply({
      content: "No league is currently active.",
      ephemeral: true,
    });
    return;
  }
  if (!(await isOrganizer(interaction, league.organizerRoleId))) {
    return denyNonOrganizer(interaction);
  }

  const missingPolicy = (interaction.options.getString("missing_policy") ??
    "cancel") as "cancel" | "draw";
  await interaction.deferReply();
  try {
    const result = await advanceRound({
      leagueId: league.id,
      missingMatchPolicy: missingPolicy,
    });
    if (result.leagueCompleted) {
      await interaction.editReply({
        content: `League **${league.name}** is complete! Run \`/league standings\` for final results.`,
      });
      return;
    }
    await postPairingsAndThreads(
      interaction,
      league,
      result.roundNumber,
      result.matches,
    );
    await interaction.editReply({
      content: `Round ${result.roundNumber} pairings posted.`,
    });
  } catch (err) {
    await replyError(interaction, err);
  }
}

async function handleJoin(interaction: ChatInputCommandInteraction) {
  const league = await getCurrentLeague();
  if (!league || league.status !== "REGISTRATION_OPEN") {
    await interaction.reply({
      content: "Registration is not currently open.",
      ephemeral: true,
    });
    return;
  }
  try {
    const member =
      interaction.member && "displayName" in interaction.member
        ? (interaction.member as { displayName?: string })
        : null;
    const displayName =
      member?.displayName ??
      interaction.user.globalName ??
      interaction.user.username;
    const result = await joinLeague({
      leagueId: league.id,
      discordUserId: interaction.user.id,
      displayName,
    });
    await interaction.reply({
      content: result.alreadyJoined
        ? `You're already registered for **${league.name}**.`
        : `Welcome to **${league.name}**! You're registered.`,
      ephemeral: true,
    });
  } catch (err) {
    await replyError(interaction, err);
  }
}

async function handleDelete(interaction: ChatInputCommandInteraction) {
  const league = await getCurrentLeague();
  if (!league) {
    await interaction.reply({
      content: "No league is currently open or active.",
      ephemeral: true,
    });
    return;
  }
  if (!(await isOrganizer(interaction, league.organizerRoleId))) {
    return denyNonOrganizer(interaction);
  }
  const confirm = interaction.options.getBoolean("confirm", true);
  if (!confirm) {
    await interaction.reply({
      content:
        "Pass `confirm: true` to delete. This wipes the league, all matches, and all rounds.",
      ephemeral: true,
    });
    return;
  }

  try {
    const result = await deleteLeague(league.id);
    const lines = [
      `**${result.leagueName}** deleted.`,
      `Wiped: ${result.roundCount} round(s), ${result.matchCount} match(es), ${result.playerCount} player registration(s).`,
    ];
    if (result.threadIds.length > 0) {
      lines.push(
        `Note: ${result.threadIds.length} Discord thread(s) remain in the announcements channel — delete or archive them manually if needed.`,
      );
    }
    await interaction.reply({ content: lines.join("\n"), ephemeral: true });
  } catch (err) {
    await replyError(interaction, err);
  }
}

async function handleDrop(interaction: ChatInputCommandInteraction) {
  const league = await getCurrentLeague();
  if (!league) {
    await interaction.reply({
      content: "No league is currently active.",
      ephemeral: true,
    });
    return;
  }
  const result = await dropFromLeague({
    leagueId: league.id,
    discordUserId: interaction.user.id,
  });
  await interaction.reply({
    content: result.dropped
      ? `You've dropped from **${league.name}**.`
      : "You weren't an active participant in this league.",
    ephemeral: true,
  });
}

async function handleStandings(interaction: ChatInputCommandInteraction) {
  const league = await getCurrentLeague();
  if (!league) {
    // Fall back to most recently completed.
    const completed = await prisma.league.findFirst({
      where: { status: "COMPLETED" },
      orderBy: { id: "desc" },
    });
    if (!completed) {
      await interaction.reply({
        content: "No leagues yet.",
        ephemeral: true,
      });
      return;
    }
    await renderStandings(interaction, completed.id, completed.name, completed.currentRoundNumber);
    return;
  }
  await renderStandings(
    interaction,
    league.id,
    league.name,
    league.currentRoundNumber,
  );
}

async function renderStandings(
  interaction: ChatInputCommandInteraction,
  leagueId: number,
  leagueName: string,
  roundNumber: number,
) {
  await interaction.deferReply();
  const rows = await getStandingsForLeague(leagueId);
  await interaction.editReply({
    embeds: [standingsEmbed({ leagueName, roundNumber, rows })],
  });
}

async function handlePairings(interaction: ChatInputCommandInteraction) {
  const league = await getCurrentLeague();
  if (!league) {
    await interaction.reply({
      content: "No league is currently active.",
      ephemeral: true,
    });
    return;
  }
  const requested = interaction.options.getInteger("round");
  const roundNumber = requested ?? league.currentRoundNumber;
  if (roundNumber === 0) {
    await interaction.reply({
      content: "League hasn't started yet. Run `/league start` to generate Round 1.",
      ephemeral: true,
    });
    return;
  }
  const round = await prisma.round.findUnique({
    where: { leagueId_roundNumber: { leagueId: league.id, roundNumber } },
    include: {
      matches: {
        include: { playerA: true, playerB: true },
      },
    },
  });
  if (!round) {
    await interaction.reply({
      content: `Round ${roundNumber} not found.`,
      ephemeral: true,
    });
    return;
  }
  await interaction.reply({
    embeds: [
      pairingsEmbed({
        leagueName: league.name,
        roundNumber,
        rows: round.matches.map((m) => ({
          matchId: m.id,
          playerAName: m.playerA.displayName,
          playerBName: m.playerB?.displayName ?? null,
          threadId: m.threadId,
          status: m.status,
        })),
      }),
    ],
  });
}

async function postPairingsAndThreads(
  interaction: ChatInputCommandInteraction,
  league: { id: number; name: string; matchFormat: string; announcementsChannelId: string },
  roundNumber: number,
  matches: GeneratedMatch[],
) {
  const channel = await interaction.client.channels.fetch(
    league.announcementsChannelId,
  );
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error("Announcements channel is missing or not a text channel.");
  }
  const textChannel = channel as TextChannel;

  // Post the pairings embed first.
  await textChannel.send({
    embeds: [
      pairingsEmbed({
        leagueName: league.name,
        roundNumber,
        rows: matches.map((m) => ({
          matchId: m.matchId,
          playerAName: m.playerADisplayName,
          playerBName: m.playerBDisplayName,
          threadId: null,
          status: m.isBye ? "BYE" : "SCHEDULED",
        })),
      }),
    ],
  });

  // Create a thread per non-bye match.
  for (const m of matches) {
    if (m.isBye) {
      await textChannel.send({
        content: `<@${m.playerADiscordId}> has a **bye** this round (auto 2-0 / 3 match points).`,
      });
      continue;
    }
    const threadName = `r${roundNumber}-${slug(m.playerADisplayName)}-vs-${slug(
      m.playerBDisplayName ?? "tbd",
    )}`;
    const thread = await textChannel.threads.create({
      name: threadName.slice(0, 95),
      type: ChannelType.PublicThread,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Round ${roundNumber} match thread`,
    });
    if (m.playerADiscordId) await thread.members.add(m.playerADiscordId).catch(() => undefined);
    if (m.playerBDiscordId) await thread.members.add(m.playerBDiscordId).catch(() => undefined);

    await prisma.match.update({
      where: { id: m.matchId },
      data: { threadId: thread.id },
    });

    const reportRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CustomId.matchReportButton(m.matchId))
        .setLabel("Report Result")
        .setStyle(ButtonStyle.Primary),
    );
    await thread.send({
      content: `<@${m.playerADiscordId}> vs <@${m.playerBDiscordId}>`,
      embeds: [
        matchThreadEmbed({
          leagueName: league.name,
          roundNumber,
          playerAMention: `<@${m.playerADiscordId}>`,
          playerBMention: `<@${m.playerBDiscordId}>`,
          matchFormat: league.matchFormat,
        }),
      ],
      components: [reportRow],
    });
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "player";
}

async function replyError(
  interaction: ChatInputCommandInteraction,
  err: unknown,
) {
  const msg =
    err instanceof LeagueServiceError
      ? err.message
      : err instanceof Error
        ? `Unexpected error: ${err.message}`
        : "Unexpected error.";
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: msg });
  } else {
    await interaction.reply({ content: msg, ephemeral: true });
  }
}
