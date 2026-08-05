import { TableNode } from "@lexical/table"
import { $createListItemNode, $isListItemNode } from "@lexical/list"
import { $getEditor, $getNodeByKey } from "lexical"
import { createElement } from "../helpers/html_helper"

// Tracks provisional list items created when arrowing out of a table in a list.
// Keyed by editor so multiple <lexxy-editor> instances on the same page don't
// share state — a selection-change in editor B used to silently evict editor
// A's pending keys because $getNodeByKey resolves per-editor.
const PROVISIONAL_KEYS_BY_EDITOR = new WeakMap()

export function $provisionalTableEscapeKeys(editor = $getEditor()) {
  let keys = PROVISIONAL_KEYS_BY_EDITOR.get(editor)
  if (!keys) {
    keys = new Set()
    PROVISIONAL_KEYS_BY_EDITOR.set(editor, keys)
  }
  return keys
}

export class WrappedTableNode extends TableNode {
  $config() {
    return this.config("wrapped_table_node", { extends: TableNode })
  }

  static importDOM() {
    return super.importDOM()
  }

  canInsertTextBefore() {
    return false
  }

  canInsertTextAfter() {
    return false
  }

  // When exiting a table inside a list item, create a sibling list item
  // (not a paragraph inside the wrapper) so it inherits parent highlighting.
  insertNewAfter(selection, restoreSelection) {
    const parentListItem = this.getParent()
    if ($isListItemNode(parentListItem)) {
      const newItem = $createListItemNode()
      parentListItem.insertAfter(newItem)
      newItem.select()
      return newItem
    }
    return super.insertNewAfter(selection, restoreSelection)
  }

  exportDOM(editor) {
    const superExport = super.exportDOM(editor)

    return {
      ...superExport,
      after: (tableElement) => {
        if (superExport.after) {
          tableElement = superExport.after(tableElement)
          const clonedTable = tableElement.cloneNode(true)
          const wrappedTable = createElement("figure", { className: "lexxy-content__table-wrapper" }, clonedTable.outerHTML)
          return wrappedTable
        }

        return tableElement
      }
    }
  }
}

export function $cleanupProvisionalEscapeItems() {
  const keys = $provisionalTableEscapeKeys()
  for (const key of [ ...keys ]) {
    const node = $getNodeByKey(key)
    if (!node || node.getTextContentSize() > 0) {
      keys.delete(key)
      continue
    }
    node.remove()
    keys.delete(key)
  }
}

export function $getWrappedTableChild(listItem) {
  if (!$isListItemNode(listItem)) return null
  return listItem.getChildren().find(c => c instanceof WrappedTableNode) || null
}

export function $isWrappedTableNode(node) {
  return node instanceof WrappedTableNode
}
