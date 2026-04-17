// Pure CSS-string helpers for highlight color propagation. Extracted from
// BlockSelectionExtension so the parsing/merging logic can be unit-tested
// in isolation and reused by sibling modules as the block-selection
// subsystem is decomposed.
//
// Color and background-color are parsed directly from raw CSS strings
// because getStyleObjectFromCSS (from @lexical/selection) can fail to
// parse var() values in some Rollup build configurations.

// Extract color and background-color from a raw CSS string. Returns an
// object with those properties, or null if neither is present.
export function extractHighlightFromCSS(css) {
  if (!css) return null
  const result = {}
  const colorMatch = css.match(/(?:^|;\s*)color\s*:\s*([^;]+)/)
  const bgMatch = css.match(/(?:^|;\s*)background-color\s*:\s*([^;]+)/)
  if (colorMatch) result.color = colorMatch[1].trim()
  if (bgMatch) result["background-color"] = bgMatch[1].trim()
  return (result.color || result["background-color"]) ? result : null
}

// Merge highlight properties into an existing CSS string, preserving
// other properties (bold, italic, font-size, etc.).
export function mergeHighlightIntoCSS(existingCSS, highlight) {
  const parts = (existingCSS || "").split(";").filter(s => s.trim())
  const nonHighlight = parts.filter(p => {
    const key = p.split(":")[0]?.trim()
    return key !== "color" && key !== "background-color"
  })
  if (highlight.color) nonHighlight.push(`color: ${highlight.color}`)
  if (highlight["background-color"]) nonHighlight.push(`background-color: ${highlight["background-color"]}`)
  return nonHighlight.join(";") + ";"
}

// Remove color and background-color from a CSS string, preserving other
// props. Returns null (not "") when no properties remain — callers should
// skip setStyle entirely for null to avoid setting an explicit empty
// style that overrides the CSS-inherited default text color.
export function removeHighlightFromCSS(css) {
  if (!css) return null
  const parts = css.split(";").filter(s => s.trim())
  const kept = parts.filter(p => {
    const key = p.split(":")[0]?.trim()
    return key !== "color" && key !== "background-color"
  })
  return kept.length > 0 ? kept.join(";") + ";" : null
}
