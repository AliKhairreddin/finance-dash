# Design QA

- Source visual truth: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-78e8d633-e036-4a87-98aa-c340662c72f5.png`
- Implementation screenshot: `/Users/alikheireddine/Desktop/GitHub/finance-dash/output/playwright/invoice-filter-bar-aligned.png`
- Full implementation screenshot: `/Users/alikheireddine/Desktop/GitHub/finance-dash/output/playwright/invoice-filters-full-viewport.png`
- Mobile implementation screenshot: `/Users/alikheireddine/Desktop/GitHub/finance-dash/output/playwright/invoice-filters-mobile.png`
- Combined comparison: `/Users/alikheireddine/Desktop/GitHub/finance-dash/output/playwright/invoice-filter-comparison.png` (source above, implementation below)
- Viewport: desktop `1436 × 900` CSS pixels; mobile `390 × 844`
- Pixel dimensions: source `1435 × 84`; desktop viewport capture `1436 × 900`; focused implementation crop `1188 × 77`; combined comparison `1435 × 168`
- Density normalization: both captures are 1×. The focused implementation crop is shown at native size and padded with white to the source width in the combined comparison; it is not scaled.
- State: light theme, Invoices selected, local dashboard data loaded, default filters, empty invoice result set

## Findings

- No actionable P0, P1, or P2 issues remain.
- Search, Company, Currency, Status, Delivery, Cadence, and Created date now share the same 14-pixel title row and 36-pixel control row.
- At the desktop QA viewport, every titled filter begins at `y = 380.46`; every control begins at `y = 400.46`, ends at `y = 436.46`, and is 36 pixels tall.
- Short menus open as styled option lists without a visible search field. The five-option Status menu was opened, `Paid` was selected, and Clear restored `All statuses`.
- The search field has a visible `Search` title and an accessible name describing invoice details and amounts.

## Required Fidelity Surfaces

- Fonts and typography: the existing Geist Variable family, weights, sizes, and control text treatment are preserved. The new Search title uses the same filter-label typography as its peers.
- Spacing and layout rhythm: the filter row preserves its existing grid and eight-pixel column gap. Direct filter children now use an explicit `14px 36px` row structure with a six-pixel gap, removing the former legend and input-height drift.
- Colors and visual tokens: existing control backgrounds, borders, focus rings, muted icons, hover states, and shadows are unchanged.
- Image quality and asset fidelity: the source and implementation contain no raster assets or custom illustration requirements. Existing Lucide search, chevron, calendar, and filter icons are preserved.
- Copy and content: `Search` is now visible above the global search field. The placeholder now advertises invoices, companies, and amounts; search indexing also covers currency, status, delivery, cadence, source, origin, and visible dates.

## Interaction And Responsive Evidence

- The compact Status dropdown opened with five options and no visible search input.
- Selecting `Paid` updated the trigger label; Clear reset it to `All statuses`.
- Search matching now checks every whitespace-delimited term against a combined row index, including raw, fixed-decimal, grouped, localized-currency, and currency-prefixed amount formats.
- At `390 × 844`, the document has no horizontal overflow (`scrollWidth = clientWidth = 375` after browser chrome), Search and Created date span the filter width, and the remaining filters form two columns.
- Browser console errors and warnings checked after desktop and mobile interaction: none.
- Full verification passed: TypeScript lint, 87 passing tests (1 skipped), and the production build.

## Comparison History

1. Source review:
   - [P2] `Created date` sat visibly lower than Company, Currency, Status, Delivery, and Cadence.
   - [P2] The global search control lacked a visible title.
   - [P2] Every dropdown showed a search affordance even when it had only a few fixed options.
2. First implementation:
   - Added the Search title, replaced the fieldset legend with a normal group label, and introduced non-searchable short dropdowns.
   - [P2] Browser measurements still showed mixed title positions and control heights: Search started at `y = 384.46`, Company at `y = 380.46`, Created date at `y = 386.73`, and controls ranged from 32 to 36 pixels.
3. Final implementation:
   - Added explicit label and control grid rows and normalized search/date controls to 36 pixels.
   - Post-fix measurements show identical title, control, and bottom alignment across all seven titled filters.
   - The combined comparison confirms the requested title alignment while preserving the established compact filter styling.

## Focused Region Comparison

- The combined comparison stacks the supplied source crop above the rendered filter crop. A focused comparison was required because the requested change is confined to a dense, 77-pixel filter row and would be too small to judge reliably in the full dashboard screenshot.

## Implementation Checklist

- [x] Align Created date with every other filter title
- [x] Add a visible Search title
- [x] Keep short dropdowns non-searchable while preserving styling
- [x] Keep longer option lists searchable automatically
- [x] Search amounts in raw, decimal, grouped, currency, and localized display forms
- [x] Search other visible invoice details and support multi-term matching
- [x] Verify dropdown selection and reset behavior
- [x] Verify desktop measurements, mobile overflow, and browser console

## Follow-up Polish

- No P3 follow-up is required for this scoped filter-bar update.

final result: passed
