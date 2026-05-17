import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
} from "discord.js";
import { prisma } from "../../db/client.js";

/**
 * Resolve the single active or registration-open league. Returns null if none.
 * Lean MVP: at most one non-completed league at a time per guild.
 */
export async function getCurrentLeague() {
  return prisma.league.findFirst({
    where: { status: { in: ["REGISTRATION_OPEN", "ACTIVE"] } },
    orderBy: { id: "desc" },
  });
}

/**
 * Check whether the invoker has the organizer role (or Administrator).
 * Fetches the GuildMember if the cached `interaction.member` is the API shape.
 */
export async function isOrganizer(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  organizerRoleId: string,
): Promise<boolean> {
  if (!interaction.inGuild()) return false;
  if (interaction.member instanceof GuildMember) {
    return memberHasOrganizer(interaction.member, organizerRoleId);
  }
  const guild = interaction.guild;
  if (!guild) return false;
  const fetched = await guild.members
    .fetch(interaction.user.id)
    .catch(() => null);
  if (!fetched) return false;
  return memberHasOrganizer(fetched, organizerRoleId);
}

function memberHasOrganizer(
  member: GuildMember,
  organizerRoleId: string,
): boolean {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.has(organizerRoleId);
}

export async function denyNonOrganizer(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.reply({
    content: "Only league organizers can run this command.",
    ephemeral: true,
  });
}
