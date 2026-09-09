import "@fontsource-variable/geist";
import { renderCashFlowPng } from "../cash-flow/exportCashFlowPng";
import { renderPartnerInvoices } from "./renderPartnerInvoices";
import type { PartnerReportData, PartnerReportKind } from "../../../shared/partnerUpdates";

async function render() {
  const payload = document.getElementById("partner-report-data");
  if (!payload?.textContent) return;
  const { data, kind } = JSON.parse(payload.textContent) as { data: PartnerReportData; kind: PartnerReportKind };
  await document.fonts.load('500 18px "Geist Variable"');
  await document.fonts.load('600 23px "Geist Variable"');
  const canvas = document.getElementById("report") as HTMLCanvasElement;
  if (kind === "cash-flow") renderCashFlowPng(canvas, data.cashFlow, data.history, data.rates);
  else renderPartnerInvoices(canvas, data);
  // The screenshot waits for this marker; failed rendering cannot send an empty image.
  canvas.id = "partner-report-ready";
}

void render().catch(error => {
  document.body.textContent = error instanceof Error ? error.message : "Report could not render";
});
