# Wise coverage and provider badge design QA

## Evidence

- Source/implementation overview comparison: `/tmp/finance-dash-design-qa/overview-source-left-local-right.jpg` (production left, implementation right).
- Source/implementation Banks comparison: `/tmp/finance-dash-design-qa/banks-source-left-local-right.jpg` (production left, implementation right).
- Focused light-theme Slash rows: `/tmp/finance-dash-design-qa/local-banks-slash-light.jpg`.
- Focused dark-theme Revolut rows: `/tmp/finance-dash-design-qa/local-banks-revolut-dark.jpg`.
- Focused dark-theme Wise rows: `/tmp/finance-dash-design-qa/local-banks-wise-dark.jpg`.
- Dark-theme Settings note: `/tmp/finance-dash-design-qa/local-settings-wise-note-dark.jpg`.
- Browser viewport: 1280 × 720 CSS px at device scale factor 2.
- Source and implementation captures: 1265 × 712 normalized screenshot pixels each.
- States: Overview, Banks, and Settings with live production data in light and dark themes.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Overview hierarchy: removing the false Wise warning closes the unnecessary vertical gap and brings the working-capital summary into the primary viewport without changing the existing financial hierarchy.
- Coverage semantics: Wise is shown as live when balance retrieval succeeds. The Overview and Banks pages no longer present manual transaction/statement imports as a balance-sync failure.
- Settings copy: the manual workflow remains explicit in the Wise integration card: “Balances sync automatically. Transactions and statements are imported manually from Wise CSVs.”
- Provider badges: the unified ledger now uses the same provider token system as the account-balance table. Wise is bright green, Revolut is blue, and Slash is warm gold in both themes.
- Wise refinement: the light Wise fill changed from a nearly neutral green tint to `rgba(159, 232, 112, 0.22)` with the existing dark-green text. The dark fill and border were also strengthened while retaining the bright green foreground.
- Layout rhythm: badge dimensions, table columns, row heights, typography, radii, and spacing are unchanged. The added color does not disturb the ledger’s dense scanning pattern.
- Accessibility: every source remains named in text, so provider identity does not rely on color alone. The computed foreground, background, and border values were checked for all three provider badges in both themes.
- Image quality and asset fidelity: this scope contains no raster assets or recreated logos. Provider identity is communicated through the existing text badges and brand-aligned color tokens.

## Comparison history

1. Initial P2: a successful Wise balance pull was downgraded to partial when statement endpoints were unavailable, producing a false warning on Overview and a “Wise partial” bank card.
   - Fix: separate fatal balance-sync failures from expected manual transaction/statement coverage.
   - Post-fix evidence: the implementation Overview has no coverage banner, Banks shows “Wise live,” and Settings retains the manual-import note.
2. Initial P2: unified-ledger source badges used a separate generic color rule, so Revolut and Slash appeared neutral even though the account-balance table used provider branding.
   - Fix: map ledger badges to the shared Wise, Revolut, and Slash tokens.
   - Post-fix evidence: the Banks comparison shows blue Revolut badges; focused captures verify the green Wise and gold Slash states.
3. Initial P3: Wise’s light fill was too close to neutral.
   - Fix: increase the Wise green fill and border strength in light and dark themes.
   - Post-fix evidence: the Overview comparison and dark Wise ledger capture show a visibly greener but still restrained result.

## Interaction and runtime checks

- Navigated through Overview, Banks, and Settings using the visible sidebar controls.
- Filtered the unified ledger by Wise, Revolut, and Slash and verified the correct badge treatment for each source.
- Switched from light to dark mode and verified the theme control updated to “Switch to light mode.”
- Verified computed foreground, background, and border styles for every provider badge in both themes.
- Verified the Wise Settings card reports `live` and contains the manual CSV workflow note.
- Verified the implementation Overview contains no “Partial data coverage” banner.

## Follow-up polish

- No P3 follow-up is required for this scope.

final result: passed
