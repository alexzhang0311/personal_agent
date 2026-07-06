# Mermaid diagrams are themed via CSS variables, not Mermaid's themeVariables

Mermaid is initialized with `theme: 'base'` and a minimal `themeVariables`; all visible color, typography, and stroke styling is driven by global CSS targeting Mermaid's SVG classes with the app's `var(--*)` design tokens. This replaces the previous approach of hardcoding a dark hex palette into `themeVariables` at `initialize()` time, which rendered dark-on-dark (unreadable) under the default light theme and silently drifted from `web/design-spec.md`. CSS variables already flip under `[data-theme="light"]`, so diagrams become correct in both themes for free and need no re-render on theme toggle.

## Considered Options

- **Constrain agent input** to a small supported diagram set, then deeply style only those. Rejected: requires owning the agent system prompt and still degrades for out-of-set diagrams.
- **Universal SVG post-processor** that rewrites geometry/markers in JS after render. Rejected: couples UI correctness to Mermaid's undocumented, version-unstable SVG structure; every Mermaid upgrade becomes a visual-regression hunt.
- **CSS overrides only (chosen).** Reaches ~90%: colors, fonts, stroke widths, shadow removal (`filter: none`), and rectangular corner radius (CSS `rx/ry`).

## Consequences

Accepted residual that CSS structurally cannot reach: **arrowhead glyph shape** and the **silhouette of non-rectangular nodes** (diamonds, circles, subroutines — they are `<path>`, recolorable but not re-shapeable). This is deliberate, not an oversight. Do not "fix" it by reintroducing a JS post-processor without revisiting this decision.

Mermaid's SVG class names (`.node`, `.edgePath`, `.cluster`, `.label`) are generic; all override selectors must be scoped to a wrapper class to avoid corrupting other SVG/graph components in the app.

The `!important` + minimal-`themeVariables` fallback mechanic is load-bearing, not stylistic noise: Mermaid injects an ID-scoped `<style>` (`#<renderId>`) with ID specificity at render time. The override block in `index.css` only wins because every rule is `!important` and every selector is scoped to `.mermaid-svg` (the class added by `adaptSvgMarkup`). Removing the `!important`s — e.g. in a future lint/style cleanup — silently reverts diagrams to Mermaid's hardcoded base palette with no error. Do not strip them.
