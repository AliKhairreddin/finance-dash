# Design QA

- Source visual truth: `/var/folders/jg/nw_1gzfx3hs3p5jk7s4fnn7c0000gn/T/codex-clipboard-2d2eddf1-e294-4f73-b6b3-07d31161faf5.png`
- Implementation screenshot: `/tmp/finance-dash-receivables-currency-labels.png`
- Full implementation screenshot: `/tmp/finance-dash-overview-currency-labels.png`
- Normalized side-by-side comparison: `/tmp/finance-dash-receivables-comparison.png` (source left, implementation right)
- Viewport: implementation `1312 × 769` CSS pixels; narrow-screen check `390 × 844`
- Pixel dimensions: source `678 × 476`; implementation viewport capture `1297 × 760`; focused implementation crop `330 × 224`
- Density normalization: the source was downsampled proportionally to `319 × 224`; the implementation crop remained `330 × 224`; both were compared at the same 224-pixel height
- State: light theme, Overview selected, live production dashboard data, Receivables card visible

## Findings

- No actionable P0, P1, or P2 issues remain.
- Both currency groups are identifiable without hover: `Open INV EUR` and `Open INV USD`.
- The labels fit the narrow desktop name track exactly without ellipsis (`scrollWidth = clientWidth = 93px`) and fit the mobile track without ellipsis (`scrollWidth = clientWidth = 134px`).
- Each row's hover title now contains the same explicit currency label.

## Required Fidelity Surfaces

- Fonts and typography: the existing Geist Variable family, table size, weight, and truncation behavior are unchanged. The shorter labels preserve the card's hierarchy and remain fully readable.
- Spacing and layout rhythm: the existing three-column row grid, padding, source badge, balances, borders, and card dimensions are unchanged.
- Colors and visual tokens: no color, border, hover, shadow, or semantic token changed.
- Image quality and asset fidelity: this table contains no raster imagery or custom assets, and no new icon treatment was introduced.
- Copy and content: only generated open-invoice bucket labels changed, from repeated `Open invoices` text to explicit `Open INV EUR` and `Open INV USD`; manual receivable names remain unchanged.

## Interaction And Responsive Evidence

- The EUR and USD rows render from live dashboard data with their corresponding balances.
- Hover titles were verified as `Open INV EUR` and `Open INV USD`.
- At `390 × 844`, both labels remain fully visible with no overflow.
- Browser console errors and warnings checked at desktop and mobile widths: none.
- Automated checks: TypeScript lint, 73 passing tests (1 skipped), and production build passed.

## Comparison History

1. Source review:
   - [P2] Both rows displayed the same truncated `Open invoic…` label.
   - [P2] Hover only revealed `Open invoices`, so it still did not identify EUR versus USD.
2. First implementation:
   - Labels changed to `Open INV · EUR` and `Open INV · USD`.
   - [P2] The separator consumed enough width that the currency still rendered as `E…` and `U…` in the desktop card.
3. Final implementation:
   - Labels tightened to `Open INV EUR` and `Open INV USD`.
   - The desktop and narrow-screen measurements confirm both strings fit without truncation.
   - The normalized comparison shows the card's layout and visual system are otherwise unchanged.

## Focused Region Comparison

- `/tmp/finance-dash-receivables-comparison.png` compares the source and implementation at the same normalized height. A focused comparison was required because the change is confined to short labels in a dense table.

## Implementation Checklist

- [x] Distinguish EUR and USD without hover
- [x] Preserve compact `Open INV` wording
- [x] Preserve manual receivable names
- [x] Verify hover titles
- [x] Verify desktop and narrow-screen fit
- [x] Check console, lint, tests, and production build

## Follow-up Polish

- No P3 follow-up is required for this scoped label change.

final result: passed
