import {
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  defineExtension
} from "lexical"
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $findTableNode,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
  registerTablePlugin,
  registerTableSelectionObserver,
  setScrollableTablesActive
} from "@lexical/table"
import { $createListItemNode, $isListItemNode } from "@lexical/list"
import { $cleanupProvisionalEscapeItems, $getWrappedTableChild, $provisionalTableEscapeKeys, WrappedTableNode } from "../nodes/wrapped_table_node.js"
import { CodeNode } from "@lexical/code"
import LexxyExtension from "./lexxy_extension.js"
import { $findMatchingParent, mergeRegister } from "@lexical/utils"

export class TablesExtension extends LexxyExtension {

  get enabled() {
    return this.editorElement.supportsRichText
  }

  get lexicalExtension() {
    return defineExtension({
      name: "lexxy/tables",
      nodes: [
        WrappedTableNode,
        {
          replace: TableNode,
          with: () => new WrappedTableNode(),
          withKlass: WrappedTableNode
        },
        TableCellNode,
        TableRowNode
      ],
      register(editor) {
        setScrollableTablesActive(editor, true)

        return mergeRegister(
          // Register Lexical table plugins
          registerTablePlugin(editor),
          registerTableSelectionObserver(editor, true),

          // Bug fix: Prevent hardcoded background color (Lexical #8089)
          editor.registerNodeTransform(TableCellNode, (node) => {
            if (node.getBackgroundColor() === null) {
              node.setBackgroundColor("")
            }
          }),

          // Bug fix: Fix column header states (Lexical #8090)
          editor.registerNodeTransform(TableCellNode, (node) => {
            const headerState = node.getHeaderStyles()

            if (headerState !== TableCellHeaderStates.ROW) return

            const rowParent = node.getParent()
            const tableNode = rowParent?.getParent()
            if (!tableNode) return

            const rows = tableNode.getChildren()
            const cellIndex = rowParent.getChildren().indexOf(node)

            const cellsInRow = rowParent.getChildren()
            const isHeaderRow = cellsInRow.every(cell =>
              cell.getHeaderStyles() !== TableCellHeaderStates.NO_STATUS
            )

            const isHeaderColumn = rows.every(row => {
              const cell = row.getChildren()[cellIndex]
              return cell && cell.getHeaderStyles() !== TableCellHeaderStates.NO_STATUS
            })

            let newHeaderState = TableCellHeaderStates.NO_STATUS

            if (isHeaderRow) newHeaderState |= TableCellHeaderStates.ROW
            if (isHeaderColumn) newHeaderState |= TableCellHeaderStates.COLUMN

            if (newHeaderState !== headerState) {
              node.setHeaderStyles(newHeaderState, TableCellHeaderStates.BOTH)
            }
          }),

          editor.registerCommand("insertTableRowAfter", () => {
            $insertTableRowAtSelection(true)
          }, COMMAND_PRIORITY_NORMAL),

          editor.registerCommand("insertTableRowBefore", () => {
            $insertTableRowAtSelection(false)
          }, COMMAND_PRIORITY_NORMAL),

          editor.registerCommand("insertTableColumnAfter", () => {
            $insertTableColumnAtSelection(true)
          }, COMMAND_PRIORITY_NORMAL),

          editor.registerCommand("insertTableColumnBefore", () => {
            $insertTableColumnAtSelection(false)
          }, COMMAND_PRIORITY_NORMAL),

          editor.registerCommand("deleteTableRow", () => {
            $deleteTableRowAtSelection()
          }, COMMAND_PRIORITY_NORMAL),

          editor.registerCommand("deleteTableColumn", () => {
            $deleteTableColumnAtSelection()
          }, COMMAND_PRIORITY_NORMAL),

          editor.registerCommand("deleteTable", () => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection)) return false
            $findTableNode(selection.anchor.getNode())?.remove()
          }, COMMAND_PRIORITY_NORMAL),

          // Arrow up/down escape for wrapped blocks (tables, code blocks) in
          // list items. Lexical's built-in table exit detection doesn't fire for
          // tables in lists, so the browser handles the key natively and creates
          // stray paragraphs inside the list item. We intercept at CRITICAL
          // priority and create a proper provisional sibling list item instead.
          editor.registerCommand(KEY_ARROW_UP_COMMAND, (event) => {
            return $handleWrappedBlockEscapeInList(editor, event, "up")
          }, COMMAND_PRIORITY_CRITICAL),

          editor.registerCommand(KEY_ARROW_DOWN_COMMAND, (event) => {
            return $handleWrappedBlockEscapeInList(editor, event, "down")
          }, COMMAND_PRIORITY_CRITICAL),

          // Remove provisional escape list items when the user navigates away without typing
          editor.registerCommand(SELECTION_CHANGE_COMMAND, () => {
            if ($provisionalTableEscapeKeys.size === 0) return false

            const selection = $getSelection()
            if (!$isRangeSelection(selection)) return false

            const anchorNode = selection.anchor.getNode()

            for (const key of [ ...$provisionalTableEscapeKeys ]) {
              const node = $getNodeByKey(key)
              if (!node) {
                $provisionalTableEscapeKeys.delete(key)
                continue
              }
              if (node.getTextContentSize() > 0) {
                // User typed — no longer provisional
                $provisionalTableEscapeKeys.delete(key)
                continue
              }
              const isInProvisional = anchorNode.is(node) || node.isParentOf(anchorNode)
              if (!isInProvisional) {
                node.remove()
                $provisionalTableEscapeKeys.delete(key)
              }
            }
            return false
          }, COMMAND_PRIORITY_LOW),

          // Backspace in a provisional escape item returns focus to the table
          // or to the content above it
          editor.registerCommand(KEY_BACKSPACE_COMMAND, (event) => {
            if ($provisionalTableEscapeKeys.size === 0) return false

            const selection = $getSelection()
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

            const anchorNode = selection.anchor.getNode()

            for (const key of $provisionalTableEscapeKeys) {
              const provisional = $getNodeByKey(key)
              if (!provisional) continue

              const isInProvisional = anchorNode.is(provisional) || provisional.isParentOf(anchorNode)
              if (!isInProvisional) continue
              if (provisional.getTextContentSize() > 0) return false

              event.preventDefault()

              const nextSibling = provisional.getNextSibling()
              const prevSibling = provisional.getPreviousSibling()

              // Provisional is BELOW table — return to table's last cell
              if (prevSibling && $getWrappedTableChild(prevSibling)) {
                const tableNode = $getWrappedTableChild(prevSibling)
                provisional.remove()
                $provisionalTableEscapeKeys.delete(key)
                const lastRow = tableNode.getLastChild()
                if (lastRow) lastRow.getLastChild()?.selectEnd()
                return true
              }

              // Provisional is ABOVE table — move to content above the table
              if (nextSibling && $getWrappedTableChild(nextSibling)) {
                const tableNode = $getWrappedTableChild(nextSibling)
                const tableListItem = nextSibling
                provisional.remove()
                $provisionalTableEscapeKeys.delete(key)

                // Previous sibling of the table's list item
                const prevOfTable = tableListItem.getPreviousSibling()
                if (prevOfTable && $isElementNode(prevOfTable)) {
                  prevOfTable.selectEnd()
                  return true
                }

                // Nothing above in this list — check parent context
                const list = tableListItem.getParent()
                if (list) {
                  const prevOfList = list.getPreviousSibling()
                  if (prevOfList && $isElementNode(prevOfList)) {
                    prevOfList.selectEnd()
                    return true
                  }
                  // Nested list — select parent list item
                  if ($isListItemNode(list.getParent())) {
                    list.getParent().selectEnd()
                    return true
                  }
                }

                // At document top — return to table's first cell
                const firstRow = tableNode.getFirstChild()
                if (firstRow) firstRow.getFirstChild()?.selectStart()
                return true
              }

              break
            }

            return false
          }, COMMAND_PRIORITY_HIGH)
        )
      }
    })
  }
}

function $handleWrappedBlockEscapeInList(editor, event, direction) {
  if (event.shiftKey || event.metaKey || event.ctrlKey) return false

  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

  const context = $getWrappedBlockContext(selection, direction)
  if (!context) return false

  const { parentListItem, edgeContentNode } = context

  // Only escape if cursor is at the top/bottom visual line of the block.
  if (!$isAtVisualEdge(editor, edgeContentNode, direction)) return false

  event.preventDefault()
  event.stopPropagation()

  $cleanupProvisionalEscapeItems()

  const newItem = $createListItemNode()
  if (direction === "up") {
    parentListItem.insertBefore(newItem)
  } else {
    parentListItem.insertAfter(newItem)
  }
  $provisionalTableEscapeKeys.add(newItem.getKey())
  newItem.select()

  return true
}

// Returns { parentListItem, edgeContentNode } if cursor is at an escapable
// position inside a wrapped block (table or code block) in a list item.
function $getWrappedBlockContext(selection, direction) {
  const anchorNode = selection.anchor.getNode()

  // Table in a list item
  const cellNode = $findMatchingParent(anchorNode, $isTableCellNode)
  if (cellNode) {
    const tableNode = $findTableNode(cellNode)
    if (!(tableNode instanceof WrappedTableNode)) return null

    const parentListItem = tableNode.getParent()
    if (!$isListItemNode(parentListItem)) return null

    const rowNode = cellNode.getParent()
    if (!rowNode) return null

    const rows = tableNode.getChildren()
    const rowIndex = rows.indexOf(rowNode)
    const isEdgeRow = direction === "up" ? rowIndex === 0 : rowIndex === rows.length - 1
    if (!isEdgeRow) return null

    const edgeContentNode = direction === "up" ? cellNode.getFirstChild() : cellNode.getLastChild()
    return edgeContentNode ? { parentListItem, edgeContentNode } : null
  }

  // Code block in a list item
  const codeNode = $findMatchingParent(anchorNode, node => node instanceof CodeNode)
  if (codeNode) {
    const parentListItem = codeNode.getParent()
    if (!$isListItemNode(parentListItem)) return null

    // For code blocks, the edge content is the code node itself
    return { parentListItem, edgeContentNode: codeNode }
  }

  return null
}

function $isAtVisualEdge(editor, node, direction) {
  const dom = editor.getElementByKey(node.getKey())
  if (!dom) return false

  const domSelection = window.getSelection()
  if (!domSelection || domSelection.rangeCount === 0) return false

  const selectionRect = domSelection.getRangeAt(0).getBoundingClientRect()
  const edgeRect = dom.getBoundingClientRect()

  return direction === "up"
    ? edgeRect.top > selectionRect.top - selectionRect.height
    : selectionRect.bottom + selectionRect.height > edgeRect.bottom
}
