import { TableNode } from "@lexical/table"
import { $isListItemNode, $createListItemNode } from "@lexical/list"
import { createElement } from "../helpers/html_helper"

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
