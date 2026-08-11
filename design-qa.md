# Analytics category breakdown design QA

## Scope and evidence

- Previous chart implementation: `/Users/alikheireddine/.codex/visualizations/2026/08/11/019fef13-6e82-7881-bf32-6908577919ce/analytics-option-3-implementation.png`.
- Updated chart implementation: `/Users/alikheireddine/.codex/visualizations/2026/08/11/019fef13-6e82-7881-bf32-6908577919ce/analytics-category-breakdown-chart.png`.
- Same-state comparison: `/Users/alikheireddine/.codex/visualizations/2026/08/11/019fef13-6e82-7881-bf32-6908577919ce/analytics-category-breakdown-comparison.png`.
- Final category detail: `/Users/alikheireddine/.codex/visualizations/2026/08/11/019fef13-6e82-7881-bf32-6908577919ce/analytics-category-breakdown-detail.jpg`.
- Route: `http://localhost:5174/?page=analytics`; viewport: 1265 × 712 CSS px at 1× density; light theme; 2026 YTD; Spend → Software selected.
- No exact screenshot of the removed legacy detail state exists. The detail interaction was recovered from the prior `AnalyticsCategoryCompaniesPanel` implementation and restyled within the current analytics design system. The exact visual comparison therefore covers the chart state, while the new detail state is evaluated as a focused implementation view.

## Findings

No actionable P0, P1, or P2 differences remain.

- Interaction hierarchy: the chart-card action now opens a dedicated category breakdown. The bank transaction drill-down is retained inside that category view, making category analysis and transaction inspection distinct steps.
- Layout and spacing: the detail uses one full-width card with a compact header, four summary metrics, and a dense company/merchant table. It preserves the surrounding analytics header and avoids duplicating the chart content.
- Typography and numeric hierarchy: the selected category is the detail title; USD estimate, native total, transaction count, company count, values, and shares use the existing dashboard's type scale and tabular alignment.
- Colors and tokens: semantic spend/revenue color is limited to the USD summary. Borders, muted labels, hover states, and surfaces reuse existing app tokens.
- Icons and assets: back, external-link, sort, and information controls use the existing Lucide icon system. There are no raster product assets in this data view.
- Copy: `View category breakdown` replaces the ambiguous direct transaction action on the chart card. `View all transactions` appears inside the breakdown. Conversion methodology is kept in an accessible information control.
- Accessibility: the back control and both drill-down actions have explicit accessible names. Every meaningful table column uses the shared sortable header control, visibly indicates direction, supports ascending and descending order, and persists sort state in the URL.

## Interactions tested

- Opened Spend → Software from the chart and confirmed `analyticsCategoryDetail=1` in the URL.
- Confirmed the detail rendered USD estimate, native total, transaction count, company/merchant count, and the complete four-row breakdown.
- Sorted Company or merchant ascending and descending; confirmed `analyticsCategorySort=name` and `analyticsCategoryOrder=asc` persisted in the URL.
- Used Back to category charts and confirmed the stacked chart view returned without losing the selected category.
- Used View all transactions from inside the detail and confirmed Banks opened with direction, category, and YTD date filters.
- Confirmed the conversion explanation is exposed through `About category breakdown amounts` and the browser console contained no warnings or errors.

## Comparison history

- Pass 1: the previous and updated chart states matched except for the intentionally renamed action.
- Pass 2: the first detail pass exposed persistent conversion helper copy; it was moved into the information control to preserve vertical space.
- Pass 3: the information trigger inherited an absolute metric-card position; a scoped override returned it beside the breakdown heading. The final focused capture has no visible P0/P1/P2 issue.

final result: passed

---

**Comparison Target**

- Source visual truth: `/Users/alikheireddine/.codex/generated_images/019fef13-6e82-7881-bf32-6908577919ce/exec-ec818abf-0426-495e-b6aa-2e4c7915bd2a.png`
- Browser-rendered implementation: `/Users/alikheireddine/.codex/visualizations/2026/08/11/019fef13-6e82-7881-bf32-6908577919ce/analytics-option-3-implementation.png`
- Combined comparison evidence: `/Users/alikheireddine/.codex/visualizations/2026/08/11/019fef13-6e82-7881-bf32-6908577919ce/analytics-option-3-comparison.png`
- Route: `http://localhost:5174/?page=analytics`
- State: light theme, 2026 YTD, first spend category pinned, top companies loaded. Dynamic local fixture values differ from the design mock, but direction, selection, and loading states match.

**Viewport and Normalization**

- Source pixels: 1487 x 1058.
- Implementation pixels and CSS viewport: 1265 x 712 at 1x density.
- The source was scaled to 1265 px wide and top-cropped to 1265 x 712 before horizontal composition with the implementation. Browser chrome was excluded from both sides.
- The full comparison preserves the implementation at native 1x density. A separate focused crop was not needed because the spend-card typography, controls, category rows, and detail pane remain legible in the original-resolution combined image.

**Findings**

- No actionable P0, P1, or P2 differences remain. The implementation preserves the selected direction's key structure: a full-width stacked card, consolidated USD donut, ranked category legend, pinned selection, native-amount detail, top-company preview, and transaction drill-down.
- Fonts and typography: the implementation uses the product's existing Geist family and compact UI scale. Weight, hierarchy, numeric alignment, truncation, and line wrapping remain coherent with the source while fitting the existing dashboard shell.
- Spacing and layout rhythm: chart, legend, and preview retain the source's three-column desktop proportion and vertical Spend/Revenue order. Existing dashboard header and sidebar density are intentionally preserved instead of replacing the app shell shown in the design exploration.
- Colors and tokens: the categorical purple/blue/teal/pink/orange palette and neutral Other slice follow the selected design. Semantic spend/revenue totals continue to use the app's existing danger/good tokens.
- Image quality and asset fidelity: the screen is a data UI with no source photography or raster product assets. Donut geometry renders as vector data visualization; Lucide icons remain sharp and consistent with the existing product icon system.
- Copy and content: `USD estimate`, native amount disclosure, transaction counts, top-company context, and `View all transactions` are present. Detailed conversion methodology is kept in the accessible information popover.
- Accessibility and behavior: category rows are semantic buttons with labels, pressed state, focus treatment, and keyboard selection. The donut mirrors the same selection visually. Reduced-motion-safe transitions are short and nonessential.

**Interactions Tested**

- Selected a revenue category and confirmed the URL persisted `analyticsCategoryView=in:Uncategorized`.
- Opened the spend USD-estimate information control and confirmed the conversion explanation appeared as a tooltip.
- Used `View all transactions` and confirmed navigation to Banks with direction, category, and YTD date filters in the URL.
- Confirmed selected state, details, native totals, top-company rows, empty preview state, and loading completion in the browser-rendered DOM.
- No fatal runtime or rendering error appeared during the tested interactions.

**Comparison History**

- Pass 1: the combined source and loaded implementation showed no actionable P0/P1/P2 mismatch. No visual fixes were required after this comparison.

**Implementation Checklist**

- [x] Consolidate every quoted currency into one USD-estimate chart per direction.
- [x] Preserve native currency totals and exchange-rate disclosure.
- [x] Stack Spend above Revenue at full width.
- [x] Add hover/focus preview, click-to-pin state, category details, top companies, and transaction drill-down.
- [x] Keep responsive tablet and mobile grid fallbacks.

**Follow-up Polish**

- P3: validate the category palette against future high-cardinality production data as category rankings change over time.

final result: passed
---

# Sidebar navigation design QA

## Scope and evidence

- Source visual truth: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-9ab22401-97d3-47a3-af5a-c7aca3837ce8.png`, plus the requested semantic-icon, selected-state, and navigation-order changes.
- Rendered evidence: `/tmp/finance-dash-sidebar-qa-20260811/sidebar-light.png`, `/tmp/finance-dash-sidebar-qa-20260811/sidebar-dark.png`, and `/tmp/finance-dash-sidebar-qa-20260811/sidebar-mobile-dark.png`.
- Same-input comparison: `/tmp/finance-dash-sidebar-qa-20260811/source-vs-implementation.png`.
- Desktop viewport: 1280 × 720 CSS px at device pixel ratio 2. Responsive viewport: 390 × 844 CSS px.
- Source: 402 × 1546 px, normalized to 201 × 773 CSS px. Focused implementation captures: 192 × 668 px light and 192 × 684 px dark, normalized by the browser to CSS-pixel output.
- State: Analytics selected in light and dark themes; responsive navigation open in dark mode.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the existing Geist family, weights, sizes, truncation, and hierarchy are preserved.
- Spacing and layout rhythm: existing item sizing, radii, group spacing, nested guides, and sidebar width are preserved. Only the requested Accounting/Operations order changed.
- Colors and tokens: the active item uses `--sidebar-accent` and `--sidebar-accent-foreground`. Light mode resolves to `oklch(0.97 0 0)` with a dark foreground; dark mode resolves to `rgb(24, 24, 27)` with `rgb(250, 250, 250)` foreground. Active border is transparent and box shadow is none.
- Image and icon fidelity: all symbols remain Lucide vectors. Home, Landmark, BadgeDollarSign, FileText, and Building2 replace ambiguous Overview, Banks, Revenue, Invoices, and Companies symbols; the already-clear icons remain.
- Copy and content: labels and badges are unchanged. Desktop and responsive order is Overview, Analytics, Banks, Accounting, Operations, Workspace.
- Accessibility and interaction: the selected item retains `aria-current="page"`; keyboard-only focus remains visible; clicking Analytics updates the URL to `page=analytics`; theme switching and the responsive menu were exercised successfully.
- Browser console warnings and errors after load: none.

## Full-view and focused comparison evidence

- The same-input comparison places the supplied sidebar and the updated light sidebar together at normalized density, making the selected row, icon silhouettes, group order, guides, labels, and density directly comparable.
- Separate light and dark focused captures confirm the selected surface becomes darker in light mode and lighter in dark mode without the old inset edge, border, or shadow.
- The responsive capture and DOM order confirm Accounting precedes Operations at the mobile breakpoint.

## Comparison history

1. [P1] The source selected item combined a bordered pill with an inset left edge. Removed the active border, inset shadow, and icon-specific accent color; post-fix light and dark captures show one flat tonal surface.
2. [P2] Operations preceded Accounting. Reordered both desktop and responsive rendering; post-fix DOM and screenshot show primary pages, Accounting, Operations, then Workspace.
3. [P2] Several icons were semantically ambiguous. Replaced five icons with direct Lucide equivalents; post-fix captures show the new set consistently in both themes and responsive navigation.

## Interaction and runtime checks

- Selected navigation, URL update, theme toggle, responsive menu, `aria-current`, keyboard focus, and browser console checked.
- `git diff --check`: passed.
- Repository-wide verification and deployments are owned by the Analytics task for the coordinated release.

## Follow-up polish

No P3 follow-up is required.

final result: passed

---

# Invoice payment workflow browser QA

## Scope and evidence

- Rendered route: `http://127.0.0.1:5173/` at a 1265 × 709 CSS-pixel viewport.
- State: Pending invoice tab selected by default, bulk Record paid action visible for selected open invoices, all-bank incoming payment row, and manual invoice-match dialog open.
- Evidence was captured in the in-app browser after the combined Analytics, sidebar, and payment changes were present in the shared checkout.

## Findings

No actionable P0, P1, or P2 visual or interaction issues remain.

- Pending is visibly selected when no `invoiceTab` URL parameter exists, and the result text describes the pending view.
- The all-bank table preserves its sortable data columns and adds a dedicated action for incoming rows: `Match to an existing invoice`.
- The manual-match dialog presents transaction, date, account, and amount context; a searchable invoice control; an explicit dashboard-only/Merit-unchanged warning; and a `Keep unmatched` action.
- The bulk action labels the selected invoice count and makes the resulting dashboard-versus-Merit status distinction explicit.
- Browser console warnings and errors after load: none.

## Runtime checks

- Combined lint, automated tests, and production build are owned and rerun by the Analytics task before the coordinated release.
- Payment-specific regression coverage includes provider routing, AI candidate constraints, manual locks, atomic bulk validation and idempotency, and manual allocation removal/reopen behavior.

final result: passed

---

# Unified Analytics calendar design QA

## Scope

This pass verifies that Analytics now uses the same single-calendar period control already established in the Banks ledger. The intended result is one compact calendar trigger in the Analytics header, with quick presets and custom date-range selection contained inside the shared calendar popover.

## Evidence

- Source visual truth, existing Banks calendar open: `/tmp/finance-analytics-calendar-qa-20260802/banks-calendar-reference.png`.
- Browser-rendered Analytics calendar open: `/tmp/finance-analytics-calendar-qa-20260802/analytics-calendar-implementation.png`.
- Browser-rendered Analytics calendar closed: `/tmp/finance-analytics-calendar-qa-20260802/analytics-calendar-closed.png`.
- Same-input focused comparison, Banks source on the left and Analytics implementation on the right: `/tmp/finance-analytics-calendar-qa-20260802/banks-analytics-calendar-comparison.png`.
- Source and implementation captures: 1265 × 712 encoded pixels from the same 1265 × 712 CSS viewport at device pixel ratio 1.
- Focused comparison: 780 × 550 px. Each calendar region was cropped from its full-view capture, proportionally contained in a 360 × 510 px region, and placed on the same neutral canvas. No density mismatch was used to judge typography, spacing, or control sizing.
- State: light theme, calendar open to August 2026, selected range ready, quick-period control closed.

## Findings

No actionable P0, P1, or P2 issues remain.

### Fonts and typography

- Both source and implementation use the dashboard's Geist variable font, weights, sizes, and line heights because they render the same shared calendar component.
- The Analytics trigger presents the complete compact label `Q3 2026`; the adjacent status pill now contains only `4 transactions`, avoiding duplicate period copy.
- Preset names remain on one line and do not reserve space for a checkmark or chevron.

### Spacing and layout rhythm

- The Analytics header now contains one calendar trigger instead of a period selector plus separate year, month, quarter, or date inputs.
- Trigger height, icon spacing, popover width, 14 px radius, calendar grid, navigation buttons, selection summary, and action-row spacing are identical to the Banks source.
- The shared popover remains constrained to the viewport and repositions above or below the trigger according to available height.

### Colors and visual tokens

- Both instances use the same panel, border, muted text, selected date, in-range date, focus, and shadow tokens.
- Selected dates use the existing high-contrast dark surface; inactive and future dates retain the same muted treatment as Banks.

### Image quality and asset fidelity

- Both triggers use the same existing Lucide `CalendarRange` interface icon at 16 px.
- No raster substitutions, generated assets, inline drawings, custom SVGs, gradients, emoji, or placeholder imagery were introduced.

### Copy and content

- The quick-period menu retains Today, Yesterday, This week, Last week, This month, Last month, Month, Quarter, YTD, and Year.
- Custom ranges are selected directly on the calendar and confirmed with Apply, so a separate `Custom` menu item and two persistent date fields are unnecessary.
- The closed trigger always reflects the active period while the adjacent pill reports only transaction count or loading state.

## Full-view comparison evidence

- The Banks source shows one bordered calendar trigger in the unified-ledger toolbar; the Analytics implementation shows the same one-trigger pattern in its header.
- The Analytics title, summary tiles, charts, tables, and information control remain unchanged around the scoped period-control edit.
- The closed Analytics capture shows `Q3 2026` and `4 transactions` as two compact, non-duplicative pieces of information with no clipped text.

## Focused comparison evidence

- The combined comparison places the open Banks and Analytics calendars together at the same density and interaction state.
- Calendar header, weekday row, selected date, range summary, Cancel, and Apply align visually because both routes now render the same component.
- The only visible content difference is intentional data: Banks shows Jun 18–Aug 1, while Analytics shows Jul 1–Aug 1 for Q3-to-date.

## Interaction and runtime checks

- Analytics trigger opens and closes the shared dialog and exposes the current period in its accessible name.
- Quick-period control exposes the placeholder plus ten complete preset options.
- Choosing Last month closes the popover and updates the trigger to `Last month`.
- Selecting July 20 and July 25, then Apply, switches Analytics to `custom` and writes the exact inclusive `analyticsFrom=2026-07-20&analyticsTo=2026-07-25` URL state.
- Escape, outside pointer, resize, and scroll behavior are inherited from the shared picker used by Banks.
- Browser console errors: none.
- Automated verification: TypeScript lint passed, 287 tests passed, 1 intentionally skipped, and the production build passed with only the existing chunk-size advisory.
- `git diff --check`: passed.

## Comparison history

1. Initial same-input comparison found no actionable P0, P1, or P2 mismatch. The two routes use the same shared picker component, and the visible differences are data-specific rather than design drift.

## Follow-up polish

No P3 follow-up is required for this pass.

final result: passed
---

# Dropdown and Analytics period controls design QA

## Scope

This pass verifies the shared dropdown treatment and the Analytics period selector requested from the supplied broken-menu and clipped-trigger screenshots. The screenshots are problem-state sources rather than visual targets: the corrected implementation must remove the checkmark gutter, prevent option wrapping, use a contrasting selected background, unify the period/year/month controls, add compact relative and custom ranges, and keep every trigger value complete without spending width on a redundant chevron.

## Evidence

- Source visual truth: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-78b68a5e-59d7-4b9a-a3be-2c5e0ca7b792.png`.
- Clipped year source: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-03685c4d-04ed-47b7-8dc8-604021ba160f.png`.
- Clipped quarter source: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-9d10bd64-9fe5-4b3f-8c21-0f2a7bd30917.png`.
- Clipped relative-period source: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-bf9d2853-ec69-49dd-b82d-7c198cc4f70c.png`.
- Browser-rendered light desktop implementation: `/tmp/finance-dash-dropdown-qa-20260802/analytics-period-menu-final.png`.
- Browser-rendered dark desktop implementation: `/tmp/finance-dash-dropdown-qa-20260802/analytics-period-menu-dark.png`.
- Browser-rendered mobile implementation: `/tmp/finance-dash-dropdown-qa-20260802/analytics-period-menu-mobile.png`.
- Browser-rendered arrow-free Analytics controls: `/tmp/finance-dash-dropdown-qa-20260802/analytics-controls-no-arrows.png`.
- Same-input focused comparison, problem state on the left and corrected implementation on the right: `/tmp/finance-dash-dropdown-qa-20260802/dropdown-before-after-comparison.png`.
- Same-input focused comparison for the three clipped triggers and the final arrow-free control row: `/tmp/finance-dash-dropdown-qa-20260802/dropdown-clipping-no-arrow-comparison.png`.
- Source: 186 × 210 px at its supplied density.
- Clipped-trigger sources: 204 × 96 px, 170 × 110 px, and 320 × 140 px at their supplied densities.
- Desktop captures: 1280 × 720 and 1265 × 712 encoded pixels from a 1280 × 720 CSS viewport at device pixel ratio 1.
- Mobile capture: 390 × 844 encoded pixels from a 390 × 844 CSS viewport at device pixel ratio 1.
- Focused comparison: 486 × 502 px. The 186 × 210 source was proportionally enlarged to 279 × 315 px; the implementation side is a 147 × 462 px crop of the rendered trigger and popup. No density mismatch was used to judge type or spacing.
- Clipping comparison: 700 × 339 px. Each supplied problem source was proportionally contained in a 200 × 140 px region; the final implementation is a proportionally resized 370 × 78 px browser crop. No density mismatch was used to judge clipping or padding.
- State: Analytics, Month selected with the period menu open for menu QA; Quarter selected with the period, year, and quarter triggers closed for clipping QA; light, dark, and 390 px responsive variants checked.

## Findings

No actionable P0, P1, or P2 issues remain.

### Fonts and typography

- The implementation retains the dashboard's Geist variable font and existing control weights.
- Every period option is a single line. The compact copy is `Month`, `Quarter`, `YTD`, and `Year`; the relative options are `Today`, `Yesterday`, `This week`, `Last week`, `This month`, and `Last month`.
- Trigger values are complete at the tested widths: `This month`, `September`, `2026`, and `Q3` are fully visible with no horizontal overflow.

### Spacing and layout rhythm

- Period, year, month, quarter, and shared searchable selects use the same arrow-free trigger, radius, border, padding, popup, and row treatment.
- The period trigger is 108 px wide, the year trigger is 72 px, the month trigger is 108 px, and the quarter trigger is 56 px; each is sized for its actual content instead of sharing a wasteful generic width.
- Every tested trigger retained 11 px inline padding. Measured text space matched its scroll width exactly (`84/84`, `48/48`, `84/84`, and `32/32` CSS px), confirming no hidden overflow.
- The popup opens below its trigger and has enough height to show all eleven Analytics period options without wrapping or offscreen clipping.
- At 390 px, the filter controls stack cleanly and the open menu remains within the viewport.

### Colors and visual tokens

- Selected options use the new shared `--selected-option-bg` token: a darker neutral surface in light mode and a lighter neutral surface in dark mode.
- Selected text remains the normal high-contrast foreground; selection is no longer communicated by a blue label or checkmark alone.
- Hover, focus, border, panel, and shadow treatments continue to use the dashboard's existing tokens.

### Image quality and asset fidelity

- The Analytics row retains the existing Lucide calendar icon as the period affordance; redundant chevrons were removed from the dropdown trigger system.
- No raster substitutions, generated assets, inline drawings, custom SVGs, gradients, emoji, or placeholder imagery were introduced.

### Copy and content

- The single period selector contains 11 concise options: Today, Yesterday, This week, Last week, This month, Last month, Month, Quarter, YTD, Year, and Custom.
- Choosing Month reveals only year and month; Quarter reveals only year and quarter; Year reveals only year; relative presets need no extra controls; Custom reveals an inclusive start/end range.
- Custom range status uses the exact selected ISO dates, keeping the result unambiguous and compact.

## Full-view comparison evidence

- The light desktop capture shows the selected Month row with a neutral filled background, no checkmark gutter, all eleven options visible, and the compact year and month triggers aligned as one control family.
- The arrow-free desktop capture shows `Quarter`, `2026`, and `Q3` in full with balanced padding and a clearly clickable bordered-control treatment.
- The dark capture confirms the selected row becomes lighter than the popup surface while retaining readable foreground contrast.
- The mobile capture confirms the same one-line labels and selected treatment at the 390 px breakpoint; no persistent control is hidden by viewport overflow.

## Focused comparison evidence

- The combined comparison places the supplied broken menu and corrected rendered menu in one image.
- The source visibly wraps `Quarterly` and `Year to date`, clips words across rows, and spends a full column on the checkmark.
- The corrected crop shows concise one-line labels, no indicator column, a selected-row surface, a fully visible trigger value, and the full relative/custom period set.
- The clipping comparison places all three reported clipped values above the corrected arrow-free row, making the recovered text width and complete labels directly visible in one image.
- A focused comparison is sufficient because the source visual truth concerns only the dropdown trigger and popup.

## Interaction and runtime checks

- Period trigger: opens and closes through the accessible combobox control.
- Period menu: exposes exactly 11 options, each with the expected accessible option label.
- Month selection: reveals the compact 2026 year trigger and August month trigger.
- Year trigger: uses the same popup and selected-background behavior as the period trigger and keeps all four digits visible.
- Arrow-free triggers: the shared non-searchable select opens from the control surface, and the shared searchable combobox opens from its input surface; removing the icon did not remove or shrink the interactive target.
- Custom selection: reveals accessible start and end date inputs; a URL-backed July 20–25 range renders and requests the exact inclusive range.
- Theme: switching between light and dark preserves menu placement, option visibility, and contrast.
- Responsive behavior: verified at 1280 × 720 and 390 × 844.
- Browser console errors: none.
- Automated verification: TypeScript lint passed, 285 tests passed, 1 intentionally skipped, and the production build passed with only the existing chunk-size advisory.
- `git diff --check`: passed.

## Comparison history

1. [P2] The first desktop render clipped the final digit of `2026` in the 78 px year trigger.
   - Increased the compact year width to 88 px.
   - Post-fix evidence: the light, dark, and year-menu captures all show `2026` in full.
2. [P2] The first popup aligned its selected row over the trigger, pushing the earlier relative options above the viewport.
   - Disabled selected-item/trigger overlap so shared select popups consistently open below their trigger.
   - Post-fix evidence: Today is the first visible row and the popup begins directly below the Month trigger.
3. [P2] The first below-trigger popup retained a 300 px list cap, requiring hidden-scroll access to Year and Custom.
   - Increased the responsive list ceiling to 420 px while keeping the available-height guard.
   - Post-fix evidence: all eleven option labels are visible in the final desktop and mobile captures.
4. [P2] The initial compact-width adjustment still clipped `2026`, `Q3`, and `Last month` because every trigger reserved space for a redundant down chevron.
   - Removed chevrons from the shared simple-select and searchable-select trigger system, removed the one-off category trigger chevron, and recalibrated compact Analytics widths around text plus padding.
   - Post-fix evidence: `/tmp/finance-dash-dropdown-qa-20260802/dropdown-clipping-no-arrow-comparison.png` shows all reported values next to the final complete `Quarter`, `2026`, and `Q3` row; direct browser measurements report equal client and scroll widths with zero trigger icons.

## Follow-up polish

No P3 follow-up is required for this pass.

final result: passed

---

# Sidebar account actions design QA

## Scope

This pass verifies the new expandable account group at the bottom of the Finance dashboard sidebar. The group adapts the supplied Slash accordion pattern to the dashboard's existing component, icon, typography, color, and spacing system.

## Evidence

- Interaction-pattern source: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-5dd0e2b4-25e0-499e-b1c8-10813ef23452.png`.
- Clipping problem-state source: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-6ecd1a94-781a-4b21-bc05-7372dc9b6155.png`.
- Browser-rendered desktop implementation: `design-audit/sidebar-account-menu-desktop.jpg`.
- Browser-rendered mobile implementation: `design-audit/sidebar-account-menu-mobile.jpg`.
- Focused implementation crop: `design-audit/sidebar-account-menu-focused.jpg`.
- Same-input focused comparison, reference on the left and implementation on the right: `design-audit/sidebar-account-menu-comparison.jpg`.
- Pattern source: 201 × 120 px; problem-state source: 362 × 362 px.
- Desktop capture: 1265 × 712 encoded pixels from a 1280 × 720 CSS viewport at device pixel ratio 1.
- Desktop focused crop: 166 × 154 px from the visible 166 × 155 CSS account group.
- Mobile capture: 375 × 812 encoded pixels from a 390 × 844 CSS viewport at device pixel ratio 1.
- Focused comparison: 560 × 280 px. The problem state and corrected implementation preserved their aspect ratios, were scaled inside 260 × 260 px regions, and were centered on 280 × 280 px dark canvases before horizontal composition.
- State: dark theme, account group expanded, overview selected.

## Findings

No actionable P0, P1, or P2 issues remain.

### Fonts and typography

- The implementation retains the dashboard's existing Geist variable font, compact sidebar type scale, optical weights, and truncation behavior.
- `Account` is visually stronger than the three nested actions, matching the reference hierarchy.
- All action labels remain complete at the 192 px desktop sidebar width and the 390 px mobile viewport.

### Spacing and layout rhythm

- The trigger is a single full-width row with an icon, title, and rotating chevron.
- Appearance, refresh-and-sync, and logout are three separate rows with consistent 37 px desktop and 42 px mobile targets.
- The mobile action rows share the same x position and are vertically stacked at y = 72, 116, and 160; no requested actions share a row.
- The desktop sidebar uses a fixed footer and an independently scrollable navigation region, so the expanded bottom group remains visible within a 720 px-tall viewport.

### Colors and visual tokens

- The group reuses existing sidebar background, hover, border, focus, muted-text, and dark-theme tokens.
- Logout uses the established destructive color only on hover, keeping the resting menu calm while preserving clear feedback.
- No new palette, gradient, or elevation language was introduced.

### Image quality and asset fidelity

- The target contains standard interface icons only; the implementation uses the project's existing Lucide icon set.
- No raster substitutions, placeholders, inline drawings, custom SVGs, or generated image assets were introduced.

### Copy and content

- The group title is `Account`.
- Appearance is expressed compactly as the next action (`Dark mode` or `Light mode`) instead of showing two competing controls.
- Refresh and data synchronization are consolidated into the compact visible label `Sync data` because the existing endpoint already performs both operations; its accessible label and tooltip retain the fuller meaning.
- `Log out` links to the existing `/logout` route.
- The redundant `Data as of` and `Last sync` sidebar timestamps were removed from both desktop and mobile.

## Full-view comparison evidence

- `design-audit/sidebar-account-menu-desktop.jpg` confirms the group is anchored at the bottom of the full sidebar, remains visually subordinate to primary navigation, and does not overlap dashboard content.
- `design-audit/sidebar-account-menu-mobile.jpg` confirms the same actions are available in a compact account dropdown at the responsive breakpoint.
- The desktop sidebar fits entirely inside the 720 px viewport with its expanded group visible; the menu bottom is 689 px and the sidebar bottom is 702 px.

## Focused comparison evidence

- `design-audit/sidebar-account-menu-comparison.jpg` places the reported clipping problem on the left and the corrected implementation on the right.
- The comparison shows the same bordered Account heading and vertically indented list, with the corrected `Light mode`, `Sync data`, and `Log out` labels fully contained.
- The original Slash reference separately confirms the intended accordion structure: one clickable heading, an open chevron, and vertically stacked nested actions.
- Focused comparisons are sufficient because both visual sources concern only the sidebar group and contain no broader page layout.

## Interaction and runtime checks

- Account trigger: toggles the list and updates `aria-expanded`.
- Keyboard: Escape closes the expanded list and returns `aria-expanded` to `false`.
- Appearance: switching to dark mode updates the document theme and changes the visible action to `Light mode` without closing the group.
- Refresh and sync: the local API completed successfully, re-enabled the action, and displayed `Refresh and sync complete. New bank transactions were imported and categorized automatically.`
- Logout: the rendered link resolves to `/logout`; the existing worker route clears the authenticated session cookie and redirects to `/login`.
- Responsive behavior: desktop and mobile triggers are mutually exclusive at the 760 px breakpoint, while all three requested actions remain available.
- Browser console warnings/errors: none.
- Automated verification: TypeScript lint passed, 283 tests passed, 1 intentionally skipped, and the production build passed with only the existing chunk-size advisory.
- `git diff --check`: passed.

## Comparison history

1. [P2] The first desktop capture let the expanded group extend below a 720 px viewport, hiding two actions.
   - Constrained the sidebar to the viewport, fixed the footer to the bottom grid row, and made only the navigation region independently scrollable.
   - Post-fix evidence: all three action rows are visible, the menu bottom is 689 px, and the sidebar bottom is 702 px in the final desktop capture.
2. [P2] The previous responsive sidebar placed appearance and refresh beside each other and repeated both freshness timestamps below them.
   - Replaced the paired controls and timestamp row with the same expandable account list used on desktop.
   - Post-fix evidence: the mobile action rectangles have identical widths and x positions with strictly increasing y positions.
3. [P2] The first action labels (`Switch to light mode` and `Refresh & sync data`) overflowed at the user's narrow sidebar width.
   - Shortened the visible labels to `Light mode`, `Sync data`, and `Log out` while preserving full accessible names and tooltips.
   - Post-fix evidence: desktop action items report equal 151 px client and scroll widths, and mobile action items report equal 222 px client and scroll widths; every overflow check is false.

## Follow-up polish

No P3 follow-up is required for this pass.

final result: passed

---

# Historical design QA

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

---

# Banks compact workspace design QA

## Evidence

- Source visual truth: conversation attachment `Dia Appshot 2026-08-07T01-11-56.149Z.png` showing the production Slash bank view before this change.
- Source pixels: 1228 × 768. The appshot includes Dia chrome; the comparable product-content region begins below the browser toolbar.
- Primary implementation: `artifacts/design-qa/banks-slash-compact-desktop.png`.
- Open drawer implementation: `artifacts/design-qa/banks-slash-details-drawer.png`.
- Unified implementation: `artifacts/design-qa/banks-all-compact-desktop.png`.
- Responsive implementation: `artifacts/design-qa/banks-all-compact-mobile.png`.
- Implementation pixels / CSS viewport: 1228 × 768 desktop and 390 × 844 mobile at device scale factor 1. No density normalization was needed.
- State: light theme; Banks route; Slash view for source comparison; All view for unified-table comparison; drawer tested closed and open.
- Browser-rendered evidence: captured from the local Vite application in the Codex in-app browser.
- Primary interactions tested: source dropdown (Slash → Wise → All), URL-backed source state, Wise entity selector visibility, right-edge drawer open/close, responsive mobile drawer, and sortable account-detail column headers.
- Console errors checked: no warnings or errors.

## Full-view comparison

The source and implementation were reviewed together at the same 1228 × 768 desktop size. The source dedicates two persistent card rows to Slash accounts and cashback before reconciliation. The implementation intentionally replaces those cards with three provider-specific headline metrics and a closed-by-default right-edge drawer, moving the table toolbar and table several hundred pixels closer to the top. The source's multi-button bank switcher is replaced with one compact, URL-backed dropdown.

The resulting composition keeps the established sidebar, Geist typography, borders, radii, semantic colors, table density, and control language. The redesign changes information hierarchy exactly where requested rather than restyling the surrounding product.

## Focused-region comparison

- Header: verified that Slash shows available card credit, cash balance, and selected-period cashback; Wise shows live balance and selected-period movement; All shows period money in, spend, and transaction count without cashback.
- Table toolbar: verified that the redundant reconciliation and unified-ledger titles are gone and search is the leftmost control.
- Drawer: verified the account table, selected-period movement, provider status, and Slash cashback breakdown at desktop and mobile sizes.
- Images/assets: this screen has no raster imagery or brand artwork. Existing Lucide UI icons and product tokens remain appropriate and sharp.

## Comparison history

### Iteration 1

- [P2] The Details nudge was positioned relative to the animated route container instead of the viewport, placing it beside the toolbar. Evidence: `artifacts/design-qa/banks-slash-iteration-1.png`.
  - Fix: portaled the trigger to `document.body`, preserving dialog context while anchoring it to the viewport edge.
  - Post-fix evidence: `artifacts/design-qa/banks-slash-compact-desktop.png`.
- [P2] At 1228 px, the four activity-view labels compressed the date controls and clipped the final view option. Evidence: `artifacts/design-qa/banks-all-iteration-1.png`.
  - Fix: kept the active Transactions label, compacted the three alternate views to titled icon buttons below 1280 px, and retained accessible names.
  - Post-fix evidence: `artifacts/design-qa/banks-all-compact-desktop.png`.

### Final pass

- Fonts and typography: passed. Geist, weights, sizing, tabular numerals, truncation, and hierarchy match the existing product language.
- Spacing and layout rhythm: passed. The table begins immediately after the compact header and toolbar; desktop and mobile layouts have no hidden persistent controls.
- Colors and visual tokens: passed. Existing panel, line, muted, green, red, amber, and violet tokens are used consistently with sufficient contrast.
- Image quality and asset fidelity: passed. No image assets are required on this screen; icons come from the existing icon library.
- Copy and content: passed. Redundant reconciliation titles are removed, labels remain concise, and provider-specific metrics replace generic cashback treatment.
- Accessibility: passed. Drawer focus/escape behavior comes from Base UI Dialog, controls retain accessible names, and drawer account columns use the shared sortable-header control with URL-persisted sort state.

## Findings

No actionable P0, P1, or P2 findings remain.

## Open questions

None.

## Implementation checklist

- [x] Replace bank tabs with one source dropdown.
- [x] Promote provider-specific headline metrics.
- [x] Move account and supplemental information into a right-edge drawer.
- [x] Remove reconciliation/unified titles before search.
- [x] Verify desktop, drawer, provider switch, URL state, accessibility, and mobile behavior.

## Follow-up polish

No blocking or requested follow-up polish remains.

final result: passed
