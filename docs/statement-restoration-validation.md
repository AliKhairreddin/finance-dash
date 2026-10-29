# Local validation record — 29 October 2026

All financial writes in these checks used synthetic, in-memory fixtures. No remote Convex environment or production deployment script was used.

| Command/check | Executed result |
| --- | --- |
| `npm run check` | PASS: TypeScript project checks, 1,082 unit/integration tests, all three Vite builds, self-hosted PDF/OCR asset build. 0 failed, 0 skipped. |
| `npx tsx --test worker/statementRestoration.test.ts` | PASS: 23 restoration-specific tests (included in the 1,082 total). |
| `npm run test:statements:e2e` | PASS: 10 headless Chromium scenarios, final run 24.4 seconds. |
| `npm run test:statements:pdfs` | PASS: seven generated synthetic PDFs; six one-page documents and one five-page/65-line document. |
| `git diff --check` | PASS: no whitespace errors. |
| Visual inspection | Inspected desktop/mobile transaction screenshots, the insurance PDF and the final page of the technology PDF; no overlapping totals, clipped rows or footer collisions observed. |

Before the successful runs, failed test selectors and the Node in-memory scheduler's inherited transaction context were corrected. Import tests now assert imported status and inserted counts, not merely visible rows. No failures were ignored or reclassified as passes.

## Backend scenarios

The restoration-specific tests cover:

1. Eight named workspaces, seven legal identities, historical Wise and reserved card 1003.
2. Mix/direct-query account isolation.
3. Concurrent generation across request IDs and users; shared LMD legal numbering.
4. Independent completion, Done, forgotten and visibility transitions.
5. Generated-document reconciliation, stale state and original-PDF retention.
6. Exact scoped merchant deduplication, sourced suggestions and approval.
7. Missing action grants failing closed.
8. Cancellation and rejection of stale/cancelled evidence; OCR IDs remaining uploaded documents.
9. Regeneration version chains and immutable original storage.
10. Explicit sales-invoice legal/tax/date policy and separate sequences.
11. Design locking, settings permission and versions.
12. LMD account-specific counterparty profiles.
13. Verified rule precedence and idempotent queued requests.
14. Migration dry runs and unchanged amounts/source/files/Wise scope.
15. View-only rejection of edit/export/import/download/settings actions.
16. Verified card-account resolution, conflicts and arbitrary digits.
17. Import account corrections, original retention and permission revocation.
18. Execution-time policy/merchant-rule/financial-revision revalidation.
19. Mock-provider rate limits, cached refresh timing and approved-data preservation.
20. Metadata versus binary download permissions, cancellation allocations and reminder ownership.
21. Explicit custom-logo authorization and immutable branding history.
22. Collision refusal before identity migration writes.
23. Explicit access/number configuration, dry-run preservation and no sequence rewind.

The existing suite also exercises CSV/PDF parsing, currency scales and exact monetary calculations, source identity/duplicates, mailbox OAuth and synchronization, receipt camera, Exact, PDF composition, selection, and the unrelated Finance modules.

## Browser scenarios

- Nine workspaces, account filtering and sort direction in the URL.
- Desktop 1440×1000, tablet 834×1112 and mobile 390×844 without page-level horizontal overflow. Wide tables scroll within their containers.
- One-click generation saves a real PDF; repeated requests return the same document.
- Missing company information uses one compact correction form with no mandatory review checkbox.
- Library filters and company/account/design settings load.
- 2,101 saved transactions beyond the former cutoff, correct EUR total, last page and complete snapshot export.
- Multirow manual entry, duplicate row and named-account defaults.
- Two CSV files with separate previews, confirmed processing and inserted counts.
- Regeneration changes the version while the original PDF bytes stay identical.
- Saved template preview, contact PDF reference upload/download, reminder creation, bulk completion results, Done and Undo Done.

## Synthetic PDF results

| Style | Pages | Lines | Total (EUR) |
| --- | ---: | ---: | ---: |
| Corporate | 1 | 4 | 100.00 |
| Minimal | 1 | 4 | 100.00 |
| Technology | 5 | 65 | 1,625.00 |
| Insurance | 1 | 4 | 100.00 |
| Professional services | 1 | 4 | 100.00 |
| Retail | 1 | 4 | 100.00 |
| Subscription | 1 | 4 | 100.00 |

Every example is explicitly synthetic and uses unassessed tax. The browser-generated `synthetic-supporting-document.pdf` additionally verifies the complete Worker → Convex → PDF → authenticated download path, with local Chromium substituted for Cloudflare Browser.

## Local artifacts

- `output/playwright/statements-before-desktop.png`, `statements-before-mobile.png`: baseline source `6ae8496`, locally rendered with synthetic Artec records.
- `output/playwright/statements-after-desktop.png`, `statements-after-mobile.png`: restored source with the same synthetic context.
- `output/playwright/statements-desktop.png`, `statements-tablet.png`, `statements-mobile.png`: Revolut LMD responsive views.
- `output/playwright/document-saved.png`, `document-history.png`: one-click success and preserved version history.
- `output/playwright/report/index.html`: final browser test report.
- `output/pdf/synthetic-*.pdf`, `output/pdf/validation.json`: seven styles plus a document saved through the tested application.
- `output/pdf/insurance-page-1.png`, `technology-page-5.png`: rendered PDF inspection images.
- `output/statement-validation/`: full project/E2E/PDF logs and SHA-256 artifact manifest.

Outputs are intentionally ignored by Git; they contain only task-created synthetic evidence. Recreate them with the committed test scripts. The baseline screenshot checkout was created from `git archive` in `/tmp`, without switching the working branch.

## Visual reference measurements

The legacy public stylesheet supplied these tokens: page `#eef1fb`, ink `#1e2433`, muted `#6b7280`, borders `#e4e7f2`, primary `#4f46e5`, primary dark `#4338ca`, tints `#eef0fd`/`#e0e3fb`, purple gradient to `#6d28d9`, green `#16a34a`, red `#dc2626`, 18px panels, 20px modals, 9px buttons, Inter 14px/1.5 and IBM Plex Mono. The implementation applies them within Statements. This was a narrow read-only design measurement, not another functional audit of the old application.

## Limits of this validation

These results do not certify a deployed system. Convex-test does not emulate hosted OCC, production indexes, real mailbox/provider credentials, or Cloudflare Browser availability. Its HTTP consistent-query bridge is used only with stable synthetic scan fixtures, not as proof of distributed snapshot concurrency. No production migration, real legal/tax approval, supplier-brand authorization or historical account reassignment was performed. Those prerequisites and the safe release/rollback procedure are listed in the delivery report.
