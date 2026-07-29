# Banking experience design QA

## Scope

This report consolidates the final visual and interaction checks for:

- Wise coverage messaging and provider badges
- The compact reconciliation toolbar
- Shared Revolut and Slash date-range loading

## Evidence

- Toolbar source visual: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-1385ed82-81ac-4e96-ba7c-f35c4221c4d4.png`
- Toolbar implementation screenshot: `/tmp/finance-toolbar-slash.png`
- Toolbar comparison: `/tmp/finance-toolbar-comparison.png`
- Overview comparison: `/tmp/finance-dash-design-qa/overview-source-left-local-right.jpg`
- Banks comparison: `/tmp/finance-dash-design-qa/banks-source-left-local-right.jpg`
- Focused bank views:
  - `/tmp/finance-dash-design-qa/local-banks-slash-light.jpg`
  - `/tmp/finance-dash-design-qa/local-banks-revolut-dark.jpg`
  - `/tmp/finance-dash-design-qa/local-banks-wise-dark.jpg`
- Settings check: `/tmp/finance-dash-design-qa/local-settings-wise-note-dark.jpg`
- Final toolbar viewport checks: 1309, 1180, and 760 CSS px
- Final Revolut date-range check: local dashboard in dark mode at 1309 × 765 CSS px

## Findings

No actionable P0, P1, or P2 issues remain.

### Wise coverage and source identity

- Wise is shown as live when balance retrieval succeeds. Manual transaction and statement imports are no longer presented as a balance-sync failure.
- Settings keeps the workflow explicit: “Balances sync automatically. Transactions and statements are imported manually from Wise CSVs.”
- Unified-ledger source badges reuse the account-table provider tokens: Wise green, Revolut blue, and Slash warm gold.
- Provider identity remains available in text and does not rely on color alone.

### Compact reconciliation toolbar

- The reconciliation header is 56 px tall in the final desktop view and stays on one row.
- The heading is shortened to “Match payments and spend,” the search placeholder is “Search,” and the icon-only Auto-categorize action retains a descriptive accessible name and title.
- Direction, search, status, Filters, and automation controls maintain 8–10 px gaps.
- The worst-case Wise toolbar, including Import CSV, fits at 1180 px without overlap.
- At mobile width, the 36 px automation action stays right-aligned beside Import CSV.

### Revolut and Slash date ranges

- Revolut and Slash now share the same Loaded period, From, To, Load dates, Recent 45 days, and Show 45 earlier days controls.
- The Revolut controls fit cleanly between the reconciliation toolbar and metric cards without changing table density.
- Date inputs have visible labels, enforce ordered dates, prevent future end dates, and retain keyboard-native date input behavior.
- Loading is scoped per bank so a Revolut range request does not disable the Slash loader, and vice versa.

## Interaction and runtime checks

- Filters opens the Ownership panel.
- Auto-categorize retains a descriptive accessible name while icon-only.
- Navigated through Overview, Banks, and Settings in light and dark themes.
- Filtered the unified ledger by Wise, Revolut, and Slash and verified the correct source treatment.
- Revolut and Slash date controls render with the expected default 45-day period and earlier-period action.
- Desktop and mobile reconciliation layouts remain usable.
- Browser console errors after final local renders: none.

## Comparison history

1. Wise balance success was previously downgraded because statement endpoints were unavailable.
   - Fixed by separating fatal balance-sync failures from the expected manual statement workflow.
2. Unified-ledger badges previously used neutral colors.
   - Fixed by mapping ledger sources to the shared provider tokens.
3. The reconciliation controls previously wrapped into an approximately 120 px header.
   - Fixed with a one-row desktop toolbar, shorter copy, and a compact automation action.
4. The 1180 px Wise variant briefly allowed Filters and Auto-categorize to overlap.
   - Fixed by tightening control dimensions and spacing.
5. Slash had date-range loading while Revolut exposed only the default activity window.
   - Fixed by extracting shared date controls and adding cache-aware Revolut range loading.

## Follow-up polish

No P3 follow-up is required for this pass.

final result: passed
