# Statement invoice generation

Updated 11 November 2026. This supersedes the older invoice-generation descriptions in `statement-dashboard.md` and the October restoration notes.

## Customer invoices

Company settings hold the verified legal name, registered address, registration number, current VAT number when known, and optional payment details. Enabling the issuer requires a legal name and address. Those details take precedence over old remembered company-pair profiles.

Before creating customer invoices, the operator chooses:

- Charge VAT and an explicit percentage, reverse charge, or no VAT with a reason.
- Transaction date or generation date for the issue date.

There is no default tax treatment or date policy. A bulk run explicitly applies its choices to its selected customer invoices. Regeneration also requires new choices. A company without a saved current VAT number cannot select VAT or reverse charge. The recorded transaction amount remains the invoice total; VAT is included in it. The selected treatment is saved in the draft and rendered on the PDF. Changing choices on an already-created document requires regeneration, preserving the original.

## Supplier expense records

Outgoing PDFs omit added document headings, explanatory sentences and provenance labels. The dashboard’s sortable Type column identifies them as `Internal record`; customer invoices are `Sales invoice`. Company/supplier details, transaction values and approved notes remain in the PDFs.

Each canonical supplier receives a saved layout, accent, typography and header treatment derived from its identity. Approved address-book aliases resolve to the same supplier design across buying companies. New supplier designs do not copy supplier logos or examples. Each generated document snapshots its design; existing PDFs remain immutable, and regeneration creates a new version.

Generation uses saved transaction evidence and approved details without an AI call. Reading an uploaded invoice example remains a separate AI-assisted operation.

## Identity evidence and remaining gaps

The source company/counterparty address sheets are already saved in Statement's address book. Exact's saved company and contact records corroborate the legal names and addresses. Sources were checked on 10 November 2026.

| Workspace | Legal name | Identity sources | Remaining information |
| --- | --- | --- | --- |
| AMG Holding | AMG-Holding B.V. | Company sheet row 2; Exact division 3503006; [registration/address corroboration](https://www.compadex.com/nl/businesses/nl/amg-holding-b-v-85329576-51380846) | Current VAT number or confirmation of non-registration; preferred invoice payment account |
| Artec | AR-TEC Engineering & Innovations B.V. | Company sheet row 3; Exact division 3503005; [official address](https://ar-tec.nl/) | Preferred invoice payment account |
| Inch Engineering | Inch Engineering & Innovations | Company sheet row 7; Exact saved contacts; [official trading name](https://inchengineering.com/) | Preferred invoice payment account |
| Digital Nudge | Digital Nudge OÜ | Company sheet rows 4–5; Exact saved contacts | Preferred invoice payment account |
| Inch Digital | Inch Digital OÜ | Company sheet row 6; Exact saved contacts; [official Estonian register](https://ariregister.rik.ee/est/company/16718194/Inch-Digital-O%C3%9C) | Preferred invoice payment account; separate review for historical VAT periods |
| MZS Bouw | MZS bouw | Company sheet row 8; connected Rompslomp company | No missing company identity/payment fields identified |
| LoveMeDo | LoveMeDo B.V. | Counterparty sheet row 45; Exact division 4103084; [official company details](https://love-medo.com/index.html) | Preferred invoice payment account |

Inch Digital's official register reports VAT registration `EE102607314` ended on 10 October 2026. It is retained in the company notes as historical information and is not populated as a current VAT number. Older Exact contact addresses for Artec and LoveMeDo are not used where newer supplied records and official company details agree on Westhoven 7, unit 3.

Tax treatment and issue date are deliberately operator choices before generation, not missing company setup. Customer/supplier addresses remain required on each document; unknown or conflicting counterparties still need correction.

## Verification

Run `npm run check`, `npm run test:statements:e2e` with a fresh synthetic fixture server, and `npm run test:statements:pdfs`. The service-token-protected POST `/api/internal/statements/verify-invoice?layout=expense` renders a fixed synthetic supplier expense PDF on Cloudflare without AI calls or financial writes.

Production issuer changes use the existing revision-checked `statementWorkspace.savePolicy` mutation, preserving unrelated settings and audit history. Back up the previous policies and original document references before applying verified identity details; verify the seven saved policies and unchanged original document snapshots afterward. Routine releases use `npm run deploy` and production `famous-oyster-878`.
