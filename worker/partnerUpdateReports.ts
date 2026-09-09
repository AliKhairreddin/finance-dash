import type { PartnerReportData, PartnerReportKind } from "../shared/partnerUpdates";
import { boundedBytes } from "./documentIntake";
import type { TelegramCommandDocument } from "./telegram";

export function partnerReportHtml(data: PartnerReportData, kind: PartnerReportKind): string {
  const json = JSON.stringify({ data, kind }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#f3f5f4}canvas{display:block}</style></head><body><script type="application/json" id="partner-report-data">${json}</script><canvas id="report"></canvas></body></html>`;
}

export async function renderPartnerReport(env: WorkerEnv, data: PartnerReportData, kind: PartnerReportKind): Promise<TelegramCommandDocument> {
  const assets = await Promise.all(["partner-report.js", "partner-report.css"].map(async file => {
    const response = await env.ASSETS.fetch(new Request(new URL(`/${file}`, env.PUBLIC_APP_URL)));
    if (!response.ok || !response.headers.get("content-type")?.match(file.endsWith(".js") ? /javascript/ : /css/)) {
      throw new Error("Partner report renderer is not deployed.");
    }
    return new TextDecoder().decode(await boundedBytes(response.body, 2 * 1024 * 1024));
  }));
  const response = await env.BROWSER.quickAction("screenshot", {
    html: partnerReportHtml(data, kind).replace("</head>", `<style>${assets[1]}</style></head>`),
    addScriptTag: [{ content: assets[0] }],
    viewport: { width: 1600, height: 1000 },
    waitForSelector: { selector: "#partner-report-ready", timeout: 45_000 },
    selector: "#partner-report-ready",
    screenshotOptions: { type: "png" },
    cacheTTL: 0
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("image/png")) throw new Error("Partner report image could not render.");
  const bytes = await boundedBytes(response.body, 10 * 1024 * 1024);
  if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) throw new Error("Partner report renderer did not return a PNG.");
  const date = kind === "cash-flow" ? data.cashFlow.asOfDate : data.capturedAt.slice(0, 10);
  return { bytes: bytes.buffer, contentType: "image/png", fileName: `${kind}-${date}.png`,
    caption: `${kind === "cash-flow" ? "Cash flow" : "Open invoices"} · ${date}\nPartner update · ${data.capturedAt}` };
}
