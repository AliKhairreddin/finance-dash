import { Check } from "lucide-react";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { financeOperatingDate, shiftFinanceOperatingDate } from "../../../shared/operatingDate";
import { minimumPaymentSamples } from "../../../shared/paymentForecasts";
import type { BankPaymentPattern, Invoice, InvoicePaymentPrediction } from "../../../shared/types";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

export function BankPatternForecast({ pattern, label, invoice }: { pattern: BankPaymentPattern; label: string; invoice?: Invoice }) {
  const past = pattern.expectedDate < financeOperatingDate();
  return <span className="expected-payment">
    <span className={past || pattern.stale ? "danger-text" : undefined}>
      {dateLabel(pattern.expectedDate)}
      <small>{pattern.stale ? "Bank pattern · stale" : pattern.confidence === "low" ? "Bank pattern · low confidence" : "Bank pattern"}{past && !pattern.stale ? " · past estimate" : ""}</small>
    </span>
    <InfoPopover label={label}>
      <p>Roughly every {pattern.intervalDays} days, based on {pattern.sampleSize} distinct bank receipt dates and {pattern.matchingIntervals} consistent intervals. Last receipt: {dateLabel(pattern.anchorDate)}.</p>
      <p>Estimated window: {dateLabel(pattern.earliestDate)}–{dateLabel(pattern.latestDate)}. This predicts a client payment cycle, not contractual payment terms or confirmation that a particular invoice will be included.</p>
      {pattern.disrupted && <p>The history includes a gap longer than two usual cycles. This estimate assumes the earlier pattern resumes.</p>}
      {pattern.stale && <p>Stale pattern: the cycle expected around {dateLabel(shiftFinanceOperatingDate(pattern.anchorDate, pattern.intervalDays))} has no newer saved receipt. Check recent bank coverage or follow up with the client.</p>}
      {pattern.confidence === "low" && !pattern.stale && !pattern.disrupted && <p>Limited or variable history; treat this date as tentative.</p>}
      {invoice && <p>The estimate selects the first projected payment cycle on or after this invoice’s date. It does not match or settle the invoice.</p>}
      {invoice?.status === "draft" && <p>Provisional until this draft is issued.</p>}
    </InfoPopover>
  </span>;
}

export function PaymentForecast({ invoice, prediction }: { invoice: Invoice; prediction?: InvoicePaymentPrediction }) {
  if (invoice.status === "paid") return <span className="expected-payment good"><Check size={14} /> Paid{invoice.paidAt ? ` ${dateLabel(invoice.paidAt)}` : ""}</span>;
  const label = `expected payment for ${invoice.invoiceNumber || invoice.customerName}`;
  if (prediction?.state === "estimated" && prediction.basis === "bank_pattern" && prediction.bankPattern) {
    return <BankPatternForecast pattern={prediction.bankPattern} label={label} invoice={invoice} />;
  }
  if (prediction?.state === "estimated" && prediction.predictedDate) {
    const past = prediction.predictedDate < financeOperatingDate();
    return <span className="expected-payment">
      <span className={past ? "danger-text" : undefined}>{dateLabel(prediction.predictedDate)}{past && <small>Past estimate</small>}</span>
      <InfoPopover label={label}>
        <p>Estimated {prediction.medianDays} days after the invoice date, using the median of the last {prediction.sampleSize} independently matched bank payments in this currency. Observed range: {prediction.earliestDays}–{prediction.latestDays} days.</p>
        {prediction.sampleSize < 5 && <p>Limited history: this estimate is based on fewer than five payments.</p>}
        {invoice.status === "draft" && <p>Provisional until this draft is issued. Changing its invoice date changes the estimate.</p>}
        {past && <p>The predicted date has passed. Review the payment match or follow up with the client.</p>}
      </InfoPopover>
    </span>;
  }
  const state = prediction?.state;
  const text = state === "review" ? "Review match" : state === "excluded" ? "Not forecasted" : state === "incomplete" ? "History incomplete" : "No estimate";
  const explanation = state === "review" ? "A linked receipt predates this invoice, the invoice date is invalid, or an invoice replacement is pending. Review the invoice and bank match."
    : state === "excluded" ? "Forecasts cover identifiable external business clients. Owned companies, investors, transfers, and unidentified payers are excluded."
    : state === "incomplete" ? "The saved-history query reached its read limit. Estimates and totals are withheld until the full history can be processed."
    : `${prediction?.sampleSize ?? 0} of ${minimumPaymentSamples} independent invoice-to-bank matches available in this currency, and no consistent bank receipt pattern yet. An estimate can use either matched invoices or at least three distinct receipt dates with a repeatable interval.`;
  return <span className="expected-payment muted"><span>{text}</span><InfoPopover label={label}>{explanation}</InfoPopover></span>;
}
