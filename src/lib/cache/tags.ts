export const DASHBOARD_CACHE_TAGS = {
  market: "dashboard:market",
  whales: "dashboard:whales"
} as const;

export function whaleManagerTag(managerId: string): string {
  return `dashboard:whale:${managerId}`;
}
