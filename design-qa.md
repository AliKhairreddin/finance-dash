# Design QA

- Source visual truth: user-provided Dia appshot plus `/tmp/finance-dash-invoice-popup-before.png` (pre-change production popup)
- Implementation screenshot: `/tmp/finance-dash-invoice-popup-real-data.png`
- Search interaction screenshot: `/tmp/finance-dash-invoice-company-search.png`
- Mobile implementation screenshot: `/tmp/finance-dash-invoice-popup-mobile-fixed.png`
- Normalized side-by-side comparison: `/tmp/finance-dash-invoice-popup-comparison.png` (source left, implementation right)
- Viewport: source `1265 × 712`; implementation `1280 × 720`; mobile `390 × 844`
- Density normalization: browser screenshots were captured at CSS-pixel density; the implementation was scaled to `1265 × 712` for the final comparison
- State: light theme, Invoices selected, Kissterra draft open, company selected, Merit tax unselected, form body at its top position

## Findings

- No actionable P0, P1, or P2 issues remain.
- The searchable company and Merit tax controls keep their menus inside a product-styled popup layer instead of using the browser-native menu shown in the source. Filtering, selection, empty results, and selected-state indicators are visible and keyboard-addressable.
- The invoice popup now has stable header, scrollable body, and footer regions. The customer fields, four-column Merit summary, financial fields, date pairs, description, and actions share consistent outer edges and spacing.

## Required Fidelity Surfaces

- Fonts and typography: the existing Geist Variable family, label weights, field text sizes, uppercase eyebrow, and heading hierarchy are preserved. Long customer, tax, and email values remain readable without breaking their grid tracks.
- Spacing and layout rhythm: the popup uses one consistent two-column form grid. Net amount and currency are grouped within the left half while Merit tax occupies the aligned right half. The customer summary uses a compact four-column definition grid and a separate explanatory row. Header and footer remain visible while the body scrolls.
- Colors and visual tokens: existing panel, border, focus, hover, green customer-summary, and modal shadow tokens are reused in light and dark themes. No new palette or decorative treatment was introduced.
- Image quality and asset fidelity: the popup contains no raster imagery. Existing Lucide Search, Check, ChevronDown, X, and form-action icons are used consistently; no placeholder or code-drawn assets were added.
- Copy and content: invoice data and Merit guidance are unchanged. Search placeholders and empty-result messages are the only new copy.

## Interaction And Responsive Evidence

- Company dropdown opens with the full client list, filters `kiss` to Kissterra, and filters `Sil` to SilverPush in the local sample dataset.
- Selecting SilverPush closes the list and updates the invoice customer field.
- Merit tax dropdown opens with live Merit rates, filters `outside Estonia` to one option, and selection closes the list with the chosen tax displayed.
- The selected option is marked with both accessible selected state and a visible check icon.
- At `390 × 844`, the form collapses to one column while amount and currency remain a compact pair; Cancel and Save draft remain fully visible in the fixed footer.
- The modal suppresses background-page scrolling, leaving one clear scrollbar for its body.
- Browser console errors checked after company and tax interactions: none.
- Automated checks: TypeScript lint, 63 passing tests (1 skipped), and production build passed.

## Comparison History

1. Source review: `/tmp/finance-dash-invoice-popup-before.png`
   - [P1] Company and Merit tax used native selects with no text filtering; the long company menu escaped the popup and obscured most of the form.
   - [P2] The three-column financial row did not share the two-column alignment used by surrounding fields.
   - [P2] The whole popup scrolled, so actions disappeared and the page and popup exposed competing scrollbars.
2. First implementation: `/tmp/finance-dash-invoice-popup-local.png`
   - Searchable comboboxes, a two-column form rhythm, and fixed header/body/footer regions were added.
   - [P2] At the mobile breakpoint, global full-width button rules squeezed Cancel out of the footer.
3. Mobile fix: `/tmp/finance-dash-invoice-popup-mobile-fixed.png`
   - The footer now uses explicit two-column tracks, and background scrolling is suppressed while a modal is open.
4. Final real-data pass: `/tmp/finance-dash-invoice-popup-comparison.png`
   - Customer identity, long billing emails, ID, financial fields, date fields, and search affordances fit their intended tracks with no actionable alignment or overflow issues.

## Focused Region Comparison

- `/tmp/finance-dash-invoice-company-search.png` verifies the search input, clear and disclosure controls, filtered option row, selected indicator, popup width, and layering at readable scale.
- `/tmp/finance-dash-invoice-popup-mobile-fixed.png` verifies the narrow-screen field and footer alignment.

## Implementation Checklist

- [x] Searchable Company dropdown
- [x] Searchable Merit tax dropdown
- [x] Filtered, empty, selected, hover, and focus states
- [x] Consistent popup grid and field alignment
- [x] Fixed header and action footer with a scrollable form body
- [x] Real-data, mobile, console, lint, test, and build verification

## Follow-up Polish

- No P3 follow-up is required for this scoped popup change.

final result: passed
