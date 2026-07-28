# Popup and dialog overflow design QA

## Evidence

- Source visual truth:
  - `/tmp/finance-dash-qa/source-production-modal.png`
  - `/tmp/finance-dash-qa/source-production-company-menu-open.png`
- Browser-rendered implementation:
  - `/tmp/finance-dash-qa/implementation-desktop-modal.png`
  - `/tmp/finance-dash-qa/implementation-company-menu-adaptive.png`
  - `/tmp/finance-dash-qa/implementation-company-menu-mobile-bounded.png`
  - `/tmp/finance-dash-qa/implementation-holding-modal.png`
- Combined comparison inputs:
  - `/tmp/finance-dash-qa/comparison-manual-modal.png`
  - `/tmp/finance-dash-qa/comparison-company-menu.png`
- Desktop viewport: 1908 × 955 CSS px at device scale factor 1.
- Mobile viewport: 375 × 667 CSS px at device scale factor 1.
- Source pixels: manual dialog 1908 × 955; company menu 1893 × 947.
- Implementation pixels: desktop captures 1908 × 955; mobile capture 375 × 667.
- Density normalization: none. The company-menu source was padded to 1908 × 955 only for the side-by-side comparison; content was not scaled.
- State: light theme, manual-receivable dialog open; invoice company selector open; holding editor open.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Fonts and typography: the existing Geist typography, weights, hierarchy, and control copy are preserved. Long option labels now wrap within the menu instead of widening its scroll area.
- Spacing and layout rhythm: the manual-receivable and holding dialogs are centered against the viewport. The searchable company menu grows to 320 px when space permits and remains bounded by the available viewport.
- Colors and visual tokens: existing panel, backdrop, border, focus, and semantic color tokens are unchanged.
- Image quality and asset fidelity: no raster or decorative assets are involved in these popup surfaces; the existing icon library remains unchanged.
- Copy and content: labels, placeholders, button names, option names, and financial content are unchanged.
- Full-view evidence: the source manual dialog was clipped to its Receivables panel; the implementation uses the full viewport backdrop and is fully visible. The source company menu showed both horizontal and vertical scrollbar tracks; the implementation has no visible tracks and no horizontal overflow.
- Focused-region evidence: manual dialog geometry changed from a 427.5 × 246.4 panel-bound backdrop to a 1908 × 955 viewport backdrop. The company list changed from `scrollWidth 157 / clientWidth 124` to `scrollWidth 318 / clientWidth 318`, with `overflow-x: hidden` and `scrollbar-width: none`.

## Comparison history

1. Initial P1: the manual-receivable dialog inherited transformed panel geometry, was clipped by the panel, and exposed nested horizontal/vertical scrolling.
   - Fix: render the dialog through `document.body`; remove its internal overflow; stack fields and actions at narrow widths.
   - Post-fix evidence: 460 × 304 dialog centered in the 1908 × 955 viewport with equal scroll/client dimensions and visible overflow, plus a 335 × 435 mobile dialog fully inside 375 × 667.
2. Initial P2: the company selector had horizontal overflow and visible horizontal/vertical scrollbar tracks; long names forced `scrollWidth 157` inside a 124 px client width.
   - Fix: use an adaptive 320 px searchable popup, wrap long labels, suppress horizontal overflow, hide scrollbar chrome while preserving wheel and keyboard navigation, and subtract popup chrome from available-height sizing.
   - Post-fix evidence: desktop list `scrollWidth 318 / clientWidth 318`; mobile popup bottom 661.95 within a 667 px viewport.
3. Audit follow-up: transaction detail and category popovers plus holding and distribution dialogs could inherit transformed route containers.
   - Fix: portal those floating surfaces to `document.body`; apply the same bounded overflow rules to popup lists, modal bodies, send-review lists, and mobile navigation.
   - Post-fix evidence: holding editor backdrop is 1908 × 955, its grandparent is `BODY`, and its scroll/client dimensions match.

## Interaction and runtime checks

- Opened and closed the manual-receivable dialog.
- Opened and dismissed the searchable company selector at desktop and mobile widths.
- Opened the holding editor from Banks → Cash & wallets.
- Verified keyboard dismissal with Escape.
- Verified popup bounds and scroll metrics from rendered DOM geometry.
- Browser console warnings/errors: none.

## Follow-up polish

- None required for this scope.

final result: passed
