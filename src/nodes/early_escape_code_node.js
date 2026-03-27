import { $createParagraphNode } from "lexical"
import { CodeNode } from "@lexical/code"
import { $isListItemNode, $createListItemNode } from "@lexical/list"
import { $getNearestNodeOfType } from "@lexical/utils"
import { $isCursorOnLastLine, $trimTrailingBlankNodes } from "../helpers/lexical_helper"

export class EarlyEscapeCodeNode extends CodeNode {
  $config() {
    return this.config("early_escape_code", { extends: CodeNode })
  }

  static $fromSelection(selection) {
    const anchorNode = selection.anchor.getNode()
    return $getNearestNodeOfType(anchorNode, EarlyEscapeCodeNode)
      || (anchorNode instanceof EarlyEscapeCodeNode ? anchorNode : null)
  }

  insertNewAfter(selection, restoreSelection) {
    if (!selection.isCollapsed()) return super.insertNewAfter(selection, restoreSelection)

    if (this.#isCursorOnEmptyLastLine(selection)) {
      $trimTrailingBlankNodes(this)

      // If the code block is wrapped inside a ListItemNode, create a new
      // sibling list item (not a paragraph inside the wrapper) so the new
      // item is a proper list citizen that inherits parent highlighting.
      const parentListItem = this.getParent()
      if ($isListItemNode(parentListItem)) {
        const newItem = $createListItemNode()
        parentListItem.insertAfter(newItem)
        newItem.select()
        return newItem
      }

      const paragraph = $createParagraphNode()
      this.insertAfter(paragraph)
      return paragraph
    }

    return super.insertNewAfter(selection, restoreSelection)
  }

  #isCursorOnEmptyLastLine(selection) {
    if (!$isCursorOnLastLine(selection)) return false

    const textContent = this.getTextContent()
    return textContent === "" || textContent.endsWith("\n")
  }

}
