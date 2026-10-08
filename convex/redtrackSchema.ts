import { v } from "convex/values";
export const redtrackRow = v.object({ key: v.string(), date: v.string(), offerSourceId: v.string(), offerSource: v.string(), offerId: v.string(), offer: v.string(),
  trafficChannelId: v.string(), trafficChannel: v.string(), campaignId: v.string(), campaign: v.string(),
  revenue: v.number(), conversions: v.number(), allRevenue: v.number(), allConversions: v.number() });
export const redtrackSource = v.object({ id: v.string(), name: v.string() });
