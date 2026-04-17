// Pure geometry / DOM-walking helpers used by the block-drag coordinator.
// Kept side-effect-free so they can be reasoned about in isolation.

// Count how deep a block element is nested. 0 = root child, 1 = inside
// one list, 2 = inside a nested list, etc.
export function getElementNestingDepth(element, root) {
  let depth = 0
  let current = element

  while (current && current !== root) {
    if (current.tagName === "UL" || current.tagName === "OL") {
      depth++
    }
    current = current.parentElement
  }

  return depth
}

// Pick the snap point whose pixelLeft is closest to clientX.
export function findNearestSnapPoint(points, clientX) {
  if (points.length === 0) return { depth: 0, pixelLeft: 0 }

  let best = points[0]
  let bestDist = Math.abs(clientX - best.pixelLeft)

  for (let i = 1; i < points.length; i++) {
    const dist = Math.abs(clientX - points[i].pixelLeft)
    if (dist < bestDist) {
      best = points[i]
      bestDist = dist
    }
  }

  return best
}

// Walk previous siblings, skipping block-drag chrome (handle, add button,
// drop indicator) and hidden/<br> nodes, to find the nearest visible
// content sibling. Returns null if none found before the root.
export function previousContentSibling(element, root) {
  let el = element.previousElementSibling
  while (el && el !== root && (el.tagName === "BR" || el.hidden ||
         el.classList.contains("hidden") || el.classList.contains("lexxy-block-handle") ||
         el.classList.contains("lexxy-block-add") || el.classList.contains("lexxy-drop-indicator"))) {
    el = el.previousElementSibling
  }
  return (el && el !== root) ? el : null
}

export function nextContentSibling(element, root) {
  let el = element.nextElementSibling
  while (el && el !== root && (el.tagName === "BR" || el.hidden ||
         el.classList.contains("hidden") || el.classList.contains("lexxy-block-handle") ||
         el.classList.contains("lexxy-block-add") || el.classList.contains("lexxy-drop-indicator"))) {
    el = el.nextElementSibling
  }
  return (el && el !== root) ? el : null
}
