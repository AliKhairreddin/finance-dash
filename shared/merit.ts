import type {
  Invoice,
  MeritCompanyComment,
  MeritCompanyDetails,
  MeritCompanyDimension,
  Provider
} from "./types";

export type MeritCompanyRelationship = MeritCompanyDetails["relationship"];

export interface MeritInvoicePeriod {
  periodStart: string;
  periodEnd: string;
}

export function meritInvoiceLineDescription(
  description: string,
  periodStart?: string,
  periodEnd?: string,
  maxLength = 150
): string {
  const cleanDescription = description.trim();
  if (!periodStart || !periodEnd) return cleanDescription.slice(0, maxLength);

  const period = `(Period: ${periodStart} - ${periodEnd})`;
  const descriptionLength = Math.max(0, maxLength - period.length - 1);
  const shortenedDescription = cleanDescription.slice(0, descriptionLength).trimEnd();
  return shortenedDescription ? `${shortenedDescription} ${period}` : period.slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return String(value).trim() || undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return undefined;
}

function optionalFields<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function uniqueText(values: Array<string | undefined>): string[] {
  const byNormalized = new Map<string, string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLocaleLowerCase();
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, trimmed);
  }
  return [...byNormalized.values()];
}

function normalizedIdentity(value: string | undefined): string {
  return value?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim() ?? "";
}

function meritComments(value: unknown): MeritCompanyComment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const comments = value.flatMap((item): MeritCompanyComment[] => {
    if (!isRecord(item)) return [];
    const commentText = text(item.Comment);
    if (!commentText) return [];
    return [{ text: commentText, ...optionalFields({ date: text(item.CommDate) }) }];
  });
  return comments.length > 0 ? comments : undefined;
}

function meritDimensions(value: unknown): MeritCompanyDimension[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const dimensions = value.flatMap((item): MeritCompanyDimension[] => {
    if (!isRecord(item)) return [];
    const dimension = optionalFields({
      id: text(item.Id),
      dimensionId: text(item.DimId),
      dimensionValueId: text(item.DimValueId),
      code: text(item.DimCode)
    });
    return Object.keys(dimension).length > 0 ? [dimension as MeritCompanyDimension] : [];
  });
  return dimensions.length > 0 ? dimensions : undefined;
}

function meritAddress(row: Record<string, unknown>): string | undefined {
  const parts = uniqueText([
    text(row.Address),
    text(row.City),
    text(row.County),
    text(row.PostalCode),
    text(row.CountryName)
  ]);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function meritCompanyDetails(row: Record<string, unknown>, relationship: MeritCompanyRelationship): MeritCompanyDetails {
  return {
    relationship,
    ...optionalFields({
      registrationNumber: text(row.RegNo),
      contactName: text(row.Contact),
      phone: text(row.PhoneNo),
      secondaryPhone: text(row.PhoneNo2),
      city: text(row.City),
      county: text(row.County),
      postalCode: text(row.PostalCode),
      countryName: text(row.CountryName),
      fax: text(row.FaxNo),
      website: text(row.HomePage),
      bankName: text(row.BankName),
      bankAccount: text(row.BankAccount),
      referenceNumber: text(row.ReferenceNo ?? row.RefNoBase),
      invoiceLanguage: text(row.SalesInvLang),
      groupId: text(relationship === "customer" ? row.CustomerGroupId : row.VendorGroupId),
      groupName: text(relationship === "customer" ? row.CustomerGroupName : row.VendorGroupName),
      changedDate: text(row.ChangedDate),
      invoiceSendPreference: text(row.InvSendPref),
      glnCode: text(row.GLNCode),
      partyCode: text(row.PartyCode),
      telemaEdi: text(row.TelemaEdi),
      vendorType: relationship === "vendor" ? numberValue(row.VendorType) : undefined,
      notTaxDomesticCustomer: relationship === "customer" ? booleanValue(row.NotTDCustomer) : undefined,
      taxRegistered: relationship === "vendor" ? booleanValue(row.VatAccountable) : undefined,
      overdueCharge: numberValue(row.OverdueCharge),
      comments: meritComments(row.Comments),
      dimensions: meritDimensions(row.Dimensions)
    })
  };
}

export function meritProviderId(relationship: MeritCompanyRelationship, meritId: string): string {
  return `merit-${relationship}-${meritId}`;
}

function responseRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) && Object.keys(value).length > 0 ? [value] : [];
}

export function meritProvidersFromResponse(
  value: unknown,
  relationship: MeritCompanyRelationship,
  syncedAt = new Date().toISOString()
): Provider[] {
  return responseRows(value).flatMap((row): Provider[] => {
    const meritId = text(relationship === "customer" ? row.CustomerId : row.VendorId);
    const name = text(row.Name);
    if (!meritId || !name) return [];
    const groupName = text(relationship === "customer" ? row.CustomerGroupName : row.VendorGroupName);
    const details = meritCompanyDetails(row, relationship);
    return [{
      id: meritProviderId(relationship, meritId),
      name,
      type: relationship === "customer" ? "client" : "supplier",
      tags: uniqueText(["Merit", groupName]),
      aliases: [name],
      legalName: name,
      ...optionalFields({
        email: text(row.Email),
        country: text(row.CountryCode) ?? text(row.CountryName),
        address: meritAddress(row),
        taxId: text(row.VatRegNo),
        defaultCurrency: text(row.CurrencyCode)?.toUpperCase(),
        paymentTermsDays: numberValue(row.PaymentDeadLine),
        meritCustomerId: relationship === "customer" ? meritId : undefined,
        meritSupplierId: relationship === "vendor" ? meritId : undefined
      }),
      meritDetails: details,
      source: "merit",
      createdAt: syncedAt
    }];
  });
}

function relationshipId(provider: Provider, relationship: MeritCompanyRelationship): string | undefined {
  return relationship === "customer" ? provider.meritCustomerId : provider.meritSupplierId;
}

function expectedProviderType(relationship: MeritCompanyRelationship): Provider["type"] {
  return relationship === "customer" ? "client" : "supplier";
}

function strongCompanyMatch(provider: Provider, remote: Provider): boolean {
  if (provider.type !== remote.type || relationshipId(provider, remote.meritDetails!.relationship)) return false;
  const localTaxId = normalizedIdentity(provider.taxId);
  const remoteTaxId = normalizedIdentity(remote.taxId);
  if (localTaxId && remoteTaxId && localTaxId === remoteTaxId) return true;
  const localRegistration = normalizedIdentity(provider.meritDetails?.registrationNumber);
  const remoteRegistration = normalizedIdentity(remote.meritDetails?.registrationNumber);
  if (localRegistration && remoteRegistration && localRegistration === remoteRegistration) return true;
  const localName = normalizedIdentity(provider.legalName ?? provider.name);
  const remoteName = normalizedIdentity(remote.legalName ?? remote.name);
  return Boolean(localName && remoteName && localName === remoteName);
}

function mergeMeritProvider(local: Provider, remote: Provider): Provider {
  return {
    ...local,
    ...remote,
    id: local.id,
    tags: uniqueText([...local.tags, ...remote.tags]),
    aliases: uniqueText([local.name, ...local.aliases, ...remote.aliases]),
    source: "merit",
    createdAt: local.createdAt
  };
}

function clearMissingMeritRelationship(provider: Provider, relationship: MeritCompanyRelationship): Provider | undefined {
  return relationshipId(provider, relationship) || provider.meritDetails?.relationship === relationship
    ? undefined
    : provider;
}

export function reconcileMeritProviders(
  persistedProviders: Provider[],
  liveProviders: Provider[],
  relationship: MeritCompanyRelationship
): Provider[] {
  const expectedType = expectedProviderType(relationship);
  const remaining = [...persistedProviders];
  const matchedIds = new Set<string>();
  const mergedLive = liveProviders.map((remote) => {
    const meritId = relationshipId(remote, relationship);
    const exact = remaining.find(
      (provider) => !matchedIds.has(provider.id) && provider.type === expectedType && relationshipId(provider, relationship) === meritId
    );
    const matched = exact ?? remaining.find((provider) => !matchedIds.has(provider.id) && strongCompanyMatch(provider, remote));
    if (!matched) return remote;
    matchedIds.add(matched.id);
    return mergeMeritProvider(matched, remote);
  });
  const liveMeritIds = new Set(liveProviders.map((provider) => relationshipId(provider, relationship)).filter(Boolean));
  const preserved = remaining.flatMap((provider): Provider[] => {
    if (matchedIds.has(provider.id)) return [];
    const meritId = relationshipId(provider, relationship);
    if (!meritId || liveMeritIds.has(meritId)) return [provider];
    const cleared = clearMissingMeritRelationship(provider, relationship);
    return cleared ? [cleared] : [];
  });
  return [...mergedLive, ...preserved];
}

export function linkMeritInvoiceProviders(invoices: Invoice[], providers: Provider[]): Invoice[] {
  const providerIds = new Map(
    providers.flatMap((provider): Array<[string, string]> =>
      provider.meritCustomerId ? [[meritProviderId("customer", provider.meritCustomerId), provider.id]] : []
    )
  );
  return invoices.map((invoice) => {
    const providerId = invoice.providerId ? providerIds.get(invoice.providerId) : undefined;
    return providerId && providerId !== invoice.providerId ? { ...invoice, providerId } : invoice;
  });
}

export function reconcileMeritInvoices(
  liveInvoices: Invoice[],
  persistedInvoices: Invoice[],
  authoritative: boolean
): Invoice[] {
  const invoiceKey = (invoice: Invoice): string => invoice.externalId ? `external:${invoice.externalId}` : `id:${invoice.id}`;
  const map = new Map(liveInvoices.map((invoice) => [invoiceKey(invoice), invoice]));
  for (const invoice of persistedInvoices) {
    const key = invoiceKey(invoice);
    const live = map.get(key);
    if (live) {
      map.set(key, { ...live, ...invoice, meritStatus: live.meritStatus });
    } else if (!authoritative || invoice.source !== "merit" || !invoice.externalId) {
      map.set(key, invoice);
    }
  }
  return [...map.values()];
}

function dateOnly(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? value : undefined;
}

function addUtcDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function meritInvoicePeriods(
  persistedInvoices: Invoice[],
  today = new Date().toISOString().slice(0, 10)
): MeritInvoicePeriod[] {
  const safeToday = dateOnly(today);
  if (!safeToday) throw new Error("Merit invoice sync date must use YYYY-MM-DD");
  const defaultStart = addUtcDays(safeToday, -89);
  const earliestPersisted = persistedInvoices
    .filter((invoice) => invoice.source === "merit" && invoice.externalId)
    .map((invoice) => dateOnly(invoice.issueDate))
    .filter((value): value is string => Boolean(value && value <= safeToday))
    .sort()[0];
  let cursor = earliestPersisted && earliestPersisted < defaultStart ? earliestPersisted : defaultStart;
  const periods: MeritInvoicePeriod[] = [];
  while (cursor <= safeToday) {
    const candidateEnd = addUtcDays(cursor, 89);
    const periodEnd = candidateEnd < safeToday ? candidateEnd : safeToday;
    periods.push({ periodStart: cursor, periodEnd });
    cursor = addUtcDays(periodEnd, 1);
  }
  return periods;
}
