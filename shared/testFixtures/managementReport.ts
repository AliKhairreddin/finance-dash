import type { ManagementReportSheetKey } from "../managementReport";

function csv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map((value) => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",")).join("\r\n");
}

function businessCsv(revenue: number, marketingSpend: number, operatingSpend: number): string {
  const grossProfit = revenue - marketingSpend;
  const netProfit = grossProfit - operatingSpend;
  return csv([
    ["", "Business Unit"],
    ["", "Business Performance - May 2026"],
    ["", "Particulars", "Base", "Budget CY 2026", "31-May-26", "YTD May 2026", "Run Rate (42%)", "Sales Rate"],
    ["", "Advertising Revenue:"],
    ["", "Source A", "Ali", revenue, revenue * 0.4, revenue * 0.4, "0.10", "0.40"],
    ["", "Source B", "Ali", 0, revenue * 0.6, revenue * 0.6, "0.10", "0.60"],
    ["", "TOTAL ADVERTISING REVENUE", "", revenue, revenue, revenue, "0.42", "1"],
    ["", "Marketing Spend"],
    ["", "Channel A", "Ali", marketingSpend, marketingSpend, marketingSpend, "0.42", "1"],
    ["", "TOTAL MARKETING SPENDS + COMM", "", marketingSpend, marketingSpend, marketingSpend, "0.42", "1"],
    ["", "GROSS PROFIT", "", grossProfit, grossProfit, grossProfit, "0.42", "1"],
    ["", "GROSS PROFIT (%)", "", grossProfit / revenue, grossProfit / revenue, grossProfit / revenue, "0.42", "1"],
    ["", "Finance Spend:"],
    ["", "Software", "Bank", operatingSpend, operatingSpend, operatingSpend, "0.42", "1"],
    ["", "TOTAL SPEND", "", operatingSpend, operatingSpend, operatingSpend, "0.42", "1"],
    ["", "EBITDA/NET PROFIT", "", netProfit, netProfit, netProfit, "0.42", "1"],
    ["", "EBITDA/NET PROFIT (%)", "", netProfit / revenue, netProfit / revenue, netProfit / revenue, "0.42", "1"]
  ]);
}

export function syntheticManagementReportSheets(): Record<ManagementReportSheetKey, string> {
  return {
    shareholders: csv([
      ["", "Digital Nudge O.U"],
      ["", "Partner's Balance - YTD May 2026"],
      ["", "Equity", "Amount", "Amount", "Asset & Liability", "Amount", "Amount", "Particulars", "Total", "Ishan", "Amin"],
      ["", "Partner's Balance", "", 300],
      ["", "- Ishan", 100, "", "Net Working Capital", "", 300],
      ["", "- Amin", 200],
      ["", "Total Equity Balance", "", 300, "Total Assets & Liability", "", 300],
      ["", "", "", "", "", "", "", "Total Profit as of 31st May 26", 30, 10, 20]
    ]),
    "vb-consolidated": businessCsv(390, 268, 33),
    "vb-cp": businessCsv(100, 60, 10),
    "consolidated-bank": csv([
      ["", "Date", "Company Name", "Bank Name", "Service Month", "Month", "Reference", "User Name", "BS/PL", "Account Type", "Nature of Expense", "Segment", "Currency", "Amount incl. VAT", "Rate to USD", "Amount", "Comment", "Reco"],
      ["", "31-May-26", "Digital Nudge", "Wise", "31-May-26", "31-May-26", "SECRET_REFERENCE", "SECRET_USER", "PL", "Income", "Offer Revenue", "Cognitive Pixel", "USD", 100, 1, 100, "", ""],
      ["", "31-May-26", "Digital Nudge", "Wise", "31-May-26", "31-May-26", "Expense reference", "Finance", "PL", "Expense", "Software", "Cognitive Pixel", "USD", 40, 1, 40, "", ""],
      ["", "14-Jun-26", "Digital Nudge", "Amex", "30-Jun-26", "30-Jun-26", "POST_CLOSE_REFERENCE", "SECRET_CARD_USER", "PL", "Expense", "Software", "ACP", "EUR", 50, "", "", "", ""]
    ]),
    "vb-wag": businessCsv(200, 150, 20),
    "vb-hcp": businessCsv(10, 8, 1),
    "wag-aff": csv([
      ["", "", "Total Spend", 500, "", 500],
      ["", "", "", "", "", "", "", "Offer Redtrack 1 Cognitive", "Offer Source", "Redtrack Revenue", "Dashboard Source", "Dashboard Revenue"],
      ["", "", "", "", "", "", "", "Offer One", "Redtrack", 100, "Dashboard", 105],
      ["", "", "", "", "", "", "", "Total redtrack 1", "", 100, "", 105],
      ["", "", "", "", "", "", "", "Offer Revenue Total", "", 100, "", 105],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "ACA Offer"],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "Leadwell", 10, 11],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "ACA revenue", 10, 11],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "Final Calculation"]
    ]),
    "vb-acp": businessCsv(30, 20, 2),
    "vb-rest": csv([
      ["", "Atlantic Ocean + Affiliates"],
      ["", "Business Performance"],
      ["", "Particulars", "Base", "Budget CY 2026", "Altanic Ocean Performance", "31-Jan-26", "28-Feb-26", "Affiliates Performance", "Sales Rate"],
      ["", "Advertising Revenue:"],
      ["", "Kissterra", "Ali", 200, 20, "", "", "", "1"],
      ["", "Affiliates - Revenue", "Ali", 300, "", 10, 20, 30, "1"],
      ["", "Marketing Spend"],
      ["", "Facebook", "Ali", 100, 10, "", "", "", "1"],
      ["", "Affiliates - Expense", "Ali", 200, "", 6, 14, 20, "1"],
      ["", "NET MARGIN", "", 200, 10, 4, 6, 11, ""]
    ]),
    plp: csv([
      ["", "Digital Nudge O.U"],
      ["", "Platform Level Profitability - YTD May 2026"],
      ["", "Months", "Platform Name", "Revenue", "Spend", "Profit", "Profit Margin", "Leads", "CPL"],
      ["", "YTD May 2026", "Facebook", 70, 50, 20, "0.285714", 10, 5],
      ["", "", "Total", 100, 80, 20, "0.20", 20, 4]
    ])
  };
}
