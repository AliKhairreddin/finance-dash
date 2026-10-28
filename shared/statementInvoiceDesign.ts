import { statementCompanies, type StatementCompanyId } from "./statements";
import { invoiceCompanyKey, matchingInvoiceAddress, type InvoiceAddress } from "./statementInvoices";

export type InvoiceDesign = { key: string; name: string; accent: string; style: "rule" | "minimal" | "frame"; font: "sans" | "serif"; logoPath?: string; logoMode?: "mark" | "padded"; source?: string };
export type InvoiceBox = { x: number; y: number; width: number; height: number };
export const invoiceCopyKeys = ["seller", "number", "date", "dueDate", "customer", "customerAddress", "customerVat", "payment", "notes", "currency", "lines", "net", "tax", "total"] as const;
export type InvoiceCopyField = InvoiceBox & { key: typeof invoiceCopyKeys[number]; fontSize: number; color: string; background: string; align: "left" | "right"; font: "sans" | "serif" };
export type InvoiceCopyLayout = { width: number; height: number; currency: string; fields: InvoiceCopyField[]; erase: InvoiceBox[]; columns: Array<{ key: "description" | "net" | "taxPercent" | "total"; x: number; width: number }> };
const palette = ["#35566c", "#536a48", "#71553e", "#5f5473", "#41696a", "#755760", "#515b72", "#686044"];
const owned: Record<StatementCompanyId, { accent: string; style: InvoiceDesign["style"]; font: InvoiceDesign["font"]; logoPath?: string; logoMode?: "mark" | "padded"; source?: string }> = {
  "amg-holding": { accent: "#3d4e66", style: "minimal", font: "serif" },
  "artec": { accent: "#eba11c", style: "rule", font: "sans", logoPath: "/invoice-brands/artec.png", source: "https://ar-tec.nl/" },
  "inch-engineering": { accent: "#47704c", style: "frame", font: "sans", logoPath: "/invoice-brands/inch-engineering.jpg", logoMode: "padded", source: "https://inchengineering.com/" },
  "digital-nudge": { accent: "#4754e8", style: "minimal", font: "sans", source: "https://digital-nudge.com/" },
  "inch-digital": { accent: "#47d5cd", style: "rule", font: "sans", logoPath: "/invoice-brands/inch-digital-mark.png", logoMode: "mark", source: "https://inch-digital.com/" },
  "mzs-bouw": { accent: "#f68a0a", style: "frame", font: "sans", logoPath: "/invoice-brands/mzs-bouw.svg", source: "https://mzsbouw.nl/" }
};
export function invoiceIssuerKey(name: string, companyId: StatementCompanyId, direction: "in" | "out", addresses: InvoiceAddress[]) {
  if (direction === "in") return `our:${companyId}`;
  const match = matchingInvoiceAddress(addresses, name), contact = match?.reviewNote ? undefined : match;
  const canonical = contact?.invoiceName || contact?.name || name;
  const ours = statementCompanies.find(c => [c.name, matchingInvoiceAddress(addresses, c.name)?.invoiceName].some(n => n && invoiceCompanyKey(n) === invoiceCompanyKey(canonical)));
  return ours ? `our:${ours.id}` : `supplier:${invoiceCompanyKey(canonical)}`;
}
export function defaultInvoiceDesign(key: string, name: string): InvoiceDesign {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const company = key.startsWith("our:") ? owned[key.slice(4) as StatementCompanyId] : undefined;
  return { key, name, ...(company ?? { accent: palette[hash % palette.length], style: (["rule", "minimal", "frame"] as const)[(hash >>> 4) % 3], font: (hash & 16) ? "serif" as const : "sans" as const }) };
}
export function validateInvoiceDesign(value: InvoiceDesign): InvoiceDesign {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value.accent) || !["rule", "minimal", "frame"].includes(value.style) || !["sans", "serif"].includes(value.font) || typeof value.key !== "string" || value.key.length > 300 || typeof value.name !== "string" || value.name.length > 250 || (value.logoPath && !/^\/invoice-brands\/[a-z0-9-]+\.(png|svg|jpg)$/.test(value.logoPath))) throw new Error("Check the company design");
  if (value.logoMode && !["mark", "padded"].includes(value.logoMode)) throw new Error("Check the company logo");
  return value;
}
export function validateInvoiceCopy(value: InvoiceCopyLayout): InvoiceCopyLayout {
  const box = (b: InvoiceBox) => b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= value.width + 0.1 && b.y + b.height <= value.height + 0.1;
  if (!value || !/^[A-Z]{3,4}$/.test(value.currency) || !Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width < 300 || value.width > 1000 || value.height < 400 || value.height > 1400 || !Array.isArray(value.fields) || value.fields.length > 30 || !Array.isArray(value.erase) || value.erase.length > 100 || !Array.isArray(value.columns) || value.columns.length !== 4) throw new Error("The example layout could not be mapped. Read the example again.");
  if (value.fields.some(f => !box(f) || !invoiceCopyKeys.includes(f.key) || !Number.isFinite(f.fontSize) || f.fontSize < 6 || f.fontSize > 30 || !/^#[0-9a-f]{6}$/i.test(f.color) || !/^#[0-9a-f]{6}$/i.test(f.background) || !["left", "right"].includes(f.align) || !["sans", "serif"].includes(f.font)) || value.erase.some(b => !box(b))) throw new Error("Check the example's text areas");
  const keys = value.fields.map(f => f.key);
  if (new Set(keys).size !== keys.length || ["seller", "number", "date", "customer", "customerAddress", "lines", "net", "tax", "total"].some(key => !keys.includes(key as InvoiceCopyField["key"]))) throw new Error("The example must include company details, invoice number, date, lines and totals");
  if (value.fields.some((a, i) => value.fields.slice(i + 1).some(b => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5))) throw new Error("The example's text areas overlap. Adjust their positions before saving.");
  const lines = value.fields.find(f => f.key === "lines")!;
  if (new Set(value.columns.map(c => c.key)).size !== 4 || value.columns.some(c => !["description", "net", "taxPercent", "total"].includes(c.key) || !Number.isFinite(c.x) || !Number.isFinite(c.width) || c.x < lines.x - 0.1 || c.width <= 0 || c.x + c.width > lines.x + lines.width + 0.1)) throw new Error("Check the example's line columns");
  if (value.columns.some((a, i) => value.columns.slice(i + 1).some(b => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.1))) throw new Error("The example's line columns overlap");
  return value;
}
