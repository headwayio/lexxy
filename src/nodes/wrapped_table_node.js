import { TableNode } from "@lexical/table"
import { $createListItemNode, $isListItemNode } from "@lexical/list"
import { $getNodeByKey } from "lexical"
import { createElement } from "../helpers/html_helper"

// Tracks provisional list items created when arrowing out of a table in a list.
// These are auto-removed when the user navigates away without typing.
export const $provisionalTableEscapeKeys = new Set()

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
  for (const key of [ ...$provisionalTableEscapeKeys ]) {
    const node = $getNodeByKey(key)
    if (!node || node.getTextContentSize() > 0) {
      $provisionalTableEscapeKeys.delete(key)
      continue
    }
    node.remove()
    $provisionalTableEscapeKeys.delete(key)
  }
}

export function $getWrappedTableChild(listItem) {
  if (!$isListItemNode(listItem)) return null
  return listItem.getChildren().find(c => c instanceof WrappedTableNode) || null
}
