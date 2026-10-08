import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { WagnerSpendCache } from "./wagnerSpendApi";

export function wagnerSpendStore(client: ConvexHttpClient, serviceToken: string): WagnerSpendCache {
  return {
    acquire: (key, attemptId) => client.mutation(api.wagnerSpendCache.acquire, { serviceToken, key, attemptId }),
    async save(key, attemptId, entry) { await client.mutation(api.wagnerSpendCache.save, { serviceToken, key, attemptId, ...entry }); },
    async release(key, attemptId) { await client.mutation(api.wagnerSpendCache.release, { serviceToken, key, attemptId }); }
  };
}
