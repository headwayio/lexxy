import { $isListItemNode, $isListNode } from "@lexical/list"

// CSS class names used by block selection, drag-and-drop, and block actions.
// Centralised here to avoid stringly-typed duplication across modules.
export const BLOCK_SELECTED_CLASS = "block--selected"
export const BLOCK_FOCUSED_CLASS = "block--focused"
export const BLOCK_SELECTION_ACTIVE_CLASS = "block-selection-active"
export const NESTED_LISTITEM_CLASS = "lexxy-nested-listitem"

// Default fallback sizes (px) when computed styles aren't available.
export const DEFAULT_HANDLE_HEIGHT = 24
export const DEFAULT_ROOT_PADDING = 28

// A structural wrapper is a ListItemNode whose only children are ListNodes.
// Lexical uses these to represent nested list indentation — they contain
// no user-visible content, only the nested list structure.
export function $isStructuralWrapper(node) {
  if (!$isListItemNode(node)) return false
  const children = node.getChildren()
  return children.length > 0 && children.every(c => $isListNode(c))
}
