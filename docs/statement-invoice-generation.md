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

Each canonical supplier receives a saved layout, accent, typography and header treatment. New supplier allocation uses the least-used layout and an unused accent; the first nine suppliers receive nine distinct layouts. Existing suppliers reuse their saved design across payments and buying companies. Approved address-book aliases resolve to the same supplier design across buying companies. New supplier designs do not copy supplier logos or examples. Each generated document snapshots its design. Normal regeneration creates a new document version. An explicit administrator wording refresh changes only the rendered PDF and retains the original storage object in the audit history.

Supplier designs use saturated accents with coordinated pale panels, colored headers/tables/totals, and contrast-checked text. Saved colors and layouts remain stable. A design-only alias can point another saved supplier name to one primary design without changing addresses, printed names, source transactions or accounting identity. Both Nespresso names share the Netherlands design. Alias chains and cycles are rejected; the alias keeps its previous design in storage and the audit history.

Supplier PDFs have independent page structures, rather than variations on one header/table/total arrangement: a left identity rail (`technology`), a centered receipt (`subscription`), a total-first composition (`retail`), an asymmetric register (`professional_services`), a landscape account sheet (`minimal`), a payment slip with a central total band (`compact`), a postal letterhead (`corporate`), a two-column editorial layout (`editorial`), and a framed form (`insurance`). Existing labels and values are composed once in different positions. Customer invoice templates keep their own renderer. Production generation and saved-file refresh use the same page dimensions, including landscape supplier documents.

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

## Refresh saved PDF wording

For an explicitly requested wording-only update, run `npx tsx scripts/refresh-statement-invoice-pdfs.ts --prepare`. This reads production, backs up saved files/snapshots, renders affected internal records locally, and verifies document values without writing production. Inspect the prepared PDFs, then run `npx tsx scripts/refresh-statement-invoice-pdfs.ts --apply <manifest.json>`.

The internal `replaceRenderedPdf` mutation checks administrator scope, document type, revision, both file references and stored PDF metadata. It atomically updates the generated invoice and its existing document attachment, retaining numbers, financial snapshots, transaction links and original files. Audit entries record both storage IDs. Applying the same manifest is resumable and does not duplicate document numbers or allocations. Unsupported layouts, concurrent changes, unresolved references and non-PDF replacements stop the operation.

## Apply supplier designs to saved PDFs

Run `npx tsx scripts/refresh-statement-invoice-pdfs.ts --prepare-designs` to prepare all saved outgoing PDFs with distinct supplier layouts. The manifest retains each original PDF and financial snapshot, records the design catalogue versions, and checks that the redesigned files preserve the original text and all document values. It preserves original metadata labels on older PDFs. Review the rendered pages, then apply that manifest with `--apply <manifest.json>`.

Preparation preserves existing supplier layouts and colors. For an approved palette or shared-design change, pass a JSON plan after `--prepare-designs`, with `accents` mapping saved supplier design keys to hex colors and `aliases` containing `{aliasKey, targetKey}` pairs. Preparation is read-only; applying the reviewed manifest saves version-checked design links and PDFs. Shared names always resolve the current primary design for future generation, while past document snapshots remain unchanged unless explicitly refreshed.

The administrator mutation validates the supplier against each outgoing source transaction and saves the reusable supplier design together with the updated file and layout snapshot. It rejects concurrent changes, mismatched suppliers, copied-image layouts and unapproved logos. Older generated PDFs without document attachments keep that structure. Neither allocation links nor numbers, dates, amounts, tax or document states change. Prior layouts and storage IDs remain in the audit history.
