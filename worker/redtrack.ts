import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { validateRedTrackDates, validateRedTrackLink } from "../shared/redtrack";
import { readBoundedResponseText } from "../shared/boundedHttp";

export async function handleRedTrackApi(request: Request, env: { CONVEX_URL: string; CONVEX_SERVICE_TOKEN: string }): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/redtrack")) return null;
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const client = new ConvexHttpClient(env.CONVEX_URL), auth = { serviceToken: env.CONVEX_SERVICE_TOKEN };
    const force = url.pathname === "/api/redtrack/sync" && request.method === "POST";
    if ((url.pathname === "/api/redtrack" && request.method === "GET") || force) {
      if (force && request.headers.get("Origin") !== url.origin) return json({ message: "Sync RedTrack from this website." }, 403);
      const fromDate = url.searchParams.get("fromDate") ?? "", toDate = url.searchParams.get("toDate") ?? "";
      try { validateRedTrackDates(fromDate, toDate); } catch (error) { return json({ message: (error as Error).message }, 400); }
      const [report, links] = await Promise.all([client.action(api.redtrack.report, { ...auth, fromDate, toDate, force }), client.query(api.redtrack.links, auth)]);
      return json({ ...report, links });
    }
    if (url.pathname === "/api/redtrack/links" && request.method === "PUT") {
      if (request.headers.get("Origin") !== url.origin) return json({ message: "Save advertiser links from this website." }, 403);
      let text: string;
      try { text = await readBoundedResponseText(new Response(request.body), "Dashboard link", 4096); }
      catch { return json({ message: "The dashboard link is too long or incomplete." }, 400); }
      let body: { sourceId: string; url: string };
      try {
        body = JSON.parse(text);
        if (typeof body?.sourceId !== "string" || typeof body?.url !== "string") throw new Error("An offer source and dashboard URL are required.");
        body.url = validateRedTrackLink(body.sourceId, body.url);
      } catch (error) { return json({ message: error instanceof Error ? error.message : "Invalid dashboard link." }, 400); }
      await client.mutation(api.redtrack.saveLink, { ...auth, sourceId: body.sourceId, url: body.url });
      return json({ links: await client.query(api.redtrack.links, auth) });
    }
    return json({ message: "RedTrack endpoint not found." }, 404);
  } catch (error) {
    if (error instanceof ConvexError && error.data && typeof error.data === "object") {
      const data = error.data as { status?: number; message?: string };
      return json({ message: data.message ?? "RedTrack is unavailable." }, data.status ?? 502);
    }
    return json({ message: "RedTrack could not be reached. Please retry." }, 502);
  }
}
