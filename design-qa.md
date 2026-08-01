# Single-row bank reconciliation toolbar design QA

## Scope

This pass verifies the compact reconciliation toolbar requested for connected-bank views, with focused visual and interaction coverage of Slash. It also verifies the coordinated wide-monitor gutter change included in the same release.

## Evidence

- Source visual truth: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-c6feabc3-d50a-4409-8120-2883eab208d8.png`.
- Browser-rendered implementation: `/tmp/finance-toolbar-local-1163x676.jpg`.
- Same-input focused comparison, source above and implementation below: `/tmp/finance-toolbar-comparison.png`.
- Source image: 1905 × 979 px.
- Implementation capture: 1163 × 676 px from a 1314 × 676 CSS viewport at device pixel ratio 1.
- Focused comparison: 1162 × 328 px. The source was proportionally normalized and both toolbar regions were cropped to equal width for direct layout review.
- State: Slash, money out, all category rows, light theme. The source contains live rows; the local API had no authenticated bank rows, so data-content fidelity was not part of this toolbar-only comparison.

## Findings

No actionable P0, P1, or P2 issues remain.

### Fonts and typography

- Existing Geist typography and optical weights remain unchanged.
- Toolbar controls use the dashboard's compact 0.75–0.78 rem control scale, while the section title remains visually dominant.
- `Spent / sent`, the full selected period, and `Filters` remain readable without desktop truncation.

### Spacing and layout rhythm

- The source uses a 54 px control row followed by a separate 54 px period row. The implementation places direction, search, filters, period, information, and export in one 54 px reconciliation header.
- Direction is one 148 px dropdown instead of a two-button segmented control.
- Search is capped at 230 px and can shrink to 130 px before the 980 px stacked-header breakpoint.
- Desktop controls remain one row at 1024, 1180, 1314, 1905, and 2560 CSS px with no page-level horizontal overflow.
- At 760 px and below, search, the compact action row, and period form three explicit rows instead of auto-placing controls unpredictably.
- The coordinated `.app-shell` change retains a computed 18 px right padding at 1905 and 2560 px.

### Colors and visual tokens

- The implementation reuses the existing panel, control, border, muted-text, active-filter, hover, and focus tokens.
- No new palette, gradient, or elevation treatment was introduced.

### Image quality and asset fidelity

- The affected toolbar contains no raster assets or custom illustrations.
- Existing Lucide control icons remain unchanged; no placeholders, inline drawings, or replacement assets were added.

### Copy and content

- Direction keeps the existing `Added` and `Spent / sent` terminology for Slash and `Money in` / `Money out` for other connected banks.
- Category status retains `Needs category`, `Categorized`, and `All rows` inside Filters.
- Period presets retain Today, This week, Last week, This month, Last month, Recent 45 days, and This year inside the period popover.
- Automatic-update guidance remains in the existing information control and does not consume persistent toolbar space.

## Full-view comparison evidence

- The implementation keeps the same bank page hierarchy, panel treatment, summary strip, table header, and action placement as the source.
- The reconciliation table begins one full control row higher, which is the requested outcome.
- The implementation capture contains no clipped controls, page-level overflow, or overlap at the target desktop viewport.

## Focused comparison evidence

- `/tmp/finance-toolbar-comparison.png` places the two-row source toolbar above the one-row implementation.
- The lower implementation visibly retains every interactive capability while removing the standalone category-status and preset controls from persistent layout.
- The comparison also confirms that existing typography, borders, radii, icon style, and table alignment remain coherent with the source.

## Interaction and runtime checks

- Direction dropdown: opened and changed from `Spent / sent` to `Added`; the URL-backed direction and live status text updated.
- Filters: opened, category status changed from `All rows` to `Needs category`, and the active-filter count updated without closing the parent popover unexpectedly.
- Period: opened the calendar, opened its nested preset selector, applied `Last month`, and confirmed the trigger changed to `Jul 1–31, 2026`.
- Responsive layout: one desktop control row at 1024–2560 px; three intentional control rows at 600 and 760 px; zero page-level horizontal overflow.
- Browser console warnings/errors: none.
- `npm run check`: passed (280 tests passed, 1 intentionally skipped, production build passed).
- `git diff --check`: passed.

## Comparison history

1. [P1] The source consumed two full rows for reconciliation controls and period controls.
   - Moved the period control into the reconciliation toolbar, category status into Filters, presets into the period popover, and direction into one dropdown.
   - Post-fix evidence: the focused comparison shows a single desktop control row and the table begins materially higher.
2. [P2] The first narrow-width pass let CSS grid auto-placement spread five controls across five rows.
   - Assigned explicit grid rows and changed Filters to its icon treatment at the mobile breakpoint.
   - Post-fix evidence: 600 px and 760 px checks show three intentional rows with no horizontal overflow.
3. [P2] The first compact direction width truncated `Spent / sent`.
   - Increased the desktop direction control to 148 px and rebalanced the shrinkable search track.
   - Post-fix evidence: the final implementation capture shows the complete selected direction label.

## Follow-up polish

No P3 follow-up is required for this pass.

final result: passed

---

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

# Analytics periods and compact bank date controls design QA

## Scope and evidence

- Added global Analytics periods for monthly, quarterly, year to date, and full year views.
- Replaced the Banks two-input date form and persistent helper copy with one range-calendar trigger, one preset control, and an information control.
- Replaced the connected-bank history sentence and `Show 45 earlier days` action with a compact `More` action that loads 30 earlier days per request.
- Reference problem state:
  - `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-31118787-2514-49b4-a80e-48d0094c8f1e.png`
- Local implementation captures:
  - `/tmp/finance-bank-period-final.png`
  - `/tmp/finance-bank-calendar-mobile.png`
  - `/tmp/finance-dash-analytics-periods.png`
- Same-input reference/implementation comparison:
  - `/tmp/finance-bank-period-comparison.png`
- Desktop viewport: 1280 × 720 CSS px.
- Mobile viewport: 400 × 935 CSS px.

## Visual findings

No actionable P0, P1, or P2 issues remain.

- The period strip is 53 px tall on mobile and has no persistent explanatory copy.
- The compact date label keeps the selected period readable (`Jul 1–30, 2026`) without repeating the year.
- The preset control exposes Today, This week, Last week, This month, Last month, Recent 45 days, and This year.
- The calendar fits inside the mobile viewport at 340 × 377 px and keeps both Cancel and Apply visible.
- The Analytics period/status information control shares the status row instead of consuming a separate line.
- The 400 px Banks and Analytics pages have matching client and scroll widths (385 px), confirming no page-level horizontal overflow.
- Existing Geist typography, controls, Lucide icons, colors, borders, radii, and elevation tokens remain unchanged.

## Interaction checks

- A first calendar click creates a valid one-day period.
- A second click creates an ordered range, including cross-month ranges.
- Apply lives inside the calendar; Cancel and Escape close it without changing the current period.
- Future dates and future current-year months/quarters are unavailable.
- The This month preset changed the URL-backed period to Jul 1–30, 2026.
- `More` remains bounded at 30 earlier days and keeps the current end date.
- Analytics checks with realistic local rows:
  - 2026 YTD money out: $806.42.
  - July 2026 money out: $506.42.
  - Q2 2026 money out: $200.00.
  - Full year 2025 money out: $400.00.

## Comparison history

1. The reference used two date inputs, an outside Apply action, a dedicated recent-period button, and two persistent helper lines.
   - Consolidated them into one date-range trigger, one preset menu, and an information control.
2. The first mobile calendar pass inherited the app-wide full-width mobile button rule and pushed Cancel outside the popup.
   - Scoped the calendar actions to compact 78 px controls; both actions now fit.
3. The first mobile Analytics status placed its information icon on a separate row.
   - Grouped the period value, information control, and error state into one 28 px status row.

## Verification

- `npm run check`: passed (153 tests passed, 1 intentionally skipped, production build passed).
- `npm run lint`: passed as part of the combined check.
- `git diff --check`: passed.
- Production build emitted only the existing chunk-size warning.

final result: passed

---

# Transaction assignment controls design QA

## Scope and evidence

- Reference problem-state crop: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-b9ec45c2-235a-4860-a320-53c88daaf411.png`.
- Local implementation capture: `/tmp/finance-dash-table-implementation-final.png`.
- Same-input reference/implementation comparison: `/tmp/finance-dash-table-comparison-final.png`.
- Desktop viewport: 1265 × 711 CSS px with realistic local Wise income and expense rows.

## Findings

No actionable P0, P1, or P2 issues remain.

### Control readability and alignment

- Team, Category, and Company controls now share the same 36 px height and align to the top of each row.
- Search glyphs no longer consume closed-control width. Team and Company remain searchable by typing; Category retains its search field inside the opened menu.
- The Category trigger now uses a conventional, visible chevron instead of a search glyph.
- The stale 30 px Category save-action track was removed, giving the category label the full control width.
- Team no longer repeats `Optional` beneath every transaction.

### Column hierarchy and density

- The removed Card holder column remains absent.
- Narrow utility columns were tightened while Team, Category, and Company retain enough width for their common labels.
- The 1265 px pass shows Date through Actions together, with no page-level horizontal overflow.
- Measured row controls were 124.9 px for Team and 152.2 px for both Category and Company, with matching client and scroll widths.

### Required and optional context

- Category is marked with a visible required asterisk.
- Team and Company carry readable `Optional` labels in their headers only.
- Team, Category, and Company each expose a keyboard-focusable information control with concise responsibility, requirement, and analytics behavior.
- The Category help text explains that a manual change can apply to one transaction or every equivalent merchant transaction.

## Interaction checks

- Typed `Atlantic` into the icon-free Team control and confirmed the `Atlantic Ocean` result remained available.
- Typed `Cloud` into the icon-free Company control and confirmed `Cloudflare` remained available.
- Opened Category, searched `Food`, and confirmed `Food and meals` remained available with the search icon scoped to the open menu.
- Focused the Category information control and confirmed its explanatory tooltip appeared.
- Confirmed there are zero row-level Team helper labels and zero leading search icons in Team or Company row controls.

## Comparison history

1. The first implementation retained the old Category grid track even though the per-row save button had already been removed.
   - Removed the empty track and assigned the full cell width to Category.
2. The first visual comparison exposed `Optional` and the Category chevron using the near-white `--muted` background token as text color.
   - Switched both to the readable `--app-muted` foreground token.
3. The first header-help pass placed the information glyph inside the sort button.
   - Separated sorting from the keyboard-focusable information control so requesting help cannot change the sort.
4. The final density pass reduced the table minimum from 1112 px to 1008 px and reallocated width from compact utility columns to the three assignment controls.

## Verification

- `npm run check`: passed (144 tests passed, 1 intentionally skipped, production build passed).
- `npm run lint`: passed as part of the combined check.
- `git diff --check`: passed.

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

---

# Owner and income-offer taxonomy QA

## Scope

This pass verifies the responsibility rename from Team to Owner and the addition of ACP plus offer verticals as income-only categories.

## Findings

- Bank reconciliation shows `Owner · Optional`, `No owner`, and an Owner help control without adding row-height text.
- Analytics uses Owner consistently in filters, summaries, revenue breakdowns, and the ownership table.
- Settings exposes eight valid owners; ACP is no longer listed because it is an offer rather than a responsible person or group.
- The income category selector includes ACP, insurance verticals, Roofing, Window replacement, HVAC, Solar, Home improvement, Mortgage, Real estate, Debt relief, Personal injury, Legal services, Education, VSL, Auto warranty, and Pest control.
- Offer categories do not appear in the expense category list.
- Existing Convex databases idempotently receive any missing built-in categories when dashboard state loads.

## Verification

- Rendered browser QA passed on Banks, Analytics, and Settings.
- `npm run check`: passed (155 tests passed, 1 intentionally skipped, production build passed).
- `git diff --check`: passed.

final result: passed
