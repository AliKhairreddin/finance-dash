export const redTrackCurrency = "USD";
export const redTrackTimezone = "America/New_York";
export const redTrackGroups = ["offerSources", "offers", "trafficChannels", "campaigns", "daily"] as const;
export type RedTrackGroup = typeof redTrackGroups[number];
export type RedTrackBasis = "primary" | "all";
export type RedTrackSource = { id: string; name: string };
export type RedTrackLink = { sourceId: string; url: string };
export type RedTrackRow = {
  key: string;
  date: string;
  offerSourceId: string;
  offerSource: string;
  offerId: string;
  offer: string;
  trafficChannelId: string;
  trafficChannel: string;
  campaignId: string;
  campaign: string;
  revenue: number;
  conversions: number;
  allRevenue: number;
  allConversions: number;
};
export type RedTrackReport = {
  fromDate: string;
  toDate: string;
  currency: string;
  timezone: string;
  fetchedAt: string;
  savedAt: string;
  syncedDates: string[];
  rows: RedTrackRow[];
  sources: RedTrackSource[];
  links: RedTrackLink[];
};

export function redTrackDates(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  for (let time = Date.parse(fromDate); time <= Date.parse(toDate); time += 86_400_000) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}

export function redTrackNeedsSync(date: string, savedAt: number | undefined, now: number): boolean {
  if (savedAt === undefined) return true;
  const age = Math.floor((Date.parse(redTrackToday(new Date(now))) - Date.parse(date)) / 86_400_000);
  if (age > 30) return Date.parse(redTrackToday(new Date(savedAt))) <= Date.parse(date) + 30 * 86_400_000;
  const interval = age === 0 ? 15 * 60_000 : age <= 3 ? 60 * 60_000 : 24 * 60 * 60_000;
  return now - savedAt >= interval;
}

export function redTrackSyncRanges(dates: string[]): { fromDate: string; toDate: string }[] {
  const ranges: { fromDate: string; toDate: string }[] = [];
  for (const date of [...dates].sort()) {
    const last = ranges.at(-1);
    if (last && Date.parse(date) - Date.parse(last.toDate) === 86_400_000) last.toDate = date;
    else ranges.push({ fromDate: date, toDate: date });
  }
  return ranges;
}
export type RedTrackFilters = { offerSourceId: string; offerId: string; trafficChannelId: string; search: string };
export type RedTrackGroupRow = {
  key: string;
  label: string;
  offerSourceId: string;
  offerSource: string;
  offerId: string;
  offer: string;
  trafficChannelId: string;
  trafficChannel: string;
  offers: number;
  trafficChannels: number;
  campaigns: number;
  revenue: number;
  conversions: number;
};

export function redTrackToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: redTrackTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function validateRedTrackDates(fromDate: string, toDate: string): void {
  for (const value of [fromDate, toDate]) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new Error("Choose valid dates for the RedTrack report.");
    }
  }
  if (fromDate > toDate) throw new Error("The start date must be on or before the end date.");
  if ((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000 >= 93) throw new Error("Choose a RedTrack period of 93 days or fewer.");
  if (toDate > redTrackToday()) throw new Error("RedTrack reports cannot include future dates.");
}

export function validateRedTrackLink(sourceId: string, value: string): string {
  if (!/^[a-f0-9]{24}$/.test(sourceId)) throw new Error("Choose a valid RedTrack offer source.");
  if (!value.trim()) return "";
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a full advertiser dashboard URL starting with https://."); }
  if (value.length > 2048 || url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) {
    throw new Error("Use an HTTPS dashboard URL without embedded login credentials.");
  }
  return url.href;
}

export function filterRedTrackRows(rows: RedTrackRow[], filters: RedTrackFilters): RedTrackRow[] {
  const search = filters.search.trim().toLowerCase();
  return rows.filter(row => (!filters.offerSourceId || row.offerSourceId === filters.offerSourceId)
    && (!filters.offerId || row.offerId === filters.offerId)
    && (!filters.trafficChannelId || row.trafficChannelId === filters.trafficChannelId)
    && (!search || [row.offerSource, row.offer, row.trafficChannel, row.campaign].some(value => value.toLowerCase().includes(search))));
}

export function groupRedTrackRows(rows: RedTrackRow[], group: RedTrackGroup, basis: RedTrackBasis): RedTrackGroupRow[] {
  const groups = new Map<string, { row: RedTrackGroupRow; offers: Set<string>; channels: Set<string>; campaigns: Set<string> }>();
  for (const row of rows) {
    const sourceKey = row.offerSourceId || row.offerSource;
    const key = JSON.stringify(group === "offerSources" ? [sourceKey]
      : group === "offers" ? [sourceKey, row.offerId || row.offer, row.trafficChannelId || row.trafficChannel]
      : group === "trafficChannels" ? [row.trafficChannelId || row.trafficChannel]
      : group === "campaigns" ? [sourceKey, row.campaignId || row.campaign, row.offerId || row.offer, row.trafficChannelId || row.trafficChannel] : [row.date]);
    const label = group === "offerSources" ? row.offerSource : group === "offers" ? row.offer
      : group === "trafficChannels" ? row.trafficChannel : group === "campaigns" ? row.campaign : row.date;
    let entry = groups.get(key);
    if (!entry) {
      entry = { row: { key, label, offerSourceId: group === "trafficChannels" || group === "daily" ? "" : row.offerSourceId,
        offerSource: group === "trafficChannels" || group === "daily" ? "" : row.offerSource,
        offerId: group === "offers" || group === "campaigns" ? row.offerId : "",
        offer: group === "offers" || group === "campaigns" ? row.offer : "",
        trafficChannelId: group === "daily" || group === "offerSources" ? "" : row.trafficChannelId,
        trafficChannel: group === "daily" || group === "offerSources" ? "" : row.trafficChannel,
        offers: 0, trafficChannels: 0, campaigns: 0, revenue: 0, conversions: 0 }, offers: new Set(), channels: new Set(), campaigns: new Set() };
      groups.set(key, entry);
    }
    entry.row.revenue += basis === "primary" ? row.revenue : row.allRevenue;
    entry.row.conversions += basis === "primary" ? row.conversions : row.allConversions;
    if (row.offerId) entry.offers.add(row.offerId);
    if (row.trafficChannelId) entry.channels.add(row.trafficChannelId);
    if (row.campaignId) entry.campaigns.add(row.campaignId);
  }
  return [...groups.values()].map(({ row, offers, channels, campaigns }) => ({ ...row,
    revenue: Math.round(row.revenue * 10_000) / 10_000, offers: offers.size, trafficChannels: channels.size, campaigns: campaigns.size }));
}
