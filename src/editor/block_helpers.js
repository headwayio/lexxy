import { $isListItemNode, $isListNode } from "@lexical/list"

// CSS class names used by block selection, drag-and-drop, and block actions.
// Centralised here to avoid stringly-typed duplication across modules.
export const BLOCK_SELECTED_CLASS = "lexxy-editor__block--selected"
export const BLOCK_FOCUSED_CLASS = "lexxy-editor__block--focused"
export const BLOCK_SELECTION_ACTIVE_CLASS = "lexxy-editor--block-selection-active"
export const NESTED_LISTITEM_CLASS = "lexxy-nested-listitem"

// Default fallback sizes (px) when computed styles aren't available.
export const DEFAULT_HANDLE_HEIGHT = 24
export const DEFAULT_ADD_BUTTON_WIDTH = 20
export const DEFAULT_ROOT_PADDING = 28

// Positioning gaps (px) used by drag handles and drop indicators.
export const HANDLE_CONTENT_GAP = 19
export const VIEWPORT_PADDING = 8

// A structural wrapper is a ListItemNode whose only children are ListNodes.
// Lexical uses these to represent nested list indentation — they contain
// no user-visible content, only the nested list structure.
export function $isStructuralWrapper(node) {
  if (!$isListItemNode(node)) return false
  const children = node.getChildren()
  return children.length > 0 && children.every(c => $isListNode(c))
}

// Read the Lexical node key from a DOM element without requiring an
// editor.read() transaction. Lexical stamps each managed element with a
// non-enumerable __lexicalKey_<editorId> property; we find it by prefix.
// Falls back to the dataset.lexicalNodeKey attribute that attachment
// figures set explicitly. Used from mouse/pointer handlers that run
// outside a Lexical update cycle.
export function getNodeKeyFromElement(element) {
  const keyProp = Object.keys(element).find(k => k.startsWith("__lexicalKey_"))
  if (keyProp) return element[keyProp]
  return element.dataset?.lexicalNodeKey || null
}
