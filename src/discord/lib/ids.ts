// Custom IDs for component interactions follow the scheme:
//   <namespace>:<action>:<arg>
// e.g. "match:confirm:42" — the namespace lets the dispatcher route by prefix.

export const CustomId = {
  matchConfirm: (matchId: number) => `match:confirm:${matchId}`,
  matchDispute: (matchId: number) => `match:dispute:${matchId}`,
  matchReportButton: (matchId: number) => `match:report:${matchId}`,
  leagueJoin: (leagueId: number) => `league:join:${leagueId}`,
};

export function parseCustomId(
  id: string,
): { namespace: string; action: string; arg: string } | null {
  const parts = id.split(":");
  if (parts.length < 3) return null;
  const ns = parts[0];
  const action = parts[1];
  const arg = parts.slice(2).join(":");
  if (!ns || !action) return null;
  return { namespace: ns, action, arg };
}
