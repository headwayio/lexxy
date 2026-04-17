import { $isTextNode } from "lexical"
import { $isListNode, ListItemNode } from "@lexical/list"
import { $isStructuralWrapper } from "../block_helpers"
import { extractHighlightFromCSS, mergeHighlightIntoCSS, removeHighlightFromCSS } from "./highlight_css"

// Sync the <li> element's color from its text content so that bullet markers
// (which use currentColor via ::before) match the text color. Runs as a node
// transform on every dirty ListItemNode, covering all highlight paths:
// direct toggle, indent inheritance, paste, undo, etc.
//
// Returns the unregister function from editor.registerNodeTransform — the
// caller pushes it onto a cleanup list.
export function registerBulletMarkerColorSync(editor) {
  return editor.registerNodeTransform(ListItemNode, (node) => {
    if ($isStructuralWrapper(node)) return

    const textNodes = collectNonListTextNodes(node)

    const highlight = textNodes.length > 0
      ? extractHighlightFromCSS(textNodes[0].getStyle())
      : null

    const liHighlight = extractHighlightFromCSS(node.getStyle())

    // For empty items, fall back to textStyle (controls what color new
    // text will be typed in — set by inheritance or Enter retention).
    const effectiveHighlight = highlight
      || extractHighlightFromCSS(node.getTextStyle())

    if (effectiveHighlight?.color) {
      // Text (or pending text) is colored → set <li> color for bullet marker
      const allSameColor = !highlight || textNodes.every(t => {
        const h = extractHighlightFromCSS(t.getStyle())
        return h && (h.color || "") === (effectiveHighlight.color || "")
      })
      if (allSameColor && (liHighlight?.color || "") !== effectiveHighlight.color) {
        node.setStyle(mergeHighlightIntoCSS(node.getStyle(), { color: effectiveHighlight.color }))
      }
    } else if (liHighlight?.color) {
      // No text or pending highlight → clear <li> color
      node.setStyle(removeHighlightFromCSS(node.getStyle()) ?? "")
    }
  })
}

// Walk a ListItemNode's children (skipping any nested ListNode) and collect
// TextNodes. Used by the transform to inspect the item's own inline text
// while ignoring text inside nested lists below it.
function collectNonListTextNodes(listItem) {
  const out = []
  for (const child of listItem.getChildren()) {
    if (!$isListNode(child)) collectTextNodes(child, out)
  }
  return out
}

function collectTextNodes(node, out) {
  if ($isTextNode(node)) out.push(node)
  else if (node.getChildren) node.getChildren().forEach(c => collectTextNodes(c, out))
}
