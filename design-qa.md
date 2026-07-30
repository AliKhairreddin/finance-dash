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
