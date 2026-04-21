// Stamps `data-wrapper-marker` on each "wrapped" list item so CSS can render
// a numbered placeholder ("#.") or a bullet dot without having to key off the
// containing list's tag.
//
// Resolver rules (match today's homogeneous lists and a future per-LI typed
// list):
//   1. Walk each UL/OL's direct LI children in order with a rolling
//      `currentMarker` seeded from `seedMarker(list)`.
//   2. A text LI (regular content, no wrapped block) updates `currentMarker`
//      to its own intrinsic type — its `data-list-item-type` if set (future
//      mixed-list case), else the parent list's tag (OL → number, UL →
//      bullet). This is what flips the rolling marker when the user mixes a
//      plain bullet LI inside a numbered context, so downstream wrappers
//      inherit the switch.
//   3. A wrapped LI (heading, code, table, blockquote, figure, HR, etc.)
//      inherits `currentMarker` and stamps it as `data-wrapper-marker`. It
//      does NOT change `currentMarker` — a chain of wrappers keeps the last
//      marker-bearing sibling's type until a text LI changes it.
//   4. A structural-wrapper LI (only children are nested lists, marked by
//      Lexical with `.lexxy-nested-listitem`, or detected by containing a
//      direct UL/OL child) is transparent — doesn't stamp, doesn't update
//      the rolling marker.
//
// Seeding for a nested list: Lexical always places nested lists inside a
// structural-wrapper LI, and its tag (ul vs ol) doesn't reflect the outer
// list's marker. We therefore resolve the marker the parent wrapper LI
// would itself receive by walking its own list from the start.

const WRAPPED_CHILD_SELECTOR =
  ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, " +
  ":scope > pre, :scope > code[data-language], :scope > table, :scope > blockquote, " +
  ":scope > figure, :scope > .lexxy-content__table-wrapper, :scope > .horizontal-divider"

export function syncWrapperMarkers(root) {
  if (!root) return
  for (const list of root.querySelectorAll("ul, ol")) {
    stampList(list)
  }
}

function stampList(list) {
  let currentMarker = seedMarker(list)
  for (const li of list.children) {
    if (li.tagName !== "LI") continue
    if (isStructuralWrapperLi(li)) continue
    if (isWrapperLi(li)) {
      if (li.dataset.wrapperMarker !== currentMarker) {
        li.dataset.wrapperMarker = currentMarker
      }
    } else {
      if (li.dataset.wrapperMarker) delete li.dataset.wrapperMarker
      currentMarker = textLiMarker(li)
    }
  }
}

function seedMarker(list) {
  const parentLi = list.parentElement
  if (parentLi?.tagName === "LI") {
    const fromParent = parentLi.dataset.listItemType
    if (fromParent === "number" || fromParent === "bullet") return fromParent

    const resolved = resolveLiMarker(parentLi)
    if (resolved) return resolved
  }
  return list.tagName === "OL" ? "number" : "bullet"
}

// Compute the marker that a given LI would receive based on its siblings —
// mirrors the rolling walk in stampList up to (but not including) `li`.
function resolveLiMarker(li) {
  const list = li.parentElement
  if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) return null
  let currentMarker = seedMarker(list)
  for (const sibling of list.children) {
    if (sibling === li) return currentMarker
    if (sibling.tagName !== "LI") continue
    if (isStructuralWrapperLi(sibling)) continue
    if (!isWrapperLi(sibling)) {
      currentMarker = textLiMarker(sibling)
    }
  }
  return currentMarker
}

function textLiMarker(li) {
  const own = li.dataset.listItemType
  if (own === "number" || own === "bullet") return own
  const parent = li.parentElement
  return parent?.tagName === "OL" ? "number" : "bullet"
}

function isWrapperLi(li) {
  return li.querySelector(WRAPPED_CHILD_SELECTOR) !== null
}

// Structural wrappers hold only nested lists — Lexical marks them with the
// `lexxy-nested-listitem` class (from the theme), but also detect by content
// shape to survive any future theme rename.
function isStructuralWrapperLi(li) {
  if (li.classList.contains("lexxy-nested-listitem")) return true
  if (li.children.length === 0) return false
  for (const child of li.children) {
    if (child.tagName !== "UL" && child.tagName !== "OL") return false
  }
  return true
}
