import type { MeritTax } from "./types";

export interface MeritCopyLine {
  itemCode: string; description: string; quantity: number; price: number;
  discountPercent: number; discountAmount: number; netAmount: number;
  taxId: string; taxPercent: number; taxAmount: number;
  accountCode: string; departmentCode: string; unit: string;
}
export interface MeritInvoiceCopy {
  lines: MeritCopyLine[]; netAmount: number; taxAmount: number; roundingAmount: number; totalAmount: number;
  currency: string; departmentCode: string; headerComment: string; footerComment: string; contractNumber: string;
}
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Merit invoice details are incomplete");
  return value as Record<string, unknown>;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Merit invoice amounts are incomplete");
  return value;
}
function text(value: unknown, max: number, required = false): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error("Merit invoice line or accounting details are incomplete");
  return value;
}

export function readMeritInvoiceCopy(value: unknown): MeritInvoiceCopy {
  const detail = record(value), header = record(detail.Header);
  if (header.AccountingDock !== 1 || header.PriceInclVat || header.ProjectCode || (Array.isArray(header.Dimensions) && header.Dimensions.length)) {
    throw new Error("This invoice uses tax-inclusive prices or accounting allocations that must be copied in Merit");
  }
  if (!Array.isArray(detail.Lines) || !detail.Lines.length || detail.Lines.length > 200) throw new Error("Choose an invoice with 1–200 lines");
  const lines = detail.Lines.map(value => {
    const row = record(value);
    if (row.FixAsset || row.LocationCode || row.BatchNo || row.ItemCostAmount || (Array.isArray(row.DimAllocation) && row.DimAllocation.length)) throw new Error("Copy stock, asset, or allocated invoice lines directly in Merit");
    return {
      itemCode: text(row.ArticleCode, 20, true), description: text(row.Description, 150, true),
      quantity: number(row.Quantity), price: number(row.Price),
      discountPercent: number(row.DiscountPct), discountAmount: number(row.DiscountAmount), netAmount: number(row.AmountExclVat),
      taxId: text(row.TaxId, 100, true), taxPercent: number(row.TaxPct), taxAmount: number(row.VatAmount),
      accountCode: text(row.AccountCode, 10, true), departmentCode: text(row.DepartmentCode, 20), unit: text(row.UOMName, 64)
    };
  });
  return validateMeritInvoiceCopy({ lines, netAmount: number(header.TotalAmount), taxAmount: number(header.TaxAmount), roundingAmount: number(header.RoundingAmount), totalAmount: number(header.TotalSum),
    currency: text(header.CurrencyCode, 4, true), departmentCode: text(header.DepartmentCode, 20), headerComment: text(header.HComment, 4000), footerComment: text(header.FComment, 4000), contractNumber: text(header.ContractNo, 35) });
}

export function validateMeritInvoiceCopy(copy: MeritInvoiceCopy, amount = copy.netAmount, currency = copy.currency): MeritInvoiceCopy {
  if (!Array.isArray(copy.lines) || !copy.lines.length || copy.lines.length > 200) throw new Error("Copied invoice lines are missing");
  for (const line of copy.lines) {
    for (const value of [line.quantity, line.price, line.discountPercent, line.discountAmount, line.netAmount, line.taxPercent, line.taxAmount]) number(value);
    text(line.itemCode, 20, true); text(line.description, 150, true); text(line.taxId, 100, true); text(line.accountCode, 10, true);
    text(line.departmentCode, 20); text(line.unit, 64);
    const discount = line.discountAmount;
    if (line.discountPercent < 0 || line.discountPercent > 100 || line.taxPercent < 0
      || !same(money(line.quantity * line.price - discount), line.netAmount)
      || !same(money(line.netAmount * line.taxPercent / 100), line.taxAmount)) throw new Error("Copied invoice line totals do not reconcile");
  }
  for (const value of [copy.netAmount, copy.taxAmount, copy.roundingAmount, copy.totalAmount, amount]) number(value);
  text(copy.currency, 4, true); text(copy.departmentCode, 20); text(copy.headerComment, 4000); text(copy.footerComment, 4000); text(copy.contractNumber, 35);
  if (copy.netAmount <= 0 || !same(money(copy.lines.reduce((sum, line) => sum + line.netAmount, 0)), copy.netAmount)
    || !same(money(copy.lines.reduce((sum, line) => sum + line.taxAmount, 0)), copy.taxAmount)
    || !same(money(copy.netAmount + copy.taxAmount + copy.roundingAmount), copy.totalAmount)
    || !same(copy.netAmount, amount) || currency !== copy.currency) throw new Error("Copied invoice totals or currency do not match the original lines");
  return copy;
}

export function verifyMeritCopyTaxes(copy: MeritInvoiceCopy, taxes: MeritTax[]) {
  for (const line of copy.lines) {
    const tax = taxes.find(tax => tax.id === line.taxId);
    if (!tax || tax.taxPct !== line.taxPercent) throw new Error("A copied line's Merit tax has changed. Duplicate the source invoice again before sending.");
  }
}

export function meritCopyRequest(copy: MeritInvoiceCopy) {
  validateMeritInvoiceCopy(copy);
  const taxes = new Map<string, number>();
  for (const line of copy.lines) taxes.set(line.taxId, money((taxes.get(line.taxId) ?? 0) + line.taxAmount));
  return {
    InvoiceRow: copy.lines.map(line => ({
      Item: { Code: line.itemCode, Description: line.description, UOMName: line.unit },
      Quantity: line.quantity, Price: line.price, DiscountPct: line.discountPercent, DiscountAmount: line.discountAmount,
      TaxId: line.taxId, GLAccountCode: line.accountCode, DepartmentCode: line.departmentCode
    })),
    TaxAmount: [...taxes].map(([TaxId, Amount]) => ({ TaxId, Amount })), TotalAmount: copy.netAmount, RoundingAmount: copy.roundingAmount,
    DepartmentCode: copy.departmentCode, Hcomment: copy.headerComment, Fcomment: copy.footerComment, ContractNo: copy.contractNumber
  };
}
