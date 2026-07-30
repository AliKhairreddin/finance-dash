# Compact dashboard summary-strip design QA

## Scope

This pass verifies the shared compact summary strip used across the dashboard, with focused coverage of the All, Wise, Revolut, and Slash bank tabs.

## Evidence

- Source visual truth: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-8db73b32-fb3f-4835-931a-8292fdd77250.png`
- Production Slash implementation: `/tmp/finance-summary-production-slash-full.png`
- Focused production strip: `/tmp/finance-summary-production-slash-crop.png`
- Same-input before/after comparison: `/tmp/finance-summary-production-comparison.png`
- Supporting production views:
  - `/tmp/finance-summary-production-full.png`
  - `/tmp/finance-summary-production-wise-full.png`
  - `/tmp/finance-summary-production-revolut-full.png`
- Local responsive implementation: `http://127.0.0.1:5173/`
- Local implementation capture: `/tmp/finance-summary-local-full.png`

## Viewport and normalization

- Desktop viewport: 1312 × 769 CSS px.
- Source image: 2440 × 238 px at Retina density; normalized to 1082 × 105 px for the focused comparison.
- Production implementation: 1312 × 769 px at device pixel ratio 1.
- Production focused strip: 1082 × 48 px.
- Combined comparison: 2164 × 126 px, with equal-width source and implementation regions.
- Responsive check: 390 × 844 CSS px. The summary remained one horizontal scroll row with four 320 × 52 px segments inside a 368 × 54 px viewport.

## State

- Focused parity state: Slash reconciliation, incoming transactions, Jun 15–Jul 29, 2026.
- The source and production comparison both show $2,857,452.85 visible volume, 92 transactions, 0 matched rows, 92 rows without a team, and the native-currency detail.
- Additional live checks covered All, Wise, and Revolut.

## Findings

No actionable P0, P1, or P2 issues remain.

### Fonts and typography

- Geist remains unchanged and matches the surrounding dashboard.
- Uppercase labels retain the existing weight, tracking, and hierarchy.
- Values use tabular numerals, stay visually dominant, and remain legible in the reduced height.
- Long native-currency details truncate on a single line rather than increasing the strip height.

### Spacing and layout rhythm

- The focused live strip is 48 px tall, versus approximately 105 px after source-density normalization.
- Four metrics remain in one segmented row on desktop.
- Labels and values share the primary row; the native-currency breakdown occupies a compact second line only where present.
- Borders, 12 px outer radius, and internal dividers align with the dashboard panels.
- Mobile uses one horizontally scrollable row instead of a two-row or four-row stack.

### Colors and visual tokens

- The strip uses the existing panel, border, muted-text, primary-text, and hover tokens.
- No new colors, gradients, or elevation treatments were introduced.
- Light-theme contrast remains consistent with adjacent table headers and controls.

### Image quality and asset fidelity

- The target contains no image assets or non-standard icons.
- No placeholders, recreated icons, SVG drawings, or raster substitutions were introduced.
- Screenshots were captured at native density and normalized only for the focused comparison.

### Copy and content

- All source information remains visible: metric label, value, and native-currency detail where available.
- All, Wise, Revolut, and Slash retain their existing labels and live data.
- No copy was removed to achieve the height reduction.

## Full-view comparison evidence

- All renders as one compact segmented summary bar directly below the bank tabs.
- Wise keeps its empty-state metrics in one 54 px row.
- Revolut and Slash keep their date controls, compact summary strip, and table in the expected order without overlap.
- The table begins materially higher in the viewport, which is the intended outcome.

## Focused comparison evidence

The same-input comparison shows the original four large cards on the left and the production segmented strip on the right. The implementation preserves all five visible information elements in the first metric (label, USD value, native label, native value, and grouping) while reducing the component to less than half the normalized source height.

## Interaction and runtime checks

- Switched live production through All, Wise, Revolut, and Slash.
- Verified the selected bank state and data changed correctly on each tab.
- Verified the responsive strip stays one row at 390 px and exposes horizontal scrolling without a visible scrollbar.
- Local browser console warnings/errors: none.
- `npm run check`: passed (125 tests passed, 1 intentionally skipped).

## Comparison history

1. The source used four independent cards with large vertical padding and a normalized height of approximately 105 px.
   - Replaced the cards with a shared segmented strip using inline label/value alignment and a conditional detail row.
2. The first responsive pass exposed a horizontal scrollbar that added 11 px of height.
   - Hid the scrollbar while retaining touch/trackpad scrolling and partial-next-segment affordance.
3. The final live production pass confirmed identical Slash values and labels in a 48 px strip.
   - No further visual fixes were required.

## Follow-up polish

No P3 follow-up is required for this pass.

final result: passed

---

# Automatic transaction categorization design QA

## Scope and evidence

- Verified the local Banks overview after replacing manual AI controls with automatic ingestion-time categorization.
- Desktop capture: 1265 × 759 CSS px in the in-app browser.
- Inspected the accessibility tree for the unified ledger, date controls, source filters, export action, and sidebar refresh action.

## Findings

- The sparkle action is absent from both the bank reconciliation toolbar and Analytics.
- `Refresh` fits the sidebar action without clipping; its title explains that bank activity also refreshes automatically.
- The selected-period strip explicitly states that Revolut and Slash refresh every 15 minutes and are categorized automatically.
- The 45-day default is presented as a selected period with exact dates, a custom range, and a clear recent-period shortcut.
- The unified ledger now separates `Category / company`, matching the data model: category is required while company is optional.
- Merchant-first labels retain the raw bank counterparty and description as secondary detail.
- No page-level overflow, broken spacing, cropped controls, or inaccessible bank actions were observed.

## Runtime checks

- `npm run check`: passed (140 tests passed, 1 intentionally skipped, production build passed).
- `git diff --check`: passed.
- Local browser console warnings/errors: none.

final result: passed

---

# Mobile Banks and invoice actions design QA

## Scope

This follow-up verifies the mobile Banks overview, the Wise/Revolut/Slash reconciliation controls, and the invoice action row requested from the supplied 400 px problem-state screenshots.

## Evidence and state

- Reference problem states:
  - `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-fcc27a81-e76e-4e57-bbf2-5d94d4cb6b53.png`
  - `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-70001692-6220-4203-b142-1ae9ae959e69.png`
  - `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-b54f05f2-605b-44bd-8051-fd846487f5c1.png`
- Local implementation captures:
  - `/tmp/finance-dash-mobile-qa.DqoenF/banks-mobile.png`
  - `/tmp/finance-dash-mobile-qa.DqoenF/wise-mobile.png`
  - `/tmp/finance-dash-mobile-qa.DqoenF/invoices-mobile.png`
- Focused same-input comparison crops:
  - `/tmp/finance-dash-mobile-qa.DqoenF/banks-region.png`
  - `/tmp/finance-dash-mobile-qa.DqoenF/wise-actions-region.png`
  - `/tmp/finance-dash-mobile-qa.DqoenF/invoice-actions-region.png`
- Primary mobile viewport: 400 × 935 CSS px. The browser content viewport measured 385–400 px depending on scrollbar state.
- Desktop regression viewport: 1280 px wide.

## Findings

No actionable P0, P1, or P2 issues remain.

### Fonts and typography

- Geist and the dashboard's existing type hierarchy remain unchanged.
- The mobile `Create manual invoice` label is 12.16 px with tighter tracking and 8 px inline padding. Its client and scroll widths match, so the label and icon do not clip or touch the button edges.
- Bank labels, balances, and reconciliation controls retain their existing weights and tabular numerals.

### Spacing and layout rhythm

- The six-option mobile bank tab cluster is replaced by one full-width native select. The desktop tab row remains unchanged.
- The four bank summary tiles form one vertical stack on mobile. The container measured 361 px for both client and scroll width, and every tile measured 361 px, confirming that no horizontal swipe is required.
- Wise reconciliation actions form a balanced two-column grid: Export and Import each measured 171 px inside a 350 px action row.
- Revolut and Slash use the same shared action treatment; their single Export action expands to the available width.
- At the invoice action row, both actions fit within the mobile panel and the primary action keeps comfortable internal padding.

### Colors and visual tokens

- Existing panel, border, primary-button, muted-text, disabled, and focus tokens are preserved.
- No new colors, gradients, or elevation treatments were introduced.

### Image quality and asset fidelity

- The affected surfaces contain no raster assets.
- Existing Lucide icons remain unchanged; no placeholders or replacement drawings were introduced.

### Copy and content

- Existing page, bank, filter, import/export, and invoice-action copy remains intact.
- The mobile bank selector uses the explicit overview label `All bank activity`, followed by the existing bank source names and `Cash & wallets`.

## Interaction and runtime checks

- Opened the mobile bank selector and selected Wise; the page changed to `?page=banks&bankView=wise`.
- Verified Banks overview, Wise, Revolut, Slash, and Invoices at mobile width with no page-level horizontal overflow.
- Verified desktop at 1280 px: the selector is hidden, the tab row is visible, and the four bank summaries remain in equal desktop columns.
- `npm run check`: passed (140 tests passed, 1 intentionally skipped, production build passed).
- `npm run lint`: passed.
- `git diff --check`: passed.

## Comparison history

1. The first mobile pass still inherited the later generic horizontally swipeable summary rule.
   - Moved the scoped `.bank-source-summary` mobile override after that generic rule so the four bank totals reliably stack.
2. The problem-state reconciliation toolbar could push Export partly off-screen and scatter adjacent actions.
   - Applied a shared responsive grid to the action group and made each child fill its grid cell.
3. The invoice primary action fit only by pressing its label against the edges.
   - Added a scoped mobile type, gap, icon-size, and padding adjustment.

## Follow-up polish

No P3 follow-up is required for this pass.

final result: passed
