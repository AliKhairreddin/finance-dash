import type {
  AccountBalance,
  Invoice,
  Investment,
  LedgerItem,
  Payable,
  Provider,
  RevenuePartner,
  Team,
  Transaction
} from "../shared/types";

export const seededAsOf = "2026-06-15";

export const seededAccounts: AccountBalance[] = [
  { id: "acct-wise-lmd", name: "Wise LMD", source: "wise", balance: 234074.13, currency: "USD", updatedAt: seededAsOf, status: "seeded" },
  { id: "acct-wise-dn", name: "Wise DN", source: "wise", balance: 484823.17, currency: "USD", updatedAt: seededAsOf, status: "seeded" },
  { id: "acct-revolut", name: "Revolut", source: "manual", balance: 32623.39, currency: "USD", updatedAt: seededAsOf, status: "seeded" },
  { id: "acct-trust-crypto", name: "Trust Crypto", source: "manual", balance: 4858, currency: "USD", updatedAt: seededAsOf, status: "seeded" },
  { id: "acct-slash", name: "Slash", source: "slash", balance: 64779.27, currency: "USD", updatedAt: seededAsOf, status: "seeded" }
];

export const seededReceivables: LedgerItem[] = [
  { id: "recv-open-invoices", name: "Open invoices", balance: 899917.68, currency: "USD", source: "merit", notes: "Open customer invoices" },
  { id: "recv-vat-dn-q4", name: "VAT DN Q4", balance: 24878.81, currency: "USD", source: "manual" },
  { id: "recv-vat-april-2026", name: "VAT April 2026", balance: 1106.34, currency: "USD", source: "manual" },
  { id: "recv-vat-may-2026", name: "VAT May 2026", balance: 1106.34, currency: "USD", source: "manual" },
  { id: "recv-tax-2026-lmd", name: "Tax 2026 LMD", balance: 44488.99, currency: "USD", source: "manual" }
];

export const seededOpenBalances: LedgerItem[] = [
  { id: "open-blink", name: "Blink", balance: 57082.49, currency: "USD", source: "manual" },
  { id: "open-digital-rocket", name: "Digital Rocket", balance: 2324.67, currency: "USD", source: "manual" },
  { id: "open-valentine-rezono", name: "Valentine (rezono)", balance: 2933.88, currency: "USD", source: "manual" },
  { id: "open-position2", name: "Position2", balance: 6407, currency: "USD", source: "manual" },
  { id: "open-starstream", name: "Starstream Solutions (Buumerang)", balance: 89340.61, currency: "USD", source: "manual" },
  { id: "open-blue-elf-google", name: "BLUE ELF google", balance: 2864.09, currency: "USD", source: "manual" },
  { id: "open-digital-uprising-cognitive", name: "Digital Uprising - Cognitive", balance: 3890.59, currency: "USD", source: "manual" },
  { id: "open-advurtix-cognitive", name: "Advurtix - Cognitive", balance: 0, currency: "USD", source: "manual" },
  { id: "open-avoud-cognitive", name: "Avoud - Cognitive", balance: 9134.62, currency: "USD", source: "manual" },
  { id: "open-ronin-cognitive", name: "Ronin - Cognitive", balance: 7557.61, currency: "USD", source: "manual" },
  { id: "open-silverpush-cognitive", name: "SilverPush - Cognitive", balance: 45665.9, currency: "USD", source: "manual" },
  { id: "open-aurum-cognitive", name: "Aurum - Cognitive", balance: -4914.06, currency: "USD", source: "manual" },
  { id: "open-scaladz-cognitive", name: "Scaladz - Cognitive", balance: 47208.74, currency: "USD", source: "manual" },
  { id: "open-agrowth-cognitive", name: "AGrowth - Cognitive", balance: 9405.06, currency: "USD", source: "manual" },
  { id: "open-proads-cognitive", name: "ProAds (DSM) - Cognitive", balance: 24542.2, currency: "USD", source: "manual" },
  { id: "open-advurtix-wagner", name: "Advurtix - Wagner", balance: 8206.58, currency: "USD", source: "manual" },
  { id: "open-ronin-wagner", name: "Ronin - Wagner", balance: 3177.06, currency: "USD", source: "manual" },
  { id: "open-mk-wagner", name: "MK - Wagner", balance: 939.99, currency: "USD", source: "manual" },
  { id: "open-blackbird-wagner", name: "Blackbird - Wagner", balance: 16347.61, currency: "USD", source: "manual" },
  { id: "open-blueglow-wagner", name: "BLUEGLOW - Wagner", balance: 14041.57, currency: "USD", source: "manual" }
];

export const seededPayables: Payable[] = [
  { id: "pay-p2w", supplier: "P2W", balance: 50984.43, currency: "USD", category: "Provider", aliases: ["p2w", "point to web", "point2web"], monthBuckets: { June: 50984.43 } },
  { id: "pay-bigo", supplier: "Bigo", balance: 5011.75, currency: "USD", category: "Provider", aliases: ["bigo"], monthBuckets: {} },
  { id: "pay-google-today", supplier: "Google To Today (payment center)", balance: 0, currency: "USD", category: "Ad platform", aliases: ["google payment center", "google ads"], monthBuckets: {} },
  { id: "pay-google-mojo", supplier: "Google Mojo labs", balance: 0, currency: "USD", category: "Ad platform", aliases: ["google mojo", "mojo labs"], monthBuckets: {} },
  { id: "pay-amex", supplier: "Amex", balance: 13444.63, currency: "USD", category: "Card", aliases: ["amex", "american express"], monthBuckets: { June: 13444.63 } },
  { id: "pay-facebook-direct", supplier: "Facebook Direct", balance: 494268.19, currency: "USD", category: "Ad platform", aliases: ["facebook", "meta", "fb direct"], monthBuckets: { June: 202880.08, May: 291388.11 } },
  { id: "pay-tiktok-inch", supplier: "Tiktok credit line inch", balance: 1582.44, currency: "USD", category: "Ad platform", aliases: ["tiktok inch", "tik tok inch"], monthBuckets: { June: 1582.44 } },
  { id: "pay-tiktok-olm", supplier: "Tiktok credit line olm", balance: 0, currency: "USD", category: "Ad platform", aliases: ["tiktok olm", "tik tok olm"], monthBuckets: {} }
];

export const seededInvestments: Investment[] = [
  { id: "inv-revolut-crypto", name: "Revolut Crypto", balance: 603559, currency: "USD" }
];

export const seededProviders: Provider[] = [
  { id: "provider-p2w", name: "P2W", type: "supplier", category: "Provider", aliases: ["p2w", "point to web", "point2web"], source: "manual", createdAt: seededAsOf },
  { id: "provider-position2", name: "Position2", type: "supplier", category: "Provider", aliases: ["position2", "position 2"], source: "manual", createdAt: seededAsOf },
  { id: "provider-facebook", name: "Facebook Direct", type: "platform", category: "Ad platform", aliases: ["facebook", "meta", "fb direct", "facebook direct"], source: "manual", createdAt: seededAsOf },
  { id: "provider-google", name: "Google", type: "platform", category: "Ad platform", aliases: ["google", "google ads", "payment center", "google mojo"], source: "manual", createdAt: seededAsOf },
  { id: "provider-tiktok", name: "TikTok", type: "platform", category: "Ad platform", aliases: ["tiktok", "tik tok"], source: "manual", createdAt: seededAsOf },
  { id: "provider-bigo", name: "Bigo", type: "platform", category: "Ad platform", aliases: ["bigo"], source: "manual", createdAt: seededAsOf },
  { id: "provider-amex", name: "Amex", type: "supplier", category: "Card", aliases: ["amex", "american express"], source: "manual", createdAt: seededAsOf },
  { id: "provider-blink", name: "Blink", type: "customer", category: "Customer", aliases: ["blink"], source: "manual", createdAt: seededAsOf },
  { id: "provider-starstream", name: "Starstream Solutions", type: "customer", category: "Customer", aliases: ["starstream", "buumerang"], source: "manual", createdAt: seededAsOf },
  { id: "provider-digital-uprising", name: "Digital Uprising", type: "customer", category: "Customer", aliases: ["digital uprising"], source: "manual", createdAt: seededAsOf },
  { id: "provider-ronin", name: "Ronin", type: "customer", category: "Customer", aliases: ["ronin"], source: "manual", createdAt: seededAsOf },
  { id: "provider-silverpush", name: "SilverPush", type: "customer", category: "Customer", aliases: ["silverpush"], source: "manual", createdAt: seededAsOf },
  { id: "provider-advurtix", name: "Advurtix", type: "customer", category: "Customer", aliases: ["advurtix"], source: "manual", createdAt: seededAsOf },
  { id: "provider-scaladz", name: "Scaladz", type: "customer", category: "Customer", aliases: ["scaladz"], source: "manual", createdAt: seededAsOf },
  { id: "provider-blueglow", name: "BLUEGLOW", type: "customer", category: "Customer", aliases: ["blueglow"], source: "manual", createdAt: seededAsOf }
];

export const seededTeams: Team[] = [
  { id: "team-cognitive-pixel", name: "Cognitive Pixel", createdAt: seededAsOf },
  { id: "team-wgnr", name: "WGNR", createdAt: seededAsOf }
];

export const seededRevenuePartners: RevenuePartner[] = [
  {
    id: "revenue-partner-kissterra",
    name: "Kissterra",
    source: "tune",
    externalId: "kissterra",
    currency: "USD",
    timezone: "America/New_York",
    networkTimezone: "America/New_York",
    networkIdEnv: "KISSTERRA_TUNE_NETWORK_ID",
    apiKeyEnv: "KISSTERRA_TUNE_API_KEY",
    apiBaseUrlEnv: "KISSTERRA_TUNE_API_BASE_URL",
    meritCustomerName: "Kissterra",
    invoiceDueDays: 7,
    enabled: true,
    createdAt: seededAsOf
  }
];

export const seededTransactions: Transaction[] = [
  {
    id: "tx-wise-001",
    source: "wise",
    accountName: "Wise DN",
    date: "2026-06-14",
    description: "Incoming payment from Starstream Solutions LLC",
    rawName: "STARSTREAM SOLUTIONS LLC PAYIN",
    counterparty: "STARSTREAM SOLUTIONS LLC",
    amount: 89340.61,
    currency: "USD",
    direction: "in",
    status: "posted",
    category: "Customer payment"
  },
  {
    id: "tx-wise-002",
    source: "wise",
    accountName: "Wise LMD",
    date: "2026-06-13",
    description: "Wise card payment Meta Platforms",
    rawName: "META PLATFORMS IRELAND FACEBOOK ADS",
    counterparty: "META PLATFORMS IRELAND",
    amount: 202880.07,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Ad spend"
  },
  {
    id: "tx-wise-003",
    source: "wise",
    accountName: "Wise LMD",
    date: "2026-06-12",
    description: "Payment to Point To Web LTD",
    rawName: "POINT TO WEB LTD",
    counterparty: "POINT TO WEB LTD",
    amount: 50984.43,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Provider"
  },
  {
    id: "tx-wise-004",
    source: "wise",
    accountName: "Wise DN",
    date: "2026-06-11",
    description: "Incoming payment from Blue Glow Media",
    rawName: "BLUE GLOW MEDIA WAGNER",
    counterparty: "BLUE GLOW MEDIA",
    amount: 14041.58,
    currency: "USD",
    direction: "in",
    status: "posted",
    category: "Customer payment"
  },
  {
    id: "tx-slash-001",
    source: "slash",
    accountName: "Slash",
    date: "2026-06-10",
    description: "Slash card authorization Google Ads",
    rawName: "GOOGLE *ADS4441",
    counterparty: "GOOGLE ADS",
    amount: 12240.18,
    currency: "USD",
    direction: "out",
    status: "settled",
    category: "Card spend"
  },
  {
    id: "tx-slash-002",
    source: "slash",
    accountName: "Slash",
    date: "2026-06-09",
    description: "Slash card cashback redeemed",
    rawName: "SLASH CASHBACK REDEMPTION",
    counterparty: "Slash Cashback",
    amount: 9966.35,
    currency: "USD",
    direction: "in",
    status: "posted",
    category: "Cashback"
  },
  {
    id: "tx-wise-005",
    source: "wise",
    accountName: "Wise DN",
    date: "2026-06-08",
    description: "Incoming payment from unknown agency",
    rawName: "DRKT MEDIA PAYOUT 9842",
    counterparty: "DRKT MEDIA",
    amount: 2324.67,
    currency: "USD",
    direction: "in",
    status: "posted",
    category: "Needs invoice"
  },
  {
    id: "tx-wise-006",
    source: "wise",
    accountName: "Wise LMD",
    date: "2026-06-06",
    description: "TikTok credit line inch",
    rawName: "TIKTOK CREDIT LINE INCH",
    counterparty: "TikTok",
    amount: 1582.44,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Ad spend"
  }
];

export const seededInvoices: Invoice[] = [
  {
    id: "inv-qbo-open",
    providerId: "provider-blink",
    customerName: "Open invoices",
    amount: 899917.68,
    currency: "USD",
    status: "open",
    approvalStatus: "approved",
    paidLocally: false,
    meritPaid: false,
    dueDate: "2026-06-30",
    source: "merit",
    externalId: "seed-open-invoices",
    description: "Imported open invoice total from current finance sheet. Replace with Merit invoice sync when credentials are added.",
    createdAt: seededAsOf
  }
];
